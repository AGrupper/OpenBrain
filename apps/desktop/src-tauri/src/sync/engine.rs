use anyhow::{Context, Result};
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use reqwest::Client;
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};
use tokio::{
    sync::{mpsc, Mutex},
    time::sleep,
};
use walkdir::WalkDir;

#[derive(Clone)]
pub struct SyncConfig {
    pub vault_path: String,
    pub api_url: String,
    pub auth_token: String,
}

pub struct SyncEngine {
    pub config: SyncConfig,
    client: Client,
    stop_tx: Option<mpsc::Sender<()>>,
    watcher: Option<RecommendedWatcher>,
}

#[derive(serde::Deserialize)]
struct RemoteFile {
    id: String,
    path: String,
    sha256: String,
    #[allow(dead_code)]
    size: u64,
}

impl SyncEngine {
    pub async fn new(config: SyncConfig) -> Result<Self> {
        let client = Client::builder().timeout(Duration::from_secs(30)).build()?;
        Ok(Self {
            config,
            client,
            stop_tx: None,
            watcher: None,
        })
    }

    pub async fn start(&mut self) -> Result<()> {
        let vault = PathBuf::from(&self.config.vault_path);
        std::fs::create_dir_all(&vault)?;

        let (event_tx, mut event_rx) = mpsc::channel::<PathBuf>(256);
        let (stop_tx, mut stop_rx) = mpsc::channel::<()>(1);

        // File-system watcher
        let event_tx_clone = event_tx.clone();
        let mut watcher = notify::recommended_watcher(move |res: notify::Result<Event>| {
            if let Ok(event) = res {
                if matches!(
                    event.kind,
                    EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)
                ) {
                    for path in event.paths {
                        let _ = event_tx_clone.blocking_send(path);
                    }
                }
            }
        })?;
        watcher.watch(vault.as_path(), RecursiveMode::Recursive)?;

        let cfg = self.config.clone();
        let client = self.client.clone();

        // Kick off initial full sync
        let cfg2 = cfg.clone();
        let client2 = client.clone();
        let vault2 = vault.clone();
        tokio::spawn(async move {
            match full_sync(&client2, &cfg2, &vault2).await {
                Ok(()) => {
                    crate::debug_log::agent_line(
                        "engine.rs:start",
                        "initial full_sync ok",
                        "P1",
                        serde_json::json!({}),
                    );
                }
                Err(e) => {
                    log::error!("Initial sync error: {e}");
                    crate::debug_log::agent_line(
                        "engine.rs:start",
                        "initial full_sync err",
                        "P1",
                        serde_json::json!({ "err": e.to_string() }),
                    );
                }
            }
        });

        // Polling loop: processes file events + periodic pull every 60s
        let debounce: Arc<Mutex<HashMap<PathBuf, ()>>> = Arc::new(Mutex::new(HashMap::new()));
        let debounce_clone = debounce.clone();

        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(60));
            loop {
                tokio::select! {
                    _ = stop_rx.recv() => break,
                    _ = interval.tick() => {
                        if let Err(e) = pull_remote(&client, &cfg, &vault).await {
                            log::error!("Pull error: {e}");
                        }
                    }
                    Some(path) = event_rx.recv() => {
                        // Debounce: wait 500ms after last event for the same path
                        {
                            let mut d = debounce_clone.lock().await;
                            d.insert(path.clone(), ());
                        }
                        sleep(Duration::from_millis(500)).await;
                        {
                            let mut d = debounce_clone.lock().await;
                            if d.remove(&path).is_none() { continue; }
                        }
                        if path.is_file() {
                            if let Err(e) = upload_file(&client, &cfg, &vault, &path).await {
                                log::error!("Upload {path:?}: {e}");
                            }
                        }
                    }
                }
            }
        });

        self.stop_tx = Some(stop_tx);
        self.watcher = Some(watcher);
        Ok(())
    }

    pub async fn stop(mut self) -> Result<()> {
        if let Some(tx) = self.stop_tx.take() {
            let _ = tx.send(()).await;
        }
        Ok(())
    }
}

fn sha256_file(path: &Path) -> Result<String> {
    let bytes = std::fs::read(path)?;
    let hash = Sha256::digest(&bytes);
    Ok(hex::encode(hash))
}

fn relative_path(vault: &Path, path: &Path) -> String {
    path.strip_prefix(vault)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

fn guess_mime(path: &Path) -> &'static str {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase());
    match ext.as_deref() {
        Some("md") => "text/markdown",
        Some("txt") => "text/plain",
        Some("pdf") => "application/pdf",
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("mp4") => "video/mp4",
        Some("mp3") => "audio/mpeg",
        Some("json") => "application/json",
        Some("ts") | Some("tsx") => "text/typescript",
        Some("js") | Some("jsx") => "text/javascript",
        _ => "application/octet-stream",
    }
}

async fn upload_file(client: &Client, cfg: &SyncConfig, vault: &Path, path: &Path) -> Result<()> {
    let rel = relative_path(vault, path);
    upload_local_file(client, cfg, path, &rel).await
}

pub async fn upload_local_file(
    client: &Client,
    cfg: &SyncConfig,
    path: &Path,
    remote_path: &str,
) -> Result<()> {
    let bytes = tokio::fs::read(path).await.context("read file")?;
    let sha = sha256_file(path)?;
    let size = bytes.len() as u64;
    let mime = guess_mime(path);

    client
        .put(format!("{}/files/upload", cfg.api_url))
        .header("Authorization", format!("Bearer {}", cfg.auth_token))
        .header("Content-Type", mime)
        .header("X-File-Path", remote_path)
        .header("X-File-Sha256", &sha)
        .header("X-File-Size", size.to_string())
        .body(bytes)
        .send()
        .await?
        .error_for_status()?;

    log::info!("Uploaded: {remote_path}");
    Ok(())
}

async fn pull_remote(client: &Client, cfg: &SyncConfig, vault: &Path) -> Result<()> {
    let list_url = format!("{}/files", cfg.api_url);
    // #region agent log
    crate::debug_log::agent_line(
        "engine.rs:pull_remote",
        "list request",
        "P5",
        serde_json::json!({
            "api_url_empty": cfg.api_url.is_empty(),
            "api_url_trailing_slash": cfg.api_url.ends_with('/'),
            "list_url_len": list_url.len(),
        }),
    );
    // #endregion
    let resp = client
        .get(&list_url)
        .header("Authorization", format!("Bearer {}", cfg.auth_token))
        .send()
        .await
        .map_err(|e| {
            // #region agent log
            crate::debug_log::agent_line(
                "engine.rs:pull_remote",
                "list send err",
                "P2",
                serde_json::json!({ "err": e.to_string() }),
            );
            // #endregion
            e
        })?
        .error_for_status()
        .map_err(|e| {
            // #region agent log
            crate::debug_log::agent_line(
                "engine.rs:pull_remote",
                "list status err",
                "P2",
                serde_json::json!({ "err": e.to_string() }),
            );
            // #endregion
            e
        })?
        .json::<Vec<RemoteFile>>()
        .await
        .map_err(|e| {
            // #region agent log
            crate::debug_log::agent_line(
                "engine.rs:pull_remote",
                "list json err",
                "P2",
                serde_json::json!({ "err": e.to_string() }),
            );
            // #endregion
            e
        })?;

    // #region agent log
    crate::debug_log::agent_line(
        "engine.rs:pull_remote",
        "remote file list",
        "P2",
        serde_json::json!({ "remote_count": resp.len() }),
    );
    // #endregion

    let mut pulled: u32 = 0;
    for remote in resp {
        let local_path = vault.join(remote.path.replace('/', std::path::MAIN_SEPARATOR_STR));
        if local_path.exists() {
            match sha256_file(&local_path) {
                Ok(local_sha) if local_sha == remote.sha256 => continue,
                Ok(_) => { /* differs — fall through to download */ }
                Err(e) => {
                    log::warn!("hash failed for {local_path:?}: {e}; re-downloading");
                }
            }
        }

        // Download remote version
        let dl_url = format!("{}/files/{}/download", cfg.api_url, remote.id);
        let bytes = match client
            .get(&dl_url)
            .header("Authorization", format!("Bearer {}", cfg.auth_token))
            .send()
            .await
        {
            Ok(r) => r,
            Err(e) => {
                // #region agent log
                crate::debug_log::agent_line(
                    "engine.rs:pull_remote",
                    "download send err",
                    "P4",
                    serde_json::json!({
                        "path_len": remote.path.len(),
                        "err": e.to_string(),
                    }),
                );
                // #endregion
                return Err(e.into());
            }
        }
        .error_for_status()
        .map_err(|e| {
            // #region agent log
            crate::debug_log::agent_line(
                "engine.rs:pull_remote",
                "download status err",
                "P4",
                serde_json::json!({
                    "path_len": remote.path.len(),
                    "err": e.to_string(),
                }),
            );
            // #endregion
            e
        })?
        .bytes()
        .await?;

        if let Some(parent) = local_path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        if let Err(e) = tokio::fs::write(&local_path, &bytes).await {
            // #region agent log
            crate::debug_log::agent_line(
                "engine.rs:pull_remote",
                "write local err",
                "P4",
                serde_json::json!({
                    "path_len": remote.path.len(),
                    "err": e.to_string(),
                }),
            );
            // #endregion
            return Err(e.into());
        }
        pulled += 1;
        log::info!("Pulled: {}", remote.path);
    }
    // #region agent log
    crate::debug_log::agent_line(
        "engine.rs:pull_remote",
        "pull complete",
        "P2",
        serde_json::json!({ "files_written": pulled }),
    );
    // #endregion
    Ok(())
}

async fn full_sync(client: &Client, cfg: &SyncConfig, vault: &Path) -> Result<()> {
    // #region agent log
    crate::debug_log::agent_line(
        "engine.rs:full_sync",
        "start",
        "P1",
        serde_json::json!({
            "vault_path_len": cfg.vault_path.len(),
            "api_url_len": cfg.api_url.len(),
            "token_len": cfg.auth_token.len(),
        }),
    );
    // #endregion
    let mut upload_ok: u32 = 0;
    let mut upload_err: u32 = 0;
    // Upload any local files not yet on server
    for entry in WalkDir::new(vault).into_iter().filter_map(|e| e.ok()) {
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();
        // Skip hidden files
        if path
            .file_name()
            .and_then(|n| n.to_str())
            .map(|n| n.starts_with('.'))
            .unwrap_or(false)
        {
            continue;
        }
        match upload_file(client, cfg, vault, path).await {
            Ok(()) => upload_ok += 1,
            Err(e) => {
                upload_err += 1;
                log::warn!("Initial upload {path:?}: {e}");
            }
        }
    }
    // #region agent log
    crate::debug_log::agent_line(
        "engine.rs:full_sync",
        "after local uploads",
        "P3",
        serde_json::json!({ "upload_ok": upload_ok, "upload_err": upload_err }),
    );
    // #endregion
    // Then pull anything we're missing
    pull_remote(client, cfg, vault).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::TempDir;

    #[test]
    fn sha256_file_is_stable_for_known_input() {
        let tmp = TempDir::new().unwrap();
        let p = tmp.path().join("a.txt");
        let mut f = std::fs::File::create(&p).unwrap();
        f.write_all(b"hello").unwrap();
        let sha = sha256_file(&p).unwrap();
        // sha256("hello")
        assert_eq!(
            sha,
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
        );
    }

    #[test]
    fn relative_path_normalizes_to_forward_slashes() {
        let vault = Path::new("/tmp/vault");
        let nested = Path::new("/tmp/vault/subdir/note.md");
        assert_eq!(relative_path(vault, nested), "subdir/note.md");
    }

    #[test]
    fn relative_path_falls_back_when_not_under_vault() {
        let vault = Path::new("/tmp/vault");
        let outside = Path::new("/elsewhere/note.md");
        let s = relative_path(vault, outside);
        assert_eq!(s, "/elsewhere/note.md".replace('\\', "/"));
    }

    #[test]
    fn guess_mime_handles_known_and_unknown_extensions() {
        assert_eq!(guess_mime(Path::new("note.md")), "text/markdown");
        assert_eq!(guess_mime(Path::new("doc.pdf")), "application/pdf");
        assert_eq!(guess_mime(Path::new("image.JPG")), "image/jpeg");
        assert_eq!(guess_mime(Path::new("Photo.JPEG")), "image/jpeg");
        assert_eq!(guess_mime(Path::new("noext")), "application/octet-stream");
    }
}

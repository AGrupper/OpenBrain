mod debug_log;
mod sync;
mod vault_persist;

use std::sync::Arc;
use std::{collections::HashSet, path::PathBuf};
use sync::engine::{upload_local_file, SyncConfig, SyncEngine};
use tauri::AppHandle;
use tauri::State;
use tokio::sync::Mutex;

pub struct AppState {
    pub engine: Arc<Mutex<Option<SyncEngine>>>,
}

#[derive(serde::Serialize)]
struct ImportFailure {
    path: String,
    error: String,
}

#[derive(serde::Serialize)]
struct ImportSummary {
    imported: usize,
    failed: usize,
    failures: Vec<ImportFailure>,
}

fn sanitize_file_name(name: &str) -> String {
    let sanitized = name
        .chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '|' | '?' | '*' | '\\' | '/' => '-',
            c if c.is_control() => '-',
            c => c,
        })
        .collect::<String>()
        .trim()
        .trim_matches('.')
        .to_string();

    if sanitized.is_empty() {
        "untitled".to_string()
    } else {
        sanitized
    }
}

fn unique_inbox_path(path: &PathBuf, used: &mut HashSet<String>) -> Result<String, String> {
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "File path has no valid filename".to_string())?;
    let clean = sanitize_file_name(file_name);
    let candidate = format!("Inbox/{clean}");

    if used.insert(candidate.clone()) {
        return Ok(candidate);
    }

    let stem = path
        .file_stem()
        .and_then(|n| n.to_str())
        .map(sanitize_file_name)
        .unwrap_or_else(|| "untitled".to_string());
    let ext = path
        .extension()
        .and_then(|n| n.to_str())
        .map(sanitize_file_name)
        .filter(|s| !s.is_empty());

    for n in 2.. {
        let candidate = match &ext {
            Some(ext) => format!("Inbox/{stem} ({n}).{ext}"),
            None => format!("Inbox/{stem} ({n})"),
        };
        if used.insert(candidate.clone()) {
            return Ok(candidate);
        }
    }

    unreachable!("unbounded suffix search always returns");
}

#[tauri::command]
async fn start_sync(
    app: AppHandle,
    vault_path: String,
    api_url: String,
    auth_token: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    // #region agent log
    debug_log::agent_line(
        "lib.rs:start_sync",
        "start_sync invoked",
        "H1",
        serde_json::json!({
            "vault_path_len": vault_path.len(),
            "api_url_len": api_url.len(),
            "auth_token_len": auth_token.len(),
        }),
    );
    // #endregion
    let cfg = SyncConfig {
        vault_path: vault_path.clone(),
        api_url,
        auth_token,
    };
    let mut engine = SyncEngine::new(cfg).await.map_err(|e| e.to_string())?;
    engine.start().await.map_err(|e| e.to_string())?;
    let mut guard = state.engine.lock().await;
    *guard = Some(engine);
    drop(guard);
    let save_res = vault_persist::save_last_vault(&app, &vault_path);
    // #region agent log
    debug_log::agent_line(
        "lib.rs:start_sync",
        "save_last_vault result",
        "H1",
        serde_json::json!({"ok": save_res.is_ok(), "err": save_res.as_ref().err().map(|s| s.as_str())}),
    );
    // #endregion
    save_res.map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn import_files(
    file_paths: Vec<String>,
    api_url: String,
    auth_token: String,
) -> Result<ImportSummary, String> {
    let cfg = SyncConfig {
        vault_path: String::new(),
        api_url,
        auth_token,
    };
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?;

    let mut used = HashSet::new();
    let mut failures = Vec::new();
    let mut imported = 0usize;

    for raw_path in file_paths {
        let path = PathBuf::from(&raw_path);
        if !path.is_file() {
            failures.push(ImportFailure {
                path: raw_path,
                error: "Not a file".to_string(),
            });
            continue;
        }

        let remote_path = match unique_inbox_path(&path, &mut used) {
            Ok(path) => path,
            Err(error) => {
                failures.push(ImportFailure {
                    path: raw_path,
                    error,
                });
                continue;
            }
        };

        match upload_local_file(&client, &cfg, &path, &remote_path).await {
            Ok(()) => imported += 1,
            Err(e) => failures.push(ImportFailure {
                path: raw_path,
                error: e.to_string(),
            }),
        }
    }

    Ok(ImportSummary {
        imported,
        failed: failures.len(),
        failures,
    })
}

#[tauri::command]
async fn stop_sync(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let mut guard = state.engine.lock().await;
    if let Some(engine) = guard.take() {
        engine.stop().await.map_err(|e| e.to_string())?;
    }
    // #region agent log
    debug_log::agent_line("lib.rs:stop_sync", "clearing persisted vault", "H5", serde_json::json!({}));
    // #endregion
    vault_persist::clear_last_vault(&app).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn get_vault_path(state: State<'_, AppState>) -> Result<Option<String>, String> {
    let guard = state.engine.lock().await;
    Ok(guard.as_ref().map(|e| e.config.vault_path.clone()))
}

#[tauri::command]
fn get_persisted_vault_path(app: AppHandle) -> Result<Option<String>, String> {
    let out = vault_persist::load_last_vault(&app);
    // #region agent log
    debug_log::agent_line(
        "lib.rs:get_persisted_vault_path",
        "load_last_vault result",
        "H2",
        serde_json::json!({
            "ok": out.is_ok(),
            "has_some": out.as_ref().ok().and_then(|o| o.as_ref()).is_some(),
            "err": out.as_ref().err().map(|s| s.as_str()),
        }),
    );
    // #endregion
    out
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .manage(AppState {
            engine: Arc::new(Mutex::new(None)),
        })
        .invoke_handler(tauri::generate_handler![
            start_sync,
            import_files,
            stop_sync,
            get_vault_path,
            get_persisted_vault_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

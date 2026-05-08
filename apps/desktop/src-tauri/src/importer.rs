use anyhow::{Context, Result};
use reqwest::Client;
use sha2::{Digest, Sha256};
use std::path::Path;

#[derive(Clone)]
pub struct ImportConfig {
    pub api_url: String,
    pub auth_token: String,
}

fn sha256_file(path: &Path) -> Result<String> {
    let bytes = std::fs::read(path)?;
    let hash = Sha256::digest(&bytes);
    Ok(hex::encode(hash))
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

pub async fn upload_local_file(
    client: &Client,
    cfg: &ImportConfig,
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

    log::info!("Imported: {remote_path}");
    Ok(())
}

pub async fn download_vault_file(
    client: &Client,
    cfg: &ImportConfig,
    file_id: &str,
    output_path: &Path,
) -> Result<()> {
    let bytes = client
        .get(format!("{}/files/{file_id}/download", cfg.api_url))
        .header("Authorization", format!("Bearer {}", cfg.auth_token))
        .send()
        .await?
        .error_for_status()?
        .bytes()
        .await?;

    tokio::fs::write(output_path, bytes)
        .await
        .context("write exported file")?;
    Ok(())
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
        assert_eq!(
            sha,
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
        );
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

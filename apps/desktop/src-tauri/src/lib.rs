mod importer;

use importer::{upload_local_file, ImportConfig};
use std::{
    collections::HashSet,
    path::{Path, PathBuf},
};

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

fn unique_inbox_path(path: &Path, used: &mut HashSet<String>) -> Result<String, String> {
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
async fn import_files(
    file_paths: Vec<String>,
    api_url: String,
    auth_token: String,
) -> Result<ImportSummary, String> {
    let cfg = ImportConfig {
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

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![import_files])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_file_name_replaces_invalid_characters() {
        assert_eq!(sanitize_file_name(r#" ../bad:name?.md "#), "-bad-name-.md");
        assert_eq!(sanitize_file_name("..."), "untitled");
        assert_eq!(sanitize_file_name(""), "untitled");
    }

    #[test]
    fn unique_inbox_path_deduplicates_remote_paths() {
        let mut used = HashSet::new();

        assert_eq!(
            unique_inbox_path(Path::new("C:/notes/report.md"), &mut used).unwrap(),
            "Inbox/report.md"
        );
        assert_eq!(
            unique_inbox_path(Path::new("C:/other/report.md"), &mut used).unwrap(),
            "Inbox/report (2).md"
        );
        assert_eq!(
            unique_inbox_path(Path::new("C:/other/report"), &mut used).unwrap(),
            "Inbox/report"
        );
    }
}

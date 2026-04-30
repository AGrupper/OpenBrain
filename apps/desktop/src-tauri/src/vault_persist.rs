//! Remember the last chosen vault folder across app restarts (until the user stops sync).

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::AppHandle;
use tauri::Manager;

const FILE_NAME: &str = "last_vault.json";

#[derive(Serialize, Deserialize)]
struct LastVault {
    vault_path: String,
}

fn vault_file(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    Ok(dir.join(FILE_NAME))
}

pub fn save_last_vault(app: &AppHandle, vault_path: &str) -> Result<(), String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let data = LastVault {
        vault_path: vault_path.to_string(),
    };
    let json = serde_json::to_string(&data).map_err(|e| e.to_string())?;
    let vf = vault_file(app)?;
    fs::write(&vf, json).map_err(|e| e.to_string())?;
    // #region agent log
    crate::debug_log::agent_line(
        "vault_persist.rs:save_last_vault",
        "after write",
        "H1",
        serde_json::json!({
            "file_exists": vf.exists(),
            "config_dir_len": vf.parent().map(|p| p.as_os_str().len()).unwrap_or(0),
        }),
    );
    // #endregion
    Ok(())
}

pub fn load_last_vault(app: &AppHandle) -> Result<Option<String>, String> {
    let path = vault_file(app)?;
    let exists = path.exists();
    // #region agent log
    crate::debug_log::agent_line(
        "vault_persist.rs:load_last_vault",
        "before read",
        "H2",
        serde_json::json!({"file_exists": exists}),
    );
    // #endregion
    if !exists {
        return Ok(None);
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let v: LastVault = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    Ok(Some(v.vault_path))
}

pub fn clear_last_vault(app: &AppHandle) -> Result<(), String> {
    let path = vault_file(app)?;
    if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    // #region agent log
    crate::debug_log::agent_line(
        "vault_persist.rs:clear_last_vault",
        "after clear",
        "H5",
        serde_json::json!({"file_still_exists": path.exists()}),
    );
    // #endregion
    Ok(())
}

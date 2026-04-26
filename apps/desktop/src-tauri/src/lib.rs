mod sync;

use std::sync::Arc;
use sync::engine::{SyncConfig, SyncEngine};
use tauri::State;
use tokio::sync::Mutex;

pub struct AppState {
    pub engine: Arc<Mutex<Option<SyncEngine>>>,
}

#[tauri::command]
async fn start_sync(
    vault_path: String,
    api_url: String,
    auth_token: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let cfg = SyncConfig {
        vault_path,
        api_url,
        auth_token,
    };
    let mut engine = SyncEngine::new(cfg).await.map_err(|e| e.to_string())?;
    engine.start().await.map_err(|e| e.to_string())?;
    let mut guard = state.engine.lock().await;
    *guard = Some(engine);
    Ok(())
}

#[tauri::command]
async fn stop_sync(state: State<'_, AppState>) -> Result<(), String> {
    let mut guard = state.engine.lock().await;
    if let Some(engine) = guard.take() {
        engine.stop().await.map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn get_vault_path(state: State<'_, AppState>) -> Result<Option<String>, String> {
    let guard = state.engine.lock().await;
    Ok(guard.as_ref().map(|e| e.config.vault_path.clone()))
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
            stop_sync,
            get_vault_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

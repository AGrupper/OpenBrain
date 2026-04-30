use std::io::Write;

/// NDJSON to workspace `debug-8d61f7.log` (agent debug session).
pub fn agent_line(location: &str, message: &str, hypothesis_id: &str, data: serde_json::Value) {
    let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("..")
        .join("debug-8d61f7.log");
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let payload = serde_json::json!({
        "sessionId": "8d61f7",
        "timestamp": ts,
        "location": location,
        "message": message,
        "hypothesisId": hypothesis_id,
        "data": data,
    });
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(f, "{}", payload);
    }
}

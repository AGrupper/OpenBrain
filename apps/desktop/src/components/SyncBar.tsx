export type SyncStatus = "idle" | "starting" | "running" | "stopping" | "error";

interface Props {
  vaultPath: string | null;
  status: SyncStatus;
  error: string | null;
  importStatus: string | null;
  onAddFiles: () => void;
  onChoose: () => void;
  onStop: () => void;
}

export function SyncBar({
  vaultPath,
  status,
  error,
  importStatus,
  onAddFiles,
  onChoose,
  onStop,
}: Props) {
  if (!vaultPath && status === "idle") {
    return (
      <div className="sync-bar">
        <span style={{ color: "var(--text-secondary)", fontSize: 13 }}>Cloud vault ready.</span>
        {importStatus && <span style={styles.importStatus}>{importStatus}</span>}
        {error && <span style={styles.error}>{error}</span>}
        <button className="btn-primary" onClick={onAddFiles}>
          Add files
        </button>
        <button className="btn-primary" onClick={onChoose}>
          Sync folder
        </button>
      </div>
    );
  }

  return (
    <div className="sync-bar">
      <button className="btn-primary" onClick={onAddFiles}>
        Add files
      </button>
      {importStatus && <span style={styles.importStatus}>{importStatus}</span>}
      <span style={styles.vaultPath}>{vaultPath ?? ""}</span>
      {error && <span style={styles.error}>{error}</span>}
      <span className="status-dot" style={{ background: statusColor(status) }} />
      <span style={styles.statusLabel}>{statusLabel(status)}</span>
      {(status === "running" || status === "stopping" || status === "error") && (
        <button className="btn-stop" onClick={onStop} disabled={status === "stopping"}>
          Stop
        </button>
      )}
      {status === "idle" && (
        <button className="btn-primary" onClick={onChoose}>
          Sync folder
        </button>
      )}
    </div>
  );
}

function statusColor(status: SyncStatus) {
  if (status === "running") return "var(--accent-success)";
  if (status === "starting" || status === "stopping") return "var(--accent-warning)";
  if (status === "error") return "var(--accent-danger)";
  return "var(--text-muted)";
}

function statusLabel(status: SyncStatus) {
  if (status === "running") return "Syncing";
  if (status === "starting") return "Starting...";
  if (status === "stopping") return "Stopping...";
  if (status === "error") return "Error";
  return "Stopped";
}

const styles: Record<string, React.CSSProperties> = {
  importStatus: {
    color: "var(--accent-primary)",
    fontSize: 12,
    marginRight: 8,
  },
  error: {
    color: "var(--accent-danger)",
    fontSize: 12,
    marginRight: 8,
  },
  vaultPath: {
    fontSize: 12,
    color: "var(--text-secondary)",
    flex: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  statusLabel: {
    fontSize: 12,
    color: "var(--text-muted)",
    marginRight: 8,
  },
};

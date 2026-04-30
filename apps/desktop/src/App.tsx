import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { ListView } from "./views/ListView";
import { GraphView } from "./views/GraphView";
import { SearchBar } from "./views/SearchBar";
import { ReviewInbox } from "./views/ReviewInbox";
import type { VaultFile } from "../../../packages/shared/src/types";
import { api } from "./api";

type ViewMode = "list" | "graph" | "review";
type SyncStatus = "idle" | "starting" | "running" | "stopping" | "error";

export default function App() {
  const [view, setView] = useState<ViewMode>("list");
  const [files, setFiles] = useState<VaultFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<VaultFile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [vaultPath, setVaultPath] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("idle");
  const [syncError, setSyncError] = useState<string | null>(null);
  const [importStatus, setImportStatus] = useState<string | null>(null);

  const loadFiles = useCallback(() => {
    setLoading(true);
    api.files
      .list()
      .then(setFiles)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  // On mount: restore in-memory vault from this session, else resume from disk (see Rust vault_persist).
  useEffect(() => {
    let cancelled = false;

    async function boot() {
      // #region agent log
      fetch("http://127.0.0.1:7302/ingest/9ae87695-32df-419a-9357-f52372e9db89", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "8d61f7" },
        body: JSON.stringify({
          sessionId: "8d61f7",
          location: "App.tsx:boot",
          message: "boot start",
          hypothesisId: "H4",
          data: {},
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
      try {
        let path = await invoke<string | null>("get_vault_path");
        // #region agent log
        fetch("http://127.0.0.1:7302/ingest/9ae87695-32df-419a-9357-f52372e9db89", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "8d61f7" },
          body: JSON.stringify({
            sessionId: "8d61f7",
            location: "App.tsx:boot",
            message: "after get_vault_path",
            hypothesisId: "H4",
            data: { cancelled, hasPath: !!path },
            timestamp: Date.now(),
          }),
        }).catch(() => {});
        // #endregion
        if (cancelled) return;

        if (!path) {
          path = await invoke<string | null>("get_persisted_vault_path");
          // #region agent log
          fetch("http://127.0.0.1:7302/ingest/9ae87695-32df-419a-9357-f52372e9db89", {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "8d61f7" },
            body: JSON.stringify({
              sessionId: "8d61f7",
              location: "App.tsx:boot",
              message: "after get_persisted_vault_path",
              hypothesisId: "H2",
              data: { cancelled, hasPath: !!path },
              timestamp: Date.now(),
            }),
          }).catch(() => {});
          // #endregion
          if (cancelled) return;

          if (path) {
            // #region agent log
            fetch("http://127.0.0.1:7302/ingest/9ae87695-32df-419a-9357-f52372e9db89", {
              method: "POST",
              headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "8d61f7" },
              body: JSON.stringify({
                sessionId: "8d61f7",
                location: "App.tsx:boot",
                message: "resume start_sync",
                hypothesisId: "H4",
                data: { pathLen: path.length },
                timestamp: Date.now(),
              }),
            }).catch(() => {});
            // #endregion
            setSyncStatus("starting");
            setSyncError(null);
            try {
              await invoke("start_sync", {
                vaultPath: path,
                apiUrl: import.meta.env.VITE_API_URL ?? "",
                authToken: import.meta.env.VITE_AUTH_TOKEN ?? "",
              });
              // #region agent log
              fetch("http://127.0.0.1:7302/ingest/9ae87695-32df-419a-9357-f52372e9db89", {
                method: "POST",
                headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "8d61f7" },
                body: JSON.stringify({
                  sessionId: "8d61f7",
                  location: "App.tsx:boot",
                  message: "resume start_sync ok",
                  hypothesisId: "H4",
                  data: { cancelled },
                  timestamp: Date.now(),
                }),
              }).catch(() => {});
              // #endregion
              if (cancelled) return;
              setVaultPath(path);
              setSyncStatus("running");
            } catch (e) {
              // #region agent log
              fetch("http://127.0.0.1:7302/ingest/9ae87695-32df-419a-9357-f52372e9db89", {
                method: "POST",
                headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "8d61f7" },
                body: JSON.stringify({
                  sessionId: "8d61f7",
                  location: "App.tsx:boot",
                  message: "resume start_sync err",
                  hypothesisId: "H3",
                  data: { err: String(e) },
                  timestamp: Date.now(),
                }),
              }).catch(() => {});
              // #endregion
              if (cancelled) return;
              setSyncStatus("idle");
              setVaultPath(null);
              setSyncError(String(e));
            }
          }
        } else {
          setVaultPath(path);
          setSyncStatus("running");
        }
      } catch (err) {
        // #region agent log
        fetch("http://127.0.0.1:7302/ingest/9ae87695-32df-419a-9357-f52372e9db89", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "8d61f7" },
          body: JSON.stringify({
            sessionId: "8d61f7",
            location: "App.tsx:boot",
            message: "boot outer catch",
            hypothesisId: "H3",
            data: { err: String(err) },
            timestamp: Date.now(),
          }),
        }).catch(() => {});
        // #endregion
      }

      if (!cancelled) loadFiles();
    }

    void boot();
    return () => {
      cancelled = true;
    };
  }, [loadFiles]);

  const handleChooseVault = async () => {
    const selected = await openDialog({
      directory: true,
      multiple: false,
      title: "Choose vault folder",
    });
    if (!selected || typeof selected !== "string") return;

    setSyncStatus("starting");
    setSyncError(null);
    try {
      await invoke("start_sync", {
        vaultPath: selected,
        apiUrl: import.meta.env.VITE_API_URL ?? "",
        authToken: import.meta.env.VITE_AUTH_TOKEN ?? "",
      });
      setVaultPath(selected);
      setSyncStatus("running");
      loadFiles();
    } catch (e) {
      setSyncStatus("error");
      setSyncError(String(e));
    }
  };

  const handleAddFiles = async () => {
    const selected = await openDialog({
      directory: false,
      multiple: true,
      title: "Add files to OpenBrain",
    });
    const filePaths = Array.isArray(selected) ? selected : selected ? [selected] : [];
    if (!filePaths.length) return;

    setImportStatus(`Importing ${filePaths.length} file${filePaths.length === 1 ? "" : "s"}...`);
    setSyncError(null);
    try {
      const summary = await invoke<{ imported: number; failed: number }>("import_files", {
        filePaths,
        apiUrl: import.meta.env.VITE_API_URL ?? "",
        authToken: import.meta.env.VITE_AUTH_TOKEN ?? "",
      });
      setImportStatus(
        summary.failed
          ? `Imported ${summary.imported}; ${summary.failed} failed`
          : `Imported ${summary.imported} file${summary.imported === 1 ? "" : "s"} into Inbox`,
      );
      loadFiles();
    } catch (e) {
      setImportStatus(null);
      setSyncError(String(e));
    }
  };

  const handleStopSync = async () => {
    setSyncStatus("stopping");
    try {
      await invoke("stop_sync");
      setVaultPath(null);
      setSyncStatus("idle");
    } catch (e) {
      setSyncStatus("error");
      setSyncError(String(e));
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <Header view={view} onViewChange={setView} />
      <SyncBar
        vaultPath={vaultPath}
        status={syncStatus}
        error={syncError}
        importStatus={importStatus}
        onAddFiles={handleAddFiles}
        onChoose={handleChooseVault}
        onStop={handleStopSync}
      />
      <SearchBar
        onSelect={(file) => {
          setSelectedFile(file);
          setView("list");
        }}
      />
      <div style={{ flex: 1, overflow: "hidden" }}>
        {loading && <div style={styles.center}>Loading vault...</div>}
        {error && <div style={{ ...styles.center, color: "#ff6b6b" }}>{error}</div>}
        {!loading && !error && view === "list" && (
          <ListView files={files} selectedFile={selectedFile} onSelect={setSelectedFile} />
        )}
        {!loading && !error && view === "graph" && (
          <GraphView
            files={files}
            onSelect={(file) => {
              setSelectedFile(file);
              setView("list");
            }}
          />
        )}
        {!loading && !error && view === "review" && (
          <ReviewInbox
            onSelectFile={(file) => {
              setSelectedFile(file);
              setView("list");
            }}
          />
        )}
      </div>
    </div>
  );
}

function SyncBar({
  vaultPath,
  status,
  error,
  importStatus,
  onAddFiles,
  onChoose,
  onStop,
}: {
  vaultPath: string | null;
  status: SyncStatus;
  error: string | null;
  importStatus: string | null;
  onAddFiles: () => void;
  onChoose: () => void;
  onStop: () => void;
}) {
  if (!vaultPath && status === "idle") {
    return (
      <div style={styles.syncBar}>
        <span style={{ color: "#888", fontSize: 13 }}>Cloud vault ready.</span>
        {importStatus && <span style={styles.importStatus}>{importStatus}</span>}
        {error && <span style={{ color: "#ff6b6b", fontSize: 12, marginRight: 8 }}>{error}</span>}
        <button style={styles.primaryBtn} onClick={onAddFiles}>
          Add files
        </button>
        <button style={styles.primaryBtn} onClick={onChoose}>
          Sync folder
        </button>
      </div>
    );
  }

  return (
    <div style={styles.syncBar}>
      <button style={styles.primaryBtn} onClick={onAddFiles}>
        Add files
      </button>
      {importStatus && <span style={styles.importStatus}>{importStatus}</span>}
      <span
        style={{
          fontSize: 12,
          color: "#888",
          flex: 1,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {vaultPath ?? ""}
      </span>
      {error && <span style={{ color: "#ff6b6b", fontSize: 12, marginRight: 8 }}>{error}</span>}
      <span style={{ ...styles.statusDot, background: statusColor(status) }} />
      <span style={{ fontSize: 12, color: "#aaa", marginRight: 8 }}>{statusLabel(status)}</span>
      {(status === "running" || status === "stopping" || status === "error") && (
        <button style={styles.stopBtn} onClick={onStop} disabled={status === "stopping"}>
          Stop
        </button>
      )}
      {status === "idle" && (
        <button style={styles.primaryBtn} onClick={onChoose}>
          Sync folder
        </button>
      )}
    </div>
  );
}

function statusColor(s: SyncStatus) {
  if (s === "running") return "#4caf50";
  if (s === "starting" || s === "stopping") return "#ff9800";
  if (s === "error") return "#ff6b6b";
  return "#555";
}

function statusLabel(s: SyncStatus) {
  if (s === "running") return "Syncing";
  if (s === "starting") return "Starting...";
  if (s === "stopping") return "Stopping...";
  if (s === "error") return "Error";
  return "Stopped";
}

function Header({ view, onViewChange }: { view: ViewMode; onViewChange: (v: ViewMode) => void }) {
  return (
    <div style={styles.header}>
      <span style={styles.logo}>OpenBrain</span>
      <div style={styles.toggle}>
        <button
          style={{ ...styles.toggleBtn, ...(view === "list" ? styles.toggleActive : {}) }}
          onClick={() => onViewChange("list")}
        >
          List
        </button>
        <button
          style={{ ...styles.toggleBtn, ...(view === "graph" ? styles.toggleActive : {}) }}
          onClick={() => onViewChange("graph")}
        >
          Graph
        </button>
        <button
          style={{ ...styles.toggleBtn, ...(view === "review" ? styles.toggleActive : {}) }}
          onClick={() => onViewChange("review")}
        >
          Review
        </button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "12px 20px",
    background: "#161616",
    borderBottom: "1px solid #2a2a2a",
  },
  logo: { fontSize: 18, fontWeight: 700, letterSpacing: -0.5 },
  toggle: { display: "flex", gap: 4, background: "#222", borderRadius: 8, padding: 3 },
  toggleBtn: {
    padding: "5px 14px",
    borderRadius: 6,
    border: "none",
    background: "transparent",
    color: "#aaa",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 500,
  },
  toggleActive: { background: "#333", color: "#fff" },
  center: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
    color: "#888",
  },
  syncBar: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 20px",
    background: "#111",
    borderBottom: "1px solid #222",
    minHeight: 36,
  },
  primaryBtn: {
    padding: "4px 12px",
    borderRadius: 6,
    border: "1px solid #444",
    background: "#222",
    color: "#fff",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 500,
  },
  importStatus: {
    color: "#8ab4ff",
    fontSize: 12,
    marginRight: 8,
  },
  stopBtn: {
    padding: "4px 10px",
    borderRadius: 6,
    border: "1px solid #444",
    background: "transparent",
    color: "#aaa",
    cursor: "pointer",
    fontSize: 12,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: "50%",
    flexShrink: 0,
  },
};

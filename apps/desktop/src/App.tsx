import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { ListView } from "./views/ListView";
import { GraphView } from "./views/GraphView";
import { SearchBar } from "./views/SearchBar";
import type { VaultFile } from "../../../packages/shared/src/types";
import { api } from "./api";

type ViewMode = "list" | "graph";
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

  const loadFiles = useCallback(() => {
    setLoading(true);
    api.files
      .list()
      .then(setFiles)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  // On mount, check if a vault path is already stored in Tauri state.
  useEffect(() => {
    invoke<string | null>("get_vault_path")
      .then((p) => {
        setVaultPath(p);
        if (p) setSyncStatus("running");
      })
      .catch(() => {
        // Tauri not available (e.g. running in browser preview) — continue without sync.
      });
    loadFiles();
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
        onChoose={handleChooseVault}
        onStop={handleStopSync}
      />
      <SearchBar onSelect={setSelectedFile} />
      <div style={{ flex: 1, overflow: "hidden" }}>
        {loading && <div style={styles.center}>Loading vault...</div>}
        {error && <div style={{ ...styles.center, color: "#ff6b6b" }}>{error}</div>}
        {!loading && !error && view === "list" && (
          <ListView files={files} selectedFile={selectedFile} onSelect={setSelectedFile} />
        )}
        {!loading && !error && view === "graph" && (
          <GraphView files={files} onSelect={setSelectedFile} />
        )}
      </div>
    </div>
  );
}

function SyncBar({
  vaultPath,
  status,
  error,
  onChoose,
  onStop,
}: {
  vaultPath: string | null;
  status: SyncStatus;
  error: string | null;
  onChoose: () => void;
  onStop: () => void;
}) {
  if (!vaultPath && status === "idle") {
    return (
      <div style={styles.syncBar}>
        <span style={{ color: "#888", fontSize: 13 }}>No vault connected.</span>
        <button style={styles.primaryBtn} onClick={onChoose}>
          Choose vault folder
        </button>
      </div>
    );
  }

  return (
    <div style={styles.syncBar}>
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
          Choose vault folder
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
      <span style={styles.logo}>🧠 OpenBrain</span>
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

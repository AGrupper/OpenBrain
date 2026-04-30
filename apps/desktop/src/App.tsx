import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { ListView } from "./views/ListView";
import { GraphView } from "./views/GraphView";
import { SearchBar } from "./views/SearchBar";
import {
  SettingsModal,
  applyTheme,
  loadTheme,
  persistTheme,
  type Theme,
} from "./views/SettingsModal";
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

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>(() => loadTheme());

  const loadFiles = useCallback(() => {
    setLoading(true);
    api.files
      .list()
      .then(setFiles)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  // Apply persisted theme on mount.
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

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

  const handleThemeChange = (t: Theme) => {
    setTheme(t);
    persistTheme(t);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <Header view={view} onViewChange={setView} onOpenSettings={() => setSettingsOpen(true)} />
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
        {error && <div style={{ ...styles.center, color: "var(--accent-danger)" }}>{error}</div>}
        {!loading && !error && view === "list" && (
          <ListView
            files={files}
            selectedFile={selectedFile}
            onSelect={setSelectedFile}
            vaultPath={vaultPath}
            onChange={loadFiles}
          />
        )}
        {!loading && !error && view === "graph" && (
          <GraphView files={files} onSelect={setSelectedFile} />
        )}
      </div>
      <SettingsModal
        open={settingsOpen}
        vaultPath={vaultPath}
        apiUrl={(import.meta.env.VITE_API_URL as string) ?? ""}
        authTokenPresent={Boolean(import.meta.env.VITE_AUTH_TOKEN)}
        theme={theme}
        onThemeChange={handleThemeChange}
        onChooseVault={() => {
          setSettingsOpen(false);
          handleChooseVault();
        }}
        onClose={() => setSettingsOpen(false)}
      />
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
      <div className="sync-bar">
        <span style={{ color: "var(--text-secondary)", fontSize: 13 }}>No vault connected.</span>
        <button className="btn-primary" onClick={onChoose}>
          Choose vault folder
        </button>
      </div>
    );
  }

  return (
    <div className="sync-bar">
      <span
        style={{
          fontSize: 12,
          color: "var(--text-secondary)",
          flex: 1,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {vaultPath ?? ""}
      </span>
      {error && (
        <span style={{ color: "var(--accent-danger)", fontSize: 12, marginRight: 8 }}>{error}</span>
      )}
      <span
        className="status-dot"
        style={{ color: statusColor(status), background: statusColor(status) }}
      />
      <span style={{ fontSize: 12, color: "var(--text-muted)", marginRight: 8 }}>
        {statusLabel(status)}
      </span>
      {(status === "running" || status === "stopping" || status === "error") && (
        <button className="btn-stop" onClick={onStop} disabled={status === "stopping"}>
          Stop
        </button>
      )}
      {status === "idle" && (
        <button className="btn-primary" onClick={onChoose}>
          Choose vault folder
        </button>
      )}
    </div>
  );
}

function statusColor(s: SyncStatus) {
  if (s === "running") return "var(--accent-success)";
  if (s === "starting" || s === "stopping") return "var(--accent-warning)";
  if (s === "error") return "var(--accent-danger)";
  return "var(--text-muted)";
}

function statusLabel(s: SyncStatus) {
  if (s === "running") return "Syncing";
  if (s === "starting") return "Starting...";
  if (s === "stopping") return "Stopping...";
  if (s === "error") return "Error";
  return "Stopped";
}

function Header({
  view,
  onViewChange,
  onOpenSettings,
}: {
  view: ViewMode;
  onViewChange: (v: ViewMode) => void;
  onOpenSettings: () => void;
}) {
  return (
    <div className="app-header">
      <span className="app-logo">🧠 OpenBrain</span>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--spacing-3)" }}>
        <div className="toggle-group">
          <button
            className={`toggle-btn ${view === "list" ? "active" : ""}`}
            onClick={() => onViewChange("list")}
          >
            List
          </button>
          <button
            className={`toggle-btn ${view === "graph" ? "active" : ""}`}
            onClick={() => onViewChange("graph")}
          >
            Graph
          </button>
        </div>
        <button className="btn-icon" onClick={onOpenSettings} title="Settings">
          ⚙
        </button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  center: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
    color: "var(--text-secondary)",
    fontSize: 14,
  },
};

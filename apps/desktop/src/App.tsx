import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { ListView } from "./views/ListView";
import { GraphView } from "./views/GraphView";
import { SearchBar } from "./views/SearchBar";
import { ReviewInbox } from "./views/ReviewInbox";
import {
  SettingsModal,
  applyTheme,
  loadTheme,
  persistTheme,
  type Theme,
} from "./views/SettingsModal";
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

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      try {
        let path = await invoke<string | null>("get_vault_path");
        if (cancelled) return;

        if (!path) {
          path = await invoke<string | null>("get_persisted_vault_path");
          if (cancelled) return;
        }

        if (path) {
          setSyncStatus("starting");
          setSyncError(null);
          try {
            await invoke("start_sync", {
              vaultPath: path,
              apiUrl: import.meta.env.VITE_API_URL ?? "",
              authToken: import.meta.env.VITE_AUTH_TOKEN ?? "",
            });
            if (cancelled) return;
            setVaultPath(path);
            setSyncStatus("running");
          } catch (e) {
            if (cancelled) return;
            setVaultPath(null);
            setSyncStatus("idle");
            setSyncError(String(e));
          }
        }
      } catch {
        // Browser preview or missing Tauri runtime; continue with cloud API views.
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

  const handleThemeChange = (t: Theme) => {
    setTheme(t);
    persistTheme(t);
  };

  const selectInReader = (file: VaultFile) => {
    setSelectedFile(file);
    setView("list");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <Header view={view} onViewChange={setView} onOpenSettings={() => setSettingsOpen(true)} />
      <SyncBar
        vaultPath={vaultPath}
        status={syncStatus}
        error={syncError}
        importStatus={importStatus}
        onAddFiles={handleAddFiles}
        onChoose={handleChooseVault}
        onStop={handleStopSync}
      />
      <SearchBar onSelect={selectInReader} />
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
          <GraphView files={files} onSelect={selectInReader} />
        )}
        {!loading && !error && view === "review" && <ReviewInbox onSelectFile={selectInReader} />}
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
          void handleChooseVault();
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
      <div className="sync-bar">
        <span style={{ color: "var(--text-secondary)", fontSize: 13 }}>Cloud vault ready.</span>
        {importStatus && <span style={styles.importStatus}>{importStatus}</span>}
        {error && (
          <span style={{ color: "var(--accent-danger)", fontSize: 12, marginRight: 8 }}>
            {error}
          </span>
        )}
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
          Sync folder
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
      <span className="app-logo">OpenBrain</span>
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
          <button
            className={`toggle-btn ${view === "review" ? "active" : ""}`}
            onClick={() => onViewChange("review")}
          >
            Review
          </button>
        </div>
        <button className="btn-icon" onClick={onOpenSettings} title="Settings">
          Settings
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
  importStatus: {
    color: "var(--accent-primary)",
    fontSize: 12,
    marginRight: 8,
  },
};

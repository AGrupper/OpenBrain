import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { AppHeader, type ViewMode } from "./components/AppHeader";
import { SyncBar, type SyncStatus } from "./components/SyncBar";
import { api } from "./lib/api";
import { GraphView } from "./views/GraphView";
import { ListView } from "./views/ListView";
import { ReviewInbox } from "./views/ReviewInbox";
import { SearchBar } from "./views/SearchBar";
import {
  SettingsModal,
  applyTheme,
  loadTheme,
  persistTheme,
  type Theme,
} from "./views/SettingsModal";
import type { VaultFile } from "../../../packages/shared/src/types";

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

        if (path) await startSync(path, cancelled);
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

  const startSync = async (path: string, cancelled = false) => {
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
      setSyncStatus("error");
      setSyncError(String(e));
    }
  };

  const handleChooseVault = async () => {
    const selected = await openDialog({
      directory: true,
      multiple: false,
      title: "Choose vault folder",
    });
    if (!selected || typeof selected !== "string") return;
    await startSync(selected);
    loadFiles();
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
      setImportStatus(formatImportSummary(summary));
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

  const handleThemeChange = (nextTheme: Theme) => {
    setTheme(nextTheme);
    persistTheme(nextTheme);
  };

  const selectInReader = (file: VaultFile) => {
    setSelectedFile(file);
    setView("list");
  };

  return (
    <div style={styles.shell}>
      <AppHeader view={view} onViewChange={setView} onOpenSettings={() => setSettingsOpen(true)} />
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
      <main style={styles.main}>
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
      </main>
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

function formatImportSummary(summary: { imported: number; failed: number }) {
  if (summary.failed) return `Imported ${summary.imported}; ${summary.failed} failed`;
  return `Imported ${summary.imported} file${summary.imported === 1 ? "" : "s"} into Inbox`;
}

const styles: Record<string, React.CSSProperties> = {
  shell: {
    display: "flex",
    flexDirection: "column",
    height: "100vh",
  },
  main: {
    flex: 1,
    overflow: "hidden",
  },
  center: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
    color: "var(--text-secondary)",
    fontSize: 14,
  },
};

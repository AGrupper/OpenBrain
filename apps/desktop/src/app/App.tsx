import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { ArchitectChat } from "../features/architect-chat/ArchitectChat";
import { GraphView } from "../features/graph/GraphView";
import { ReviewInbox } from "../features/review/ReviewInbox";
import { SearchBar } from "../features/search/SearchBar";
import {
  SettingsModal,
  applyTheme,
  loadTheme,
  persistTheme,
  type Theme,
} from "../features/settings/SettingsModal";
import { ImportBar } from "../features/vault/ImportBar";
import { ListView } from "../features/vault/ListView";
import { api } from "../shared/api/api";
import { AppHeader, type ViewMode } from "../shared/components/AppHeader";
import { PARA_DEFAULT_ROOT, type VaultFile, type VaultFolder } from "@openbrain/shared";

export default function App() {
  const [view, setView] = useState<ViewMode>("list");
  const [files, setFiles] = useState<VaultFile[]>([]);
  const [folders, setFolders] = useState<VaultFolder[]>([]);
  const [selectedFile, setSelectedFile] = useState<VaultFile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>(() => loadTheme());

  const loadFiles = useCallback(() => {
    setLoading(true);
    Promise.all([api.files.list(), api.folders.list()])
      .then(([nextFiles, nextFolders]) => {
        setFiles(nextFiles);
        setFolders(nextFolders);
        setSelectedFile((current) =>
          current ? (nextFiles.find((file) => file.id === current.id) ?? null) : null,
        );
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => loadFiles(), [loadFiles]);

  const handleAddFiles = async (targetFolder?: string | null) => {
    const selected = await openDialog({
      directory: false,
      multiple: true,
      title: "Add files to OpenBrain",
    });
    const filePaths = Array.isArray(selected) ? selected : selected ? [selected] : [];
    if (!filePaths.length) return;

    setImportStatus(`Importing ${filePaths.length} file${filePaths.length === 1 ? "" : "s"}...`);
    setImportError(null);
    try {
      const summary = await invoke<{ imported: number; failed: number }>("import_files", {
        filePaths,
        apiUrl: import.meta.env.VITE_API_URL ?? "",
        authToken: import.meta.env.VITE_AUTH_TOKEN ?? "",
        remoteFolder: targetFolder ?? PARA_DEFAULT_ROOT,
      });
      setImportStatus(formatImportSummary(summary));
      loadFiles();
    } catch (e) {
      setImportStatus(null);
      setImportError(String(e));
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
      <ImportBar error={importError} importStatus={importStatus} onAddFiles={handleAddFiles} />
      <SearchBar onSelect={selectInReader} />
      <main style={styles.main}>
        {loading && <div style={styles.center}>Loading vault...</div>}
        {error && <div style={{ ...styles.center, color: "var(--accent-danger)" }}>{error}</div>}
        {!loading && !error && view === "list" && (
          <ListView
            files={files}
            folders={folders}
            selectedFile={selectedFile}
            onSelect={setSelectedFile}
            onChange={loadFiles}
            onImportFiles={handleAddFiles}
          />
        )}
        {!loading && !error && view === "graph" && (
          <GraphView files={files} onSelect={selectInReader} />
        )}
        {!loading && !error && view === "review" && <ReviewInbox onSelectFile={selectInReader} />}
        {!loading && !error && view === "chat" && <ArchitectChat onSelectFile={selectInReader} />}
      </main>
      <SettingsModal
        open={settingsOpen}
        apiUrl={(import.meta.env.VITE_API_URL as string) ?? ""}
        authTokenPresent={Boolean(import.meta.env.VITE_AUTH_TOKEN)}
        theme={theme}
        onThemeChange={handleThemeChange}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
}

function formatImportSummary(summary: { imported: number; failed: number }) {
  if (summary.failed) return `Imported ${summary.imported}; ${summary.failed} failed`;
  return `Imported ${summary.imported} file${summary.imported === 1 ? "" : "s"}`;
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

import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { join } from "@tauri-apps/api/path";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { readDir, readFile } from "@tauri-apps/plugin-fs";
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
import { AppNavigation, type ViewMode } from "../shared/components/AppNavigation";
import type { SyncSummary, VaultFile, VaultFolder } from "@openbrain/shared";

export default function App() {
  const [view, setView] = useState<ViewMode>("list");
  const [files, setFiles] = useState<VaultFile[]>([]);
  const [deletedFiles, setDeletedFiles] = useState<VaultFile[]>([]);
  const [folders, setFolders] = useState<VaultFolder[]>([]);
  const [selectedFile, setSelectedFile] = useState<VaultFile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [syncBusy, setSyncBusy] = useState<"notion" | "apple_notes" | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>(() => loadTheme());
  const refreshTimers = useRef<number[]>([]);

  const loadFiles = useCallback((options?: { quiet?: boolean }) => {
    if (!options?.quiet) setLoading(true);
    Promise.all([api.files.list(), api.files.deleted(), api.folders.list()])
      .then(([nextFiles, nextDeletedFiles, nextFolders]) => {
        setFiles(nextFiles);
        setDeletedFiles(nextDeletedFiles);
        setFolders(nextFolders);
        setSelectedFile((current) =>
          current
            ? (nextFiles.find((file) => file.id === current.id) ??
              nextDeletedFiles.find((file) => file.id === current.id) ??
              null)
            : null,
        );
      })
      .catch((e) => setError(String(e)))
      .finally(() => {
        if (!options?.quiet) setLoading(false);
      });
  }, []);

  const refreshAfterProcessingChange = useCallback(() => {
    for (const timer of refreshTimers.current) window.clearTimeout(timer);
    loadFiles({ quiet: true });
    refreshTimers.current = [1500, 4000, 8000, 15000].map((delay) =>
      window.setTimeout(() => loadFiles({ quiet: true }), delay),
    );
  }, [loadFiles]);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => loadFiles(), [loadFiles]);

  useEffect(
    () => () => {
      for (const timer of refreshTimers.current) window.clearTimeout(timer);
    },
    [],
  );

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
        remoteFolder: targetFolder ?? null,
      });
      setImportStatus(formatImportSummary(summary));
      refreshAfterProcessingChange();
    } catch (e) {
      setImportStatus(null);
      setImportError(String(e));
    }
  };

  const handleAddUrl = async (sourceUrl: string, targetFolder?: string | null) => {
    setImportStatus("Importing URL...");
    setImportError(null);
    try {
      const file = await api.files.createUrl(sourceUrl, targetFolder);
      setImportStatus(`Imported URL: ${file.path}`);
      setSelectedFile(file);
      setView("list");
      refreshAfterProcessingChange();
    } catch (e) {
      setImportStatus(null);
      setImportError(String(e));
      throw e;
    }
  };

  const handleSyncNotion = async () => {
    if (syncBusy) return;
    setSyncBusy("notion");
    setImportStatus("Syncing Notion...");
    setImportError(null);
    try {
      const summary = await api.sync.runNotion();
      setImportStatus(formatImportSummary(summary, "Notion sync"));
      refreshAfterProcessingChange();
    } catch (e) {
      setImportStatus("Notion sync failed");
      setImportError(formatSyncError(e, "Notion sync"));
    } finally {
      setSyncBusy(null);
    }
  };

  const handleSyncAppleNotes = async () => {
    if (syncBusy) return;
    const selected = await openDialog({
      directory: true,
      multiple: false,
      title: "Choose exported Apple Notes folder",
    });
    if (!selected || Array.isArray(selected)) return;

    setSyncBusy("apple_notes");
    setImportStatus("Reading Apple Notes export...");
    setImportError(null);
    try {
      const files = await collectSyncFiles(selected);
      if (!files.length) {
        setImportStatus("No supported Apple Notes export files found");
        return;
      }
      setImportStatus(
        `Syncing ${files.length} Apple Notes file${files.length === 1 ? "" : "s"}...`,
      );
      const summary = await api.sync.importAppleNotesFiles({
        source_name: selected.split(/[\\/]/).pop() || "Apple Notes Export",
        files,
      });
      setImportStatus(formatImportSummary(summary, "Apple Notes sync"));
      refreshAfterProcessingChange();
    } catch (e) {
      setImportStatus("Apple Notes sync failed");
      setImportError(formatSyncError(e, "Apple Notes sync"));
    } finally {
      setSyncBusy(null);
    }
  };

  const handleExportVault = async () => {
    if (exportBusy) return;
    const selected = await openDialog({
      directory: true,
      multiple: false,
      title: "Choose OpenBrain export folder",
    });
    if (!selected || Array.isArray(selected)) return;

    setExportBusy(true);
    setImportStatus("Exporting vault...");
    setImportError(null);
    try {
      const manifestJson = await buildExportManifest(files, deletedFiles, folders);
      const summary = await invoke<{
        exported: number;
        failed: number;
        manifest_path: string;
        failures: Array<{ path: string; error: string }>;
      }>("export_vault", {
        files: files.map((file) => ({ id: file.id, path: file.path })),
        manifestJson,
        exportDir: selected,
        apiUrl: import.meta.env.VITE_API_URL ?? "",
        authToken: import.meta.env.VITE_AUTH_TOKEN ?? "",
      });
      const failed = summary.failed ? `; ${summary.failed} failed` : "";
      setImportStatus(
        `Exported ${summary.exported} file${summary.exported === 1 ? "" : "s"}${failed}. Manifest: ${summary.manifest_path}`,
      );
      if (summary.failed && summary.failures[0]) {
        setImportError(
          `First export failure: ${summary.failures[0].path} - ${summary.failures[0].error}`,
        );
      }
    } catch (e) {
      setImportStatus("Export failed");
      setImportError(String(e));
    } finally {
      setExportBusy(false);
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
      <AppNavigation
        view={view}
        onViewChange={setView}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <div style={styles.content}>
        <ImportBar
          error={importError}
          folders={folders}
          importStatus={importStatus}
          onAddFiles={handleAddFiles}
          onAddUrl={handleAddUrl}
          onSyncAppleNotes={handleSyncAppleNotes}
          onSyncNotion={handleSyncNotion}
          onExportVault={handleExportVault}
          syncBusy={syncBusy}
          exportBusy={exportBusy}
        />
        <SearchBar onSelect={selectInReader} />
        <main style={styles.main}>
          {loading && <div style={styles.center}>Loading vault...</div>}
          {error && <div style={{ ...styles.center, color: "var(--accent-danger)" }}>{error}</div>}
          {!loading && !error && view === "list" && (
            <ListView
              files={files}
              deletedFiles={deletedFiles}
              folders={folders}
              selectedFile={selectedFile}
              onSelect={setSelectedFile}
              onChange={refreshAfterProcessingChange}
              onImportFiles={handleAddFiles}
            />
          )}
          {!loading && !error && view === "graph" && (
            <GraphView files={files} onSelect={selectInReader} />
          )}
          {!loading && !error && view === "review" && (
            <ReviewInbox onSelectFile={selectInReader} onChange={loadFiles} />
          )}
          {!loading && !error && view === "chat" && <ArchitectChat onSelectFile={selectInReader} />}
        </main>
      </div>
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

function formatImportSummary(
  summary: SyncSummary | { imported: number; failed: number },
  label?: string,
) {
  if (summaryIsSyncSummary(summary)) {
    const total = summary.imported + summary.skipped + summary.failed;
    if (total === 0) {
      return label === "Notion sync"
        ? "Notion sync finished: no matching pages found or no page changes"
        : `${label ?? "Sync"} finished: no matching files found or no changes`;
    }
    return `${label ?? "Sync"}: imported ${summary.imported}, skipped ${summary.skipped}, failed ${summary.failed}`;
  }
  if (summary.failed) return `Imported ${summary.imported}; ${summary.failed} failed`;
  return `Imported ${summary.imported} file${summary.imported === 1 ? "" : "s"}`;
}

function summaryIsSyncSummary(
  summary: SyncSummary | { imported: number; failed: number },
): summary is SyncSummary {
  return "skipped" in summary && typeof summary.skipped === "number";
}

function formatSyncError(error: unknown, label: string): string {
  const message = String(error)
    .replace(/^Error:\s*/, "")
    .replace(/ntn_[A-Za-z0-9_-]+/g, "[redacted_notion_key]")
    .replace(/\s+/g, " ")
    .trim();
  if (/NOTION_API_KEY is not configured/i.test(message)) {
    return "Notion sync is not configured in the running Worker. Restart Worker after editing .dev.vars.";
  }
  const notionApiMatch = message.match(/Notion API failed (\d+):?\s*(.*)$/i);
  if (notionApiMatch) {
    const status = notionApiMatch[1];
    const detail = notionApiMatch[2]?.trim();
    return `${label} failed: Notion API returned ${status}${detail ? ` - ${detail}` : ""}`;
  }
  return `${label} failed: ${message || "Unknown error"}`;
}

async function collectSyncFiles(root: string) {
  const supported = new Set(["md", "markdown", "txt", "html", "htm", "pdf"]);
  const collected: Array<{
    relative_path: string;
    content_base64: string;
    mime: string;
    modified_at?: string | null;
  }> = [];

  async function walk(current: string, relative: string) {
    const entries = await readDir(current);
    for (const entry of entries) {
      const nextPath = await join(current, entry.name);
      const nextRelative = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory) {
        await walk(nextPath, nextRelative);
        continue;
      }
      if (!entry.isFile) continue;
      const ext = entry.name.split(".").pop()?.toLowerCase() ?? "";
      if (!supported.has(ext)) continue;
      const bytes = await readFile(nextPath);
      collected.push({
        relative_path: nextRelative,
        content_base64: bytesToBase64(bytes),
        mime: mimeFromExtension(ext),
        modified_at: null,
      });
    }
  }

  await walk(root, "");
  return collected;
}

async function buildExportManifest(
  files: VaultFile[],
  deletedFiles: VaultFile[],
  folders: VaultFolder[],
): Promise<string> {
  const [links, wikiGraph] = await Promise.all([
    api.links.approved().catch(() => []),
    api.wiki.graph().catch(() => ({ nodes: [], edges: [] })),
  ]);
  const wikiNodeDetails = await Promise.all(
    wikiGraph.nodes.map((node) =>
      api.wiki
        .node(node.id)
        .then((detail) => detail)
        .catch(() => null),
    ),
  );

  return JSON.stringify(
    {
      app: "OpenBrain",
      version: 1,
      exported_at: new Date().toISOString(),
      policy: {
        deleted_files: "excluded",
        deleted_files_excluded: deletedFiles.length,
      },
      folders,
      files,
      links,
      wiki: {
        graph: wikiGraph,
        node_details: wikiNodeDetails.filter(Boolean),
      },
    },
    null,
    2,
  );
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function mimeFromExtension(ext: string): string {
  if (ext === "md" || ext === "markdown") return "text/markdown";
  if (ext === "txt") return "text/plain";
  if (ext === "html" || ext === "htm") return "text/html";
  if (ext === "pdf") return "application/pdf";
  return "application/octet-stream";
}

const styles: Record<string, React.CSSProperties> = {
  shell: {
    display: "flex",
    flexDirection: "row",
    height: "100vh",
  },
  content: {
    minWidth: 0,
    flex: 1,
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

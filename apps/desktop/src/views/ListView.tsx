import { useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import { invoke } from "@tauri-apps/api/core";
import type { VaultFile, Link } from "../../../../packages/shared/src/types";
import { api } from "../api";

interface Props {
  files: VaultFile[];
  selectedFile: VaultFile | null;
  onSelect: (f: VaultFile) => void;
  vaultPath: string | null;
  onChange: () => void;
}

export function ListView({ files, selectedFile, onSelect, vaultPath, onChange }: Props) {
  const [currentFolder, setCurrentFolder] = useState<string | null>(null);
  const [links, setLinks] = useState<Link[]>([]);
  const [preview, setPreview] = useState<string | null>(null);

  const folders = [...new Set(files.map((f) => f.folder).filter(Boolean) as string[])].sort();
  const folderFiles = files.filter((f) => (currentFolder ? f.folder === currentFolder : !f.folder));

  useEffect(() => {
    if (!selectedFile) {
      setLinks([]);
      setPreview(null);
      return;
    }
    api.files
      .linksForFile(selectedFile.id)
      .then(setLinks)
      .catch(() => setLinks([]));
    // Load markdown preview if applicable
    if (selectedFile.mime === "text/markdown" || selectedFile.path.endsWith(".md")) {
      fetch(`${import.meta.env.VITE_API_URL}/files/${selectedFile.id}/download`, {
        headers: { Authorization: `Bearer ${import.meta.env.VITE_AUTH_TOKEN}` },
      })
        .then((r) => r.text())
        .then(setPreview)
        .catch(() => setPreview(null));
    } else {
      setPreview(null);
    }
  }, [selectedFile]);

  return (
    <div style={styles.container}>
      {/* Left panel: folder nav + file list */}
      <div style={styles.sidebar}>
        <div
          className="hover-bg"
          style={{ ...styles.folderItem, ...(currentFolder === null ? styles.folderActive : {}) }}
          onClick={() => setCurrentFolder(null)}
        >
          📁 All files
        </div>
        {folders.map((folder) => (
          <div
            key={folder}
            className="hover-bg"
            style={{
              ...styles.folderItem,
              ...(currentFolder === folder ? styles.folderActive : {}),
            }}
            onClick={() => setCurrentFolder(folder)}
          >
            📂 {folder.split("/").pop()}
          </div>
        ))}
        <div style={styles.fileList}>
          {folderFiles.map((file) => (
            <FileRow
              key={file.id}
              file={file}
              selected={selectedFile?.id === file.id}
              onSelect={onSelect}
            />
          ))}
          {folderFiles.length === 0 && <div style={styles.empty}>No files</div>}
        </div>
      </div>

      {/* Right panel: preview + connections */}
      <div style={styles.detail}>
        {selectedFile ? (
          <>
            <div style={styles.filename}>{selectedFile.path.split("/").pop()}</div>
            <div style={styles.meta}>
              {formatSize(selectedFile.size)} · {selectedFile.mime} ·{" "}
              {new Date(selectedFile.updated_at).toLocaleDateString()}
            </div>
            <FileActions
              file={selectedFile}
              files={files}
              vaultPath={vaultPath}
              onChange={onChange}
              onSelect={onSelect}
            />
            {preview && (
              <div className="markdown-body" style={styles.markdown}>
                <ReactMarkdown>{preview}</ReactMarkdown>
              </div>
            )}
            {links.length > 0 && (
              <div style={styles.connections}>
                <div style={styles.connectionsTitle}>Connected files ({links.length})</div>
                {links.map((link) => (
                  <ConnectionRow
                    key={link.id}
                    link={link}
                    currentFileId={selectedFile.id}
                    onSelect={onSelect}
                  />
                ))}
              </div>
            )}
          </>
        ) : (
          <div style={styles.placeholder}>Select a file to preview</div>
        )}
      </div>
    </div>
  );
}

function FileActions({
  file,
  files,
  vaultPath,
  onChange,
  onSelect,
}: {
  file: VaultFile;
  files: VaultFile[];
  vaultPath: string | null;
  onChange: () => void;
  onSelect: (f: VaultFile) => void;
}) {
  const [busy, setBusy] = useState<"open" | "rename" | "delete" | null>(null);

  const handleOpen = async () => {
    if (!vaultPath) return;
    setBusy("open");
    try {
      const sep = vaultPath.includes("\\") && !vaultPath.includes("/") ? "\\" : "/";
      const localized = file.path.replaceAll("/", sep);
      const fullPath = `${vaultPath}${sep}${localized}`;
      await invoke("open_in_default_app", { path: fullPath });
    } catch (e) {
      alert(`Could not open: ${String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const handleRename = async () => {
    const next = window.prompt("New path (relative to vault)", file.path);
    if (!next || next === file.path) return;
    const trimmed = next.trim();
    if (!trimmed) return;
    if (files.some((f) => f.id !== file.id && f.path === trimmed)) {
      alert(`Another file already has the path "${trimmed}".`);
      return;
    }
    setBusy("rename");
    try {
      const updated = await api.files.rename(file.id, trimmed);
      await invoke("force_pull").catch(() => {});
      onChange();
      const renamed = Array.isArray(updated) ? updated[0] : updated;
      if (renamed) onSelect(renamed);
    } catch (e) {
      alert(`Rename failed: ${String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(`Delete "${file.path}"? This removes it from R2 and Supabase.`)) return;
    setBusy("delete");
    try {
      await api.files.delete(file.id);
      await invoke("force_pull").catch(() => {});
      onChange();
    } catch (e) {
      alert(`Delete failed: ${String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div style={styles.actions}>
      <button
        className="btn-action"
        disabled={!vaultPath || busy !== null}
        onClick={handleOpen}
        title={vaultPath ? "Open in OS default app" : "Choose a vault folder first"}
      >
        {busy === "open" ? "Opening…" : "Open in editor"}
      </button>
      <button className="btn-action" disabled={busy !== null} onClick={handleRename}>
        {busy === "rename" ? "Renaming…" : "Rename"}
      </button>
      <button
        className="btn-action btn-action-danger"
        disabled={busy !== null}
        onClick={handleDelete}
      >
        {busy === "delete" ? "Deleting…" : "Delete"}
      </button>
    </div>
  );
}

function FileRow({
  file,
  selected,
  onSelect,
}: {
  file: VaultFile;
  selected: boolean;
  onSelect: (f: VaultFile) => void;
}) {
  const name = file.path.split("/").pop() ?? file.path;
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const icon = extIcon(ext);
  return (
    <div
      className={["file-row", selected ? "selected" : ""].join(" ")}
      style={styles.fileRow}
      onClick={() => onSelect(file)}
    >
      <span style={styles.fileIcon}>{icon}</span>
      <span style={styles.fileName}>{name}</span>
      <span style={styles.fileSize}>{formatSize(file.size)}</span>
    </div>
  );
}

function ConnectionRow({
  link,
  currentFileId,
  onSelect,
}: {
  link: Link;
  currentFileId: string;
  onSelect: (f: VaultFile) => void;
}) {
  const otherId = link.file_a_id === currentFileId ? link.file_b_id : link.file_a_id;
  return (
    <div
      className="conn-row"
      style={styles.connRow}
      onClick={() =>
        api.files
          .get(otherId)
          .then(onSelect)
          .catch(() => {})
      }
    >
      <span>🔗</span>
      <span style={styles.connReason}>{link.reason}</span>
      <span style={styles.connConf}>{Math.round(link.confidence * 100)}%</span>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function extIcon(ext: string): string {
  const map: Record<string, string> = {
    md: "📝",
    pdf: "📄",
    png: "🖼️",
    jpg: "🖼️",
    jpeg: "🖼️",
    mp4: "🎬",
    mp3: "🎵",
    zip: "📦",
    ts: "💻",
    js: "💻",
    py: "🐍",
  };
  return map[ext] ?? "📄";
}

const styles: Record<string, React.CSSProperties> = {
  container: { display: "flex", height: "100%", overflow: "hidden", background: "var(--bg-base)" },
  sidebar: {
    width: 300,
    borderRight: "1px solid var(--border-color)",
    overflowY: "auto",
    padding: "var(--spacing-3) 0",
    background: "var(--bg-surface)",
  },
  folderItem: {
    padding: "var(--spacing-2) var(--spacing-4)",
    cursor: "pointer",
    fontSize: 13,
    color: "var(--text-secondary)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    transition: "background var(--transition-fast), color var(--transition-fast)",
  },
  folderActive: {
    background: "var(--bg-surface-active)",
    color: "var(--text-primary)",
    fontWeight: 500,
  },
  fileList: { marginTop: "var(--spacing-2)" },
  fileRow: {
    display: "flex",
    alignItems: "center",
    gap: "var(--spacing-2)",
    padding: "var(--spacing-2) var(--spacing-4)",
    cursor: "pointer",
    fontSize: 13,
    transition: "background var(--transition-fast), border var(--transition-fast)",
    borderLeft: "3px solid transparent",
    color: "var(--text-primary)",
  },
  fileIcon: { fontSize: 16, flexShrink: 0 },
  fileName: { flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  fileSize: { color: "var(--text-muted)", fontSize: 11, flexShrink: 0 },
  empty: {
    padding: "var(--spacing-4)",
    color: "var(--text-muted)",
    fontSize: 13,
    textAlign: "center",
  },
  detail: { flex: 1, overflowY: "auto", padding: "var(--spacing-8)", background: "var(--bg-base)" },
  filename: {
    fontSize: 28,
    fontWeight: 700,
    marginBottom: "var(--spacing-2)",
    color: "var(--text-primary)",
    letterSpacing: "-0.02em",
  },
  meta: {
    color: "var(--text-muted)",
    fontSize: 13,
    marginBottom: "var(--spacing-4)",
    display: "flex",
    gap: "var(--spacing-2)",
  },
  actions: {
    display: "flex",
    gap: "var(--spacing-2)",
    marginBottom: "var(--spacing-6)",
    flexWrap: "wrap",
  },
  markdown: {
    background: "var(--bg-surface)",
    borderRadius: "var(--radius-lg)",
    padding: "var(--spacing-6)",
    fontSize: 15,
    lineHeight: 1.8,
    marginBottom: "var(--spacing-6)",
    color: "var(--text-secondary)",
    boxShadow: "var(--shadow-sm)",
    border: "1px solid var(--border-color)",
  },
  connections: { borderTop: "1px solid var(--border-color)", paddingTop: "var(--spacing-6)" },
  connectionsTitle: {
    fontSize: 12,
    fontWeight: 700,
    color: "var(--text-muted)",
    marginBottom: "var(--spacing-3)",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  },
  connRow: {
    display: "flex",
    gap: "var(--spacing-3)",
    padding: "var(--spacing-3) var(--spacing-4)",
    borderRadius: "var(--radius-md)",
    cursor: "pointer",
    fontSize: 14,
    marginBottom: "var(--spacing-2)",
    background: "var(--bg-surface)",
    border: "1px solid var(--border-color)",
    boxShadow: "var(--shadow-sm)",
    alignItems: "center",
  },
  connReason: { flex: 1, color: "var(--text-secondary)" },
  connConf: {
    color: "var(--accent-success)",
    fontWeight: 600,
    fontSize: 13,
    background: "rgba(16, 185, 129, 0.1)",
    padding: "2px 6px",
    borderRadius: "var(--radius-sm)",
  },
  placeholder: { color: "var(--text-muted)", textAlign: "center", marginTop: 100, fontSize: 15 },
};

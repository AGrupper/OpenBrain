import { useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import type { Link, VaultFile } from "../../../../packages/shared/src/types";
import { api } from "../lib/api";

interface Props {
  files: VaultFile[];
  selectedFile: VaultFile | null;
  onSelect: (f: VaultFile) => void;
  onChange: () => void;
}

export function ListView({ files, selectedFile, onSelect, onChange }: Props) {
  const [currentFolder, setCurrentFolder] = useState<string | null>(null);
  const [links, setLinks] = useState<Link[]>([]);
  const [preview, setPreview] = useState<string | null>(null);

  const folders = [...new Set(files.map(effectiveFolder).filter(Boolean) as string[])].sort();
  const folderFiles = currentFolder
    ? files.filter((f) => effectiveFolder(f) === currentFolder)
    : files;

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

    if (isReadableText(selectedFile)) {
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
      <div style={styles.sidebar}>
        <div
          className="hover-bg"
          style={{ ...styles.folderItem, ...(currentFolder === null ? styles.folderActive : {}) }}
          onClick={() => setCurrentFolder(null)}
        >
          All files
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
            {folder}
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

      <div style={styles.detail}>
        {selectedFile ? (
          <>
            <div style={styles.filename}>{selectedFile.path.split("/").pop()}</div>
            <div style={styles.meta}>
              {formatSize(selectedFile.size)} | {selectedFile.mime} |{" "}
              {new Date(selectedFile.updated_at).toLocaleDateString()}
            </div>
            {selectedFile.tags && selectedFile.tags.length > 0 && (
              <div style={styles.tags}>
                {selectedFile.tags.map((tag) => (
                  <span key={tag} style={styles.tag}>
                    {tag}
                  </span>
                ))}
              </div>
            )}
            <FileActions
              file={selectedFile}
              files={files}
              onChange={onChange}
              onSelect={onSelect}
            />
            {preview && (
              <div className="markdown-body" style={styles.markdown}>
                <ReactMarkdown>{preview}</ReactMarkdown>
              </div>
            )}
            {!preview && !isReadableText(selectedFile) && (
              <div style={styles.nonText}>
                Original file preserved. Text extraction and richer previews can be added for this
                file type later.
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
  onChange,
  onSelect,
}: {
  file: VaultFile;
  files: VaultFile[];
  onChange: () => void;
  onSelect: (f: VaultFile) => void;
}) {
  const [busy, setBusy] = useState<"rename" | "delete" | null>(null);

  const handleRename = async () => {
    const next = window.prompt("New path (relative to vault)", file.path);
    if (!next || next === file.path) return;
    const trimmed = next.trim();
    if (!trimmed) return;
    if (files.some((f) => f.id !== file.id && f.path === trimmed)) {
      window.alert(`Another file already has the path "${trimmed}".`);
      return;
    }
    setBusy("rename");
    try {
      const updated = await api.files.rename(file.id, trimmed);
      onChange();
      const renamed = Array.isArray(updated) ? updated[0] : updated;
      if (renamed) onSelect(renamed);
    } catch (e) {
      window.alert(`Rename failed: ${String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(`Delete "${file.path}"? This removes it from R2 and Supabase.`)) return;
    setBusy("delete");
    try {
      await api.files.delete(file.id);
      onChange();
    } catch (e) {
      window.alert(`Delete failed: ${String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div style={styles.actions}>
      <button className="btn-action" disabled={busy !== null} onClick={handleRename}>
        {busy === "rename" ? "Renaming..." : "Rename"}
      </button>
      <button
        className="btn-action btn-action-danger"
        disabled={busy !== null}
        onClick={handleDelete}
      >
        {busy === "delete" ? "Deleting..." : "Delete"}
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
  return (
    <div
      className={["file-row", selected ? "selected" : ""].join(" ")}
      style={styles.fileRow}
      onClick={() => onSelect(file)}
    >
      <span style={styles.fileIcon}>{extIcon(ext)}</span>
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
      <span style={styles.connLabel}>Link</span>
      <span style={styles.connReason}>{link.reason}</span>
      <span style={styles.connConf}>{Math.round(link.confidence * 100)}%</span>
    </div>
  );
}

function effectiveFolder(file: VaultFile): string | null {
  if (file.folder) return file.folder;
  const idx = file.path.lastIndexOf("/");
  return idx > 0 ? file.path.slice(0, idx) : null;
}

function isReadableText(file: VaultFile): boolean {
  const path = file.path.toLowerCase();
  return (
    file.mime.startsWith("text/") ||
    path.endsWith(".md") ||
    path.endsWith(".markdown") ||
    path.endsWith(".txt")
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function extIcon(ext: string): string {
  const map: Record<string, string> = {
    md: "MD",
    markdown: "MD",
    txt: "TXT",
    pdf: "PDF",
    png: "IMG",
    jpg: "IMG",
    jpeg: "IMG",
    mp4: "VID",
    mp3: "AUD",
    zip: "ZIP",
    ts: "TS",
    tsx: "TS",
    js: "JS",
    jsx: "JS",
    py: "PY",
  };
  return map[ext] ?? "FILE";
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
  fileList: {
    marginTop: "var(--spacing-2)",
    borderTop: "1px solid var(--border-color)",
    paddingTop: "var(--spacing-2)",
  },
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
  fileIcon: {
    color: "var(--accent-primary)",
    border: "1px solid var(--border-color)",
    borderRadius: "var(--radius-sm)",
    padding: "1px 4px",
    fontSize: 10,
    fontWeight: 700,
    minWidth: 30,
    textAlign: "center",
    flexShrink: 0,
  },
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
  },
  meta: {
    color: "var(--text-muted)",
    fontSize: 13,
    marginBottom: "var(--spacing-4)",
    display: "flex",
    gap: "var(--spacing-2)",
  },
  tags: { display: "flex", gap: 6, flexWrap: "wrap", marginBottom: "var(--spacing-4)" },
  tag: {
    color: "var(--accent-primary)",
    background: "var(--bg-surface)",
    border: "1px solid var(--border-color)",
    borderRadius: 999,
    padding: "3px 8px",
    fontSize: 12,
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
  nonText: {
    color: "var(--text-secondary)",
    background: "var(--bg-surface)",
    border: "1px solid var(--border-color)",
    borderRadius: "var(--radius-lg)",
    padding: "var(--spacing-6)",
    fontSize: 14,
    marginBottom: "var(--spacing-6)",
  },
  connections: { borderTop: "1px solid var(--border-color)", paddingTop: "var(--spacing-6)" },
  connectionsTitle: {
    fontSize: 12,
    fontWeight: 700,
    color: "var(--text-muted)",
    marginBottom: "var(--spacing-3)",
    textTransform: "uppercase",
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
  connLabel: {
    color: "var(--accent-primary)",
    fontSize: 12,
    fontWeight: 700,
    background: "var(--bg-surface-active)",
    padding: "2px 6px",
    borderRadius: "var(--radius-sm)",
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

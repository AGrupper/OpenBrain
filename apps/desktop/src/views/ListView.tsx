import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import type { Link, VaultFile, VaultFolder } from "../../../../packages/shared/src/types";
import { api } from "../lib/api";

interface Props {
  files: VaultFile[];
  folders: VaultFolder[];
  selectedFile: VaultFile | null;
  onSelect: (f: VaultFile) => void;
  onChange: () => void;
  onImportFiles: (targetFolder?: string | null) => Promise<void>;
}

interface FolderNode {
  path: string | null;
  name: string;
  folders: FolderNode[];
  files: VaultFile[];
}

export function ListView({
  files,
  folders,
  selectedFile,
  onSelect,
  onChange,
  onImportFiles,
}: Props) {
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(["Inbox"]));
  const [links, setLinks] = useState<Link[]>([]);
  const [preview, setPreview] = useState<string | null>(null);
  const tree = useMemo(() => buildExplorerTree(files, folders), [files, folders]);

  useEffect(() => {
    if (!selectedFile) return;
    const folder = effectiveFolder(selectedFile);
    setSelectedFolder(folder);
    if (folder) {
      setExpanded((current) => {
        const next = new Set(current);
        for (const ancestor of folderAncestors(folder)) next.add(ancestor);
        return next;
      });
    }
  }, [selectedFile]);

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
        .then((r) => {
          if (!r.ok) throw new Error(`Download failed: ${r.status}`);
          return r.text();
        })
        .then(setPreview)
        .catch(() => setPreview(null));
    } else {
      setPreview(null);
    }
  }, [selectedFile]);

  const createFolder = async () => {
    const name = window.prompt("Folder name");
    if (!name) return;
    const cleanName = sanitizeChildName(name);
    if (!cleanName) {
      window.alert("Folder name cannot be empty or contain slashes.");
      return;
    }
    const path = joinPath(selectedFolder, cleanName);
    if (folders.some((folder) => folder.path === path) || treeHasFolder(tree, path)) {
      window.alert(`Folder already exists: ${path}`);
      return;
    }

    try {
      await api.folders.create(path);
      setSelectedFolder(path);
      setExpanded((current) => new Set([...current, ...folderAncestors(path)]));
      onChange();
    } catch (e) {
      window.alert(`Create folder failed: ${String(e)}`);
    }
  };

  const createNote = async () => {
    const name = window.prompt("New note name", "Untitled.md");
    if (!name) return;
    const cleanName = ensureMarkdownName(sanitizeChildName(name));
    if (!cleanName) {
      window.alert("Note name cannot be empty or contain slashes.");
      return;
    }
    const path = joinPath(selectedFolder, cleanName);
    if (files.some((file) => file.path === path)) {
      window.alert(`File already exists: ${path}`);
      return;
    }

    try {
      const file = await api.files.createText(path, "");
      setExpanded((current) =>
        selectedFolder ? new Set([...current, ...folderAncestors(selectedFolder)]) : current,
      );
      onSelect(file);
      onChange();
    } catch (e) {
      window.alert(`Create note failed: ${String(e)}`);
    }
  };

  const deleteFolder = async () => {
    if (!selectedFolder) return;
    if (!window.confirm(`Delete empty folder "${selectedFolder}"?`)) return;

    try {
      await api.folders.delete(selectedFolder);
      setSelectedFolder(parentFolder(selectedFolder));
      onChange();
    } catch (e) {
      window.alert(`Delete folder failed: ${String(e)}`);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.sidebar}>
        <div style={styles.toolbar}>
          <button className="btn-action" onClick={createFolder}>
            New folder
          </button>
          <button className="btn-action" onClick={createNote}>
            New note
          </button>
          <button className="btn-action" onClick={() => onImportFiles(selectedFolder)}>
            Add files
          </button>
          {selectedFolder && (
            <button className="btn-action btn-action-danger" onClick={deleteFolder}>
              Delete folder
            </button>
          )}
        </div>
        <div
          className="hover-bg"
          style={{ ...styles.folderRow, ...(selectedFolder === null ? styles.folderActive : {}) }}
          onClick={() => setSelectedFolder(null)}
        >
          <span style={styles.rootIcon}>ROOT</span>
          <span style={styles.folderName}>All files</span>
        </div>
        <div style={styles.tree}>
          {tree.folders.map((folder) => (
            <FolderTreeRow
              key={folder.path}
              folder={folder}
              depth={0}
              selectedFolder={selectedFolder}
              selectedFile={selectedFile}
              expanded={expanded}
              onToggle={(path) =>
                setExpanded((current) => {
                  const next = new Set(current);
                  if (next.has(path)) next.delete(path);
                  else next.add(path);
                  return next;
                })
              }
              onSelectFolder={setSelectedFolder}
              onSelectFile={onSelect}
            />
          ))}
          {tree.files.map((file) => (
            <FileRow
              key={file.id}
              file={file}
              depth={0}
              selected={selectedFile?.id === file.id}
              onSelect={onSelect}
            />
          ))}
          {!tree.folders.length && !tree.files.length && <div style={styles.empty}>No files</div>}
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
            <FileActions file={selectedFile} files={files} onChange={onChange} onSelect={onSelect} />
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
          <div style={styles.placeholder}>
            {selectedFolder ? `Selected folder: ${selectedFolder}` : "Select a file to preview"}
          </div>
        )}
      </div>
    </div>
  );
}

function FolderTreeRow({
  folder,
  depth,
  selectedFolder,
  selectedFile,
  expanded,
  onToggle,
  onSelectFolder,
  onSelectFile,
}: {
  folder: FolderNode;
  depth: number;
  selectedFolder: string | null;
  selectedFile: VaultFile | null;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onSelectFolder: (path: string) => void;
  onSelectFile: (file: VaultFile) => void;
}) {
  const path = folder.path ?? "";
  const isExpanded = expanded.has(path);
  const hasChildren = folder.folders.length > 0 || folder.files.length > 0;

  return (
    <>
      <div
        className="hover-bg"
        style={{
          ...styles.folderRow,
          ...(selectedFolder === folder.path ? styles.folderActive : {}),
          paddingLeft: 12 + depth * 16,
        }}
        onClick={() => folder.path && onSelectFolder(folder.path)}
      >
        <button
          style={styles.disclosure}
          onClick={(event) => {
            event.stopPropagation();
            if (folder.path) onToggle(folder.path);
          }}
          disabled={!hasChildren}
          aria-label={isExpanded ? "Collapse folder" : "Expand folder"}
        >
          {hasChildren ? (isExpanded ? "v" : ">") : ""}
        </button>
        <span style={styles.folderIcon}>DIR</span>
        <span style={styles.folderName}>{folder.name}</span>
      </div>
      {isExpanded &&
        folder.folders.map((child) => (
          <FolderTreeRow
            key={child.path}
            folder={child}
            depth={depth + 1}
            selectedFolder={selectedFolder}
            selectedFile={selectedFile}
            expanded={expanded}
            onToggle={onToggle}
            onSelectFolder={onSelectFolder}
            onSelectFile={onSelectFile}
          />
        ))}
      {isExpanded &&
        folder.files.map((file) => (
          <FileRow
            key={file.id}
            file={file}
            depth={depth + 1}
            selected={selectedFile?.id === file.id}
            onSelect={onSelectFile}
          />
        ))}
    </>
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
    const trimmed = normalizeRelativePath(next);
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
  depth,
  selected,
  onSelect,
}: {
  file: VaultFile;
  depth: number;
  selected: boolean;
  onSelect: (f: VaultFile) => void;
}) {
  const name = file.path.split("/").pop() ?? file.path;
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return (
    <div
      className={["file-row", selected ? "selected" : ""].join(" ")}
      style={{ ...styles.fileRow, paddingLeft: 12 + depth * 16 }}
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

function buildExplorerTree(files: VaultFile[], folders: VaultFolder[]): FolderNode {
  const root: FolderNode = { path: null, name: "All files", folders: [], files: [] };
  const nodes = new Map<string, FolderNode>();

  const ensureFolder = (path: string | null): FolderNode => {
    if (!path) return root;
    const existing = nodes.get(path);
    if (existing) return existing;

    const node: FolderNode = {
      path,
      name: path.split("/").pop() ?? path,
      folders: [],
      files: [],
    };
    nodes.set(path, node);

    const parent = parentFolder(path);
    ensureFolder(parent).folders.push(node);
    return node;
  };

  for (const folder of folders) ensureFolder(normalizeRelativePath(folder.path));
  for (const file of files) {
    const folder = effectiveFolder(file);
    if (folder) ensureFolder(folder).files.push(file);
    else root.files.push(file);
  }

  const sortNode = (node: FolderNode) => {
    node.folders.sort((a, b) => a.name.localeCompare(b.name));
    node.files.sort((a, b) => fileName(a).localeCompare(fileName(b)));
    node.folders.forEach(sortNode);
  };
  sortNode(root);
  return root;
}

function treeHasFolder(node: FolderNode, path: string): boolean {
  if (node.path === path) return true;
  return node.folders.some((folder) => treeHasFolder(folder, path));
}

function effectiveFolder(file: VaultFile): string | null {
  if (file.folder) return normalizeRelativePath(file.folder);
  const idx = file.path.lastIndexOf("/");
  return idx > 0 ? normalizeRelativePath(file.path.slice(0, idx)) : null;
}

function folderAncestors(path: string): string[] {
  const parts = path.split("/");
  return parts.map((_, index) => parts.slice(0, index + 1).join("/"));
}

function parentFolder(path: string): string | null {
  const idx = path.lastIndexOf("/");
  return idx > 0 ? path.slice(0, idx) : null;
}

function joinPath(folder: string | null, child: string): string {
  return folder ? `${folder}/${child}` : child;
}

function fileName(file: VaultFile): string {
  return file.path.split("/").pop() ?? file.path;
}

function normalizeRelativePath(input: string): string {
  return input
    .replaceAll("\\", "/")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean)
    .join("/");
}

function sanitizeChildName(input: string): string {
  const trimmed = input.trim();
  if (!trimmed || trimmed.includes("/") || trimmed.includes("\\")) return "";
  return trimmed.replace(/[<>:"|?*]/g, "-").replace(/[\u0000-\u001f]/g, "-").trim();
}

function ensureMarkdownName(name: string): string {
  if (!name) return "";
  const lower = name.toLowerCase();
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return name;
  return `${name}.md`;
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
    width: 340,
    borderRight: "1px solid var(--border-color)",
    overflowY: "auto",
    padding: "var(--spacing-3) 0",
    background: "var(--bg-surface)",
  },
  toolbar: {
    display: "flex",
    gap: "var(--spacing-2)",
    flexWrap: "wrap",
    padding: "0 var(--spacing-3) var(--spacing-3)",
    borderBottom: "1px solid var(--border-color)",
    marginBottom: "var(--spacing-2)",
  },
  tree: { paddingBottom: "var(--spacing-4)" },
  folderRow: {
    display: "flex",
    alignItems: "center",
    gap: "var(--spacing-2)",
    padding: "var(--spacing-2) var(--spacing-3)",
    cursor: "pointer",
    fontSize: 13,
    color: "var(--text-secondary)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    transition: "background var(--transition-fast), color var(--transition-fast)",
  },
  folderActive: {
    background: "var(--bg-surface-active)",
    color: "var(--text-primary)",
    fontWeight: 600,
  },
  disclosure: {
    width: 18,
    height: 18,
    border: "none",
    background: "transparent",
    color: "var(--text-muted)",
    cursor: "pointer",
    padding: 0,
    flexShrink: 0,
    fontSize: 12,
  },
  rootIcon: {
    color: "var(--accent-primary)",
    border: "1px solid var(--border-color)",
    borderRadius: "var(--radius-sm)",
    padding: "1px 4px",
    fontSize: 10,
    fontWeight: 700,
    minWidth: 34,
    textAlign: "center",
    flexShrink: 0,
  },
  folderIcon: {
    color: "var(--accent-warning)",
    border: "1px solid var(--border-color)",
    borderRadius: "var(--radius-sm)",
    padding: "1px 4px",
    fontSize: 10,
    fontWeight: 700,
    minWidth: 30,
    textAlign: "center",
    flexShrink: 0,
  },
  folderName: { flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  fileRow: {
    display: "flex",
    alignItems: "center",
    gap: "var(--spacing-2)",
    padding: "var(--spacing-2) var(--spacing-3)",
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

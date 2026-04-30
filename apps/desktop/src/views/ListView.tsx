import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import type { Link, VaultFile } from "../../../../packages/shared/src/types";
import { api } from "../api";

interface Props {
  files: VaultFile[];
  selectedFile: VaultFile | null;
  onSelect: (f: VaultFile) => void;
}

export function ListView({ files, selectedFile, onSelect }: Props) {
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
          style={{ ...styles.folderItem, ...(currentFolder === null ? styles.folderActive : {}) }}
          onClick={() => setCurrentFolder(null)}
        >
          All files
        </div>
        {folders.map((folder) => (
          <div
            key={folder}
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
            {preview && (
              <div style={styles.markdown}>
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
      style={{ ...styles.fileRow, ...(selected ? styles.fileRowSelected : {}) }}
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
  container: { display: "flex", height: "100%", overflow: "hidden" },
  sidebar: { width: 300, borderRight: "1px solid #2a2a2a", overflowY: "auto", padding: "12px 0" },
  folderItem: {
    padding: "8px 16px",
    cursor: "pointer",
    fontSize: 13,
    color: "#aaa",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  folderActive: { background: "#1e1e1e", color: "#fff" },
  fileList: { marginTop: 8, borderTop: "1px solid #222", paddingTop: 8 },
  fileRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 16px",
    cursor: "pointer",
    fontSize: 13,
  },
  fileRowSelected: { background: "#1e3a5f" },
  fileIcon: {
    color: "#8ab4ff",
    border: "1px solid #2a3d5e",
    borderRadius: 4,
    padding: "1px 4px",
    fontSize: 10,
    fontWeight: 700,
    minWidth: 30,
    textAlign: "center",
    flexShrink: 0,
  },
  fileName: { flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  fileSize: { color: "#666", fontSize: 11, flexShrink: 0 },
  empty: { padding: "16px", color: "#555", fontSize: 13 },
  detail: { flex: 1, overflowY: "auto", padding: 24 },
  filename: { fontSize: 20, fontWeight: 600, marginBottom: 6 },
  meta: { color: "#666", fontSize: 12, marginBottom: 16 },
  tags: { display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 },
  tag: {
    color: "#9ec5ff",
    background: "#152033",
    border: "1px solid #263b5c",
    borderRadius: 999,
    padding: "3px 8px",
    fontSize: 12,
  },
  markdown: {
    background: "#111",
    borderRadius: 8,
    padding: 16,
    fontSize: 14,
    lineHeight: 1.7,
    marginBottom: 20,
  },
  nonText: {
    color: "#888",
    background: "#111",
    border: "1px solid #252525",
    borderRadius: 8,
    padding: 16,
    fontSize: 14,
    marginBottom: 20,
  },
  connections: { borderTop: "1px solid #2a2a2a", paddingTop: 16 },
  connectionsTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: "#888",
    marginBottom: 10,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  connRow: {
    display: "flex",
    gap: 8,
    padding: "8px 12px",
    borderRadius: 6,
    cursor: "pointer",
    fontSize: 13,
    marginBottom: 4,
    background: "#111",
  },
  connLabel: { color: "#8ab4ff", fontSize: 12, fontWeight: 700 },
  connReason: { flex: 1, color: "#ccc" },
  connConf: { color: "#4ade80", fontWeight: 600, fontSize: 12 },
  placeholder: { color: "#555", textAlign: "center", marginTop: 80 },
};

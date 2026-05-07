import { type CSSProperties, useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import {
  type Link,
  isParaRoot,
  PARA_DEFAULT_ROOT,
  PARA_ROOTS,
  paraRootDescription,
  type VaultFile,
  type VaultFolder,
} from "@openbrain/shared";
import { api } from "../../shared/api/api";

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
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(PARA_ROOTS));
  const [links, setLinks] = useState<Link[]>([]);
  const [preview, setPreview] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [newNoteName, setNewNoteName] = useState("Untitled.md");
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState<"folder" | "note" | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [processingNow, setProcessingNow] = useState(false);
  const [processingError, setProcessingError] = useState<string | null>(null);
  const tree = useMemo(() => buildExplorerTree(files, folders), [files, folders]);
  const creationTarget = selectedFolder ?? PARA_DEFAULT_ROOT;
  const canEditSelected = selectedFile ? isMarkdownFile(selectedFile) : false;
  const isDirty = editing && draft !== (preview ?? "");

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
      setEditing(false);
      setDraft("");
      setSaveError(null);
      setProcessingError(null);
      return;
    }
    setEditing(false);
    setDraft("");
    setSaveError(null);
    setProcessingError(null);
    api.files
      .linksForFile(selectedFile.id)
      .then(setLinks)
      .catch(() => setLinks([]));

    if (selectedFile.text_content) {
      setPreview(selectedFile.text_content);
    } else if (isReadableText(selectedFile)) {
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

  const confirmDiscard = () => !isDirty || window.confirm("Discard unsaved changes to this note?");

  const selectFile = (file: VaultFile) => {
    if (!confirmDiscard()) return;
    onSelect(file);
  };

  const createFolder = async () => {
    const cleanName = sanitizeChildName(newFolderName);
    if (!cleanName) {
      setCreateError("Folder name cannot be empty or contain slashes.");
      return;
    }
    const path = joinPath(creationTarget, cleanName);
    if (folders.some((folder) => folder.path === path) || treeHasFolder(tree, path)) {
      setCreateError(`Folder already exists: ${path}`);
      return;
    }

    setCreating("folder");
    setCreateError(null);
    try {
      await api.folders.create(path);
      setSelectedFolder(path);
      setExpanded((current) => new Set([...current, ...folderAncestors(path)]));
      setNewFolderName("");
      onChange();
    } catch (e) {
      setCreateError(`Create folder failed: ${String(e)}`);
    } finally {
      setCreating(null);
    }
  };

  const createNote = async () => {
    if (!confirmDiscard()) return;
    const cleanName = ensureMarkdownName(sanitizeChildName(newNoteName));
    if (!cleanName) {
      setCreateError("Note name cannot be empty or contain slashes.");
      return;
    }
    const path = joinPath(creationTarget, cleanName);
    if (files.some((file) => file.path === path)) {
      setCreateError(`File already exists: ${path}`);
      return;
    }

    setCreating("note");
    setCreateError(null);
    try {
      const file = await api.files.createText(path, "");
      setExpanded((current) => new Set([...current, ...folderAncestors(creationTarget)]));
      setNewNoteName("Untitled.md");
      onSelect(file);
      onChange();
    } catch (e) {
      setCreateError(`Create note failed: ${String(e)}`);
    } finally {
      setCreating(null);
    }
  };

  const startEdit = () => {
    setDraft(preview ?? selectedFile?.text_content ?? "");
    setSaveError(null);
    setEditing(true);
  };

  const cancelEdit = () => {
    if (!confirmDiscard()) return;
    setDraft("");
    setSaveError(null);
    setEditing(false);
  };

  const saveDraft = async () => {
    if (!selectedFile) return;
    setSaving(true);
    setSaveError(null);
    try {
      const updated = await api.files.saveText(selectedFile.id, draft);
      const savedFile = Array.isArray(updated) ? updated[0] : updated;
      setPreview(draft);
      setEditing(false);
      setDraft("");
      if (savedFile) onSelect(savedFile);
      onChange();
    } catch (e) {
      setSaveError(`Save failed: ${String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const runProcessingNow = async () => {
    if (!selectedFile) return;
    setProcessingNow(true);
    setProcessingError(null);
    try {
      await api.architect.runJobs({
        file_id: selectedFile.id,
        scopes: pendingJobScopes(selectedFile),
      });
      await onChange();
    } catch (err) {
      setProcessingError(String(err));
    } finally {
      setProcessingNow(false);
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
          <div style={styles.createTarget}>New items: {creationTarget}</div>
          <div style={styles.createRow}>
            <input
              style={styles.createInput}
              value={newFolderName}
              onChange={(event) => setNewFolderName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void createFolder();
              }}
              placeholder="Folder name"
              disabled={creating !== null}
            />
            <button
              className="btn-action"
              onClick={() => void createFolder()}
              disabled={creating !== null}
            >
              {creating === "folder" ? "Creating..." : "New folder"}
            </button>
          </div>
          <div style={styles.createRow}>
            <input
              style={styles.createInput}
              value={newNoteName}
              onChange={(event) => setNewNoteName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void createNote();
              }}
              placeholder="Note name"
              disabled={creating !== null}
            />
            <button
              className="btn-action"
              onClick={() => void createNote()}
              disabled={creating !== null}
            >
              {creating === "note" ? "Creating..." : "New note"}
            </button>
          </div>
          {createError && <div style={styles.createError}>{createError}</div>}
          <button
            className="btn-action"
            onClick={() => onImportFiles(selectedFolder ?? PARA_DEFAULT_ROOT)}
          >
            Add files
          </button>
          {selectedFolder && !isParaRoot(selectedFolder) && (
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
              onSelectFile={selectFile}
            />
          ))}
          {tree.files.map((file) => (
            <FileRow
              key={file.id}
              file={file}
              depth={0}
              selected={selectedFile?.id === file.id}
              onSelect={selectFile}
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
            {selectedFile.source_url && (
              <div style={styles.sourceMeta}>Source URL: {selectedFile.source_url}</div>
            )}
            {selectedFile.tags && selectedFile.tags.length > 0 && (
              <div style={styles.tags}>
                {selectedFile.tags.map((tag) => (
                  <span key={tag} style={styles.tag}>
                    {tag}
                  </span>
                ))}
              </div>
            )}
            <ProcessingState
              file={selectedFile}
              running={processingNow}
              error={processingError}
              onRunNow={() => void runProcessingNow()}
            />
            <FileActions
              file={selectedFile}
              files={files}
              onChange={onChange}
              onSelect={onSelect}
              disabled={editing}
            />
            {canEditSelected && (
              <div style={styles.editorActions}>
                {!editing ? (
                  <button className="btn-action" onClick={startEdit}>
                    Edit
                  </button>
                ) : (
                  <>
                    <button
                      className="btn-action"
                      onClick={() => void saveDraft()}
                      disabled={saving || !isDirty}
                    >
                      {saving ? "Saving..." : "Save"}
                    </button>
                    <button className="btn-action" onClick={cancelEdit} disabled={saving}>
                      Cancel
                    </button>
                    {isDirty && <span style={styles.unsaved}>Unsaved changes</span>}
                  </>
                )}
              </div>
            )}
            {saveError && <div style={styles.saveError}>{saveError}</div>}
            {editing ? (
              <textarea
                style={styles.editor}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                spellCheck
              />
            ) : preview ? (
              <div className="markdown-body" style={styles.markdown}>
                <ReactMarkdown>{preview}</ReactMarkdown>
              </div>
            ) : canEditSelected ? (
              <div style={styles.emptyNote}>Empty note.</div>
            ) : null}
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
                    onSelect={selectFile}
                  />
                ))}
              </div>
            )}
          </>
        ) : (
          <div style={styles.placeholder}>
            {selectedFolder ? folderPlaceholder(selectedFolder) : "Select a file to preview"}
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
        <span style={styles.folderIcon}>
          {folder.path && isParaRoot(folder.path) ? "PARA" : "DIR"}
        </span>
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
  disabled = false,
}: {
  file: VaultFile;
  files: VaultFile[];
  onChange: () => void;
  onSelect: (f: VaultFile) => void;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState<"rename" | "delete" | null>(null);

  const handleRename = async () => {
    if (disabled) return;
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
    if (disabled) return;
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
      <button className="btn-action" disabled={busy !== null || disabled} onClick={handleRename}>
        {busy === "rename" ? "Renaming..." : "Rename"}
      </button>
      <button
        className="btn-action btn-action-danger"
        disabled={busy !== null || disabled}
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
  const pendingCount = pendingProcessingLabels(file).length;
  return (
    <div
      className={["file-row", selected ? "selected" : ""].join(" ")}
      style={{ ...styles.fileRow, paddingLeft: 12 + depth * 16 }}
      onClick={() => onSelect(file)}
    >
      <span style={styles.fileIcon}>{extIcon(ext)}</span>
      <span style={styles.fileName}>{name}</span>
      {pendingCount > 0 && <span style={styles.processingMini}>{pendingCount}</span>}
      <span style={styles.fileSize}>{formatSize(file.size)}</span>
    </div>
  );
}

function ProcessingState({
  file,
  running,
  error,
  onRunNow,
}: {
  file: VaultFile;
  running: boolean;
  error: string | null;
  onRunNow: () => void;
}) {
  const steps = processingSteps(file);
  const pendingCount = steps.filter((step) => step.pending).length;
  return (
    <div style={styles.processingPanel}>
      <div style={styles.processingHeader}>
        <span style={styles.processingTitle}>Processing</span>
        <div style={styles.processingHeaderActions}>
          <span style={pendingCount > 0 ? styles.processingPending : styles.processingReady}>
            {pendingCount > 0 ? `${pendingCount} pending` : "Ready"}
          </span>
          {pendingCount > 0 && (
            <button className="btn-action" onClick={onRunNow} disabled={running}>
              {running ? "Running..." : "Run now"}
            </button>
          )}
        </div>
      </div>
      {error && <div style={styles.processingError}>{error}</div>}
      <div style={styles.processingSteps}>
        {steps.map((step) => (
          <span key={step.key} style={processingStepStyle(step)}>
            {step.label}
          </span>
        ))}
      </div>
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

  for (const paraRoot of PARA_ROOTS) ensureFolder(paraRoot);
  for (const folder of folders) ensureFolder(normalizeRelativePath(folder.path));
  for (const file of files) {
    const folder = effectiveFolder(file);
    if (folder) ensureFolder(folder).files.push(file);
    else root.files.push(file);
  }

  const sortNode = (node: FolderNode) => {
    node.folders.sort(compareFolders);
    node.files.sort((a, b) => fileName(a).localeCompare(fileName(b)));
    node.folders.forEach(sortNode);
  };
  sortNode(root);
  return root;
}

function compareFolders(a: FolderNode, b: FolderNode): number {
  const aPara = a.path && PARA_ROOTS.indexOf(a.path as (typeof PARA_ROOTS)[number]);
  const bPara = b.path && PARA_ROOTS.indexOf(b.path as (typeof PARA_ROOTS)[number]);
  if (typeof aPara === "number" && aPara >= 0 && typeof bPara === "number" && bPara >= 0) {
    return aPara - bPara;
  }
  if (typeof aPara === "number" && aPara >= 0) return -1;
  if (typeof bPara === "number" && bPara >= 0) return 1;
  return a.name.localeCompare(b.name);
}

function folderPlaceholder(path: string): string {
  if (isParaRoot(path)) return `${path}: ${paraRootDescription(path)}`;
  return `Selected folder: ${path}`;
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
  return trimmed
    .replace(/[<>:"|?*]/g, "-")
    .replace(/[\u0000-\u001f]/g, "-")
    .trim();
}

function ensureMarkdownName(name: string): string {
  if (!name) return "";
  const lower = name.toLowerCase();
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return name;
  return `${name}.md`;
}

function isMarkdownFile(file: VaultFile): boolean {
  const path = file.path.toLowerCase();
  return path.endsWith(".md") || path.endsWith(".markdown");
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

function supportsTextExtraction(file: VaultFile): boolean {
  const path = file.path.toLowerCase();
  return (
    isReadableText(file) ||
    path.endsWith(".docx") ||
    file.mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  );
}

function hasExtractedText(file: VaultFile): boolean {
  if (file.extraction_status === "no_text" || file.extraction_status === "failed") return false;
  return typeof file.text_content === "string" && file.text_content.trim().length > 0;
}

function textAvailabilityLabel(file: VaultFile): string {
  if (file.extraction_status === "failed") return "Extraction failed";
  if (file.extraction_status === "no_text") {
    const isEmptyUserText =
      (!file.source_type || file.source_type === "file") &&
      typeof file.text_content === "string" &&
      file.text_content.trim().length === 0;
    return isEmptyUserText ? "Empty text" : "No text extracted";
  }
  if (file.extraction_status === "extracted") return "Text extracted";
  if (hasExtractedText(file)) return "Text extracted";
  if (typeof file.text_content === "string") return "Empty text";
  if (supportsTextExtraction(file)) return "No text extracted";
  return "No text extractor";
}

function canBuildWiki(file: VaultFile): boolean {
  return hasExtractedText(file);
}

function pendingProcessingLabels(file: VaultFile): string[] {
  return processingSteps(file)
    .filter((step) => step.pending)
    .map((step) => step.label);
}

function pendingJobScopes(file: VaultFile): string[] {
  const scopes = new Set<string>();
  for (const step of processingSteps(file)) {
    if (!step.pending) continue;
    if (step.key === "embedding" || step.key === "links") scopes.add("linker");
    if (step.key === "tags") scopes.add("tagger");
    if (step.key === "wiki") scopes.add("wiki");
  }
  return [...scopes];
}

type ProcessingStep = {
  key: string;
  label: string;
  pending: boolean;
  tone?: "ready" | "pending" | "notice";
};

function processingSteps(file: VaultFile): ProcessingStep[] {
  const steps: ProcessingStep[] = [
    {
      key: "original",
      label: "Original stored",
      pending: false,
      tone: "ready",
    },
    {
      key: "text",
      label: textAvailabilityLabel(file),
      pending: false,
      tone: hasExtractedText(file) ? "ready" : "notice",
    },
    {
      key: "embedding",
      label: "Embedding",
      pending: Boolean(file.needs_embedding),
      tone: "pending",
    },
    { key: "links", label: "Links", pending: Boolean(file.needs_linking), tone: "pending" },
    { key: "tags", label: "Tags", pending: Boolean(file.needs_tagging), tone: "pending" },
  ];
  if (canBuildWiki(file)) {
    steps.push({ key: "wiki", label: "Wiki", pending: Boolean(file.needs_wiki), tone: "pending" });
  }
  return steps;
}

function processingStepStyle(step: ProcessingStep): CSSProperties {
  if (step.pending) return styles.processingStepPending;
  if (step.tone === "notice") return styles.processingStepNotice;
  return styles.processingStepReady;
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
    flexDirection: "column",
    padding: "0 var(--spacing-3) var(--spacing-3)",
    borderBottom: "1px solid var(--border-color)",
    marginBottom: "var(--spacing-2)",
  },
  createTarget: {
    color: "var(--text-muted)",
    fontSize: 11,
    fontWeight: 700,
    textTransform: "uppercase",
  },
  createRow: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    gap: "var(--spacing-2)",
    alignItems: "center",
  },
  createInput: {
    minWidth: 0,
    height: 32,
    border: "1px solid var(--border-color)",
    borderRadius: "var(--radius-sm)",
    background: "var(--bg-base)",
    color: "var(--text-primary)",
    padding: "0 var(--spacing-2)",
    fontSize: 12,
    outline: "none",
  },
  createError: {
    color: "var(--accent-danger)",
    background: "rgba(239, 68, 68, 0.08)",
    border: "1px solid rgba(239, 68, 68, 0.25)",
    borderRadius: "var(--radius-sm)",
    padding: "var(--spacing-2)",
    fontSize: 12,
    lineHeight: 1.4,
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
  processingMini: {
    color: "#fed7aa",
    background: "#3b2308",
    border: "1px solid #92400e",
    borderRadius: 999,
    minWidth: 18,
    height: 18,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 10,
    fontWeight: 700,
    flexShrink: 0,
  },
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
  sourceMeta: {
    color: "var(--text-secondary)",
    fontSize: 12,
    marginTop: "-8px",
    marginBottom: "var(--spacing-4)",
    overflowWrap: "anywhere",
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
  processingPanel: {
    border: "1px solid var(--border-color)",
    borderRadius: "var(--radius-md)",
    padding: "var(--spacing-3)",
    marginBottom: "var(--spacing-4)",
    background: "var(--bg-surface)",
  },
  processingHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "var(--spacing-2)",
    marginBottom: "var(--spacing-2)",
  },
  processingHeaderActions: {
    display: "flex",
    alignItems: "center",
    gap: "var(--spacing-2)",
  },
  processingTitle: {
    color: "var(--text-secondary)",
    fontSize: 12,
    fontWeight: 700,
  },
  processingError: {
    color: "var(--accent-danger)",
    fontSize: 12,
    marginBottom: "var(--spacing-2)",
  },
  processingReady: {
    color: "#86efac",
    fontSize: 11,
    fontWeight: 700,
  },
  processingPending: {
    color: "#fed7aa",
    fontSize: 11,
    fontWeight: 700,
  },
  processingSteps: {
    display: "flex",
    flexWrap: "wrap",
    gap: "var(--spacing-2)",
  },
  processingStepReady: {
    color: "#a7f3d0",
    background: "#052e24",
    border: "1px solid #047857",
    borderRadius: "var(--radius-sm)",
    padding: "3px 7px",
    fontSize: 11,
    fontWeight: 700,
  },
  processingStepPending: {
    color: "#fed7aa",
    background: "#3b2308",
    border: "1px solid #92400e",
    borderRadius: "var(--radius-sm)",
    padding: "3px 7px",
    fontSize: 11,
    fontWeight: 700,
  },
  processingStepNotice: {
    color: "var(--text-secondary)",
    background: "var(--bg-surface-hover)",
    border: "1px solid var(--border-color)",
    borderRadius: "var(--radius-sm)",
    padding: "3px 7px",
    fontSize: 11,
    fontWeight: 700,
  },
  actions: {
    display: "flex",
    gap: "var(--spacing-2)",
    marginBottom: "var(--spacing-6)",
    flexWrap: "wrap",
  },
  editorActions: {
    display: "flex",
    alignItems: "center",
    gap: "var(--spacing-2)",
    marginBottom: "var(--spacing-3)",
    flexWrap: "wrap",
  },
  unsaved: { color: "var(--accent-warning)", fontSize: 12, fontWeight: 600 },
  saveError: {
    color: "var(--accent-danger)",
    background: "rgba(239, 68, 68, 0.08)",
    border: "1px solid rgba(239, 68, 68, 0.25)",
    borderRadius: "var(--radius-sm)",
    padding: "var(--spacing-2)",
    fontSize: 12,
    marginBottom: "var(--spacing-3)",
  },
  editor: {
    width: "100%",
    minHeight: 420,
    resize: "vertical",
    background: "var(--bg-surface)",
    color: "var(--text-primary)",
    border: "1px solid var(--border-color)",
    borderRadius: "var(--radius-lg)",
    padding: "var(--spacing-4)",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    fontSize: 14,
    lineHeight: 1.6,
    outline: "none",
    marginBottom: "var(--spacing-6)",
  },
  emptyNote: {
    color: "var(--text-muted)",
    background: "var(--bg-surface)",
    border: "1px solid var(--border-color)",
    borderRadius: "var(--radius-lg)",
    padding: "var(--spacing-6)",
    fontSize: 14,
    marginBottom: "var(--spacing-6)",
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

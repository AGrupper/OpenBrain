import { type CSSProperties, type ReactNode, useEffect, useMemo, useState } from "react";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import ReactMarkdown from "react-markdown";
import { ArchitectPopover } from "../architect-chat/ArchitectPopover";
import {
  type Link,
  isParaRoot,
  PARA_ROOTS,
  type VaultFile,
  type VaultFolder,
  type WikiNode,
} from "@openbrain/shared";
import { api } from "../../shared/api/api";
import {
  AllNotesIcon,
  ChevronIcon,
  ClockIcon,
  FileIcon,
  FolderIcon,
  FolderPlusIcon,
  NotePlusIcon,
  TrashIcon,
  UploadIcon,
} from "../../shared/components/Icons";

interface Props {
  files: VaultFile[];
  deletedFiles: VaultFile[];
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

const GENERAL_SCOPE = "__general_notes__";
const DELETED_SCOPE = "__recently_deleted__";

type SidebarScope = string | null;

export function ListView({
  files,
  deletedFiles,
  folders,
  selectedFile,
  onSelect,
  onChange,
  onImportFiles,
}: Props) {
  const [selectedFolder, setSelectedFolder] = useState<SidebarScope>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(PARA_ROOTS));
  const [links, setLinks] = useState<Link[]>([]);
  const [relatedWikiNodes, setRelatedWikiNodes] = useState<WikiNode[]>([]);
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
  const selectedRealFolder = isRealFolderScope(selectedFolder) ? selectedFolder : null;
  const creationTarget = selectedRealFolder;
  const canEditSelected = selectedFile
    ? isMarkdownFile(selectedFile) && !selectedFile.deleted_at
    : false;
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
      setRelatedWikiNodes([]);
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
    api.wiki
      .nodesForFile(selectedFile.id)
      .then(setRelatedWikiNodes)
      .catch(() => setRelatedWikiNodes([]));

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

  const createFolder = async (rawName = newFolderName) => {
    const cleanName = sanitizeChildName(rawName);
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

  const createNote = async (rawName = newNoteName) => {
    if (!confirmDiscard()) return;
    const cleanName = ensureMarkdownName(sanitizeChildName(rawName));
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
      if (creationTarget) {
        setExpanded((current) => new Set([...current, ...folderAncestors(creationTarget)]));
      }
      setNewNoteName("Untitled.md");
      onSelect(file);
      onChange();
    } catch (e) {
      setCreateError(`Create note failed: ${String(e)}`);
    } finally {
      setCreating(null);
    }
  };

  const promptCreateFolder = () => {
    const name = window.prompt("Folder name");
    if (!name) return;
    void createFolder(name);
  };

  const createUntitledNote = () => {
    void createNote(nextUntitledMarkdownName(files, creationTarget));
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

  const openSourceUrl = async () => {
    const sourceUrl = selectedFile?.source_url;
    if (!sourceUrl) return;
    try {
      const parsed = new URL(sourceUrl);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error("Only http(s) source URLs can be opened.");
      }
      await openExternal(sourceUrl);
    } catch (e) {
      window.alert(`Open source failed: ${String(e)}`);
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
    if (!selectedRealFolder) return;
    if (!window.confirm(`Delete empty folder "${selectedRealFolder}"?`)) return;

    try {
      await api.folders.delete(selectedRealFolder);
      setSelectedFolder(parentFolder(selectedRealFolder));
      onChange();
    } catch (e) {
      window.alert(`Delete folder failed: ${String(e)}`);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.sidebar}>
        <div style={styles.toolbar}>
          <div style={styles.toolbarTitle}>
            <span>Notes</span>
            {creationTarget && <span style={styles.createTarget}>{creationTarget}</span>}
          </div>
          <div style={styles.toolbarActions}>
            <ToolbarIconButton
              title="New folder"
              disabled={creating !== null}
              onClick={promptCreateFolder}
            >
              <FolderPlusIcon size={18} />
            </ToolbarIconButton>
            <ToolbarIconButton
              title="New note"
              disabled={creating !== null}
              onClick={createUntitledNote}
            >
              <NotePlusIcon size={18} />
            </ToolbarIconButton>
            <ToolbarIconButton
              title="Add files from this computer"
              onClick={() => onImportFiles(selectedRealFolder)}
            >
              <UploadIcon size={18} />
            </ToolbarIconButton>
            {selectedRealFolder && !isParaRoot(selectedRealFolder) && (
              <ToolbarIconButton title="Delete selected folder" danger onClick={deleteFolder}>
                <TrashIcon size={18} />
              </ToolbarIconButton>
            )}
          </div>
          {createError && <div style={styles.createError}>{createError}</div>}
        </div>
        <SidebarItem
          label="All Notes"
          count={files.length}
          icon={<AllNotesIcon size={18} />}
          selected={selectedFolder === null}
          onClick={() => setSelectedFolder(null)}
        />
        <SidebarItem
          label="General Notes"
          count={tree.files.length}
          icon={<FolderIcon size={18} />}
          selected={selectedFolder === GENERAL_SCOPE}
          onClick={() => setSelectedFolder(GENERAL_SCOPE)}
        />
        <div style={styles.tree}>
          {selectedFolder === DELETED_SCOPE ? (
            <>
              {deletedFiles.map((file) => (
                <FileRow
                  key={file.id}
                  file={file}
                  depth={0}
                  selected={selectedFile?.id === file.id}
                  onSelect={selectFile}
                />
              ))}
              {!deletedFiles.length && <div style={styles.empty}>No recently deleted notes</div>}
            </>
          ) : selectedFolder === GENERAL_SCOPE ? (
            <>
              {tree.files.map((file) => (
                <FileRow
                  key={file.id}
                  file={file}
                  depth={0}
                  selected={selectedFile?.id === file.id}
                  onSelect={selectFile}
                />
              ))}
              {!tree.files.length && <div style={styles.empty}>No general notes</div>}
            </>
          ) : (
            <>
              <div style={styles.sidebarSectionLabel}>Folders</div>
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
              {!tree.folders.length && !tree.files.length && (
                <div style={styles.empty}>No notes yet</div>
              )}
            </>
          )}
        </div>
        <SidebarItem
          label="Recently Deleted"
          count={deletedFiles.length}
          icon={<ClockIcon size={18} />}
          selected={selectedFolder === DELETED_SCOPE}
          onClick={() => setSelectedFolder(DELETED_SCOPE)}
        />
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
              <div style={styles.sourceMeta}>
                <span style={styles.sourceUrlText}>Source URL: {selectedFile.source_url}</span>
                <button className="btn-action" onClick={() => void openSourceUrl()}>
                  Open source
                </button>
              </div>
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
            {relatedWikiNodes.length > 0 && (
              <div style={styles.connections}>
                <div style={styles.connectionsTitle}>Related wiki ({relatedWikiNodes.length})</div>
                {relatedWikiNodes.map((node) => (
                  <WikiNodeRow key={node.id} node={node} />
                ))}
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
          <div style={styles.placeholder}>{folderPlaceholder(selectedFolder)}</div>
        )}
      </div>
      <ArchitectPopover selectedFile={selectedFile} onSelectFile={onSelect} />
    </div>
  );
}

function SidebarItem({
  label,
  count,
  icon,
  selected,
  onClick,
}: {
  label: string;
  count: number;
  icon: ReactNode;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className="hover-bg"
      style={{ ...styles.sidebarItem, ...(selected ? styles.folderActive : {}) }}
      onClick={onClick}
      title={label}
    >
      <span style={styles.sidebarIcon}>{icon}</span>
      <span style={styles.folderName}>{label}</span>
      <span style={styles.folderCount}>{count}</span>
    </button>
  );
}

function ToolbarIconButton({
  title,
  children,
  disabled,
  danger = false,
  onClick,
}: {
  title: string;
  children: ReactNode;
  disabled?: boolean;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={danger ? "btn-action-danger" : undefined}
      style={{ ...styles.toolbarIconButton, ...(danger ? styles.toolbarIconDanger : {}) }}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
    >
      {children}
    </button>
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
  selectedFolder: SidebarScope;
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
          {hasChildren ? <ChevronIcon open={isExpanded} size={13} /> : null}
        </button>
        <span style={styles.folderIcon}>
          <FolderIcon size={17} />
        </span>
        <span style={styles.folderName}>{folder.name}</span>
        <span style={styles.folderCount}>{countFiles(folder)}</span>
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
  const [busy, setBusy] = useState<"rename" | "delete" | "restore" | "permanent" | null>(null);
  const isDeleted = Boolean(file.deleted_at);

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
    if (!window.confirm(`Move "${file.path}" to Recently Deleted?`)) return;
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

  const handleRestore = async () => {
    setBusy("restore");
    try {
      const restored = await api.files.restore(file.id);
      onChange();
      if (restored) onSelect(restored);
    } catch (e) {
      window.alert(`Restore failed: ${String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const handlePermanentDelete = async () => {
    if (!window.confirm(`Permanently delete "${file.path}"? This removes it from storage.`)) return;
    setBusy("permanent");
    try {
      await api.files.permanentDelete(file.id);
      onChange();
    } catch (e) {
      window.alert(`Permanent delete failed: ${String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  if (isDeleted) {
    return (
      <div style={styles.actions}>
        <button className="btn-action" disabled={busy !== null} onClick={handleRestore}>
          {busy === "restore" ? "Restoring..." : "Restore"}
        </button>
        <button
          className="btn-action btn-action-danger"
          disabled={busy !== null}
          onClick={handlePermanentDelete}
        >
          {busy === "permanent" ? "Deleting..." : "Delete permanently"}
        </button>
      </div>
    );
  }

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
      <span style={styles.fileIcon}>{fileIcon(ext)}</span>
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
  const textStep = steps.find((step) => step.key === "text");
  if (pendingCount === 0 && !error) {
    return (
      <div style={styles.processingCompact}>
        <span style={styles.processingReady}>Ready</span>
        {textStep && <span style={styles.processingMuted}>{textStep.label}</span>}
      </div>
    );
  }
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

function WikiNodeRow({ node }: { node: WikiNode }) {
  return (
    <div className="conn-row" style={styles.wikiNodeRow}>
      <span style={styles.wikiNodeKind}>{node.kind}</span>
      <span style={styles.wikiNodeTitle}>{node.title}</span>
      <span style={styles.wikiNodeStatus}>{node.status}</span>
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

function folderPlaceholder(scope: SidebarScope): string {
  if (scope === GENERAL_SCOPE) return "Select a note from General Notes";
  if (scope === DELETED_SCOPE)
    return "Recently Deleted will show removed notes after soft delete is enabled.";
  if (scope) return `Select a note in ${scope}`;
  return "Select a note to preview";
}

function isRealFolderScope(scope: SidebarScope): scope is string {
  return Boolean(scope && scope !== GENERAL_SCOPE && scope !== DELETED_SCOPE);
}

function countFiles(folder: FolderNode): number {
  return folder.files.length + folder.folders.reduce((sum, child) => sum + countFiles(child), 0);
}

function nextUntitledMarkdownName(files: VaultFile[], folder: string | null): string {
  const existing = new Set(files.map((file) => file.path));
  for (let index = 1; index < 1000; index += 1) {
    const name = index === 1 ? "Untitled.md" : `Untitled ${index}.md`;
    const path = joinPath(folder, name);
    if (!existing.has(path)) return name;
  }
  return `Untitled ${Date.now()}.md`;
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

function fileIcon(ext: string): ReactNode {
  const textLike = new Set(["md", "markdown", "txt"]);
  return textLike.has(ext) ? <AllNotesIcon size={16} /> : <FileIcon size={16} />;
}

const styles: Record<string, React.CSSProperties> = {
  container: { display: "flex", height: "100%", overflow: "hidden", background: "var(--bg-base)" },
  sidebar: {
    width: 310,
    borderRight: "1px solid var(--border-color)",
    overflowY: "auto",
    padding: "var(--spacing-3) 0",
    background: "var(--bg-sidebar)",
  },
  toolbar: {
    display: "flex",
    gap: "var(--spacing-2)",
    flexDirection: "column",
    padding: "0 var(--spacing-3) var(--spacing-3)",
    borderBottom: "1px solid var(--border-color)",
    marginBottom: "var(--spacing-2)",
  },
  toolbarTitle: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "var(--spacing-2)",
    color: "var(--text-primary)",
    fontSize: 16,
    fontWeight: 700,
  },
  toolbarActions: {
    display: "grid",
    gridTemplateColumns: "repeat(4, 34px)",
    gap: "var(--spacing-2)",
    alignItems: "center",
  },
  toolbarIconButton: {
    width: 34,
    height: 32,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "var(--radius-sm)",
    border: "1px solid var(--border-highlight)",
    background: "transparent",
    color: "var(--text-secondary)",
    cursor: "pointer",
    transition: "all var(--transition-fast)",
  },
  toolbarIconDanger: {
    color: "var(--accent-danger)",
  },
  createTarget: {
    color: "var(--text-muted)",
    fontSize: 12,
    fontWeight: 600,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
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
  sidebarSectionLabel: {
    color: "var(--text-muted)",
    fontSize: 11,
    fontWeight: 700,
    textTransform: "uppercase",
    padding: "var(--spacing-3) var(--spacing-3) var(--spacing-1)",
  },
  sidebarItem: {
    width: "100%",
    display: "flex",
    alignItems: "center",
    gap: "var(--spacing-2)",
    padding: "var(--spacing-2) var(--spacing-3)",
    cursor: "pointer",
    border: "none",
    background: "transparent",
    color: "var(--text-secondary)",
    fontSize: 14,
    textAlign: "left",
    transition: "background var(--transition-fast), color var(--transition-fast)",
  },
  sidebarIcon: {
    display: "inline-flex",
    color: "var(--accent-warning)",
    flexShrink: 0,
  },
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
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
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
    display: "inline-flex",
    width: 20,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  folderName: { flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  folderCount: {
    color: "var(--text-muted)",
    fontSize: 12,
    fontWeight: 650,
    flexShrink: 0,
  },
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
    display: "inline-flex",
    width: 20,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  fileName: { flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  fileSize: { color: "var(--text-muted)", fontSize: 11, flexShrink: 0 },
  processingMini: {
    color: "#fed7aa",
    background: "rgba(242, 184, 75, 0.12)",
    border: "1px solid rgba(242, 184, 75, 0.32)",
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
    fontSize: 30,
    fontWeight: 680,
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
    display: "flex",
    alignItems: "center",
    gap: "var(--spacing-2)",
    flexWrap: "wrap",
  },
  sourceUrlText: {
    minWidth: 0,
    flex: 1,
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
    background: "rgba(255, 255, 255, 0.02)",
  },
  processingCompact: {
    display: "flex",
    alignItems: "center",
    gap: "var(--spacing-2)",
    color: "var(--text-muted)",
    fontSize: 12,
    marginBottom: "var(--spacing-4)",
  },
  processingMuted: {
    color: "var(--text-muted)",
    fontSize: 12,
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
    color: "var(--text-secondary)",
    background: "var(--bg-surface-hover)",
    border: "1px solid var(--border-color)",
    borderRadius: "var(--radius-sm)",
    padding: "3px 7px",
    fontSize: 11,
    fontWeight: 700,
  },
  processingStepPending: {
    color: "#fed7aa",
    background: "rgba(242, 184, 75, 0.1)",
    border: "1px solid rgba(242, 184, 75, 0.28)",
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
    background: "rgba(255, 255, 255, 0.02)",
    color: "var(--text-primary)",
    border: "1px solid var(--border-color)",
    borderRadius: "var(--radius-md)",
    padding: "var(--spacing-6)",
    fontFamily: "var(--font-sans)",
    fontSize: 16,
    lineHeight: 1.75,
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
    background: "transparent",
    borderRadius: 0,
    padding: "var(--spacing-2) 0 var(--spacing-6)",
    fontSize: 16,
    lineHeight: 1.8,
    marginBottom: "var(--spacing-6)",
    color: "var(--text-secondary)",
    boxShadow: "none",
    border: "none",
    maxWidth: 860,
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
  wikiNodeRow: {
    display: "flex",
    gap: "var(--spacing-3)",
    padding: "var(--spacing-3) var(--spacing-4)",
    borderRadius: "var(--radius-md)",
    fontSize: 14,
    marginBottom: "var(--spacing-2)",
    background: "var(--bg-surface)",
    border: "1px solid var(--border-color)",
    boxShadow: "var(--shadow-sm)",
    alignItems: "center",
  },
  wikiNodeKind: {
    color: "var(--accent-primary)",
    fontSize: 12,
    fontWeight: 700,
    background: "var(--bg-surface-active)",
    padding: "2px 6px",
    borderRadius: "var(--radius-sm)",
    textTransform: "uppercase",
  },
  wikiNodeTitle: {
    flex: 1,
    color: "var(--text-secondary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  wikiNodeStatus: {
    color: "var(--text-muted)",
    fontWeight: 600,
    fontSize: 12,
    textTransform: "uppercase",
  },
  placeholder: { color: "var(--text-muted)", textAlign: "center", marginTop: 100, fontSize: 15 },
};

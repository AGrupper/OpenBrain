import { useState, type CSSProperties, type FormEvent } from "react";
import { PARA_ROOTS, type VaultFolder } from "@openbrain/shared";
import {
  AllNotesIcon,
  ExportIcon,
  FolderIcon,
  LinkIcon,
  UploadIcon,
} from "../../shared/components/Icons";

interface Props {
  error: string | null;
  folders: VaultFolder[];
  importStatus: string | null;
  onAddFiles: (targetFolder?: string | null) => void;
  onAddUrl: (sourceUrl: string, targetFolder?: string | null) => Promise<void>;
  onSyncAppleNotes: () => Promise<void>;
  onSyncNotion: () => Promise<void>;
  onExportVault: () => Promise<void>;
  syncBusy: "notion" | "apple_notes" | null;
  exportBusy: boolean;
}

export function ImportBar({
  error,
  folders,
  importStatus,
  onAddFiles,
  onAddUrl,
  onSyncAppleNotes,
  onSyncNotion,
  onExportVault,
  syncBusy,
  exportBusy,
}: Props) {
  const [sourceUrl, setSourceUrl] = useState("");
  const [targetFolder, setTargetFolder] = useState("auto");
  const [addingUrl, setAddingUrl] = useState(false);
  const [urlOpen, setUrlOpen] = useState(false);
  const folderOptions = folderTargets(folders);
  const selectedTarget = targetFolder === "auto" ? null : targetFolder;

  const submitUrl = async (event: FormEvent) => {
    event.preventDefault();
    const cleanUrl = sourceUrl.trim();
    if (!cleanUrl || addingUrl) return;
    setAddingUrl(true);
    try {
      await onAddUrl(cleanUrl, selectedTarget);
      setSourceUrl("");
    } catch {
      // The parent owns the user-facing import error state.
    } finally {
      setAddingUrl(false);
    }
  };

  return (
    <div className="import-bar">
      <span style={styles.label}>Cloud vault ready.</span>
      {importStatus && <span style={styles.importStatus}>{importStatus}</span>}
      {error && <span style={styles.error}>{error}</span>}
      <div style={styles.spacer} />
      {urlOpen && (
        <form style={styles.urlForm} onSubmit={(event) => void submitUrl(event)}>
          <input
            style={styles.urlInput}
            value={sourceUrl}
            onChange={(event) => setSourceUrl(event.target.value)}
            placeholder="Webpage, PDF, or YouTube URL"
          />
          <select
            style={styles.folderSelect}
            value={targetFolder}
            onChange={(event) => setTargetFolder(event.target.value)}
            title="URL destination"
          >
            <option value="auto">Auto place</option>
            {folderOptions.map((folder) => (
              <option key={folder} value={folder}>
                {folder}
              </option>
            ))}
          </select>
          <button className="btn-action" type="submit" disabled={!sourceUrl.trim() || addingUrl}>
            {addingUrl ? "Adding..." : "Add"}
          </button>
        </form>
      )}
      <div style={styles.actions}>
        <button
          className="btn-icon"
          onClick={() => setUrlOpen((current) => !current)}
          title="Import URL"
          aria-label="Import URL"
        >
          <LinkIcon size={17} />
        </button>
        <button
          className="btn-primary"
          onClick={() => onAddFiles(selectedTarget)}
          title="Add files from this computer"
          aria-label="Add files from this computer"
          style={styles.iconPrimary}
        >
          <UploadIcon size={17} />
        </button>
        <button
          className="btn-icon"
          onClick={() => void onSyncNotion()}
          title={syncBusy === "notion" ? "Syncing Notion..." : "Sync Notion pages"}
          aria-label="Sync Notion pages"
          disabled={syncBusy !== null}
        >
          <AllNotesIcon size={17} />
        </button>
        <button
          className="btn-icon"
          onClick={() => void onSyncAppleNotes()}
          title={
            syncBusy === "apple_notes" ? "Syncing Apple Notes..." : "Sync Apple Notes export folder"
          }
          aria-label="Sync Apple Notes export folder"
          disabled={syncBusy !== null}
        >
          <FolderIcon size={17} />
        </button>
        <button
          className="btn-icon"
          onClick={() => void onExportVault()}
          title={exportBusy ? "Exporting vault..." : "Export vault backup"}
          aria-label="Export vault backup"
          disabled={exportBusy}
        >
          <ExportIcon size={17} />
        </button>
      </div>
    </div>
  );
}

function folderTargets(folders: VaultFolder[]) {
  return Array.from(new Set([...PARA_ROOTS, ...folders.map((folder) => folder.path)])).sort(
    (a, b) => a.localeCompare(b),
  );
}

const styles: Record<string, CSSProperties> = {
  label: {
    color: "var(--text-primary)",
    fontSize: 13,
    fontWeight: 600,
  },
  help: {
    color: "var(--text-muted)",
    fontSize: 12,
    flex: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  spacer: {
    flex: 1,
  },
  importStatus: {
    color: "var(--text-secondary)",
    fontSize: 12,
    marginRight: 8,
  },
  error: {
    color: "var(--accent-danger)",
    fontSize: 12,
    marginRight: 8,
  },
  urlForm: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    minWidth: 420,
  },
  urlInput: {
    minWidth: 0,
    width: 240,
    height: 30,
    borderRadius: 6,
    border: "1px solid var(--border-color)",
    background: "var(--bg-base)",
    color: "var(--text-primary)",
    padding: "0 10px",
    fontSize: 13,
  },
  folderSelect: {
    width: 170,
    height: 32,
    borderRadius: 6,
    border: "1px solid var(--border-color)",
    background: "var(--bg-base)",
    color: "var(--text-primary)",
    padding: "0 8px",
    fontSize: 13,
  },
  actions: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  iconPrimary: {
    width: 34,
    height: 32,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
  },
};

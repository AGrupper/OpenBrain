import { useState, type CSSProperties, type FormEvent } from "react";
import { PARA_ROOTS, type VaultFolder } from "@openbrain/shared";

interface Props {
  error: string | null;
  folders: VaultFolder[];
  importStatus: string | null;
  onAddFiles: (targetFolder?: string | null) => void;
  onAddUrl: (sourceUrl: string, targetFolder?: string | null) => Promise<void>;
}

export function ImportBar({ error, folders, importStatus, onAddFiles, onAddUrl }: Props) {
  const [sourceUrl, setSourceUrl] = useState("");
  const [targetFolder, setTargetFolder] = useState("auto");
  const [addingUrl, setAddingUrl] = useState(false);
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
      <span style={styles.help}>Add files and URLs; use Auto place or choose a destination.</span>
      {importStatus && <span style={styles.importStatus}>{importStatus}</span>}
      {error && <span style={styles.error}>{error}</span>}
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
          {addingUrl ? "Adding..." : "Add URL"}
        </button>
      </form>
      <button className="btn-primary" onClick={() => onAddFiles(selectedTarget)}>
        Add files
      </button>
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
    color: "var(--text-secondary)",
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
  importStatus: {
    color: "var(--accent-primary)",
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
    minWidth: 480,
  },
  urlInput: {
    minWidth: 0,
    width: 240,
    height: 30,
    borderRadius: 6,
    border: "1px solid var(--border-highlight)",
    background: "var(--bg-surface)",
    color: "var(--text-primary)",
    padding: "0 10px",
    fontSize: 13,
  },
  folderSelect: {
    width: 170,
    height: 32,
    borderRadius: 6,
    border: "1px solid var(--border-highlight)",
    background: "var(--bg-surface)",
    color: "var(--text-primary)",
    padding: "0 8px",
    fontSize: 13,
  },
};

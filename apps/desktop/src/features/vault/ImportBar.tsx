import { useState, type CSSProperties, type FormEvent } from "react";

interface Props {
  error: string | null;
  importStatus: string | null;
  onAddFiles: () => void;
  onAddUrl: (sourceUrl: string) => Promise<void>;
}

export function ImportBar({ error, importStatus, onAddFiles, onAddUrl }: Props) {
  const [sourceUrl, setSourceUrl] = useState("");
  const [addingUrl, setAddingUrl] = useState(false);

  const submitUrl = async (event: FormEvent) => {
    event.preventDefault();
    const cleanUrl = sourceUrl.trim();
    if (!cleanUrl || addingUrl) return;
    setAddingUrl(true);
    try {
      await onAddUrl(cleanUrl);
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
      <span style={styles.help}>
        Add files manually; OpenBrain files default to PARA Resources.
      </span>
      {importStatus && <span style={styles.importStatus}>{importStatus}</span>}
      {error && <span style={styles.error}>{error}</span>}
      <form style={styles.urlForm} onSubmit={(event) => void submitUrl(event)}>
        <input
          style={styles.urlInput}
          value={sourceUrl}
          onChange={(event) => setSourceUrl(event.target.value)}
          placeholder="Webpage, PDF, or YouTube URL"
        />
        <button className="btn-action" type="submit" disabled={!sourceUrl.trim() || addingUrl}>
          {addingUrl ? "Adding..." : "Add URL"}
        </button>
      </form>
      <button className="btn-primary" onClick={onAddFiles}>
        Add files
      </button>
    </div>
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
    minWidth: 320,
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
};

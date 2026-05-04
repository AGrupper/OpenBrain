interface Props {
  error: string | null;
  importStatus: string | null;
  onAddFiles: () => void;
}

export function ImportBar({ error, importStatus, onAddFiles }: Props) {
  return (
    <div className="import-bar">
      <span style={styles.label}>Cloud vault ready.</span>
      <span style={styles.help}>
        Add files manually; OpenBrain files default to PARA Resources.
      </span>
      {importStatus && <span style={styles.importStatus}>{importStatus}</span>}
      {error && <span style={styles.error}>{error}</span>}
      <button className="btn-primary" onClick={onAddFiles}>
        Add files
      </button>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
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
};

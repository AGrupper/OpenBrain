import { useState, type CSSProperties } from "react";
import type { ArchitectChatMessage, ArchitectChatSource, VaultFile } from "@openbrain/shared";
import { api } from "../../shared/api/api";
import { ArchitectIcon } from "../../shared/components/Icons";

interface Props {
  selectedFile: VaultFile | null;
  onSelectFile: (file: VaultFile) => void;
}

interface ChatEntry {
  role: "user" | "architect";
  text: string;
  sources?: ArchitectChatMessage["sources"];
}

export function ArchitectPopover({ selectedFile, onSelectFile }: Props) {
  const [open, setOpen] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ask = async () => {
    const message = input.trim();
    if (!message || busy) return;

    setInput("");
    setError(null);
    setBusy(true);
    setEntries((current) => [...current, { role: "user", text: message }]);

    try {
      const response = await api.architect.chat(
        message,
        sessionId ?? undefined,
        selectedFile
          ? {
              current_file_id: selectedFile.id,
              current_path: selectedFile.path,
              current_folder: currentFolder(selectedFile),
              surface: "reader",
            }
          : { surface: "reader" },
      );
      setSessionId(response.session_id);
      setEntries((current) => [
        ...current,
        { role: "architect", text: response.answer, sources: response.sources },
      ]);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={styles.root}>
      {open && (
        <section style={styles.panel}>
          <div style={styles.header}>
            <div>
              <div style={styles.title}>The Architect</div>
              <div style={styles.subtitle}>
                {selectedFile ? `Reading ${fileName(selectedFile)}` : "Ask about the vault"}
              </div>
            </div>
            <button className="btn-icon" onClick={() => setOpen(false)} title="Close">
              x
            </button>
          </div>
          <div style={styles.thread}>
            {entries.length === 0 && (
              <div style={styles.empty}>
                Ask about the selected note. The current file is searched first.
              </div>
            )}
            {entries.map((entry, index) => (
              <div
                key={`${entry.role}-${index}`}
                style={{
                  ...styles.message,
                  ...(entry.role === "user" ? styles.userMessage : styles.architectMessage),
                }}
              >
                <div style={styles.role}>{entry.role === "user" ? "You" : "Architect"}</div>
                <div style={styles.text}>{entry.text}</div>
                {entry.sources && entry.sources.length > 0 && (
                  <div style={styles.sources}>
                    {entry.sources.map((source) => (
                      <button
                        key={`${source.evidence_scope ?? "source"}-${source.wiki_node_id ?? source.file_id}-${source.path}`}
                        style={styles.source}
                        onClick={() =>
                          api.files
                            .get(source.file_id)
                            .then(onSelectFile)
                            .catch(() => {})
                        }
                        title={source.snippet}
                      >
                        <span style={styles.sourceKind}>{formatSourceKind(source)}</span>
                        <span style={styles.sourceTitle}>{source.title ?? source.path}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
          {error && <div style={styles.error}>{error}</div>}
          <form
            style={styles.composer}
            onSubmit={(event) => {
              event.preventDefault();
              void ask();
            }}
          >
            <input
              style={styles.input}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={selectedFile ? "Ask about this note..." : "Ask The Architect..."}
              disabled={busy}
            />
            <button className="btn-primary" type="submit" disabled={busy || !input.trim()}>
              {busy ? "..." : "Ask"}
            </button>
          </form>
        </section>
      )}
      <button
        style={styles.floatingButton}
        onClick={() => setOpen((current) => !current)}
        title="Ask The Architect"
        aria-label="Ask The Architect"
      >
        <ArchitectIcon size={22} />
      </button>
    </div>
  );
}

function fileName(file: VaultFile): string {
  return file.path.split("/").pop() ?? file.path;
}

function formatSourceKind(source: ArchitectChatSource): string {
  if (source.evidence_scope === "current_file") return "Current file";
  if (source.evidence_scope === "current_folder") return "Current folder";
  if (source.evidence_scope === "wiki_digest") return "Wiki digest";
  return source.source_kind === "wiki" ? "Wiki" : "Vault file";
}

function currentFolder(file: VaultFile): string | null {
  if (file.folder) return file.folder;
  const idx = file.path.lastIndexOf("/");
  return idx > 0 ? file.path.slice(0, idx) : null;
}

const styles: Record<string, CSSProperties> = {
  root: {
    position: "fixed",
    right: 24,
    bottom: 24,
    zIndex: 120,
  },
  floatingButton: {
    width: 52,
    height: 52,
    borderRadius: "50%",
    border: "1px solid var(--border-highlight)",
    background: "var(--accent-primary)",
    color: "#fff",
    boxShadow: "0 10px 26px rgba(0, 0, 0, 0.28)",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  },
  panel: {
    width: 430,
    height: 560,
    marginBottom: "var(--spacing-3)",
    border: "1px solid var(--border-highlight)",
    borderRadius: "var(--radius-lg)",
    background: "var(--bg-glass)",
    boxShadow: "var(--shadow-lg)",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  header: {
    padding: "var(--spacing-4)",
    borderBottom: "1px solid var(--border-color)",
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: "var(--spacing-3)",
  },
  title: {
    color: "var(--text-primary)",
    fontSize: 16,
    fontWeight: 700,
  },
  subtitle: {
    color: "var(--text-muted)",
    fontSize: 12,
    marginTop: 2,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    maxWidth: 330,
  },
  thread: {
    flex: 1,
    overflowY: "auto",
    padding: "var(--spacing-4)",
    display: "flex",
    flexDirection: "column",
    gap: "var(--spacing-3)",
  },
  empty: {
    color: "var(--text-muted)",
    fontSize: 13,
  },
  message: {
    border: "1px solid var(--border-color)",
    borderRadius: "var(--radius-md)",
    padding: "var(--spacing-3)",
    fontSize: 13,
  },
  userMessage: {
    background: "rgba(139, 124, 246, 0.12)",
    alignSelf: "flex-end",
    maxWidth: "88%",
  },
  architectMessage: {
    background: "transparent",
    alignSelf: "stretch",
  },
  role: {
    color: "var(--text-muted)",
    fontSize: 10,
    fontWeight: 800,
    textTransform: "uppercase",
    marginBottom: "var(--spacing-1)",
  },
  text: {
    color: "var(--text-primary)",
    whiteSpace: "pre-wrap",
    lineHeight: 1.55,
  },
  sources: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--spacing-2)",
    marginTop: "var(--spacing-3)",
  },
  source: {
    display: "flex",
    alignItems: "center",
    gap: "var(--spacing-2)",
    minWidth: 0,
    border: "1px solid var(--border-color)",
    background: "var(--bg-surface)",
    color: "var(--text-primary)",
    borderRadius: "var(--radius-sm)",
    padding: "6px 8px",
    cursor: "pointer",
    textAlign: "left",
  },
  sourceKind: {
    color: "var(--accent-primary)",
    fontSize: 10,
    fontWeight: 800,
    textTransform: "uppercase",
    flexShrink: 0,
  },
  sourceTitle: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: "var(--text-secondary)",
    fontSize: 12,
  },
  composer: {
    display: "flex",
    gap: "var(--spacing-2)",
    padding: "var(--spacing-3)",
    borderTop: "1px solid var(--border-color)",
  },
  input: {
    flex: 1,
    minWidth: 0,
    border: "1px solid var(--border-color)",
    background: "var(--bg-base)",
    color: "var(--text-primary)",
    borderRadius: "var(--radius-sm)",
    padding: "8px 10px",
    fontSize: 13,
    outline: "none",
  },
  error: {
    color: "var(--accent-danger)",
    fontSize: 12,
    padding: "0 var(--spacing-3) var(--spacing-2)",
  },
};

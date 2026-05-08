import { useState } from "react";
import type { ArchitectChatMessage, ArchitectChatSource, VaultFile } from "@openbrain/shared";
import { api } from "../../shared/api/api";

interface Props {
  onSelectFile: (file: VaultFile) => void;
}

interface ChatEntry {
  role: "user" | "architect";
  text: string;
  sources?: ArchitectChatMessage["sources"];
}

export function ArchitectChat({ onSelectFile }: Props) {
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
      const response = await api.architect.chat(message, sessionId ?? undefined);
      setSessionId(response.session_id);
      setEntries((current) => [
        ...current,
        {
          role: "architect",
          text: response.answer,
          sources: response.sources,
        },
      ]);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div>
          <div style={styles.title}>The Architect</div>
          <div style={styles.subtitle}>
            Ask questions that can be answered from your vault. Unsupported answers should be
            refused.
          </div>
        </div>
      </div>

      <div style={styles.thread}>
        {entries.length === 0 && (
          <div style={styles.empty}>
            Ask about files, projects, notes, or connections in the vault.
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
            <div style={styles.messageRole}>{entry.role === "user" ? "You" : "The Architect"}</div>
            <div style={styles.messageText}>{entry.text}</div>
            {entry.sources && entry.sources.length > 0 && (
              <div style={styles.sources}>
                {entry.sources.map((source) => {
                  const title = source.title ?? source.path;
                  const path = source.path !== title ? source.path : null;

                  return (
                    <button
                      key={`${source.source_kind ?? "file"}-${source.wiki_node_id ?? source.file_id}-${source.path}`}
                      style={styles.sourceButton}
                      onClick={() =>
                        api.files
                          .get(source.file_id)
                          .then(onSelectFile)
                          .catch(() => {})
                      }
                      title={source.snippet}
                    >
                      <span style={styles.sourceHeader}>
                        <span style={styles.sourceKind}>{formatSourceKind(source)}</span>
                        <span style={styles.sourceTitle}>{title}</span>
                      </span>
                      {path && <span style={styles.sourcePath}>{path}</span>}
                      <span style={styles.sourceSnippet}>{source.snippet}</span>
                    </button>
                  );
                })}
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
          placeholder="Ask The Architect..."
          disabled={busy}
        />
        <button className="btn-primary" type="submit" disabled={busy || !input.trim()}>
          {busy ? "Asking..." : "Ask"}
        </button>
      </form>
    </div>
  );
}

function formatSourceKind(source: ArchitectChatSource): string {
  if (source.evidence_scope === "current_file") return "Current file";
  if (source.evidence_scope === "current_folder") return "Current folder";
  if (source.evidence_scope === "wiki_digest") return "Wiki digest";
  if (source.source_kind === "wiki") {
    return source.wiki_node_kind ? `Wiki ${source.wiki_node_kind}` : "Wiki";
  }

  return "File";
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    background: "var(--bg-base)",
  },
  header: {
    padding: "var(--spacing-6) var(--spacing-8) var(--spacing-4)",
    borderBottom: "1px solid var(--border-color)",
    background: "transparent",
  },
  title: {
    fontSize: 22,
    fontWeight: 700,
    color: "var(--text-primary)",
  },
  subtitle: {
    marginTop: 4,
    color: "var(--text-muted)",
    fontSize: 13,
  },
  thread: {
    flex: 1,
    overflowY: "auto",
    padding: "var(--spacing-6) var(--spacing-8)",
    display: "flex",
    flexDirection: "column",
    gap: "var(--spacing-3)",
  },
  empty: {
    color: "var(--text-muted)",
    fontSize: 14,
    padding: "var(--spacing-8) 0",
  },
  message: {
    maxWidth: 900,
    borderRadius: "var(--radius-md)",
    border: "1px solid var(--border-color)",
    padding: "var(--spacing-4)",
    boxShadow: "none",
  },
  userMessage: {
    alignSelf: "flex-end",
    background: "rgba(139, 124, 246, 0.12)",
  },
  architectMessage: {
    alignSelf: "flex-start",
    background: "transparent",
  },
  messageRole: {
    color: "var(--text-muted)",
    fontSize: 11,
    fontWeight: 700,
    textTransform: "uppercase",
    marginBottom: "var(--spacing-2)",
  },
  messageText: {
    color: "var(--text-primary)",
    fontSize: 14,
    whiteSpace: "pre-wrap",
    lineHeight: 1.6,
  },
  sources: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--spacing-2)",
    marginTop: "var(--spacing-3)",
  },
  sourceButton: {
    display: "flex",
    flexDirection: "column",
    alignItems: "stretch",
    gap: 4,
    textAlign: "left",
    border: "1px solid var(--border-color)",
    background: "var(--bg-base)",
    color: "var(--text-primary)",
    borderRadius: "var(--radius-md)",
    padding: "8px 10px",
    cursor: "pointer",
    fontSize: 13,
    maxWidth: 620,
  },
  sourceHeader: {
    display: "flex",
    alignItems: "center",
    gap: "var(--spacing-2)",
    minWidth: 0,
  },
  sourceKind: {
    flex: "0 0 auto",
    border: "1px solid var(--border-color)",
    borderRadius: "var(--radius-sm)",
    background: "var(--bg-surface-hover)",
    color: "var(--accent-primary)",
    padding: "2px 6px",
    fontSize: 11,
    fontWeight: 700,
    textTransform: "uppercase",
  },
  sourceTitle: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontWeight: 700,
  },
  sourcePath: {
    color: "var(--text-muted)",
    fontSize: 12,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  sourceSnippet: {
    color: "var(--text-secondary)",
    fontSize: 12,
    lineHeight: 1.45,
  },
  composer: {
    display: "flex",
    gap: "var(--spacing-3)",
    padding: "var(--spacing-4) var(--spacing-8)",
    borderTop: "1px solid var(--border-color)",
    background: "var(--bg-surface)",
  },
  input: {
    flex: 1,
    border: "1px solid var(--border-color)",
    background: "var(--bg-base)",
    color: "var(--text-primary)",
    borderRadius: "var(--radius-sm)",
    padding: "9px 12px",
    fontSize: 14,
    outline: "none",
  },
  error: {
    color: "var(--accent-danger)",
    background: "rgba(239, 68, 68, 0.08)",
    borderTop: "1px solid rgba(239, 68, 68, 0.2)",
    padding: "var(--spacing-3) var(--spacing-8)",
    fontSize: 13,
  },
};

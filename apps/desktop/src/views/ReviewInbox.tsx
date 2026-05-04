import { useCallback, useEffect, useState } from "react";
import type { ArchitectSuggestion, Link, VaultFile } from "../../../../packages/shared/src/types";
import { paraPlacementReason } from "../../../../packages/shared/src/para";
import { api } from "../lib/api";

interface LinkReviewItem {
  kind: "link";
  link: Link;
  fileA: VaultFile | null;
  fileB: VaultFile | null;
}

interface SuggestionReviewItem {
  kind: "suggestion";
  suggestion: ArchitectSuggestion;
  file: VaultFile | null;
}

type ReviewItem = LinkReviewItem | SuggestionReviewItem;

interface Props {
  onSelectFile: (file: VaultFile) => void;
}

export function ReviewInbox({ onSelectFile }: Props) {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [pending, suggestions] = await Promise.all([
        api.links.pending(),
        api.architect.suggestions.pending().catch(() => []),
      ]);
      const hydrated = await Promise.all(
        pending.map(async (link) => {
          const [fileA, fileB] = await Promise.all([
            api.files.get(link.file_a_id).catch(() => null),
            api.files.get(link.file_b_id).catch(() => null),
          ]);
          return { kind: "link" as const, link, fileA, fileB };
        }),
      );
      const hydratedSuggestions = await Promise.all(
        suggestions.map(async (suggestion) => {
          const file = suggestion.file_id
            ? await api.files.get(suggestion.file_id).catch(() => null)
            : null;
          return { kind: "suggestion" as const, suggestion, file };
        }),
      );
      setItems([...hydrated, ...hydratedSuggestions]);
    } catch (e) {
      setError(String(e));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const decideLink = async (id: string, status: "approved" | "rejected") => {
    setBusyId(id);
    try {
      await api.links.update(id, status);
      setItems((current) => current.filter((item) => item.kind !== "link" || item.link.id !== id));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusyId(null);
    }
  };

  const decideSuggestion = async (id: string, status: "approved" | "rejected") => {
    setBusyId(id);
    try {
      await api.architect.suggestions.update(id, status);
      setItems((current) =>
        current.filter((item) => item.kind !== "suggestion" || item.suggestion.id !== id),
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div>
          <div style={styles.title}>Review Inbox</div>
          <div style={styles.subtitle}>
            Approve or reject Architect recommendations before they shape the PARA vault.
          </div>
        </div>
        <button style={styles.secondaryBtn} onClick={load} disabled={loading}>
          Refresh
        </button>
      </div>

      {loading && <div style={styles.empty}>Loading suggestions...</div>}
      {error && <div style={styles.error}>{error}</div>}
      {!loading && !error && items.length === 0 && (
        <div style={styles.empty}>No pending suggestions. New AI proposals will appear here.</div>
      )}

      <div style={styles.list}>
        {items.map((item) =>
          item.kind === "link" ? (
            <LinkCard
              key={item.link.id}
              item={item}
              busy={busyId === item.link.id}
              onSelectFile={onSelectFile}
              onDecide={decideLink}
            />
          ) : (
            <SuggestionCard
              key={item.suggestion.id}
              item={item}
              busy={busyId === item.suggestion.id}
              onSelectFile={onSelectFile}
              onDecide={decideSuggestion}
            />
          ),
        )}
      </div>
    </div>
  );
}

function LinkCard({
  item,
  busy,
  onSelectFile,
  onDecide,
}: {
  item: LinkReviewItem;
  busy: boolean;
  onSelectFile: (file: VaultFile) => void;
  onDecide: (id: string, status: "approved" | "rejected") => void;
}) {
  const { link, fileA, fileB } = item;
  return (
    <div style={styles.card}>
      <div style={styles.cardTop}>
        <button
          style={styles.fileBtn}
          onClick={() => fileA && onSelectFile(fileA)}
          disabled={!fileA}
        >
          {fileA?.path ?? link.file_a_id}
        </button>
        <span style={styles.connector}>linked to</span>
        <button
          style={styles.fileBtn}
          onClick={() => fileB && onSelectFile(fileB)}
          disabled={!fileB}
        >
          {fileB?.path ?? link.file_b_id}
        </button>
      </div>
      <div style={styles.reason}>{link.reason}</div>
      <DecisionFooter
        confidence={link.confidence}
        busy={busy}
        onReject={() => onDecide(link.id, "rejected")}
        onApprove={() => onDecide(link.id, "approved")}
      />
    </div>
  );
}

function SuggestionCard({
  item,
  busy,
  onSelectFile,
  onDecide,
}: {
  item: SuggestionReviewItem;
  busy: boolean;
  onSelectFile: (file: VaultFile) => void;
  onDecide: (id: string, status: "approved" | "rejected") => void;
}) {
  const { suggestion, file } = item;
  const paraHint = paraHintForSuggestion(suggestion);
  return (
    <div style={styles.card}>
      <div style={styles.cardTop}>
        <span style={styles.typeBadge}>{suggestion.type}</span>
        {file && (
          <button style={styles.fileBtn} onClick={() => onSelectFile(file)}>
            {file.path}
          </button>
        )}
      </div>
      <div style={styles.suggestionTitle}>{suggestion.title}</div>
      <div style={styles.reason}>{suggestion.reason}</div>
      {paraHint && <div style={styles.paraHint}>{paraHint}</div>}
      <DecisionFooter
        confidence={suggestion.confidence ?? undefined}
        busy={busy}
        onReject={() => onDecide(suggestion.id, "rejected")}
        onApprove={() => onDecide(suggestion.id, "approved")}
      />
    </div>
  );
}

function paraHintForSuggestion(suggestion: ArchitectSuggestion): string | null {
  if (suggestion.type !== "folder") return null;
  const folder = suggestion.payload.folder;
  if (typeof folder !== "string") return null;
  return paraPlacementReason(folder);
}

function DecisionFooter({
  confidence,
  busy,
  onReject,
  onApprove,
}: {
  confidence?: number;
  busy: boolean;
  onReject: () => void;
  onApprove: () => void;
}) {
  return (
    <div style={styles.footer}>
      <span style={styles.confidence}>
        {typeof confidence === "number"
          ? `${Math.round(confidence * 100)}% confidence`
          : "Needs review"}
      </span>
      <div style={styles.actions}>
        <button style={styles.rejectBtn} onClick={onReject} disabled={busy}>
          Reject
        </button>
        <button style={styles.approveBtn} onClick={onApprove} disabled={busy}>
          Approve
        </button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    height: "100%",
    overflowY: "auto",
    padding: 24,
    background: "#0d0d0d",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    gap: 16,
    alignItems: "flex-start",
    marginBottom: 20,
  },
  title: { fontSize: 20, fontWeight: 700, marginBottom: 4 },
  subtitle: { color: "#888", fontSize: 13 },
  list: { display: "grid", gap: 10, maxWidth: 920 },
  card: {
    background: "#141414",
    border: "1px solid #2a2a2a",
    borderRadius: 8,
    padding: 14,
  },
  cardTop: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" },
  fileBtn: {
    border: "1px solid #333",
    background: "#1e1e1e",
    color: "#e8e8e8",
    borderRadius: 6,
    padding: "5px 8px",
    cursor: "pointer",
    fontSize: 12,
    maxWidth: 320,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  connector: { color: "#777", fontSize: 12 },
  reason: { color: "#ddd", fontSize: 14, lineHeight: 1.5, marginTop: 12 },
  paraHint: {
    color: "#b9c9ff",
    background: "#141f33",
    border: "1px solid #2f4770",
    borderRadius: 6,
    padding: "8px 10px",
    fontSize: 12,
    lineHeight: 1.45,
    marginTop: 10,
  },
  suggestionTitle: {
    color: "#f2f2f2",
    fontSize: 15,
    fontWeight: 700,
    marginTop: 12,
  },
  typeBadge: {
    color: "#8ab4ff",
    border: "1px solid #2f4770",
    background: "#142033",
    borderRadius: 6,
    padding: "4px 8px",
    fontSize: 12,
    fontWeight: 700,
    textTransform: "capitalize",
  },
  footer: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    marginTop: 14,
  },
  confidence: { color: "#8ab4ff", fontSize: 12, fontWeight: 600 },
  actions: { display: "flex", gap: 8 },
  approveBtn: {
    border: "1px solid #2d6a3f",
    background: "#1d4d2d",
    color: "#fff",
    borderRadius: 6,
    padding: "6px 10px",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 600,
  },
  rejectBtn: {
    border: "1px solid #553333",
    background: "#2a1a1a",
    color: "#ddd",
    borderRadius: 6,
    padding: "6px 10px",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 600,
  },
  secondaryBtn: {
    border: "1px solid #444",
    background: "#1a1a1a",
    color: "#fff",
    borderRadius: 6,
    padding: "6px 10px",
    cursor: "pointer",
    fontSize: 12,
  },
  empty: { color: "#666", fontSize: 14, padding: "32px 0" },
  error: {
    color: "#ff8a8a",
    background: "#261515",
    border: "1px solid #512525",
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    fontSize: 13,
  },
};

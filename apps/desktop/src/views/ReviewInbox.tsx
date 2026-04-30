import { useCallback, useEffect, useState } from "react";
import type { Link, VaultFile } from "../../../../packages/shared/src/types";
import { api } from "../lib/api";

interface ReviewItem {
  link: Link;
  fileA: VaultFile | null;
  fileB: VaultFile | null;
}

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
      const pending = await api.links.pending();
      const hydrated = await Promise.all(
        pending.map(async (link) => {
          const [fileA, fileB] = await Promise.all([
            api.files.get(link.file_a_id).catch(() => null),
            api.files.get(link.file_b_id).catch(() => null),
          ]);
          return { link, fileA, fileB };
        }),
      );
      setItems(hydrated);
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

  const decide = async (id: string, status: "approved" | "rejected") => {
    setBusyId(id);
    try {
      await api.links.update(id, status);
      setItems((current) => current.filter((item) => item.link.id !== id));
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
            Approve or reject AI-suggested connections before they shape the vault.
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
        {items.map(({ link, fileA, fileB }) => (
          <div key={link.id} style={styles.card}>
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
            <div style={styles.footer}>
              <span style={styles.confidence}>{Math.round(link.confidence * 100)}% confidence</span>
              <div style={styles.actions}>
                <button
                  style={styles.rejectBtn}
                  onClick={() => decide(link.id, "rejected")}
                  disabled={busyId === link.id}
                >
                  Reject
                </button>
                <button
                  style={styles.approveBtn}
                  onClick={() => decide(link.id, "approved")}
                  disabled={busyId === link.id}
                >
                  Approve
                </button>
              </div>
            </div>
          </div>
        ))}
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

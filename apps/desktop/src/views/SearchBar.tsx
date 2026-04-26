import { useState, useRef, useEffect, useCallback } from "react";
import type { VaultFile, SearchResult } from "../../../../packages/shared/src/types";
import { api } from "../api";

interface Props {
  onSelect: (f: VaultFile) => void;
}

export function SearchBar({ onSelect }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const search = useCallback(async (q: string, limit: number) => {
    if (!q.trim()) { setResults([]); setTotal(0); return; }
    setLoading(true);
    try {
      const { results: r, total: t } = await api.search.query(q, limit);
      setResults(r);
      setTotal(t);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) { setResults([]); setTotal(0); setOpen(false); return; }
    debounceRef.current = setTimeout(() => {
      search(query, 5);
      setOpen(true);
      setShowAll(false);
    }, 300);
  }, [query, search]);

  const handleShowAll = () => {
    setShowAll(true);
    search(query, 50);
  };

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!(e.target as Element).closest("[data-searchbar]")) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div data-searchbar="" style={styles.wrapper}>
      <div style={styles.inputRow}>
        <span style={styles.icon}>🔍</span>
        <input
          ref={inputRef}
          style={styles.input}
          placeholder="Search your vault…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => query && setOpen(true)}
        />
        {loading && <span style={styles.spinner}>⏳</span>}
        {query && <button style={styles.clear} onClick={() => { setQuery(""); setResults([]); setOpen(false); inputRef.current?.focus(); }}>✕</button>}
      </div>

      {open && results.length > 0 && (
        <div style={styles.dropdown}>
          {results.map(r => (
            <ResultRow key={r.file.id} result={r} onSelect={f => { onSelect(f); setOpen(false); setQuery(""); }} />
          ))}
          {!showAll && total > 5 && (
            <button style={styles.showAll} onClick={handleShowAll}>
              Show all {total} relevant results ↓
            </button>
          )}
        </div>
      )}

      {open && query && !loading && results.length === 0 && (
        <div style={styles.dropdown}>
          <div style={styles.noResults}>No results for "{query}"</div>
        </div>
      )}
    </div>
  );
}

function ResultRow({ result, onSelect }: { result: SearchResult; onSelect: (f: VaultFile) => void }) {
  const name = result.file.path.split("/").pop() ?? result.file.path;
  return (
    <div style={styles.resultRow} onClick={() => onSelect(result.file)}>
      <div style={styles.resultName}>{name}</div>
      {result.snippet && (
        <div style={styles.snippet} dangerouslySetInnerHTML={{ __html: result.snippet.replace(/\*\*(.*?)\*\*/g, "<mark>$1</mark>") }} />
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: { position: "relative", padding: "8px 16px", background: "#111", borderBottom: "1px solid #2a2a2a" },
  inputRow: { display: "flex", alignItems: "center", background: "#1a1a1a", borderRadius: 8, padding: "6px 12px", gap: 8 },
  icon: { fontSize: 14, opacity: 0.5 },
  input: { flex: 1, background: "transparent", border: "none", outline: "none", color: "#e8e8e8", fontSize: 14 },
  spinner: { fontSize: 12, opacity: 0.6 },
  clear: { background: "none", border: "none", color: "#666", cursor: "pointer", fontSize: 13, padding: "0 2px" },
  dropdown: { position: "absolute", top: "100%", left: 16, right: 16, background: "#1a1a1a", borderRadius: 8, border: "1px solid #2a2a2a", zIndex: 100, overflow: "hidden", boxShadow: "0 8px 24px rgba(0,0,0,0.4)" },
  resultRow: { padding: "10px 14px", cursor: "pointer", borderBottom: "1px solid #222" },
  resultName: { fontSize: 13, fontWeight: 600, marginBottom: 2 },
  snippet: { fontSize: 12, color: "#888", lineHeight: 1.5 },
  showAll: { display: "block", width: "100%", padding: "10px 14px", background: "transparent", border: "none", borderTop: "1px solid #222", color: "#4a9eff", cursor: "pointer", fontSize: 13, textAlign: "left" },
  noResults: { padding: "12px 14px", color: "#555", fontSize: 13 },
};

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
    if (!q.trim()) {
      setResults([]);
      setTotal(0);
      return;
    }
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
    if (!query.trim()) {
      setResults([]);
      setTotal(0);
      setOpen(false);
      return;
    }
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
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => query && setOpen(true)}
        />
        {loading && <span style={styles.spinner}>⏳</span>}
        {query && (
          <button
            style={styles.clear}
            onClick={() => {
              setQuery("");
              setResults([]);
              setOpen(false);
              inputRef.current?.focus();
            }}
          >
            ✕
          </button>
        )}
      </div>

      {open && results.length > 0 && (
        <div style={styles.dropdown}>
          {results.map((r) => (
            <ResultRow
              key={r.file.id}
              result={r}
              onSelect={(f) => {
                onSelect(f);
                setOpen(false);
                setQuery("");
              }}
            />
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

function highlightSnippet(snippet: string): React.ReactNode[] {
  const segments: React.ReactNode[] = [];
  const re = /\*\*(.*?)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(snippet)) !== null) {
    if (m.index > last) segments.push(snippet.slice(last, m.index));
    segments.push(<mark key={i++}>{m[1]}</mark>);
    last = m.index + m[0].length;
  }
  if (last < snippet.length) segments.push(snippet.slice(last));
  return segments;
}

function ResultRow({
  result,
  onSelect,
}: {
  result: SearchResult;
  onSelect: (f: VaultFile) => void;
}) {
  const name = result.file.path.split("/").pop() ?? result.file.path;
  return (
    <div className="search-result" style={styles.resultRow} onClick={() => onSelect(result.file)}>
      <div style={styles.resultName}>{name}</div>
      {result.snippet && <div style={styles.snippet}>{highlightSnippet(result.snippet)}</div>}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    position: "relative",
    padding: "var(--spacing-3) var(--spacing-6)",
    background: "var(--bg-base)",
    borderBottom: "1px solid var(--border-color)",
    zIndex: 20,
  },
  inputRow: {
    display: "flex",
    alignItems: "center",
    background: "var(--bg-surface)",
    borderRadius: "var(--radius-full)",
    padding: "var(--spacing-3) var(--spacing-5)",
    gap: "var(--spacing-3)",
    boxShadow: "inset 0 1px 3px rgba(0,0,0,0.2), 0 1px 2px rgba(255,255,255,0.02)",
    border: "1px solid var(--border-highlight)",
    transition: "border-color var(--transition-fast)",
  },
  icon: { fontSize: 16, opacity: 0.5 },
  input: {
    flex: 1,
    background: "transparent",
    border: "none",
    outline: "none",
    color: "var(--text-primary)",
    fontSize: 16,
    fontFamily: "inherit",
    fontWeight: 500,
  },
  spinner: { fontSize: 14, opacity: 0.6 },
  clear: {
    background: "none",
    border: "none",
    color: "var(--text-muted)",
    cursor: "pointer",
    fontSize: 14,
    padding: "0 4px",
    transition: "color var(--transition-fast)",
  },
  dropdown: {
    position: "absolute",
    top: "calc(100% + var(--spacing-2))",
    left: "var(--spacing-6)",
    right: "var(--spacing-6)",
    background: "var(--bg-glass)",
    backdropFilter: "blur(16px)",
    WebkitBackdropFilter: "blur(16px)",
    borderRadius: "var(--radius-lg)",
    border: "1px solid rgba(255,255,255,0.1)",
    zIndex: 100,
    overflow: "hidden",
    boxShadow: "var(--shadow-lg)",
  },
  resultRow: {
    padding: "var(--spacing-3) var(--spacing-4)",
    cursor: "pointer",
    borderBottom: "1px solid var(--border-color)",
    transition: "background var(--transition-fast)",
  },
  resultName: {
    fontSize: 14,
    fontWeight: 600,
    marginBottom: "var(--spacing-1)",
    color: "var(--text-primary)",
  },
  snippet: { fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5 },
  showAll: {
    display: "block",
    width: "100%",
    padding: "var(--spacing-3) var(--spacing-4)",
    background: "transparent",
    border: "none",
    color: "var(--accent-primary)",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 500,
    textAlign: "center",
    transition: "background var(--transition-fast)",
  },
  noResults: {
    padding: "var(--spacing-4)",
    color: "var(--text-muted)",
    fontSize: 14,
    textAlign: "center",
  },
};

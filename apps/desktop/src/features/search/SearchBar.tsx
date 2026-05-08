import { useCallback, useEffect, useRef, useState } from "react";
import type { SearchResult, VaultFile } from "@openbrain/shared";
import { api } from "../../shared/api/api";

interface Props {
  onSelect: (file: VaultFile) => void;
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
      const { results: nextResults, total: nextTotal } = await api.search.query(q, limit);
      setResults(nextResults);
      setTotal(nextTotal);
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
      void search(query, 5);
      setOpen(true);
      setShowAll(false);
    }, 300);
  }, [query, search]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!(e.target as Element).closest("[data-searchbar]")) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleShowAll = () => {
    setShowAll(true);
    void search(query, 50);
  };

  return (
    <div data-searchbar="" style={styles.wrapper}>
      <div style={styles.inputRow}>
        <span style={styles.icon}>Search</span>
        <input
          ref={inputRef}
          style={styles.input}
          placeholder="Search your vault..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => query && setOpen(true)}
        />
        {loading && <span style={styles.spinner}>Loading</span>}
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
            Clear
          </button>
        )}
      </div>

      {open && results.length > 0 && (
        <div style={styles.dropdown}>
          {results.map((result) => (
            <ResultRow
              key={`${result.result_kind ?? "file"}-${result.wiki_node_id ?? result.file.id}`}
              result={result}
              onSelect={(file) => {
                onSelect(file);
                setOpen(false);
                setQuery("");
              }}
            />
          ))}
          {!showAll && total > 5 && (
            <button style={styles.showAll} onClick={handleShowAll}>
              Show all {total} relevant results
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
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = re.exec(snippet)) !== null) {
    if (match.index > last) segments.push(snippet.slice(last, match.index));
    segments.push(<mark key={index++}>{match[1]}</mark>);
    last = match.index + match[0].length;
  }
  if (last < snippet.length) segments.push(snippet.slice(last));
  return segments;
}

function ResultRow({
  result,
  onSelect,
}: {
  result: SearchResult;
  onSelect: (file: VaultFile) => void;
}) {
  const name = result.title ?? result.file.path.split("/").pop() ?? result.file.path;
  const path = result.title ? result.file.path : null;
  return (
    <div className="search-result" style={styles.resultRow} onClick={() => onSelect(result.file)}>
      <div style={styles.resultHeader}>
        <span style={styles.resultKind}>{formatResultKind(result)}</span>
        <span style={styles.resultName}>{name}</span>
      </div>
      {path && <div style={styles.resultPath}>{path}</div>}
      {result.snippet && <div style={styles.snippet}>{highlightSnippet(result.snippet)}</div>}
    </div>
  );
}

function formatResultKind(result: SearchResult): string {
  if (result.result_kind === "wiki") {
    return result.wiki_node_kind ? `Wiki ${result.wiki_node_kind}` : "Wiki";
  }

  return "File";
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    position: "relative",
    padding: "var(--spacing-3) var(--spacing-5)",
    background: "var(--bg-base)",
    borderBottom: "1px solid var(--border-color)",
    zIndex: 20,
  },
  inputRow: {
    display: "flex",
    alignItems: "center",
    background: "var(--bg-surface)",
    borderRadius: "var(--radius-full)",
    padding: "9px var(--spacing-5)",
    gap: "var(--spacing-3)",
    boxShadow: "none",
    border: "1px solid var(--border-color)",
  },
  icon: { fontSize: 12, opacity: 0.58, textTransform: "uppercase", fontWeight: 650 },
  input: {
    flex: 1,
    background: "transparent",
    border: "none",
    outline: "none",
    color: "var(--text-primary)",
    fontSize: 15,
    fontFamily: "inherit",
    fontWeight: 500,
  },
  spinner: { fontSize: 12, opacity: 0.6 },
  clear: {
    background: "none",
    border: "none",
    color: "var(--text-muted)",
    cursor: "pointer",
    fontSize: 12,
    padding: "0 4px",
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
    border: "1px solid var(--border-highlight)",
    zIndex: 100,
    overflow: "hidden",
    boxShadow: "var(--shadow-lg)",
  },
  resultRow: {
    padding: "var(--spacing-3) var(--spacing-4)",
    cursor: "pointer",
    borderBottom: "1px solid var(--border-color)",
  },
  resultHeader: {
    display: "flex",
    alignItems: "center",
    gap: "var(--spacing-2)",
    minWidth: 0,
    marginBottom: "var(--spacing-1)",
  },
  resultKind: {
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
  resultName: {
    fontSize: 14,
    fontWeight: 600,
    color: "var(--text-primary)",
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  resultPath: {
    color: "var(--text-muted)",
    fontSize: 12,
    marginBottom: "var(--spacing-1)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
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
  },
  noResults: {
    padding: "var(--spacing-4)",
    color: "var(--text-muted)",
    fontSize: 14,
    textAlign: "center",
  },
};

import { useState, useEffect } from "react";
import { ListView } from "./views/ListView";
import { GraphView } from "./views/GraphView";
import { SearchBar } from "./views/SearchBar";
import type { VaultFile } from "../../../packages/shared/src/types";
import { api } from "./api";

type ViewMode = "list" | "graph";

export default function App() {
  const [view, setView] = useState<ViewMode>("list");
  const [files, setFiles] = useState<VaultFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<VaultFile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.files.list()
      .then(setFiles)
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <Header view={view} onViewChange={setView} />
      <SearchBar onSelect={setSelectedFile} />
      <div style={{ flex: 1, overflow: "hidden" }}>
        {loading && <div style={styles.center}>Loading vault...</div>}
        {error && <div style={{ ...styles.center, color: "#ff6b6b" }}>{error}</div>}
        {!loading && !error && view === "list" && (
          <ListView files={files} selectedFile={selectedFile} onSelect={setSelectedFile} />
        )}
        {!loading && !error && view === "graph" && (
          <GraphView files={files} onSelect={setSelectedFile} />
        )}
      </div>
    </div>
  );
}

function Header({ view, onViewChange }: { view: ViewMode; onViewChange: (v: ViewMode) => void }) {
  return (
    <div style={styles.header}>
      <span style={styles.logo}>🧠 OpenBrain</span>
      <div style={styles.toggle}>
        <button style={{ ...styles.toggleBtn, ...(view === "list" ? styles.toggleActive : {}) }} onClick={() => onViewChange("list")}>
          List
        </button>
        <button style={{ ...styles.toggleBtn, ...(view === "graph" ? styles.toggleActive : {}) }} onClick={() => onViewChange("graph")}>
          Graph
        </button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 20px", background: "#161616", borderBottom: "1px solid #2a2a2a" },
  logo: { fontSize: 18, fontWeight: 700, letterSpacing: -0.5 },
  toggle: { display: "flex", gap: 4, background: "#222", borderRadius: 8, padding: 3 },
  toggleBtn: { padding: "5px 14px", borderRadius: 6, border: "none", background: "transparent", color: "#aaa", cursor: "pointer", fontSize: 13, fontWeight: 500 },
  toggleActive: { background: "#333", color: "#fff" },
  center: { display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#888" },
};

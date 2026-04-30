export type ViewMode = "list" | "graph" | "review";

interface Props {
  view: ViewMode;
  onViewChange: (view: ViewMode) => void;
  onOpenSettings: () => void;
}

export function AppHeader({ view, onViewChange, onOpenSettings }: Props) {
  return (
    <div className="app-header">
      <span className="app-logo">OpenBrain</span>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--spacing-3)" }}>
        <div className="toggle-group">
          <button
            className={`toggle-btn ${view === "list" ? "active" : ""}`}
            onClick={() => onViewChange("list")}
          >
            List
          </button>
          <button
            className={`toggle-btn ${view === "graph" ? "active" : ""}`}
            onClick={() => onViewChange("graph")}
          >
            Graph
          </button>
          <button
            className={`toggle-btn ${view === "review" ? "active" : ""}`}
            onClick={() => onViewChange("review")}
          >
            Review
          </button>
        </div>
        <button className="btn-icon" onClick={onOpenSettings} title="Settings">
          Settings
        </button>
      </div>
    </div>
  );
}

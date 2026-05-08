import type { CSSProperties, ReactNode } from "react";
import {
  AllNotesIcon,
  ArchitectIcon,
  GraphIcon,
  ReviewIcon,
  SettingsIcon,
  UserIcon,
} from "./Icons";

export type ViewMode = "list" | "graph" | "review" | "chat";

interface Props {
  view: ViewMode;
  onViewChange: (view: ViewMode) => void;
  onOpenSettings: () => void;
}

export function AppNavigation({ view, onViewChange, onOpenSettings }: Props) {
  return (
    <aside style={styles.rail}>
      <div style={styles.brand}>OpenBrain</div>
      <nav style={styles.nav}>
        <NavButton
          label="Notes"
          active={view === "list"}
          icon={<AllNotesIcon />}
          onClick={() => onViewChange("list")}
        />
        <NavButton
          label="Graph"
          active={view === "graph"}
          icon={<GraphIcon />}
          onClick={() => onViewChange("graph")}
        />
        <NavButton
          label="Review"
          active={view === "review"}
          icon={<ReviewIcon />}
          onClick={() => onViewChange("review")}
        />
        <NavButton
          label="Architect"
          active={view === "chat"}
          icon={<ArchitectIcon />}
          onClick={() => onViewChange("chat")}
        />
      </nav>
      <div style={styles.footer}>
        <NavButton label="Settings" icon={<SettingsIcon />} onClick={onOpenSettings} />
        <div style={styles.account} title="Account">
          <UserIcon size={16} />
          <span style={styles.accountText}>Local</span>
        </div>
      </div>
    </aside>
  );
}

function NavButton({
  label,
  icon,
  active = false,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      style={{ ...styles.navButton, ...(active ? styles.navButtonActive : {}) }}
      onClick={onClick}
      title={label}
    >
      <span style={styles.navIcon}>{icon}</span>
      <span style={styles.navLabel}>{label}</span>
    </button>
  );
}

const styles: Record<string, CSSProperties> = {
  rail: {
    width: 152,
    height: "100vh",
    borderRight: "1px solid var(--border-color)",
    background: "var(--bg-sidebar)",
    display: "flex",
    flexDirection: "column",
    padding: "var(--spacing-4) var(--spacing-3)",
    flexShrink: 0,
  },
  brand: {
    fontSize: 18,
    fontWeight: 750,
    margin: "4px 8px var(--spacing-5)",
    color: "var(--text-primary)",
  },
  nav: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  navButton: {
    display: "flex",
    alignItems: "center",
    gap: "var(--spacing-2)",
    width: "100%",
    border: "1px solid transparent",
    borderRadius: 8,
    background: "transparent",
    color: "var(--text-secondary)",
    padding: "8px 10px",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 620,
    textAlign: "left",
  },
  navButtonActive: {
    color: "var(--text-primary)",
    background: "var(--bg-surface-active)",
    borderColor: "transparent",
  },
  navIcon: {
    display: "inline-flex",
    color: "var(--text-secondary)",
    flexShrink: 0,
  },
  navLabel: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  footer: {
    marginTop: "auto",
    display: "flex",
    flexDirection: "column",
    gap: "var(--spacing-2)",
  },
  account: {
    display: "flex",
    alignItems: "center",
    gap: "var(--spacing-2)",
    color: "var(--text-muted)",
    padding: "8px 10px",
    fontSize: 12,
  },
  accountText: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
};

import { useEffect, useState } from "react";

export type Theme = "dark" | "light" | "system";

const THEME_KEY = "openbrain.theme";

export function loadTheme(): Theme {
  const stored = (typeof localStorage !== "undefined" && localStorage.getItem(THEME_KEY)) || "";
  if (stored === "dark" || stored === "light" || stored === "system") return stored;
  return "system";
}

export function applyTheme(theme: Theme) {
  const resolved =
    theme === "system"
      ? window.matchMedia("(prefers-color-scheme: light)").matches
        ? "light"
        : "dark"
      : theme;
  document.documentElement.dataset.theme = resolved;
}

export function persistTheme(theme: Theme) {
  if (typeof localStorage !== "undefined") localStorage.setItem(THEME_KEY, theme);
  applyTheme(theme);
}

interface Props {
  open: boolean;
  vaultPath: string | null;
  apiUrl: string;
  authTokenPresent: boolean;
  theme: Theme;
  onThemeChange: (t: Theme) => void;
  onChooseVault: () => void;
  onClose: () => void;
}

export function SettingsModal({
  open,
  vaultPath,
  apiUrl,
  authTokenPresent,
  theme,
  onThemeChange,
  onChooseVault,
  onClose,
}: Props) {
  const [localTheme, setLocalTheme] = useState<Theme>(theme);

  useEffect(() => setLocalTheme(theme), [theme, open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const handleThemeChange = (t: Theme) => {
    setLocalTheme(t);
    onThemeChange(t);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span style={{ fontSize: 16, fontWeight: 600 }}>Settings</span>
          <button className="btn-icon" onClick={onClose} title="Close">
            ✕
          </button>
        </div>

        <div className="modal-section">
          <div className="modal-label">Vault folder</div>
          <div className="modal-row">
            <span className="modal-value-mono">{vaultPath ?? "(not connected)"}</span>
            <button className="btn-action" onClick={onChooseVault}>
              {vaultPath ? "Change…" : "Choose…"}
            </button>
          </div>
        </div>

        <div className="modal-section">
          <div className="modal-label">Theme</div>
          <div className="toggle-group" style={{ display: "inline-flex" }}>
            {(["dark", "light", "system"] as const).map((t) => (
              <button
                key={t}
                className={`toggle-btn ${localTheme === t ? "active" : ""}`}
                onClick={() => handleThemeChange(t)}
              >
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div className="modal-section">
          <div className="modal-label">API endpoint (read-only)</div>
          <div className="modal-value-mono">{apiUrl || "(not set)"}</div>
        </div>

        <div className="modal-section">
          <div className="modal-label">Auth token (read-only)</div>
          <div className="modal-value-mono">
            {authTokenPresent ? "•••••••• (configured)" : "(not set)"}
          </div>
          <div className="modal-help">
            API URL and auth token are baked at build time from <code>.env.local</code>. Edit that
            file and rebuild to change them.
          </div>
        </div>
      </div>
    </div>
  );
}

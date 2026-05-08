import type { CSSProperties } from "react";

type IconProps = {
  size?: number;
  style?: CSSProperties;
};

const baseProps = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  viewBox: "0 0 24 24",
  "aria-hidden": true,
};

export function AllNotesIcon({ size = 18, style }: IconProps) {
  return (
    <svg {...baseProps} width={size} height={size} style={style}>
      <path d="M5 4h11l3 3v13H5z" />
      <path d="M16 4v4h4" />
      <path d="M8 12h8" />
      <path d="M8 16h6" />
    </svg>
  );
}

export function ArchitectIcon({ size = 18, style }: IconProps) {
  return (
    <svg {...baseProps} width={size} height={size} style={style}>
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
      <path d="M18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8z" />
    </svg>
  );
}

export function ChevronIcon({ open = false, size = 14 }: IconProps & { open?: boolean }) {
  return (
    <svg
      {...baseProps}
      width={size}
      height={size}
      style={{ transform: open ? "rotate(90deg)" : undefined }}
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

export function ClockIcon({ size = 18, style }: IconProps) {
  return (
    <svg {...baseProps} width={size} height={size} style={style}>
      <path d="M12 7v5l3 2" />
      <path d="M21 12a9 9 0 1 1-2.6-6.4" />
      <path d="M21 4v5h-5" />
    </svg>
  );
}

export function FileIcon({ size = 18, style }: IconProps) {
  return (
    <svg {...baseProps} width={size} height={size} style={style}>
      <path d="M6 3h9l3 3v15H6z" />
      <path d="M15 3v4h4" />
    </svg>
  );
}

export function FolderIcon({ size = 18, style }: IconProps) {
  return (
    <svg {...baseProps} width={size} height={size} style={style}>
      <path d="M3 7.5h7l2 2h9v9.5H3z" />
      <path d="M3 7.5v-2h6l2 2" />
    </svg>
  );
}

export function FolderPlusIcon({ size = 18, style }: IconProps) {
  return (
    <svg {...baseProps} width={size} height={size} style={style}>
      <path d="M3 7.5h7l2 2h9v9.5H3z" />
      <path d="M12 14h5" />
      <path d="M14.5 11.5v5" />
    </svg>
  );
}

export function GraphIcon({ size = 18, style }: IconProps) {
  return (
    <svg {...baseProps} width={size} height={size} style={style}>
      <circle cx="6" cy="7" r="2.5" />
      <circle cx="18" cy="7" r="2.5" />
      <circle cx="12" cy="18" r="2.5" />
      <path d="M8.3 8.3l2.7 7.4" />
      <path d="M15.7 8.3L13 15.7" />
      <path d="M8.5 7h7" />
    </svg>
  );
}

export function LinkIcon({ size = 18, style }: IconProps) {
  return (
    <svg {...baseProps} width={size} height={size} style={style}>
      <path d="M10 13a5 5 0 0 0 7.1 0l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1" />
      <path d="M14 11a5 5 0 0 0-7.1 0l-2 2A5 5 0 0 0 12 20.1l1.1-1.1" />
    </svg>
  );
}

export function NotePlusIcon({ size = 18, style }: IconProps) {
  return (
    <svg {...baseProps} width={size} height={size} style={style}>
      <path d="M5 4h14v16H5z" />
      <path d="M9 9h6" />
      <path d="M12 6v6" />
      <path d="M9 16h6" />
    </svg>
  );
}

export function ReviewIcon({ size = 18, style }: IconProps) {
  return (
    <svg {...baseProps} width={size} height={size} style={style}>
      <path d="M5 4h14v16H5z" />
      <path d="M8 9l2 2 4-4" />
      <path d="M8 16h8" />
    </svg>
  );
}

export function SettingsIcon({ size = 18, style }: IconProps) {
  return (
    <svg {...baseProps} width={size} height={size} style={style}>
      <path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z" />
      <path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.4 1a7.6 7.6 0 0 0-1.7-1L14.5 3h-5l-.3 3.1a7.6 7.6 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.5a7 7 0 0 0 0 2l-2 1.5 2 3.4 2.4-1a7.6 7.6 0 0 0 1.7 1l.3 3.1h5l.3-3.1a7.6 7.6 0 0 0 1.7-1l2.4 1 2-3.4-2-1.5c.1-.3.1-.7.1-1z" />
    </svg>
  );
}

export function TrashIcon({ size = 18, style }: IconProps) {
  return (
    <svg {...baseProps} width={size} height={size} style={style}>
      <path d="M4 7h16" />
      <path d="M9 7V4h6v3" />
      <path d="M7 7l1 14h8l1-14" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}

export function UploadIcon({ size = 18, style }: IconProps) {
  return (
    <svg {...baseProps} width={size} height={size} style={style}>
      <path d="M12 16V4" />
      <path d="M7 9l5-5 5 5" />
      <path d="M5 16v4h14v-4" />
    </svg>
  );
}

export function ExportIcon({ size = 18, style }: IconProps) {
  return (
    <svg {...baseProps} width={size} height={size} style={style}>
      <path d="M12 4v12" />
      <path d="M7 11l5 5 5-5" />
      <path d="M5 20h14" />
    </svg>
  );
}

export function UserIcon({ size = 18, style }: IconProps) {
  return (
    <svg {...baseProps} width={size} height={size} style={style}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </svg>
  );
}

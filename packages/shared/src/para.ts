import type { VaultFolder } from "./types";

export const PARA_ROOTS = ["Projects", "Areas", "Resources", "Archive"] as const;
export type ParaRoot = (typeof PARA_ROOTS)[number];

export const PARA_DEFAULT_ROOT: ParaRoot = "Resources";

const PARA_ROOT_SET = new Set<string>(PARA_ROOTS);

export function isParaRoot(path: string): path is ParaRoot {
  return PARA_ROOT_SET.has(path);
}

export function paraRootForPath(path: string | null | undefined): ParaRoot | null {
  const root = path?.split("/").filter(Boolean)[0];
  return root && isParaRoot(root) ? root : null;
}

export function ensureParaFolderPath(
  path: string,
  defaultRoot: ParaRoot = PARA_DEFAULT_ROOT,
): string {
  const normalized = path
    .replaceAll("\\", "/")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean)
    .join("/");

  if (!normalized) return defaultRoot;
  return paraRootForPath(normalized) ? normalized : `${defaultRoot}/${normalized}`;
}

export function paraRootDescription(root: ParaRoot): string {
  switch (root) {
    case "Projects":
      return "active outcomes with deadlines or clear completion";
    case "Areas":
      return "ongoing responsibilities and standards";
    case "Resources":
      return "reference material by topic";
    case "Archive":
      return "inactive projects, old areas, and no-longer-current resources";
  }
}

export function paraPlacementReason(folder: string): string {
  const root = paraRootForPath(folder);
  if (!root) {
    return "The Architect found this folder to be the best fit based on the file name, existing vault structure, and recent corrections.";
  }
  return `The Architect recommends this PARA placement under ${root}: ${paraRootDescription(root)}. Raw files are moved only after you approve.`;
}

export function makeParaRootFolders(now = new Date().toISOString()): VaultFolder[] {
  return PARA_ROOTS.map((root) => ({
    path: root,
    name: root,
    parent_path: null,
    created_at: now,
    updated_at: now,
  }));
}

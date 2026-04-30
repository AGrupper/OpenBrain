import type { VaultFile, SearchResult, Link } from "../../../packages/shared/src/types";

const BASE = import.meta.env.VITE_API_URL as string;
const TOKEN = import.meta.env.VITE_AUTH_TOKEN as string;

const h = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

async function get<T>(path: string, params?: Record<string, string>): Promise<T> {
  const qs = params ? `?${new URLSearchParams(params)}` : "";
  const res = await fetch(`${BASE}${path}${qs}`, { headers: h });
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return res.json();
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: h,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} failed: ${res.status}`);
  return res.json();
}

async function patch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "PATCH",
    headers: h,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PATCH ${path} failed: ${res.status}`);
  return res.json();
}

async function del(path: string): Promise<void> {
  const res = await fetch(`${BASE}${path}`, { method: "DELETE", headers: h });
  if (!res.ok) throw new Error(`DELETE ${path} failed: ${res.status}`);
}

export const api = {
  files: {
    list: () => get<VaultFile[]>("/files"),
    get: (id: string) => get<VaultFile>(`/files/${id}`),
    linksForFile: (id: string) => get<Link[]>(`/links/for-file/${id}`),
    patch: (id: string, body: Partial<VaultFile>) => patch<VaultFile>(`/files/${id}`, body),
    rename: (id: string, newPath: string) => patch<VaultFile>(`/files/${id}`, { path: newPath }),
    delete: (id: string) => del(`/files/${id}`),
  },
  search: {
    query: (q: string, limit = 5) =>
      get<{ results: SearchResult[]; total: number }>("/search", { q, limit: String(limit) }),
  },
  links: {
    approved: async () => {
      const [approved, autoApproved] = await Promise.all([
        get<Link[]>("/links", { status: "approved" }),
        get<Link[]>("/links", { status: "auto_approved" }),
      ]);
      return [...approved, ...autoApproved];
    },
    pending: () => get<Link[]>("/links", { status: "pending" }),
    update: (id: string, status: Link["status"]) => patch<Link[]>(`/links/${id}`, { status }),
  },
  corrections: {
    post: (fileId: string, field: "folder" | "tags", oldValue: string, newValue: string) =>
      post("/corrections", { file_id: fileId, field, old_value: oldValue, new_value: newValue }),
  },
};

import type {
  ArchitectChatResponse,
  ArchitectChatContext,
  ArchitectSuggestion,
  ArchitectSuggestionStatus,
  Link,
  SearchResult,
  SyncSummary,
  VaultFile,
  VaultFolder,
  WikiGraphResponse,
  WikiNode,
  WikiNodeDetailResponse,
  SyncSource,
} from "@openbrain/shared";

const BASE = import.meta.env.VITE_API_URL as string;
const TOKEN = import.meta.env.VITE_AUTH_TOKEN as string;

const jsonHeaders = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

async function get<T>(path: string, params?: Record<string, string>): Promise<T> {
  const qs = params ? `?${new URLSearchParams(params)}` : "";
  const res = await fetch(`${BASE}${path}${qs}`, { headers: jsonHeaders });
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return res.json();
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(formatApiError("POST", path, res.status, detail));
  }
  return res.json();
}

function formatApiError(method: string, path: string, status: number, detail: string): string {
  const cleanDetail = detail.replace(/\s+/g, " ").trim();
  if (!cleanDetail) return `${method} ${path} failed: ${status}`;
  return `${method} ${path} failed: ${status}: ${cleanDetail}`;
}

async function patch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "PATCH",
    headers: jsonHeaders,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PATCH ${path} failed: ${res.status}`);
  return res.json();
}

async function del(path: string): Promise<void> {
  const res = await fetch(`${BASE}${path}`, { method: "DELETE", headers: jsonHeaders });
  if (!res.ok) throw new Error(`DELETE ${path} failed: ${res.status}`);
}

export const api = {
  files: {
    list: () => get<VaultFile[]>("/files"),
    deleted: () => get<VaultFile[]>("/files", { deleted_only: "true" }),
    get: (id: string) => get<VaultFile>(`/files/${id}`),
    linksForFile: (id: string) => get<Link[]>(`/links/for-file/${id}`),
    createText: (path: string, content = "") => post<VaultFile>("/files/text", { path, content }),
    createUrl: (sourceUrl: string, folder?: string | null) =>
      post<VaultFile>("/files/url", { url: sourceUrl, folder }),
    saveText: (id: string, content: string) =>
      patch<VaultFile | VaultFile[]>(`/files/${id}?run_wiki=true`, { text_content: content }),
    patch: (id: string, body: Partial<VaultFile>) => patch<VaultFile>(`/files/${id}`, body),
    rename: (id: string, newPath: string) => patch<VaultFile>(`/files/${id}`, { path: newPath }),
    delete: (id: string) => del(`/files/${id}`),
    restore: (id: string) => post<VaultFile>(`/files/${id}/restore`, {}),
    permanentDelete: (id: string) => del(`/files/${id}/permanent`),
  },
  folders: {
    list: () => get<VaultFolder[]>("/folders"),
    create: (path: string) => post<VaultFolder>("/folders", { path }),
    delete: (path: string) => del(`/folders?${new URLSearchParams({ path })}`),
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
  architect: {
    runJobs: (body: { file_id?: string; scopes?: string[] } = {}) =>
      post<{ ok: boolean; ran: string[] }>("/architect/jobs/run", body),
    suggestions: {
      pending: () => get<ArchitectSuggestion[]>("/architect/suggestions", { status: "pending" }),
      update: (id: string, status: ArchitectSuggestionStatus) =>
        patch<ArchitectSuggestion[]>(`/architect/suggestions/${id}`, { status }),
    },
    chat: (
      message: string,
      sessionId?: string,
      contextOrCurrentFileId?: ArchitectChatContext | string | null,
    ) => {
      const context =
        typeof contextOrCurrentFileId === "string"
          ? { current_file_id: contextOrCurrentFileId }
          : (contextOrCurrentFileId ?? undefined);
      return post<ArchitectChatResponse>("/architect/chat", {
        message,
        session_id: sessionId,
        current_file_id: context?.current_file_id,
        ide_context: context,
      });
    },
  },
  wiki: {
    graph: () => get<WikiGraphResponse>("/wiki/graph"),
    node: (id: string) => get<WikiNodeDetailResponse>(`/wiki/nodes/${id}`),
    nodesForFile: (id: string) => get<WikiNode[]>(`/wiki/files/${id}/nodes`),
  },
  sync: {
    sources: () => get<SyncSource[]>("/sync/sources"),
    runNotion: (body: { query?: string; folder?: string; limit?: number } = {}) =>
      post<SyncSummary>("/sync/notion/run", body),
    importAppleNotesFiles: (body: {
      source_name?: string;
      folder?: string;
      files: Array<{
        relative_path: string;
        content_base64: string;
        mime: string;
        modified_at?: string | null;
      }>;
    }) => post<SyncSummary>("/sync/apple-notes/files", body),
  },
};

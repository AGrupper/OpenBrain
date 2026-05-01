import type { Env } from "../app";
import type { VaultFile, VaultFolder } from "@openbrain/shared";

export function normalizeFolderPath(input: string): string | null {
  const normalized = input
    .replaceAll("\\", "/")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean)
    .join("/");

  if (!normalized) return null;
  if (normalized.split("/").some((part) => part === "." || part === "..")) return null;
  return normalized;
}

export function folderName(path: string): string {
  return path.split("/").pop() ?? path;
}

export function parentFolderPath(path: string): string | null {
  const idx = path.lastIndexOf("/");
  return idx > 0 ? path.slice(0, idx) : null;
}

function folderAncestors(path: string): VaultFolder[] {
  const parts = path.split("/");
  return parts.map((_, index) => {
    const ancestorPath = parts.slice(0, index + 1).join("/");
    return {
      path: ancestorPath,
      name: folderName(ancestorPath),
      parent_path: parentFolderPath(ancestorPath),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  });
}

function db(env: Env) {
  const base = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_KEY;
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };

  return {
    async query(table: string, params: Record<string, string> = {}) {
      const qs = new URLSearchParams(params);
      const res = await fetch(`${base}/rest/v1/${table}?${qs}`, { headers });
      if (!res.ok) throw new Error(`DB query failed: ${await res.text()}`);
      return res.json();
    },
    async insert(table: string, row: Record<string, unknown>) {
      const res = await fetch(`${base}/rest/v1/${table}`, {
        method: "POST",
        headers: { ...headers, Prefer: "return=representation" },
        body: JSON.stringify(row),
      });
      if (!res.ok) throw new Error(`DB insert failed: ${await res.text()}`);
      return res.json();
    },
    async upsert(table: string, rows: Record<string, unknown>[]) {
      const res = await fetch(`${base}/rest/v1/${table}`, {
        method: "POST",
        headers: {
          ...headers,
          Prefer: "resolution=merge-duplicates,return=representation",
        },
        body: JSON.stringify(rows),
      });
      if (!res.ok) throw new Error(`DB upsert failed: ${await res.text()}`);
      return res.json();
    },
    async delete(table: string, path: string) {
      const qs = new URLSearchParams({ path: `eq.${path}` });
      const res = await fetch(`${base}/rest/v1/${table}?${qs}`, {
        method: "DELETE",
        headers,
      });
      if (!res.ok) throw new Error(`DB delete failed: ${await res.text()}`);
    },
  };
}

export async function ensureFolderRows(env: Env, rawFolderPath: string | null | undefined) {
  if (!rawFolderPath) return;
  const path = normalizeFolderPath(rawFolderPath);
  if (!path) return;

  const now = new Date().toISOString();
  await db(env).upsert(
    "folders",
    folderAncestors(path).map((folder) => ({
      path: folder.path,
      name: folder.name,
      parent_path: folder.parent_path,
      updated_at: now,
    })),
  );
}

export async function handleFolders(request: Request, env: Env, url: URL): Promise<Response> {
  const { method } = request;

  try {
    if (method === "GET") {
      return Response.json(
        await db(env).query("folders", {
          select: "*",
          order: "path.asc",
        }),
      );
    }

    if (method === "POST") {
      const body = (await request.json()) as { path?: string };
      const path = body.path ? normalizeFolderPath(body.path) : null;
      if (!path) return new Response("path is required", { status: 400 });

      const [existingFolders, conflictingFiles] = await Promise.all([
        db(env).query("folders", { path: `eq.${path}`, select: "path", limit: "1" }) as Promise<
          Pick<VaultFolder, "path">[]
        >,
        db(env).query("files", { path: `eq.${path}`, select: "id", limit: "1" }) as Promise<
          Pick<VaultFile, "id">[]
        >,
      ]);
      if (existingFolders.length) return new Response("Folder already exists", { status: 409 });
      if (conflictingFiles.length) {
        return new Response("A file already exists at that path", { status: 409 });
      }

      const parent = parentFolderPath(path);
      await ensureFolderRows(env, parent);
      const rows = (await db(env).insert("folders", {
        path,
        name: folderName(path),
        parent_path: parent,
      })) as VaultFolder[];
      return Response.json(rows[0], { status: 201 });
    }

    if (method === "DELETE") {
      const path = normalizeFolderPath(url.searchParams.get("path") ?? "");
      if (!path) return new Response("path query param is required", { status: 400 });

      const [children, files] = await Promise.all([
        db(env).query("folders", {
          parent_path: `eq.${path}`,
          select: "path",
          limit: "1",
        }) as Promise<Pick<VaultFolder, "path">[]>,
        db(env).query("files", { path: `like.${path}/%`, select: "id", limit: "1" }) as Promise<
          Pick<VaultFile, "id">[]
        >,
      ]);
      if (children.length || files.length) {
        return new Response("Folder is not empty", { status: 409 });
      }

      await db(env).delete("folders", path);
      return new Response(null, { status: 204 });
    }

    return new Response("Method not allowed", { status: 405 });
  } catch (err) {
    console.error(err);
    return new Response(String(err), { status: 500 });
  }
}

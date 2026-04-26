import type { Env } from "../index";
import type { VaultFile } from "@openbrain/shared";

interface UploadMetadata {
  path: string;
  sha256: string;
  size: number;
  mime: string;
}

export function readUploadHeaders(request: Request): UploadMetadata | null {
  const path = request.headers.get("X-File-Path");
  const sha256 = request.headers.get("X-File-Sha256");
  const sizeStr = request.headers.get("X-File-Size");
  const mime = request.headers.get("Content-Type") ?? "application/octet-stream";
  if (!path || !sha256 || !sizeStr) return null;
  const size = Number.parseInt(sizeStr, 10);
  if (!Number.isFinite(size) || size < 0) return null;
  return { path, sha256, size, mime };
}

function db(env: Env) {
  const base = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_KEY;
  return {
    async query(table: string, params: Record<string, string> = {}) {
      const qs = new URLSearchParams(params);
      const res = await fetch(`${base}/rest/v1/${table}?${qs}`, {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
      });
      if (!res.ok) throw new Error(`DB query failed: ${await res.text()}`);
      return res.json();
    },
    async upsert(table: string, row: Record<string, unknown>) {
      const res = await fetch(`${base}/rest/v1/${table}`, {
        method: "POST",
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=representation",
        },
        body: JSON.stringify(row),
      });
      if (!res.ok) throw new Error(`DB upsert failed: ${await res.text()}`);
      return res.json();
    },
    async patch(table: string, id: string, patch: Record<string, unknown>) {
      const res = await fetch(`${base}/rest/v1/${table}?id=eq.${id}`, {
        method: "PATCH",
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(`DB patch failed: ${await res.text()}`);
      return res.json();
    },
    async delete(table: string, id: string) {
      const res = await fetch(`${base}/rest/v1/${table}?id=eq.${id}`, {
        method: "DELETE",
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
        },
      });
      if (!res.ok) throw new Error(`DB delete failed: ${await res.text()}`);
    },
  };
}

export async function handleFiles(request: Request, env: Env, url: URL): Promise<Response> {
  const { method } = request;
  const segments = url.pathname
    .replace(/^\/files/, "")
    .split("/")
    .filter(Boolean);
  const fileId = segments[0];
  const sub = segments[1]; // e.g. "embedding"

  try {
    // GET /files — list all files
    if (method === "GET" && !fileId) {
      const needsLinking = url.searchParams.get("needs_linking");
      const params: Record<string, string> = { order: "updated_at.desc", select: "*" };
      if (needsLinking === "true") params["needs_linking"] = "eq.true";
      const rows = await db(env).query("files", params);
      return Response.json(rows);
    }

    // GET /files/:id — get single file metadata
    if (method === "GET" && fileId && !sub) {
      const rows = (await db(env).query("files", {
        id: `eq.${fileId}`,
        select: "*",
      })) as VaultFile[];
      if (!rows.length) return new Response("Not found", { status: 404 });
      return Response.json(rows[0]);
    }

    // GET /files/:id/download — get a presigned R2 download URL
    if (method === "GET" && fileId && sub === "download") {
      const rows = (await db(env).query("files", { id: `eq.${fileId}`, select: "path" })) as {
        path: string;
      }[];
      if (!rows.length) return new Response("Not found", { status: 404 });
      const obj = await env.VAULT_BUCKET.get(rows[0].path);
      if (!obj) return new Response("Object not in R2", { status: 404 });
      // Stream body directly
      return new Response(obj.body, {
        headers: { "Content-Type": obj.httpMetadata?.contentType ?? "application/octet-stream" },
      });
    }

    // GET /files/:id/neighbors — semantic nearest neighbors for linking
    if (method === "GET" && fileId && sub === "neighbors") {
      const k = parseInt(url.searchParams.get("k") ?? "10");
      const rows = await rpcNeighbors(env, fileId, k);
      return Response.json(rows);
    }

    // PUT /files/upload — receive file blob with metadata in headers, store in R2, upsert row.
    // Headers: X-File-Path, X-File-Sha256, X-File-Size; Content-Type carries MIME.
    if (method === "PUT" && fileId === "upload" && !sub) {
      const meta = readUploadHeaders(request);
      if (!meta) return new Response("Missing required X-File-* headers", { status: 400 });

      const blob = await request.arrayBuffer();
      if (blob.byteLength !== meta.size) {
        return new Response(
          `Body size ${blob.byteLength} does not match X-File-Size ${meta.size}`,
          { status: 400 },
        );
      }

      await env.VAULT_BUCKET.put(meta.path, blob, {
        httpMetadata: { contentType: meta.mime },
        sha256: meta.sha256,
      });
      const rows = (await db(env).upsert("files", {
        path: meta.path,
        size: meta.size,
        sha256: meta.sha256,
        mime: meta.mime,
        updated_at: new Date().toISOString(),
        needs_embedding: true,
        needs_linking: true,
        needs_tagging: true,
      })) as VaultFile[];
      return Response.json(rows[0], { status: 201 });
    }

    // POST /files/:id/embedding — Friday posts the embedding vector
    if (method === "POST" && fileId && sub === "embedding") {
      const body = (await request.json()) as { embedding: number[]; text_preview: string };
      await db(env).upsert("embeddings", {
        file_id: fileId,
        embedding: JSON.stringify(body.embedding),
        text_preview: body.text_preview,
        embedded_at: new Date().toISOString(),
      });
      await db(env).patch("files", fileId, { needs_embedding: false });
      return new Response(null, { status: 204 });
    }

    // PATCH /files/:id — update path, folder, tags, etc.
    if (method === "PATCH" && fileId && !sub) {
      const body = (await request.json()) as Partial<VaultFile>;
      const rows = await db(env).patch("files", fileId, {
        ...body,
        updated_at: new Date().toISOString(),
      });
      return Response.json(rows);
    }

    // DELETE /files/:id — remove from R2 + DB
    if (method === "DELETE" && fileId && !sub) {
      const rows = (await db(env).query("files", { id: `eq.${fileId}`, select: "path" })) as {
        path: string;
      }[];
      if (rows.length) await env.VAULT_BUCKET.delete(rows[0].path);
      await db(env).delete("files", fileId);
      return new Response(null, { status: 204 });
    }

    return new Response("Method not allowed", { status: 405 });
  } catch (err) {
    console.error(err);
    return new Response(String(err), { status: 500 });
  }
}

async function rpcNeighbors(env: Env, fileId: string, k: number): Promise<unknown[]> {
  // Use Supabase RPC to call pgvector similarity search
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/neighbors`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ target_file_id: fileId, result_limit: k }),
  });
  if (!res.ok) return [];
  return res.json();
}

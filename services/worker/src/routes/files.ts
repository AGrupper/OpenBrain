import type { Env } from "../index";
import type { VaultFile, UploadUrlRequest, UploadUrlResponse } from "@openbrain/shared";

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
  const segments = url.pathname.replace(/^\/files/, "").split("/").filter(Boolean);
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
      const rows = await db(env).query("files", { id: `eq.${fileId}`, select: "*" }) as VaultFile[];
      if (!rows.length) return new Response("Not found", { status: 404 });
      return Response.json(rows[0]);
    }

    // GET /files/:id/download — get a presigned R2 download URL
    if (method === "GET" && fileId && sub === "download") {
      const rows = await db(env).query("files", { id: `eq.${fileId}`, select: "path" }) as { path: string }[];
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

    // POST /files/upload-url — request a presigned R2 upload URL
    if (method === "POST" && fileId === "upload-url") {
      const body = await request.json() as UploadUrlRequest;
      // R2 doesn't support presigned URLs in Workers yet; we accept the upload directly
      // Instead, return the direct upload endpoint
      const uploadToken = btoa(JSON.stringify({ path: body.path, sha256: body.sha256, size: body.size, mime: body.mime }));
      const response: UploadUrlResponse = {
        upload_url: `${url.origin}/files/upload/${uploadToken}`,
        file_id: "", // will be set after upload
      };
      return Response.json(response);
    }

    // PUT /files/upload/:token — receive file blob, store in R2, upsert metadata
    if (method === "PUT" && fileId === "upload" && sub) {
      const meta = JSON.parse(atob(sub)) as UploadUrlRequest;
      const blob = await request.arrayBuffer();
      await env.VAULT_BUCKET.put(meta.path, blob, {
        httpMetadata: { contentType: meta.mime },
        sha256: meta.sha256,
      });
      const rows = await db(env).upsert("files", {
        path: meta.path,
        size: meta.size,
        sha256: meta.sha256,
        mime: meta.mime,
        updated_at: new Date().toISOString(),
        needs_embedding: true,
        needs_linking: true,
        needs_tagging: true,
      }) as VaultFile[];
      return Response.json(rows[0], { status: 201 });
    }

    // POST /files/:id/embedding — Friday posts the embedding vector
    if (method === "POST" && fileId && sub === "embedding") {
      const body = await request.json() as { embedding: number[]; text_preview: string };
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
      const body = await request.json() as Partial<VaultFile>;
      const rows = await db(env).patch("files", fileId, { ...body, updated_at: new Date().toISOString() });
      return Response.json(rows);
    }

    // DELETE /files/:id — remove from R2 + DB
    if (method === "DELETE" && fileId && !sub) {
      const rows = await db(env).query("files", { id: `eq.${fileId}`, select: "path" }) as { path: string }[];
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

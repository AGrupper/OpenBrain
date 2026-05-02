import { unzipSync } from "fflate";
import type { Env } from "../app";
import type { VaultFile } from "@openbrain/shared";
import { ensureFolderRows } from "./folders";
import { runLinkerForFile, runTaggerForFile } from "../jobs";

interface UploadMetadata {
  path: string;
  sha256: string;
  size: number;
  mime: string;
}

export const EMBEDDING_DIMENSIONS = 1024;
export const FILES_SELECT_WHITELIST = new Set([
  "id",
  "path",
  "size",
  "sha256",
  "mime",
  "folder",
  "tags",
  "updated_at",
  "created_at",
  "needs_embedding",
  "needs_linking",
  "needs_tagging",
  "text_content",
  "summary",
]);
const FILES_MAX_LIMIT = 500;
const FILES_BOOL_FILTERS = ["needs_linking", "needs_tagging", "needs_embedding"] as const;

export function parseFilesQuery(searchParams: URLSearchParams): {
  params: Record<string, string>;
  error?: string;
} {
  const params: Record<string, string> = { order: "updated_at.desc" };

  for (const key of FILES_BOOL_FILTERS) {
    if (searchParams.get(key) === "true") params[key] = "eq.true";
  }

  const rawSelect = searchParams.get("select");
  if (rawSelect) {
    const cols = rawSelect
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean);
    const bad = cols.filter((c) => !FILES_SELECT_WHITELIST.has(c));
    if (bad.length) return { params, error: `Unknown select columns: ${bad.join(",")}` };
    params.select = cols.join(",");
  } else {
    params.select = "*";
  }

  const rawLimit = searchParams.get("limit");
  if (rawLimit !== null) {
    const n = Number.parseInt(rawLimit, 10);
    if (!Number.isFinite(n) || n <= 0) return { params, error: "limit must be a positive integer" };
    params.limit = String(Math.min(n, FILES_MAX_LIMIT));
  }

  return { params };
}

export function isValidEmbedding(v: unknown): v is number[] {
  if (!Array.isArray(v) || v.length !== EMBEDDING_DIMENSIONS) return false;
  for (const x of v) {
    if (typeof x !== "number" || !Number.isFinite(x)) return false;
  }
  return true;
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

export function folderFromPath(path: string): string | null {
  const normalized = path.replaceAll("\\", "/");
  const idx = normalized.lastIndexOf("/");
  if (idx <= 0) return null;
  return normalized.slice(0, idx);
}

function normalizeFilePath(input: string): string | null {
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

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function extractTextContent(mime: string, path: string, blob: ArrayBuffer): string | null {
  const lowerPath = path.toLowerCase();
  if (
    mime.startsWith("text/") ||
    lowerPath.endsWith(".md") ||
    lowerPath.endsWith(".markdown") ||
    lowerPath.endsWith(".txt")
  ) {
    return new TextDecoder().decode(blob);
  }
  if (
    lowerPath.endsWith(".docx") ||
    mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return extractDocxText(blob);
  }
  return null;
}

function extractDocxText(blob: ArrayBuffer): string | null {
  try {
    const files = unzipSync(new Uint8Array(blob), {
      filter: (f) => f.name === "word/document.xml",
    });
    const xmlBytes = files["word/document.xml"];
    if (!xmlBytes) return null;
    return docxXmlToMarkdown(new TextDecoder().decode(xmlBytes));
  } catch {
    return null;
  }
}

function docxXmlToMarkdown(xml: string): string | null {
  const paragraphs: string[] = [];

  for (const para of xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? []) {
    const style = (para.match(/<w:pStyle w:val="([^"]+)"/) ?? [])[1] ?? "";
    const isList = /<w:numPr>/.test(para);

    let text = "";
    for (const run of para.match(/<w:r[ >][\s\S]*?<\/w:r>/g) ?? []) {
      const rpr = (run.match(/<w:rPr>([\s\S]*?)<\/w:rPr>/) ?? [])[1] ?? "";
      const bold = /<w:b\/>|<w:b>/.test(rpr) && !/<w:b w:val="0"/.test(rpr);
      const italic = /<w:i\/>|<w:i>/.test(rpr) && !/<w:i w:val="0"/.test(rpr);
      const t = (run.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) ?? [])
        .map((m) => m.replace(/<[^>]+>/g, ""))
        .join("");
      if (!t) continue;
      if (bold && italic) text += `***${t}***`;
      else if (bold) text += `**${t}**`;
      else if (italic) text += `*${t}*`;
      else text += t;
    }

    text = text.trim();
    if (!text) continue;

    const headingLevel = (style.match(/^[Hh]eading(\d)$/) ?? [])[1];
    if (headingLevel) text = `${"#".repeat(Number(headingLevel))} ${text}`;
    else if (isList) text = `- ${text}`;

    paragraphs.push(text);
  }

  return paragraphs.join("\n\n") || null;
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

export async function handleFiles(
  request: Request,
  env: Env,
  url: URL,
  ctx?: ExecutionContext,
): Promise<Response> {
  const { method } = request;
  const segments = url.pathname
    .replace(/^\/files/, "")
    .split("/")
    .filter(Boolean);
  const fileId = segments[0];
  const sub = segments[1]; // e.g. "embedding"

  try {
    // GET /files — list files with optional filters/limit/select
    if (method === "GET" && !fileId) {
      const { params, error } = parseFilesQuery(url.searchParams);
      if (error) return new Response(error, { status: 400 });
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

    // POST /files/text — create a blank or text Markdown file directly in the cloud vault.
    if (method === "POST" && fileId === "text" && !sub) {
      const body = (await request.json()) as { path?: string; content?: string };
      const path = body.path ? normalizeFilePath(body.path) : null;
      if (!path) return new Response("path is required", { status: 400 });
      if (!path.toLowerCase().endsWith(".md") && !path.toLowerCase().endsWith(".markdown")) {
        return new Response("path must end with .md or .markdown", { status: 400 });
      }

      const existing = (await db(env).query("files", {
        path: `eq.${path}`,
        select: "id",
        limit: "1",
      })) as Pick<VaultFile, "id">[];
      if (existing.length) return new Response("File already exists", { status: 409 });

      const content = body.content ?? "";
      const bytes = new TextEncoder().encode(content);
      const sha256 = await sha256Hex(bytes);
      const folder = folderFromPath(path);
      await ensureFolderRows(env, folder);
      await env.VAULT_BUCKET.put(path, bytes, {
        httpMetadata: { contentType: "text/markdown" },
        sha256,
      });
      const rows = (await db(env).upsert("files", {
        path,
        size: bytes.byteLength,
        sha256,
        mime: "text/markdown",
        folder,
        text_content: content,
        updated_at: new Date().toISOString(),
        needs_embedding: true,
        needs_linking: true,
        needs_tagging: true,
      })) as VaultFile[];
      if (rows[0]?.id) {
        await db(env).upsert("architect_jobs", {
          file_id: rows[0].id,
          status: "pending",
          updated_at: new Date().toISOString(),
        });
        kickArchitect(env, rows[0].id, ctx);
      }
      return Response.json(rows[0], { status: 201 });
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

      const folder = folderFromPath(meta.path);
      await ensureFolderRows(env, folder);
      await env.VAULT_BUCKET.put(meta.path, blob, {
        httpMetadata: { contentType: meta.mime },
        sha256: meta.sha256,
      });
      const textContent = extractTextContent(meta.mime, meta.path, blob);
      const rows = (await db(env).upsert("files", {
        path: meta.path,
        size: meta.size,
        sha256: meta.sha256,
        mime: meta.mime,
        folder,
        text_content: textContent,
        updated_at: new Date().toISOString(),
        needs_embedding: true,
        needs_linking: true,
        needs_tagging: true,
      })) as VaultFile[];
      if (rows[0]?.id) {
        await db(env).upsert("architect_jobs", {
          file_id: rows[0].id,
          status: "pending",
          updated_at: new Date().toISOString(),
        });
        kickArchitect(env, rows[0].id, ctx);
      }
      return Response.json(rows[0], { status: 201 });
    }

    // POST /files/:id/embedding - The Architect posts the embedding vector.
    if (method === "POST" && fileId && sub === "embedding") {
      const body = (await request.json()) as { embedding?: unknown; text_preview?: unknown };
      if (!isValidEmbedding(body.embedding)) {
        return new Response(
          `embedding must be an array of ${EMBEDDING_DIMENSIONS} finite numbers`,
          { status: 400 },
        );
      }
      const textPreview = typeof body.text_preview === "string" ? body.text_preview : "";
      await db(env).upsert("embeddings", {
        file_id: fileId,
        embedding: JSON.stringify(body.embedding),
        text_preview: textPreview,
        embedded_at: new Date().toISOString(),
      });
      await db(env).patch("files", fileId, { needs_embedding: false });
      return new Response(null, { status: 204 });
    }

    // PATCH /files/:id — update path, folder, tags, etc.
    // When path changes, copy R2 object to the new key and delete the old one
    // so renames don't leave orphan blobs.
    if (method === "PATCH" && fileId && !sub) {
      const body = (await request.json()) as Partial<VaultFile>;
      if (typeof body.path === "string") {
        const current = (await db(env).query("files", {
          id: `eq.${fileId}`,
          select: "path",
        })) as { path: string }[];
        if (!current.length) return new Response("Not found", { status: 404 });
        const oldPath = current[0].path;
        const newPath = body.path;
        if (oldPath !== newPath) {
          await ensureFolderRows(env, folderFromPath(newPath));
          const obj = await env.VAULT_BUCKET.get(oldPath);
          if (obj) {
            await env.VAULT_BUCKET.put(newPath, obj.body, {
              httpMetadata: obj.httpMetadata,
            });
            await env.VAULT_BUCKET.delete(oldPath);
          }
        }
        (body as Record<string, unknown>).folder = folderFromPath(newPath);
      }
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

    // DELETE /files?path=<relpath> - remove by path for legacy clients.
    if (method === "DELETE" && !fileId) {
      const targetPath = url.searchParams.get("path");
      if (!targetPath) return new Response("Missing path query param", { status: 400 });
      const rows = (await db(env).query("files", {
        path: `eq.${targetPath}`,
        select: "id,path",
      })) as { id: string; path: string }[];
      if (!rows.length) return new Response(null, { status: 204 });
      await env.VAULT_BUCKET.delete(rows[0].path);
      await db(env).delete("files", rows[0].id);
      return new Response(null, { status: 204 });
    }

    return new Response("Method not allowed", { status: 405 });
  } catch (err) {
    console.error(err);
    return new Response(String(err), { status: 500 });
  }
}

function kickArchitect(env: Env, fileId: string, ctx?: ExecutionContext): void {
  if (!ctx) return;
  ctx.waitUntil(
    runLinkerForFile(env, fileId).catch((err) =>
      console.error(`[files] linker failed for ${fileId}:`, err),
    ),
  );
  ctx.waitUntil(
    runTaggerForFile(env, fileId).catch((err) =>
      console.error(`[files] tagger failed for ${fileId}:`, err),
    ),
  );
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

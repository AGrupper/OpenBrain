import type { Env } from "../app";
import type {
  FileSourceType,
  SyncItem,
  SyncSource,
  SyncSummary,
  VaultFile,
} from "@openbrain/shared";
import { runLinkerForFile, runTaggerForFile, runWikiBuilderForFile } from "../jobs";
import { ensureFolderRows } from "./folders";
import { extractTextContent, sha256Hex } from "./files";
import { db } from "../lib/supabase";

const NOTION_VERSION = "2026-03-11";
const DEFAULT_NOTION_FOLDER = "Resources/Notion";
const DEFAULT_APPLE_NOTES_FOLDER = "Resources/Apple Notes";

interface AppleNotesImportEntry {
  relative_path?: unknown;
  content_base64?: unknown;
  mime?: unknown;
  modified_at?: unknown;
}

export async function handleSync(
  request: Request,
  env: Env,
  url: URL,
  ctx?: ExecutionContext,
): Promise<Response> {
  const segments = url.pathname
    .replace(/^\/sync/, "")
    .split("/")
    .filter(Boolean);
  const resource = segments[0];
  const action = segments[1];

  try {
    if (request.method === "GET" && resource === "sources" && !action) {
      const rows = await db(env).query("sync_sources", {
        select: "*",
        order: "updated_at.desc",
        limit: "100",
      });
      return Response.json(rows);
    }

    if (request.method === "POST" && resource === "notion" && action === "run") {
      return Response.json(await runNotionSync(request, env, ctx));
    }

    if (request.method === "POST" && resource === "apple-notes" && action === "files") {
      return Response.json(await importAppleNotesFiles(request, env, ctx));
    }

    if (["sources", "notion", "apple-notes"].includes(resource ?? "")) {
      return new Response("Method not allowed", { status: 405 });
    }
    return new Response("Not found", { status: 404 });
  } catch (err) {
    console.error("[sync]", err);
    return new Response(String(err), { status: 500 });
  }
}

async function runNotionSync(
  request: Request,
  env: Env,
  ctx?: ExecutionContext,
): Promise<SyncSummary> {
  if (!env.NOTION_API_KEY) throw new Error("NOTION_API_KEY is not configured in Worker env");
  const body = (await request.json().catch(() => ({}))) as {
    query?: unknown;
    folder?: unknown;
    limit?: unknown;
  };
  const folder =
    normalizeFolder(typeof body.folder === "string" ? body.folder : null) ?? DEFAULT_NOTION_FOLDER;
  const limit = Math.min(Math.max(Number(body.limit ?? 20) || 20, 1), 50);
  const source = await ensureSyncSource(env, "notion", "Notion", { folder });
  const pages = await searchNotionPages(
    env,
    typeof body.query === "string" ? body.query : "",
    limit,
  );
  const summary = emptySummary();

  for (const page of pages) {
    try {
      if (page.in_trash) {
        summary.skipped += 1;
        continue;
      }
      const title = notionPageTitle(page) || "Untitled Notion Page";
      const markdown = await notionPageMarkdown(env, page.id, title);
      const content = `# ${title}\n\n${markdown.trim() || "_No readable page content returned by Notion._"}`;
      const fileFolder =
        typeof body.folder === "string" && body.folder.trim()
          ? folder
          : await chooseSyncFolder(env, {
              title,
              sourceUrl: page.url ?? "",
              content,
              fallback: folder,
            });
      const bytes = new TextEncoder().encode(content);
      const hash = await sha256Hex(bytes);
      const existing = await findSyncItem(env, source.id, page.id);
      if (existing?.content_hash === hash && existing.file_id) {
        summary.skipped += 1;
        continue;
      }
      await upsertSyncedFile(env, ctx, {
        source,
        externalId: page.id,
        externalUrl: page.url ?? null,
        sourceType: "notion",
        title,
        folder: fileFolder,
        bytes,
        mime: "text/markdown",
        textContent: content,
        extension: "md",
        contentHash: hash,
        metadata: { last_edited_time: page.last_edited_time ?? null },
      });
      summary.imported += 1;
    } catch (err) {
      summary.failed += 1;
      summary.failures?.push({ external_id: page.id, error: String(err) });
    }
  }

  await patchSyncSource(env, source.id, {
    status: summary.failed ? "error" : "active",
    last_synced_at: new Date().toISOString(),
    last_error: summary.failed ? `${summary.failed} Notion item(s) failed` : null,
  });
  return summary;
}

async function importAppleNotesFiles(
  request: Request,
  env: Env,
  ctx?: ExecutionContext,
): Promise<SyncSummary> {
  const body = (await request.json()) as {
    source_name?: unknown;
    folder?: unknown;
    files?: unknown;
  };
  const sourceName =
    typeof body.source_name === "string" && body.source_name.trim()
      ? body.source_name.trim()
      : "Apple Notes Export";
  const folder =
    normalizeFolder(typeof body.folder === "string" ? body.folder : null) ??
    DEFAULT_APPLE_NOTES_FOLDER;
  const entries = Array.isArray(body.files) ? (body.files as AppleNotesImportEntry[]) : [];
  const source = await ensureSyncSource(env, "apple_notes", sourceName, { folder });
  const summary = emptySummary();

  for (const entry of entries) {
    const relativePath =
      typeof entry.relative_path === "string" ? normalizeRelativePath(entry.relative_path) : null;
    const contentBase64 = typeof entry.content_base64 === "string" ? entry.content_base64 : null;
    if (!relativePath || !contentBase64) {
      summary.failed += 1;
      summary.failures?.push({
        external_id: relativePath ?? "unknown",
        error: "Invalid file entry",
      });
      continue;
    }

    try {
      const bytes = base64ToBytes(contentBase64);
      const mime = typeof entry.mime === "string" ? entry.mime : mimeFromPath(relativePath);
      const textContent = await extractTextContent(mime, relativePath, bytesToArrayBuffer(bytes));
      const hash = await sha256Hex(bytes);
      const externalId = `${sourceName}:${relativePath}`;
      const existing = await findSyncItem(env, source.id, externalId);
      if (existing?.content_hash === hash && existing.file_id) {
        summary.skipped += 1;
        continue;
      }
      const fileFolder =
        typeof body.folder === "string" && body.folder.trim()
          ? folder
          : await chooseSyncFolder(env, {
              title: relativePath.split("/").pop() ?? relativePath,
              sourceUrl: relativePath,
              content: textContent ?? "",
              fallback: folder,
            });
      await upsertSyncedFile(env, ctx, {
        source,
        externalId,
        externalUrl: `apple-notes-export://${encodeURIComponent(sourceName)}/${relativePath}`,
        sourceType: "apple_notes",
        title: relativePath.split("/").pop() ?? "Apple Note",
        folder: fileFolder,
        bytes,
        mime,
        textContent,
        extension: extensionFromPath(relativePath) || "md",
        contentHash: hash,
        metadata: { relative_path: relativePath, modified_at: entry.modified_at ?? null },
      });
      summary.imported += 1;
    } catch (err) {
      summary.failed += 1;
      summary.failures?.push({ external_id: relativePath, error: String(err) });
    }
  }

  await patchSyncSource(env, source.id, {
    status: summary.failed ? "error" : "active",
    last_synced_at: new Date().toISOString(),
    last_error: summary.failed ? `${summary.failed} Apple Notes item(s) failed` : null,
  });
  return summary;
}

async function upsertSyncedFile(
  env: Env,
  ctx: ExecutionContext | undefined,
  input: {
    source: SyncSource;
    externalId: string;
    externalUrl: string | null;
    sourceType: FileSourceType;
    title: string;
    folder: string;
    bytes: Uint8Array;
    mime: string;
    textContent: string | null;
    extension: string;
    contentHash: string;
    metadata: Record<string, unknown>;
  },
): Promise<VaultFile> {
  const existing = await findSyncItem(env, input.source.id, input.externalId);
  const path = existing?.file_id
    ? await existingFilePath(env, existing.file_id)
    : await uniqueSyncedPath(env, input.folder, input.title, input.extension);
  const textContent = input.textContent;
  const shouldBuildWiki = Boolean(textContent?.trim());

  await ensureFolderRows(env, input.folder);
  await env.VAULT_BUCKET.put(path, input.bytes, {
    httpMetadata: { contentType: input.mime },
    sha256: input.contentHash,
  });

  const fileRow = {
    path,
    size: input.bytes.byteLength,
    sha256: input.contentHash,
    mime: input.mime,
    folder: input.folder,
    text_content: textContent,
    source_type: input.sourceType,
    source_url: input.externalUrl,
    extraction_status: shouldBuildWiki ? "extracted" : "no_text",
    extraction_error: null,
    deleted_at: null,
    deleted_reason: null,
    updated_at: new Date().toISOString(),
    needs_embedding: true,
    needs_linking: true,
    needs_tagging: true,
    needs_wiki: shouldBuildWiki,
  };

  const fileRows = existing?.file_id
    ? ((await db(env).patch("files", existing.file_id, fileRow)) as VaultFile[])
    : ((await db(env).upsert("files", fileRow)) as VaultFile[]);
  const file = fileRows[0];
  if (!file?.id) throw new Error("Synced file write returned no file id");

  const syncItemRow = {
    source_id: input.source.id,
    external_id: input.externalId,
    file_id: file.id,
    external_url: input.externalUrl,
    content_hash: input.contentHash,
    status: "synced",
    metadata: input.metadata,
    last_seen_at: new Date().toISOString(),
    last_synced_at: new Date().toISOString(),
    last_error: null,
    updated_at: new Date().toISOString(),
  };
  const existingItem = await findSyncItem(env, input.source.id, input.externalId);
  if (existingItem) await db(env).patch("sync_items", existingItem.id, syncItemRow);
  else await db(env).insert("sync_items", syncItemRow);

  kickProcessing(env, ctx, file.id, shouldBuildWiki);
  return file;
}

function kickProcessing(
  env: Env,
  ctx: ExecutionContext | undefined,
  fileId: string,
  runWiki: boolean,
) {
  if (!ctx) return;
  ctx.waitUntil(runLinkerForFile(env, fileId).catch((err) => console.error("[sync] linker", err)));
  ctx.waitUntil(runTaggerForFile(env, fileId).catch((err) => console.error("[sync] tagger", err)));
  if (runWiki) {
    ctx.waitUntil(
      runWikiBuilderForFile(env, fileId).catch((err) => console.error("[sync] wiki", err)),
    );
  }
}

async function ensureSyncSource(
  env: Env,
  type: SyncSource["type"],
  name: string,
  config: Record<string, unknown>,
): Promise<SyncSource> {
  const existing = (await db(env).query("sync_sources", {
    type: `eq.${type}`,
    name: `eq.${name}`,
    select: "*",
    limit: "1",
  })) as SyncSource[];
  if (existing[0]) {
    const rows = (await db(env).patch("sync_sources", existing[0].id, {
      config,
      status: "active",
      updated_at: new Date().toISOString(),
    })) as SyncSource[];
    return rows[0];
  }

  const rows = (await db(env).insert("sync_sources", {
    type,
    name,
    config,
    status: "active",
    updated_at: new Date().toISOString(),
  })) as SyncSource[];
  return rows[0];
}

async function patchSyncSource(env: Env, id: string, patch: Record<string, unknown>) {
  await db(env).patch("sync_sources", id, { ...patch, updated_at: new Date().toISOString() });
}

async function findSyncItem(
  env: Env,
  sourceId: string,
  externalId: string,
): Promise<SyncItem | null> {
  const rows = (await db(env).query("sync_items", {
    source_id: `eq.${sourceId}`,
    external_id: `eq.${externalId}`,
    select: "*",
    limit: "1",
  })) as SyncItem[];
  return rows[0] ?? null;
}

async function existingFilePath(env: Env, fileId: string): Promise<string> {
  const rows = (await db(env).query("files", {
    id: `eq.${fileId}`,
    select: "path",
    limit: "1",
  })) as Pick<VaultFile, "path">[];
  if (!rows[0]?.path) throw new Error("Synced file no longer exists");
  return rows[0].path;
}

async function uniqueSyncedPath(
  env: Env,
  folder: string,
  title: string,
  extension: string,
): Promise<string> {
  const safeTitle = sanitizeFileName(title.replace(/\.[a-z0-9]+$/i, "")) || "Untitled";
  const safeExtension = sanitizeFileName(extension.replace(/^\./, "")) || "md";
  for (let index = 1; index < 1000; index += 1) {
    const suffix = index === 1 ? "" : ` ${index}`;
    const path = `${folder}/${safeTitle}${suffix}.${safeExtension}`;
    const rows = (await db(env).query("files", {
      path: `eq.${path}`,
      select: "id",
      limit: "1",
    })) as Pick<VaultFile, "id">[];
    if (!rows.length) return path;
  }
  return `${folder}/${safeTitle}-${Date.now()}.${safeExtension}`;
}

async function chooseSyncFolder(
  env: Env,
  input: { title: string; sourceUrl: string; content: string; fallback: string },
): Promise<string> {
  let folders: Array<{ path: string }> = [];
  try {
    folders = (await db(env).query("folders", {
      select: "path",
      limit: "500",
    })) as Array<{ path: string }>;
  } catch {
    return input.fallback;
  }

  const haystack = `${input.title} ${input.sourceUrl} ${input.content}`.toLowerCase();
  const candidates = folders
    .map((folder) => folder.path)
    .filter((path) => path && !["Projects", "Areas", "Resources", "Archive"].includes(path))
    .map((path) => ({ path, score: folderMatchScore(path, haystack) }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || b.path.length - a.path.length);

  return candidates[0]?.path ?? input.fallback;
}

function folderMatchScore(path: string, haystack: string): number {
  return path
    .split("/")
    .flatMap((part) => part.split(/[\s_-]+/))
    .map((part) => part.toLowerCase())
    .filter((part) => part.length >= 4)
    .reduce((score, token) => score + (haystack.includes(token) ? 1 : 0), 0);
}

async function searchNotionPages(env: Env, query: string, limit: number): Promise<NotionPage[]> {
  const pages: NotionPage[] = [];
  let cursor: string | null = null;
  while (pages.length < limit) {
    const body: Record<string, unknown> = {
      page_size: Math.min(100, limit - pages.length),
      filter: { property: "object", value: "page" },
      sort: { direction: "descending", timestamp: "last_edited_time" },
    };
    if (query.trim()) body.query = query.trim();
    if (cursor) body.start_cursor = cursor;
    const result = await notionFetch<NotionList<NotionPage>>(env, "/v1/search", {
      method: "POST",
      body: JSON.stringify(body),
    });
    pages.push(...result.results);
    if (!result.has_more || !result.next_cursor) break;
    cursor = result.next_cursor;
  }
  return pages.slice(0, limit);
}

async function notionPageMarkdown(env: Env, pageId: string, title: string): Promise<string> {
  const blocks = await notionBlockChildren(env, pageId);
  const lines = [`Source: Notion page "${title}"`, ""];
  for (const block of blocks) {
    lines.push(blockToMarkdown(block));
    if (block.has_children) {
      const children = await notionBlockChildren(env, block.id);
      for (const child of children) lines.push(`  ${blockToMarkdown(child)}`);
    }
  }
  return lines.filter((line) => line.trim()).join("\n\n");
}

async function notionBlockChildren(env: Env, blockId: string): Promise<NotionBlock[]> {
  const blocks: NotionBlock[] = [];
  let cursor: string | null = null;
  do {
    const qs = new URLSearchParams({ page_size: "100" });
    if (cursor) qs.set("start_cursor", cursor);
    const result = await notionFetch<NotionList<NotionBlock>>(
      env,
      `/v1/blocks/${blockId}/children?${qs}`,
      { method: "GET" },
    );
    blocks.push(...result.results);
    cursor = result.has_more ? result.next_cursor : null;
  } while (cursor);
  return blocks;
}

async function notionFetch<T>(env: Env, path: string, init: RequestInit): Promise<T> {
  const res = await fetch(`https://api.notion.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.NOTION_API_KEY}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`Notion API failed ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

function blockToMarkdown(block: NotionBlock): string {
  const data = block[block.type] as Record<string, unknown> | undefined;
  const text = richTextPlain(data?.rich_text);
  if (!text && block.type !== "divider") return "";
  if (block.type === "heading_1") return `# ${text}`;
  if (block.type === "heading_2") return `## ${text}`;
  if (block.type === "heading_3" || block.type === "heading_4") return `### ${text}`;
  if (block.type === "bulleted_list_item") return `- ${text}`;
  if (block.type === "numbered_list_item") return `1. ${text}`;
  if (block.type === "to_do") return `- [ ] ${text}`;
  if (block.type === "quote") return `> ${text}`;
  if (block.type === "code") return `\`\`\`\n${text}\n\`\`\``;
  if (block.type === "divider") return "---";
  if (block.type === "child_page") return `## ${String(data?.title ?? "Child page")}`;
  return text;
}

function notionPageTitle(page: NotionPage): string | null {
  for (const value of Object.values(page.properties ?? {})) {
    if (value?.type === "title") {
      const title = richTextPlain(value.title);
      if (title) return title;
    }
  }
  return null;
}

function richTextPlain(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value
    .map((part) => (typeof part?.plain_text === "string" ? part.plain_text : ""))
    .join("")
    .trim();
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function emptySummary(): SyncSummary {
  return { imported: 0, skipped: 0, failed: 0, failures: [] };
}

function normalizeFolder(input: string | null): string | null {
  const normalized = input
    ?.replaceAll("\\", "/")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean)
    .join("/");
  return normalized || null;
}

function normalizeRelativePath(input: string): string | null {
  const normalized = input
    .replaceAll("\\", "/")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean)
    .join("/");
  if (!normalized || normalized.includes("..")) return null;
  return normalized;
}

function sanitizeFileName(input: string): string {
  return input
    .replace(/[<>:"|?*]/g, "-")
    .replace(/[\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+|\.+$/g, "");
}

function extensionFromPath(path: string): string | null {
  return path.split("/").pop()?.split(".").pop()?.toLowerCase() ?? null;
}

function mimeFromPath(path: string): string {
  const ext = extensionFromPath(path);
  if (ext === "md" || ext === "markdown") return "text/markdown";
  if (ext === "txt") return "text/plain";
  if (ext === "html" || ext === "htm") return "text/html";
  if (ext === "pdf") return "application/pdf";
  return "application/octet-stream";
}

interface NotionList<T> {
  results: T[];
  has_more: boolean;
  next_cursor: string | null;
}

interface NotionPage {
  id: string;
  url?: string;
  in_trash?: boolean;
  last_edited_time?: string;
  properties?: Record<string, { type?: string; title?: unknown }>;
}

interface NotionBlock {
  id: string;
  type: string;
  has_children?: boolean;
  [key: string]: unknown;
}

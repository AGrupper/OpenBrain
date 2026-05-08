import type { Env } from "../app";
import type { SearchResult, VaultFile, WikiNodeKind, WikiNodeStatus } from "@openbrain/shared";

function db(env: Env) {
  const base = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_KEY;
  return {
    async rpc(fn: string, args: Record<string, unknown>) {
      const res = await fetch(`${base}/rest/v1/rpc/${fn}`, {
        method: "POST",
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(args),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    async query(table: string, params: Record<string, string> = {}) {
      const qs = new URLSearchParams(params);
      const res = await fetch(`${base}/rest/v1/${table}?${qs}`, {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  };
}

interface SearchRow {
  id: string;
  path: string;
  size: number;
  sha256: string;
  mime: string;
  updated_at: string;
}

interface FtsSearchRow extends SearchRow {
  rank: number;
  snippet: string;
}

interface WikiNodeSearchRef {
  id: string;
  kind: WikiNodeKind;
  title: string;
  status: WikiNodeStatus;
  source_file_id: string | null;
}

interface WikiPageSearchRow {
  id: string;
  title: string;
  content: string;
  wiki_nodes: WikiNodeSearchRef | WikiNodeSearchRef[] | null;
}

function toVaultFile(row: SearchRow): VaultFile {
  return {
    id: row.id,
    path: row.path,
    size: row.size,
    sha256: row.sha256,
    mime: row.mime,
    updated_at: row.updated_at,
  } satisfies VaultFile;
}

function tokenizeSearchQuery(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2);
}

function pathMatchScore(path: string, query: string): number {
  const pathLower = path.toLowerCase();
  const queryLower = query.toLowerCase();
  const fileName = pathLower.split("/").pop() ?? pathLower;
  if (pathLower === queryLower || fileName === queryLower) return 1;
  if (fileName.includes(queryLower)) return 0.75;
  return 0.6;
}

function normalizeWikiNode(row: WikiPageSearchRow): WikiNodeSearchRef | null {
  return Array.isArray(row.wiki_nodes) ? (row.wiki_nodes[0] ?? null) : row.wiki_nodes;
}

function scoreWikiPage(row: WikiPageSearchRow, terms: string[], query: string): number {
  const node = normalizeWikiNode(row);
  if (!node || node.status === "archived") return 0;

  const haystack = `${row.title ?? ""} ${node.title ?? ""} ${row.content ?? ""}`.toLowerCase();
  const exact = query.toLowerCase();
  if (exact && haystack.includes(exact)) return 0.92;

  const matches = terms.filter((term) => haystack.includes(term)).length;
  if (matches === 0) return 0;

  return 0.5 + matches / Math.max(terms.length, 1) / 3;
}

function makeWikiSnippet(content: string, terms: string[], fallback: string): string {
  const text = (content || fallback).replace(/\s+/g, " ").trim();
  if (!text) return fallback;

  const lower = text.toLowerCase();
  const term = terms.find((candidate) => lower.includes(candidate));
  if (!term) return text.slice(0, 220);

  const index = lower.indexOf(term);
  const start = Math.max(0, index - 80);
  const end = Math.min(text.length, index + term.length + 140);
  const before = text.slice(start, index);
  const match = text.slice(index, index + term.length);
  const after = text.slice(index + term.length, end);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < text.length ? "..." : "";
  return `${prefix}${before}**${match}**${after}${suffix}`;
}

async function searchWikiPages(env: Env, query: string, limit: number): Promise<SearchResult[]> {
  const terms = tokenizeSearchQuery(query);
  if (terms.length === 0) return [];

  const rows = (await db(env).query("wiki_pages", {
    select: "id,title,content,wiki_nodes(id,kind,title,status,source_file_id)",
    order: "updated_at.desc",
    limit: "100",
    "wiki_nodes.status": "in.(draft,published)",
  })) as WikiPageSearchRow[];

  const scored = rows
    .map((row) => ({ row, node: normalizeWikiNode(row), score: scoreWikiPage(row, terms, query) }))
    .filter(
      (
        item,
      ): item is {
        row: WikiPageSearchRow;
        node: WikiNodeSearchRef;
        score: number;
      } => Boolean(item.node?.source_file_id) && item.score > 0,
    )
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  const sourceIds = [
    ...new Set(
      scored.map((item) => item.node.source_file_id).filter((id): id is string => Boolean(id)),
    ),
  ];
  if (sourceIds.length === 0) return [];

  const sourceRows = (await db(env).query("files", {
    id: `in.(${sourceIds.join(",")})`,
    select: "id,path,size,sha256,mime,updated_at",
    limit: String(sourceIds.length),
  })) as SearchRow[];
  const sourcesById = new Map(sourceRows.map((row) => [row.id, toVaultFile(row)]));

  const results: SearchResult[] = [];
  for (const { row, node, score } of scored) {
    const file = node.source_file_id ? sourcesById.get(node.source_file_id) : undefined;
    if (!file) continue;
    const title = node.title || row.title;
    results.push({
      file,
      score,
      snippet: makeWikiSnippet(row.content, terms, title),
      result_kind: "wiki",
      title,
      wiki_node_id: node.id,
      wiki_node_kind: node.kind,
    });
  }

  return results;
}

export async function handleSearch(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });

  const query = url.searchParams.get("q") ?? "";
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "5"), 50);

  if (!query.trim()) return Response.json({ results: [], total: 0 });

  try {
    // Full-text search via Postgres FTS (fast, keyword-based)
    const ftsResults = (await db(env).rpc("search_files", {
      query_text: query,
      result_limit: limit,
    })) as FtsSearchRow[];

    const pathResults = (await db(env).query("files", {
      path: `ilike.*${query.trim()}*`,
      select: "id,path,size,sha256,mime,updated_at",
      limit: String(limit),
      order: "updated_at.desc",
    })) as SearchRow[];

    const resultsById = new Map<string, SearchResult>();
    for (const row of ftsResults) {
      resultsById.set(row.id, {
        file: toVaultFile(row),
        score: row.rank,
        snippet: row.snippet,
        result_kind: "file",
      });
    }
    for (const row of pathResults) {
      if (resultsById.has(row.id)) continue;
      resultsById.set(row.id, {
        file: toVaultFile(row),
        score: pathMatchScore(row.path, query.trim()),
        snippet: `Path match: **${row.path}**`,
        result_kind: "file",
      });
    }

    const wikiResults = await searchWikiPages(env, query.trim(), limit);
    const results = [...resultsById.values(), ...wikiResults]
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return Response.json({ results, total: results.length });
  } catch (err) {
    console.error(err);
    return new Response(String(err), { status: 500 });
  }
}

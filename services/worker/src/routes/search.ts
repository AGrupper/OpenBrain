import type { Env } from "../app";
import type { SearchResult, VaultFile } from "@openbrain/shared";

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

function pathMatchScore(path: string, query: string): number {
  const pathLower = path.toLowerCase();
  const queryLower = query.toLowerCase();
  const fileName = pathLower.split("/").pop() ?? pathLower;
  if (pathLower === queryLower || fileName === queryLower) return 1;
  if (fileName.includes(queryLower)) return 0.75;
  return 0.6;
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
      });
    }
    for (const row of pathResults) {
      if (resultsById.has(row.id)) continue;
      resultsById.set(row.id, {
        file: toVaultFile(row),
        score: pathMatchScore(row.path, query.trim()),
        snippet: `Path match: **${row.path}**`,
      });
    }

    const results = [...resultsById.values()].slice(0, limit);

    return Response.json({ results, total: results.length });
  } catch (err) {
    console.error(err);
    return new Response(String(err), { status: 500 });
  }
}

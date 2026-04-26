import type { Env } from "../index";
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
    })) as Array<{
      id: string;
      path: string;
      size: number;
      sha256: string;
      mime: string;
      updated_at: string;
      rank: number;
      snippet: string;
    }>;

    const results: SearchResult[] = ftsResults.map((row) => ({
      file: {
        id: row.id,
        path: row.path,
        size: row.size,
        sha256: row.sha256,
        mime: row.mime,
        updated_at: row.updated_at,
      } satisfies VaultFile,
      score: row.rank,
      snippet: row.snippet,
    }));

    return Response.json({ results, total: results.length });
  } catch (err) {
    console.error(err);
    return new Response(String(err), { status: 500 });
  }
}

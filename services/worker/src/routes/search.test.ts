import { describe, it, expect, beforeEach, vi } from "vitest";
import { handleSearch } from "./search";
import type { Env } from "../app";

function makeEnv(): Env {
  return {
    SUPABASE_URL: "https://stub.supabase.co",
    SUPABASE_SERVICE_KEY: "service-key",
    TELEGRAM_BOT_TOKEN: "tk",
    TELEGRAM_CHAT_ID: "1",
    OPENBRAIN_AUTH_TOKEN: "tk",
    VAULT_BUCKET: {} as R2Bucket,
  };
}

describe("handleSearch", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns 405 for non-GET", async () => {
    const env = makeEnv();
    const req = new Request("https://api.openbrain.dev/search?q=foo", { method: "POST" });
    const res = await handleSearch(req, env, new URL(req.url));
    expect(res.status).toBe(405);
  });

  it("returns empty results for blank query without calling Supabase", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const env = makeEnv();
    const req = new Request("https://api.openbrain.dev/search?q=", { method: "GET" });
    const res = await handleSearch(req, env, new URL(req.url));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ results: [], total: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("clamps limit to a maximum of 50", async () => {
    let receivedBody: { result_limit?: number } = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input, init?: RequestInit) => {
        if (init?.body) receivedBody = JSON.parse(String(init.body));
        return new Response(JSON.stringify([]), { status: 200 });
      }),
    );
    const env = makeEnv();
    const req = new Request("https://api.openbrain.dev/search?q=cooking&limit=999", {
      method: "GET",
    });
    await handleSearch(req, env, new URL(req.url));
    expect(receivedBody.result_limit).toBe(50);
  });

  it("maps Supabase RPC rows into SearchResult shape", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (input) =>
          new Response(
            JSON.stringify(
              String(input).includes("/rpc/search_files")
                ? [
                    {
                      id: "f1",
                      path: "kitchen.md",
                      size: 100,
                      sha256: "abc",
                      mime: "text/markdown",
                      updated_at: "2026-01-01",
                      rank: 0.9,
                      snippet: "...kitchen tools...",
                    },
                  ]
                : [],
            ),
            { status: 200 },
          ),
      ),
    );
    const env = makeEnv();
    const req = new Request("https://api.openbrain.dev/search?q=kitchen", { method: "GET" });
    const res = await handleSearch(req, env, new URL(req.url));
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      results: Array<{ score: number; snippet: string; file: { path: string } }>;
    };
    expect(data.results).toHaveLength(1);
    expect(data.results[0].file.path).toBe("kitchen.md");
    expect(data.results[0].score).toBe(0.9);
    expect(data.results[0].snippet).toContain("kitchen");
  });

  it("returns filename/path matches when full-text search has no result", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (input) =>
          new Response(
            JSON.stringify(
              String(input).includes("/rpc/search_files")
                ? []
                : [
                    {
                      id: "f2",
                      path: "Inbox/readme.md",
                      size: 219,
                      sha256: "def",
                      mime: "text/markdown",
                      updated_at: "2026-05-01",
                    },
                  ],
            ),
            { status: 200 },
          ),
      ),
    );
    const env = makeEnv();
    const req = new Request("https://api.openbrain.dev/search?q=readme.md", { method: "GET" });
    const res = await handleSearch(req, env, new URL(req.url));
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      results: Array<{ score: number; snippet: string; file: { path: string } }>;
      total: number;
    };
    expect(data.total).toBe(1);
    expect(data.results[0].file.path).toBe("Inbox/readme.md");
    expect(data.results[0].score).toBe(1);
    expect(data.results[0].snippet).toContain("Path match");
  });

  it("dedupes path matches already returned by full-text search", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (input) =>
          new Response(
            JSON.stringify([
              {
                id: "f1",
                path: "notes/kitchen.md",
                size: 100,
                sha256: "abc",
                mime: "text/markdown",
                updated_at: "2026-01-01",
                rank: String(input).includes("/rpc/search_files") ? 0.9 : undefined,
                snippet: String(input).includes("/rpc/search_files")
                  ? "...kitchen tools..."
                  : undefined,
              },
            ]),
            { status: 200 },
          ),
      ),
    );
    const env = makeEnv();
    const req = new Request("https://api.openbrain.dev/search?q=kitchen", { method: "GET" });
    const res = await handleSearch(req, env, new URL(req.url));
    const data = (await res.json()) as {
      results: Array<{ score: number; snippet: string; file: { path: string } }>;
      total: number;
    };
    expect(data.total).toBe(1);
    expect(data.results[0].score).toBe(0.9);
    expect(data.results[0].snippet).toBe("...kitchen tools...");
  });

  it("returns matching wiki pages with their underlying source file", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input) => {
        const url = String(input);
        if (url.includes("/rpc/search_files")) return new Response(JSON.stringify([]));
        if (url.includes("/wiki_pages")) {
          return new Response(
            JSON.stringify([
              {
                id: "page-1",
                title: "Draft citation synthesis",
                content: "The wiki draft explains chunk citations from saved source text.",
                wiki_nodes: {
                  id: "node-1",
                  kind: "synthesis",
                  title: "Draft citation synthesis",
                  status: "draft",
                  source_file_id: "file-1",
                },
              },
            ]),
            { status: 200 },
          );
        }
        if (url.includes("/files?") && url.includes("id=in.")) {
          return new Response(
            JSON.stringify([
              {
                id: "file-1",
                path: "Resources/wiki-source.md",
                size: 100,
                sha256: "abc",
                mime: "text/markdown",
                updated_at: "2026-05-08",
              },
            ]),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify([]), { status: 200 });
      }),
    );

    const env = makeEnv();
    const req = new Request("https://api.openbrain.dev/search?q=draft citations", {
      method: "GET",
    });
    const res = await handleSearch(req, env, new URL(req.url));
    const data = (await res.json()) as {
      results: Array<{
        result_kind: string;
        title: string;
        wiki_node_kind: string;
        snippet: string;
        file: { path: string };
      }>;
    };

    expect(res.status).toBe(200);
    expect(data.results).toHaveLength(1);
    expect(data.results[0]).toMatchObject({
      result_kind: "wiki",
      title: "Draft citation synthesis",
      wiki_node_kind: "synthesis",
      file: { path: "Resources/wiki-source.md" },
    });
    expect(data.results[0].snippet).toContain("**draft**");
  });
});

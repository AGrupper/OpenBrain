import { describe, expect, it, vi, beforeEach, type Mock } from "vitest";
import { handleArchitect } from "./architect";
import type { Env } from "../app";
import {
  runLinker,
  runLinkerForFile,
  runTagger,
  runTaggerForFile,
  runWikiBuilder,
  runWikiBuilderForFile,
} from "../jobs";

vi.mock("../jobs", () => ({
  runLinker: vi.fn(async () => undefined),
  runLinkerForFile: vi.fn(async () => undefined),
  runTagger: vi.fn(async () => undefined),
  runTaggerForFile: vi.fn(async () => undefined),
  runWikiBuilder: vi.fn(async () => undefined),
  runWikiBuilderForFile: vi.fn(async () => undefined),
}));

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    SUPABASE_URL: "https://stub.supabase.co",
    SUPABASE_SERVICE_KEY: "service-key",
    TELEGRAM_BOT_TOKEN: "telegram-token",
    TELEGRAM_CHAT_ID: "12345",
    OPENBRAIN_AUTH_TOKEN: "auth-token",
    OPENAI_API_KEY: "openai-key",
    ARCHITECT_MODEL: "test-model",
    VAULT_BUCKET: {} as R2Bucket,
    ...overrides,
  };
}

interface FetchCall {
  url: string;
  method: string;
  body?: unknown;
}

function recordFetch(responses: Array<(call: FetchCall) => Response | Promise<Response>>): {
  mock: Mock;
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  let i = 0;
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";
    let body: unknown;
    if (init?.body && typeof init.body === "string") {
      body = JSON.parse(init.body);
    }
    calls.push({ url, method, body });
    const handler = responses[i] ?? responses[responses.length - 1];
    i += 1;
    return handler({ url, method, body });
  });
  vi.stubGlobal("fetch", mock);
  return { mock, calls };
}

describe("handleArchitect - chat", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("refuses when no vault sources support the question", async () => {
    const { calls } = recordFetch([
      () => new Response(JSON.stringify([]), { status: 200 }),
      () => new Response(JSON.stringify([]), { status: 200 }),
      () => new Response(JSON.stringify([{ id: "session-1" }]), { status: 201 }),
      () => new Response(JSON.stringify([{ id: "message-user" }]), { status: 201 }),
      () => new Response(JSON.stringify([{ id: "message-answer" }]), { status: 201 }),
    ]);

    const req = new Request("https://api.openbrain.dev/architect/chat", {
      method: "POST",
      body: JSON.stringify({ message: "What do I know about Project X?" }),
    });

    const res = await handleArchitect(req, makeEnv(), new URL(req.url));
    const body = (await res.json()) as { answer: string; sources: unknown[] };

    expect(res.status).toBe(200);
    expect(body.answer).toContain("I do not know from the vault");
    expect(body.sources).toEqual([]);
    expect(calls.some((call) => call.url.includes("api.openai.com"))).toBe(false);
  });

  it("sends only retrieved vault context to the LLM and returns citations", async () => {
    const { calls } = recordFetch([
      () =>
        new Response(
          JSON.stringify([
            {
              id: "file-1",
              path: "Projects/OpenBrain/plan.md",
              rank: 0.9,
              snippet: "OpenBrain uses The Architect for vault-grounded chat.",
            },
          ]),
          { status: 200 },
        ),
      () => new Response(JSON.stringify([]), { status: 200 }),
      () => new Response(JSON.stringify([{ id: "session-1" }]), { status: 201 }),
      () => new Response(JSON.stringify([{ id: "message-user" }]), { status: 201 }),
      () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "The vault says OpenBrain uses The Architect. [1]" } }],
          }),
          { status: 200 },
        ),
      () => new Response(JSON.stringify([{ id: "message-answer" }]), { status: 201 }),
      () => new Response(JSON.stringify([{ id: "source-1" }]), { status: 201 }),
    ]);

    const req = new Request("https://api.openbrain.dev/architect/chat", {
      method: "POST",
      body: JSON.stringify({ message: "What powers OpenBrain chat?" }),
    });

    const res = await handleArchitect(req, makeEnv(), new URL(req.url));
    const body = (await res.json()) as {
      answer: string;
      sources: Array<{ file_id: string; path: string; snippet: string; score: number }>;
    };

    expect(res.status).toBe(200);
    expect(body.answer).toContain("[1]");
    expect(body.sources).toHaveLength(1);
    expect(body.sources[0]).toMatchObject({
      file_id: "file-1",
      path: "Projects/OpenBrain/plan.md",
      snippet: "OpenBrain uses The Architect for vault-grounded chat.",
    });
    // score is now the RRF combined score (1 / (60 + 1)) since this hit only the FTS list
    expect(body.sources[0].score).toBeCloseTo(1 / 61);

    const llmCall = calls.find((call) => call.url.includes("api.openai.com"));
    expect(llmCall?.body).toMatchObject({ model: "test-model" });
    expect(JSON.stringify(llmCall?.body)).toContain("OpenBrain uses The Architect");
  });

  it("uses matching wiki pages as vault chat sources", async () => {
    const { calls } = recordFetch([
      () => new Response(JSON.stringify([]), { status: 200 }),
      () =>
        new Response(
          JSON.stringify([
            {
              id: "page-1",
              title: "OpenBrain synthesis",
              content: "The Architect Wiki says OpenBrain keeps draft claims cited to chunks.",
              wiki_nodes: {
                id: "wiki-1",
                kind: "synthesis",
                title: "OpenBrain synthesis",
                status: "draft",
                source_file_id: "file-source-1",
              },
            },
          ]),
          { status: 200 },
        ),
      () => new Response(JSON.stringify([{ id: "file-source-1" }]), { status: 200 }),
      () => new Response(JSON.stringify([{ id: "session-1" }]), { status: 201 }),
      () => new Response(JSON.stringify([{ id: "message-user" }]), { status: 201 }),
      () =>
        new Response(
          JSON.stringify({
            choices: [
              { message: { content: "OpenBrain keeps draft claims cited to chunks. [1]" } },
            ],
          }),
          { status: 200 },
        ),
      () => new Response(JSON.stringify([{ id: "message-answer" }]), { status: 201 }),
      () => new Response(JSON.stringify([{ id: "source-1" }]), { status: 201 }),
    ]);

    const req = new Request("https://api.openbrain.dev/architect/chat", {
      method: "POST",
      body: JSON.stringify({ message: "How does OpenBrain cite draft claims?" }),
    });

    const res = await handleArchitect(req, makeEnv(), new URL(req.url));
    const body = (await res.json()) as {
      sources: Array<{
        file_id: string;
        path: string;
        source_kind: string;
        wiki_node_id: string;
        wiki_node_kind: string;
      }>;
    };

    expect(res.status).toBe(200);
    expect(body.sources).toHaveLength(1);
    expect(body.sources[0]).toMatchObject({
      file_id: "file-source-1",
      path: "Wiki: OpenBrain synthesis",
      source_kind: "wiki",
      wiki_node_id: "wiki-1",
      wiki_node_kind: "synthesis",
    });

    const llmCall = calls.find((call) => call.url.includes("api.openai.com"));
    expect(JSON.stringify(llmCall?.body)).toContain("Wiki: OpenBrain synthesis");
    expect(
      calls.some(
        (call) =>
          call.url.includes("/architect_chat_message_sources") &&
          JSON.stringify(call.body).includes("file-source-1"),
      ),
    ).toBe(true);
  });

  it("uses current file IDE context without mixing in broad vault sources by default", async () => {
    const { calls } = recordFetch([
      () =>
        new Response(
          JSON.stringify([
            {
              id: "current-file",
              path: "Projects/OpenBrain/current.md",
              folder: "Projects/OpenBrain",
              text_content: "This selected note is about the active OpenBrain login flow.",
            },
          ]),
          { status: 200 },
        ),
      () => new Response(JSON.stringify([]), { status: 200 }),
      () => new Response(JSON.stringify([]), { status: 200 }),
      () => new Response(JSON.stringify([{ id: "session-1" }]), { status: 201 }),
      () => new Response(JSON.stringify([{ id: "message-user" }]), { status: 201 }),
      () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "The current file is about login flow. [1]" } }],
          }),
          { status: 200 },
        ),
      () => new Response(JSON.stringify([{ id: "message-answer" }]), { status: 201 }),
      () => new Response(JSON.stringify([{ id: "source-1" }]), { status: 201 }),
    ]);

    const req = new Request("https://api.openbrain.dev/architect/chat", {
      method: "POST",
      body: JSON.stringify({
        message: "What is this note about?",
        ide_context: {
          current_file_id: "current-file",
          current_path: "Projects/OpenBrain/current.md",
          current_folder: "Projects/OpenBrain",
          surface: "reader",
        },
      }),
    });

    const res = await handleArchitect(req, makeEnv(), new URL(req.url));
    const body = (await res.json()) as {
      sources: Array<{ file_id: string; path: string; evidence_scope: string }>;
    };

    expect(res.status).toBe(200);
    expect(body.sources).toHaveLength(1);
    expect(body.sources[0]).toMatchObject({
      file_id: "current-file",
      path: "Projects/OpenBrain/current.md",
      evidence_scope: "current_file",
    });
    expect(calls.some((call) => call.url.includes("/rpc/search_files"))).toBe(false);
    expect(calls.some((call) => call.url.includes("/rpc/search_files_by_embedding"))).toBe(false);
    const llmCall = calls.find((call) => call.url.includes("api.openai.com"));
    expect(JSON.stringify(llmCall?.body)).toContain("selected note is about");
  });

  it("answers deterministically from retrieved sources without calling the LLM", async () => {
    const { calls } = recordFetch([
      () =>
        new Response(
          JSON.stringify([
            {
              id: "file-1",
              path: "Resources/source.md",
              rank: 0.9,
              snippet: "Deterministic chat should cite this source.",
            },
          ]),
          { status: 200 },
        ),
      () => new Response(JSON.stringify([]), { status: 200 }),
      () => new Response(JSON.stringify([]), { status: 200 }),
      () => new Response(JSON.stringify([{ id: "session-1" }]), { status: 201 }),
      () => new Response(JSON.stringify([{ id: "message-user" }]), { status: 201 }),
      () => new Response(JSON.stringify([{ id: "message-answer" }]), { status: 201 }),
      () => new Response(JSON.stringify([{ id: "source-1" }]), { status: 201 }),
    ]);

    const req = new Request("https://api.openbrain.dev/architect/chat", {
      method: "POST",
      body: JSON.stringify({ message: "deterministic chat" }),
    });

    const res = await handleArchitect(
      req,
      makeEnv({
        ARCHITECT_DETERMINISTIC: "true",
        ARCHITECT_MODEL_PROVIDER: "deterministic",
        EMBEDDING_PROVIDER: "deterministic",
      }),
      new URL(req.url),
    );
    const body = (await res.json()) as { answer: string; sources: Array<{ file_id: string }> };

    expect(res.status).toBe(200);
    expect(body.answer).toContain("Deterministic chat should cite this source. [1]");
    expect(body.sources[0].file_id).toBe("file-1");
    expect(calls.some((call) => call.url.includes("api.openai.com"))).toBe(false);
  });

  it("returns a vector-only hit when FTS finds nothing", async () => {
    const { calls } = recordFetch([
      // FTS RPC: empty
      () => new Response(JSON.stringify([]), { status: 200 }),
      // Vector RPC: one hit
      () =>
        new Response(
          JSON.stringify([
            {
              id: "file-vec",
              path: "Notes/elderly-muscle.md",
              rank: 0.82,
              snippet: "Sarcopenia is age-related muscle loss in older adults.",
            },
          ]),
          { status: 200 },
        ),
      () => new Response(JSON.stringify([]), { status: 200 }),
      () => new Response(JSON.stringify([{ id: "session-1" }]), { status: 201 }),
      () => new Response(JSON.stringify([{ id: "message-user" }]), { status: 201 }),
      () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "Sarcopenia is age-related muscle loss. [1]" } }],
          }),
          { status: 200 },
        ),
      () => new Response(JSON.stringify([{ id: "message-answer" }]), { status: 201 }),
      () => new Response(JSON.stringify([{ id: "source-1" }]), { status: 201 }),
    ]);

    const req = new Request("https://api.openbrain.dev/architect/chat", {
      method: "POST",
      body: JSON.stringify({ message: "muscle wasting in elderly" }),
    });

    const res = await handleArchitect(
      req,
      makeEnv({ EMBEDDING_PROVIDER: "deterministic" }),
      new URL(req.url),
    );
    const body = (await res.json()) as {
      sources: Array<{ file_id: string; path: string }>;
    };

    expect(res.status).toBe(200);
    expect(body.sources).toHaveLength(1);
    expect(body.sources[0]).toMatchObject({
      file_id: "file-vec",
      path: "Notes/elderly-muscle.md",
    });
    expect(calls[0].url).toContain("/rpc/search_files");
    expect(calls[1].url).toContain("/rpc/search_files_by_embedding");
  });

  it("blends FTS and vector results via RRF and prefers FTS snippet on overlap", async () => {
    recordFetch([
      // FTS: [file-1 rank1, file-2 rank2]
      () =>
        new Response(
          JSON.stringify([
            { id: "file-1", path: "a.md", rank: 0.9, snippet: "**FTS hit** for file-1." },
            { id: "file-2", path: "b.md", rank: 0.5, snippet: "FTS hit for file-2." },
          ]),
          { status: 200 },
        ),
      // Vector: [file-3 rank1, file-1 rank2]
      () =>
        new Response(
          JSON.stringify([
            { id: "file-3", path: "c.md", rank: 0.95, snippet: "vector snippet for file-3" },
            { id: "file-1", path: "a.md", rank: 0.7, snippet: "vector snippet for file-1" },
          ]),
          { status: 200 },
        ),
      () => new Response(JSON.stringify([]), { status: 200 }),
      () => new Response(JSON.stringify([{ id: "session-1" }]), { status: 201 }),
      () => new Response(JSON.stringify([{ id: "message-user" }]), { status: 201 }),
      () =>
        new Response(JSON.stringify({ choices: [{ message: { content: "Combined answer." } }] }), {
          status: 200,
        }),
      () => new Response(JSON.stringify([{ id: "message-answer" }]), { status: 201 }),
      () => new Response(JSON.stringify([{ id: "source-a" }]), { status: 201 }),
      () => new Response(JSON.stringify([{ id: "source-b" }]), { status: 201 }),
      () => new Response(JSON.stringify([{ id: "source-c" }]), { status: 201 }),
    ]);

    const req = new Request("https://api.openbrain.dev/architect/chat", {
      method: "POST",
      body: JSON.stringify({ message: "anything" }),
    });

    const res = await handleArchitect(
      req,
      makeEnv({ EMBEDDING_PROVIDER: "deterministic" }),
      new URL(req.url),
    );
    const body = (await res.json()) as {
      sources: Array<{ file_id: string; snippet: string }>;
    };

    // file-1 appears in both lists → highest combined RRF score → ranked first.
    // Its snippet should be the FTS one (with ** highlight markers), not the vector one.
    expect(body.sources[0].file_id).toBe("file-1");
    expect(body.sources[0].snippet).toBe("**FTS hit** for file-1.");
    // file-3 (vec rank 1) outranks file-2 (fts rank 2) because 1/(60+1) > 1/(60+2).
    expect(body.sources[1].file_id).toBe("file-3");
    expect(body.sources[2].file_id).toBe("file-2");
  });

  it("falls back to FTS-only when query embedding fails", async () => {
    const { calls } = recordFetch([
      // Gemini embed → 500
      () => new Response("upstream broke", { status: 500 }),
      // FTS still answers
      () =>
        new Response(
          JSON.stringify([
            {
              id: "file-fts",
              path: "Notes/keyword.md",
              rank: 0.7,
              snippet: "keyword snippet",
            },
          ]),
          { status: 200 },
        ),
      () => new Response(JSON.stringify([]), { status: 200 }),
      () => new Response(JSON.stringify([{ id: "session-1" }]), { status: 201 }),
      () => new Response(JSON.stringify([{ id: "message-user" }]), { status: 201 }),
      () =>
        new Response(JSON.stringify({ choices: [{ message: { content: "Answer." } }] }), {
          status: 200,
        }),
      () => new Response(JSON.stringify([{ id: "message-answer" }]), { status: 201 }),
      () => new Response(JSON.stringify([{ id: "source-fts" }]), { status: 201 }),
    ]);

    const req = new Request("https://api.openbrain.dev/architect/chat", {
      method: "POST",
      body: JSON.stringify({ message: "exact keyword" }),
    });

    const res = await handleArchitect(
      req,
      makeEnv({ EMBEDDING_PROVIDER: "gemini", GEMINI_API_KEY: "broken-key" }),
      new URL(req.url),
    );
    const body = (await res.json()) as { sources: Array<{ file_id: string }> };

    expect(res.status).toBe(200);
    expect(body.sources).toHaveLength(1);
    expect(body.sources[0].file_id).toBe("file-fts");
    // Gemini embed was attempted; vector RPC was NOT called because embedding failed.
    expect(calls[0].url).toContain("generativelanguage.googleapis.com");
    expect(calls.some((c) => c.url.includes("search_files_by_embedding"))).toBe(false);
  });
});

describe("handleArchitect - jobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("runs all Architect processing jobs on demand", async () => {
    const req = new Request("https://api.openbrain.dev/architect/jobs/run", {
      method: "POST",
      body: JSON.stringify({}),
    });

    const res = await handleArchitect(req, makeEnv(), new URL(req.url));
    const body = (await res.json()) as { ok: boolean; ran: string[] };

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, file_id: null, ran: ["linker", "tagger", "wiki"] });
    expect(runLinker).toHaveBeenCalledOnce();
    expect(runTagger).toHaveBeenCalledOnce();
    expect(runWikiBuilder).toHaveBeenCalledOnce();
  });

  it("runs selected processing scopes for one file", async () => {
    const req = new Request("https://api.openbrain.dev/architect/jobs/run", {
      method: "POST",
      body: JSON.stringify({ file_id: "file-1", scopes: ["wiki", "tagger", "wiki"] }),
    });

    const res = await handleArchitect(req, makeEnv(), new URL(req.url));
    const body = (await res.json()) as { ok: boolean; file_id: string; ran: string[] };

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, file_id: "file-1", ran: ["wiki", "tagger"] });
    expect(runWikiBuilderForFile).toHaveBeenCalledWith(expect.anything(), "file-1");
    expect(runTaggerForFile).toHaveBeenCalledWith(expect.anything(), "file-1");
    expect(runLinkerForFile).not.toHaveBeenCalled();
    expect(runWikiBuilder).not.toHaveBeenCalled();
    expect(runTagger).not.toHaveBeenCalled();
    expect(runLinker).not.toHaveBeenCalled();
  });

  it("rejects invalid processing scopes", async () => {
    const req = new Request("https://api.openbrain.dev/architect/jobs/run", {
      method: "POST",
      body: JSON.stringify({ scopes: ["wiki", "bad"] }),
    });

    const res = await handleArchitect(req, makeEnv(), new URL(req.url));

    expect(res.status).toBe(400);
    expect(runWikiBuilder).not.toHaveBeenCalled();
  });
});

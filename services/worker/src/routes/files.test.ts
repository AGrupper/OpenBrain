import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";
import {
  handleFiles,
  readUploadHeaders,
  parseFilesQuery,
  isValidEmbedding,
  EMBEDDING_DIMENSIONS,
} from "./files";
import type { Env } from "../index";

function makeRequest(url: string, init?: RequestInit) {
  return new Request(url, init);
}

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    SUPABASE_URL: "https://stub.supabase.co",
    SUPABASE_SERVICE_KEY: "service-key",
    TELEGRAM_BOT_TOKEN: "telegram-token",
    TELEGRAM_CHAT_ID: "12345",
    OPENBRAIN_AUTH_TOKEN: "auth-token",
    VAULT_BUCKET: {
      put: vi.fn(async () => undefined),
      get: vi.fn(async () => null),
      delete: vi.fn(async () => undefined),
    } as unknown as R2Bucket,
    ...overrides,
  };
}

describe("readUploadHeaders", () => {
  it("returns parsed metadata when all headers are present", () => {
    const req = makeRequest("https://x/upload", {
      method: "PUT",
      headers: {
        "X-File-Path": "notes/a.md",
        "X-File-Sha256": "deadbeef",
        "X-File-Size": "42",
        "Content-Type": "text/markdown",
      },
    });
    expect(readUploadHeaders(req)).toEqual({
      path: "notes/a.md",
      sha256: "deadbeef",
      size: 42,
      mime: "text/markdown",
    });
  });

  it("defaults Content-Type to octet-stream when missing", () => {
    const req = makeRequest("https://x/upload", {
      method: "PUT",
      headers: {
        "X-File-Path": "blob.bin",
        "X-File-Sha256": "abc",
        "X-File-Size": "1",
      },
    });
    expect(readUploadHeaders(req)?.mime).toBe("application/octet-stream");
  });

  it("returns null when a required header is missing", () => {
    const req = makeRequest("https://x/upload", {
      method: "PUT",
      headers: { "X-File-Path": "a.md", "X-File-Sha256": "abc" },
    });
    expect(readUploadHeaders(req)).toBeNull();
  });

  it("returns null when X-File-Size is non-numeric", () => {
    const req = makeRequest("https://x/upload", {
      method: "PUT",
      headers: {
        "X-File-Path": "a.md",
        "X-File-Sha256": "abc",
        "X-File-Size": "not-a-number",
      },
    });
    expect(readUploadHeaders(req)).toBeNull();
  });

  it("returns null when X-File-Size is negative", () => {
    const req = makeRequest("https://x/upload", {
      method: "PUT",
      headers: {
        "X-File-Path": "a.md",
        "X-File-Sha256": "abc",
        "X-File-Size": "-1",
      },
    });
    expect(readUploadHeaders(req)).toBeNull();
  });
});

describe("handleFiles — PUT /files/upload", () => {
  let fetchMock: Mock;

  beforeEach(() => {
    fetchMock = vi.fn(
      async () => new Response(JSON.stringify([{ id: "file-1", path: "n.md" }]), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  it("rejects when X-File-* headers are absent", async () => {
    const env = makeEnv();
    const req = makeRequest("https://api.openbrain.dev/files/upload", {
      method: "PUT",
      body: "hello",
    });
    const res = await handleFiles(req, env, new URL(req.url));
    expect(res.status).toBe(400);
  });

  it("rejects when body length disagrees with X-File-Size", async () => {
    const env = makeEnv();
    const req = makeRequest("https://api.openbrain.dev/files/upload", {
      method: "PUT",
      headers: {
        "X-File-Path": "a.md",
        "X-File-Sha256": "abc",
        "X-File-Size": "999",
        "Content-Type": "text/markdown",
      },
      body: "hi",
    });
    const res = await handleFiles(req, env, new URL(req.url));
    expect(res.status).toBe(400);
  });

  it("stores blob in R2 and upserts metadata when headers + body match", async () => {
    const env = makeEnv();
    const body = "hello world"; // 11 bytes
    const req = makeRequest("https://api.openbrain.dev/files/upload", {
      method: "PUT",
      headers: {
        "X-File-Path": "n.md",
        "X-File-Sha256": "deadbeef",
        "X-File-Size": String(body.length),
        "Content-Type": "text/markdown",
      },
      body,
    });
    const res = await handleFiles(req, env, new URL(req.url));
    expect(res.status).toBe(201);
    expect(env.VAULT_BUCKET.put).toHaveBeenCalledWith(
      "n.md",
      expect.any(ArrayBuffer),
      expect.objectContaining({ sha256: "deadbeef" }),
    );
    expect(fetchMock).toHaveBeenCalled();
  });
});

describe("parseFilesQuery", () => {
  it("defaults to select=* and order=updated_at.desc with no params", () => {
    const { params, error } = parseFilesQuery(new URLSearchParams());
    expect(error).toBeUndefined();
    expect(params).toEqual({ order: "updated_at.desc", select: "*" });
  });

  it("translates needs_linking/needs_tagging/needs_embedding=true to eq.true", () => {
    const sp = new URLSearchParams("needs_linking=true&needs_tagging=true&needs_embedding=true");
    const { params } = parseFilesQuery(sp);
    expect(params.needs_linking).toBe("eq.true");
    expect(params.needs_tagging).toBe("eq.true");
    expect(params.needs_embedding).toBe("eq.true");
  });

  it("ignores boolean filters when value is not 'true'", () => {
    const { params } = parseFilesQuery(new URLSearchParams("needs_linking=false"));
    expect(params.needs_linking).toBeUndefined();
  });

  it("clamps limit to FILES_MAX_LIMIT (500)", () => {
    const { params } = parseFilesQuery(new URLSearchParams("limit=9999"));
    expect(params.limit).toBe("500");
  });

  it("rejects non-positive limit", () => {
    const { error } = parseFilesQuery(new URLSearchParams("limit=0"));
    expect(error).toMatch(/limit/);
  });

  it("rejects non-numeric limit", () => {
    const { error } = parseFilesQuery(new URLSearchParams("limit=abc"));
    expect(error).toMatch(/limit/);
  });

  it("accepts whitelisted select columns", () => {
    const { params, error } = parseFilesQuery(new URLSearchParams("select=folder,tags"));
    expect(error).toBeUndefined();
    expect(params.select).toBe("folder,tags");
  });

  it("rejects unknown select columns", () => {
    const { error } = parseFilesQuery(new URLSearchParams("select=folder,evil_column"));
    expect(error).toMatch(/Unknown select/);
  });
});

describe("isValidEmbedding", () => {
  it("accepts an array of 1024 finite numbers", () => {
    const v = new Array(EMBEDDING_DIMENSIONS).fill(0.1);
    expect(isValidEmbedding(v)).toBe(true);
  });

  it("rejects wrong-length arrays", () => {
    expect(isValidEmbedding(new Array(1536).fill(0.1))).toBe(false);
    expect(isValidEmbedding([])).toBe(false);
  });

  it("rejects arrays with non-numeric or non-finite entries", () => {
    const bad = new Array(EMBEDDING_DIMENSIONS).fill(0.1);
    bad[0] = "x";
    expect(isValidEmbedding(bad)).toBe(false);
    bad[0] = Number.NaN;
    expect(isValidEmbedding(bad)).toBe(false);
    bad[0] = Number.POSITIVE_INFINITY;
    expect(isValidEmbedding(bad)).toBe(false);
  });

  it("rejects non-arrays", () => {
    expect(isValidEmbedding(null)).toBe(false);
    expect(isValidEmbedding({})).toBe(false);
    expect(isValidEmbedding("abc")).toBe(false);
  });
});

describe("handleFiles — GET /files filters", () => {
  it("rejects unknown select columns with 400", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("[]", { status: 200 })),
    );
    const env = makeEnv();
    const req = makeRequest("https://api.openbrain.dev/files?select=evil");
    const res = await handleFiles(req, env, new URL(req.url));
    expect(res.status).toBe(400);
  });

  it("forwards needs_tagging=true and limit to Supabase URL", async () => {
    const fetchMock = vi.fn(async () => new Response("[]", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const env = makeEnv();
    const req = makeRequest("https://api.openbrain.dev/files?needs_tagging=true&limit=50");
    await handleFiles(req, env, new URL(req.url));
    const calls = fetchMock.mock.calls as unknown[][];
    const calledUrl = String(calls[0]?.[0] ?? "");
    expect(calledUrl).toContain("needs_tagging=eq.true");
    expect(calledUrl).toContain("limit=50");
  });
});

describe("handleFiles — POST /files/:id/embedding", () => {
  it("rejects wrong-dimension embedding payloads with 400", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("[]", { status: 200 })),
    );
    const env = makeEnv();
    const req = makeRequest("https://api.openbrain.dev/files/abc/embedding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embedding: new Array(1536).fill(0.1), text_preview: "x" }),
    });
    const res = await handleFiles(req, env, new URL(req.url));
    expect(res.status).toBe(400);
  });

  it("accepts a valid 1024-dim embedding", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("[]", { status: 200 })),
    );
    const env = makeEnv();
    const req = makeRequest("https://api.openbrain.dev/files/abc/embedding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        embedding: new Array(EMBEDDING_DIMENSIONS).fill(0.1),
        text_preview: "x",
      }),
    });
    const res = await handleFiles(req, env, new URL(req.url));
    expect(res.status).toBe(204);
  });
});

describe("handleFiles — GET /files/:id", () => {
  it("returns 404 when supabase returns empty array", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify([]), { status: 200 })),
    );
    const env = makeEnv();
    const req = makeRequest("https://api.openbrain.dev/files/missing");
    const res = await handleFiles(req, env, new URL(req.url));
    expect(res.status).toBe(404);
  });

  it("returns the file row when supabase returns a match", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify([
              {
                id: "x",
                path: "n.md",
                size: 1,
                sha256: "a",
                mime: "text/markdown",
                updated_at: "now",
              },
            ]),
            { status: 200 },
          ),
      ),
    );
    const env = makeEnv();
    const req = makeRequest("https://api.openbrain.dev/files/x");
    const res = await handleFiles(req, env, new URL(req.url));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: "x", path: "n.md" });
  });
});

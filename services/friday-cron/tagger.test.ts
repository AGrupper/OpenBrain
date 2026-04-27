// Set env vars before module is evaluated (vi.hoisted runs before imports)
vi.hoisted(() => {
  process.env.OPENBRAIN_API_URL = "http://test-api";
  process.env.OPENBRAIN_AUTH_TOKEN = "test-token";
  process.env.FRIDAY_MODEL_PROVIDER = "anthropic";
  process.env.FRIDAY_MODEL = "claude-test";
  process.env.ANTHROPIC_API_KEY = "test-key";
  process.env.MAX_FILES_PER_RUN = "20";
});

import { describe, it, expect, vi, afterEach } from "vitest";
import { main, getRecentCorrections } from "./tagger";
import type { VaultFile } from "../../packages/shared/src/types";

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---- helpers ----

function makeFile(id: string, path: string): VaultFile {
  return { id, path, size: 100, sha256: "abc", mime: "text/markdown", updated_at: "2025-01-01" };
}

function okResponse(body: unknown, status = 200): Response {
  return {
    ok: status < 400,
    status,
    json: async () => body,
    text: async () => (body != null ? JSON.stringify(body) : ""),
  } as unknown as Response;
}

function anthropicResponse(result: { folder: string; tags: string[] }): Response {
  return okResponse({ content: [{ text: JSON.stringify(result) }] });
}

// ---- getRecentCorrections ----

describe("getRecentCorrections", () => {
  it("returns empty string when the corrections endpoint is not ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false } as Response));
    expect(await getRecentCorrections()).toBe("");
  });

  it("returns empty string when corrections list is empty", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(okResponse([])),
    );
    expect(await getRecentCorrections()).toBe("");
  });

  it("formats corrections into a labeled list", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        okResponse([{ field: "folder", old_value: "inbox", new_value: "projects" }]),
      ),
    );
    const result = await getRecentCorrections();
    expect(result).toContain('Changed folder from "inbox" to "projects"');
  });

  it("includes all corrections when multiple are returned", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        okResponse([
          { field: "folder", old_value: "inbox", new_value: "work" },
          { field: "tags", old_value: "misc", new_value: "finance" },
        ]),
      ),
    );
    const result = await getRecentCorrections();
    expect(result).toContain("work");
    expect(result).toContain("finance");
  });
});

// ---- main ----

describe("main", () => {
  it("exits early and makes no further calls when no files need tagging", async () => {
    const fetchMock = vi.fn(async (url: string): Promise<Response> => {
      if (url.includes("needs_tagging=true")) return okResponse([]);
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await main();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sends PATCH with folder, tags, and needs_tagging:false", async () => {
    const file = makeFile("file-1", "notes/meeting.md");
    const patchBodies: unknown[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, opts?: RequestInit): Promise<Response> => {
        if (url.includes("needs_tagging=true")) return okResponse([file]);
        if (url.includes("select=folder")) return okResponse([]);
        if (url.includes("/corrections")) return okResponse([]);
        if (url.includes("anthropic")) return anthropicResponse({ folder: "notes", tags: ["meeting", "work"] });
        if (url.includes(`/files/${file.id}`)) {
          patchBodies.push(JSON.parse(opts?.body as string));
          return okResponse(null, 204);
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );

    await main();

    expect(patchBodies).toHaveLength(1);
    const body = patchBodies[0] as { folder: string; tags: string[]; needs_tagging: boolean };
    expect(body.folder).toBe("notes");
    expect(body.tags).toEqual(["meeting", "work"]);
    expect(body.needs_tagging).toBe(false);
  });

  it("skips a file when AI call fails and continues with remaining files", async () => {
    const fileA = makeFile("a", "a.md");
    const fileB = makeFile("b", "b.md");
    let aiCallCount = 0;
    const patchedIds: string[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, opts?: RequestInit): Promise<Response> => {
        if (url.includes("needs_tagging=true")) return okResponse([fileA, fileB]);
        if (url.includes("select=folder")) return okResponse([]);
        if (url.includes("/corrections")) return okResponse([]);
        if (url.includes("anthropic")) {
          aiCallCount++;
          if (aiCallCount === 1) throw new Error("AI unavailable");
          return anthropicResponse({ folder: "docs", tags: ["b"] });
        }
        if (url.includes("/files/b")) {
          patchedIds.push("b");
          return okResponse(null, 204);
        }
        if (url.includes("/files/a")) {
          patchedIds.push("a");
          return okResponse(null, 204);
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );

    await expect(main()).resolves.toBeUndefined();
    // File A's AI failed, file B succeeded
    expect(patchedIds).toEqual(["b"]);
  });

  it("accumulates new folder into cache so subsequent files see it in the prompt", async () => {
    const fileA = makeFile("a", "a.md");
    const fileB = makeFile("b", "b.md");
    const promptsSeen: string[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, opts?: RequestInit): Promise<Response> => {
        if (url.includes("needs_tagging=true")) return okResponse([fileA, fileB]);
        if (url.includes("select=folder")) return okResponse([]);
        if (url.includes("/corrections")) return okResponse([]);
        if (url.includes("anthropic")) {
          const reqBody = JSON.parse(opts?.body as string) as { messages: { content: string }[] };
          promptsSeen.push(reqBody.messages[0].content);
          return anthropicResponse({ folder: "projects", tags: ["alpha"] });
        }
        if (url.includes("/files/")) return okResponse(null, 204);
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );

    await main();

    expect(promptsSeen).toHaveLength(2);
    // First prompt: no existing folders yet
    expect(promptsSeen[0]).not.toContain("projects");
    // Second prompt: "projects" should appear because fileA added it to the cache
    expect(promptsSeen[1]).toContain("projects");
  });

  it("accumulates new tags into cache so subsequent files see them in the prompt", async () => {
    const fileA = makeFile("a", "a.md");
    const fileB = makeFile("b", "b.md");
    const promptsSeen: string[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, opts?: RequestInit): Promise<Response> => {
        if (url.includes("needs_tagging=true")) return okResponse([fileA, fileB]);
        if (url.includes("select=folder")) return okResponse([]);
        if (url.includes("/corrections")) return okResponse([]);
        if (url.includes("anthropic")) {
          const reqBody = JSON.parse(opts?.body as string) as { messages: { content: string }[] };
          promptsSeen.push(reqBody.messages[0].content);
          return anthropicResponse({ folder: "work", tags: ["finance", "q1"] });
        }
        if (url.includes("/files/")) return okResponse(null, 204);
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );

    await main();

    expect(promptsSeen).toHaveLength(2);
    expect(promptsSeen[1]).toContain("finance");
    expect(promptsSeen[1]).toContain("q1");
  });

  it("handles empty tags array from AI without crashing", async () => {
    const file = makeFile("x", "x.md");
    const patchBodies: unknown[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, opts?: RequestInit): Promise<Response> => {
        if (url.includes("needs_tagging=true")) return okResponse([file]);
        if (url.includes("select=folder")) return okResponse([]);
        if (url.includes("/corrections")) return okResponse([]);
        if (url.includes("anthropic")) return anthropicResponse({ folder: "misc", tags: [] });
        if (url.includes(`/files/${file.id}`)) {
          patchBodies.push(JSON.parse(opts?.body as string));
          return okResponse(null, 204);
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );

    await main();

    const body = patchBodies[0] as { tags: string[] };
    expect(body.tags).toEqual([]);
  });
});

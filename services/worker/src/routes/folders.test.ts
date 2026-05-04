import { describe, expect, it, vi, type Mock } from "vitest";
import { handleFolders, normalizeFolderPath } from "./folders";
import type { Env } from "../app";

function makeRequest(url: string, init?: RequestInit) {
  return new Request(url, init);
}

function makeEnv(): Env {
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
  };
}

describe("normalizeFolderPath", () => {
  it("normalizes separators and trims empty segments", () => {
    expect(normalizeFolderPath(" Projects\\OpenBrain / Notes ")).toBe("Projects/OpenBrain/Notes");
  });

  it("rejects empty and traversal paths", () => {
    expect(normalizeFolderPath("")).toBeNull();
    expect(normalizeFolderPath("../secret")).toBeNull();
    expect(normalizeFolderPath("Projects/../secret")).toBeNull();
  });
});

describe("handleFolders", () => {
  it("lists folders ordered by path", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify([{ path: "Projects", name: "Projects" }]), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const env = makeEnv();
    const req = makeRequest("https://api.openbrain.dev/folders");
    const res = await handleFolders(req, env, new URL(req.url));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      expect.objectContaining({ path: "Projects", name: "Projects" }),
      expect.objectContaining({ path: "Areas", name: "Areas" }),
      expect.objectContaining({ path: "Resources", name: "Resources" }),
      expect.objectContaining({ path: "Archive", name: "Archive" }),
    ]);
    const calls = fetchMock.mock.calls as unknown[][];
    expect(String(calls[0]?.[0] ?? "")).toContain("order=path.asc");
  });

  it("treats PARA roots as existing folders", async () => {
    const env = makeEnv();
    const req = makeRequest("https://api.openbrain.dev/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "Projects" }),
    });
    const res = await handleFolders(req, env, new URL(req.url));

    expect(res.status).toBe(409);
  });

  it("creates a folder after checking duplicates and conflicts", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("[]", { status: 200 }))
      .mockResolvedValueOnce(new Response("[]", { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ path: "Projects", name: "Projects" }]), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            { path: "Projects/OpenBrain", name: "OpenBrain", parent_path: "Projects" },
          ]),
          { status: 200 },
        ),
      ) as Mock;
    vi.stubGlobal("fetch", fetchMock);

    const env = makeEnv();
    const req = makeRequest("https://api.openbrain.dev/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "Projects/OpenBrain" }),
    });
    const res = await handleFolders(req, env, new URL(req.url));

    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ path: "Projects/OpenBrain" });
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual([
      expect.objectContaining({ path: "Projects", parent_path: null }),
    ]);
    expect(JSON.parse(fetchMock.mock.calls[3][1].body)).toMatchObject({
      path: "Projects/OpenBrain",
      name: "OpenBrain",
      parent_path: "Projects",
    });
  });

  it("rejects duplicate folders", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([{ path: "Projects" }]), { status: 200 }))
      .mockResolvedValueOnce(new Response("[]", { status: 200 })) as Mock;
    vi.stubGlobal("fetch", fetchMock);

    const env = makeEnv();
    const req = makeRequest("https://api.openbrain.dev/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "Projects" }),
    });
    const res = await handleFolders(req, env, new URL(req.url));

    expect(res.status).toBe(409);
  });

  it("rejects deleting a non-empty folder", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("[]", { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ id: "file-1" }]), { status: 200 }),
      ) as Mock;
    vi.stubGlobal("fetch", fetchMock);

    const env = makeEnv();
    const req = makeRequest("https://api.openbrain.dev/folders?path=Projects/OpenBrain", {
      method: "DELETE",
    });
    const res = await handleFolders(req, env, new URL(req.url));

    expect(res.status).toBe(409);
    const calls = fetchMock.mock.calls as unknown[][];
    expect(String(calls[1]?.[0] ?? "")).toContain("path=like.Projects%2FOpenBrain%2F%25");
  });

  it("rejects deleting a PARA root", async () => {
    const env = makeEnv();
    const req = makeRequest("https://api.openbrain.dev/folders?path=Resources", {
      method: "DELETE",
    });
    const res = await handleFolders(req, env, new URL(req.url));

    expect(res.status).toBe(409);
  });

  it("deletes an empty folder", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("[]", { status: 200 }))
      .mockResolvedValueOnce(new Response("[]", { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 })) as Mock;
    vi.stubGlobal("fetch", fetchMock);

    const env = makeEnv();
    const req = makeRequest("https://api.openbrain.dev/folders?path=Projects/OpenBrain", {
      method: "DELETE",
    });
    const res = await handleFolders(req, env, new URL(req.url));

    expect(res.status).toBe(204);
    const calls = fetchMock.mock.calls as unknown[][];
    expect(String(calls[2]?.[0] ?? "")).toContain("folders?path=eq.Projects%2FOpenBrain");
  });
});

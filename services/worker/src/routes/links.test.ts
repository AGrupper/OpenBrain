import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";
import { handleLinks } from "./links";
import type { Env } from "../index";

function makeEnv(): Env {
  return {
    SUPABASE_URL: "https://stub.supabase.co",
    SUPABASE_SERVICE_KEY: "service-key",
    TELEGRAM_BOT_TOKEN: "telegram-token",
    TELEGRAM_CHAT_ID: "12345",
    OPENBRAIN_AUTH_TOKEN: "auth-token",
    VAULT_BUCKET: {} as R2Bucket,
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
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    calls.push({ url, method, body });
    const handler = responses[i] ?? responses[responses.length - 1];
    i += 1;
    return handler({ url, method, body });
  });
  vi.stubGlobal("fetch", mock);
  return { mock, calls };
}

describe("handleLinks — POST /links/proposals", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates a pending link and triggers Telegram when trust mode is off", async () => {
    const { calls } = recordFetch([
      // 1. trust_metrics query
      () => new Response(JSON.stringify([{ obvious_links_silent: false }]), { status: 200 }),
      // 2. links upsert
      () =>
        new Response(
          JSON.stringify([
            {
              id: "link-1",
              file_a_id: "a",
              file_b_id: "b",
              confidence: 0.9,
              reason: "shared topic",
              status: "pending",
              created_at: "now",
            },
          ]),
          { status: 200 },
        ),
      // 3. supabase fetch for titleA in sendTelegramApproval
      () => new Response(JSON.stringify([{ path: "notes/a.md" }]), { status: 200 }),
      // 4. supabase fetch for titleB
      () => new Response(JSON.stringify([{ path: "notes/b.md" }]), { status: 200 }),
      // 5. telegram sendMessage
      () => new Response("ok", { status: 200 }),
    ]);

    const env = makeEnv();
    const req = new Request("https://api.openbrain.dev/links/proposals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        file_a_id: "a",
        file_b_id: "b",
        confidence: 0.9,
        reason: "shared topic",
      }),
    });
    const res = await handleLinks(req, env, new URL(req.url));
    expect(res.status).toBe(201);

    const lastCall = calls[calls.length - 1];
    expect(lastCall.url).toContain("api.telegram.org");
    expect(lastCall.method).toBe("POST");
    expect(lastCall.body).toMatchObject({ chat_id: "12345" });
  });

  it("auto-approves obvious links when silent mode is on (no Telegram call)", async () => {
    const { calls } = recordFetch([
      // 1. trust_metrics query — silent mode on
      () => new Response(JSON.stringify([{ obvious_links_silent: true }]), { status: 200 }),
      // 2. links upsert
      () =>
        new Response(
          JSON.stringify([
            {
              id: "link-1",
              file_a_id: "a",
              file_b_id: "b",
              confidence: 0.95,
              reason: "very similar",
              status: "auto_approved",
              created_at: "now",
            },
          ]),
          { status: 200 },
        ),
    ]);

    const env = makeEnv();
    const req = new Request("https://api.openbrain.dev/links/proposals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        file_a_id: "a",
        file_b_id: "b",
        confidence: 0.95,
        reason: "very similar",
      }),
    });
    const res = await handleLinks(req, env, new URL(req.url));
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ status: "auto_approved" });
    // No telegram call should have been made
    expect(calls.some((c) => c.url.includes("api.telegram.org"))).toBe(false);
  });

  it("keeps low-confidence links in pending status even with silent mode on", async () => {
    const { calls } = recordFetch([
      // silent mode on but confidence < 0.85
      () => new Response(JSON.stringify([{ obvious_links_silent: true }]), { status: 200 }),
      () =>
        new Response(
          JSON.stringify([
            {
              id: "link-1",
              file_a_id: "a",
              file_b_id: "b",
              confidence: 0.7,
              reason: "loosely related",
              status: "pending",
              created_at: "now",
            },
          ]),
          { status: 200 },
        ),
      // titleA, titleB, telegram
      () => new Response(JSON.stringify([{ path: "a.md" }]), { status: 200 }),
      () => new Response(JSON.stringify([{ path: "b.md" }]), { status: 200 }),
      () => new Response("ok", { status: 200 }),
    ]);

    const env = makeEnv();
    const req = new Request("https://api.openbrain.dev/links/proposals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        file_a_id: "a",
        file_b_id: "b",
        confidence: 0.7,
        reason: "loose",
      }),
    });
    const res = await handleLinks(req, env, new URL(req.url));
    expect(res.status).toBe(201);
    expect(calls.some((c) => c.url.includes("api.telegram.org"))).toBe(true);
  });
});

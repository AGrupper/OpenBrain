import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";
import { handleTelegram } from "./webhook";
import type { Env } from "../app";

function makeEnv(): Env {
  return {
    SUPABASE_URL: "https://stub.supabase.co",
    SUPABASE_SERVICE_KEY: "service-key",
    TELEGRAM_BOT_TOKEN: "bot-token-secret",
    TELEGRAM_CHAT_ID: "12345",
    OPENBRAIN_AUTH_TOKEN: "auth-token",
    VAULT_BUCKET: {} as R2Bucket,
  };
}

describe("handleTelegram", () => {
  let fetchMock: Mock;

  beforeEach(() => {
    fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
  });

  it("rejects when token in URL does not match TELEGRAM_BOT_TOKEN", async () => {
    const env = makeEnv();
    const req = new Request("https://api.openbrain.dev/telegram/wrong-token", {
      method: "POST",
      body: JSON.stringify({ update_id: 1 }),
    });
    const res = await handleTelegram(req, env);
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 200 OK and ignores GET requests with valid token", async () => {
    const env = makeEnv();
    const req = new Request("https://api.openbrain.dev/telegram/bot-token-secret", {
      method: "GET",
    });
    const res = await handleTelegram(req, env);
    expect(res.status).toBe(200);
  });

  it("returns OK and does no DB work for non-callback updates", async () => {
    const env = makeEnv();
    const req = new Request("https://api.openbrain.dev/telegram/bot-token-secret", {
      method: "POST",
      body: JSON.stringify({ update_id: 1 }),
    });
    const res = await handleTelegram(req, env);
    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ignores callbacks with malformed action data", async () => {
    const env = makeEnv();
    const req = new Request("https://api.openbrain.dev/telegram/bot-token-secret", {
      method: "POST",
      body: JSON.stringify({
        update_id: 1,
        callback_query: { id: "cb1", data: "garbage" },
      }),
    });
    const res = await handleTelegram(req, env);
    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("approves a link when callback action is 'approve'", async () => {
    // Sequence: PATCH link → fetch confidence → answerCallbackQuery
    fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/links?id=eq.link-1&select=confidence")) {
        return new Response(JSON.stringify([{ confidence: 0.7 }]), { status: 200 });
      }
      return new Response("ok", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const env = makeEnv();
    const req = new Request("https://api.openbrain.dev/telegram/bot-token-secret", {
      method: "POST",
      body: JSON.stringify({
        update_id: 1,
        callback_query: {
          id: "cb1",
          data: "approve:link-1",
          message: { message_id: 99, chat: { id: 12345 } },
        },
      }),
    });
    const res = await handleTelegram(req, env);
    expect(res.status).toBe(200);

    const calls = fetchMock.mock.calls.map((c) =>
      typeof c[0] === "string" ? c[0] : c[0].toString(),
    );
    expect(
      calls.some((u) => u.includes("rest/v1/links?id=eq.link-1") && !u.includes("select=")),
    ).toBe(true);
    expect(calls.some((u) => u.includes("answerCallbackQuery"))).toBe(true);
    // confidence is 0.7 < 0.85, so increment_trust must NOT be called
    expect(calls.some((u) => u.includes("rpc/increment_trust"))).toBe(false);
  });

  it("increments trust when an obvious (>=0.85) link is approved", async () => {
    fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/links?id=eq.link-1&select=confidence")) {
        return new Response(JSON.stringify([{ confidence: 0.92 }]), { status: 200 });
      }
      return new Response("ok", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const env = makeEnv();
    const req = new Request("https://api.openbrain.dev/telegram/bot-token-secret", {
      method: "POST",
      body: JSON.stringify({
        update_id: 1,
        callback_query: {
          id: "cb1",
          data: "approve:link-1",
          message: { message_id: 99, chat: { id: 12345 } },
        },
      }),
    });
    await handleTelegram(req, env);
    const calls = fetchMock.mock.calls.map((c) =>
      typeof c[0] === "string" ? c[0] : c[0].toString(),
    );
    expect(calls.some((u) => u.includes("rpc/increment_trust"))).toBe(true);
  });

  it("rejects a link without incrementing trust on 'reject' callback", async () => {
    fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const env = makeEnv();
    const req = new Request("https://api.openbrain.dev/telegram/bot-token-secret", {
      method: "POST",
      body: JSON.stringify({
        update_id: 1,
        callback_query: {
          id: "cb1",
          data: "reject:link-1",
          message: { message_id: 99, chat: { id: 12345 } },
        },
      }),
    });
    await handleTelegram(req, env);
    const calls = fetchMock.mock.calls.map((c) =>
      typeof c[0] === "string" ? c[0] : c[0].toString(),
    );
    expect(calls.some((u) => u.includes("rpc/increment_trust"))).toBe(false);
    expect(calls.some((u) => u.includes("answerCallbackQuery"))).toBe(true);
  });
});

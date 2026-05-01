import { describe, expect, it, vi, beforeEach, type Mock } from "vitest";
import { handleArchitect } from "./architect";
import type { Env } from "../app";

function makeEnv(): Env {
  return {
    SUPABASE_URL: "https://stub.supabase.co",
    SUPABASE_SERVICE_KEY: "service-key",
    TELEGRAM_BOT_TOKEN: "telegram-token",
    TELEGRAM_CHAT_ID: "12345",
    OPENBRAIN_AUTH_TOKEN: "auth-token",
    OPENAI_API_KEY: "openai-key",
    ARCHITECT_MODEL: "test-model",
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
    expect(body.sources).toEqual([
      {
        file_id: "file-1",
        path: "Projects/OpenBrain/plan.md",
        snippet: "OpenBrain uses The Architect for vault-grounded chat.",
        score: 0.9,
      },
    ]);

    const llmCall = calls.find((call) => call.url.includes("api.openai.com"));
    expect(llmCall?.body).toMatchObject({ model: "test-model" });
    expect(JSON.stringify(llmCall?.body)).toContain("OpenBrain uses The Architect");
  });
});

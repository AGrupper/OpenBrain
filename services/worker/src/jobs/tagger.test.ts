import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../app";
import type { VaultFile } from "@openbrain/shared";

const mocks = vi.hoisted(() => ({
  askArchitectToOrganize: vi.fn(),
  query: vi.fn(),
  insert: vi.fn(),
  patch: vi.fn(),
}));

vi.mock("../lib/providers", () => ({
  askArchitectToOrganize: mocks.askArchitectToOrganize,
}));

vi.mock("../lib/supabase", () => ({
  db: () => ({
    query: mocks.query,
    insert: mocks.insert,
    patch: mocks.patch,
  }),
}));

import { runTagger } from "./tagger";

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

function makeFile(overrides: Partial<VaultFile> = {}): VaultFile {
  return {
    id: "file-1",
    path: "Resources/SmokeManual/manual-smoke.md",
    size: 100,
    sha256: "abc",
    mime: "text/markdown",
    updated_at: "2026-05-05",
    folder: "Resources/SmokeManual",
    tags: ["architect-smoke"],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runTagger", () => {
  it("skips no-op folder and tag suggestions but clears needs_tagging", async () => {
    const file = makeFile();

    mocks.query.mockImplementation(async (table: string, params: Record<string, string>) => {
      if (table === "files" && params.needs_tagging === "eq.true") return [file];
      if (table === "files" && params.select === "folder,tags") {
        return [{ folder: file.folder, tags: file.tags }];
      }
      if (table === "corrections") return [];
      throw new Error(`Unexpected query: ${table} ${JSON.stringify(params)}`);
    });
    mocks.askArchitectToOrganize.mockResolvedValue({
      folder: "Resources/SmokeManual",
      tags: ["architect-smoke"],
    });

    await runTagger(makeEnv());

    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.patch).toHaveBeenCalledWith("files", file.id, { needs_tagging: false });
  });
});

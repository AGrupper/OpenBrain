import { afterEach, describe, it, expect, vi } from "vitest";
import {
  ApiError,
  EMBEDDING_DIMENSIONS,
  askArchitectIfRelated,
  embedText,
  isDuplicateLinkError,
} from "../src/jobs/linker";

afterEach(() => {
  delete process.env.EMBEDDING_PROVIDER;
  delete process.env.ARCHITECT_MODEL_PROVIDER;
  vi.unstubAllGlobals();
});

describe("isDuplicateLinkError", () => {
  it("identifies a 409 with Postgres unique-violation code", () => {
    const e = new ApiError(
      "/links/proposals",
      409,
      `{"code":"23505","details":"Key already exists","hint":null,"message":"duplicate key value"}`,
    );
    expect(isDuplicateLinkError(e)).toBe(true);
  });

  it("rejects a 409 without a unique-violation code", () => {
    const e = new ApiError("/links/proposals", 409, `{"code":"23503","message":"foreign key"}`);
    expect(isDuplicateLinkError(e)).toBe(false);
  });

  it("rejects a 500 even if the body mentions 23505", () => {
    const e = new ApiError("/links/proposals", 500, "log line including 23505 somewhere");
    expect(isDuplicateLinkError(e)).toBe(false);
  });

  it("rejects non-ApiError values", () => {
    expect(isDuplicateLinkError(new Error("23505 in message"))).toBe(false);
    expect(isDuplicateLinkError("23505")).toBe(false);
    expect(isDuplicateLinkError(null)).toBe(false);
  });
});

describe("deterministic smoke mode", () => {
  it("creates a 1024-dimension embedding without calling a provider API", async () => {
    process.env.EMBEDDING_PROVIDER = "deterministic";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("deterministic embedding should not call fetch");
      }),
    );

    const vector = await embedText("openbrain-smoke-related-a.md");

    expect(vector).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(vector[0]).toBe(1);
    expect(vector.slice(1).every((value) => value === 0)).toBe(true);
  });

  it("marks the related smoke pair as related without calling a provider API", async () => {
    process.env.ARCHITECT_MODEL_PROVIDER = "deterministic";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("deterministic relatedness should not call fetch");
      }),
    );

    const result = await askArchitectIfRelated(
      "openbrain-smoke-related-a.md",
      "openbrain-smoke-related-b.md",
      "",
      "",
    );

    expect(result).toMatchObject({ related: true, confidence: 0.82 });
  });

  it("keeps unrelated smoke notes separate", async () => {
    process.env.ARCHITECT_MODEL_PROVIDER = "deterministic";

    const result = await askArchitectIfRelated(
      "openbrain-smoke-related-a.md",
      "openbrain-smoke-unrelated.md",
      "",
      "",
    );

    expect(result.related).toBe(false);
  });
});

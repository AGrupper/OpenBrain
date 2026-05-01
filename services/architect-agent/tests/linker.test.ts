import { describe, it, expect } from "vitest";
import { ApiError, isDuplicateLinkError } from "../src/jobs/linker";

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

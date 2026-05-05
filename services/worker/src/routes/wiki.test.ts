import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../app";
import type { WikiGraphResponse, WikiNodeDetailResponse } from "@openbrain/shared";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock("../lib/supabase", () => ({
  db: () => ({
    query: mocks.query,
  }),
}));

import { handleWiki } from "./wiki";

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    SUPABASE_URL: "https://stub.supabase.co",
    SUPABASE_SERVICE_KEY: "service-key",
    TELEGRAM_BOT_TOKEN: "telegram-token",
    TELEGRAM_CHAT_ID: "12345",
    OPENBRAIN_AUTH_TOKEN: "auth-token",
    VAULT_BUCKET: {} as R2Bucket,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("handleWiki", () => {
  it("returns draft-visible graph nodes and edges", async () => {
    mocks.query.mockImplementation(async (table: string) => {
      if (table === "wiki_nodes") {
        return [
          {
            id: "node-1",
            kind: "synthesis",
            title: "Draft synthesis",
            slug: "draft-synthesis",
            status: "draft",
            source_file_id: "file-1",
            created_at: "now",
            updated_at: "now",
          },
        ];
      }
      if (table === "wiki_edges") {
        return [
          {
            id: "edge-1",
            source_node_id: "node-1",
            target_node_id: "node-2",
            type: "derived_from",
            status: "draft",
            created_at: "now",
            updated_at: "now",
          },
        ];
      }
      return [];
    });

    const req = new Request("https://api.openbrain.dev/wiki/graph");
    const res = await handleWiki(req, makeEnv(), new URL(req.url));
    const body = (await res.json()) as WikiGraphResponse;

    expect(res.status).toBe(200);
    expect(body.nodes).toHaveLength(1);
    expect(body.nodes[0]).toMatchObject({ status: "draft" });
    expect(body.edges).toHaveLength(1);
    expect(mocks.query).toHaveBeenCalledWith(
      "wiki_nodes",
      expect.objectContaining({ status: "in.(draft,published)" }),
    );
  });

  it("returns node detail with page, citations, backlinks, outgoing edges, and revisions", async () => {
    mocks.query.mockImplementation(async (table: string, params: Record<string, string>) => {
      if (table === "wiki_nodes") {
        return [
          {
            id: "node-1",
            kind: "claim",
            title: "Claim",
            slug: "claim",
            status: "draft",
            created_at: "now",
            updated_at: "now",
          },
        ];
      }
      if (table === "wiki_pages") {
        return [{ id: "page-1", node_id: "node-1", title: "Claim", content: "# Claim" }];
      }
      if (table === "wiki_revisions") {
        return [
          {
            id: "revision-1",
            page_id: "page-1",
            revision_number: 1,
            title: "Claim",
            content: "# Claim",
            reason: "Generated",
            created_at: "now",
          },
        ];
      }
      if (table === "wiki_edges" && params.target_node_id) {
        return [{ id: "backlink-1", source_node_id: "node-2", target_node_id: "node-1" }];
      }
      if (table === "wiki_edges" && params.source_node_id) {
        return [{ id: "outgoing-1", source_node_id: "node-1", target_node_id: "node-3" }];
      }
      if (table === "wiki_citations") {
        return [
          {
            id: "citation-1",
            node_id: "node-1",
            revision_id: "revision-1",
            chunk_id: "chunk-1",
            quote: "quoted text",
            source_chunks: {
              id: "chunk-1",
              file_id: "file-1",
              source_sha256: "sha",
              chunk_index: 0,
              content: "quoted text",
              char_start: 0,
              char_end: 11,
              created_at: "now",
            },
          },
        ];
      }
      return [];
    });

    const req = new Request("https://api.openbrain.dev/wiki/nodes/node-1");
    const res = await handleWiki(req, makeEnv(), new URL(req.url));
    const body = (await res.json()) as WikiNodeDetailResponse;

    expect(res.status).toBe(200);
    expect(body.node).toMatchObject({ id: "node-1" });
    expect(body.page).toMatchObject({ id: "page-1" });
    expect(body.citations[0]).toMatchObject({
      id: "citation-1",
      chunk: { id: "chunk-1", chunk_index: 0 },
    });
    expect(body.backlinks).toHaveLength(1);
    expect(body.outgoing).toHaveLength(1);
    expect(body.revisions).toHaveLength(1);
  });

  it("returns 404 for an unknown node", async () => {
    mocks.query.mockResolvedValue([]);

    const req = new Request("https://api.openbrain.dev/wiki/nodes/missing");
    const res = await handleWiki(req, makeEnv(), new URL(req.url));

    expect(res.status).toBe(404);
  });
});

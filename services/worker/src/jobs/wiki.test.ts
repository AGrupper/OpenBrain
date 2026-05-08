import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../app";
import type { VaultFile } from "@openbrain/shared";
import type { WikiDraftResult } from "../lib/providers";

const mocks = vi.hoisted(() => ({
  askArchitectForWikiDraft: vi.fn(),
  query: vi.fn(),
  insert: vi.fn(),
  patch: vi.fn(),
  tables: {} as Record<string, Array<Record<string, unknown>>>,
}));

vi.mock("../lib/providers", () => ({
  askArchitectForWikiDraft: mocks.askArchitectForWikiDraft,
}));

vi.mock("../lib/supabase", () => ({
  db: () => ({
    query: mocks.query,
    insert: mocks.insert,
    patch: mocks.patch,
  }),
}));

import { chunkText, runWikiBuilderForFile } from "./wiki";

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
    path: "Resources/Wiki/source.md",
    size: 32,
    sha256: "sha-1",
    mime: "text/markdown",
    folder: "Resources/Wiki",
    tags: ["wiki"],
    text_content: "# Source\n\nThis source supports a generated claim.",
    updated_at: "2026-05-05",
    ...overrides,
  };
}

function makeDraft(overrides: Partial<WikiDraftResult> = {}): WikiDraftResult {
  return {
    title: "source.md",
    summary: "The source supports a generated claim.",
    topics: [],
    claims: [],
    synthesis: {
      title: "source.md",
      content: "# source.md\n\nA supported synthesis.",
      chunk_indexes: [0],
    },
    ...overrides,
  };
}

function resetDb(rows: Record<string, Array<Record<string, unknown>>> = {}) {
  mocks.tables = {
    files: [],
    source_chunks: [],
    wiki_nodes: [],
    wiki_pages: [],
    wiki_revisions: [],
    wiki_edges: [],
    wiki_citations: [],
    ...rows,
  };

  mocks.query.mockImplementation(async (table: string, params: Record<string, string> = {}) => {
    let rows = [...(mocks.tables[table] ?? [])];
    for (const [key, value] of Object.entries(params)) {
      if (["select", "order", "limit"].includes(key)) continue;
      if (value.startsWith("eq.")) {
        const expected = value.slice(3);
        rows = rows.filter((row) => String(row[key]) === expected);
      } else if (value.startsWith("in.(") && value.endsWith(")")) {
        const allowed = new Set(value.slice(4, -1).split(","));
        rows = rows.filter((row) => allowed.has(String(row[key])));
      }
    }
    if (params.order) {
      const [rawColumn, rawDirection] = params.order.split(".");
      const desc = rawDirection === "desc";
      rows.sort((a, b) => {
        const av = a[rawColumn] as number | string;
        const bv = b[rawColumn] as number | string;
        if (av === bv) return 0;
        return (av > bv ? 1 : -1) * (desc ? -1 : 1);
      });
    }
    if (params.limit) rows = rows.slice(0, Number(params.limit));
    return rows;
  });

  mocks.insert.mockImplementation(
    async (table: string, input: Record<string, unknown> | Record<string, unknown>[]) => {
      const rows = (Array.isArray(input) ? input : [input]).map((row) => ({
        id: `${table}-${mocks.tables[table].length + 1}`,
        created_at: "2026-05-05T00:00:00.000Z",
        updated_at: "2026-05-05T00:00:00.000Z",
        ...row,
      }));
      mocks.tables[table].push(...rows);
      return rows;
    },
  );

  mocks.patch.mockImplementation(
    async (table: string, id: string, patch: Record<string, unknown>) => {
      const rows = mocks.tables[table] ?? [];
      const row = rows.find((item) => item.id === id);
      if (!row) return [];
      Object.assign(row, patch);
      return [row];
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  resetDb();
});

describe("chunkText", () => {
  it("creates stable overlapping chunks", () => {
    const chunks = chunkText("abcdefghijklmnopqrstuvwxyz", 10, 3);
    expect(chunks.map((chunk) => [chunk.char_start, chunk.char_end, chunk.content])).toEqual([
      [0, 10, "abcdefghij"],
      [7, 17, "hijklmnopq"],
      [14, 24, "opqrstuvwx"],
      [21, 26, "vwxyz"],
    ]);
  });
});

describe("runWikiBuilderForFile", () => {
  it("skips files without text and clears only needs_wiki", async () => {
    const file = makeFile({ text_content: null });
    resetDb({ files: [file as unknown as Record<string, unknown>] });

    await runWikiBuilderForFile(makeEnv(), file.id, file);

    expect(mocks.askArchitectForWikiDraft).not.toHaveBeenCalled();
    expect(mocks.tables.files[0]).toMatchObject({
      id: file.id,
      path: file.path,
      tags: ["wiki"],
      needs_wiki: false,
    });
    expect(mocks.tables.wiki_nodes).toHaveLength(0);
  });

  it("creates one visible digest page and ignores separate topic or claim nodes", async () => {
    const file = makeFile();
    resetDb({ files: [file as unknown as Record<string, unknown>] });
    mocks.askArchitectForWikiDraft.mockResolvedValue(
      makeDraft({
        topics: [{ title: "generated topic", summary: "A supported topic.", chunk_indexes: [0] }],
        claims: [
          { title: "supported claim", content: "A supported claim.", chunk_indexes: [0] },
          { title: "unsupported claim", content: "No matching chunk.", chunk_indexes: [999] },
        ],
      }),
    );

    await runWikiBuilderForFile(makeEnv(), file.id, file);

    const visibleNodes = mocks.tables.wiki_nodes.filter((node) => node.kind !== "source");
    expect(visibleNodes).toHaveLength(1);
    expect(visibleNodes[0]).toMatchObject({ kind: "synthesis", title: "source.md" });
    expect(mocks.tables.wiki_nodes.some((node) => node.kind === "claim")).toBe(false);
    expect(mocks.tables.wiki_nodes.some((node) => node.kind === "topic")).toBe(false);
    expect(mocks.tables.wiki_citations.length).toBeGreaterThan(0);
    expect(mocks.tables.files[0]).toMatchObject({ needs_wiki: false, path: file.path });
  });

  it("archives stale source-specific topic and claim nodes while keeping one digest current", async () => {
    const file = makeFile();
    resetDb({
      files: [file as unknown as Record<string, unknown>],
      wiki_nodes: [
        {
          id: "old-topic",
          kind: "topic",
          title: "old topic",
          slug: `topic-old-${file.id}`,
          status: "draft",
          source_file_id: file.id,
        },
        {
          id: "old-claim",
          kind: "claim",
          title: "old claim",
          slug: `claim-old-${file.id}`,
          status: "draft",
          source_file_id: file.id,
        },
      ],
      wiki_edges: [
        {
          id: "old-edge",
          source_node_id: "old-claim",
          target_node_id: "old-topic",
          type: "related_to",
          status: "draft",
          source_file_id: file.id,
        },
      ],
    });
    mocks.askArchitectForWikiDraft.mockResolvedValueOnce(makeDraft());

    await runWikiBuilderForFile(makeEnv(), file.id, file);

    expect(mocks.tables.wiki_nodes.find((node) => node.id === "old-topic")).toMatchObject({
      status: "archived",
    });
    expect(mocks.tables.wiki_nodes.find((node) => node.id === "old-claim")).toMatchObject({
      status: "archived",
    });
    expect(mocks.tables.wiki_edges.find((edge) => edge.id === "old-edge")).toMatchObject({
      status: "archived",
    });
    const currentVisible = mocks.tables.wiki_nodes.filter(
      (node) => node.kind !== "source" && node.status === "draft",
    );
    expect(currentVisible).toHaveLength(1);
    expect(currentVisible[0]).toMatchObject({ kind: "synthesis", title: "source.md" });
  });
});

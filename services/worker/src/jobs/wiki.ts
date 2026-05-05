import type {
  SourceChunk,
  VaultFile,
  WikiEdge,
  WikiNode,
  WikiPage,
  WikiRevision,
} from "@openbrain/shared";
import type { Env } from "../app";
import { askArchitectForWikiDraft, type WikiDraftResult } from "../lib/providers";
import { db } from "../lib/supabase";

const CHUNK_SIZE = 1200;
const CHUNK_OVERLAP = 200;
const SOURCE_DRAFT_KINDS = "in.(topic,claim,synthesis)";

interface WikiBuilderOptions {
  maxFiles?: number;
}

export interface SourceChunkDraft {
  chunk_index: number;
  content: string;
  char_start: number;
  char_end: number;
}

interface FileForWiki extends VaultFile {
  needs_wiki?: boolean;
}

export function chunkText(
  text: string,
  chunkSize = CHUNK_SIZE,
  overlap = CHUNK_OVERLAP,
): SourceChunkDraft[] {
  const chunks: SourceChunkDraft[] = [];
  const source = text.replace(/\r\n/g, "\n");
  if (!source.trim()) return chunks;

  let start = 0;
  while (start < source.length) {
    const end = Math.min(source.length, start + chunkSize);
    const content = source.slice(start, end);
    if (content.trim()) {
      chunks.push({
        chunk_index: chunks.length,
        content,
        char_start: start,
        char_end: end,
      });
    }
    if (end >= source.length) break;
    start = Math.max(end - overlap, start + 1);
  }

  return chunks;
}

export function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || "untitled";
}

export async function runWikiBuilder(env: Env, opts: WikiBuilderOptions = {}): Promise<void> {
  const max = opts.maxFiles ?? Number.parseInt(env.MAX_FILES_PER_RUN ?? "20", 10);
  console.log(`[wiki] sweep start at ${new Date().toISOString()}`);

  const files = (await db(env).query("files", {
    needs_wiki: "eq.true",
    select: "*",
    limit: String(max),
  })) as FileForWiki[];

  if (!files.length) {
    console.log("[wiki] no files need wiki generation");
    return;
  }

  console.log(`[wiki] processing ${files.length} files`);
  for (const file of files) {
    await runWikiBuilderForFile(env, file.id, file);
  }

  console.log("[wiki] sweep complete");
}

export async function runWikiBuilderForFile(
  env: Env,
  fileId: string,
  existingFile?: FileForWiki,
): Promise<void> {
  const file =
    existingFile ??
    (
      (await db(env).query("files", {
        id: `eq.${fileId}`,
        select: "*",
        limit: "1",
      })) as FileForWiki[]
    )[0];

  if (!file) return;
  await processFile(env, file);
}

async function processFile(env: Env, file: FileForWiki): Promise<void> {
  const text = file.text_content?.trim();
  if (!text) {
    await db(env).patch("files", file.id, { needs_wiki: false });
    console.log(`[wiki] skipped ${file.path}: no text content`);
    return;
  }

  const chunkDrafts = chunkText(file.text_content ?? "");
  if (!chunkDrafts.length) {
    await db(env).patch("files", file.id, { needs_wiki: false });
    console.log(`[wiki] skipped ${file.path}: no usable chunks`);
    return;
  }

  try {
    const chunks = await ensureSourceChunks(env, file, chunkDrafts);
    const generated = await askArchitectForWikiDraft(
      env,
      file.path,
      chunks.map((chunk) => ({ chunk_index: chunk.chunk_index, content: chunk.content })),
    );

    await archivePriorSourceDrafts(env, file.id);
    await writeWikiDraft(env, file, generated, chunks);
    await db(env).patch("files", file.id, { needs_wiki: false });
    console.log(`[wiki] generated draft wiki nodes for ${file.path}`);
  } catch (err) {
    console.warn(`[wiki] failed for ${file.path}:`, err);
  }
}

async function ensureSourceChunks(
  env: Env,
  file: FileForWiki,
  drafts: SourceChunkDraft[],
): Promise<SourceChunk[]> {
  const existing = (await db(env).query("source_chunks", {
    file_id: `eq.${file.id}`,
    source_sha256: `eq.${file.sha256}`,
    select: "*",
    order: "chunk_index.asc",
  })) as SourceChunk[];

  const existingIndexes = new Set(existing.map((chunk) => chunk.chunk_index));
  const missing = drafts
    .filter((chunk) => !existingIndexes.has(chunk.chunk_index))
    .map((chunk) => ({
      file_id: file.id,
      source_sha256: file.sha256,
      chunk_index: chunk.chunk_index,
      content: chunk.content,
      char_start: chunk.char_start,
      char_end: chunk.char_end,
    }));

  if (missing.length) {
    await db(env).insert("source_chunks", missing);
  }

  return (await db(env).query("source_chunks", {
    file_id: `eq.${file.id}`,
    source_sha256: `eq.${file.sha256}`,
    select: "*",
    order: "chunk_index.asc",
  })) as SourceChunk[];
}

async function archivePriorSourceDrafts(env: Env, fileId: string): Promise<void> {
  const staleNodes = (await db(env).query("wiki_nodes", {
    source_file_id: `eq.${fileId}`,
    status: "eq.draft",
    kind: SOURCE_DRAFT_KINDS,
    select: "id",
  })) as Pick<WikiNode, "id">[];
  await Promise.all(
    staleNodes.map((node) =>
      db(env).patch("wiki_nodes", node.id, {
        status: "archived",
        updated_at: new Date().toISOString(),
      }),
    ),
  );

  const staleEdges = (await db(env).query("wiki_edges", {
    source_file_id: `eq.${fileId}`,
    status: "eq.draft",
    select: "id",
  })) as Pick<WikiEdge, "id">[];
  await Promise.all(
    staleEdges.map((edge) =>
      db(env).patch("wiki_edges", edge.id, {
        status: "archived",
        updated_at: new Date().toISOString(),
      }),
    ),
  );
}

async function writeWikiDraft(
  env: Env,
  file: FileForWiki,
  generated: WikiDraftResult,
  chunks: SourceChunk[],
): Promise<void> {
  const chunkByIndex = new Map(chunks.map((chunk) => [chunk.chunk_index, chunk]));
  const sourceTitle = generated.title?.trim() || file.path.split("/").pop() || file.path;
  const sourceNode = await upsertWikiNode(env, {
    kind: "source",
    title: sourceTitle,
    slug: `source-${file.id}`,
    status: "draft",
    summary: generated.summary || null,
    source_file_id: file.id,
  });
  await writePageRevision(env, sourceNode, file, sourceTitle, sourcePageContent(file, generated), [
    chunks[0],
  ]);

  const synthesis = generated.synthesis;
  const synthesisCitations = synthesis ? validCitations(synthesis.chunk_indexes, chunkByIndex) : [];
  let synthesisNode: WikiNode | null = null;
  if (synthesisCitations.length) {
    const synthesisTitle = synthesis.title?.trim() || `${sourceTitle} synthesis`;
    synthesisNode = await upsertWikiNode(env, {
      kind: "synthesis",
      title: synthesisTitle,
      slug: `synthesis-${file.id}`,
      status: "draft",
      summary: generated.summary || null,
      source_file_id: file.id,
    });
    await writePageRevision(
      env,
      synthesisNode,
      file,
      synthesisTitle,
      synthesis.content || `# ${synthesisTitle}\n\n${generated.summary}`,
      synthesisCitations,
    );
    await upsertWikiEdge(env, synthesisNode.id, sourceNode.id, "derived_from", file.id, {
      confidence: 0.85,
      reason: "The synthesis was generated from the cited source chunks.",
    });
  }

  const topicNodes: WikiNode[] = [];
  const topics = Array.isArray(generated.topics) ? generated.topics : [];
  for (const topic of topics.slice(0, 6)) {
    const citations = validCitations(topic.chunk_indexes, chunkByIndex);
    if (!citations.length) continue;
    const title = topic.title?.trim();
    if (!title) continue;
    const node = await upsertWikiNode(env, {
      kind: "topic",
      title,
      slug: `topic-${slugify(title)}-${file.id}`,
      status: "draft",
      summary: topic.summary || null,
      source_file_id: file.id,
    });
    await writePageRevision(
      env,
      node,
      file,
      title,
      topicPageContent(title, topic.summary),
      citations,
    );
    await upsertWikiEdge(env, node.id, sourceNode.id, "mentions", file.id, {
      confidence: 0.75,
      reason: "The source chunks mention this topic.",
    });
    if (synthesisNode) {
      await upsertWikiEdge(env, node.id, synthesisNode.id, "part_of", file.id, {
        confidence: 0.7,
        reason: "The topic is part of the generated synthesis for this source.",
      });
    }
    topicNodes.push(node);
  }

  const claims = Array.isArray(generated.claims) ? generated.claims : [];
  for (const claim of claims.slice(0, 8)) {
    const citations = validCitations(claim.chunk_indexes, chunkByIndex);
    if (!citations.length) continue;
    const title = claim.title?.trim();
    const content = claim.content?.trim();
    if (!title || !content) continue;
    const node = await upsertWikiNode(env, {
      kind: "claim",
      title,
      slug: `claim-${slugify(title)}-${file.id}`,
      status: "draft",
      summary: content,
      source_file_id: file.id,
    });
    await writePageRevision(env, node, file, title, claimPageContent(title, content), citations);
    await upsertWikiEdge(env, node.id, sourceNode.id, "derived_from", file.id, {
      confidence: 0.8,
      reason: "The claim is grounded in cited source chunks.",
    });
    if (synthesisNode) {
      await upsertWikiEdge(env, node.id, synthesisNode.id, "supports", file.id, {
        confidence: 0.7,
        reason: "The claim supports the generated synthesis.",
      });
    }
    if (topicNodes[0]) {
      await upsertWikiEdge(env, node.id, topicNodes[0].id, "related_to", file.id, {
        confidence: 0.65,
        reason: "The claim and topic were extracted from the same source.",
      });
    }
  }
}

function validCitations(indexes: unknown, chunkByIndex: Map<number, SourceChunk>): SourceChunk[] {
  if (!Array.isArray(indexes)) return [];
  const uniqueIndexes = [
    ...new Set(indexes.filter((index): index is number => Number.isInteger(index))),
  ];
  return uniqueIndexes
    .map((index) => chunkByIndex.get(index))
    .filter((chunk): chunk is SourceChunk => Boolean(chunk));
}

async function upsertWikiNode(
  env: Env,
  row: Pick<WikiNode, "kind" | "title" | "slug" | "status" | "summary" | "source_file_id">,
): Promise<WikiNode> {
  const existing = (await db(env).query("wiki_nodes", {
    kind: `eq.${row.kind}`,
    slug: `eq.${row.slug}`,
    select: "*",
    limit: "1",
  })) as WikiNode[];
  const patch = {
    title: row.title,
    status: row.status,
    summary: row.summary ?? null,
    source_file_id: row.source_file_id ?? null,
    updated_at: new Date().toISOString(),
  };
  if (existing[0]) {
    const rows = (await db(env).patch("wiki_nodes", existing[0].id, patch)) as WikiNode[];
    return rows[0];
  }
  const rows = (await db(env).insert("wiki_nodes", row)) as WikiNode[];
  return rows[0];
}

async function writePageRevision(
  env: Env,
  node: WikiNode,
  file: FileForWiki,
  title: string,
  content: string,
  citations: SourceChunk[],
): Promise<void> {
  const page = await upsertWikiPage(env, node.id, title, content);
  const latest = (await db(env).query("wiki_revisions", {
    page_id: `eq.${page.id}`,
    select: "revision_number",
    order: "revision_number.desc",
    limit: "1",
  })) as Pick<WikiRevision, "revision_number">[];
  const revisionNumber = (latest[0]?.revision_number ?? 0) + 1;
  const revisionRows = (await db(env).insert("wiki_revisions", {
    page_id: page.id,
    source_file_id: file.id,
    revision_number: revisionNumber,
    title,
    content,
    reason: `Generated from ${file.path}`,
  })) as WikiRevision[];
  const revision = revisionRows[0];

  const citationRows = citations.map((chunk) => ({
    node_id: node.id,
    revision_id: revision.id,
    chunk_id: chunk.id,
    quote: chunk.content.trim().slice(0, 240),
  }));
  if (citationRows.length) await db(env).insert("wiki_citations", citationRows);
}

async function upsertWikiPage(
  env: Env,
  nodeId: string,
  title: string,
  content: string,
): Promise<WikiPage> {
  const existing = (await db(env).query("wiki_pages", {
    node_id: `eq.${nodeId}`,
    select: "*",
    limit: "1",
  })) as WikiPage[];
  if (existing[0]) {
    const rows = (await db(env).patch("wiki_pages", existing[0].id, {
      title,
      content,
      updated_at: new Date().toISOString(),
    })) as WikiPage[];
    return rows[0];
  }
  const rows = (await db(env).insert("wiki_pages", {
    node_id: nodeId,
    title,
    content,
  })) as WikiPage[];
  return rows[0];
}

async function upsertWikiEdge(
  env: Env,
  sourceNodeId: string,
  targetNodeId: string,
  type: WikiEdge["type"],
  sourceFileId: string,
  metadata: { confidence: number; reason: string },
): Promise<void> {
  const existing = (await db(env).query("wiki_edges", {
    source_node_id: `eq.${sourceNodeId}`,
    target_node_id: `eq.${targetNodeId}`,
    type: `eq.${type}`,
    source_file_id: `eq.${sourceFileId}`,
    select: "*",
    limit: "1",
  })) as WikiEdge[];
  const row = {
    source_node_id: sourceNodeId,
    target_node_id: targetNodeId,
    type,
    status: "draft",
    confidence: metadata.confidence,
    reason: metadata.reason,
    source_file_id: sourceFileId,
    updated_at: new Date().toISOString(),
  };
  if (existing[0]) {
    await db(env).patch("wiki_edges", existing[0].id, row);
  } else {
    await db(env).insert("wiki_edges", row);
  }
}

function sourcePageContent(file: FileForWiki, generated: WikiDraftResult): string {
  return `# ${generated.title || file.path}\n\n${generated.summary || "Draft source summary."}\n\nSource: ${file.path}`;
}

function topicPageContent(title: string, summary: string): string {
  return `# ${title}\n\n${summary || "Draft topic extracted from the source."}`;
}

function claimPageContent(title: string, content: string): string {
  return `# ${title}\n\n${content}`;
}

import type { Env } from "../app";
import type { VaultFile } from "@openbrain/shared";
import { db } from "../lib/supabase";
import { askArchitectIfRelated, embedText } from "../lib/providers";
import { proposeLink } from "../routes/links";

const MIN_NEIGHBOR_CONFIDENCE = 0.65;

export interface LinkerOptions {
  maxFiles?: number;
}

interface NeighborRow {
  file_id: string;
  path: string;
  confidence: number;
}

export async function runLinker(env: Env, opts: LinkerOptions = {}): Promise<void> {
  const max = opts.maxFiles ?? Number.parseInt(env.MAX_FILES_PER_RUN ?? "20", 10);
  console.log(`[linker] sweep start at ${new Date().toISOString()}`);

  const files = (await db(env).query("files", {
    needs_linking: "eq.true",
    select: "*",
    limit: String(max),
  })) as VaultFile[];

  if (!files.length) {
    console.log("[linker] no files need linking");
    return;
  }

  console.log(`[linker] processing ${files.length} files`);
  for (const file of files) {
    await processOne(env, file);
  }

  console.log("[linker] sweep complete");
}

export async function runLinkerForFile(env: Env, fileId: string): Promise<void> {
  const rows = (await db(env).query("files", {
    id: `eq.${fileId}`,
    select: "*",
  })) as VaultFile[];
  if (!rows.length) return;
  await processOne(env, rows[0]);
}

async function processOne(env: Env, file: VaultFile): Promise<void> {
  const title = file.path.split("/").pop() ?? file.path;

  // 1. Embed file content (text_content for text/docx files, title as fallback for binaries)
  const textToEmbed = (file as VaultFile & { text_content?: string | null }).text_content?.slice(0, 8192) || title;
  try {
    const embedding = await embedText(env, textToEmbed, "RETRIEVAL_DOCUMENT");
    await db(env).upsert("embeddings", {
      file_id: file.id,
      embedding: JSON.stringify(embedding),
      text_preview: textToEmbed.slice(0, 200),
      embedded_at: new Date().toISOString(),
    });
    await db(env).patch("files", file.id, { needs_embedding: false });
  } catch (e) {
    console.warn(`[linker] embed failed for ${file.path}:`, e);
    return;
  }

  // 2. Find nearest neighbors via pgvector
  let neighbors: NeighborRow[];
  try {
    neighbors = (await db(env).rpc("neighbors", {
      target_file_id: file.id,
      result_limit: 10,
    })) as NeighborRow[];
  } catch (e) {
    console.warn(`[linker] neighbor lookup failed for ${file.path}:`, e);
    return;
  }

  // 3. Evaluate each candidate pair
  for (const neighbor of neighbors) {
    if (neighbor.confidence < MIN_NEIGHBOR_CONFIDENCE) continue;

    const neighborTitle = neighbor.path.split("/").pop() ?? neighbor.path;

    let result: { related: boolean; reason: string; confidence: number };
    try {
      result = await askArchitectIfRelated(env, title, neighborTitle, title, neighborTitle);
    } catch (e) {
      console.warn(`[linker] reasoning failed for (${title}, ${neighborTitle}):`, e);
      continue;
    }
    if (!result.related) continue;

    try {
      await proposeLink(env, {
        file_a_id: file.id,
        file_b_id: neighbor.file_id,
        confidence: result.confidence,
        reason: result.reason,
      });
      console.log(
        `[linker] proposed: "${title}" ↔ "${neighborTitle}" (${Math.round(result.confidence * 100)}%)`,
      );
    } catch (e) {
      // Duplicate-link errors are expected when the same pair is re-proposed; ignore them.
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("23505")) continue;
      console.warn(`[linker] proposal failed for (${title}, ${neighborTitle}):`, e);
    }
  }

  // 4. Mark linking complete (even if zero proposals — "no neighbors" is a valid terminal state).
  try {
    await db(env).patch("files", file.id, { needs_linking: false });
  } catch (e) {
    console.warn(`[linker] failed to clear needs_linking for ${file.path}:`, e);
  }
}

import type { Env } from "../app";
import type { VaultFile } from "@openbrain/shared";
import { db } from "../lib/supabase";
import { askArchitectToOrganize } from "../lib/providers";

export interface TaggerOptions {
  maxFiles?: number;
}

interface CorrectionRow {
  field: string;
  old_value: string;
  new_value: string;
}

export async function runTagger(env: Env, opts: TaggerOptions = {}): Promise<void> {
  const max = opts.maxFiles ?? Number.parseInt(env.MAX_FILES_PER_RUN ?? "20", 10);
  console.log(`[tagger] sweep start at ${new Date().toISOString()}`);

  const files = (await db(env).query("files", {
    needs_tagging: "eq.true",
    select: "*",
    limit: String(max),
  })) as VaultFile[];

  if (!files.length) {
    console.log("[tagger] no files need tagging");
    return;
  }

  const { folders, tags, corrections } = await loadVocabulary(env);

  console.log(`[tagger] processing ${files.length} files`);
  for (const file of files) {
    await processOne(env, file, folders, tags, corrections);
  }

  console.log("[tagger] sweep complete");
}

export async function runTaggerForFile(env: Env, fileId: string): Promise<void> {
  const rows = (await db(env).query("files", {
    id: `eq.${fileId}`,
    select: "*",
  })) as VaultFile[];
  if (!rows.length) return;
  const { folders, tags, corrections } = await loadVocabulary(env);
  await processOne(env, rows[0], folders, tags, corrections);
}

async function loadVocabulary(env: Env): Promise<{
  folders: string[];
  tags: string[];
  corrections: string;
}> {
  const allFiles = (await db(env).query("files", {
    select: "folder,tags",
    limit: "500",
  })) as Pick<VaultFile, "folder" | "tags">[];

  const folders = [
    ...new Set(allFiles.map((f) => f.folder).filter((x): x is string => Boolean(x))),
  ];
  const tags = [...new Set(allFiles.flatMap((f) => f.tags ?? []))];

  let corrections = "";
  try {
    const rows = (await db(env).query("corrections", {
      select: "field,old_value,new_value",
      order: "created_at.desc",
      limit: "20",
    })) as CorrectionRow[];
    if (rows.length) {
      const lines = rows.map(
        (c) => `- Changed ${c.field} from "${c.old_value}" to "${c.new_value}"`,
      );
      corrections = `\nRecent corrections to learn from:\n${lines.join("\n")}\n`;
    }
  } catch (e) {
    console.warn("[tagger] failed to load corrections:", e);
  }

  return { folders, tags, corrections };
}

async function processOne(
  env: Env,
  file: VaultFile,
  folders: string[],
  tags: string[],
  corrections: string,
): Promise<void> {
  try {
    const suggestion = await askArchitectToOrganize(env, file.path, folders, tags, corrections);
    const title = file.path.split("/").pop() ?? file.path;

    await db(env).insert("architect_suggestions", {
      file_id: file.id,
      type: "folder",
      title: `Move ${title} to ${suggestion.folder}`,
      reason:
        "The Architect found this folder to be the best fit based on the file name, existing vault structure, and recent corrections.",
      payload: { folder: suggestion.folder },
      confidence: 0.7,
      status: "pending",
    });

    await db(env).insert("architect_suggestions", {
      file_id: file.id,
      type: "tags",
      title: `Tag ${title}`,
      reason:
        "The Architect found these tags relevant and reusable for future search and graph context.",
      payload: { tags: suggestion.tags },
      confidence: 0.7,
      status: "pending",
    });

    await db(env).patch("files", file.id, { needs_tagging: false });

    console.log(
      `[tagger] suggested for "${title}" -> folder: ${suggestion.folder}, tags: ${suggestion.tags.join(", ")}`,
    );

    if (suggestion.folder && !folders.includes(suggestion.folder)) folders.push(suggestion.folder);
    suggestion.tags.forEach((t) => {
      if (!tags.includes(t)) tags.push(t);
    });
  } catch (e) {
    console.warn(`[tagger] failed for ${file.path}:`, e);
  }
}

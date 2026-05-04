/**
 * The Architect's folder/tag suggestion job.
 * Run: tsx src/jobs/tagger.ts
 */
import { fileURLToPath } from "node:url";
import type { VaultFile } from "../../../../packages/shared/src/types";
import {
  ensureParaFolderPath,
  PARA_ROOTS,
  paraPlacementReason,
  paraRootDescription,
} from "../../../../packages/shared/src/para";
import { deterministicOrganization, isDeterministicProvider } from "./deterministic";

const API = process.env.OPENBRAIN_API_URL!;
const TOKEN = process.env.OPENBRAIN_AUTH_TOKEN!;
const MAX_FILES = parseInt(process.env.MAX_FILES_PER_RUN ?? "20");
const MODEL = process.env.ARCHITECT_MODEL ?? "gpt-4.1-mini";

const headers = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

function sanitizeApiErrorBody(body: string): string {
  const redacted = body
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/g, "Bearer [REDACTED]")
    .replace(/(AUTHORIZATION<\/td>\s*<td>\s*)[^<]+/gi, "$1[REDACTED]");

  const pgrstMessage = redacted.match(/&quot;message&quot;:&quot;([\s\S]*?)&quot;}/);
  if (pgrstMessage) {
    return `Supabase error: ${pgrstMessage[1]
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&")}`;
  }

  const compact = redacted.replace(/\s+/g, " ").trim();
  return compact.length > 1200 ? `${compact.slice(0, 1200)}... [truncated]` : compact;
}

async function apiFetch(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: { ...headers, ...((opts.headers as Record<string, string>) ?? {}) },
  });
  if (!res.ok) {
    throw new Error(`API ${path} failed ${res.status}: ${sanitizeApiErrorBody(await res.text())}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export async function getRecentCorrections(): Promise<string> {
  // Fetch last 20 corrections to give The Architect context about your preferences.
  const res = await fetch(`${API}/corrections?limit=20`, { headers });
  if (!res.ok) return "";
  const corrections = (await res.json()) as Array<{
    field: string;
    old_value: string;
    new_value: string;
  }>;
  if (!corrections.length) return "";
  const lines = corrections.map(
    (c) => `- Changed ${c.field} from "${c.old_value}" to "${c.new_value}"`,
  );
  return `\nRecent corrections to learn from:\n${lines.join("\n")}\n`;
}

export async function askArchitectToOrganize(
  filePath: string,
  existingFolders: string[],
  existingTags: string[],
  corrections: string,
): Promise<{ folder: string; tags: string[] }> {
  const provider = process.env.ARCHITECT_MODEL_PROVIDER ?? "openai";

  if (isDeterministicProvider(provider)) {
    const result = deterministicOrganization(filePath);
    return { ...result, folder: ensureParaFolderPath(result.folder) };
  }

  const filename = filePath.split("/").pop() ?? filePath;
  const folderList = existingFolders.slice(0, 30).join(", ");
  const tagList = existingTags.slice(0, 50).join(", ");
  const paraGuide = PARA_ROOTS.map((root) => `- ${root}: ${paraRootDescription(root)}`).join("\n");

  const prompt = `You are The Architect for a personal OpenBrain knowledge vault.
Suggest a PARA folder and tags for this file. Prefer existing folders and tags unless a new one is clearly justified.
The folder must start with one of these PARA roots:
${paraGuide}

Filename: "${filename}"
Full path: "${filePath}"

Existing folders (use one if it fits, create a new one if needed):
${folderList || "No folders yet."}

Existing tags (reuse if relevant, create new ones if needed):
${tagList || "No tags yet."}
${corrections}
Respond with JSON only:
{"folder": "Projects|Areas|Resources|Archive/suggested/path", "tags": ["tag1", "tag2", "tag3"]}`;

  if (provider === "anthropic") {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY!,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 300,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const data = (await res.json()) as { content: { text: string }[] };
    const result = JSON.parse(data.content[0].text) as { folder: string; tags: string[] };
    return { ...result, folder: ensureParaFolderPath(result.folder) };
  }

  if (provider === "openai") {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
      }),
    });
    const data = (await res.json()) as { choices: { message: { content: string } }[] };
    const result = JSON.parse(data.choices[0].message.content) as {
      folder: string;
      tags: string[];
    };
    return { ...result, folder: ensureParaFolderPath(result.folder) };
  }

  if (provider === "ollama") {
    const base = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
    const res = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "user", content: prompt }],
        format: "json",
      }),
    });
    const data = (await res.json()) as { choices: { message: { content: string } }[] };
    const result = JSON.parse(data.choices[0].message.content) as {
      folder: string;
      tags: string[];
    };
    return { ...result, folder: ensureParaFolderPath(result.folder) };
  }

  throw new Error(`Unsupported ARCHITECT_MODEL_PROVIDER: ${provider}`);
}

export async function main() {
  console.log(`[tagger] Starting run at ${new Date().toISOString()}`);

  const files: VaultFile[] = await apiFetch(`/files?needs_tagging=true&limit=${MAX_FILES}`);
  if (!files.length) {
    console.log("[tagger] No files need tagging. Done.");
    return;
  }

  // Gather existing folders + tags for context
  const allFiles: VaultFile[] = await apiFetch("/files?select=folder,tags&limit=500");
  const existingFolders = [
    ...new Set([...PARA_ROOTS, ...(allFiles.map((f) => f.folder).filter(Boolean) as string[])]),
  ];
  const existingTags = [...new Set(allFiles.flatMap((f) => f.tags ?? []))];
  const corrections = await getRecentCorrections();

  console.log(`[tagger] Processing ${files.length} files`);

  for (const file of files) {
    try {
      const suggestion = await askArchitectToOrganize(
        file.path,
        existingFolders,
        existingTags,
        corrections,
      );

      const title = file.path.split("/").pop() ?? file.path;

      await apiFetch("/architect/suggestions", {
        method: "POST",
        body: JSON.stringify({
          file_id: file.id,
          type: "folder",
          title: `Place ${title} in ${suggestion.folder}`,
          reason: paraPlacementReason(suggestion.folder),
          payload: { folder: suggestion.folder },
          confidence: 0.7,
        }),
      });

      await apiFetch("/architect/suggestions", {
        method: "POST",
        body: JSON.stringify({
          file_id: file.id,
          type: "tags",
          title: `Tag ${title}`,
          reason:
            "The Architect found these tags relevant and reusable for future search and graph context.",
          payload: { tags: suggestion.tags },
          confidence: 0.7,
        }),
      });

      await apiFetch(`/files/${file.id}`, {
        method: "PATCH",
        body: JSON.stringify({ needs_tagging: false }),
      });

      console.log(
        `[tagger] Suggested review items for "${title}" -> folder: ${suggestion.folder}, tags: ${suggestion.tags.join(", ")}`,
      );

      // Add new folder/tags to our local cache for subsequent files
      if (suggestion.folder && !existingFolders.includes(suggestion.folder)) {
        existingFolders.push(suggestion.folder);
      }
      suggestion.tags.forEach((t) => {
        if (!existingTags.includes(t)) existingTags.push(t);
      });
    } catch (e) {
      console.warn(`[tagger] Failed for ${file.path}:`, e);
    }
  }

  console.log("[tagger] Run complete.");
}

const isEntrypoint = process.argv[1] === fileURLToPath(import.meta.url);
if (isEntrypoint) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

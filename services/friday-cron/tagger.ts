/**
 * Friday's hourly tagger cron.
 * Run: tsx tagger.ts
 * Schedule via Openclaw: every hour alongside linker.ts
 */
import { fileURLToPath } from "node:url";
import type { VaultFile } from "../../packages/shared/src/types";

const API = process.env.OPENBRAIN_API_URL!;
const TOKEN = process.env.OPENBRAIN_AUTH_TOKEN!;
const MAX_FILES = parseInt(process.env.MAX_FILES_PER_RUN ?? "20");
const MODEL_PROVIDER = process.env.FRIDAY_MODEL_PROVIDER ?? "anthropic";
const MODEL = process.env.FRIDAY_MODEL ?? "claude-opus-4-7";

const headers = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

async function apiFetch(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: { ...headers, ...((opts.headers as Record<string, string>) ?? {}) },
  });
  if (!res.ok) throw new Error(`API ${path} failed ${res.status}: ${await res.text()}`);
  if (res.status === 204) return null;
  return res.json();
}

export async function getRecentCorrections(): Promise<string> {
  // Fetch last 20 corrections to give Friday context about your preferences
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

async function askFridayToOrganize(
  filePath: string,
  existingFolders: string[],
  existingTags: string[],
  corrections: string,
): Promise<{ folder: string; tags: string[] }> {
  const filename = filePath.split("/").pop() ?? filePath;
  const folderList = existingFolders.slice(0, 30).join(", ");
  const tagList = existingTags.slice(0, 50).join(", ");

  const prompt = `You are organizing a personal knowledge vault. Suggest a folder and tags for this file.

Filename: "${filename}"
Full path: "${filePath}"

Existing folders (use one if it fits, create a new one if needed):
${folderList || "No folders yet."}

Existing tags (reuse if relevant, create new ones if needed):
${tagList || "No tags yet."}
${corrections}
Respond with JSON only:
{"folder": "suggested/folder/path", "tags": ["tag1", "tag2", "tag3"]}`;

  if (MODEL_PROVIDER === "anthropic") {
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
    return JSON.parse(data.content[0].text);
  }

  if (MODEL_PROVIDER === "openai") {
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
    return JSON.parse(data.choices[0].message.content);
  }

  if (MODEL_PROVIDER === "ollama") {
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
    return JSON.parse(data.choices[0].message.content);
  }

  throw new Error(`Unsupported FRIDAY_MODEL_PROVIDER: ${MODEL_PROVIDER}`);
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
  const existingFolders = [...new Set(allFiles.map((f) => f.folder).filter(Boolean) as string[])];
  const existingTags = [...new Set(allFiles.flatMap((f) => f.tags ?? []))];
  const corrections = await getRecentCorrections();

  console.log(`[tagger] Processing ${files.length} files`);

  for (const file of files) {
    try {
      const suggestion = await askFridayToOrganize(
        file.path,
        existingFolders,
        existingTags,
        corrections,
      );

      await apiFetch(`/files/${file.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          folder: suggestion.folder,
          tags: suggestion.tags,
          needs_tagging: false,
        }),
      });

      console.log(
        `[tagger] Tagged "${file.path.split("/").pop()}" → folder: ${suggestion.folder}, tags: ${suggestion.tags.join(", ")}`,
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

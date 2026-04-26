/**
 * Friday's hourly linker cron.
 * Run: tsx linker.ts
 * Schedule via Openclaw: every hour (or however Friday's cron is configured)
 */
import { fileURLToPath } from "node:url";
import type { VaultFile } from "../../packages/shared/src/types";

const API = process.env.OPENBRAIN_API_URL!;
const TOKEN = process.env.OPENBRAIN_AUTH_TOKEN!;
const MAX_FILES = parseInt(process.env.MAX_FILES_PER_RUN ?? "20");
export const EMBEDDING_DIMENSIONS = 1024;

const headers = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

export class ApiError extends Error {
  constructor(
    public path: string,
    public status: number,
    public body: string,
  ) {
    super(`API ${path} failed ${status}: ${body}`);
    this.name = "ApiError";
  }
}

async function apiFetch(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: { ...headers, ...((opts.headers as Record<string, string>) ?? {}) },
  });
  if (!res.ok) throw new ApiError(path, res.status, await res.text());
  return res.json();
}

// Postgres unique-violation SQLSTATE — surfaced by Supabase REST when a duplicate link
// is proposed. Treated as a no-op rather than a failure.
const PG_UNIQUE_VIOLATION = "23505";

export function isDuplicateLinkError(e: unknown): boolean {
  return e instanceof ApiError && e.status === 409 && e.body.includes(PG_UNIQUE_VIOLATION);
}

// ── Embedding ────────────────────────────────────────────────────────────────

async function embedText(text: string): Promise<number[]> {
  const provider = process.env.EMBEDDING_PROVIDER ?? "voyage";

  if (provider === "voyage") {
    const res = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: "voyage-3", input: [text] }),
    });
    const data = (await res.json()) as { data: { embedding: number[] }[] };
    return data.data[0].embedding;
  }

  if (provider === "openai") {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      // dimensions forces the output to match the Supabase vector(1024) column
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: text,
        dimensions: EMBEDDING_DIMENSIONS,
      }),
    });
    const data = (await res.json()) as { data: { embedding: number[] }[] };
    const vec = data.data[0].embedding;
    if (vec.length !== EMBEDDING_DIMENSIONS) {
      throw new Error(
        `OpenAI returned ${vec.length}-dim embedding, expected ${EMBEDDING_DIMENSIONS}`,
      );
    }
    return vec;
  }

  throw new Error(`Unsupported EMBEDDING_PROVIDER: ${provider}`);
}

// ── Reasoning ────────────────────────────────────────────────────────────────

async function askFridayIfRelated(
  titleA: string,
  titleB: string,
  previewA: string,
  previewB: string,
): Promise<{ related: boolean; reason: string; confidence: number }> {
  const provider = process.env.FRIDAY_MODEL_PROVIDER ?? "anthropic";
  const model = process.env.FRIDAY_MODEL ?? "claude-opus-4-7";

  const prompt = `You are an AI knowledge assistant. Determine if these two notes are meaningfully related.

Note A: "${titleA}"
Preview: ${previewA.slice(0, 300)}

Note B: "${titleB}"
Preview: ${previewB.slice(0, 300)}

Respond with JSON only:
{"related": true|false, "reason": "one-sentence explanation", "confidence": 0.0-1.0}`;

  if (provider === "anthropic") {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY!,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 200,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const data = (await res.json()) as { content: { text: string }[] };
    return JSON.parse(data.content[0].text);
  }

  if (provider === "openai") {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
      }),
    });
    const data = (await res.json()) as { choices: { message: { content: string } }[] };
    return JSON.parse(data.choices[0].message.content);
  }

  throw new Error(`Unsupported FRIDAY_MODEL_PROVIDER: ${provider}`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`[linker] Starting run at ${new Date().toISOString()}`);

  // 1. Fetch files that need linking
  const files: VaultFile[] = await apiFetch(`/files?needs_linking=true&limit=${MAX_FILES}`);
  if (!files.length) {
    console.log("[linker] No files need linking. Done.");
    return;
  }
  console.log(`[linker] Processing ${files.length} files`);

  for (const file of files) {
    const title = file.path.split("/").pop() ?? file.path;

    // 2. Embed if not done yet (embedding endpoint returns 404 if missing)
    try {
      const text = title; // minimal: just the filename if no text extracted yet
      const embedding = await embedText(text);
      await apiFetch(`/files/${file.id}/embedding`, {
        method: "POST",
        body: JSON.stringify({ embedding, text_preview: text }),
      });
    } catch (e) {
      console.warn(`[linker] Embed failed for ${file.path}:`, e);
      continue;
    }

    // 3. Find nearest neighbors
    const neighbors: Array<{ file_id: string; path: string; confidence: number }> = await apiFetch(
      `/files/${file.id}/neighbors?k=10`,
    );

    // 4. Evaluate each candidate pair
    for (const neighbor of neighbors) {
      if (neighbor.confidence < 0.65) continue; // below minimum threshold

      const neighborTitle = neighbor.path.split("/").pop() ?? neighbor.path;

      let result: { related: boolean; reason: string; confidence: number };
      try {
        result = await askFridayIfRelated(title, neighborTitle, title, neighborTitle);
      } catch (e) {
        console.warn(`[linker] Reasoning failed for pair (${title}, ${neighborTitle}):`, e);
        continue;
      }

      if (!result.related) continue;

      // 5. Post the link proposal (Worker handles Telegram notification + trust check)
      try {
        await apiFetch("/links/proposals", {
          method: "POST",
          body: JSON.stringify({
            file_a_id: file.id,
            file_b_id: neighbor.file_id,
            confidence: result.confidence,
            reason: result.reason,
          }),
        });
        console.log(
          `[linker] Proposed: "${title}" ↔ "${neighborTitle}" (${Math.round(result.confidence * 100)}%)`,
        );
      } catch (e) {
        if (isDuplicateLinkError(e)) {
          continue;
        }
        console.warn(`[linker] Proposal failed for (${title}, ${neighborTitle}):`, e);
      }
    }

    // 6. Mark done. Clear only after embedding succeeded and the neighbor loop completed —
    // even if zero proposals were made, "no neighbors found" is a valid terminal state.
    // Future files that embed will discover this file through their own neighbor scans.
    try {
      await apiFetch(`/files/${file.id}`, {
        method: "PATCH",
        body: JSON.stringify({ needs_linking: false }),
      });
    } catch (e) {
      console.warn(`[linker] Failed to clear needs_linking for ${file.path}:`, e);
    }
  }

  console.log("[linker] Run complete.");
}

const isEntrypoint = process.argv[1] === fileURLToPath(import.meta.url);
if (isEntrypoint) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

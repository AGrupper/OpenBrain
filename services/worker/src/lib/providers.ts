import type { Env } from "../app";
import { ensureParaFolderPath, PARA_ROOTS, paraRootDescription } from "@openbrain/shared";
import {
  deterministicEmbedding,
  deterministicOrganization,
  deterministicRelatedness,
  deterministicWikiDraft,
  isDeterministicProvider,
} from "../jobs/deterministic";

export const EMBEDDING_DIMENSIONS = 1024;

export type EmbedTaskType = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";

export async function embedText(
  env: Env,
  text: string,
  taskType: EmbedTaskType = "RETRIEVAL_DOCUMENT",
): Promise<number[]> {
  const provider = env.EMBEDDING_PROVIDER ?? "gemini";

  if (env.ARCHITECT_DETERMINISTIC === "true" || isDeterministicProvider(provider)) {
    return deterministicEmbedding(text, EMBEDDING_DIMENSIONS);
  }

  if (provider === "gemini") {
    if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not configured");
    const model = env.GEMINI_EMBEDDING_MODEL ?? "gemini-embedding-2";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${env.GEMINI_API_KEY}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: { parts: [{ text }] },
        taskType,
        outputDimensionality: EMBEDDING_DIMENSIONS,
      }),
    });
    if (!res.ok) throw new Error(`Gemini embed failed: ${await res.text()}`);
    const data = (await res.json()) as { embedding: { values: number[] } };
    const vec = data.embedding?.values;
    if (!Array.isArray(vec) || vec.length !== EMBEDDING_DIMENSIONS) {
      throw new Error(
        `Gemini returned ${vec?.length ?? "no"}-dim embedding, expected ${EMBEDDING_DIMENSIONS}`,
      );
    }
    return vec;
  }

  if (provider === "voyage") {
    if (!env.VOYAGE_API_KEY) throw new Error("VOYAGE_API_KEY is not configured");
    const res = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.VOYAGE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: env.VOYAGE_EMBEDDING_MODEL ?? "voyage-3-large",
        input: [text],
        input_type: taskType === "RETRIEVAL_QUERY" ? "query" : "document",
      }),
    });
    if (!res.ok) throw new Error(`Voyage embed failed: ${await res.text()}`);
    const data = (await res.json()) as { data: { embedding: number[] }[] };
    const vec = data.data[0].embedding;
    if (vec.length !== EMBEDDING_DIMENSIONS) {
      throw new Error(
        `Voyage returned ${vec.length}-dim embedding, expected ${EMBEDDING_DIMENSIONS}`,
      );
    }
    return vec;
  }

  if (provider === "openai") {
    if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured");
    const baseUrl = env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
    const res = await fetch(`${baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small",
        input: text,
        dimensions: EMBEDDING_DIMENSIONS,
      }),
    });
    if (!res.ok) throw new Error(`OpenAI embed failed: ${await res.text()}`);
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

export interface AskLLMOptions {
  systemPrompt?: string;
  jsonMode?: boolean;
  maxTokens?: number;
  temperature?: number;
}

export interface WikiDraftChunkInput {
  chunk_index: number;
  content: string;
}

export interface WikiDraftResult {
  title: string;
  summary: string;
  topics: Array<{ title: string; summary: string; chunk_indexes: number[] }>;
  claims: Array<{ title: string; content: string; chunk_indexes: number[] }>;
  synthesis: { title: string; content: string; chunk_indexes: number[] };
}

export async function askLLM(env: Env, prompt: string, opts: AskLLMOptions = {}): Promise<string> {
  const provider = env.ARCHITECT_MODEL_PROVIDER ?? "openai";
  const model = env.ARCHITECT_MODEL ?? "deepseek-chat";

  if (env.ARCHITECT_DETERMINISTIC === "true" || isDeterministicProvider(provider)) {
    throw new Error("askLLM should not be invoked in deterministic mode; use a path-aware caller");
  }

  if (provider === "openai") {
    if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured");
    const baseUrl = env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
    const messages: Array<{ role: string; content: string }> = [];
    if (opts.systemPrompt) messages.push({ role: "system", content: opts.systemPrompt });
    messages.push({ role: "user", content: prompt });

    const body: Record<string, unknown> = {
      model,
      messages,
      temperature: opts.temperature ?? 0.2,
    };
    if (opts.jsonMode) body.response_format = { type: "json_object" };
    if (opts.maxTokens) body.max_tokens = opts.maxTokens;

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`LLM call failed: ${await res.text()}`);
    const data = (await res.json()) as { choices: { message: { content: string } }[] };
    return data.choices[0]?.message.content ?? "";
  }

  if (provider === "anthropic") {
    if (!env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not configured");
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: opts.maxTokens ?? 1024,
        system: opts.systemPrompt,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic LLM call failed: ${await res.text()}`);
    const data = (await res.json()) as { content: { text: string }[] };
    return data.content[0]?.text ?? "";
  }

  if (provider === "gemini") {
    if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not configured");
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`;
    const body: Record<string, unknown> = {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: opts.temperature ?? 0.2,
        ...(opts.jsonMode ? { responseMimeType: "application/json" } : {}),
        ...(opts.maxTokens ? { maxOutputTokens: opts.maxTokens } : {}),
      },
    };
    if (opts.systemPrompt) {
      body.systemInstruction = { parts: [{ text: opts.systemPrompt }] };
    }
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Gemini LLM call failed: ${await res.text()}`);
    const data = (await res.json()) as {
      candidates: { content: { parts: { text: string }[] } }[];
    };
    return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  }

  throw new Error(`Unsupported ARCHITECT_MODEL_PROVIDER: ${provider}`);
}

export async function askArchitectIfRelated(
  env: Env,
  titleA: string,
  titleB: string,
  previewA: string,
  previewB: string,
): Promise<{ related: boolean; reason: string; confidence: number }> {
  const provider = env.ARCHITECT_MODEL_PROVIDER ?? "openai";
  if (env.ARCHITECT_DETERMINISTIC === "true" || isDeterministicProvider(provider)) {
    return deterministicRelatedness(titleA, titleB);
  }

  const prompt = `You are The Architect for a personal OpenBrain knowledge vault. Determine if these two files are meaningfully related.

Note A: "${titleA}"
Preview: ${previewA.slice(0, 300)}

Note B: "${titleB}"
Preview: ${previewB.slice(0, 300)}

Respond with JSON only:
{"related": true|false, "reason": "one-sentence explanation", "confidence": 0.0-1.0}`;

  const raw = await askLLM(env, prompt, { jsonMode: true, maxTokens: 200 });
  return JSON.parse(raw) as { related: boolean; reason: string; confidence: number };
}

export async function askArchitectToOrganize(
  env: Env,
  filePath: string,
  existingFolders: string[],
  existingTags: string[],
  corrections: string,
): Promise<{ folder: string; tags: string[] }> {
  const provider = env.ARCHITECT_MODEL_PROVIDER ?? "openai";
  if (env.ARCHITECT_DETERMINISTIC === "true" || isDeterministicProvider(provider)) {
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

  const raw = await askLLM(env, prompt, { jsonMode: true, maxTokens: 300 });
  const result = JSON.parse(raw) as { folder: string; tags: string[] };
  return { ...result, folder: ensureParaFolderPath(result.folder) };
}

export async function askArchitectForWikiDraft(
  env: Env,
  filePath: string,
  chunks: WikiDraftChunkInput[],
): Promise<WikiDraftResult> {
  const provider = env.ARCHITECT_MODEL_PROVIDER ?? "openai";
  if (env.ARCHITECT_DETERMINISTIC === "true" || isDeterministicProvider(provider)) {
    return deterministicWikiDraft(filePath, chunks);
  }

  const chunkContext = chunks
    .slice(0, 12)
    .map((chunk) => `[${chunk.chunk_index}]\n${chunk.content.slice(0, 1200)}`)
    .join("\n\n");

  const prompt = `You are The Architect for OpenBrain's draft-visible knowledge wiki.
Create a concise, vault-grounded draft wiki extraction from the source chunks below.

Rules:
- Use only the provided chunks.
- Every topic, claim, and synthesis must include one or more chunk_indexes from the provided chunk numbers.
- Omit unsupported claims.
- Keep titles short and human-readable.
- Return JSON only with this exact shape:
{
  "title": "source title",
  "summary": "one-sentence source summary",
  "topics": [{"title": "topic", "summary": "why this topic matters here", "chunk_indexes": [0]}],
  "claims": [{"title": "claim title", "content": "specific supported claim", "chunk_indexes": [0]}],
  "synthesis": {"title": "synthesis title", "content": "markdown synthesis", "chunk_indexes": [0]}
}

File path: ${filePath}

Chunks:
${chunkContext}`;

  const raw = await askLLM(env, prompt, { jsonMode: true, maxTokens: 1200, temperature: 0.1 });
  return JSON.parse(raw) as WikiDraftResult;
}

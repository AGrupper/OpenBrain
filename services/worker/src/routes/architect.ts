import type { Env } from "../app";
import type {
  ArchitectChatContext,
  ArchitectChatResponse,
  ArchitectChatSource,
  ArchitectJob,
  ArchitectJobStatus,
  ArchitectSuggestion,
  ArchitectSuggestionStatus,
  ArchitectSuggestionType,
  WikiNodeKind,
} from "@openbrain/shared";
import {
  runLinker,
  runLinkerForFile,
  runTagger,
  runTaggerForFile,
  runWikiBuilder,
  runWikiBuilderForFile,
} from "../jobs";
import { askLLM, embedText } from "../lib/providers";

const ARCHITECT_SYSTEM_PROMPT = `You are The Architect, OpenBrain's vault-only AI.
Answer only from the vault context provided in this request.
If the context does not support an answer, say you do not know from the vault.
Do not use web browsing, external memory, OpenClaw context, or unsupported general knowledge.
Cite the provided source numbers when making claims.`;

const JOB_SCOPES = ["linker", "tagger", "wiki"] as const;
type JobScope = (typeof JOB_SCOPES)[number];

function db(env: Env) {
  const base = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_KEY;
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };

  return {
    async query(table: string, params: Record<string, string> = {}) {
      const qs = new URLSearchParams(params);
      const res = await fetch(`${base}/rest/v1/${table}?${qs}`, { headers });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    async insert(table: string, row: Record<string, unknown>) {
      const res = await fetch(`${base}/rest/v1/${table}`, {
        method: "POST",
        headers: { ...headers, Prefer: "return=representation" },
        body: JSON.stringify(row),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    async patch(table: string, id: string, patch: Record<string, unknown>) {
      const res = await fetch(`${base}/rest/v1/${table}?id=eq.${id}`, {
        method: "PATCH",
        headers: { ...headers, Prefer: "return=representation" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    async rpc(fn: string, args: Record<string, unknown>) {
      const res = await fetch(`${base}/rest/v1/rpc/${fn}`, {
        method: "POST",
        headers,
        body: JSON.stringify(args),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  };
}

export async function handleArchitect(request: Request, env: Env, url: URL): Promise<Response> {
  const { method } = request;
  const segments = url.pathname
    .replace(/^\/architect/, "")
    .split("/")
    .filter(Boolean);
  const resource = segments[0];
  const id = segments[1];
  const sub = segments[2];

  try {
    if (resource === "jobs") return handleJobs(request, env, method, id, url);
    if (resource === "suggestions") return handleSuggestions(request, env, method, id, url);
    if (resource === "chat" && method === "POST" && !id) return handleChat(request, env);
    if (resource === "chat" && method === "GET" && id && sub === "messages") {
      return handleChatMessages(env, id);
    }

    return new Response("Not found", { status: 404 });
  } catch (err) {
    console.error(err);
    return new Response(String(err), { status: 500 });
  }
}

async function handleJobs(
  request: Request,
  env: Env,
  method: string,
  id: string | undefined,
  url: URL,
): Promise<Response> {
  if (method === "GET" && !id) {
    const status = url.searchParams.get("status");
    const params: Record<string, string> = { select: "*", order: "created_at.desc" };
    if (status) params.status = `eq.${status}`;
    return Response.json(await db(env).query("architect_jobs", params));
  }

  if (method === "POST" && id === "run") {
    const body = (await request.json().catch(() => ({}))) as {
      file_id?: unknown;
      scopes?: unknown;
    };
    const fileId = typeof body.file_id === "string" && body.file_id.trim() ? body.file_id : null;
    const scopes = parseJobScopes(body.scopes);
    if (!scopes)
      return new Response("scopes must contain linker, tagger, or wiki", { status: 400 });

    for (const scope of scopes) {
      if (scope === "linker") {
        if (fileId) await runLinkerForFile(env, fileId);
        else await runLinker(env);
      } else if (scope === "tagger") {
        if (fileId) await runTaggerForFile(env, fileId);
        else await runTagger(env);
      } else if (scope === "wiki") {
        if (fileId) await runWikiBuilderForFile(env, fileId);
        else await runWikiBuilder(env);
      }
    }

    return Response.json({ ok: true, file_id: fileId, ran: scopes });
  }

  if (method === "POST" && !id) {
    const body = (await request.json()) as { file_id?: string };
    if (!body.file_id) return new Response("file_id is required", { status: 400 });
    const rows = (await db(env).insert("architect_jobs", {
      file_id: body.file_id,
      status: "pending",
    })) as ArchitectJob[];
    return Response.json(rows[0], { status: 201 });
  }

  if (method === "PATCH" && id) {
    const body = (await request.json()) as { status?: ArchitectJobStatus; error?: string | null };
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.status) patch.status = body.status;
    if ("error" in body) patch.error = body.error;
    return Response.json(await db(env).patch("architect_jobs", id, patch));
  }

  return new Response("Method not allowed", { status: 405 });
}

function parseJobScopes(input: unknown): JobScope[] | null {
  if (input === undefined) return [...JOB_SCOPES];
  if (!Array.isArray(input)) return null;
  const scopes = input.filter((scope): scope is JobScope => JOB_SCOPES.includes(scope as JobScope));
  if (scopes.length !== input.length || !scopes.length) return null;
  return [...new Set(scopes)];
}

async function handleSuggestions(
  request: Request,
  env: Env,
  method: string,
  id: string | undefined,
  url: URL,
): Promise<Response> {
  if (method === "GET" && !id) {
    const status = url.searchParams.get("status") ?? "pending";
    return Response.json(
      await db(env).query("architect_suggestions", {
        status: `eq.${status}`,
        select: "*",
        order: "created_at.desc",
      }),
    );
  }

  if (method === "POST" && !id) {
    const body = (await request.json()) as {
      file_id?: string | null;
      type?: ArchitectSuggestionType;
      title?: string;
      reason?: string;
      payload?: Record<string, unknown>;
      confidence?: number;
    };
    if (!body.type || !body.title || !body.reason || !body.payload) {
      return new Response("type, title, reason, and payload are required", { status: 400 });
    }
    const rows = (await db(env).insert("architect_suggestions", {
      file_id: body.file_id ?? null,
      type: body.type,
      title: body.title,
      reason: body.reason,
      payload: body.payload,
      confidence: body.confidence ?? null,
      status: "pending",
    })) as ArchitectSuggestion[];
    return Response.json(rows[0], { status: 201 });
  }

  if (method === "PATCH" && id) {
    const body = (await request.json()) as { status?: ArchitectSuggestionStatus };
    if (body.status !== "approved" && body.status !== "rejected") {
      return new Response("status must be approved or rejected", { status: 400 });
    }

    const existing = (await db(env).query("architect_suggestions", {
      id: `eq.${id}`,
      select: "*",
    })) as ArchitectSuggestion[];
    if (!existing.length) return new Response("Not found", { status: 404 });

    if (body.status === "approved") await applySuggestion(env, existing[0]);

    return Response.json(
      await db(env).patch("architect_suggestions", id, {
        status: body.status,
        updated_at: new Date().toISOString(),
      }),
    );
  }

  return new Response("Method not allowed", { status: 405 });
}

async function applySuggestion(env: Env, suggestion: ArchitectSuggestion) {
  if (!suggestion.file_id) return;
  const payload = suggestion.payload;

  if (suggestion.type === "folder" && typeof payload.folder === "string") {
    await db(env).patch("files", suggestion.file_id, {
      folder: payload.folder,
      updated_at: new Date().toISOString(),
    });
  }

  if (suggestion.type === "tags" && Array.isArray(payload.tags)) {
    await db(env).patch("files", suggestion.file_id, {
      tags: payload.tags.filter((tag): tag is string => typeof tag === "string"),
      updated_at: new Date().toISOString(),
    });
  }

  if (suggestion.type === "summary" && typeof payload.summary === "string") {
    await db(env).patch("files", suggestion.file_id, {
      summary: payload.summary,
      updated_at: new Date().toISOString(),
    });
  }
}

async function handleChat(request: Request, env: Env): Promise<Response> {
  const body = (await request.json()) as {
    message?: string;
    session_id?: string;
    current_file_id?: string;
    ide_context?: ArchitectChatContext;
  };
  const message = body.message?.trim();
  if (!message) return new Response("message is required", { status: 400 });

  const currentFileId =
    typeof body.ide_context?.current_file_id === "string" && body.ide_context.current_file_id.trim()
      ? body.ide_context.current_file_id.trim()
      : typeof body.current_file_id === "string" && body.current_file_id.trim()
        ? body.current_file_id.trim()
        : null;
  const ideContext = {
    ...(body.ide_context ?? {}),
    current_file_id: currentFileId ?? undefined,
  } satisfies ArchitectChatContext;
  const sources = await retrieveVaultSources(env, message, 5, ideContext);
  const sessionId = body.session_id || (await createChatSession(env));
  await db(env).insert("architect_chat_messages", {
    session_id: sessionId,
    role: "user",
    content: message,
  });

  const answer = sources.length
    ? await askArchitect(env, message, sources)
    : "I do not know from the vault. I could not find any vault sources that support an answer.";

  const answerRows = (await db(env).insert("architect_chat_messages", {
    session_id: sessionId,
    role: "architect",
    content: answer,
  })) as { id: string }[];
  const answerId = answerRows[0]?.id;

  if (answerId) {
    await Promise.all(
      sources.map((source) =>
        db(env).insert("architect_chat_message_sources", {
          message_id: answerId,
          file_id: source.file_id,
          path: source.path,
          snippet: source.snippet,
          score: source.score ?? null,
        }),
      ),
    );
  }

  const response: ArchitectChatResponse = { session_id: sessionId, answer, sources };
  return Response.json(response);
}

async function handleChatMessages(env: Env, sessionId: string): Promise<Response> {
  const rows = await db(env).query("architect_chat_messages", {
    session_id: `eq.${sessionId}`,
    select: "*",
    order: "created_at.asc",
  });
  return Response.json(rows);
}

async function createChatSession(env: Env): Promise<string> {
  const rows = (await db(env).insert("architect_chat_sessions", {})) as { id: string }[];
  return rows[0].id;
}

interface SearchRow {
  id: string;
  path: string;
  rank: number;
  snippet: string;
}

interface WikiPageSearchRow {
  id: string;
  title: string;
  content: string;
  wiki_nodes?: {
    id: string;
    kind: WikiNodeKind;
    title: string;
    status: "draft" | "published" | "archived";
    source_file_id?: string | null;
  } | null;
}

interface CurrentFileRow {
  id: string;
  path: string;
  folder?: string | null;
  text_content?: string | null;
  deleted_at?: string | null;
}

async function retrieveVaultSources(
  env: Env,
  query: string,
  limit: number,
  ideContext: ArchitectChatContext = {},
): Promise<ArchitectChatSource[]> {
  const currentFile = ideContext.current_file_id
    ? await fetchCurrentFile(env, ideContext.current_file_id)
    : null;
  const currentSources = currentFile
    ? await retrieveCurrentFileSources(env, currentFile, query, Math.min(3, limit))
    : [];
  const folderSources =
    currentFile && isFolderContextQuestion(query)
      ? await retrieveCurrentFolderSources(env, currentFile, query, Math.max(limit - 1, 1))
      : [];
  const focusedSources = dedupeSources([...currentSources, ...folderSources]).slice(0, limit);

  if (focusedSources.length && currentFile && !isWiderVaultQuestion(query)) {
    return focusedSources;
  }

  const remainingLimit = Math.max(limit - focusedSources.length, 1);
  const rawSources = await retrieveRawVaultSources(env, query, remainingLimit);
  const wikiSources = await retrieveWikiPageSources(env, query, remainingLimit);

  return dedupeSources([...focusedSources, ...rawSources, ...wikiSources])
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, limit);
}

async function fetchCurrentFile(env: Env, fileId: string): Promise<CurrentFileRow | null> {
  const fileRows = (await db(env).query("files", {
    id: `eq.${fileId}`,
    deleted_at: "is.null",
    select: "id,path,folder,text_content,deleted_at",
    limit: "1",
  })) as CurrentFileRow[];
  return fileRows[0] ?? null;
}

async function retrieveCurrentFileSources(
  env: Env,
  file: CurrentFileRow,
  query: string,
  limit: number,
): Promise<ArchitectChatSource[]> {
  const terms = tokenizeQuery(query);
  const sources: ArchitectChatSource[] = [];
  if (file.text_content?.trim()) {
    sources.push({
      file_id: file.id,
      path: file.path,
      title: file.path.split("/").pop() ?? file.path,
      snippet: wikiSnippet(file.text_content, terms),
      score: 10,
      source_kind: "file",
      evidence_scope: "current_file",
    });
  }

  const digest = await retrieveWikiDigestForFile(env, file.id, terms);
  if (digest) sources.push(digest);

  if (sources.length < limit) {
    const chunks = (await db(env).query("source_chunks", {
      file_id: `eq.${file.id}`,
      select: "*",
      order: "chunk_index.asc",
      limit: "5",
    })) as { chunk_index: number; content: string }[];
    for (const chunk of chunks) {
      if (!chunk.content.trim()) continue;
      sources.push({
        file_id: file.id,
        path: `${file.path} chunk ${chunk.chunk_index}`,
        title: file.path.split("/").pop() ?? file.path,
        snippet: wikiSnippet(chunk.content, terms),
        score: 8.5 - chunk.chunk_index / 100,
        source_kind: "file",
        evidence_scope: "current_file",
      });
      if (sources.length >= limit) break;
    }
  }

  return sources.slice(0, limit);
}

async function retrieveCurrentFolderSources(
  env: Env,
  currentFile: CurrentFileRow,
  query: string,
  limit: number,
): Promise<ArchitectChatSource[]> {
  const folder = currentFileFolder(currentFile);
  const params: Record<string, string> = {
    id: `neq.${currentFile.id}`,
    deleted_at: "is.null",
    select: "id,path,folder,text_content",
    order: "updated_at.desc",
    limit: "20",
  };
  if (folder) params.folder = `eq.${folder}`;
  else params.folder = "is.null";

  const rows = (await db(env).query("files", params)) as CurrentFileRow[];
  const terms = tokenizeQuery(query);
  return rows
    .filter((file) => file.text_content?.trim())
    .map((file, index) => ({
      file_id: file.id,
      path: file.path,
      title: file.path.split("/").pop() ?? file.path,
      snippet: wikiSnippet(file.text_content ?? "", terms),
      score: 7 - index / 100,
      source_kind: "file" as const,
      evidence_scope: "current_folder" as const,
    }))
    .slice(0, limit);
}

async function retrieveWikiDigestForFile(
  env: Env,
  fileId: string,
  terms: string[],
): Promise<ArchitectChatSource | null> {
  const nodes = (await db(env).query("wiki_nodes", {
    source_file_id: `eq.${fileId}`,
    kind: "eq.synthesis",
    status: "in.(draft,published)",
    select: "id,kind,title,source_file_id",
    order: "updated_at.desc",
    limit: "1",
  })) as { id: string; kind: WikiNodeKind; title: string; source_file_id: string }[];
  const node = nodes[0];
  if (!node) return null;

  const pages = (await db(env).query("wiki_pages", {
    node_id: `eq.${node.id}`,
    select: "title,content",
    limit: "1",
  })) as { title: string; content: string }[];
  const page = pages[0];
  if (!page) return null;

  return {
    file_id: fileId,
    path: `Wiki digest: ${node.title}`,
    title: page.title,
    snippet: wikiSnippet(page.content, terms),
    score: 9.5,
    source_kind: "wiki",
    evidence_scope: "wiki_digest",
    wiki_node_id: node.id,
    wiki_node_kind: node.kind,
  };
}

async function retrieveRawVaultSources(
  env: Env,
  query: string,
  limit: number,
): Promise<ArchitectChatSource[]> {
  let queryEmbedding: number[] | null = null;
  try {
    queryEmbedding = await embedText(env, query, "RETRIEVAL_QUERY");
  } catch (err) {
    console.error("[architect.chat] query embedding failed, falling back to FTS:", err);
  }

  const candidateLimit = Math.max(limit * 2, limit);
  const ftsPromise = (
    db(env).rpc("search_files", {
      query_text: query,
      result_limit: candidateLimit,
    }) as Promise<SearchRow[]>
  ).catch((err) => {
    console.error("[architect.chat] FTS search failed:", err);
    return [] as SearchRow[];
  });

  const vecPromise: Promise<SearchRow[]> = queryEmbedding
    ? (
        db(env).rpc("search_files_by_embedding", {
          // PostgREST can't cast a JSON array to vector(1024); pass as text string instead.
          query_embedding: `[${queryEmbedding.join(",")}]`,
          result_limit: candidateLimit,
        }) as Promise<SearchRow[]>
      ).catch((err) => {
        console.error("[architect.chat] vector search failed:", err);
        return [] as SearchRow[];
      })
    : Promise.resolve([] as SearchRow[]);

  const [ftsRows, vecRows] = await Promise.all([ftsPromise, vecPromise]);
  console.log(
    `[architect.chat] query=${JSON.stringify(query.slice(0, 80))} ` +
      `fts=${ftsRows.length} vec=${vecRows.length} ` +
      `embed=${queryEmbedding ? "ok" : "skipped"}`,
  );
  return blendByRRF(ftsRows, vecRows, limit);
}

function blendByRRF(fts: SearchRow[], vec: SearchRow[], limit: number): ArchitectChatSource[] {
  const k = 60;
  const merged = new Map<string, { row: SearchRow; score: number; ftsSnippet?: string }>();

  fts.forEach((row, i) => {
    merged.set(row.id, {
      row,
      score: 1 / (k + i + 1),
      ftsSnippet: row.snippet,
    });
  });

  vec.forEach((row, i) => {
    const score = 1 / (k + i + 1);
    const existing = merged.get(row.id);
    if (existing) {
      existing.score += score;
    } else {
      merged.set(row.id, { row, score });
    }
  });

  return [...merged.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ row, score, ftsSnippet }) => ({
      file_id: row.id,
      path: row.path,
      snippet: ftsSnippet ?? row.snippet,
      score,
      source_kind: "file",
      evidence_scope: "vault_file",
    }));
}

async function retrieveWikiPageSources(
  env: Env,
  query: string,
  limit: number,
): Promise<ArchitectChatSource[]> {
  const terms = tokenizeQuery(query);
  if (!terms.length) return [];

  let rows: WikiPageSearchRow[] = [];
  try {
    rows = (await db(env).query("wiki_pages", {
      select: "id,title,content,wiki_nodes(id,kind,title,status,source_file_id)",
      order: "updated_at.desc",
      limit: "100",
    })) as WikiPageSearchRow[];
  } catch (err) {
    console.error("[architect.chat] wiki page retrieval failed:", err);
    return [];
  }

  const sources: ArchitectChatSource[] = [];
  for (const row of rows) {
    const node = row.wiki_nodes;
    if (
      !node?.source_file_id ||
      node.kind !== "synthesis" ||
      !["draft", "published"].includes(node.status)
    ) {
      continue;
    }
    const score = scoreWikiPage(row, terms, query);
    if (score <= 0) continue;
    sources.push({
      file_id: node.source_file_id,
      path: `Wiki: ${node.title}`,
      title: row.title,
      snippet: wikiSnippet(row.content, terms),
      score: 0.02 + score / 100,
      source_kind: "wiki" as const,
      evidence_scope: "wiki_digest",
      wiki_node_id: node.id,
      wiki_node_kind: node.kind,
    });
  }

  const sourceFileIds = [...new Set(sources.map((source) => source.file_id))];
  const liveRows = sourceFileIds.length
    ? ((await db(env).query("files", {
        id: `in.(${sourceFileIds.join(",")})`,
        deleted_at: "is.null",
        select: "id",
        limit: String(sourceFileIds.length),
      })) as { id: string }[])
    : [];
  const liveFileIds = new Set(liveRows.map((row) => row.id));

  return sources
    .filter((source) => liveFileIds.has(source.file_id))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, limit);
}

function tokenizeQuery(query: string): string[] {
  return Array.from(
    new Set(
      query
        .toLowerCase()
        .split(/[^a-z0-9\u0590-\u05ff]+/i)
        .map((term) => term.trim())
        .filter((term) => term.length >= 3),
    ),
  );
}

function currentFileFolder(file: CurrentFileRow): string | null {
  if (file.folder?.trim()) return file.folder.trim();
  const idx = file.path.lastIndexOf("/");
  return idx > 0 ? file.path.slice(0, idx) : null;
}

function dedupeSources(sources: ArchitectChatSource[]): ArchitectChatSource[] {
  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = `${source.source_kind ?? "file"}:${source.wiki_node_id ?? source.file_id}:${source.evidence_scope ?? "vault"}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isFolderContextQuestion(query: string): boolean {
  return /\b(folder|same folder|nearby|related notes?|neighboring notes?|sibling notes?|project folder|area folder|context around this|other notes here)\b/i.test(
    query,
  );
}

function isWiderVaultQuestion(query: string): boolean {
  return /\b(vault|all notes?|everything|entire vault|across notes?|across the vault|other files?|other notes?|search everywhere|global|outside this file|not just this file)\b/i.test(
    query,
  );
}

function scoreWikiPage(row: WikiPageSearchRow, terms: string[], query: string): number {
  const title = row.title.toLowerCase();
  const content = row.content.toLowerCase();
  const phrase = query.toLowerCase().trim();
  let score = phrase.length >= 3 && (title.includes(phrase) || content.includes(phrase)) ? 5 : 0;

  for (const term of terms) {
    if (title.includes(term)) score += 4;
    if (content.includes(term)) score += 1;
  }

  return score;
}

function wikiSnippet(content: string, terms: string[]): string {
  const normalized = content.replace(/\s+/g, " ").trim();
  const lower = normalized.toLowerCase();
  const firstMatch = terms
    .map((term) => lower.indexOf(term))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];
  const start = firstMatch === undefined ? 0 : Math.max(0, firstMatch - 120);
  const snippet = normalized.slice(start, start + 360).trim();
  return start > 0 ? `...${snippet}` : snippet;
}

async function askArchitect(
  env: Env,
  message: string,
  sources: ArchitectChatSource[],
): Promise<string> {
  if (isDeterministicArchitect(env)) return deterministicChatAnswer(sources);

  const context = sources
    .map(
      (source, index) => `[${index + 1}] ${sourceLabel(source)}: ${source.path}\n${source.snippet}`,
    )
    .join("\n\n");

  const answer = await askLLM(env, `Vault context:\n${context}\n\nQuestion: ${message}`, {
    systemPrompt: ARCHITECT_SYSTEM_PROMPT,
    temperature: 0.2,
  });

  return answer.trim() || "I do not know from the vault. The Architect returned an empty answer.";
}

function isDeterministicArchitect(env: Env): boolean {
  return env.ARCHITECT_DETERMINISTIC === "true" || env.ARCHITECT_MODEL_PROVIDER === "deterministic";
}

function deterministicChatAnswer(sources: ArchitectChatSource[]): string {
  const cited = sources
    .slice(0, 3)
    .map((source, index) => `${sourceLabel(source)}: ${source.snippet} [${index + 1}]`)
    .join("\n\n");
  return (
    cited ||
    "I do not know from the vault. I could not find any vault sources that support an answer."
  );
}

function sourceLabel(source: ArchitectChatSource): string {
  if (source.evidence_scope === "current_file") return "Current file";
  if (source.evidence_scope === "current_folder") return "Current folder";
  if (source.evidence_scope === "wiki_digest") return "Wiki digest";
  return "Vault file";
}

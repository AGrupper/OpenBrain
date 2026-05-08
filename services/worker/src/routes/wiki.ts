import type {
  SourceChunk,
  WikiCitation,
  WikiEdge,
  WikiGraphResponse,
  WikiNode,
  WikiNodeDetailResponse,
  WikiPage,
  WikiRevision,
} from "@openbrain/shared";
import type { Env } from "../app";
import { db } from "../lib/supabase";

const VISIBLE_STATUSES = "in.(draft,published)";

interface CitationRow extends WikiCitation {
  source_chunks?: SourceChunk | null;
}

export async function handleWiki(request: Request, env: Env, url: URL): Promise<Response> {
  const { method } = request;
  const segments = url.pathname
    .replace(/^\/wiki/, "")
    .split("/")
    .filter(Boolean);
  const resource = segments[0];
  const id = segments[1];
  const sub = segments[2];

  try {
    if (method === "GET" && resource === "graph" && !id) return handleWikiGraph(env);
    if (method === "GET" && resource === "nodes" && id) return handleWikiNodeDetail(env, id);
    if (method === "GET" && resource === "files" && id && sub === "nodes") {
      return handleWikiNodesForFile(env, id);
    }
    if (resource === "graph" || resource === "nodes" || resource === "files") {
      return new Response("Method not allowed", { status: 405 });
    }
    return new Response("Not found", { status: 404 });
  } catch (err) {
    console.error(err);
    return new Response(String(err), { status: 500 });
  }
}

async function handleWikiNodesForFile(env: Env, fileId: string): Promise<Response> {
  const nodes = (await db(env).query("wiki_nodes", {
    source_file_id: `eq.${fileId}`,
    status: VISIBLE_STATUSES,
    kind: "neq.source",
    select: "*",
    order: "updated_at.desc",
    limit: "50",
  })) as WikiNode[];

  return Response.json(nodes);
}

async function handleWikiGraph(env: Env): Promise<Response> {
  const [nodes, edges] = await Promise.all([
    db(env).query("wiki_nodes", {
      status: VISIBLE_STATUSES,
      kind: "eq.synthesis",
      select: "*",
      order: "updated_at.desc",
      limit: "500",
    }) as Promise<WikiNode[]>,
    db(env).query("wiki_edges", {
      status: VISIBLE_STATUSES,
      select: "*",
      order: "updated_at.desc",
      limit: "1000",
    }) as Promise<WikiEdge[]>,
  ]);

  const sourceFileIds = [
    ...new Set(nodes.map((node) => node.source_file_id).filter((id): id is string => Boolean(id))),
  ];
  const liveFileRows = sourceFileIds.length
    ? ((await db(env).query("files", {
        id: `in.(${sourceFileIds.join(",")})`,
        deleted_at: "is.null",
        select: "id",
        limit: String(sourceFileIds.length),
      })) as { id: string }[])
    : [];
  const liveFileIds = new Set(liveFileRows.map((row) => row.id));
  const visibleNodes = nodes.filter(
    (node) => node.source_file_id && liveFileIds.has(node.source_file_id),
  );
  const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
  const visibleEdges = edges.filter(
    (edge) => visibleNodeIds.has(edge.source_node_id) && visibleNodeIds.has(edge.target_node_id),
  );
  const body: WikiGraphResponse = { nodes: visibleNodes, edges: visibleEdges };
  return Response.json(body);
}

async function handleWikiNodeDetail(env: Env, nodeId: string): Promise<Response> {
  const nodes = (await db(env).query("wiki_nodes", {
    id: `eq.${nodeId}`,
    select: "*",
    limit: "1",
  })) as WikiNode[];
  const node = nodes[0];
  if (!node) return new Response("Not found", { status: 404 });

  const pages = (await db(env).query("wiki_pages", {
    node_id: `eq.${node.id}`,
    select: "*",
    limit: "1",
  })) as WikiPage[];
  const page = pages[0] ?? null;

  const [revisions, backlinks, outgoing] = await Promise.all([
    page
      ? (db(env).query("wiki_revisions", {
          page_id: `eq.${page.id}`,
          select: "*",
          order: "revision_number.desc",
          limit: "20",
        }) as Promise<WikiRevision[]>)
      : Promise.resolve([] as WikiRevision[]),
    db(env).query("wiki_edges", {
      target_node_id: `eq.${node.id}`,
      status: VISIBLE_STATUSES,
      select: "*",
      order: "updated_at.desc",
    }) as Promise<WikiEdge[]>,
    db(env).query("wiki_edges", {
      source_node_id: `eq.${node.id}`,
      status: VISIBLE_STATUSES,
      select: "*",
      order: "updated_at.desc",
    }) as Promise<WikiEdge[]>,
  ]);

  const latestRevision = revisions[0];
  const citations = latestRevision
    ? await loadCitationsForRevision(env, latestRevision.id)
    : await loadCitationsForNode(env, node.id);

  const body: WikiNodeDetailResponse = {
    node,
    page,
    citations,
    backlinks,
    outgoing,
    revisions,
  };
  return Response.json(body);
}

async function loadCitationsForRevision(env: Env, revisionId: string): Promise<WikiCitation[]> {
  const rows = (await db(env).query("wiki_citations", {
    revision_id: `eq.${revisionId}`,
    select: "*,source_chunks(*)",
    order: "created_at.asc",
  })) as CitationRow[];
  return normalizeCitations(rows);
}

async function loadCitationsForNode(env: Env, nodeId: string): Promise<WikiCitation[]> {
  const rows = (await db(env).query("wiki_citations", {
    node_id: `eq.${nodeId}`,
    select: "*,source_chunks(*)",
    order: "created_at.asc",
  })) as CitationRow[];
  return normalizeCitations(rows);
}

function normalizeCitations(rows: CitationRow[]): WikiCitation[] {
  return rows.map((row) => {
    const { source_chunks: chunk, ...citation } = row;
    return { ...citation, chunk: chunk ?? undefined };
  });
}

import { useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D from "react-force-graph-2d";
import ReactMarkdown from "react-markdown";
import type {
  VaultFile,
  WikiEdge,
  WikiGraphResponse,
  WikiNode,
  WikiNodeDetailResponse,
} from "@openbrain/shared";
import { api } from "../../shared/api/api";

interface Props {
  files: VaultFile[];
  onSelect: (f: VaultFile) => void;
}

interface GraphNode {
  id: string;
  name: string;
  val: number;
  wikiNodeId?: string;
  kind?: string;
  status?: string;
  sourceFileId?: string | null;
}

interface GraphLink {
  source: string | GraphNode;
  target: string | GraphNode;
  value: number;
  reason: string;
  edgeType?: string;
}

interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

const EMPTY_WIKI_GRAPH: WikiGraphResponse = { nodes: [], edges: [] };
const VISIBLE_WIKI_KINDS = new Set(["synthesis"]);

export function GraphView({ files, onSelect }: Props) {
  const [wikiGraph, setWikiGraph] = useState<WikiGraphResponse>(EMPTY_WIKI_GRAPH);
  const [wikiError, setWikiError] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [wikiDetail, setWikiDetail] = useState<WikiNodeDetailResponse | null>(null);
  const [wikiDetailError, setWikiDetailError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  useEffect(() => {
    api.wiki
      .graph()
      .then((graph) => {
        setWikiGraph(graph);
        setWikiError(null);
      })
      .catch((err) => {
        setWikiGraph(EMPTY_WIKI_GRAPH);
        setWikiError(String(err));
      });
  }, []);

  const filesById = useMemo(() => new Map(files.map((file) => [file.id, file])), [files]);
  const wikiNodesById = useMemo(
    () => new Map(wikiGraph.nodes.map((node) => [node.id, node])),
    [wikiGraph.nodes],
  );

  const graphData = useMemo<GraphData>(() => {
    const wikiNodes = wikiGraph.nodes
      .filter((node) => node.status !== "archived" && VISIBLE_WIKI_KINDS.has(node.kind))
      .map((node) => ({
        id: wikiNodeId(node.id),
        wikiNodeId: node.id,
        name: node.title,
        kind: node.kind,
        status: node.status,
        sourceFileId: node.source_file_id,
        val: node.kind === "synthesis" ? 3 : node.kind === "claim" ? 2 : 1.5,
      }));

    const visibleNodeIds = new Set(wikiNodes.map((node) => node.id));
    const wikiLinks = wikiGraph.edges
      .filter(
        (edge) =>
          edge.status !== "archived" &&
          visibleNodeIds.has(wikiNodeId(edge.source_node_id)) &&
          visibleNodeIds.has(wikiNodeId(edge.target_node_id)),
      )
      .map((edge) => ({
        source: wikiNodeId(edge.source_node_id),
        target: wikiNodeId(edge.target_node_id),
        value: edge.confidence ?? 0.65,
        reason: edge.reason ?? edge.type,
        edgeType: edge.type,
      }));

    return {
      nodes: wikiNodes,
      links: wikiLinks,
    };
  }, [wikiGraph]);

  const selectedGraphNode = selectedNodeId
    ? graphData.nodes.find((node) => node.id === selectedNodeId)
    : null;
  const selectedWikiNode = selectedGraphNode?.wikiNodeId
    ? (wikiNodesById.get(selectedGraphNode.wikiNodeId) ?? null)
    : null;

  useEffect(() => {
    if (!selectedWikiNode) {
      setWikiDetail(null);
      setWikiDetailError(null);
      return;
    }
    let active = true;
    setWikiDetail(null);
    setWikiDetailError(null);
    api.wiki
      .node(selectedWikiNode.id)
      .then((detail) => {
        if (active) setWikiDetail(detail);
      })
      .catch((err) => {
        if (active) setWikiDetailError(String(err));
      });
    return () => {
      active = false;
    };
  }, [selectedWikiNode]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setDimensions({ width, height });
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const activeNodeId = hoveredNodeId ?? selectedNodeId;
  const neighborIds = activeNodeId
    ? new Set(
        graphData.links.flatMap((l) =>
          sourceId(l) === activeNodeId || targetId(l) === activeNodeId
            ? [sourceId(l), targetId(l)]
            : [],
        ),
      )
    : null;

  return (
    <div ref={containerRef} style={styles.container}>
      <ForceGraph2D
        width={dimensions.width}
        height={dimensions.height}
        graphData={graphData}
        nodeLabel="name"
        nodeColor={(node) => nodeColor(node as GraphNode, activeNodeId, neighborIds)}
        linkColor={(link) => linkColor(link as GraphLink, activeNodeId)}
        linkWidth={(link) => Math.max(1.2, (link.value as number) * 2.6)}
        onNodeHover={(node) => setHoveredNodeId((node?.id as string) ?? null)}
        onNodeClick={(node) => {
          setSelectedNodeId((node.id as string) ?? null);
        }}
        nodeCanvasObject={(node, ctx, globalScale) => {
          const graphNode = node as GraphNode & { x?: number; y?: number };
          const label = graphNode.name;
          const fontSize = 12 / globalScale;
          ctx.font = `500 ${fontSize}px Inter, sans-serif`;
          const r = Math.sqrt(graphNode.val) * 4;
          const isHighlighted =
            !neighborIds || graphNode.id === hoveredNodeId || neighborIds.has(graphNode.id);

          ctx.beginPath();
          ctx.arc(graphNode.x!, graphNode.y!, r, 0, 2 * Math.PI);
          ctx.fillStyle = isHighlighted
            ? nodeColor(graphNode, activeNodeId, neighborIds)
            : "#222222";
          ctx.fill();

          if (globalScale > 0.8) {
            ctx.textAlign = "center";
            ctx.textBaseline = "top";
            ctx.fillStyle = isHighlighted ? "#f3f4f6" : "#6b7280";
            ctx.fillText(
              label.length > 20 ? `${label.slice(0, 18)}...` : label,
              graphNode.x!,
              graphNode.y! + r + 4,
            );
          }
        }}
        backgroundColor="#101014"
        linkDirectionalParticles={1}
        linkDirectionalParticleWidth={(link) => Math.max(1.2, (link.value as number) * 1.8)}
      />
      {wikiError && <div style={styles.error}>Could not load wiki graph: {wikiError}</div>}
      {graphData.nodes.length === 0 && (
        <div style={styles.empty}>
          No wiki concepts yet.
          <br />
          <span style={{ fontSize: 12 }}>
            The Architect will add one draft digest per processed source.
          </span>
        </div>
      )}
      {selectedWikiNode && (
        <WikiDetailPanel
          node={selectedWikiNode}
          detail={wikiDetail}
          error={wikiDetailError}
          filesById={filesById}
          wikiNodesById={wikiNodesById}
          onClose={() => setSelectedNodeId(null)}
          onOpenSource={(file) => onSelect(file)}
          onSelectWiki={(nodeId) => setSelectedNodeId(wikiNodeId(nodeId))}
        />
      )}
    </div>
  );
}

function wikiNodeId(id: string): string {
  return `wiki:${id}`;
}

function sourceId(link: GraphLink): string {
  return endpointId(link.source);
}

function targetId(link: GraphLink): string {
  return endpointId(link.target);
}

function endpointId(endpoint: string | GraphNode): string {
  return typeof endpoint === "string" ? endpoint : endpoint.id;
}

function nodeColor(
  node: GraphNode,
  activeNodeId: string | null,
  neighborIds: Set<string> | null,
): string {
  if (activeNodeId && node.id === activeNodeId) return "#f3f4f6";
  if (neighborIds && neighborIds.has(node.id)) return "#68d4b2";
  if (neighborIds && !neighborIds.has(node.id)) return "#2d3142";
  if (node.kind === "synthesis") return "#8b7cf6";
  if (node.kind === "claim") return "#f2b84b";
  if (node.kind === "topic") return "#56c7b2";
  return "#b7adff";
}

function linkColor(link: GraphLink, activeNodeId: string | null): string {
  if (activeNodeId && (sourceId(link) === activeNodeId || targetId(link) === activeNodeId)) {
    return "#8ab4ff";
  }
  return "rgba(242, 184, 75, 0.55)";
}

function WikiDetailPanel({
  node,
  detail,
  error,
  filesById,
  wikiNodesById,
  onClose,
  onOpenSource,
  onSelectWiki,
}: {
  node: WikiNode;
  detail: WikiNodeDetailResponse | null;
  error: string | null;
  filesById: Map<string, VaultFile>;
  wikiNodesById: Map<string, WikiNode>;
  onClose: () => void;
  onOpenSource: (file: VaultFile) => void;
  onSelectWiki: (nodeId: string) => void;
}) {
  const sourceFile = node.source_file_id ? filesById.get(node.source_file_id) : null;
  return (
    <aside style={styles.detailPanel}>
      <div style={styles.detailHeader}>
        <div>
          <div style={styles.detailEyebrow}>Architect Wiki</div>
          <div style={styles.detailTitle}>{node.title}</div>
        </div>
        <button className="btn-icon" onClick={onClose} aria-label="Close wiki node details">
          x
        </button>
      </div>

      <div style={styles.badgeRow}>
        <span style={styles.draftBadge}>{node.status}</span>
        <span style={styles.kindBadge}>{node.kind}</span>
      </div>

      {error && <div style={styles.inlineError}>Could not load wiki node: {error}</div>}
      {!detail && !error && <div style={styles.muted}>Loading wiki page...</div>}

      {detail && (
        <>
          {detail.page && (
            <div style={styles.section}>
              <div style={styles.sectionTitle}>Generated page</div>
              <div style={styles.markdownPanel}>
                <ReactMarkdown>{detail.page.content}</ReactMarkdown>
              </div>
            </div>
          )}

          <div style={styles.section}>
            <div style={styles.sectionTitle}>Generated from</div>
            {sourceFile ? (
              <button style={styles.sourceButton} onClick={() => onOpenSource(sourceFile)}>
                <span style={styles.connectionPath}>{sourceFile.path}</span>
                <span style={styles.connectionReason}>Open source file in the reader</span>
              </button>
            ) : (
              <div style={styles.muted}>No source file is attached to this node.</div>
            )}
          </div>

          <div style={styles.section}>
            <div style={styles.sectionTitle}>Chunk citations ({detail.citations.length})</div>
            {detail.citations.length === 0 ? (
              <div style={styles.muted}>No chunk citations stored for this revision.</div>
            ) : (
              <div style={styles.connectionList}>
                {detail.citations.map((citation) => (
                  <div key={citation.id} style={styles.citationRow}>
                    <div style={styles.connectionPath}>
                      Chunk {citation.chunk?.chunk_index ?? citation.chunk_id}
                    </div>
                    <div style={styles.connectionReason}>
                      {citation.quote || citation.chunk?.content || "Citation chunk unavailable."}
                    </div>
                    {citation.chunk && (
                      <div style={styles.confidence}>
                        chars {citation.chunk.char_start}-{citation.chunk.char_end}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <EdgeList
            title={`Backlinks (${detail.backlinks.length})`}
            edges={detail.backlinks}
            direction="source"
            wikiNodesById={wikiNodesById}
            onSelectWiki={onSelectWiki}
          />
          <EdgeList
            title={`Outgoing (${detail.outgoing.length})`}
            edges={detail.outgoing}
            direction="target"
            wikiNodesById={wikiNodesById}
            onSelectWiki={onSelectWiki}
          />

          <div style={styles.section}>
            <div style={styles.sectionTitle}>History ({detail.revisions.length})</div>
            {detail.revisions.length === 0 ? (
              <div style={styles.muted}>No revision history yet.</div>
            ) : (
              <div style={styles.connectionList}>
                {detail.revisions.map((revision) => (
                  <div key={revision.id} style={styles.citationRow}>
                    <div style={styles.connectionPath}>Revision {revision.revision_number}</div>
                    <div style={styles.connectionReason}>{revision.reason}</div>
                    <div style={styles.confidence}>{formatDate(revision.created_at)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </aside>
  );
}

function EdgeList({
  title,
  edges,
  direction,
  wikiNodesById,
  onSelectWiki,
}: {
  title: string;
  edges: WikiEdge[];
  direction: "source" | "target";
  wikiNodesById: Map<string, WikiNode>;
  onSelectWiki: (nodeId: string) => void;
}) {
  return (
    <div style={styles.section}>
      <div style={styles.sectionTitle}>{title}</div>
      {edges.length === 0 ? (
        <div style={styles.muted}>No wiki edges in this direction.</div>
      ) : (
        <div style={styles.connectionList}>
          {edges.map((edge) => {
            const otherId = direction === "source" ? edge.source_node_id : edge.target_node_id;
            const other = wikiNodesById.get(otherId);
            const canOpen =
              other !== undefined &&
              other.status !== "archived" &&
              VISIBLE_WIKI_KINDS.has(other.kind);
            return (
              <button
                key={edge.id}
                style={styles.connectionRow}
                onClick={() => canOpen && onSelectWiki(otherId)}
                disabled={!canOpen}
              >
                <span style={styles.connectionHeading}>
                  <span style={styles.connectionPath}>{other?.title ?? otherId}</span>
                  {other && <span style={styles.kindPill}>{other.kind}</span>}
                </span>
                <span style={styles.connectionReason}>{edge.reason ?? edge.type}</span>
                <span style={styles.confidence}>{edge.type}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleString();
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: "relative",
    width: "100%",
    height: "100%",
    background: "var(--bg-base)",
    overflow: "hidden",
  },
  error: {
    position: "absolute",
    left: 16,
    top: 16,
    maxWidth: 420,
    color: "var(--accent-danger)",
    background: "rgba(239, 68, 68, 0.1)",
    border: "1px solid rgba(239, 68, 68, 0.28)",
    borderRadius: "var(--radius-sm)",
    padding: "var(--spacing-3)",
    fontSize: 13,
  },
  inlineError: {
    color: "var(--accent-danger)",
    background: "rgba(239, 68, 68, 0.1)",
    border: "1px solid rgba(239, 68, 68, 0.28)",
    borderRadius: "var(--radius-sm)",
    padding: "var(--spacing-3)",
    fontSize: 13,
    marginTop: "var(--spacing-3)",
  },
  empty: {
    position: "absolute",
    top: "50%",
    left: "50%",
    transform: "translate(-50%,-50%)",
    color: "var(--text-muted)",
    textAlign: "center",
  },
  detailPanel: {
    position: "absolute",
    top: 16,
    right: 16,
    bottom: 16,
    width: "min(420px, calc(100% - 32px))",
    overflowY: "auto",
    background: "var(--bg-glass)",
    border: "1px solid var(--border-highlight)",
    borderRadius: "var(--radius-md)",
    boxShadow: "var(--shadow-lg)",
    padding: "var(--spacing-4)",
    backdropFilter: "blur(16px)",
  },
  detailHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: "var(--spacing-3)",
    marginBottom: "var(--spacing-3)",
  },
  detailEyebrow: {
    color: "var(--text-muted)",
    fontSize: 11,
    fontWeight: 700,
    textTransform: "uppercase",
  },
  detailTitle: {
    color: "var(--text-primary)",
    fontSize: 18,
    fontWeight: 700,
    lineHeight: 1.25,
    overflowWrap: "anywhere",
  },
  path: {
    color: "var(--text-secondary)",
    fontSize: 12,
    lineHeight: 1.5,
    overflowWrap: "anywhere",
    marginBottom: "var(--spacing-4)",
  },
  metaGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "var(--spacing-2)",
  },
  metaItem: {
    background: "var(--bg-surface)",
    border: "1px solid var(--border-color)",
    borderRadius: "var(--radius-sm)",
    padding: "var(--spacing-2)",
    minWidth: 0,
  },
  metaLabel: {
    color: "var(--text-muted)",
    fontSize: 11,
    marginBottom: 2,
  },
  metaValue: {
    color: "var(--text-primary)",
    fontSize: 12,
    overflowWrap: "anywhere",
  },
  section: {
    marginTop: "var(--spacing-4)",
  },
  sectionTitle: {
    color: "var(--text-secondary)",
    fontSize: 12,
    fontWeight: 700,
    marginBottom: "var(--spacing-2)",
  },
  tagList: {
    display: "flex",
    flexWrap: "wrap",
    gap: "var(--spacing-2)",
  },
  tag: {
    color: "#b9c9ff",
    background: "#141f33",
    border: "1px solid #2f4770",
    borderRadius: "var(--radius-sm)",
    padding: "3px 7px",
    fontSize: 12,
  },
  summary: {
    color: "var(--text-secondary)",
    fontSize: 13,
    lineHeight: 1.5,
  },
  muted: {
    color: "var(--text-muted)",
    fontSize: 13,
  },
  connectionList: {
    display: "grid",
    gap: "var(--spacing-2)",
  },
  connectionRow: {
    display: "grid",
    gap: 3,
    width: "100%",
    textAlign: "left",
    background: "var(--bg-surface)",
    color: "var(--text-secondary)",
    border: "1px solid var(--border-color)",
    borderRadius: "var(--radius-sm)",
    padding: "var(--spacing-2)",
    cursor: "pointer",
  },
  citationRow: {
    display: "grid",
    gap: 3,
    width: "100%",
    textAlign: "left",
    background: "var(--bg-surface)",
    color: "var(--text-secondary)",
    border: "1px solid var(--border-color)",
    borderRadius: "var(--radius-sm)",
    padding: "var(--spacing-2)",
  },
  connectionPath: {
    color: "var(--text-primary)",
    fontSize: 12,
    fontWeight: 700,
    overflowWrap: "anywhere",
  },
  connectionHeading: {
    display: "flex",
    alignItems: "center",
    gap: "var(--spacing-2)",
    minWidth: 0,
  },
  connectionReason: {
    color: "var(--text-secondary)",
    fontSize: 12,
    lineHeight: 1.4,
    overflowWrap: "anywhere",
  },
  kindPill: {
    color: "#ddd6fe",
    background: "#24163d",
    border: "1px solid #6d28d9",
    borderRadius: "var(--radius-sm)",
    padding: "2px 6px",
    fontSize: 10,
    fontWeight: 700,
    textTransform: "uppercase",
  },
  confidence: {
    color: "#8ab4ff",
    fontSize: 11,
    fontWeight: 700,
  },
  openButton: {
    width: "100%",
    marginTop: "var(--spacing-4)",
  },
  badgeRow: {
    display: "flex",
    gap: "var(--spacing-2)",
    flexWrap: "wrap",
    marginBottom: "var(--spacing-3)",
  },
  draftBadge: {
    color: "#fed7aa",
    background: "#3b2308",
    border: "1px solid #92400e",
    borderRadius: "var(--radius-sm)",
    padding: "3px 7px",
    fontSize: 11,
    fontWeight: 700,
    textTransform: "uppercase",
  },
  kindBadge: {
    color: "#ddd6fe",
    background: "#24163d",
    border: "1px solid #6d28d9",
    borderRadius: "var(--radius-sm)",
    padding: "3px 7px",
    fontSize: 11,
    fontWeight: 700,
    textTransform: "uppercase",
  },
  sourceButton: {
    display: "grid",
    gap: 3,
    width: "100%",
    textAlign: "left",
    background: "var(--bg-surface)",
    color: "var(--text-secondary)",
    border: "1px solid var(--border-color)",
    borderRadius: "var(--radius-sm)",
    padding: "var(--spacing-2)",
    cursor: "pointer",
    overflowWrap: "anywhere",
    marginBottom: "var(--spacing-3)",
  },
  markdownPanel: {
    color: "var(--text-secondary)",
    fontSize: 13,
    lineHeight: 1.55,
    borderTop: "1px solid var(--border-color)",
    borderBottom: "1px solid var(--border-color)",
    padding: "var(--spacing-3) 0",
    overflowWrap: "anywhere",
  },
};

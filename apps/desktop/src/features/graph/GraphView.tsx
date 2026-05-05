import { useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D from "react-force-graph-2d";
import ReactMarkdown from "react-markdown";
import type {
  Link,
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
  nodeType: "file" | "wiki";
  rawFileId?: string;
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
  linkType: "file" | "wiki" | "source";
  edgeType?: string;
}

interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

const EMPTY_WIKI_GRAPH: WikiGraphResponse = { nodes: [], edges: [] };

export function GraphView({ files, onSelect }: Props) {
  const [approvedLinks, setApprovedLinks] = useState<Link[]>([]);
  const [wikiGraph, setWikiGraph] = useState<WikiGraphResponse>(EMPTY_WIKI_GRAPH);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [wikiError, setWikiError] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [wikiDetail, setWikiDetail] = useState<WikiNodeDetailResponse | null>(null);
  const [wikiDetailError, setWikiDetailError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  useEffect(() => {
    api.links
      .approved()
      .then((links) => {
        setApprovedLinks(links);
        setLinkError(null);
      })
      .catch((err) => {
        setApprovedLinks([]);
        setLinkError(String(err));
      });
  }, []);

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
    const linkedFileIds = new Set(
      approvedLinks.flatMap((link) => [link.file_a_id, link.file_b_id]),
    );
    const wikiSourceFileIds = new Set(
      wikiGraph.nodes.map((node) => node.source_file_id).filter((id): id is string => Boolean(id)),
    );
    const fileNodes = files
      .filter(
        (file) =>
          linkedFileIds.has(file.id) || wikiSourceFileIds.has(file.id) || files.length < 200,
      )
      .map((file) => ({
        id: fileNodeId(file.id),
        rawFileId: file.id,
        name: file.path.split("/").pop() ?? file.path,
        nodeType: "file" as const,
        val: linkedFileIds.has(file.id) || wikiSourceFileIds.has(file.id) ? 2 : 1,
      }));

    const wikiNodes = wikiGraph.nodes
      .filter((node) => node.status !== "archived")
      .map((node) => ({
        id: wikiNodeId(node.id),
        wikiNodeId: node.id,
        name: node.title,
        nodeType: "wiki" as const,
        kind: node.kind,
        status: node.status,
        sourceFileId: node.source_file_id,
        val: node.kind === "synthesis" ? 3 : node.kind === "claim" ? 2 : 1.5,
      }));

    const visibleNodeIds = new Set([...fileNodes, ...wikiNodes].map((node) => node.id));
    const rawLinks = approvedLinks
      .filter(
        (link) =>
          visibleNodeIds.has(fileNodeId(link.file_a_id)) &&
          visibleNodeIds.has(fileNodeId(link.file_b_id)),
      )
      .map((link) => ({
        source: fileNodeId(link.file_a_id),
        target: fileNodeId(link.file_b_id),
        value: link.confidence,
        reason: link.reason,
        linkType: "file" as const,
      }));

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
        linkType: "wiki" as const,
        edgeType: edge.type,
      }));

    const sourceLinks = wikiGraph.nodes
      .filter((node) => node.status !== "archived" && node.source_file_id)
      .filter(
        (node) =>
          visibleNodeIds.has(fileNodeId(node.source_file_id!)) &&
          visibleNodeIds.has(wikiNodeId(node.id)),
      )
      .map((node) => ({
        source: fileNodeId(node.source_file_id!),
        target: wikiNodeId(node.id),
        value: 0.45,
        reason: "Generated from this source file.",
        linkType: "source" as const,
        edgeType: "derived_from",
      }));

    return {
      nodes: [...fileNodes, ...wikiNodes],
      links: [...rawLinks, ...wikiLinks, ...sourceLinks],
    };
  }, [approvedLinks, files, wikiGraph]);

  const selectedGraphNode = selectedNodeId
    ? graphData.nodes.find((node) => node.id === selectedNodeId)
    : null;
  const selectedFile =
    selectedGraphNode?.nodeType === "file" && selectedGraphNode.rawFileId
      ? (filesById.get(selectedGraphNode.rawFileId) ?? null)
      : null;
  const selectedWikiNode =
    selectedGraphNode?.nodeType === "wiki" && selectedGraphNode.wikiNodeId
      ? (wikiNodesById.get(selectedGraphNode.wikiNodeId) ?? null)
      : null;
  const detailLinks = selectedFile
    ? approvedLinks.filter(
        (link) => link.file_a_id === selectedFile.id || link.file_b_id === selectedFile.id,
      )
    : [];
  const relatedWikiNodes = selectedFile
    ? wikiGraph.nodes.filter(
        (node) => node.status !== "archived" && node.source_file_id === selectedFile.id,
      )
    : [];

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
        backgroundColor="#0a0a0a"
        linkDirectionalParticles={2}
        linkDirectionalParticleWidth={(link) => Math.max(1.2, (link.value as number) * 1.8)}
      />
      {linkError && <div style={styles.error}>Could not load graph links: {linkError}</div>}
      {wikiError && (
        <div style={{ ...styles.error, top: linkError ? 72 : 16 }}>
          Could not load wiki graph: {wikiError}
        </div>
      )}
      {graphData.nodes.length === 0 && (
        <div style={styles.empty}>
          No graph nodes yet.
          <br />
          <span style={{ fontSize: 12 }}>
            The Architect will add raw connections and draft wiki nodes as it processes files.
          </span>
        </div>
      )}
      {selectedFile && (
        <FileDetailPanel
          file={selectedFile}
          links={detailLinks}
          wikiNodes={relatedWikiNodes}
          filesById={filesById}
          onClose={() => setSelectedNodeId(null)}
          onOpen={() => onSelect(selectedFile)}
          onSelectFile={(fileId) => setSelectedNodeId(fileNodeId(fileId))}
          onSelectWiki={(nodeId) => setSelectedNodeId(wikiNodeId(nodeId))}
        />
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

function fileNodeId(id: string): string {
  return `file:${id}`;
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
  if (neighborIds && neighborIds.has(node.id)) return "#10b981";
  if (neighborIds && !neighborIds.has(node.id)) return "#2d3142";
  if (node.nodeType === "wiki" && node.status === "draft") return "#f59e0b";
  if (node.nodeType === "wiki") return "#a78bfa";
  return "#3b82f6";
}

function linkColor(link: GraphLink, activeNodeId: string | null): string {
  if (activeNodeId && (sourceId(link) === activeNodeId || targetId(link) === activeNodeId)) {
    return "#8ab4ff";
  }
  if (link.linkType === "source") return "#6b7280";
  if (link.linkType === "wiki") return "#b45309";
  return "#4b5563";
}

function FileDetailPanel({
  file,
  links,
  wikiNodes,
  filesById,
  onClose,
  onOpen,
  onSelectFile,
  onSelectWiki,
}: {
  file: VaultFile;
  links: Link[];
  wikiNodes: WikiNode[];
  filesById: Map<string, VaultFile>;
  onClose: () => void;
  onOpen: () => void;
  onSelectFile: (fileId: string) => void;
  onSelectWiki: (nodeId: string) => void;
}) {
  return (
    <aside style={styles.detailPanel}>
      <div style={styles.detailHeader}>
        <div>
          <div style={styles.detailEyebrow}>Raw file node</div>
          <div style={styles.detailTitle}>{file.path.split("/").pop() ?? file.path}</div>
        </div>
        <button className="btn-icon" onClick={onClose} aria-label="Close graph node details">
          x
        </button>
      </div>

      <div style={styles.path}>{file.path}</div>
      <div style={styles.metaGrid}>
        <Meta label="PARA folder" value={file.folder || folderFromPath(file.path) || "Unfiled"} />
        <Meta label="MIME" value={file.mime || "Unknown"} />
        <Meta label="Size" value={formatBytes(file.size)} />
        <Meta label="Updated" value={formatDate(file.updated_at)} />
      </div>

      {file.tags && file.tags.length > 0 && (
        <div style={styles.section}>
          <div style={styles.sectionTitle}>Tags</div>
          <div style={styles.tagList}>
            {file.tags.map((tag) => (
              <span key={tag} style={styles.tag}>
                {tag}
              </span>
            ))}
          </div>
        </div>
      )}

      {file.summary && (
        <div style={styles.section}>
          <div style={styles.sectionTitle}>Summary</div>
          <p style={styles.summary}>{file.summary}</p>
        </div>
      )}

      <div style={styles.section}>
        <div style={styles.sectionTitle}>Wiki drafts ({wikiNodes.length})</div>
        {wikiNodes.length === 0 ? (
          <div style={styles.muted}>No generated wiki nodes for this file yet.</div>
        ) : (
          <div style={styles.connectionList}>
            {wikiNodes.map((node) => (
              <button
                key={node.id}
                style={styles.connectionRow}
                onClick={() => onSelectWiki(node.id)}
              >
                <span style={styles.connectionPath}>{node.title}</span>
                <span style={styles.connectionReason}>{node.kind}</span>
                <span style={styles.draftBadge}>{node.status}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div style={styles.section}>
        <div style={styles.sectionTitle}>Connected files ({links.length})</div>
        {links.length === 0 ? (
          <div style={styles.muted}>No approved connections for this node.</div>
        ) : (
          <div style={styles.connectionList}>
            {links.map((link) => {
              const otherId = link.file_a_id === file.id ? link.file_b_id : link.file_a_id;
              const other = filesById.get(otherId);
              return (
                <button
                  key={link.id}
                  style={styles.connectionRow}
                  onClick={() => other && onSelectFile(other.id)}
                  disabled={!other}
                >
                  <span style={styles.connectionPath}>{other?.path ?? otherId}</span>
                  <span style={styles.connectionReason}>{link.reason}</span>
                  <span style={styles.confidence}>{Math.round(link.confidence * 100)}%</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <button className="btn-primary" style={styles.openButton} onClick={onOpen}>
        Open in reader
      </button>
    </aside>
  );
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

      {sourceFile && (
        <button style={styles.sourceButton} onClick={() => onOpenSource(sourceFile)}>
          {sourceFile.path}
        </button>
      )}

      {error && <div style={styles.inlineError}>Could not load wiki node: {error}</div>}
      {!detail && !error && <div style={styles.muted}>Loading wiki page...</div>}
      {detail?.page && (
        <div style={styles.markdownPanel}>
          <ReactMarkdown>{detail.page.content}</ReactMarkdown>
        </div>
      )}

      {detail && (
        <>
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
            return (
              <button
                key={edge.id}
                style={styles.connectionRow}
                onClick={() => onSelectWiki(otherId)}
                disabled={!other}
              >
                <span style={styles.connectionPath}>{other?.title ?? otherId}</span>
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

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div style={styles.metaItem}>
      <div style={styles.metaLabel}>{label}</div>
      <div style={styles.metaValue}>{value}</div>
    </div>
  );
}

function folderFromPath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts.length > 1 ? parts.slice(0, -1).join("/") : "";
}

function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size < 0) return "Unknown";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
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
  connectionReason: {
    color: "var(--text-secondary)",
    fontSize: 12,
    lineHeight: 1.4,
    overflowWrap: "anywhere",
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
    display: "block",
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

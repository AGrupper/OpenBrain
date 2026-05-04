import { useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D from "react-force-graph-2d";
import type { Link, VaultFile } from "@openbrain/shared";
import { api } from "../../shared/api/api";

interface Props {
  files: VaultFile[];
  onSelect: (f: VaultFile) => void;
}

interface GraphNode {
  id: string;
  name: string;
  val: number;
}

interface GraphLink {
  source: string | GraphNode;
  target: string | GraphNode;
  value: number;
  reason: string;
}

interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

export function GraphView({ files, onSelect }: Props) {
  const [approvedLinks, setApprovedLinks] = useState<Link[]>([]);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
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

  const filesById = useMemo(() => new Map(files.map((file) => [file.id, file])), [files]);

  const graphData = useMemo<GraphData>(() => {
    const linkedFileIds = new Set(
      approvedLinks.flatMap((link) => [link.file_a_id, link.file_b_id]),
    );
    const nodes = files
      .filter((file) => linkedFileIds.has(file.id) || files.length < 200)
      .map((file) => ({
        id: file.id,
        name: file.path.split("/").pop() ?? file.path,
        val: linkedFileIds.has(file.id) ? 2 : 1,
      }));
    const visibleNodeIds = new Set(nodes.map((node) => node.id));
    const links = approvedLinks
      .filter((link) => visibleNodeIds.has(link.file_a_id) && visibleNodeIds.has(link.file_b_id))
      .map((link) => ({
        source: link.file_a_id,
        target: link.file_b_id,
        value: link.confidence,
        reason: link.reason,
      }));
    return { nodes, links };
  }, [approvedLinks, files]);

  const selectedFile = selectedNodeId ? (filesById.get(selectedNodeId) ?? null) : null;
  const detailLinks = selectedFile
    ? approvedLinks.filter(
        (link) => link.file_a_id === selectedFile.id || link.file_b_id === selectedFile.id,
      )
    : [];

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
        nodeColor={(node) => {
          if (!neighborIds) return "#3b82f6";
          if (node.id === activeNodeId) return "#f3f4f6";
          if (neighborIds.has(node.id as string)) return "#10b981";
          return "#2d3142";
        }}
        linkColor={(link) => {
          if (!activeNodeId) return "#4b5563";
          if (
            sourceId(link as GraphLink) === activeNodeId ||
            targetId(link as GraphLink) === activeNodeId
          ) {
            return "#8ab4ff";
          }
          return "#2d3142";
        }}
        linkWidth={(link) => Math.max(1.5, (link.value as number) * 3)}
        onNodeHover={(node) => setHoveredNodeId((node?.id as string) ?? null)}
        onNodeClick={(node) => {
          setSelectedNodeId((node.id as string) ?? null);
        }}
        nodeCanvasObject={(node, ctx, globalScale) => {
          const label = node.name as string;
          const fontSize = 12 / globalScale;
          ctx.font = `500 ${fontSize}px Inter, sans-serif`;
          const r = Math.sqrt(node.val as number) * 4;

          // Node circle
          ctx.beginPath();
          ctx.arc(node.x!, node.y!, r, 0, 2 * Math.PI);
          const isHighlighted =
            !neighborIds || node.id === hoveredNodeId || neighborIds.has(node.id as string);
          ctx.fillStyle =
            node.id === hoveredNodeId
              ? "#f3f4f6"
              : neighborIds && neighborIds.has(node.id as string)
                ? "#10b981"
                : isHighlighted
                  ? "#3b82f6"
                  : "#222222";
          ctx.fill();

          if (globalScale > 0.8) {
            ctx.textAlign = "center";
            ctx.textBaseline = "top";
            ctx.fillStyle = isHighlighted ? "#f3f4f6" : "#6b7280";
            ctx.fillText(
              label.length > 20 ? `${label.slice(0, 18)}...` : label,
              node.x!,
              node.y! + r + 4,
            );
          }
        }}
        backgroundColor="#0a0a0a"
        linkDirectionalParticles={2}
        linkDirectionalParticleWidth={(link) => Math.max(1.5, (link.value as number) * 2)}
      />
      {linkError && <div style={styles.error}>Could not load graph links: {linkError}</div>}
      {graphData.nodes.length === 0 && (
        <div style={styles.empty}>
          No connections yet.
          <br />
          <span style={{ fontSize: 12 }}>
            The Architect will propose links as it processes your files.
          </span>
        </div>
      )}
      {selectedFile && (
        <NodeDetailPanel
          file={selectedFile}
          links={detailLinks}
          filesById={filesById}
          onClose={() => setSelectedNodeId(null)}
          onOpen={() => onSelect(selectedFile)}
          onSelectNode={setSelectedNodeId}
        />
      )}
    </div>
  );
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

function NodeDetailPanel({
  file,
  links,
  filesById,
  onClose,
  onOpen,
  onSelectNode,
}: {
  file: VaultFile;
  links: Link[];
  filesById: Map<string, VaultFile>;
  onClose: () => void;
  onOpen: () => void;
  onSelectNode: (fileId: string) => void;
}) {
  return (
    <aside style={styles.detailPanel}>
      <div style={styles.detailHeader}>
        <div>
          <div style={styles.detailEyebrow}>Graph node</div>
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
                  onClick={() => other && onSelectNode(other.id)}
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
    width: "min(380px, calc(100% - 32px))",
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
};

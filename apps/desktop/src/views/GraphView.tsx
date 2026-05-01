import { useEffect, useState, useRef } from "react";
import ForceGraph2D from "react-force-graph-2d";
import type { VaultFile, Link } from "../../../../packages/shared/src/types";
import { api } from "../lib/api";

interface Props {
  files: VaultFile[];
  onSelect: (f: VaultFile) => void;
}

interface GraphData {
  nodes: { id: string; name: string; val: number }[];
  links: { source: string; target: string; value: number; reason: string }[];
}

export function GraphView({ files, onSelect }: Props) {
  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], links: [] });
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  useEffect(() => {
    api.links.approved().then((approvedLinks: Link[]) => {
      const linkedFileIds = new Set(approvedLinks.flatMap((l) => [l.file_a_id, l.file_b_id]));
      const nodes = files
        .filter((f) => linkedFileIds.has(f.id) || files.length < 200)
        .map((f) => ({
          id: f.id,
          name: f.path.split("/").pop() ?? f.path,
          val: linkedFileIds.has(f.id) ? 2 : 1,
        }));
      const links = approvedLinks.map((l) => ({
        source: l.file_a_id,
        target: l.file_b_id,
        value: l.confidence,
        reason: l.reason,
      }));
      setGraphData({ nodes, links });
    });
  }, [files]);

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

  const neighborIds = hoveredNodeId
    ? new Set(
        graphData.links.flatMap((l) =>
          l.source === hoveredNodeId || l.target === hoveredNodeId
            ? [l.source as string, l.target as string]
            : [],
        ),
      )
    : null;

  return (
    <div ref={containerRef} style={{ width: "100%", height: "100%", background: "var(--bg-base)" }}>
      <ForceGraph2D
        width={dimensions.width}
        height={dimensions.height}
        graphData={graphData}
        nodeLabel="name"
        nodeColor={(node) => {
          if (!neighborIds) return "#3b82f6";
          if (node.id === hoveredNodeId) return "#f3f4f6";
          if (neighborIds.has(node.id as string)) return "#10b981";
          return "#222222";
        }}
        linkColor={(link) => {
          if (!hoveredNodeId) return "#1a1a1a";
          if (link.source === hoveredNodeId || link.target === hoveredNodeId) return "#3b82f6";
          return "#1a1a1a";
        }}
        linkWidth={(link) => (link.value as number) * 2}
        onNodeHover={(node) => setHoveredNodeId((node?.id as string) ?? null)}
        onNodeClick={(node) => {
          const file = files.find((f) => f.id === node.id);
          if (file) onSelect(file);
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

          // Label only when close enough.
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
        linkDirectionalParticleWidth={(link) => (link.value as number) * 2}
      />
      {graphData.nodes.length === 0 && (
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%,-50%)",
            color: "#555",
            textAlign: "center",
          }}
        >
          No connections yet.
          <br />
          <span style={{ fontSize: 12 }}>
            The Architect will propose links as it processes your files.
          </span>
        </div>
      )}
    </div>
  );
}

import { useEffect, useRef, useState, useMemo } from "react";
import { useAppStore } from "../store/useStore";
import { listWorkspace, readWorkspaceFile } from "../storage/workspace";

interface Node {
  id: string;
  label: string;
  x: number;
  y: number;
  links: string[];
}

export function GraphView({ onOpenFile }: { onOpenFile: (path: string, content: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  // Load workspace files and build graph
  useEffect(() => {
    buildGraph();
  }, []);

  async function buildGraph() {
    try {
      const entries = await listWorkspace();
      const mdFiles = entries.filter((e) => e.name.endsWith(".md")).map((e) => e.path);
      const wikiRe = /\[\[([^\]]+)\]\]/g;

      const nodeMap = new Map<string, Node>();

      // Parse all files for wiki-links
      for (const path of mdFiles) {
        const content = await readWorkspaceFile(path);
        const links: string[] = [];
        let m: RegExpExecArray | null;
        while ((m = wikiRe.exec(content)) !== null) {
          links.push(m[1]);
        }
        nodeMap.set(path, {
          id: path,
          label: path.split("/").pop()?.replace(/\.md$/, "") ?? path,
          x: 0,
          y: 0,
          links,
        });
      }

      // Resolve link targets to actual file IDs
      for (const node of nodeMap.values()) {
        node.links = node.links
          .map((link) => {
            // Try exact match
            const exact = mdFiles.find((f) => f === link || f === `${link}.md`);
            if (exact) return exact;
            // Try basename match
            const base = mdFiles.find((f) => {
              const name = f.split("/").pop()?.replace(/\.md$/, "");
              return name === link;
            });
            return base ?? "";
          })
          .filter(Boolean);
      }

      // Force-directed layout (simple)
      const arr = [...nodeMap.values()];
      const cx = dimensions.width / 2;
      const cy = dimensions.height / 2;
      const radius = Math.min(cx, cy) * 0.7;

      arr.forEach((n, i) => {
        const angle = (2 * Math.PI * i) / arr.length;
        n.x = cx + radius * Math.cos(angle);
        n.y = cy + radius * Math.sin(angle);
      });

      // Simple force-directed iterations
      for (let iter = 0; iter < 100; iter++) {
        for (let i = 0; i < arr.length; i++) {
          for (let j = i + 1; j < arr.length; j++) {
            const dx = arr[j].x - arr[i].x;
            const dy = arr[j].y - arr[i].y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;
            const repulsion = 5000 / (dist * dist);
            arr[i].x -= (dx / dist) * repulsion;
            arr[i].y -= (dy / dist) * repulsion;
            arr[j].x += (dx / dist) * repulsion;
            arr[j].y += (dy / dist) * repulsion;
          }
        }

        // Attraction along edges
        for (const node of arr) {
          for (const linkId of node.links) {
            const target = nodeMap.get(linkId);
            if (!target) continue;
            const dx = target.x - node.x;
            const dy = target.y - node.y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;
            const attraction = dist * 0.001;
            node.x += dx * attraction;
            node.y += dy * attraction;
            target.x -= dx * attraction;
            target.y -= dy * attraction;
          }
        }

        // Center gravity
        for (const n of arr) {
          n.x += (cx - n.x) * 0.01;
          n.y += (cy - n.y) * 0.01;
        }
      }

      setNodes(arr);
    } catch {
      // Workspace unavailable
      setNodes([]);
    }
  }

  // Draw canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || nodes.length === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const isDark = document.documentElement.classList.contains("dark");
    const bg = isDark ? "#1a1b26" : "#ffffff";
    const fg = isDark ? "#c0caf5" : "#333333";
    const accent = "#7c5cff";
    const edge = isDark ? "rgba(192,202,245,0.15)" : "rgba(50,50,50,0.15)";

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw edges
    ctx.strokeStyle = edge;
    ctx.lineWidth = 1;
    for (const node of nodes) {
      for (const linkId of node.links) {
        const target = nodes.find((n) => n.id === linkId);
        if (!target) continue;
        ctx.beginPath();
        ctx.moveTo(node.x, node.y);
        ctx.lineTo(target.x, target.y);
        ctx.stroke();
      }
    }

    // Draw nodes
    for (const node of nodes) {
      const isHovered = hoveredNode === node.id;
      const r = isHovered ? 8 : 5;

      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
      ctx.fillStyle = node.links.length > 0 ? accent : fg;
      ctx.fill();

      // Label
      ctx.font = `${isHovered ? 12 : 10}px -apple-system, sans-serif`;
      ctx.fillStyle = fg;
      ctx.textAlign = "center";
      ctx.fillText(node.label, node.x, node.y - r - 4);
    }
  }, [nodes, hoveredNode]);

  // Mouse hover detection
  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const found = nodes.find((n) => {
      const dx = n.x - x;
      const dy = n.y - y;
      return dx * dx + dy * dy < 100;
    });
    setHoveredNode(found?.id ?? null);
  }

  // Click to open file
  async function handleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!hoveredNode) return;
    try {
      const content = await readWorkspaceFile(hoveredNode);
      onOpenFile(hoveredNode, content);
    } catch { /* ignore */ }
  }

  useEffect(() => {
    const el = canvasRef.current?.parentElement;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setDimensions({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      {nodes.length === 0 ? (
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          color: "hsl(var(--fg-muted))",
          fontSize: 13,
        }}>
          No workspace files found. Open the workspace panel and add files to see the knowledge graph.
        </div>
      ) : (
        <canvas
          ref={canvasRef}
          width={dimensions.width}
          height={dimensions.height}
          style={{ cursor: hoveredNode ? "pointer" : "default" }}
          onMouseMove={handleMouseMove}
          onClick={handleClick}
        />
      )}
      <div style={{
        position: "absolute",
        top: 12,
        left: 12,
        fontSize: 11,
        color: "hsl(var(--fg-muted))",
        background: "hsl(var(--bg) / 0.8)",
        padding: "4px 8px",
        borderRadius: 6,
      }}>
        {nodes.length} nodes · {nodes.reduce((s, n) => s + n.links.length, 0)} connections
      </div>
    </div>
  );
}

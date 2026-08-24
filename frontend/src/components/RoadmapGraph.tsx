import { useMemo } from "react";
import { cn } from "@/lib/utils";

export type GraphNode = {
  id: string | number;
  item_id: string | number;
  type?: string;
  title?: string;
  course_id?: string | number;
  phase_index?: number;
  phase_name?: string;
  hours?: number;
  status?: string;
};

export type GraphEdge = { source: string | number; target: string | number; kind?: string };

/* Layout constants, in SVG user units. */
const NODE_W = 210;
const NODE_H = 68;
const COL_GAP = 78;
const ROW_GAP = 26;
const HEADER_H = 40;
const PAD = 12;

const STATUS: Record<string, { fill: string; stroke: string; dot: string }> = {
  completed: { fill: "var(--color-success)", stroke: "var(--color-success)", dot: "var(--color-success)" },
  in_progress: { fill: "var(--color-primary)", stroke: "var(--color-primary)", dot: "var(--color-primary)" },
  not_started: { fill: "var(--color-card)", stroke: "var(--color-border)", dot: "var(--color-muted-foreground)" },
};

/**
 * The learning path as an actual dependency graph.
 *
 * Prerequisites are the planner's central output, but they were previously
 * encoded as *solid vs dashed card borders* — a distinction almost nobody
 * would notice, let alone read as "this must come first". Here each hard
 * prerequisite is a drawn, arrowed connector, so the shape of the path — what
 * gates what, where the branches converge — is visible at a glance.
 *
 * Sequence edges are deliberately not drawn. They only encode "suggested
 * pacing order", which the top-to-bottom layout already communicates; drawing
 * them would double the line count and bury the edges that actually constrain
 * the learner.
 */
export function RoadmapGraph({
  nodes,
  edges,
  onSelect,
  selectedId,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  onSelect?: (node: GraphNode) => void;
  selectedId?: string | number | null;
}) {
  const layout = useMemo(() => {
    const phases = new Map<number, GraphNode[]>();
    for (const node of nodes) {
      const key = node.phase_index ?? 0;
      if (!phases.has(key)) phases.set(key, []);
      phases.get(key)!.push(node);
    }
    const columns = [...phases.entries()].sort((a, b) => a[0] - b[0]);

    const pos = new Map<string | number, { x: number; y: number }>();
    columns.forEach(([, items], col) => {
      items.forEach((node, row) => {
        pos.set(node.id, {
          x: PAD + col * (NODE_W + COL_GAP),
          y: PAD + HEADER_H + row * (NODE_H + ROW_GAP),
        });
      });
    });

    const rows = Math.max(...columns.map(([, items]) => items.length), 1);
    return {
      columns,
      pos,
      width: PAD * 2 + columns.length * NODE_W + Math.max(0, columns.length - 1) * COL_GAP,
      height: PAD * 2 + HEADER_H + rows * NODE_H + Math.max(0, rows - 1) * ROW_GAP,
    };
  }, [nodes]);

  const prerequisiteEdges = useMemo(
    () => edges.filter((e) => e.kind === "prerequisite"),
    [edges],
  );

  if (!nodes.length) return null;

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card p-2">
      <svg
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        width={layout.width}
        height={layout.height}
        className="max-w-none"
        role="img"
        aria-label="Learning path dependency graph"
      >
        <defs>
          <marker
            id="rm-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--color-primary)" />
          </marker>
        </defs>

        {/* Phase headers */}
        {layout.columns.map(([index, items], col) => (
          <text
            key={`h-${index}`}
            x={PAD + col * (NODE_W + COL_GAP)}
            y={PAD + 18}
            className="fill-muted-foreground"
            style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1.2, textTransform: "uppercase" }}
          >
            {(items[0]?.phase_name ?? `Phase ${index + 1}`).toUpperCase()}
          </text>
        ))}

        {/* Prerequisite connectors, drawn under the nodes */}
        {prerequisiteEdges.map((edge, i) => {
          const from = layout.pos.get(edge.source);
          const to = layout.pos.get(edge.target);
          if (!from || !to) return null;

          // Same column: drop from the bottom edge into the top of the target.
          // Different column: leave the right edge and enter from the left, with
          // a horizontal-tangent bezier so lines stay readable when they cross.
          const sameColumn = from.x === to.x;
          const path = sameColumn
            ? `M ${from.x + NODE_W / 2} ${from.y + NODE_H} L ${to.x + NODE_W / 2} ${to.y - 6}`
            : (() => {
                const x1 = from.x + NODE_W;
                const y1 = from.y + NODE_H / 2;
                const x2 = to.x - 6;
                const y2 = to.y + NODE_H / 2;
                const dx = Math.max(30, (x2 - x1) / 2);
                return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
              })();

          return (
            <path
              key={`e-${i}`}
              d={path}
              fill="none"
              stroke="var(--color-primary)"
              strokeWidth={1.75}
              strokeOpacity={0.5}
              markerEnd="url(#rm-arrow)"
            />
          );
        })}

        {/* Nodes */}
        {layout.columns.flatMap(([, items]) =>
          items.map((node) => {
            const p = layout.pos.get(node.id)!;
            const status = STATUS[node.status ?? "not_started"] ?? STATUS.not_started;
            const done = node.status === "completed";
            const selected = selectedId != null && node.id === selectedId;

            return (
              <g
                key={node.id}
                transform={`translate(${p.x} ${p.y})`}
                onClick={() => onSelect?.(node)}
                className="cursor-pointer"
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") onSelect?.(node);
                }}
              >
                <rect
                  width={NODE_W}
                  height={NODE_H}
                  rx={8}
                  fill={done ? "var(--color-accent)" : "var(--color-card)"}
                  stroke={selected ? "var(--color-primary)" : status.stroke}
                  strokeWidth={selected ? 2.25 : 1.25}
                  className="transition-all duration-150 hover:brightness-[0.985]"
                />
                {/* Status dot — the one place colour carries meaning on a node */}
                <circle cx={16} cy={20} r={4.5} fill={status.dot} />
                <text
                  x={29}
                  y={24}
                  className="fill-foreground"
                  style={{ fontSize: 12.5, fontWeight: 600 }}
                >
                  {truncate(node.title ?? "", 22)}
                </text>
                <text
                  x={16}
                  y={45}
                  className="fill-muted-foreground"
                  style={{ fontSize: 11 }}
                >
                  {[node.type, node.hours ? `${node.hours}h` : null].filter(Boolean).join(" · ")}
                </text>
                <text
                  x={NODE_W - 14}
                  y={45}
                  textAnchor="end"
                  style={{ fontSize: 10.5, fontWeight: 600 }}
                  className={cn(
                    done ? "fill-success" : node.status === "in_progress" ? "fill-primary" : "fill-muted-foreground",
                  )}
                >
                  {labelFor(node.status)}
                </text>
              </g>
            );
          }),
        )}
      </svg>
    </div>
  );
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function labelFor(status?: string): string {
  if (status === "completed") return "DONE";
  if (status === "in_progress") return "IN PROGRESS";
  return "";
}

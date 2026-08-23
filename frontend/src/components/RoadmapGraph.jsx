/**
 * The learning path as a directed graph.
 *
 * Laid out by phase, left to right, because that is the axis the plan is actually
 * ordered on — time. Within a phase, items stack in their planned order. Edges are
 * drawn from the backend's two kinds and styled differently on purpose: a solid
 * accent arrow is a *prerequisite* the learner must respect, a dashed grey one is
 * suggested pacing. Conflating them would tell a learner they are blocked when
 * they are merely early.
 *
 * Hand-rolled SVG rather than a graph library: the layout is a layered DAG with a
 * known layer assignment (the phase index), so there is no layout problem left to
 * solve, and 120kB of react-flow would buy nothing but drag-and-drop nobody asked
 * for.
 */
import { useMemo } from 'react'
import { CheckCircle2, Circle, CircleDot, FlaskConical, ShieldCheck } from 'lucide-react'

import { fmt } from './ui'

const NODE_W = 208
const NODE_H = 74
const GAP_X = 92
const GAP_Y = 20
const PAD = 24
const HEADER_H = 34

const TYPE_ICON = {
  course: Circle,
  project: FlaskConical,
  assessment: ShieldCheck,
  checkpoint: ShieldCheck,
}

export function RoadmapGraph({ graph, onSelectNode, selectedId = null }) {
  const layout = useMemo(() => {
    const nodes = graph?.nodes ?? []
    if (!nodes.length) return null

    // Columns are phase indices, taken from the data rather than assumed to be
    // 0..3: a plan for an advanced learner starts at a later tier, so phase 0 may
    // legitimately not exist.
    const columnKeys = [...new Set(nodes.map((n) => n.phase_index))].sort((a, b) => a - b)
    const columnOf = new Map(columnKeys.map((key, index) => [key, index]))

    const rowCounters = new Map()
    const placed = nodes
      .slice()
      .sort((a, b) => a.id - b.id)
      .map((node) => {
        const column = columnOf.get(node.phase_index) ?? 0
        const row = rowCounters.get(column) ?? 0
        rowCounters.set(column, row + 1)
        return {
          ...node,
          x: PAD + column * (NODE_W + GAP_X),
          y: PAD + HEADER_H + row * (NODE_H + GAP_Y),
          column,
          row,
        }
      })

    const byId = new Map(placed.map((node) => [node.id, node]))
    const tallest = Math.max(...[...rowCounters.values()], 1)

    const columns = columnKeys.map((key, index) => ({
      key,
      index,
      name: placed.find((n) => n.phase_index === key)?.phase_name ?? `Phase ${key + 1}`,
      x: PAD + index * (NODE_W + GAP_X),
      count: rowCounters.get(index) ?? 0,
    }))

    return {
      nodes: placed,
      byId,
      columns,
      width: PAD * 2 + columnKeys.length * NODE_W + Math.max(columnKeys.length - 1, 0) * GAP_X,
      height: PAD * 2 + HEADER_H + tallest * (NODE_H + GAP_Y),
    }
  }, [graph])

  if (!layout) {
    return <p className="py-10 text-center text-sm text-ink-500">Nothing to draw yet.</p>
  }

  const edges = (graph.edges ?? [])
    .map((edge) => ({
      ...edge,
      from: layout.byId.get(edge.source),
      to: layout.byId.get(edge.target),
    }))
    .filter((edge) => edge.from && edge.to)

  return (
    <div className="overflow-x-auto">
      <svg
        width={layout.width}
        height={layout.height}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        className="min-w-full"
        role="img"
        aria-label="Learning path dependency graph"
      >
        <defs>
          <marker
            id="arrow-prereq"
            viewBox="0 0 8 8"
            refX="7"
            refY="4"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 1 L 7 4 L 0 7 z" fill="#2148e2" />
          </marker>
          <marker
            id="arrow-seq"
            viewBox="0 0 8 8"
            refX="7"
            refY="4"
            markerWidth="5"
            markerHeight="5"
            orient="auto-start-reverse"
          >
            <path d="M 0 1 L 7 4 L 0 7 z" fill="#aeb7c8" />
          </marker>
        </defs>

        {/* Phase bands first, so every edge and node sits on top of them. */}
        {layout.columns.map((column) => (
          <g key={column.key}>
            <rect
              x={column.x - 10}
              y={PAD - 6}
              width={NODE_W + 20}
              height={layout.height - PAD * 2 + 12}
              rx={12}
              fill={column.index % 2 === 0 ? '#f6f7f9' : '#fbfcfd'}
              stroke="#eceef2"
            />
            <text
              x={column.x}
              y={PAD + 8}
              className="fill-ink-500"
              style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.04em' }}
            >
              {column.name.toUpperCase()}
            </text>
            <text x={column.x} y={PAD + 22} className="fill-ink-400" style={{ fontSize: 10 }}>
              {column.count} step{column.count === 1 ? '' : 's'}
            </text>
          </g>
        ))}

        {edges.map((edge, index) => {
          const prereq = edge.kind === 'prerequisite'
          const x1 = edge.from.x + NODE_W
          const y1 = edge.from.y + NODE_H / 2
          const x2 = edge.to.x
          const y2 = edge.to.y + NODE_H / 2
          // Same column means the arrow would double back on itself, so it routes
          // out to the right and returns — visibly a vertical hop, not a jump to
          // the next phase.
          const sameColumn = edge.from.column === edge.to.column
          const path = sameColumn
            ? `M ${edge.from.x + NODE_W / 2} ${edge.from.y + NODE_H} ` +
              `C ${edge.from.x + NODE_W / 2 + 40} ${edge.from.y + NODE_H + 12}, ` +
              `${edge.to.x + NODE_W / 2 + 40} ${edge.to.y - 12}, ` +
              `${edge.to.x + NODE_W / 2} ${edge.to.y}`
            : `M ${x1} ${y1} C ${x1 + GAP_X / 2} ${y1}, ${x2 - GAP_X / 2} ${y2}, ${x2} ${y2}`

          return (
            <path
              key={`${edge.source}-${edge.target}-${index}`}
              d={path}
              fill="none"
              stroke={prereq ? '#2148e2' : '#cbd2de'}
              strokeWidth={prereq ? 1.8 : 1.2}
              strokeDasharray={prereq ? undefined : '4 4'}
              markerEnd={prereq ? 'url(#arrow-prereq)' : 'url(#arrow-seq)'}
              opacity={prereq ? 0.85 : 0.75}
            />
          )
        })}

        {layout.nodes.map((node) => {
          const done = node.status === 'completed'
          const active = node.status === 'in_progress'
          const selected = selectedId === node.id
          const Icon = done ? CheckCircle2 : active ? CircleDot : TYPE_ICON[node.type] ?? Circle
          return (
            <g
              key={node.id}
              transform={`translate(${node.x}, ${node.y})`}
              onClick={() => onSelectNode?.(node)}
              className={onSelectNode ? 'cursor-pointer' : undefined}
              role={onSelectNode ? 'button' : undefined}
              tabIndex={onSelectNode ? 0 : undefined}
              onKeyDown={(event) => {
                if (onSelectNode && (event.key === 'Enter' || event.key === ' ')) {
                  event.preventDefault()
                  onSelectNode(node)
                }
              }}
            >
              <rect
                width={NODE_W}
                height={NODE_H}
                rx={10}
                fill={done ? '#ecfdf5' : active ? '#eef4ff' : '#ffffff'}
                stroke={selected ? '#2148e2' : done ? '#a7f3d0' : active ? '#bdd3ff' : '#d4d9e2'}
                strokeWidth={selected ? 2 : 1}
              />
              {/* A left rail carries the status colour, so state survives at a glance. */}
              <rect
                width={4}
                height={NODE_H}
                rx={2}
                fill={done ? '#10b981' : active ? '#3565f5' : '#d4d9e2'}
              />
              <foreignObject x={12} y={8} width={NODE_W - 24} height={NODE_H - 16}>
                <div
                  xmlns="http://www.w3.org/1999/xhtml"
                  className="flex h-full flex-col justify-between"
                >
                  <div className="flex items-start gap-1.5">
                    <Icon
                      className={`mt-[2px] h-3 w-3 shrink-0 ${
                        done ? 'text-emerald-600' : active ? 'text-accent-600' : 'text-ink-400'
                      }`}
                    />
                    <p
                      className="line-clamp-2 text-[11.5px] font-medium leading-snug text-ink-900"
                      title={node.title}
                    >
                      {node.title}
                    </p>
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-ink-400">
                    <span>{fmt.hours(node.hours)}</span>
                    <span className="uppercase tracking-wide">{node.type}</span>
                  </div>
                </div>
              </foreignObject>
            </g>
          )
        })}
      </svg>

      <div className="mt-2 flex flex-wrap items-center gap-4 px-1 text-[11px] text-ink-500">
        <span className="inline-flex items-center gap-1.5">
          <svg width="26" height="6" aria-hidden="true">
            <line x1="0" y1="3" x2="26" y2="3" stroke="#2148e2" strokeWidth="1.8" />
          </svg>
          prerequisite — must come first
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg width="26" height="6" aria-hidden="true">
            <line
              x1="0"
              y1="3"
              x2="26"
              y2="3"
              stroke="#cbd2de"
              strokeWidth="1.2"
              strokeDasharray="4 4"
            />
          </svg>
          suggested order — pacing only
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-emerald-500" /> completed
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-accent-500" /> in progress
        </span>
      </div>
    </div>
  )
}

export default RoadmapGraph

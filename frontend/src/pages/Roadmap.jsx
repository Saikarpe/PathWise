/**
 * The roadmap.
 *
 * Two views of the same plan, because they answer different questions. The graph
 * answers "what depends on what" — it is the only place the prerequisite structure
 * is visible, and prerequisite validity is the main claim the planner makes. The
 * list answers "what do I do, in what order, and how long will it take", which is
 * what a learner working through the plan actually needs.
 *
 * Clicking any step fetches its explanation from the backend rather than reusing
 * the score cached on the item. The item's stored `factors` are what the ranker
 * computed *at planning time*; the explain endpoint recomputes against the current
 * profile, so after a few completions the two legitimately differ — and the current
 * one is the honest answer to "why is this still here?".
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import {
  Archive,
  ArrowRight,
  CheckCircle2,
  Clock,
  Flag,
  GitBranch,
  HelpCircle,
  List,
  Lock,
  Network,
  PlayCircle,
  RefreshCw,
  Route,
  Trash2,
} from 'lucide-react'

import { paths as pathsApi } from '../api/endpoints'
import { useAction, useResource } from '../hooks/useApi'
import {
  Empty,
  ErrorState,
  Loading,
  Markdownish,
  ProgressBar,
  Spinner,
  StatusChip,
  fmt,
} from '../components/ui'
import { Milestones } from '../components/Milestones'
import { RoadmapGraph } from '../components/RoadmapGraph'
import { WhyDrawer } from '../components/WhyDrawer'

export default function Roadmap() {
  const [view, setView] = useState('graph')
  const [explaining, setExplaining] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)

  const { data: active, loading, error, reload } = useResource(() => pathsApi.active(), [reloadKey])
  const pathId = active?.has_path ? active.id : null

  const { data: graph } = useResource(
    () => (pathId ? pathsApi.graph(pathId) : Promise.resolve(null)),
    [pathId, reloadKey],
  )
  const { data: allPaths, reload: reloadList } = useResource(() => pathsApi.list(), [reloadKey])

  function refresh() {
    setReloadKey((key) => key + 1)
    reloadList()
  }

  async function openExplanation(itemId) {
    if (!pathId) return
    try {
      const payload = await pathsApi.explainItem(pathId, itemId)
      setExplaining(payload)
    } catch (err) {
      toast.error(err.message)
    }
  }

  if (loading && !active) return <Loading label="Loading your roadmap…" />
  if (error) return <ErrorState error={error} onRetry={reload} />

  if (!active?.has_path) {
    return (
      <Empty
        icon={Route}
        title="No active learning path"
        action={
          <Link to="/onboarding" className="btn-primary">
            Build one now <ArrowRight className="h-4 w-4" />
          </Link>
        }
      >
        A path is generated from your goal: tracks are resolved, gaps measured, courses selected by
        set cover over those gaps, then ordered against the prerequisite graph.
      </Empty>
    )
  }

  const completed = active.items.filter((item) => item.status === 'completed').length
  const progress = active.items.length ? completed / active.items.length : 0

  return (
    <div className="space-y-6">
      <header className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold text-ink-900">{active.title}</h1>
              <span className="chip">v{active.version}</span>
            </div>
            <p className="muted mt-1 max-w-2xl">
              From your goal: <span className="italic">&ldquo;{active.goal_text}&rdquo;</span>
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {(active.tracks ?? []).map((track) => (
                <span key={track} className="chip-accent">
                  {track}
                </span>
              ))}
              {active.target_role ? <span className="chip-good">{active.target_role}</span> : null}
            </div>
          </div>

          <div className="grid shrink-0 grid-cols-3 gap-4 text-right">
            {[
              ['Steps', `${completed}/${active.total_courses}`],
              ['Hours', fmt.hours(active.total_hours)],
              ['Weeks', active.estimated_weeks],
            ].map(([label, value]) => (
              <div key={label}>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">
                  {label}
                </p>
                <p className="text-lg font-semibold tabular-nums text-ink-900">{value}</p>
              </div>
            ))}
          </div>
        </div>

        <ProgressBar value={progress} className="mt-4" showLabel />

        {active.explanation?.headline ? (
          <p className="mt-3 text-sm text-ink-700">
            <Markdownish text={active.explanation.headline} />
          </p>
        ) : null}
        {active.explanation?.detail ? (
          <p className="prose-tight mt-1.5 text-sm leading-relaxed text-ink-600">
            <Markdownish text={active.explanation.detail} />
          </p>
        ) : null}
        {active.explanation?.caveats?.length ? (
          <ul className="mt-3 space-y-1.5">
            {active.explanation.caveats.map((caveat, index) => (
              <li
                key={index}
                className="rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-sm text-amber-900"
              >
                <Markdownish text={caveat} />
              </li>
            ))}
          </ul>
        ) : null}
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-ink-200 bg-white p-0.5">
          <button
            type="button"
            onClick={() => setView('graph')}
            className={`btn-sm rounded-md ${
              view === 'graph' ? 'bg-accent-600 text-white' : 'text-ink-600 hover:bg-ink-50'
            }`}
          >
            <Network className="h-3 w-3" /> Dependency graph
          </button>
          <button
            type="button"
            onClick={() => setView('list')}
            className={`btn-sm rounded-md ${
              view === 'list' ? 'bg-accent-600 text-white' : 'text-ink-600 hover:bg-ink-50'
            }`}
          >
            <List className="h-3 w-3" /> Step list
          </button>
        </div>
        <span className="muted">
          {view === 'graph'
            ? 'Columns are phases; solid arrows are hard prerequisites.'
            : 'In planned order, with progress controls.'}
        </span>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.6fr,1fr]">
        <div className="min-w-0 space-y-6">
          {view === 'graph' ? (
            <section className="card p-4">
              {graph ? (
                <RoadmapGraph
                  graph={graph}
                  selectedId={explaining?.item?.id ?? null}
                  onSelectNode={(node) => openExplanation(node.item_id)}
                />
              ) : (
                <Loading label="Laying out the graph…" className="py-16" />
              )}
            </section>
          ) : (
            <StepList
              items={active.items}
              pathId={active.id}
              onWhy={openExplanation}
              onProgress={refresh}
            />
          )}
        </div>

        <div className="space-y-6">
          <section className="card p-5">
            <h2 className="flex items-center gap-2 text-base font-semibold text-ink-900">
              <Flag className="h-4 w-4 text-accent-600" />
              Milestones
            </h2>
            <Milestones milestones={active.milestones} className="mt-4" />
          </section>

          {active.analysis ? <AnalysisPanel analysis={active.analysis} /> : null}

          <PathManager paths={allPaths} activeId={active.id} onChanged={refresh} />
        </div>
      </div>

      <WhyDrawer
        recommendation={explaining}
        pathId={active.id}
        onClose={() => setExplaining(null)}
      />
    </div>
  )
}

/**
 * The plan as an ordered list, grouped by phase.
 *
 * Progress is recorded here. `progress_pct` is sent alongside the status because
 * the backend uses it for hour accounting — marking something started with no
 * percentage would log zero hours and make the pacing chart wrong.
 */
function StepList({ items, pathId, onWhy, onProgress }) {
  const [busy, setBusy] = useState(null)

  const phases = []
  for (const item of items) {
    const last = phases[phases.length - 1]
    if (!last || last.index !== item.phase_index) {
      phases.push({ index: item.phase_index, name: item.phase_name, items: [item] })
    } else {
      last.items.push(item)
    }
  }

  async function mark(item, status) {
    if (!item.course_id) {
      toast.error('This step is not a catalogue course, so it has no progress to record.')
      return
    }
    setBusy(`${item.id}-${status}`)
    try {
      const result = await pathsApi.progress(pathId, {
        course_id: item.course_id,
        status,
        // 0–100, and only meaningful for "started": completing a step sets 100 and
        // logs the course's catalogue hours server-side.
        progress_pct: status === 'in_progress' ? 10 : undefined,
      })
      toast.success(result.adaptation?.explanation || `Marked ${status.replace('_', ' ')}`)
      onProgress?.()
    } catch (error) {
      toast.error(error.message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-5">
      {phases.map((phase) => (
        <section key={phase.index} className="card p-5">
          <div className="flex items-center gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-500">
              {phase.name}
            </h2>
            <span className="h-px flex-1 bg-ink-200" />
            <span className="text-[11px] tabular-nums text-ink-400">
              {phase.items.filter((item) => item.status === 'completed').length}/
              {phase.items.length} done ·{' '}
              {fmt.hours(phase.items.reduce((sum, item) => sum + item.hours, 0))}
            </span>
          </div>

          <ol className="mt-3 space-y-2.5">
            {phase.items.map((item) => (
              <li
                key={item.id}
                className={`rounded-lg border p-3 ${
                  item.status === 'completed'
                    ? 'border-emerald-200 bg-emerald-50/40'
                    : item.status === 'in_progress'
                      ? 'border-accent-200 bg-accent-50/40'
                      : 'border-ink-200'
                }`}
              >
                <div className="flex items-start gap-3">
                  <span
                    className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded
                               bg-white text-[11px] font-semibold tabular-nums text-ink-600
                               ring-1 ring-inset ring-ink-200"
                  >
                    {item.order_index + 1}
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      {item.course_id ? (
                        <Link
                          to={`/courses/${encodeURIComponent(item.course_id)}`}
                          className="font-medium text-ink-900 hover:text-accent-700 hover:underline"
                        >
                          {item.title}
                        </Link>
                      ) : (
                        <span className="font-medium text-ink-900">{item.title}</span>
                      )}
                      <StatusChip status={item.status} />
                      <span className="chip text-[11px]">{item.item_type}</span>
                    </div>

                    <p className="mt-1 text-sm text-ink-600">
                      <Markdownish text={item.rationale} />
                    </p>

                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-500">
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3 w-3" /> {fmt.hours(item.hours)}
                      </span>
                      {item.prerequisite_ids?.length ? (
                        <span className="inline-flex items-center gap-1 text-amber-700">
                          <Lock className="h-3 w-3" /> {item.prerequisite_ids.length} prerequisite
                          step{item.prerequisite_ids.length === 1 ? '' : 's'} first
                        </span>
                      ) : null}
                    </div>

                    {item.skills?.length ? (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {item.skills.slice(0, 5).map((skill) => (
                          <span key={skill} className="chip text-[11px]">
                            {skill}
                          </span>
                        ))}
                      </div>
                    ) : null}

                    <div className="mt-2.5 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onWhy(item.id)}
                        className="btn-secondary btn-sm"
                      >
                        <HelpCircle className="h-3 w-3" /> Why this step?
                      </button>
                      {item.status !== 'in_progress' && item.status !== 'completed' ? (
                        <button
                          type="button"
                          disabled={Boolean(busy)}
                          onClick={() => mark(item, 'in_progress')}
                          className="btn-ghost btn-sm"
                        >
                          {busy === `${item.id}-in_progress` ? (
                            <Spinner className="h-3 w-3" />
                          ) : (
                            <PlayCircle className="h-3 w-3" />
                          )}
                          Start
                        </button>
                      ) : null}
                      {item.status !== 'completed' ? (
                        <button
                          type="button"
                          disabled={Boolean(busy)}
                          onClick={() => mark(item, 'completed')}
                          className="btn-ghost btn-sm"
                        >
                          {busy === `${item.id}-completed` ? (
                            <Spinner className="h-3 w-3" />
                          ) : (
                            <CheckCircle2 className="h-3 w-3" />
                          )}
                          Complete
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  )
}

/**
 * The planner's own working, unedited.
 *
 * This panel exists because "here is your path" is a claim, and the gap report is
 * the evidence for it. Three things are worth arguing over and so all three are
 * exposed: the measured gap per skill, the readiness projection, and the *waivers*
 * — the tiers the planner skipped on the strength of the learner's self-described
 * level. A waiver is an assumption, not a measurement, and a learner who disagrees
 * with one should be able to see it and say so rather than wonder why the plan
 * starts where it does.
 */
function AnalysisPanel({ analysis }) {
  const gap = analysis.gap ?? {}
  const gapRows = (gap.skills ?? []).filter((row) => row.status !== 'mastered').slice(0, 8)

  const rows = [
    ['Gap measured against', analysis.target_source],
    ['Skills the goal requires', gap.skills?.length],
    ['Still open', gap.open_gap_count],
    ['Already mastered', gap.mastered_count],
    [
      'Readiness if you finish',
      analysis.readiness_before !== undefined
        ? `${fmt.pct(analysis.readiness_before)} → ${fmt.pct(analysis.readiness_after)}`
        : undefined,
    ],
    ['Planned for level', analysis.level_used],
    [
      'Capacity',
      analysis.capacity_hours !== undefined
        ? `${fmt.hours(analysis.capacity_hours)} at ${analysis.weekly_hours}h/wk`
        : undefined,
    ],
  ].filter(([, value]) => value !== undefined && value !== null && value !== '')

  return (
    <section className="card p-5">
      <h2 className="flex items-center gap-2 text-base font-semibold text-ink-900">
        <GitBranch className="h-4 w-4 text-accent-600" />
        How this plan was built
      </h2>
      <p className="muted mt-0.5">
        The gap report the planner worked from — shown so you can disagree with it.
      </p>

      <dl className="mt-3 space-y-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-3 text-sm">
            <dt className="text-ink-600">{label}</dt>
            <dd className="shrink-0 font-medium tabular-nums text-ink-900">{value}</dd>
          </div>
        ))}
      </dl>

      {gapRows.length ? (
        <div className="mt-4">
          <p className="section-title mb-2">Largest open gaps</p>
          <ul className="space-y-2">
            {gapRows.map((row) => (
              <li key={row.skill}>
                <div className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="truncate text-ink-700" title={row.skill}>
                    {row.skill}
                  </span>
                  <span className="shrink-0 tabular-nums text-ink-400">
                    {fmt.pct(row.current)} of {fmt.pct(row.required)} needed
                  </span>
                </div>
                {/* Two stacked bars: how far along you are, against how far the
                    goal requires. A single bar cannot show a moving target. */}
                <div className="relative mt-1 h-1.5 overflow-hidden rounded-full bg-ink-100">
                  <div
                    className="absolute inset-y-0 left-0 rounded-full bg-ink-200"
                    style={{ width: `${Math.min(100, row.required * 100)}%` }}
                  />
                  <div
                    className="absolute inset-y-0 left-0 rounded-full bg-accent-500"
                    style={{ width: `${Math.min(100, row.current * 100)}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {analysis.skills_to_gain?.length ? (
        <div className="mt-4">
          <p className="section-title mb-1.5">Skills this path takes you over the line on</p>
          <div className="flex flex-wrap gap-1">
            {analysis.skills_to_gain.map((skill) => (
              <span key={skill} className="chip-good text-[11px]">
                {skill}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {analysis.assumptions?.length ? (
        <div className="mt-4">
          <p className="section-title mb-1.5 flex items-center gap-1.5">
            <Lock className="h-3 w-3 text-amber-600" />
            Assumed already known — {analysis.assumptions.length} tier
            {analysis.assumptions.length === 1 ? '' : 's'} skipped
          </p>
          <ul className="space-y-1.5">
            {analysis.assumptions.slice(0, 6).map((waiver) => (
              <li
                key={`${waiver.track}-${waiver.tier}`}
                className="rounded-lg border border-amber-200 bg-amber-50/60 px-2.5 py-2 text-xs text-amber-900"
              >
                <span className="font-medium">
                  {waiver.track} · {waiver.difficulty}
                </span>
                <span className="mt-0.5 block text-amber-800/80">
                  {waiver.reason} Representative course:{' '}
                  <Link
                    to={`/courses/${encodeURIComponent(waiver.representative_course_id)}`}
                    className="underline hover:no-underline"
                  >
                    {waiver.representative_title}
                  </Link>
                  .
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-[11px] text-ink-400">
            If one of these is not actually familiar, lower your experience level in your profile
            and regenerate — the skipped tier comes back.
          </p>
        </div>
      ) : null}

      {analysis.tracks_considered?.length ? (
        <div className="mt-4">
          <p className="section-title mb-1.5">Tracks considered</p>
          <ul className="space-y-1">
            {analysis.tracks_considered.map((track) => (
              <li key={track.track} className="flex items-center gap-2 text-xs">
                <span className="min-w-0 flex-1 truncate text-ink-600">{track.track}</span>
                <span className="w-16 shrink-0">
                  <span className="block h-1.5 overflow-hidden rounded-full bg-ink-100">
                    <span
                      className="block h-full rounded-full bg-accent-400"
                      style={{ width: `${Math.min(100, track.relevance * 100)}%` }}
                    />
                  </span>
                </span>
                <span className="w-8 shrink-0 text-right tabular-nums text-ink-400">
                  {Math.round(track.relevance * 100)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}

/**
 * Path history: archive, reactivate, delete, regenerate.
 *
 * Regeneration exists as an explicit button because the alternative — silently
 * rebuilding the plan whenever the profile changes — would discard progress the
 * learner earned against the old plan without asking.
 */
function PathManager({ paths, activeId, onChanged }) {
  const [confirmDelete, setConfirmDelete] = useState(null)

  // A stale confirmation is a trap: if the list refetches and the row moves, the
  // armed delete button should disarm rather than sit under a different path.
  useEffect(() => {
    setConfirmDelete(null)
  }, [paths])

  const { run: regenerate, pending: regenerating } = useAction(async () => {
    await pathsApi.generate({})
    toast.success('Rebuilt from your current profile and completions')
    onChanged?.()
  })

  async function act(fn, message, pathId) {
    try {
      await fn(pathId)
      toast.success(message)
      onChanged?.()
    } catch (error) {
      toast.error(error.message)
    }
  }

  return (
    <section className="card p-5">
      <h2 className="text-base font-semibold text-ink-900">Your paths</h2>
      <p className="muted mt-0.5">
        Regenerating builds a fresh plan from your current profile and completed courses. Your old
        path is archived, not deleted.
      </p>

      <button
        type="button"
        disabled={regenerating}
        onClick={() => regenerate().catch((error) => toast.error(error.message))}
        className="btn-secondary btn-sm mt-3"
      >
        {regenerating ? <Spinner className="h-3 w-3" /> : <RefreshCw className="h-3 w-3" />}
        Regenerate from my current state
      </button>

      {paths?.length ? (
        <ul className="mt-4 space-y-2">
          {paths.map((path) => (
            <li
              key={path.id}
              className={`rounded-lg border p-3 ${
                path.id === activeId ? 'border-accent-200 bg-accent-50/40' : 'border-ink-200'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink-900">{path.title}</p>
                  <p className="mt-0.5 text-[11px] text-ink-400">
                    v{path.version} · {path.total_courses} steps · {fmt.hours(path.total_hours)} ·{' '}
                    {fmt.date(path.created_at)}
                  </p>
                </div>
                <span className={path.id === activeId ? 'chip-accent' : 'chip'}>
                  {path.id === activeId ? 'active' : path.status}
                </span>
              </div>

              <div className="mt-2 flex flex-wrap gap-1.5">
                {path.id !== activeId ? (
                  <button
                    type="button"
                    onClick={() => act(pathsApi.activate, 'Path activated', path.id)}
                    className="btn-ghost btn-sm"
                  >
                    <CheckCircle2 className="h-3 w-3" /> Make active
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => act(pathsApi.archive, 'Path archived', path.id)}
                    className="btn-ghost btn-sm"
                  >
                    <Archive className="h-3 w-3" /> Archive
                  </button>
                )}
                {confirmDelete === path.id ? (
                  <button
                    type="button"
                    onClick={() => act(pathsApi.remove, 'Path deleted', path.id)}
                    className="btn-danger btn-sm"
                  >
                    <Trash2 className="h-3 w-3" /> Delete permanently
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(path.id)}
                    className="btn-ghost btn-sm text-red-700"
                  >
                    <Trash2 className="h-3 w-3" /> Delete
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}

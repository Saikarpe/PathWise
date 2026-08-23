/**
 * Ranked recommendations, with the ranking model itself on display.
 *
 * The list is the product; the model panel beside it is the argument. Nine factors
 * with personalised weights produce the order, so the panel shows those weights
 * against their defaults — a learner whose "quality" weight has drifted up by four
 * points can see that, and can see which of their own reactions did it. Hiding the
 * weights would leave "personalised" as a marketing word.
 *
 * The goal box overrides the ranking target *without touching the profile*. That
 * separation matters: exploring "what would a path to robotics look like" should
 * not silently rewrite the goal a learner's real path was built from.
 */
import { useState } from 'react'
import toast from 'react-hot-toast'
import {
  CheckCircle2,
  Compass,
  Filter,
  Gauge,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react'

import {
  paths as pathsApi,
  recommendations as recApi,
} from '../api/endpoints'
import { useResource } from '../hooks/useApi'
import { Empty, ErrorState, Loading, SourceBadge, Spinner, fmt } from '../components/ui'
import { CourseCard } from '../components/CourseCard'
import { WhyDrawer } from '../components/WhyDrawer'
import { FACTOR_LABELS, FACTOR_SHORT } from '../components/FactorBar'

export default function Recommendations() {
  const [goalText, setGoalText] = useState('')
  const [draft, setDraft] = useState('')
  const [limit, setLimit] = useState(10)
  const [excludePlanned, setExcludePlanned] = useState(false)
  const [why, setWhy] = useState(null)

  const { data, loading, error, reload } = useResource(
    () =>
      recApi.list({
        goal_text: goalText || null,
        limit,
        exclude_planned: excludePlanned,
      }),
    [goalText, limit, excludePlanned],
  )
  const { data: model, reload: reloadModel } = useResource(() => recApi.model(), [])
  const { data: active } = useResource(() => pathsApi.active(), [])

  const pathId = active?.has_path ? active.id : null

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-ink-900">Recommendations</h1>
        <p className="muted mt-1 max-w-3xl">
          Every course in the catalogue scored against your profile by nine factors, then collapsed
          so three providers selling the same tier of the same track appear as one choice with
          alternatives rather than three separate suggestions.
        </p>
      </header>

      {/* ---- controls ---------------------------------------------------- */}
      <section className="card p-4">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            setGoalText(draft.trim())
          }}
        >
          <div className="min-w-[16rem] flex-1">
            <label className="label" htmlFor="goal-override">
              Rank for a different goal{' '}
              <span className="font-normal normal-case text-ink-400">
                (does not change your profile)
              </span>
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400" />
              <input
                id="goal-override"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                className="input pl-9"
                placeholder={active?.goal_text || 'e.g. I want to move into MLOps'}
              />
            </div>
          </div>

          <div>
            <label className="label" htmlFor="limit">
              How many
            </label>
            <select
              id="limit"
              value={limit}
              onChange={(event) => setLimit(Number(event.target.value))}
              className="input w-24"
            >
              {[5, 10, 20, 30].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>

          <button type="submit" className="btn-primary">
            <Sparkles className="h-4 w-4" /> Rank
          </button>
          {goalText ? (
            <button
              type="button"
              onClick={() => {
                setDraft('')
                setGoalText('')
              }}
              className="btn-ghost"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Back to my goal
            </button>
          ) : null}
        </form>

        <label className="mt-3 inline-flex cursor-pointer items-center gap-2 text-sm text-ink-600">
          <input
            type="checkbox"
            checked={excludePlanned}
            onChange={(event) => setExcludePlanned(event.target.checked)}
            className="h-3.5 w-3.5 rounded border-ink-300 text-accent-600 focus:ring-accent-500"
          />
          <Filter className="h-3.5 w-3.5 text-ink-400" />
          Hide what is already on my path
        </label>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1.55fr,1fr]">
        <div className="min-w-0 space-y-4">
          {data?.goal ? <GoalReadout goal={data.goal} /> : null}

          {loading && !data ? <Loading label="Scoring the catalogue…" /> : null}
          {error ? <ErrorState error={error} onRetry={reload} /> : null}

          {data && !data.results.length ? (
            <Empty icon={Compass} title="Nothing matched that goal">
              Try naming a field or a role — &ldquo;machine learning&rdquo;, &ldquo;power
              systems&rdquo;, &ldquo;become a data analyst&rdquo;.
            </Empty>
          ) : null}

          {data?.results.map((result) => (
            <CourseCard
              key={result.course_id}
              course={result.course}
              rank={result.rank}
              score={result.score}
              drivers={result.explanation?.drivers}
              headline={result.explanation?.headline}
              alternatives={result.alternatives}
              onWhy={() => setWhy(result)}
              actions={
                <MarkDoneButton
                  courseId={result.course_id}
                  pathId={pathId}
                  onDone={() => {
                    reload()
                    reloadModel()
                  }}
                />
              }
            />
          ))}
        </div>

        <div className="space-y-6">
          {model ? <ModelPanel model={model} /> : null}
        </div>
      </div>

      <WhyDrawer
        recommendation={why}
        pathId={pathId}
        onClose={() => {
          setWhy(null)
          // The drawer is where feedback is given, and feedback moves the weights.
          // Refetching the model on close is what makes that visible immediately.
          reloadModel()
        }}
      />
    </div>
  )
}

/** What the ranker took the goal to be — including which layer supplied it. */
function GoalReadout({ goal }) {
  return (
    <div className="card bg-ink-50/70 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">
          Ranking against
        </p>
        <SourceBadge source={goal.source} />
      </div>
      <p className="mt-1 text-sm italic text-ink-700">&ldquo;{goal.text}&rdquo;</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {(goal.tracks ?? []).map((track) => (
          <span key={track.track} className="chip-accent">
            {track.track}
            <span className="tabular-nums opacity-60">{fmt.pct(track.relevance)}</span>
          </span>
        ))}
        {(goal.careers ?? []).map((career) => (
          <span key={career} className="chip-good">
            {career}
          </span>
        ))}
      </div>
    </div>
  )
}

/**
 * "I have already done this."
 *
 * Recording a completion outside the path is the cheapest way for a learner to
 * correct the profile, and it feeds straight back into the gap analysis: the next
 * ranking will not offer the same material again. It needs an active path only
 * because enrollments are filed against one.
 */
function MarkDoneButton({ courseId, pathId, onDone }) {
  const [busy, setBusy] = useState(false)
  if (!pathId) return null

  async function markDone() {
    setBusy(true)
    try {
      const result = await pathsApi.progress(pathId, { course_id: courseId, status: 'completed' })
      toast.success(
        result.adaptation?.explanation || 'Recorded — your skill profile has been updated',
      )
      onDone?.()
    } catch (error) {
      toast.error(error.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <button type="button" disabled={busy} onClick={markDone} className="btn-ghost btn-sm">
      {busy ? <Spinner className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}
      I have done this
    </button>
  )
}

/**
 * The learner's ranking model.
 *
 * Weights are shown as a bar with the default marked, plus the signed delta. That
 * arrangement answers the two real questions — "what does this system currently
 * care about" and "how far has my feedback moved it from stock" — in one glance.
 */
function ModelPanel({ model }) {
  const rows = model.weights ?? []
  const max = Math.max(...rows.map((row) => row.weight), 0.01)

  return (
    <section className="card p-5">
      <div className="flex items-start justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold text-ink-900">
          <SlidersHorizontal className="h-4 w-4 text-accent-600" />
          Your ranking model
        </h2>
        <span className={model.personalised ? 'chip-accent' : 'chip'}>
          {model.personalised ? 'personalised' : 'stock weights'}
        </span>
      </div>
      <p className="muted mt-0.5">
        {model.update_count} feedback event{model.update_count === 1 ? '' : 's'} applied. Reactions
        move weight toward the factors that argued for what you liked, by credit assignment.
      </p>

      <ul className="mt-4 space-y-2.5">
        {rows.map((row) => (
          <li key={row.factor}>
            <div className="flex items-baseline justify-between gap-2">
              <span
                className="truncate text-xs text-ink-700"
                title={FACTOR_LABELS[row.factor] || row.label}
              >
                {FACTOR_SHORT[row.factor] || row.factor}
              </span>
              <span className="shrink-0 text-xs tabular-nums text-ink-500">
                {fmt.pct(row.weight)}
                {Math.abs(row.delta) >= 0.005 ? (
                  <span className={row.delta > 0 ? 'ml-1 text-emerald-700' : 'ml-1 text-red-700'}>
                    {row.delta > 0 ? '+' : ''}
                    {(row.delta * 100).toFixed(1)}
                  </span>
                ) : null}
              </span>
            </div>
            <div className="relative mt-1 h-2 overflow-hidden rounded-full bg-ink-100">
              <div
                className="h-full rounded-full bg-accent-500 transition-all duration-500"
                style={{ width: `${(row.weight / max) * 100}%` }}
              />
              {/* The default, as a tick. Without it the bars are just lengths. */}
              <div
                className="absolute top-0 h-full w-px bg-ink-400"
                style={{ left: `${(row.default / max) * 100}%` }}
                title={`default ${fmt.pct(row.default)}`}
              />
            </div>
            <p className="mt-0.5 text-[11px] text-ink-400">{row.label}</p>
          </li>
        ))}
      </ul>

      <div className="mt-4 border-t border-ink-200 pt-3">
        <p className="flex items-center gap-1.5 text-xs font-medium text-ink-600">
          <Gauge className="h-3 w-3 text-ink-400" />
          Difficulty bias {model.difficulty_bias > 0 ? '+' : ''}
          {Number(model.difficulty_bias).toFixed(2)}
        </p>
        <p className="mt-0.5 text-[11px] text-ink-400">
          {model.difficulty_bias > 0.05
            ? 'You have marked things too easy, so harder tiers are favoured.'
            : model.difficulty_bias < -0.05
              ? 'You have marked things too hard, so gentler tiers are favoured.'
              : 'Neutral — no "too easy" or "too hard" signal yet.'}
        </p>
      </div>

      {model.affinities?.length ? (
        <div className="mt-3">
          <p className="section-title mb-1.5">Learned affinities</p>
          <div className="flex flex-wrap gap-1">
            {model.affinities.slice(0, 12).map((affinity) => (
              <span
                key={affinity.key}
                className={affinity.value > 0 ? 'chip-good text-[11px]' : 'chip-warn text-[11px]'}
                title={`${affinity.value > 0 ? '+' : ''}${affinity.value.toFixed(3)}`}
              >
                {affinity.key}
              </span>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] text-ink-400">
            Tracks, providers and formats your reactions have pushed for or against.
          </p>
        </div>
      ) : null}
    </section>
  )
}

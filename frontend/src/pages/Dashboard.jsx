/**
 * The dashboard.
 *
 * Ordered by what a learner actually needs on opening the app: what to do next,
 * then how far along they are, then what that has built in terms of skill. The
 * headline numbers come last in the visual hierarchy on purpose — "72% complete"
 * is a status report, "start this 6-hour course next" is an instruction.
 *
 * Everything here is one request to /api/dashboard plus one to /api/dashboard/next
 * for the alternatives, because the backend already assembles the cross-cutting
 * view (progress × skills × milestones × pacing) and re-deriving it client-side
 * would be a second, quietly divergent implementation.
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import {
  Activity,
  ArrowRight,
  BarChart3,
  CalendarClock,
  CheckCircle2,
  Clock,
  Flag,
  HelpCircle,
  PlayCircle,
  Radar as RadarIcon,
  Route,
  Sparkles,
  TrendingUp,
} from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { dashboard as dashApi, paths as pathsApi } from '../api/endpoints'
import { useResource } from '../hooks/useApi'
import { useAuth } from '../store/auth'
import { Empty, ErrorState, Loading, Markdownish, ProgressBar, Spinner, Stat, fmt } from '../components/ui'
import { Milestones } from '../components/Milestones'
import { SkillMeterList, SkillRadar } from '../components/SkillMeter'
import { DriverChips } from '../components/FactorBar'
import { WhyDrawer } from '../components/WhyDrawer'

export default function Dashboard() {
  const { user } = useAuth()
  const { data, loading, error, reload } = useResource(() => dashApi.read(), [])
  const { data: nextUp, reload: reloadNext } = useResource(() => dashApi.next(3), [])
  const [why, setWhy] = useState(null)

  function refresh() {
    reload()
    reloadNext()
  }

  if (loading && !data) return <Loading label="Assembling your dashboard…" />
  if (error) return <ErrorState error={error} onRetry={reload} />
  if (!data) return null

  if (!data.has_path) {
    return (
      <Empty
        icon={Route}
        title="You do not have a learning path yet"
        action={
          <Link to="/onboarding" className="btn-primary">
            Build my path <ArrowRight className="h-4 w-4" />
          </Link>
        }
      >
        Describe your goal in your own words and Pathfinder will read it, measure the gap against
        your current skills, and lay out a prerequisite-valid roadmap.
      </Empty>
    )
  }

  const firstName = (user?.full_name || '').split(' ')[0]

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-ink-900">
          {firstName ? `${firstName}, here is where you stand` : 'Where you stand'}
        </h1>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-ink-600">
          <Markdownish text={data.narrative?.headline} />{' '}
          <Markdownish text={data.narrative?.detail} />
        </p>
        {data.narrative?.caveats?.length ? (
          <ul className="mt-2 max-w-3xl space-y-1">
            {data.narrative.caveats.map((caveat, index) => (
              <li
                key={index}
                className="rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-1.5 text-xs text-amber-900"
              >
                <Markdownish text={caveat} />
              </li>
            ))}
          </ul>
        ) : null}
      </header>

      {/* ---- next action, first, because it is the only instruction here ---- */}
      <NextAction
        item={data.next_item}
        alternatives={nextUp?.alternatives ?? []}
        pathId={data.path?.id}
        onProgress={refresh}
        onWhy={setWhy}
      />

      {/* ---- headline numbers -------------------------------------------- */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Path progress"
          value={fmt.pct(data.progress)}
          hint={`${data.completed_courses} of ${data.total_courses} steps complete`}
          tone="accent"
        />
        <Stat
          label="Hours done"
          value={fmt.hours(data.hours_completed)}
          hint={`of ${fmt.hours(data.total_hours)} planned`}
        />
        <Stat
          label="Skills proficient"
          value={data.skills_proficient}
          hint={`${data.skills_in_progress} more in progress`}
          tone="good"
        />
        <Stat
          label="Goal readiness"
          value={fmt.pct(data.readiness_after)}
          hint={`from ${fmt.pct(data.readiness_before)} when this path started`}
          tone="accent"
        />
      </div>

      {/* ---- pacing ------------------------------------------------------ */}
      <section className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold text-ink-900">
              <CalendarClock className="h-4 w-4 text-accent-600" />
              Pacing
            </h2>
            <p className="muted mt-0.5">
              Week {Math.max(1, Math.round(data.weeks_elapsed || 0))} of{' '}
              {data.path?.estimated_weeks} at {data.weekly_hours}h/week.
            </p>
          </div>
          <PaceBadge weeksBehind={data.weeks_behind} />
        </div>

        <ProgressBar value={data.progress} className="mt-4" showLabel />

        {data.phases?.length ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {data.phases.map((phase) => (
              <div key={phase.index} className="rounded-lg border border-ink-200 p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="truncate text-xs font-semibold uppercase tracking-wide text-ink-500">
                    {phase.name}
                  </p>
                  <span className="shrink-0 text-xs tabular-nums text-ink-400">
                    {phase.completed}/{phase.total}
                  </span>
                </div>
                <ProgressBar
                  value={phase.progress}
                  className="mt-2"
                  tone={phase.progress >= 1 ? 'good' : 'accent'}
                />
                <p className="mt-1.5 text-[11px] tabular-nums text-ink-400">
                  {fmt.hours(phase.hours_done)} of {fmt.hours(phase.hours)}
                </p>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <div className="grid gap-6 lg:grid-cols-[1.25fr,1fr]">
        {/* ---- weekly activity ------------------------------------------ */}
        <section className="card p-5">
          <h2 className="flex items-center gap-2 text-base font-semibold text-ink-900">
            <Activity className="h-4 w-4 text-accent-600" />
            Learning pattern
          </h2>
          <p className="muted mt-0.5">
            Hours logged per week. This is what the planner uses to judge whether the schedule you
            set is the schedule you keep.
          </p>
          <ActivityChart activity={data.activity} weeklyHours={data.weekly_hours} />
        </section>

        {/* ---- milestones ----------------------------------------------- */}
        <section className="card p-5">
          <h2 className="flex items-center gap-2 text-base font-semibold text-ink-900">
            <Flag className="h-4 w-4 text-accent-600" />
            Milestones
          </h2>
          <p className="muted mt-0.5">
            {data.next_milestone
              ? `Next: ${data.next_milestone.title} in week ${data.next_milestone.target_week}.`
              : 'Every milestone on this path is achieved.'}
          </p>
          <Milestones milestones={data.milestones} className="mt-4" />
        </section>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ---- skills ---------------------------------------------------- */}
        <section className="card p-5">
          <h2 className="flex items-center gap-2 text-base font-semibold text-ink-900">
            <TrendingUp className="h-4 w-4 text-accent-600" />
            Skill development
          </h2>
          <p className="muted mt-0.5">
            Derived from what you have completed — saturating, so the fifth course on a skill adds
            less than the first — and merged with anything you self-rated.
          </p>
          <SkillMeterList skills={data.skill_levels} limit={9} className="mt-4" />
          <Link to="/profile" className="btn-ghost btn-sm mt-4">
            Adjust self-ratings <ArrowRight className="h-3 w-3" />
          </Link>
        </section>

        <section className="card p-5">
          <h2 className="flex items-center gap-2 text-base font-semibold text-ink-900">
            <RadarIcon className="h-4 w-4 text-accent-600" />
            Competency shape
          </h2>
          <p className="muted mt-0.5">
            Your strongest measured skills. A good path changes this shape, not just its size.
          </p>
          <SkillRadar skills={data.skill_levels} />
        </section>
      </div>

      {/* ---- footer strip: goal + model provenance ---------------------- */}
      <section className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-ink-900">{data.path?.title}</h2>
            <p className="muted mt-0.5 max-w-2xl">
              Goal as read: <span className="italic">&ldquo;{data.path?.goal_text}&rdquo;</span>
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {(data.path?.tracks ?? []).map((track) => (
                <span key={track} className="chip-accent">
                  {track}
                </span>
              ))}
            </div>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-xs text-ink-400">
              Version {data.path?.version} · created {fmt.date(data.path?.created_at)}
            </p>
            <p className="text-xs text-ink-400">
              {data.feedback_count} feedback event{data.feedback_count === 1 ? '' : 's'} applied to
              your ranking model
            </p>
            <Link to="/roadmap" className="btn-secondary btn-sm mt-2">
              Open full roadmap <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        </div>
      </section>

      <WhyDrawer
        recommendation={why}
        pathId={data.path?.id}
        onClose={() => {
          setWhy(null)
          reloadNext()
        }}
      />
    </div>
  )
}

/**
 * The next step, plus the runners-up.
 *
 * Marking progress from here rather than only on the roadmap matters because this
 * is the page a returning learner opens. The backend responds to a progress POST
 * with a recomputed dashboard *and* an `adaptation` note, and the toast surfaces
 * that note — a plan that silently reshapes itself is indistinguishable from one
 * that never adapts.
 */
function NextAction({ item, alternatives, pathId, onProgress, onWhy }) {
  const [busy, setBusy] = useState(null)

  if (!item) {
    return (
      <section className="card border-emerald-200 bg-emerald-50/50 p-5">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
          <div>
            <h2 className="text-base font-semibold text-emerald-900">
              Every step on this path is done
            </h2>
            <p className="mt-1 text-sm text-emerald-800">
              Set a new goal in the assistant and the next path will start from the skills this one
              gave you.
            </p>
            <Link to="/chat" className="btn-primary btn-sm mt-3">
              <Sparkles className="h-3 w-3" /> Set a new goal
            </Link>
          </div>
        </div>
      </section>
    )
  }

  async function mark(status) {
    if (!pathId || !item.course_id) return
    setBusy(status)
    try {
      const result = await pathsApi.progress(pathId, {
        course_id: item.course_id,
        status,
        // progress_pct is a 0–100 percentage server-side, and `completed` is
        // forced to 100 there along with the hours, so only "started" needs one.
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
    <section className="card border-accent-200 bg-accent-50/40 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-accent-700">
            Do this next
          </p>
          <h2 className="mt-1 text-lg font-semibold text-ink-900">
            {item.course_id ? (
              <Link
                to={`/courses/${encodeURIComponent(item.course_id)}`}
                className="hover:text-accent-700 hover:underline"
              >
                {item.title}
              </Link>
            ) : (
              item.title
            )}
          </h2>
          <p className="mt-1 text-sm text-ink-600">
            <Markdownish text={item.rationale} />
          </p>
          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-500">
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" /> {fmt.hours(item.hours)}
            </span>
            <span className="chip">{item.phase_name}</span>
            <span className="chip">{item.item_type}</span>
          </div>
          {item.skills?.length ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {item.skills.slice(0, 6).map((skill) => (
                <span key={skill} className="chip-accent text-[11px]">
                  {skill}
                </span>
              ))}
            </div>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-col gap-2">
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={() => mark('in_progress')}
            className="btn-primary btn-sm"
          >
            {busy === 'in_progress' ? <Spinner className="h-3 w-3" /> : <PlayCircle className="h-3 w-3" />}
            Start this
          </button>
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={() => mark('completed')}
            className="btn-secondary btn-sm"
          >
            {busy === 'completed' ? <Spinner className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}
            Mark complete
          </button>
        </div>
      </div>

      {alternatives.length ? (
        <div className="mt-4 border-t border-accent-200/70 pt-3">
          <p className="text-xs font-medium text-ink-600">
            If that one does not appeal, these ranked next
          </p>
          <ul className="mt-2 space-y-2">
            {alternatives.map((alt) => (
              <li
                key={alt.course?.course_id}
                className="rounded-lg border border-ink-200 bg-white p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      to={`/courses/${encodeURIComponent(alt.course.course_id)}`}
                      className="block truncate text-sm font-medium text-ink-900 hover:text-accent-700 hover:underline"
                    >
                      {alt.course.title}
                    </Link>
                    <p className="mt-0.5 text-xs text-ink-500">
                      <Markdownish text={alt.headline} />
                    </p>
                    <DriverChips drivers={alt.drivers} className="mt-1.5" />
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      onWhy({
                        course: alt.course,
                        score: alt.score,
                        explanation: { headline: alt.headline, drivers: alt.drivers },
                      })
                    }
                    className="btn-ghost btn-sm shrink-0"
                  >
                    <HelpCircle className="h-3 w-3" /> Why
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}

/** Behind / on track / ahead, stated plainly rather than left for the learner to infer. */
function PaceBadge({ weeksBehind }) {
  const behind = Number(weeksBehind) || 0
  if (behind > 0.5) {
    return (
      <span className="chip-warn">
        <Clock className="h-3 w-3" />
        {behind.toFixed(1)} week{behind >= 2 ? 's' : ''} behind schedule
      </span>
    )
  }
  if (behind < -0.5) {
    return (
      <span className="chip-good">
        <TrendingUp className="h-3 w-3" />
        {Math.abs(behind).toFixed(1)} weeks ahead
      </span>
    )
  }
  return (
    <span className="chip-good">
      <CheckCircle2 className="h-3 w-3" /> On track
    </span>
  )
}

/**
 * Weekly hours as bars, with the learner's committed budget drawn as a reference.
 *
 * The comparison is the content: bars alone say "you studied", bars against the
 * budget say "you studied less than you planned to", which is the thing that
 * explains a slipping schedule.
 */
function ActivityChart({ activity = [], weeklyHours }) {
  if (!activity.length) {
    return (
      <p className="py-10 text-center text-sm text-ink-500">
        No hours logged yet. Marking a step started or complete records time here.
      </p>
    )
  }

  const data = activity.map((row) => ({
    week: typeof row.week === 'string' ? row.week.slice(5) : row.week,
    hours: Number(row.hours) || 0,
  }))
  const peak = Math.max(weeklyHours || 0, ...data.map((row) => row.hours))

  return (
    <div className="mt-4">
      <div style={{ height: 220 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
            <CartesianGrid stroke="#eceef2" vertical={false} />
            <XAxis
              dataKey="week"
              tick={{ fontSize: 10, fill: '#8994a8' }}
              axisLine={{ stroke: '#e2e6ee' }}
              tickLine={false}
            />
            <YAxis
              domain={[0, Math.ceil(peak * 1.15)]}
              tick={{ fontSize: 10, fill: '#8994a8' }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              contentStyle={{
                borderRadius: 10,
                border: '1px solid #e2e6ee',
                fontSize: 12,
              }}
              formatter={(value) => [`${value}h`, 'logged']}
            />
            <Bar dataKey="hours" fill="#3565f5" radius={[4, 4, 0, 0]} maxBarSize={28} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-1 flex items-center gap-1.5 text-[11px] text-ink-400">
        <BarChart3 className="h-3 w-3" />
        Your committed budget is {weeklyHours}h/week — bars below that line are why a plan slips.
      </p>
    </div>
  )
}

/**
 * One course, in the context of the graph it sits in.
 *
 * A course page in a recommender is usually a product page. This one is a position
 * in a prerequisite ladder: the chain that leads to it, the courses that unlock it,
 * what it unlocks, and the same-rung variants from other providers. That framing is
 * the point — the reason a learner should trust "do this next" is that they can see
 * what it comes after.
 *
 * Semantic neighbours come from the LSA space and are explicitly *not* personalised,
 * so they are labelled as similarity rather than as a recommendation. Conflating the
 * two would make the ranked list look arbitrary by comparison.
 */
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock,
  Layers,
  Lock,
  PlayCircle,
  Sparkles,
  Star,
  Target,
  Users,
} from 'lucide-react'

import {
  catalog as catalogApi,
  paths as pathsApi,
  recommendations as recApi,
} from '../api/endpoints'
import { useResource } from '../hooks/useApi'
import { ErrorState, Loading, Spinner, StatusChip, fmt } from '../components/ui'

export default function CourseDetail() {
  const { courseId } = useParams()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(null)

  const { data, loading, error, reload } = useResource(
    () => catalogApi.course(courseId),
    [courseId],
  )
  const { data: neighbours } = useResource(() => recApi.similar(courseId, 6), [courseId])
  const { data: active } = useResource(() => pathsApi.active(), [])

  if (loading && !data) return <Loading label="Loading course…" />
  if (error) return <ErrorState error={error} onRetry={reload} />
  if (!data) return null

  const course = data.course
  const pathId = active?.has_path ? active.id : null
  const onPath = (active?.items ?? []).find((item) => item.course_id === courseId)

  async function mark(status) {
    if (!pathId) {
      toast.error('Create a learning path first — progress is recorded against one.')
      return
    }
    setBusy(status)
    try {
      const result = await pathsApi.progress(pathId, {
        course_id: courseId,
        status,
        progress_pct: status === 'in_progress' ? 10 : undefined,
      })
      toast.success(result.adaptation?.explanation || `Marked ${status.replace('_', ' ')}`)
      reload()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-6">
      <button type="button" onClick={() => navigate(-1)} className="btn-ghost btn-sm">
        <ArrowLeft className="h-3 w-3" /> Back
      </button>

      <header className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs text-ink-500">
              {course.branch} · {course.track}
            </p>
            <h1 className="mt-1 text-xl font-semibold text-ink-900">{course.title}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-500">
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3 w-3" /> {fmt.hours(course.hours)}
              </span>
              <span className="inline-flex items-center gap-1">
                <Star className="h-3 w-3" /> {fmt.rating(course.rating)}
                <span className="text-ink-400">({fmt.int(course.num_reviews)} reviews)</span>
              </span>
              <span className="inline-flex items-center gap-1">
                <Users className="h-3 w-3" /> {course.provider}
              </span>
              <span className="chip">{course.difficulty}</span>
              <span className="chip">{course.format}</span>
              {data.rung ? <span className="chip">tier {data.rung.tier}</span> : null}
            </div>
          </div>

          <div className="flex shrink-0 flex-col items-end gap-2">
            <StatusChip status={data.status} />
            {onPath ? (
              <span className="chip-accent">
                on your path · {onPath.phase_name}, step {onPath.order_index + 1}
              </span>
            ) : null}
            <div className="flex gap-2">
              {data.status !== 'in_progress' && data.status !== 'completed' ? (
                <button
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() => mark('in_progress')}
                  className="btn-primary btn-sm"
                >
                  {busy === 'in_progress' ? (
                    <Spinner className="h-3 w-3" />
                  ) : (
                    <PlayCircle className="h-3 w-3" />
                  )}
                  Start
                </button>
              ) : null}
              {data.status !== 'completed' ? (
                <button
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() => mark('completed')}
                  className="btn-secondary btn-sm"
                >
                  {busy === 'completed' ? (
                    <Spinner className="h-3 w-3" />
                  ) : (
                    <CheckCircle2 className="h-3 w-3" />
                  )}
                  Mark complete
                </button>
              ) : null}
            </div>
          </div>
        </div>

        <p className="prose-tight mt-4 text-sm leading-relaxed text-ink-600">
          {course.description}
        </p>

        {onPath?.rationale ? (
          <p className="mt-3 rounded-lg border border-accent-200 bg-accent-50/50 p-3 text-sm text-accent-900">
            <strong className="font-semibold">Why it is on your path: </strong>
            {onPath.rationale}
          </p>
        ) : null}
      </header>

      <div className="grid gap-6 lg:grid-cols-[1.5fr,1fr]">
        <div className="min-w-0 space-y-6">
          {/* ---- the ladder this course sits on ------------------------- */}
          {data.prerequisite_chain?.length ? (
            <section className="card p-5">
              <h2 className="flex items-center gap-2 text-base font-semibold text-ink-900">
                <Layers className="h-4 w-4 text-accent-600" />
                Where this sits
              </h2>
              <p className="muted mt-0.5">
                The prerequisite ladder for this track, tier by tier. This course is at tier{' '}
                {data.rung?.tier}.
              </p>
              <ol className="mt-3 flex flex-wrap items-center gap-1.5">
                {data.prerequisite_chain.map((rung, index) => (
                  <li key={`${rung.track}-${rung.tier}`} className="flex items-center gap-1.5">
                    <span
                      className={
                        rung.tier === data.rung?.tier ? 'chip-active' : 'chip'
                      }
                    >
                      tier {rung.tier}
                    </span>
                    {index < data.prerequisite_chain.length - 1 ? (
                      <ArrowRight className="h-3 w-3 text-ink-300" />
                    ) : null}
                  </li>
                ))}
              </ol>
            </section>
          ) : null}

          {data.prerequisites?.length ? (
            <CourseList
              title="Do these first"
              icon={Lock}
              subtitle="Representative courses from the tier immediately below. Any one of them satisfies the prerequisite."
              courses={data.prerequisites}
            />
          ) : (
            <section className="card p-5">
              <h2 className="flex items-center gap-2 text-base font-semibold text-ink-900">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                No prerequisites
              </h2>
              <p className="muted mt-0.5">
                This is an entry point for its track — you can start here.
              </p>
            </section>
          )}

          {data.follow_ons?.length ? (
            <CourseList
              title="What this unlocks"
              icon={ArrowRight}
              subtitle="The next tier of the same track becomes available once you finish here."
              courses={data.follow_ons}
            />
          ) : null}
        </div>

        <div className="space-y-6">
          {course.skills?.length ? (
            <section className="card p-5">
              <h2 className="flex items-center gap-2 text-base font-semibold text-ink-900">
                <Target className="h-4 w-4 text-accent-600" />
                Skills taught
              </h2>
              <div className="mt-3 flex flex-wrap gap-1">
                {course.skills.map((skill) => (
                  <span key={skill} className="chip-accent text-[11px]">
                    {skill}
                  </span>
                ))}
              </div>
              {course.tools?.length ? (
                <>
                  <p className="section-title mb-1.5 mt-4">Tools</p>
                  <div className="flex flex-wrap gap-1">
                    {course.tools.map((tool) => (
                      <span key={tool} className="chip text-[11px]">
                        {tool}
                      </span>
                    ))}
                  </div>
                </>
              ) : null}
              {course.career_paths?.length ? (
                <>
                  <p className="section-title mb-1.5 mt-4">Careers it feeds</p>
                  <div className="flex flex-wrap gap-1">
                    {course.career_paths.map((career) => (
                      <span key={career} className="chip-good text-[11px]">
                        {career}
                      </span>
                    ))}
                  </div>
                </>
              ) : null}
              {course.industry_sectors?.length ? (
                <>
                  <p className="section-title mb-1.5 mt-4">Sectors</p>
                  <div className="flex flex-wrap gap-1">
                    {course.industry_sectors.map((sector) => (
                      <span key={sector} className="chip text-[11px]">
                        {sector}
                      </span>
                    ))}
                  </div>
                </>
              ) : null}
            </section>
          ) : null}

          {data.alternatives?.length ? (
            <section className="card p-5">
              <h2 className="text-base font-semibold text-ink-900">Same level, other providers</h2>
              <p className="muted mt-0.5">
                Identical rung in the prerequisite graph — swapping to one of these changes nothing
                about the plan's validity.
              </p>
              <ul className="mt-3 space-y-2">
                {data.alternatives.map((alt) => (
                  <li key={alt.course_id}>
                    <Link
                      to={`/courses/${encodeURIComponent(alt.course_id)}`}
                      className="block rounded-lg border border-ink-200 p-2.5 transition hover:border-accent-300 hover:bg-accent-50/40"
                    >
                      <p className="truncate text-sm font-medium text-ink-900">{alt.title}</p>
                      <p className="mt-0.5 text-[11px] tabular-nums text-ink-500">
                        {alt.provider} · {fmt.hours(alt.hours)} · {fmt.rating(alt.rating)}★ ·{' '}
                        {alt.format}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {neighbours?.similar?.length ? (
            <section className="card p-5">
              <h2 className="flex items-center gap-2 text-base font-semibold text-ink-900">
                <Sparkles className="h-4 w-4 text-accent-600" />
                Semantically similar
              </h2>
              <p className="muted mt-0.5">
                Nearest neighbours in the LSA space. Content similarity only — not personalised to
                you, and not a recommendation.
              </p>
              <ul className="mt-3 space-y-2">
                {neighbours.similar.map((row) => (
                  <li key={row.course.course_id} className="flex items-start justify-between gap-2">
                    <Link
                      to={`/courses/${encodeURIComponent(row.course.course_id)}`}
                      className="min-w-0 text-xs text-ink-700 hover:text-accent-700 hover:underline"
                    >
                      <span className="block truncate font-medium">{row.course.title}</span>
                      <span className="block truncate text-ink-400">{row.course.track}</span>
                    </Link>
                    <span className="shrink-0 text-[11px] tabular-nums text-ink-400">
                      {fmt.pct(row.similarity)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function CourseList({ title, subtitle, icon: Icon, courses }) {
  return (
    <section className="card p-5">
      <h2 className="flex items-center gap-2 text-base font-semibold text-ink-900">
        <Icon className="h-4 w-4 text-accent-600" />
        {title}
      </h2>
      {subtitle ? <p className="muted mt-0.5">{subtitle}</p> : null}
      <ul className="mt-3 space-y-2">
        {courses.map((course) => (
          <li key={course.course_id}>
            <Link
              to={`/courses/${encodeURIComponent(course.course_id)}`}
              className="block rounded-lg border border-ink-200 p-3 transition hover:border-accent-300 hover:bg-accent-50/40"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink-900">{course.title}</p>
                  <p className="mt-0.5 truncate text-xs text-ink-500">
                    {course.track} · {course.difficulty}
                  </p>
                </div>
                <span className="shrink-0 text-[11px] tabular-nums text-ink-500">
                  {fmt.hours(course.hours)} · {fmt.rating(course.rating)}★
                </span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * The "Why this?" drawer.
 *
 * This is the AI assistant's explanation surface, and it is deliberately built
 * from the same numbers that produced the ranking rather than from a separate
 * narrative about it: the headline is assembled from the top contributions, the
 * bars *are* the contributions, and the caveats are the factors that scored badly.
 * Nothing here is decorative — if the drawer and the ranking ever disagreed, the
 * ranking would be the thing that changed.
 *
 * It doubles as the feedback surface. Reacting to a recommendation returns the
 * before/after ranking weights from the backend, which are rendered immediately:
 * adaptation the learner cannot see is indistinguishable from no adaptation.
 */
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import {
  ArrowDown,
  ArrowUp,
  Ban,
  Gauge,
  Lock,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  X,
} from 'lucide-react'

import { recommendations as recApi } from '../api/endpoints'
import { FACTOR_SHORT, FactorAttribution } from './FactorBar'
import { Markdownish, Spinner, fmt } from './ui'

const REACTIONS = [
  { event: 'like', label: 'Useful', icon: ThumbsUp },
  { event: 'not_relevant', label: 'Not relevant', icon: Ban },
  { event: 'too_easy', label: 'Too easy', icon: ArrowDown },
  { event: 'too_hard', label: 'Too hard', icon: ArrowUp },
  { event: 'dislike', label: 'Dislike', icon: ThumbsDown },
]

/**
 * @param {object} props
 * @param {object|null} props.recommendation A ranked result, or a path-item explain payload.
 * @param {function} props.onClose
 * @param {number|null} props.pathId Attached to feedback so the event is traceable to a path.
 * @param {boolean} props.allowFeedback
 */
export function WhyDrawer({ recommendation, onClose, pathId = null, allowFeedback = true }) {
  const [adaptation, setAdaptation] = useState(null)
  const [sending, setSending] = useState(null)

  // Escape closes. The drawer covers the ranked list it was opened from, so a
  // keyboard user needs a way back that does not involve hunting for the ✕.
  useEffect(() => {
    if (!recommendation) return undefined
    const onKey = (event) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [recommendation, onClose])

  useEffect(() => {
    setAdaptation(null)
  }, [recommendation?.course?.course_id, recommendation?.item?.id])

  if (!recommendation) return null

  const course = recommendation.course || {}
  const explanation = recommendation.explanation || {}
  const contributions =
    recommendation.contributions || explanation.evidence?.contributions || recommendation.item?.factors || {}
  const factors = recommendation.factors || explanation.evidence?.factors || {}
  const covers = recommendation.covers_skills || explanation.evidence?.covers_skills || []
  const missing =
    recommendation.missing_prerequisites || explanation.evidence?.missing_prerequisites || []
  const courseId = course.course_id || recommendation.item?.course_id || null

  async function react(event) {
    if (!courseId) return
    setSending(event)
    try {
      const result = await recApi.feedback({
        event_type: event,
        course_id: courseId,
        path_id: pathId,
        factors: Object.keys(contributions).length ? contributions : null,
      })
      setAdaptation(result)
      toast.success('Learner model updated')
    } catch (error) {
      toast.error(error.message)
    } finally {
      setSending(null)
    }
  }

  const movedWeights = adaptation
    ? Object.entries(adaptation.weight_deltas || {})
        .filter(([, delta]) => Math.abs(delta) >= 0.0005)
        .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
        .slice(0, 5)
    : []

  return (
    <>
      <button
        type="button"
        aria-label="Close explanation"
        onClick={onClose}
        className="fixed inset-0 z-30 bg-ink-950/25 backdrop-blur-[1px]"
      />
      <aside
        className="fixed right-0 top-0 z-40 flex h-full w-full max-w-md flex-col
                   border-l border-ink-200 bg-white shadow-2xl animate-slide-in"
        role="dialog"
        aria-modal="true"
        aria-label="Why this recommendation"
      >
        <header className="flex items-start gap-3 border-b border-ink-200 p-4">
          <div className="mt-0.5 rounded-lg bg-accent-50 p-2">
            <Sparkles className="h-4 w-4 text-accent-600" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-accent-700">
              Why this?
            </p>
            <h2 className="truncate text-sm font-semibold text-ink-900" title={course.title}>
              {course.title || recommendation.item?.title || 'This step'}
            </h2>
          </div>
          <button type="button" onClick={onClose} className="btn-ghost btn-sm" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto p-4">
          <section>
            <p className="text-sm font-medium text-ink-900">
              <Markdownish text={explanation.headline} />
            </p>
            {explanation.detail ? (
              <p className="prose-tight mt-2 text-sm leading-relaxed text-ink-600">
                <Markdownish text={explanation.detail} />
              </p>
            ) : null}
          </section>

          {Object.keys(contributions).length ? (
            <section>
              <h3 className="section-title mb-2 flex items-center gap-1.5">
                <Gauge className="h-3.5 w-3.5 text-ink-400" />
                Score breakdown
              </h3>
              <FactorAttribution contributions={contributions} factors={factors} />
              {recommendation.score !== undefined ? (
                <p className="mt-2 text-xs text-ink-400">
                  Final score {Number(recommendation.score).toFixed(3)} — a weighted sum of the
                  nine factors above, with weights personalised to you.
                </p>
              ) : null}
            </section>
          ) : null}

          {covers.length ? (
            <section>
              <h3 className="section-title mb-2">Skill gaps this closes</h3>
              <div className="flex flex-wrap gap-1.5">
                {covers.map((skill) => (
                  <span key={skill} className="chip-good">
                    {skill}
                  </span>
                ))}
              </div>
            </section>
          ) : null}

          {missing.length ? (
            <section>
              <h3 className="section-title mb-2 flex items-center gap-1.5">
                <Lock className="h-3.5 w-3.5 text-amber-600" />
                Prerequisites not yet met
              </h3>
              <ul className="space-y-1 text-sm text-ink-600">
                {missing.map((id) => (
                  <li key={id} className="font-mono text-xs">
                    {id}
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 text-xs text-ink-400">
                Not a rejection — the planner simply orders these first.
              </p>
            </section>
          ) : null}

          {explanation.caveats?.length ? (
            <section>
              <h3 className="section-title mb-2">Caveats</h3>
              <ul className="space-y-1.5">
                {explanation.caveats.map((caveat, index) => (
                  <li
                    key={index}
                    className="rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-sm text-amber-900"
                  >
                    <Markdownish text={caveat} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {allowFeedback && courseId ? (
            <section className="border-t border-ink-200 pt-4">
              <h3 className="section-title mb-1">Was this a good call?</h3>
              <p className="mb-2.5 text-xs text-ink-500">
                Your reaction re-weights the factors above for every future ranking.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {REACTIONS.map(({ event, label, icon: Icon }) => (
                  <button
                    key={event}
                    type="button"
                    disabled={Boolean(sending)}
                    onClick={() => react(event)}
                    className="btn-secondary btn-sm"
                  >
                    {sending === event ? (
                      <Spinner className="h-3 w-3" />
                    ) : (
                      <Icon className="h-3 w-3" />
                    )}
                    {label}
                  </button>
                ))}
              </div>

              {adaptation ? (
                <div className="mt-3 rounded-lg border border-accent-200 bg-accent-50/60 p-3 animate-fade-up">
                  <p className="text-sm text-accent-900">{adaptation.explanation}</p>
                  {movedWeights.length ? (
                    <ul className="mt-2 space-y-1">
                      {movedWeights.map(([factor, delta]) => (
                        <li
                          key={factor}
                          className="flex items-center justify-between text-xs tabular-nums"
                        >
                          <span className="text-ink-600">{FACTOR_SHORT[factor] || factor}</span>
                          <span
                            className={delta > 0 ? 'text-emerald-700' : 'text-red-700'}
                          >
                            {delta > 0 ? '+' : ''}
                            {(delta * 100).toFixed(2)} pts →{' '}
                            {fmt.pct(adaptation.weights_after?.[factor] ?? 0)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-xs text-accent-800/80">
                      No factor moved measurably — this reaction agreed with the current model.
                    </p>
                  )}
                  <p className="mt-2 text-[11px] text-accent-800/70">
                    Update #{adaptation.update_count} · difficulty bias{' '}
                    {Number(adaptation.difficulty_bias).toFixed(2)}
                  </p>
                </div>
              ) : null}
            </section>
          ) : null}
        </div>
      </aside>
    </>
  )
}

export default WhyDrawer

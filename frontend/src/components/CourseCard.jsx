/**
 * A course, as it appears in a ranked list.
 *
 * Two things are load-bearing. First, the rank badge and the driver chips are
 * shown *before* the description: a learner scanning ten results is deciding
 * between them, and "closes 4 skill gaps" is more decisive than a marketing
 * paragraph. Second, provider variants collapse into an `alternatives` disclosure
 * — three providers selling the same tier of the same track is one choice, not
 * three recommendations, and flattening them would push real options off the list.
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, Clock, HelpCircle, Layers, Star, Users } from 'lucide-react'

import { DriverChips } from './FactorBar'
import { Markdownish, StatusChip, fmt } from './ui'

export function CourseCard({
  course,
  rank,
  score,
  drivers = [],
  headline,
  alternatives = [],
  status,
  onWhy,
  onSelect,
  actions,
  compact = false,
}) {
  const [showAlternatives, setShowAlternatives] = useState(false)
  if (!course) return null

  return (
    <article className="card card-hover p-4">
      <div className="flex items-start gap-3">
        {rank ? (
          <span
            className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent-50
                       text-xs font-semibold tabular-nums text-accent-700"
            title={score !== undefined ? `score ${Number(score).toFixed(3)}` : undefined}
          >
            {rank}
          </span>
        ) : null}

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="truncate font-medium text-ink-900">
                <Link
                  to={`/courses/${encodeURIComponent(course.course_id)}`}
                  className="hover:text-accent-700 hover:underline"
                  onClick={onSelect}
                >
                  {course.title}
                </Link>
              </h3>
              <p className="mt-0.5 truncate text-xs text-ink-500">
                {course.track} · {course.branch}
              </p>
            </div>
            {status ? <StatusChip status={status} /> : null}
          </div>

          {headline ? (
            <p className="mt-2 text-sm text-ink-700">
              <Markdownish text={headline} />
            </p>
          ) : null}

          <DriverChips drivers={drivers} className="mt-2" />

          {!compact && course.description ? (
            <p className="mt-2 line-clamp-2 text-sm text-ink-500">{course.description}</p>
          ) : null}

          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-500">
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" /> {fmt.hours(course.hours)}
            </span>
            <span className="inline-flex items-center gap-1">
              <Star className="h-3 w-3" /> {fmt.rating(course.rating)}
              <span className="text-ink-400">({fmt.int(course.num_reviews)})</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <Users className="h-3 w-3" /> {course.provider}
            </span>
            <span className="chip">{course.difficulty}</span>
            <span className="chip">{course.format}</span>
          </div>

          {course.skills?.length ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {course.skills.slice(0, 5).map((skill) => (
                <span key={skill} className="chip text-[11px]">
                  {skill}
                </span>
              ))}
              {course.skills.length > 5 ? (
                <span className="text-[11px] text-ink-400">
                  +{course.skills.length - 5} more
                </span>
              ) : null}
            </div>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {onWhy ? (
              <button type="button" onClick={onWhy} className="btn-secondary btn-sm">
                <HelpCircle className="h-3 w-3" /> Why this?
              </button>
            ) : null}
            {actions}
            {alternatives.length ? (
              <button
                type="button"
                onClick={() => setShowAlternatives((open) => !open)}
                className="btn-ghost btn-sm"
              >
                <Layers className="h-3 w-3" />
                {alternatives.length} same-level alternative
                {alternatives.length === 1 ? '' : 's'}
                <ChevronDown
                  className={`h-3 w-3 transition ${showAlternatives ? 'rotate-180' : ''}`}
                />
              </button>
            ) : null}
          </div>

          {showAlternatives ? (
            <ul className="mt-2 space-y-1.5 rounded-lg border border-ink-200 bg-ink-50/60 p-2 animate-fade-up">
              <li className="px-1 text-[11px] text-ink-500">
                Same track and tier, different provider — pick whichever suits you.
              </li>
              {alternatives.map((alt) => (
                <li key={alt.course_id} className="flex items-center justify-between gap-2 px-1">
                  <Link
                    to={`/courses/${encodeURIComponent(alt.course_id)}`}
                    className="min-w-0 truncate text-xs text-ink-700 hover:text-accent-700 hover:underline"
                  >
                    {alt.title}
                  </Link>
                  <span className="shrink-0 text-[11px] tabular-nums text-ink-500">
                    {alt.provider} · {fmt.hours(alt.hours)} · {fmt.rating(alt.rating)}★
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </article>
  )
}

export default CourseCard

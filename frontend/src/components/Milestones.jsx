/**
 * Milestones as a vertical timeline.
 *
 * A milestone is achieved when *all* its required courses are complete, so the
 * partial count (`required_met` / `required_total`) is shown rather than a
 * percentage: "2 of 3 courses" is actionable, "67%" is not. The dashboard payload
 * and the path payload name these fields differently (`title` vs `name`,
 * `required_met` vs a computed `achieved`), so both shapes are accepted — the
 * alternative is two nearly identical components.
 */
import { CheckCircle2, Circle, Flag } from 'lucide-react'

export function Milestones({ milestones = [], className = '' }) {
  if (!milestones.length) {
    return (
      <p className="text-sm text-ink-500">
        No milestones yet — they are generated with your learning path.
      </p>
    )
  }

  return (
    <ol className={`relative space-y-4 ${className}`}>
      {/* The spine. Inset to pass through the centre of the markers. */}
      <span className="absolute left-[9px] top-2 bottom-2 w-px bg-ink-200" aria-hidden="true" />

      {milestones.map((milestone, index) => {
        const title = milestone.title || milestone.name
        const total = milestone.required_total ?? milestone.required_course_ids?.length ?? 0
        const met = milestone.required_met ?? (milestone.achieved ? total : 0)
        const achieved = Boolean(milestone.achieved)
        const nextUp = !achieved && milestones.slice(0, index).every((m) => m.achieved)

        return (
          <li key={milestone.id ?? `${title}-${index}`} className="relative pl-8">
            <span className="absolute left-0 top-0.5 bg-white">
              {achieved ? (
                <CheckCircle2 className="h-[19px] w-[19px] text-emerald-500" />
              ) : nextUp ? (
                <Flag className="h-[19px] w-[19px] text-accent-500" />
              ) : (
                <Circle className="h-[19px] w-[19px] text-ink-300" />
              )}
            </span>

            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <p
                className={`text-sm font-medium ${
                  achieved ? 'text-emerald-800' : 'text-ink-900'
                }`}
              >
                {title}
              </p>
              <span className="chip text-[11px]">week {milestone.target_week}</span>
              {achieved ? (
                <span className="chip-good text-[11px]">achieved</span>
              ) : nextUp ? (
                <span className="chip-accent text-[11px]">next up</span>
              ) : null}
            </div>

            {milestone.description ? (
              <p className="mt-1 text-sm text-ink-500">{milestone.description}</p>
            ) : null}

            {total ? (
              <p className="mt-1 text-xs tabular-nums text-ink-400">
                {met} of {total} required course{total === 1 ? '' : 's'} complete
              </p>
            ) : null}

            {milestone.skills_unlocked?.length ? (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {milestone.skills_unlocked.slice(0, 6).map((skill) => (
                  <span key={skill} className={achieved ? 'chip-good' : 'chip'}>
                    {skill}
                  </span>
                ))}
              </div>
            ) : null}
          </li>
        )
      })}
    </ol>
  )
}

export default Milestones

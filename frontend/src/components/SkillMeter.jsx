/**
 * Skill development, drawn two ways.
 *
 * `SkillMeter` is the per-skill bar. `SkillRadar` is the shape of the learner's
 * competency across their strongest skills — useful because a learning path is
 * supposed to *change that shape*, and a list of numbers does not make the shape
 * legible. Both read the same `skill_levels` payload from the dashboard.
 *
 * The proficiency threshold (0.6) is the backend's PROFICIENT_THRESHOLD; the bar
 * marks it so "in progress" and "proficient" are visually distinct rather than
 * two shades of the same thing.
 */
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
} from 'recharts'

import { fmt } from './ui'

const PROFICIENT = 0.6

export function SkillMeter({ skill, proficiency, declared = false }) {
  const value = Math.max(0, Math.min(1, Number(proficiency) || 0))
  const proficient = value >= PROFICIENT
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-sm text-ink-700" title={skill}>
          {skill}
          {declared ? (
            <span className="ml-1 text-[10px] uppercase tracking-wide text-ink-400">
              self-rated
            </span>
          ) : null}
        </span>
        <span
          className={`shrink-0 text-xs tabular-nums ${
            proficient ? 'text-emerald-700' : 'text-ink-500'
          }`}
        >
          {fmt.pct(value)}
        </span>
      </div>
      <div className="relative mt-1 h-2 overflow-hidden rounded-full bg-ink-100">
        <div
          className={`h-full rounded-full transition-all duration-700 ${
            proficient ? 'bg-emerald-500' : 'bg-accent-400'
          }`}
          style={{ width: `${value * 100}%` }}
        />
        {/* The proficiency line, so the bar has a meaning and not just a length. */}
        <div
          className="absolute top-0 h-full w-px bg-ink-300"
          style={{ left: `${PROFICIENT * 100}%` }}
          title={`Proficient at ${fmt.pct(PROFICIENT)}`}
        />
      </div>
    </div>
  )
}

export function SkillMeterList({ skills = [], limit = 10, className = '' }) {
  const rows = skills.slice(0, limit)
  if (!rows.length) {
    return (
      <p className="text-sm text-ink-500">
        No measured skills yet. Completing a course, or self-rating in your profile, populates this.
      </p>
    )
  }
  return (
    <div className={`space-y-3 ${className}`}>
      {rows.map((row) => (
        <SkillMeter
          key={row.skill}
          skill={row.skill}
          proficiency={row.proficiency}
          declared={row.declared}
        />
      ))}
    </div>
  )
}

export function SkillRadar({ skills = [], height = 260 }) {
  // Six to eight axes is where a radar stays readable; more and the labels
  // collide, fewer and it degenerates into a triangle that implies nothing.
  const data = skills.slice(0, 8).map((row) => ({
    skill: row.skill.length > 16 ? `${row.skill.slice(0, 15)}…` : row.skill,
    value: Math.round((Number(row.proficiency) || 0) * 100),
  }))

  if (data.length < 3) {
    return (
      <p className="py-8 text-center text-sm text-ink-500">
        The competency radar needs at least three measured skills.
      </p>
    )
  }

  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={data} outerRadius="72%">
          <PolarGrid stroke="#e2e6ee" />
          <PolarAngleAxis dataKey="skill" tick={{ fontSize: 11, fill: '#61708c' }} />
          <PolarRadiusAxis domain={[0, 100]} tick={{ fontSize: 9, fill: '#aeb7c8' }} />
          <Radar
            name="Proficiency"
            dataKey="value"
            stroke="#2148e2"
            fill="#3565f5"
            fillOpacity={0.22}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  )
}

export default SkillMeterList

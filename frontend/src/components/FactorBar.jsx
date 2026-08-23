/**
 * Factor attribution: the nine-factor score, drawn.
 *
 * The backend returns `contributions` — each factor's share of the final score,
 * summing to ~1.0 — alongside the raw `factors` values. Both are shown, because
 * they answer different questions: the share says *why this course won*, the raw
 * value says *how good it actually is on that dimension*. A course can be ranked
 * mostly by goal_fit while still scoring poorly on it, and hiding that would make
 * the explanation flattering rather than true.
 */
import { fmt } from './ui'

/** Mirrors FACTOR_LABELS in backend/app/ml/ranker.py. */
export const FACTOR_LABELS = {
  goal_fit: 'matches your stated goal',
  skill_gain: 'closes open skill gaps',
  level_fit: 'suits your current level',
  quality: 'well rated by other learners',
  prereq_ready: 'prerequisites already met',
  effort_fit: 'fits your weekly time budget',
  format_pref: 'in a format you prefer',
  provider_pref: 'from a provider you prefer',
  affinity: "similar to what you've liked",
}

/** Short names, for axis labels where the sentence form is too long. */
export const FACTOR_SHORT = {
  goal_fit: 'Goal fit',
  skill_gain: 'Skill gain',
  level_fit: 'Level fit',
  quality: 'Quality',
  prereq_ready: 'Prereqs',
  effort_fit: 'Effort fit',
  format_pref: 'Format',
  provider_pref: 'Provider',
  affinity: 'Affinity',
}

/** Display order matches FACTORS in the ranker, so two cards are comparable. */
export const FACTOR_ORDER = [
  'goal_fit',
  'skill_gain',
  'level_fit',
  'quality',
  'prereq_ready',
  'effort_fit',
  'format_pref',
  'provider_pref',
  'affinity',
]

export function FactorBar({ factor, share, value, max = 1 }) {
  const sharePct = Math.max(0, Math.min(100, (Number(share) || 0) * 100))
  // Bars are scaled against the largest share in the set, not against 100%. The
  // top factor rarely exceeds 40% of a score, so absolute scaling would render
  // every bar as a stub and the comparison — which is the whole point — would be
  // invisible.
  const width = max > 0 ? (sharePct / (max * 100)) * 100 : 0
  return (
    <div className="grid grid-cols-[7rem,1fr,3.5rem] items-center gap-2">
      <span className="truncate text-xs text-ink-600" title={FACTOR_LABELS[factor] || factor}>
        {FACTOR_SHORT[factor] || factor}
      </span>
      <div className="h-2 overflow-hidden rounded-full bg-ink-100">
        <div
          className="h-full rounded-full bg-accent-500 transition-all duration-500"
          style={{ width: `${width}%` }}
        />
      </div>
      <span className="text-right text-xs tabular-nums text-ink-500">
        {sharePct.toFixed(0)}%
        {value !== undefined ? (
          <span className="ml-1 text-ink-300" title="raw factor value">
            ·{(Number(value) || 0).toFixed(2)}
          </span>
        ) : null}
      </span>
    </div>
  )
}

/**
 * The full attribution table for one recommendation.
 *
 * `contributions` is the source of truth for ordering; `factors` is looked up per
 * key for the raw value. Factors contributing under 1% are dropped — they are
 * real but they are noise, and nine rows of which four are "0%" reads as padding.
 */
export function FactorAttribution({ contributions = {}, factors = {}, limit = 9, className = '' }) {
  const rows = Object.entries(contributions)
    .filter(([, share]) => Number(share) >= 0.01)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)

  if (!rows.length) return null
  const max = rows[0][1]
  const total = rows.reduce((sum, [, share]) => sum + Number(share), 0)

  return (
    <div className={`space-y-1.5 ${className}`}>
      {rows.map(([factor, share]) => (
        <FactorBar
          key={factor}
          factor={factor}
          share={share}
          value={factors[factor]}
          max={max}
        />
      ))}
      <p className="pt-1 text-[11px] text-ink-400">
        Shares of the final score, largest first — {fmt.pct(total)} of the score shown.
        The small grey number is the raw factor value.
      </p>
    </div>
  )
}

/**
 * The engine's one-line drivers list, as chips.
 *
 * `drivers` comes back as `[{factor: "matches your stated goal", share: 0.31}]` —
 * already label text, not a key, because the explainer resolves labels server-side.
 */
export function DriverChips({ drivers = [], className = '' }) {
  if (!drivers.length) return null
  return (
    <div className={`flex flex-wrap gap-1.5 ${className}`}>
      {drivers.slice(0, 4).map((driver, index) => (
        <span key={`${driver.factor}-${index}`} className={index === 0 ? 'chip-accent' : 'chip'}>
          {driver.factor}
          <span className="tabular-nums opacity-60">{fmt.pct(driver.share)}</span>
        </span>
      ))}
    </div>
  )
}

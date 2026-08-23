/**
 * Shared presentational primitives.
 *
 * Kept in one file because each is a handful of lines and they are always
 * imported together; twelve one-component files would be more ceremony than the
 * components deserve. Anything with real behaviour (the roadmap graph, the why
 * drawer, the chat) lives on its own.
 */
import { AlertTriangle, Inbox, Loader2, RefreshCw } from 'lucide-react'

export function Spinner({ className = 'w-4 h-4' }) {
  return <Loader2 className={`animate-spin ${className}`} aria-hidden="true" />
}

export function Loading({ label = 'Loading…', className = 'py-12' }) {
  return (
    <div className={`flex flex-col items-center justify-center gap-2 text-ink-400 ${className}`}>
      <Spinner className="w-6 h-6" />
      <p className="text-sm">{label}</p>
    </div>
  )
}

/**
 * An error the learner can act on.
 *
 * Shows the backend's own message rather than a generic apology: the API writes
 * messages like "Could not match that goal to a track. Try naming a field or
 * role…", which is more useful than anything this component could invent.
 */
export function ErrorState({ error, onRetry, className = '' }) {
  const message = error?.message || 'Something went wrong.'
  return (
    <div className={`card border-red-200 bg-red-50/60 p-4 ${className}`}>
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-red-900">{message}</p>
          {error?.status ? (
            <p className="text-xs text-red-700/80 mt-0.5">HTTP {error.status}</p>
          ) : null}
        </div>
        {onRetry ? (
          <button type="button" onClick={onRetry} className="btn-secondary btn-sm shrink-0">
            <RefreshCw className="w-3 h-3" /> Retry
          </button>
        ) : null}
      </div>
    </div>
  )
}

export function Empty({ icon: Icon = Inbox, title, children, action }) {
  return (
    <div className="card p-8 text-center">
      <Icon className="w-8 h-8 mx-auto text-ink-300" />
      <p className="mt-3 font-medium text-ink-800">{title}</p>
      {children ? <p className="mt-1 text-sm text-ink-500 max-w-md mx-auto">{children}</p> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  )
}

export function Card({ as: Tag = 'div', className = '', children, ...rest }) {
  return (
    <Tag className={`card ${className}`} {...rest}>
      {children}
    </Tag>
  )
}

export function SectionHeader({ title, subtitle, action, className = '' }) {
  return (
    <div className={`flex items-start justify-between gap-4 ${className}`}>
      <div className="min-w-0">
        <h2 className="text-base font-semibold text-ink-900">{title}</h2>
        {subtitle ? <p className="muted mt-0.5">{subtitle}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}

/** A single headline number. `hint` is for the unit or the denominator. */
export function Stat({ label, value, hint, tone = 'default' }) {
  const tones = {
    default: 'text-ink-900',
    accent: 'text-accent-700',
    good: 'text-emerald-700',
    warn: 'text-amber-700',
  }
  return (
    <div className="card p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${tones[tone] ?? tones.default}`}>
        {value}
      </p>
      {hint ? <p className="text-xs text-ink-400 mt-0.5">{hint}</p> : null}
    </div>
  )
}

export function ProgressBar({ value, className = '', tone = 'accent', showLabel = false }) {
  const pct = Math.max(0, Math.min(100, Math.round((Number(value) || 0) * 100)))
  const tones = { accent: 'bg-accent-500', good: 'bg-emerald-500', warn: 'bg-amber-500' }
  return (
    <div className={className}>
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-ink-200"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={`h-full rounded-full transition-all duration-500 ${tones[tone] ?? tones.accent}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {showLabel ? <p className="mt-1 text-xs tabular-nums text-ink-500">{pct}%</p> : null}
    </div>
  )
}

const STATUS_STYLES = {
  completed: 'chip-good',
  in_progress: 'chip-accent',
  not_started: 'chip',
  abandoned: 'chip-warn',
}
const STATUS_LABELS = {
  completed: 'Completed',
  in_progress: 'In progress',
  not_started: 'Not started',
  abandoned: 'Paused',
}

export function StatusChip({ status }) {
  return (
    <span className={STATUS_STYLES[status] ?? 'chip'}>
      {STATUS_LABELS[status] ?? status}
    </span>
  )
}

/**
 * Renders the engine's `*emphasis*` markers.
 *
 * The local explainer writes plain text with asterisk emphasis around the bits
 * that carry the argument — a course title, a percentage. Rendering them as
 * literal asterisks would look like a bug, and running a markdown parser over
 * server text would be a needless XSS surface, so this handles exactly the one
 * construct that is actually produced.
 */
export function Markdownish({ text, className = '' }) {
  if (!text) return null
  const parts = String(text).split(/(\*[^*]+\*)/g)
  return (
    <span className={className}>
      {parts.map((part, index) =>
        part.startsWith('*') && part.endsWith('*') && part.length > 2 ? (
          <strong key={index} className="font-semibold text-ink-900">
            {part.slice(1, -1)}
          </strong>
        ) : (
          part
        ),
      )}
    </span>
  )
}

/** Local-vs-Claude provenance. Shown because "which layer wrote this" is a claim. */
export function SourceBadge({ source }) {
  const claude = source === 'claude' || source === 'llm'
  return (
    <span
      className={claude ? 'chip-accent' : 'chip'}
      title={
        claude
          ? 'This prose was written by Claude. The ranking underneath it is local.'
          : 'Written by the local explainer — no API key needed. Ranking is local too.'
      }
    >
      {claude ? 'Claude' : 'local'}
    </span>
  )
}

export const fmt = {
  hours: (value) => `${Math.round(Number(value) || 0)}h`,
  pct: (value) => `${Math.round((Number(value) || 0) * 100)}%`,
  rating: (value) => (Number(value) || 0).toFixed(1),
  int: (value) => new Intl.NumberFormat('en-US').format(Math.round(Number(value) || 0)),
  date: (value) => {
    if (!value) return '—'
    const date = new Date(value)
    return Number.isNaN(date.getTime())
      ? '—'
      : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  },
}

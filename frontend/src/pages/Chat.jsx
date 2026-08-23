/**
 * The assistant page.
 *
 * The chat is not a help widget bolted onto the app — it is a second, equal way to
 * drive it. "I want to move into MLOps instead" replans; "why is Kubernetes in
 * there?" explains; "I finished the Docker course" records progress. So the rail
 * beside it mirrors the current path state and refetches whenever a turn reports a
 * `path_id`: a conversation that changes your plan while the panel next to it shows
 * the old plan teaches the learner not to trust either.
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Flag, MessageSquare, Route, Sparkles, Wand2 } from 'lucide-react'

import { dashboard as dashApi, paths as pathsApi } from '../api/endpoints'
import { useResource } from '../hooks/useApi'
import { ChatPanel } from '../components/ChatPanel'
import { Markdownish, ProgressBar, fmt } from '../components/ui'

const CAPABILITIES = [
  ['Set or change a goal', '"Actually I want to go into robotics instead"'],
  ['Refine the plan', '"Make it shorter" · "I only have 4 hours a week"'],
  ['Ask why', '"Why is linear algebra before the ML course?"'],
  ['Report progress', '"I finished the Python course"'],
  ['Give feedback', '"That last recommendation was too easy"'],
]

export default function Chat() {
  const [version, setVersion] = useState(0)

  const { data: active } = useResource(() => pathsApi.active(), [version])
  const { data: next } = useResource(() => dashApi.next(1), [version])

  return (
    <div className="grid gap-6 lg:grid-cols-[1.5fr,1fr]">
      <div className="min-w-0">
        <header className="mb-4">
          <h1 className="text-xl font-semibold text-ink-900">Learning assistant</h1>
          <p className="muted mt-1">
            Plain language in, real changes out. Each reply shows the intent it was read as, the
            confidence, and whether the prose came from Claude or the local templates.
          </p>
        </header>

        <ChatPanel onPathChanged={() => setVersion((value) => value + 1)} />
      </div>

      <aside className="space-y-6">
        <section className="card p-5">
          <h2 className="flex items-center gap-2 text-base font-semibold text-ink-900">
            <Wand2 className="h-4 w-4 text-accent-600" />
            What it can actually do
          </h2>
          <ul className="mt-3 space-y-2.5">
            {CAPABILITIES.map(([what, example]) => (
              <li key={what}>
                <p className="text-sm font-medium text-ink-800">{what}</p>
                <p className="mt-0.5 text-xs italic text-ink-500">{example}</p>
              </li>
            ))}
          </ul>
          <p className="mt-3 rounded-lg border border-ink-200 bg-ink-50/70 p-2.5 text-[11px] text-ink-500">
            Intent classification, goal parsing and every ranking decision run locally. An{' '}
            <code className="mx-1 font-mono">ANTHROPIC_API_KEY</code> only changes how the reply is
            worded — never what it decides.
          </p>
        </section>

        {active?.has_path ? (
          <section className="card p-5">
            <h2 className="flex items-center gap-2 text-base font-semibold text-ink-900">
              <Route className="h-4 w-4 text-accent-600" />
              Your current path
            </h2>
            <p className="mt-1 truncate text-sm font-medium text-ink-800">{active.title}</p>
            <p className="muted mt-0.5">
              v{active.version} · {active.total_courses} steps · {fmt.hours(active.total_hours)} ·{' '}
              {active.estimated_weeks} weeks
            </p>
            <ProgressBar
              value={
                active.items?.length
                  ? active.items.filter((item) => item.status === 'completed').length /
                    active.items.length
                  : 0
              }
              className="mt-3"
              showLabel
            />

            {next?.next_item ? (
              <div className="mt-4 rounded-lg border border-accent-200 bg-accent-50/50 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-accent-700">
                  Next step
                </p>
                <p className="mt-0.5 text-sm font-medium text-ink-900">{next.next_item.title}</p>
                <p className="mt-0.5 text-xs text-ink-600">
                  <Markdownish text={next.next_item.rationale} />
                </p>
              </div>
            ) : null}

            {next?.next_milestone ? (
              <p className="mt-3 flex items-start gap-1.5 text-xs text-ink-500">
                <Flag className="mt-0.5 h-3 w-3 shrink-0 text-accent-500" />
                Next milestone: {next.next_milestone.title} (week {next.next_milestone.target_week})
              </p>
            ) : null}

            <Link to="/roadmap" className="btn-secondary btn-sm mt-4">
              Open the roadmap <ArrowRight className="h-3 w-3" />
            </Link>
          </section>
        ) : (
          <section className="card p-5">
            <h2 className="flex items-center gap-2 text-base font-semibold text-ink-900">
              <MessageSquare className="h-4 w-4 text-accent-600" />
              No path yet
            </h2>
            <p className="muted mt-1">
              Tell the assistant what you want to be able to do and it will build one in this
              conversation — no form required.
            </p>
            <Link to="/onboarding" className="btn-ghost btn-sm mt-3">
              <Sparkles className="h-3 w-3" /> Or use the guided wizard
            </Link>
          </section>
        )}
      </aside>
    </div>
  )
}

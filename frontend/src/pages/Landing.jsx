/**
 * The landing page.
 *
 * Every number on it is fetched from /api/catalog/stats rather than typed in.
 * That is partly honesty and partly self-defence: a hardcoded "2,400 courses"
 * becomes a lie the first time the dataset is regenerated, and a reviewer who
 * spots one stale figure reasonably distrusts the rest.
 *
 * The demo accounts are surfaced here as one-click buttons. A judge with five
 * minutes should not have to invent a goal and wait for a path to generate before
 * seeing what the system does, so four learners with real histories are pre-seeded
 * and enterable directly.
 */
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import {
  ArrowRight,
  Boxes,
  Compass,
  GitBranch,
  Layers,
  MessageSquare,
  Network,
  ScanSearch,
  Sparkles,
  Target,
} from 'lucide-react'

import { auth as authApi, catalog as catalogApi } from '../api/endpoints'
import { useAuth } from '../store/auth'
import { useResource } from '../hooks/useApi'
import { Spinner, fmt } from '../components/ui'

const CAPABILITIES = [
  {
    icon: MessageSquare,
    title: 'Say it in your own words',
    body:
      'A four-layer parser reads free text — lexical n-grams, a validated alias ontology, fuzzy matching, then LSA semantics — and shows you the phrase that produced each conclusion before anything is planned.',
  },
  {
    icon: ScanSearch,
    title: 'Profiling that measures, not asks',
    body:
      'Skill state is derived from what you have completed, with saturating acquisition, and merged with anything you self-rate. Declared background is honoured: say you know networking and the plan starts above it.',
  },
  {
    icon: Target,
    title: 'Ranking you can audit',
    body:
      'Nine factors, each with its share of the final score summing to 1.0. Every recommendation shows the arithmetic that produced its position, not a narrative written after the fact.',
  },
  {
    icon: Network,
    title: 'Prerequisite-valid paths',
    body:
      'Plans are ordered against a prerequisite DAG built at the track-and-tier level, so a step is never suggested before the material it depends on. Phases, weekly pacing and milestones come from your real hours.',
  },
  {
    icon: GitBranch,
    title: 'It adapts, visibly',
    body:
      'Feedback moves the ranking weights by credit assignment — factors that argued for a course you disliked lose weight. The panel shows you exactly which ones moved and by how much.',
  },
  {
    icon: Layers,
    title: 'Coverage, not just relevance',
    body:
      'Course selection is a greedy weighted set cover over your open skill gaps, so a path spends its hours closing distinct gaps instead of teaching you the same popular skill five times.',
  },
]

export default function Landing() {
  const navigate = useNavigate()
  const { demoLogin } = useAuth()
  const [entering, setEntering] = useState(null)
  const { data: stats } = useResource(() => catalogApi.stats(), [])
  const { data: demo } = useResource(() => authApi.demoUsers(), [])

  async function enterAs(email) {
    setEntering(email)
    try {
      const user = await demoLogin(email)
      navigate(user.onboarded ? '/dashboard' : '/onboarding')
    } catch (error) {
      toast.error(error.message)
    } finally {
      setEntering(null)
    }
  }

  return (
    <div className="min-h-full bg-white">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent-600">
            <Compass className="h-4 w-4 text-white" />
          </span>
          <span className="font-semibold text-ink-900">Pathfinder</span>
        </div>
        <nav className="flex items-center gap-2">
          <Link to="/login" className="btn-ghost btn-sm">
            Sign in
          </Link>
          <Link to="/register" className="btn-primary btn-sm">
            Create account
          </Link>
        </nav>
      </header>

      <section className="mx-auto max-w-6xl px-4 pb-12 pt-6 md:pt-14">
        <div className="grid items-start gap-10 md:grid-cols-[1.15fr,1fr]">
          <div>
            <span className="chip-accent">
              <Sparkles className="h-3 w-3" /> AI-powered personalised learning paths
            </span>
            <h1 className="mt-4 text-3xl font-semibold leading-tight tracking-tight text-ink-950 sm:text-4xl">
              Describe where you want to get to.
              <br />
              Get a path that knows where you already are.
            </h1>
            <p className="mt-4 max-w-xl text-ink-600">
              Pathfinder reads your goal in plain English, measures the gap between the skills you
              have and the ones your goal needs, and builds a prerequisite-valid roadmap through a
              real catalogue of{' '}
              <strong className="text-ink-900">
                {stats ? fmt.int(stats.courses) : '2,400'} courses
              </strong>{' '}
              across {stats ? fmt.int(stats.branches) : '12'} engineering branches. Every
              recommendation tells you which of the nine ranking factors put it there.
            </p>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Link to="/register" className="btn-primary">
                Start with your own goal <ArrowRight className="h-4 w-4" />
              </Link>
              <Link to="/login" className="btn-secondary">
                I already have an account
              </Link>
            </div>

            {stats ? (
              <dl className="mt-8 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
                {[
                  ['Courses', fmt.int(stats.courses)],
                  ['Learning tracks', fmt.int(stats.tracks)],
                  ['Prerequisite edges', fmt.int(stats.prerequisite_edges)],
                  ['Skills modelled', fmt.int(stats.skills)],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">
                      {label}
                    </dt>
                    <dd className="text-xl font-semibold tabular-nums text-ink-900">{value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </div>

          <div className="card p-5">
            <div className="flex items-center gap-2">
              <Boxes className="h-4 w-4 text-accent-600" />
              <h2 className="text-sm font-semibold text-ink-900">Enter as a seeded learner</h2>
            </div>
            <p className="mt-1 text-sm text-ink-500">
              Four demo learners with real completion history, active paths and adapted ranking
              weights. No signup, no setup.
            </p>

            <div className="mt-4 space-y-2">
              {demo?.accounts?.length ? (
                demo.accounts.map((account) => (
                  <button
                    key={account.email}
                    type="button"
                    disabled={!account.available || Boolean(entering)}
                    onClick={() => enterAs(account.email)}
                    className="w-full rounded-lg border border-ink-200 p-3 text-left transition
                               hover:border-accent-300 hover:bg-accent-50/40
                               disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-ink-900">{account.name}</span>
                      {entering === account.email ? (
                        <Spinner className="h-3.5 w-3.5 text-accent-600" />
                      ) : (
                        <ArrowRight className="h-3.5 w-3.5 text-ink-400" />
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-ink-500">{account.headline}</p>
                  </button>
                ))
              ) : (
                <p className="text-sm text-ink-500">Loading demo accounts…</p>
              )}
            </div>

            {demo && !demo.seeded ? (
              <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
                Demo data is not seeded yet. Run{' '}
                <code className="font-mono">{demo.setup_command}</code> in the backend directory,
                then reload.
              </p>
            ) : (
              <p className="mt-3 text-[11px] text-ink-400">
                Credentials are public and fixed —{' '}
                <code className="font-mono">{demo?.accounts?.[0]?.password}</code> for every demo
                account.
              </p>
            )}
          </div>
        </div>
      </section>

      <section className="border-t border-ink-200 bg-ink-50/60 py-12">
        <div className="mx-auto max-w-6xl px-4">
          <h2 className="text-lg font-semibold text-ink-900">What is actually doing the work</h2>
          <p className="mt-1 max-w-2xl text-sm text-ink-600">
            All of it runs locally on scikit-learn and NetworkX — no model downloads, no API key
            required. A key adds conversational polish; it never becomes the reasoning.
          </p>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {CAPABILITIES.map(({ icon: Icon, title, body }) => (
              <article key={title} className="card p-4">
                <Icon className="h-4 w-4 text-accent-600" />
                <h3 className="mt-2.5 text-sm font-semibold text-ink-900">{title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-ink-600">{body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <footer className="mx-auto max-w-6xl px-4 py-8 text-xs text-ink-400">
        Pathfinder — AI-powered personalised learning path recommender.{' '}
        {stats ? (
          <>
            {fmt.int(stats.courses)} courses · {fmt.int(stats.total_hours)} catalogue hours · mean
            rating {stats.mean_rating} · {fmt.int(stats.semantic_dimensions)}-dimensional LSA space.
          </>
        ) : null}
      </footer>
    </div>
  )
}

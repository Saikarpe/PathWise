/**
 * Sign in.
 *
 * The demo buttons are repeated here rather than only on the landing page,
 * because this is where someone lands when a session expires or a shared link
 * bounces them — and at that moment "I do not have an account" is the most likely
 * state, not the least.
 */
import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { ArrowRight, Compass } from 'lucide-react'

import { auth as authApi } from '../api/endpoints'
import { useAuth } from '../store/auth'
import { useAction, useResource } from '../hooks/useApi'
import { ErrorState, Spinner } from '../components/ui'

export default function Login() {
  const navigate = useNavigate()
  const location = useLocation()
  const { login, demoLogin } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [entering, setEntering] = useState(null)
  const { data: demo } = useResource(() => authApi.demoUsers(), [])

  const destination = location.state?.from?.pathname
  const { run: submit, pending, error } = useAction(async () => {
    const user = await login(email.trim(), password)
    navigate(user.onboarded ? destination || '/dashboard' : '/onboarding', { replace: true })
  })

  async function enterAs(account) {
    setEntering(account.email)
    try {
      const user = await demoLogin(account.email)
      navigate(user.onboarded ? '/dashboard' : '/onboarding', { replace: true })
    } catch (err) {
      toast.error(err.message)
    } finally {
      setEntering(null)
    }
  }

  return (
    <div className="grid min-h-full place-items-center bg-ink-50 px-4 py-10">
      <div className="w-full max-w-sm">
        <Link to="/" className="mb-6 flex items-center justify-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-accent-600">
            <Compass className="h-4.5 w-4.5 text-white" />
          </span>
          <span className="text-lg font-semibold text-ink-900">Pathfinder</span>
        </Link>

        <div className="card p-6">
          <h1 className="text-lg font-semibold text-ink-900">Welcome back</h1>
          <p className="mt-1 text-sm text-ink-500">
            Sign in to pick up your path where you left it.
          </p>

          <form
            className="mt-5 space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              submit().catch(() => {})
            }}
          >
            <div>
              <label className="label" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="input"
                placeholder="you@example.com"
              />
            </div>
            <div>
              <label className="label" htmlFor="password">
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="input"
                placeholder="••••••••"
              />
            </div>

            {error ? <ErrorState error={error} /> : null}

            <button type="submit" disabled={pending} className="btn-primary w-full">
              {pending ? <Spinner /> : null} Sign in
            </button>
          </form>

          <p className="mt-4 text-center text-sm text-ink-500">
            No account?{' '}
            <Link to="/register" className="font-medium text-accent-700 hover:underline">
              Create one
            </Link>
          </p>
        </div>

        {demo?.accounts?.length ? (
          <div className="mt-4 card p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">
              Or enter as a demo learner
            </p>
            <div className="mt-2 space-y-1.5">
              {demo.accounts.map((account) => (
                <button
                  key={account.email}
                  type="button"
                  disabled={!account.available || Boolean(entering)}
                  onClick={() => enterAs(account)}
                  className="flex w-full items-center justify-between gap-2 rounded-lg border
                             border-ink-200 px-3 py-2 text-left text-sm transition
                             hover:border-accent-300 hover:bg-accent-50/40
                             disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className="min-w-0">
                    <span className="block font-medium text-ink-900">{account.name}</span>
                    <span className="block truncate text-xs text-ink-500">{account.headline}</span>
                  </span>
                  {entering === account.email ? (
                    <Spinner className="h-3.5 w-3.5 shrink-0 text-accent-600" />
                  ) : (
                    <ArrowRight className="h-3.5 w-3.5 shrink-0 text-ink-400" />
                  )}
                </button>
              ))}
            </div>
            {!demo.seeded ? (
              <p className="mt-2 text-[11px] text-amber-800">
                Not seeded — run <code className="font-mono">{demo.setup_command}</code>.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}

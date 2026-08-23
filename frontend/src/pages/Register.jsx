/**
 * Create an account.
 *
 * Password rules are checked client-side *and* by the backend (min_length=8 on
 * RegisterRequest). The duplication is deliberate: the client check exists to give
 * an instant answer, the server check exists because the client one is advice.
 */
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Check, Compass, X } from 'lucide-react'

import { useAuth } from '../store/auth'
import { useAction } from '../hooks/useApi'
import { ErrorState, Spinner } from '../components/ui'

export default function Register() {
  const navigate = useNavigate()
  const { register } = useAuth()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')

  const longEnough = password.length >= 8
  const matches = Boolean(confirm) && password === confirm
  const canSubmit = longEnough && matches && email.includes('@')

  const { run: submit, pending, error } = useAction(async () => {
    await register(email.trim(), password, fullName.trim())
    // Straight to onboarding: a new account has no goal, so every other page
    // would be empty and the wizard is the only useful destination.
    navigate('/onboarding', { replace: true })
  })

  return (
    <div className="grid min-h-full place-items-center bg-ink-50 px-4 py-10">
      <div className="w-full max-w-sm">
        <Link to="/" className="mb-6 flex items-center justify-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-accent-600">
            <Compass className="h-4 w-4 text-white" />
          </span>
          <span className="text-lg font-semibold text-ink-900">Pathfinder</span>
        </Link>

        <div className="card p-6">
          <h1 className="text-lg font-semibold text-ink-900">Create your account</h1>
          <p className="mt-1 text-sm text-ink-500">
            Next you will describe your goal in your own words, and we will build the path from it.
          </p>

          <form
            className="mt-5 space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              submit().catch(() => {})
            }}
          >
            <div>
              <label className="label" htmlFor="fullName">
                Name <span className="font-normal normal-case text-ink-400">(optional)</span>
              </label>
              <input
                id="fullName"
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                className="input"
                placeholder="Ada Lovelace"
                autoComplete="name"
              />
            </div>
            <div>
              <label className="label" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
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
                required
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="input"
                placeholder="At least 8 characters"
              />
            </div>
            <div>
              <label className="label" htmlFor="confirm">
                Confirm password
              </label>
              <input
                id="confirm"
                type="password"
                required
                autoComplete="new-password"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                className="input"
              />
            </div>

            <ul className="space-y-1 text-xs">
              <Rule ok={longEnough}>At least 8 characters</Rule>
              <Rule ok={matches}>Both passwords match</Rule>
            </ul>

            {error ? <ErrorState error={error} /> : null}

            <button type="submit" disabled={pending || !canSubmit} className="btn-primary w-full">
              {pending ? <Spinner /> : null} Create account
            </button>
          </form>

          <p className="mt-4 text-center text-sm text-ink-500">
            Already registered?{' '}
            <Link to="/login" className="font-medium text-accent-700 hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}

function Rule({ ok, children }) {
  return (
    <li className={`flex items-center gap-1.5 ${ok ? 'text-emerald-700' : 'text-ink-400'}`}>
      {ok ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
      {children}
    </li>
  )
}

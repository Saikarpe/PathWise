/**
 * The authenticated shell: nav, engine status, and the outlet.
 *
 * The engine's health is polled once on mount and shown in the footer — courses,
 * prerequisite rungs, semantic dimensions, and whether the LLM layer is on. That
 * is not decoration: this project's central claim is that the reasoning is local
 * and the LLM is optional, and a reviewer should be able to see which mode they
 * are looking at without reading the source.
 */
import { useState } from 'react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  Compass,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  Route,
  Search,
  Sparkles,
  UserCog,
  X,
} from 'lucide-react'

import { meta as metaApi } from '../api/endpoints'
import { useAuth } from '../store/auth'
import { useResource } from '../hooks/useApi'
import { fmt } from './ui'

const NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/roadmap', label: 'Roadmap', icon: Route },
  { to: '/recommendations', label: 'Recommendations', icon: Sparkles },
  { to: '/chat', label: 'Assistant', icon: MessageSquare },
  { to: '/explore', label: 'Explore', icon: Search },
  { to: '/profile', label: 'Profile', icon: UserCog },
]

export function Layout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const { data: health } = useResource(() => metaApi.health(), [])

  const engine = health?.engine ?? {}

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-20 border-b border-ink-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3">
          <Link to="/dashboard" className="flex shrink-0 items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent-600">
              <Compass className="h-4 w-4 text-white" />
            </span>
            <span className="hidden text-sm font-semibold text-ink-900 sm:block">Pathfinder</span>
          </Link>

          <nav className="hidden flex-1 items-center gap-1 md:flex">
            {NAV.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  `inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition ${
                    isActive
                      ? 'bg-accent-50 font-medium text-accent-800'
                      : 'text-ink-600 hover:bg-ink-100 hover:text-ink-900'
                  }`
                }
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <div className="hidden text-right sm:block">
              <p className="text-xs font-medium text-ink-900">
                {user?.full_name || user?.email?.split('@')[0]}
              </p>
              <p className="text-[11px] text-ink-400">
                {user?.experience_level} · {user?.weekly_hours}h/wk
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                logout()
                navigate('/')
              }}
              className="btn-ghost btn-sm"
              title="Sign out"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Sign out</span>
            </button>
            <button
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              className="btn-ghost btn-sm md:hidden"
              aria-label="Toggle navigation"
            >
              {menuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {menuOpen ? (
          <nav className="border-t border-ink-200 px-4 py-2 md:hidden">
            {NAV.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                onClick={() => setMenuOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
                    isActive ? 'bg-accent-50 font-medium text-accent-800' : 'text-ink-700'
                  }`
                }
              >
                <Icon className="h-4 w-4" />
                {label}
              </NavLink>
            ))}
          </nav>
        ) : null}
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
        <Outlet />
      </main>

      <footer className="border-t border-ink-200 bg-white">
        <div
          className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-1
                     px-4 py-3 text-[11px] text-ink-400"
        >
          <span className="font-medium text-ink-500">Engine</span>
          {engine.courses ? (
            <>
              <span>{fmt.int(engine.courses)} courses</span>
              <span>{fmt.int(engine.tracks)} tracks</span>
              <span>{fmt.int(engine.prerequisite_rungs)} prerequisite rungs</span>
              <span>{fmt.int(engine.semantic_dimensions)} LSA dimensions</span>
              <span>{fmt.int(engine.skills)} skills</span>
            </>
          ) : (
            <span>warming…</span>
          )}
          <span className="ml-auto">
            Ranking, planning and skill-gap analysis run locally. Conversational prose uses Claude
            when a key is configured, and falls back to local templates otherwise.
          </span>
        </div>
      </footer>
    </div>
  )
}

export default Layout

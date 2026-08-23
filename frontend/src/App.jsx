/**
 * Routing and the two guards.
 *
 * `RequireAuth` also enforces onboarding, which is why it is not a one-liner: a
 * learner with an account but no goal has nothing for the dashboard to render, so
 * they are sent to the wizard instead of to an empty page. The redirect carries
 * the attempted location so signing in returns you where you were headed.
 */
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'

import Layout from './components/Layout'
import { Loading } from './components/ui'
import { useAuth } from './store/auth'

import Landing from './pages/Landing'
import Login from './pages/Login'
import Register from './pages/Register'
import Onboarding from './pages/Onboarding'
import Dashboard from './pages/Dashboard'
import Roadmap from './pages/Roadmap'
import Recommendations from './pages/Recommendations'
import Chat from './pages/Chat'
import Explore from './pages/Explore'
import CourseDetail from './pages/CourseDetail'
import Profile from './pages/Profile'

function RequireAuth({ children, allowUnonboarded = false }) {
  const { isAuthenticated, loading, user } = useAuth()
  const location = useLocation()

  if (loading) return <Loading label="Restoring your session…" className="py-24" />
  if (!isAuthenticated) return <Navigate to="/login" replace state={{ from: location }} />
  if (!allowUnonboarded && !user?.onboarded) return <Navigate to="/onboarding" replace />
  return children
}

function RedirectIfAuthed({ children }) {
  const { isAuthenticated, loading, user } = useAuth()
  if (loading) return <Loading label="Checking your session…" className="py-24" />
  if (isAuthenticated) return <Navigate to={user?.onboarded ? '/dashboard' : '/onboarding'} replace />
  return children
}

export default function App() {
  return (
    <Routes>
      <Route
        path="/"
        element={
          <RedirectIfAuthed>
            <Landing />
          </RedirectIfAuthed>
        }
      />
      <Route
        path="/login"
        element={
          <RedirectIfAuthed>
            <Login />
          </RedirectIfAuthed>
        }
      />
      <Route
        path="/register"
        element={
          <RedirectIfAuthed>
            <Register />
          </RedirectIfAuthed>
        }
      />

      {/* Onboarding sits outside the shell: it is full-width, single-purpose, and
          showing the nav would invite a half-onboarded learner to escape into
          pages that have nothing to show them. */}
      <Route
        path="/onboarding"
        element={
          <RequireAuth allowUnonboarded>
            <Onboarding />
          </RequireAuth>
        }
      />

      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/roadmap" element={<Roadmap />} />
        <Route path="/recommendations" element={<Recommendations />} />
        <Route path="/chat" element={<Chat />} />
        <Route path="/explore" element={<Explore />} />
        <Route path="/courses/:courseId" element={<CourseDetail />} />
        <Route path="/profile" element={<Profile />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

/**
 * Authentication state: the token, the learner, and the four ways in.
 *
 * The user object is refetched from /api/auth/me on mount rather than restored
 * from localStorage. A cached profile goes stale the moment a path is generated
 * or the profile is edited in another tab, and a stale `onboarded` flag is the
 * one that hurts: it would route an onboarded learner back through the wizard.
 * The token is the only thing persisted.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

import { auth as authApi } from '../api/endpoints'
import { onAuthExpired, tokenStore } from '../api/client'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(Boolean(tokenStore.get()))

  const adopt = useCallback((token, nextUser) => {
    tokenStore.set(token)
    setUser(nextUser)
    return nextUser
  }, [])

  const logout = useCallback(() => {
    tokenStore.clear()
    setUser(null)
  }, [])

  // A 401 from any request means the token is gone or expired. Clearing state
  // here — rather than in each component's catch — is what keeps a stale token
  // from leaving the app on a half-rendered private page.
  useEffect(() => onAuthExpired(() => setUser(null)), [])

  useEffect(() => {
    if (!tokenStore.get()) {
      setLoading(false)
      return
    }
    let cancelled = false
    authApi
      .me()
      .then((me) => {
        if (!cancelled) setUser(me)
      })
      .catch(() => {
        tokenStore.clear()
        if (!cancelled) setUser(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const value = useMemo(
    () => ({
      user,
      loading,
      isAuthenticated: Boolean(user),
      login: async (email, password) => {
        const data = await authApi.login({ email, password })
        return adopt(data.access_token, data.user)
      },
      register: async (email, password, fullName) => {
        const data = await authApi.register({ email, password, full_name: fullName || '' })
        return adopt(data.access_token, data.user)
      },
      demoLogin: async (email) => {
        const data = await authApi.demoLogin(email)
        return adopt(data.access_token, data.user)
      },
      /** Merge a fresh profile in after an update, so the nav and guards follow it. */
      setUser,
      refresh: async () => {
        const me = await authApi.me()
        setUser(me)
        return me
      },
      logout,
    }),
    [user, loading, adopt, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>')
  return context
}

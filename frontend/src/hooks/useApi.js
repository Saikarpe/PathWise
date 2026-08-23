/**
 * Two small data hooks. Deliberately not a query library.
 *
 * The app has one server, no cache invalidation graph and no offline story, so
 * react-query would be 40kB to solve a problem this codebase does not have. What
 * it does need is (a) load/error/data without a useEffect in every page, and (b)
 * a guarantee that a response arriving after unmount cannot set state — hence the
 * cancelled flag in both hooks.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Fetch on mount and whenever `deps` change.
 *
 * `fetcher` is intentionally not in the dependency array: it is almost always an
 * inline arrow, which is a new identity every render, and depending on it would
 * make the effect fire forever. `deps` is the explicit control instead.
 */
export function useResource(fetcher, deps = []) {
  const [state, setState] = useState({ data: null, loading: true, error: null })
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  const [nonce, setNonce] = useState(0)
  const reload = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    let cancelled = false
    setState((prev) => ({ ...prev, loading: true, error: null }))
    Promise.resolve()
      .then(() => fetcherRef.current())
      .then((data) => {
        if (!cancelled) setState({ data, loading: false, error: null })
      })
      .catch((error) => {
        if (!cancelled) setState({ data: null, loading: false, error })
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce])

  return { ...state, reload, setData: (data) => setState((s) => ({ ...s, data })) }
}

/**
 * An action the learner triggers: submit, generate, mark complete.
 *
 * `run` is memoised with an empty dependency array so its identity is stable
 * across renders (components pass it to buttons without re-subscribing). But
 * `action` is almost always an inline closure over local state — email,
 * password, a form draft — and that state changes every keystroke while
 * `action` itself is never re-read once `useCallback` has frozen the first
 * one it saw. Without the ref indirection, `run` would forever call the
 * *first* render's closure, submitting whatever state existed at mount
 * (typically all-blank fields) no matter what the learner actually typed.
 * `actionRef` is updated every render so `run` always calls the latest one,
 * the same fix `useResource` applies to `fetcher` above.
 */
export function useAction(action) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(null)
  const mounted = useRef(true)
  useEffect(() => () => { mounted.current = false }, [])

  const actionRef = useRef(action)
  actionRef.current = action

  const run = useCallback(async (...args) => {
    setPending(true)
    setError(null)
    try {
      return await actionRef.current(...args)
    } catch (err) {
      if (mounted.current) setError(err)
      throw err
    } finally {
      if (mounted.current) setPending(false)
    }
  }, [])

  return { run, pending, error, clearError: () => setError(null) }
}

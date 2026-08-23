/**
 * The conversational interface.
 *
 * Three decisions worth naming. (1) History is loaded from the server, not held in
 * component state, so a learner who reloads mid-conversation does not lose it —
 * the transcript is data, not view state. (2) Every assistant turn shows its
 * detected intent, its confidence and whether the prose came from Claude or the
 * local templates; a chat that silently switches reasoning layers is one nobody
 * can debug. (3) When a turn returns a `path_id`, the parent is told so the
 * roadmap and dashboard refetch — chat here has real side effects, and a stale
 * dashboard beside a chat that just said "I built your path" is worse than no chat.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { Eraser, Send, Sparkles, User as UserIcon } from 'lucide-react'

import { chat as chatApi } from '../api/endpoints'
import { Markdownish, SourceBadge, Spinner } from './ui'

const INTENT_LABELS = {
  new_goal: 'new goal',
  refine: 'refinement',
  progress: 'progress check',
  explain: 'explanation',
  feedback: 'feedback',
  greeting: 'greeting',
  question: 'question',
  clarify: 'needs clarification',
}

export function ChatPanel({ onPathChanged, className = '', height = 'h-[calc(100vh-13rem)]' }) {
  const [messages, setMessages] = useState([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [loadingHistory, setLoadingHistory] = useState(true)
  const [suggestions, setSuggestions] = useState([])
  const scrollRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    chatApi
      .history()
      .then((rows) => {
        if (cancelled) return
        setMessages(
          rows.map((row) => ({
            role: row.role,
            content: row.content,
            meta: row.meta || {},
            id: `db-${row.id}`,
          })),
        )
      })
      .catch(() => {
        /* An empty transcript is the correct fallback; the composer still works. */
      })
      .finally(() => {
        if (!cancelled) setLoadingHistory(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Pinned to the bottom on every change, including while a reply streams in as a
  // pending bubble. `behavior: 'smooth'` on the first paint would animate through
  // the whole transcript, so the initial jump is instant.
  useEffect(() => {
    const node = scrollRef.current
    if (!node) return
    node.scrollTo({ top: node.scrollHeight, behavior: messages.length > 2 ? 'smooth' : 'auto' })
  }, [messages, sending])

  async function send(text) {
    const message = (text ?? draft).trim()
    if (!message || sending) return
    setDraft('')
    setSuggestions([])
    setMessages((prev) => [...prev, { role: 'user', content: message, id: `u-${Date.now()}` }])
    setSending(true)
    try {
      const turn = await chatApi.send(message)
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: turn.reply,
          id: `a-${Date.now()}`,
          meta: {
            intent: turn.intent,
            intent_confidence: turn.intent_confidence,
            source: turn.source,
            path_id: turn.path_id,
          },
          recommendations: turn.recommendations || [],
          interpretation: turn.interpretation || {},
        },
      ])
      setSuggestions(turn.suggestions || [])
      if (turn.path_id) onPathChanged?.(turn.path_id)
    } catch (error) {
      toast.error(error.message)
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `I could not answer that: ${error.message}`,
          id: `e-${Date.now()}`,
          meta: { error: true },
        },
      ])
    } finally {
      setSending(false)
      inputRef.current?.focus()
    }
  }

  async function clearHistory() {
    try {
      await chatApi.clear()
      setMessages([])
      setSuggestions([])
      toast.success('Conversation cleared — your path and profile are untouched')
    } catch (error) {
      toast.error(error.message)
    }
  }

  const openers = useMemo(
    () =>
      suggestions.length
        ? suggestions
        : [
            'I want to become a machine learning engineer',
            'Help me get into cybersecurity, I know some networking',
            "I'm a mechanical engineer moving into robotics",
            'Show me a 12-week path for data analytics',
          ],
    [suggestions],
  )

  return (
    <div className={`card flex flex-col ${height} ${className}`}>
      <header className="flex items-center justify-between gap-2 border-b border-ink-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-accent-600" />
          <h2 className="text-sm font-semibold text-ink-900">Learning assistant</h2>
        </div>
        {messages.length ? (
          <button type="button" onClick={clearHistory} className="btn-ghost btn-sm">
            <Eraser className="h-3 w-3" /> Clear
          </button>
        ) : null}
      </header>

      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-4">
        {loadingHistory ? (
          <div className="flex justify-center py-8">
            <Spinner className="h-5 w-5 text-ink-300" />
          </div>
        ) : null}

        {!loadingHistory && !messages.length ? (
          <div className="py-6 text-center">
            <Sparkles className="mx-auto h-7 w-7 text-accent-300" />
            <p className="mt-2 text-sm font-medium text-ink-800">
              Tell me what you want to be able to do.
            </p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-ink-500">
              Plain sentences work best. Mention what you already know, how many hours a week you
              have, and any deadline — all three change the plan.
            </p>
          </div>
        ) : null}

        {messages.map((message) => (
          <Bubble key={message.id} message={message} />
        ))}

        {sending ? (
          <div className="flex items-center gap-2 text-sm text-ink-400">
            <Spinner className="h-3.5 w-3.5" /> thinking — parsing your goal, ranking the
            catalogue…
          </div>
        ) : null}
      </div>

      <div className="border-t border-ink-200 p-3">
        {!sending ? (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {openers.slice(0, 4).map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => send(suggestion)}
                className="chip hover:border-accent-300 hover:bg-accent-50 hover:text-accent-800"
              >
                {suggestion}
              </button>
            ))}
          </div>
        ) : null}

        <form
          onSubmit={(event) => {
            event.preventDefault()
            send()
          }}
          className="flex items-end gap-2"
        >
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              // Enter sends, Shift+Enter breaks the line. Learners paste
              // multi-sentence goals here, so the newline has to stay reachable.
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                send()
              }
            }}
            rows={2}
            placeholder="e.g. I know Python and want to move into MLOps, about 8 hours a week"
            className="input resize-none"
            disabled={sending}
          />
          <button
            type="submit"
            disabled={sending || !draft.trim()}
            className="btn-primary h-[42px] shrink-0 px-3"
            aria-label="Send message"
          >
            {sending ? <Spinner /> : <Send className="h-4 w-4" />}
          </button>
        </form>
      </div>
    </div>
  )
}

function Bubble({ message }) {
  const isUser = message.role === 'user'
  const meta = message.meta || {}
  const tracks = (message.interpretation?.tracks || []).slice(0, 3)

  return (
    <div className={`flex gap-2.5 ${isUser ? 'justify-end' : ''} animate-fade-up`}>
      {!isUser ? (
        <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent-50">
          <Sparkles className="h-3.5 w-3.5 text-accent-600" />
        </span>
      ) : null}

      <div className={`max-w-[85%] min-w-0 ${isUser ? 'order-first' : ''}`}>
        <div
          className={
            isUser
              ? 'rounded-xl rounded-br-sm bg-accent-600 px-3.5 py-2.5 text-sm text-white'
              : meta.error
                ? 'rounded-xl rounded-bl-sm border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-900'
                : 'rounded-xl rounded-bl-sm border border-ink-200 bg-white px-3.5 py-2.5 text-sm text-ink-800'
          }
        >
          <p className="whitespace-pre-wrap leading-relaxed">
            <Markdownish text={message.content} />
          </p>
        </div>

        {!isUser && (meta.intent || meta.source) ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {meta.intent ? (
              <span className="chip text-[11px]">
                {INTENT_LABELS[meta.intent] || meta.intent}
                {meta.intent_confidence ? (
                  <span className="tabular-nums opacity-60">
                    {Math.round(meta.intent_confidence * 100)}%
                  </span>
                ) : null}
              </span>
            ) : null}
            {tracks.map((track) => (
              <span key={track.track} className="chip-accent text-[11px]">
                {track.track}
              </span>
            ))}
            {meta.path_id ? (
              <span className="chip-good text-[11px]">path #{meta.path_id}</span>
            ) : null}
            <SourceBadge source={meta.source} />
          </div>
        ) : null}

        {message.recommendations?.length ? (
          <ul className="mt-2 space-y-1.5">
            {message.recommendations.slice(0, 3).map((rec, index) => (
              <li
                key={rec.course?.course_id ?? index}
                className="rounded-lg border border-ink-200 bg-ink-50/70 px-3 py-2"
              >
                <p className="truncate text-xs font-medium text-ink-900">{rec.course?.title}</p>
                <p className="mt-0.5 text-[11px] text-ink-500">
                  {rec.explanation?.headline || rec.course?.track}
                </p>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {isUser ? (
        <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-ink-200">
          <UserIcon className="h-3.5 w-3.5 text-ink-600" />
        </span>
      ) : null}
    </div>
  )
}

export default ChatPanel

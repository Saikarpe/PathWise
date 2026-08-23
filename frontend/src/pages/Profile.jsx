/**
 * The learner-profiling engine's own read/write surface, as a page.
 *
 * Three independent editors share one page because they write to three different
 * places in the backend, not because they belong together conceptually:
 *
 *   - "About you" is a straight PUT to `/api/profile` — goal, level, pacing,
 *     format/provider preference, interests. This is what the ranker and planner
 *     read on every request.
 *   - "Skills" edits `self_assessed_skills`, which the backend treats as a full
 *     *replacement* of the self-reported set (see `_replace_self_assessment`).
 *     That is why the local `selfRatings` map is seeded from the server on load
 *     and always sent whole — a partial submit would silently delete anything
 *     left out.
 *   - "Learning history" edits `completed_course_ids`, which is likewise a
 *     replacement, and the same rule applies: read the full list, mutate it
 *     locally, send it whole. Completions that belong to an active path
 *     (`removable: false`) are left out of the editable list entirely, since
 *     retracting them would desync a path's own progress log.
 *
 * Each editor saves independently so a mistake in one does not require redoing
 * the others.
 */
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import {
  BadgeCheck,
  BookOpen,
  Layers,
  Loader2,
  Pencil,
  Plus,
  Save,
  Search,
  Sparkles,
  Trash2,
  UserCog,
  X,
} from 'lucide-react'

import { catalog as catalogApi, profile as profileApi } from '../api/endpoints'
import { useAction, useResource } from '../hooks/useApi'
import { useAuth } from '../store/auth'
import {
  Card,
  ErrorState,
  Loading,
  ProgressBar,
  SectionHeader,
  Spinner,
  StatusChip,
  fmt,
} from '../components/ui'
import { SkillMeterList } from '../components/SkillMeter'

const LEVELS = ['Beginner', 'Intermediate', 'Advanced']

export default function Profile() {
  const { user, setUser } = useAuth()
  const { data: vocab, loading: vocabLoading } = useResource(() => profileApi.vocabulary(), [])
  const {
    data: skillsData,
    loading: skillsLoading,
    reload: reloadSkills,
  } = useResource(() => profileApi.skills(), [])
  const {
    data: historyData,
    loading: historyLoading,
    error: historyError,
    reload: reloadHistory,
  } = useResource(() => profileApi.history(), [])

  if (!user) return <Loading label="Loading your profile…" />

  return (
    <div className="space-y-6">
      <header>
        <h1 className="flex items-center gap-2 text-xl font-semibold text-ink-900">
          <UserCog className="h-5 w-5 text-accent-600" />
          Your profile
        </h1>
        <p className="muted mt-1 max-w-3xl">
          Everything here feeds the recommender directly — interests and pacing shape ranking,
          declared skills shape the gap analysis, and completed courses are what &ldquo;you already
          know this&rdquo; means to the planner.
        </p>
      </header>

      <IdentityCard user={user} />

      <AboutYouCard user={user} setUser={setUser} vocab={vocab} vocabLoading={vocabLoading} />

      <SkillsCard
        data={skillsData}
        loading={skillsLoading}
        vocab={vocab}
        onSaved={(updated) => {
          setUser(updated)
          reloadSkills()
        }}
      />

      <HistoryCard
        data={historyData}
        loading={historyLoading}
        error={historyError}
        onRetry={reloadHistory}
        onSaved={(updated) => {
          setUser(updated)
          reloadHistory()
        }}
      />
    </div>
  )
}

/* ------------------------------------------------------------------------ */
function IdentityCard({ user }) {
  const initial = (user.full_name || user.email || '?').trim().charAt(0).toUpperCase()
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center gap-4">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-accent-600 text-lg font-semibold text-white">
          {initial}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold text-ink-900">
            {user.full_name || 'Unnamed learner'}
          </p>
          <p className="truncate text-sm text-ink-500">{user.email}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <span className="chip-accent">{user.experience_level}</span>
          {user.primary_branch ? <span className="chip">{user.primary_branch}</span> : null}
          {user.target_role ? <span className="chip">{user.target_role}</span> : null}
          <span className="chip">{user.weekly_hours}h/week</span>
        </div>
      </div>
      {user.goal_text ? (
        <p className="mt-3 rounded-lg border border-ink-200 bg-ink-50/60 p-3 text-sm text-ink-600">
          Goal as read: <span className="italic">&ldquo;{user.goal_text}&rdquo;</span>
        </p>
      ) : null}
      <p className="mt-2 text-xs text-ink-400">
        Member since {fmt.date(user.created_at)}. To change your goal itself, ask the{' '}
        <Link to="/chat" className="text-accent-700 hover:underline">
          assistant
        </Link>{' '}
        — the fields below are pacing and background, not the target.
      </p>
    </Card>
  )
}

/* ------------------------------------------------------------------------ */
function AboutYouCard({ user, setUser, vocab, vocabLoading }) {
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState(() => fromUser(user))

  useEffect(() => {
    if (!editing) setForm(fromUser(user))
  }, [user, editing])

  const { run: save, pending, error, clearError } = useAction(async () => {
    const updated = await profileApi.update({
      full_name: form.full_name.trim() || null,
      experience_level: form.experience_level,
      primary_branch: form.primary_branch || null,
      target_role: form.target_role.trim() || null,
      weekly_hours: Number(form.weekly_hours),
      timeline_weeks: form.timeline_weeks ? Number(form.timeline_weeks) : null,
      preferred_formats: form.preferred_formats,
      preferred_providers: form.preferred_providers,
      interests: form.interests,
      industry_interests: form.industry_interests,
    })
    setUser(updated)
    setEditing(false)
    toast.success('Profile updated')
    return updated
  })

  return (
    <Card className="p-5">
      <SectionHeader
        title="About you"
        subtitle="Level, pacing and preference — the constraints every path and recommendation is built inside."
        action={
          editing ? (
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={() => {
                  clearError()
                  setEditing(false)
                }}
              >
                <X className="h-3 w-3" /> Cancel
              </button>
              <button
                type="button"
                className="btn-primary btn-sm"
                disabled={pending}
                onClick={() => save().catch(() => {})}
              >
                {pending ? <Spinner className="h-3 w-3" /> : <Save className="h-3 w-3" />} Save
              </button>
            </div>
          ) : (
            <button type="button" className="btn-secondary btn-sm" onClick={() => setEditing(true)}>
              <Pencil className="h-3 w-3" /> Edit
            </button>
          )
        }
      />

      {error ? <ErrorState error={error} className="mt-4" /> : null}

      {!editing ? (
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Full name" value={user.full_name || '—'} />
          <Field label="Experience level" value={user.experience_level} />
          <Field label="Primary branch" value={user.primary_branch || 'Not set'} />
          <Field label="Target role" value={user.target_role || 'Not set'} />
          <Field label="Weekly hours" value={`${user.weekly_hours}h`} />
          <Field label="Deadline" value={user.timeline_weeks ? `${user.timeline_weeks} weeks` : 'Open-ended'} />
          <ChipsField label="Interests" items={user.interests} />
          <ChipsField label="Industry interests" items={user.industry_interests} />
          <ChipsField label="Preferred formats" items={user.preferred_formats} />
          <ChipsField label="Preferred providers" items={user.preferred_providers} />
        </div>
      ) : vocabLoading ? (
        <Loading label="Loading catalogue options…" className="py-8" />
      ) : (
        <div className="mt-4 space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="full_name">
                Full name
              </label>
              <input
                id="full_name"
                className="input"
                value={form.full_name}
                onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
              />
            </div>
            <div>
              <label className="label" htmlFor="target_role">
                Target role
              </label>
              <input
                id="target_role"
                className="input"
                list="career-options"
                value={form.target_role}
                onChange={(e) => setForm((f) => ({ ...f, target_role: e.target.value }))}
                placeholder="e.g. ml engineer"
              />
              <datalist id="career-options">
                {(vocab?.careers ?? []).map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
          </div>

          <div>
            <span className="label">Experience level</span>
            <div className="flex flex-wrap gap-2">
              {LEVELS.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, experience_level: option }))}
                  className={form.experience_level === option ? 'chip-active' : 'chip'}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="branch">
                Primary branch
              </label>
              <select
                id="branch"
                className="input"
                value={form.primary_branch}
                onChange={(e) => setForm((f) => ({ ...f, primary_branch: e.target.value }))}
              >
                <option value="">Not set</option>
                {(vocab?.branches ?? []).map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="timeline">
                Deadline in weeks{' '}
                <span className="font-normal normal-case text-ink-400">(optional)</span>
              </label>
              <input
                id="timeline"
                type="number"
                min={1}
                max={260}
                className="input"
                value={form.timeline_weeks}
                onChange={(e) => setForm((f) => ({ ...f, timeline_weeks: e.target.value }))}
                placeholder="24"
              />
            </div>
          </div>

          <div>
            <label className="label" htmlFor="hours">
              Hours per week — {form.weekly_hours}h
            </label>
            <input
              id="hours"
              type="range"
              min={1}
              max={40}
              step={1}
              value={form.weekly_hours}
              onChange={(e) => setForm((f) => ({ ...f, weekly_hours: Number(e.target.value) }))}
              className="w-full accent-accent-600"
            />
          </div>

          <TagCloud
            label="Interests"
            hint="tracks and topics the recommender should lean into"
            options={vocab?.tracks ?? []}
            selected={form.interests}
            onChange={(next) => setForm((f) => ({ ...f, interests: next }))}
          />
          <TagCloud
            label="Industry interests"
            hint="sectors you'd rather your projects and examples come from"
            options={vocab?.sectors ?? []}
            selected={form.industry_interests}
            onChange={(next) => setForm((f) => ({ ...f, industry_interests: next }))}
          />
          <TagCloud
            label="Preferred formats"
            hint="a soft ranking factor — a better-matching course in another format still wins"
            options={vocab?.formats ?? []}
            selected={form.preferred_formats}
            onChange={(next) => setForm((f) => ({ ...f, preferred_formats: next }))}
          />
          <TagCloud
            label="Preferred providers"
            options={vocab?.providers ?? []}
            selected={form.preferred_providers}
            onChange={(next) => setForm((f) => ({ ...f, preferred_providers: next }))}
          />
        </div>
      )}
    </Card>
  )
}

function fromUser(user) {
  return {
    full_name: user.full_name || '',
    experience_level: user.experience_level || 'Beginner',
    primary_branch: user.primary_branch || '',
    target_role: user.target_role || '',
    weekly_hours: user.weekly_hours || 8,
    timeline_weeks: user.timeline_weeks || '',
    interests: user.interests || [],
    industry_interests: user.industry_interests || [],
    preferred_formats: user.preferred_formats || [],
    preferred_providers: user.preferred_providers || [],
  }
}

function Field({ label, value }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">{label}</p>
      <p className="mt-0.5 truncate text-sm text-ink-900">{value}</p>
    </div>
  )
}

function ChipsField({ label, items = [] }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">{label}</p>
      {items?.length ? (
        <div className="mt-1 flex flex-wrap gap-1">
          {items.map((item) => (
            <span key={item} className="chip">
              {item}
            </span>
          ))}
        </div>
      ) : (
        <p className="mt-0.5 text-sm text-ink-400">None set</p>
      )}
    </div>
  )
}

function TagCloud({ label, hint, options = [], selected = [], onChange }) {
  return (
    <div>
      <span className="label">{label}</span>
      {hint ? <p className="-mt-1 mb-2 text-[11px] text-ink-400">{hint}</p> : null}
      <div className="flex max-h-36 flex-wrap gap-1.5 overflow-y-auto rounded-lg border border-ink-100 p-2">
        {options.length ? (
          options.map((option) => {
            const active = selected.includes(option)
            return (
              <button
                key={option}
                type="button"
                onClick={() =>
                  onChange(
                    active ? selected.filter((v) => v !== option) : [...selected, option],
                  )
                }
                className={active ? 'chip-active' : 'chip'}
              >
                {option}
              </button>
            )
          })
        ) : (
          <span className="text-xs text-ink-400">No options available.</span>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------------ */
function SkillsCard({ data, loading, vocab, onSaved }) {
  const [ratings, setRatings] = useState({})
  const [dirty, setDirty] = useState(false)
  const [addSkill, setAddSkill] = useState('')
  const [addLevel, setAddLevel] = useState(0.5)

  useEffect(() => {
    if (!data || dirty) return
    const seeded = {}
    for (const row of data.skills || []) {
      if (row.declared) seeded[row.skill] = row.proficiency
    }
    setRatings(seeded)
  }, [data, dirty])

  const { run: save, pending, error } = useAction(async () => {
    const updated = await profileApi.update({ self_assessed_skills: ratings })
    setDirty(false)
    toast.success('Skill self-ratings saved')
    onSaved?.(updated)
    return updated
  })

  const skillOptions = useMemo(
    () => (vocab?.skills ?? []).filter((s) => !(s in ratings)),
    [vocab, ratings],
  )

  function addRating() {
    if (!addSkill) return
    setRatings((r) => ({ ...r, [addSkill]: addLevel }))
    setDirty(true)
    setAddSkill('')
    setAddLevel(0.5)
  }

  function removeRating(skill) {
    setRatings((r) => {
      const next = { ...r }
      delete next[skill]
      return next
    })
    setDirty(true)
  }

  return (
    <Card className="p-5">
      <SectionHeader
        title="Skills"
        subtitle="Measured proficiency combines what your completed courses taught with anything you self-rate here — the gap analysis and every recommendation read this."
        action={
          <button
            type="button"
            className="btn-primary btn-sm"
            disabled={!dirty || pending}
            onClick={() => save().catch(() => {})}
          >
            {pending ? <Spinner className="h-3 w-3" /> : <Save className="h-3 w-3" />} Save ratings
          </button>
        }
      />

      {error ? <ErrorState error={error} className="mt-4" /> : null}

      <div className="mt-4 grid gap-6 lg:grid-cols-2">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">
            Current proficiency
          </p>
          {loading ? (
            <Loading label="Measuring your skills…" className="py-6" />
          ) : (
            <SkillMeterList skills={data?.skills ?? []} limit={12} />
          )}
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">
            Your self-ratings
          </p>
          <p className="mb-3 text-[11px] text-ink-400">
            Rate anything you already know that no completed course here proves. This list is a full
            replacement of your self-reported skills on save — remove one here to retract it.
          </p>

          {Object.keys(ratings).length ? (
            <ul className="space-y-2.5">
              {Object.entries(ratings).map(([skill, level]) => (
                <li key={skill} className="flex items-center gap-2.5">
                  <span className="w-32 shrink-0 truncate text-sm text-ink-700" title={skill}>
                    {skill}
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={level}
                    onChange={(e) => {
                      const value = Number(e.target.value)
                      setRatings((r) => ({ ...r, [skill]: value }))
                      setDirty(true)
                    }}
                    className="flex-1 accent-accent-600"
                  />
                  <span className="w-10 shrink-0 text-right text-xs tabular-nums text-ink-500">
                    {fmt.pct(level)}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeRating(skill)}
                    className="btn-ghost btn-sm shrink-0"
                    aria-label={`Remove ${skill} rating`}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-400">No self-ratings yet.</p>
          )}

          <div className="mt-4 flex items-center gap-2 border-t border-ink-100 pt-4">
            <select
              className="input"
              value={addSkill}
              onChange={(e) => setAddSkill(e.target.value)}
            >
              <option value="">Add a skill…</option>
              {skillOptions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={addLevel}
              onChange={(e) => setAddLevel(Number(e.target.value))}
              className="w-24 shrink-0 accent-accent-600"
            />
            <span className="w-10 shrink-0 text-right text-xs tabular-nums text-ink-500">
              {fmt.pct(addLevel)}
            </span>
            <button
              type="button"
              onClick={addRating}
              disabled={!addSkill}
              className="btn-secondary btn-sm shrink-0"
            >
              <Plus className="h-3 w-3" /> Add
            </button>
          </div>
        </div>
      </div>
    </Card>
  )
}

/* ------------------------------------------------------------------------ */
function HistoryCard({ data, loading, error, onRetry, onSaved }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])

  const { run: search, pending: searching } = useAction(async (text) => {
    if (!text || text.trim().length < 2) {
      setResults([])
      return
    }
    const found = await catalogApi.search({ q: text.trim(), limit: 6 })
    setResults(found.results ?? found.courses ?? [])
  })

  const { run: mutate, pending: saving } = useAction(async (nextIds) => {
    const updated = await profileApi.update({ completed_course_ids: nextIds })
    onSaved?.(updated)
    return updated
  })

  const completedIds = data?.completed_course_ids ?? []

  function addCompleted(courseId) {
    if (completedIds.includes(courseId)) return
    mutate([...completedIds, courseId])
      .then(() => {
        toast.success('Added to your completed courses')
        setResults((r) => r.filter((c) => c.course_id !== courseId))
      })
      .catch((err) => toast.error(err.message))
  }

  function removeCompleted(courseId) {
    mutate(completedIds.filter((id) => id !== courseId))
      .then(() => toast.success('Removed'))
      .catch((err) => toast.error(err.message))
  }

  return (
    <Card className="p-5">
      <SectionHeader
        title="Learning history"
        subtitle="Every course you've touched. Completions here are what closes skill gaps and unlocks prerequisites in the planner."
      />

      {error ? <ErrorState error={error} onRetry={onRetry} className="mt-4" /> : null}

      <div className="mt-4">
        <label className="label" htmlFor="add-course">
          Add a course you've already completed
        </label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <input
            id="add-course"
            className="input pl-9"
            placeholder="Search the catalogue by title or topic…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              search(e.target.value).catch(() => {})
            }}
          />
          {searching ? (
            <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-ink-400" />
          ) : null}
        </div>
        {results.length ? (
          <ul className="mt-2 divide-y divide-ink-100 rounded-lg border border-ink-200">
            {results.map((course) => (
              <li key={course.course_id} className="flex items-center justify-between gap-3 p-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink-900">{course.title}</p>
                  <p className="truncate text-xs text-ink-500">
                    {course.track} · {course.provider} · {fmt.hours(course.hours)}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => addCompleted(course.course_id)}
                  className="btn-secondary btn-sm shrink-0"
                >
                  <BadgeCheck className="h-3 w-3" /> Mark completed
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="mt-5 border-t border-ink-100 pt-4">
        {loading ? (
          <Loading label="Loading your history…" className="py-6" />
        ) : data?.history?.length ? (
          <>
            <div className="mb-3 flex flex-wrap gap-4 text-xs text-ink-500">
              <span className="inline-flex items-center gap-1">
                <BookOpen className="h-3 w-3" /> {data.completed_count} completed
              </span>
              <span className="inline-flex items-center gap-1">
                <Layers className="h-3 w-3" /> {fmt.hours(data.hours_logged)} logged
              </span>
            </div>
            <ul className="space-y-2">
              {data.history.map((row) => (
                <li
                  key={row.course_id}
                  className="flex flex-wrap items-center gap-3 rounded-lg border border-ink-200 p-3"
                >
                  <div className="min-w-0 flex-1">
                    <Link
                      to={`/courses/${encodeURIComponent(row.course_id)}`}
                      className="truncate text-sm font-medium text-ink-900 hover:text-accent-700 hover:underline"
                    >
                      {row.course.title}
                    </Link>
                    <p className="mt-0.5 truncate text-xs text-ink-500">
                      {row.course.track} · {row.course.provider}
                      {row.on_path ? ' · part of your active path' : ''}
                    </p>
                    {row.status === 'in_progress' ? (
                      <ProgressBar value={row.progress_pct / 100} className="mt-1.5 w-40" />
                    ) : null}
                  </div>
                  <span className="shrink-0 text-xs tabular-nums text-ink-500">
                    {fmt.hours(row.hours_logged)}
                  </span>
                  <StatusChip status={row.status} />
                  {row.status === 'completed' && row.removable ? (
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => removeCompleted(row.course_id)}
                      className="btn-ghost btn-sm shrink-0"
                      title="Retract this completion"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="flex items-center gap-2 text-sm text-ink-400">
            <Sparkles className="h-4 w-4" /> No history yet — completions from your path will show up
            here, or add prior courses above.
          </p>
        )}
      </div>
    </Card>
  )
}

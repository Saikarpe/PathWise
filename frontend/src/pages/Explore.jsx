/**
 * Catalogue explorer.
 *
 * Filters come from /api/catalog/taxonomy rather than a hardcoded list, so they
 * cannot drift from the data. The free-text box is a *semantic* search — it encodes
 * the query into the same LSA space the recommender ranks in and orders whatever
 * survived the filters, which is why "learn to make robots move" finds kinematics
 * courses that share no words with the query.
 *
 * The skill drawer is the other half of the page: picking a skill shows what the
 * competency model actually thinks of it — how common it is, which tracks it is
 * central to, and the level a goal in those tracks would require. That is the
 * number the gap analysis uses, so it is worth being able to look at.
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  BookOpen,
  Boxes,
  Clock,
  Layers,
  Search,
  Sparkles,
  Star,
  Target,
  X,
} from 'lucide-react'

import { catalog as catalogApi } from '../api/endpoints'
import { useResource } from '../hooks/useApi'
import { Empty, ErrorState, Loading, Spinner, fmt } from '../components/ui'

export default function Explore() {
  const [draft, setDraft] = useState('')
  const [query, setQuery] = useState('')
  const [branch, setBranch] = useState('')
  const [track, setTrack] = useState('')
  const [difficulty, setDifficulty] = useState('')
  const [provider, setProvider] = useState('')
  const [skill, setSkill] = useState(null)

  const { data: taxonomy } = useResource(() => catalogApi.taxonomy(), [])
  const { data: stats } = useResource(() => catalogApi.stats(), [])
  const { data, loading, error, reload } = useResource(
    () =>
      catalogApi.search({
        q: query || null,
        branch: branch || null,
        track: track || null,
        difficulty: difficulty || null,
        provider: provider || null,
        limit: 24,
      }),
    [query, branch, track, difficulty, provider],
  )

  const tracksForBranch = branch
    ? (taxonomy?.branches ?? []).find((entry) => entry.name === branch)?.tracks ?? []
    : []

  const activeFilters = [branch, track, difficulty, provider].filter(Boolean).length

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-ink-900">Explore the catalogue</h1>
        <p className="muted mt-1 max-w-3xl">
          {stats ? (
            <>
              {fmt.int(stats.courses)} courses across {fmt.int(stats.branches)} branches and{' '}
              {fmt.int(stats.tracks)} tracks, searched semantically in the same{' '}
              {stats.semantic_dimensions}-dimensional space the recommender ranks in.
            </>
          ) : (
            'Loading catalogue statistics…'
          )}
        </p>
      </header>

      <section className="card p-4">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            setQuery(draft.trim())
          }}
        >
          <div className="min-w-[15rem] flex-1">
            <label className="label" htmlFor="q">
              Describe what you want to learn
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400" />
              <input
                id="q"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                className="input pl-9"
                placeholder="e.g. making a robot arm follow a path"
              />
            </div>
          </div>
          <button type="submit" className="btn-primary">
            <Sparkles className="h-4 w-4" /> Search
          </button>
        </form>

        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Select
            label="Branch"
            value={branch}
            onChange={(value) => {
              setBranch(value)
              setTrack('') // A track from the old branch would filter to nothing.
            }}
            options={(taxonomy?.branches ?? []).map((entry) => ({
              value: entry.name,
              label: `${entry.name} (${entry.courses})`,
            }))}
          />
          <Select
            label="Track"
            value={track}
            onChange={setTrack}
            disabled={!branch}
            hint={!branch ? 'pick a branch first' : undefined}
            options={tracksForBranch.map((name) => ({ value: name, label: name }))}
          />
          <Select
            label="Difficulty"
            value={difficulty}
            onChange={setDifficulty}
            options={(taxonomy?.difficulty_levels ?? []).map((name) => ({
              value: name,
              label: name,
            }))}
          />
          <Select
            label="Provider"
            value={provider}
            onChange={setProvider}
            options={(taxonomy?.providers ?? []).map((name) => ({ value: name, label: name }))}
          />
        </div>

        {activeFilters || query ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs text-ink-500">
              {data ? (
                <>
                  {fmt.int(data.total_matching)} course
                  {data.total_matching === 1 ? '' : 's'} match
                  {query ? ', ordered by semantic relevance' : ', ordered by rating quality'}
                </>
              ) : null}
            </span>
            <button
              type="button"
              onClick={() => {
                setDraft('')
                setQuery('')
                setBranch('')
                setTrack('')
                setDifficulty('')
                setProvider('')
              }}
              className="btn-ghost btn-sm"
            >
              <X className="h-3 w-3" /> Clear all
            </button>
          </div>
        ) : null}
      </section>

      <div className="grid gap-6 lg:grid-cols-[1.6fr,1fr]">
        <div className="min-w-0 space-y-3">
          {loading && !data ? <Loading label="Searching…" /> : null}
          {error ? <ErrorState error={error} onRetry={reload} /> : null}
          {data && !data.results.length ? (
            <Empty icon={BookOpen} title="Nothing matched those filters">
              Loosen a filter — the combination you picked has no courses in it.
            </Empty>
          ) : null}

          {data?.results.map((course) => (
            <article key={course.course_id} className="card card-hover p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate font-medium text-ink-900">
                    <Link
                      to={`/courses/${encodeURIComponent(course.course_id)}`}
                      className="hover:text-accent-700 hover:underline"
                    >
                      {course.title}
                    </Link>
                  </h3>
                  <p className="mt-0.5 truncate text-xs text-ink-500">
                    {course.track} · {course.branch}
                  </p>
                </div>
                {query ? (
                  <span
                    className="chip shrink-0 tabular-nums"
                    title="cosine similarity to your query in the LSA space"
                  >
                    {fmt.pct(course.relevance)} match
                  </span>
                ) : null}
              </div>

              <p className="mt-2 line-clamp-2 text-sm text-ink-500">{course.description}</p>

              <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-500">
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-3 w-3" /> {fmt.hours(course.hours)}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Star className="h-3 w-3" /> {fmt.rating(course.rating)}
                  <span className="text-ink-400">({fmt.int(course.num_reviews)})</span>
                </span>
                <span className="chip">{course.difficulty}</span>
                <span className="chip">{course.provider}</span>
                <span className="chip">{course.format}</span>
              </div>

              {course.skills?.length ? (
                <div className="mt-2 flex flex-wrap gap-1">
                  {course.skills.slice(0, 6).map((name) => (
                    <button
                      key={name}
                      type="button"
                      onClick={() => setSkill(name)}
                      className="chip text-[11px] hover:border-accent-300 hover:bg-accent-50 hover:text-accent-800"
                    >
                      {name}
                    </button>
                  ))}
                </div>
              ) : null}
            </article>
          ))}
        </div>

        <div className="space-y-6">
          {skill ? (
            <SkillPanel skill={skill} onClose={() => setSkill(null)} />
          ) : (
            <section className="card p-5">
              <h2 className="flex items-center gap-2 text-base font-semibold text-ink-900">
                <Target className="h-4 w-4 text-accent-600" />
                Skills in the catalogue
              </h2>
              <p className="muted mt-0.5">
                Pick one to see how the competency model scores it — prevalence, the tracks it is
                central to, and the level a goal there would demand.
              </p>
              <div className="mt-3 flex flex-wrap gap-1">
                {(taxonomy?.skills ?? []).slice(0, 40).map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => setSkill(name)}
                    className="chip text-[11px] hover:border-accent-300 hover:bg-accent-50 hover:text-accent-800"
                  >
                    {name}
                  </button>
                ))}
              </div>
            </section>
          )}

          {taxonomy?.branches?.length ? (
            <section className="card p-5">
              <h2 className="flex items-center gap-2 text-base font-semibold text-ink-900">
                <Boxes className="h-4 w-4 text-accent-600" />
                Branches
              </h2>
              <ul className="mt-3 space-y-1.5">
                {taxonomy.branches.map((entry) => (
                  <li key={entry.name}>
                    <button
                      type="button"
                      onClick={() => {
                        setBranch(entry.name)
                        setTrack('')
                      }}
                      className={`flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5
                                  text-left text-sm transition hover:bg-ink-50 ${
                                    branch === entry.name ? 'bg-accent-50 text-accent-800' : 'text-ink-700'
                                  }`}
                    >
                      <span className="min-w-0 truncate">{entry.name}</span>
                      <span className="shrink-0 text-xs tabular-nums text-ink-400">
                        {entry.courses} · {entry.tracks.length} tracks
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function Select({ label, value, onChange, options, disabled = false, hint }) {
  return (
    <div>
      <label className="label" htmlFor={`filter-${label}`}>
        {label}
        {hint ? <span className="font-normal normal-case text-ink-400"> — {hint}</span> : null}
      </label>
      <select
        id={`filter-${label}`}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="input disabled:cursor-not-allowed disabled:bg-ink-50 disabled:text-ink-400"
      >
        <option value="">Any</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  )
}

/**
 * One skill, as the competency model sees it.
 *
 * `required_level` is the interesting number and it is per-track by design: the
 * model has no catalogue-wide notion of a skill's importance, because importance is
 * centrality × distinctiveness *relative to a goal*. Showing one global figure
 * would be inventing a quantity the engine deliberately does not have.
 */
function SkillPanel({ skill, onClose }) {
  const { data, loading, error } = useResource(() => catalogApi.skill(skill, 6), [skill])

  return (
    <section className="card p-5">
      <div className="flex items-start justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold text-ink-900">
          <Target className="h-4 w-4 text-accent-600" />
          <span className="capitalize">{skill}</span>
        </h2>
        <button type="button" onClick={onClose} className="btn-ghost btn-sm" aria-label="Close">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-6">
          <Spinner className="h-5 w-5 text-ink-300" />
        </div>
      ) : null}
      {error ? <ErrorState error={error} className="mt-3" /> : null}

      {data ? (
        <>
          <p className="muted mt-1">
            Taught by {data.course_count} course{data.course_count === 1 ? '' : 's'} ·{' '}
            {fmt.pct(data.prevalence)} of the catalogue mentions it. Rarer skills score as more
            distinctive, which raises their importance where they are central.
          </p>

          {data.central_to_tracks?.length ? (
            <div className="mt-4">
              <p className="section-title mb-2">Most central to these tracks</p>
              <ul className="space-y-2">
                {data.central_to_tracks.map((row) => (
                  <li key={row.track}>
                    <div className="flex items-baseline justify-between gap-2 text-xs">
                      <span className="truncate text-ink-700">{row.track}</span>
                      <span className="shrink-0 tabular-nums text-ink-400">
                        needs {fmt.pct(row.required_level)}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink-100">
                      <div
                        className="h-full rounded-full bg-accent-500"
                        style={{ width: `${Math.min(100, row.centrality * 100)}%` }}
                      />
                    </div>
                    <p className="mt-0.5 text-[11px] text-ink-400">
                      centrality {row.centrality} · importance {row.importance}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {data.central_to_careers?.length ? (
            <div className="mt-4">
              <p className="section-title mb-1.5">Careers it matters for</p>
              <div className="flex flex-wrap gap-1">
                {data.central_to_careers.map((row) => (
                  <span key={row.career} className="chip-good text-[11px]">
                    {row.career}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {data.taught_by?.length ? (
            <div className="mt-4">
              <p className="section-title mb-1.5 flex items-center gap-1.5">
                <Layers className="h-3 w-3 text-ink-400" />
                Best-rated courses that teach it
              </p>
              <ul className="space-y-1.5">
                {data.taught_by.map((course) => (
                  <li key={course.course_id} className="flex items-center justify-between gap-2">
                    <Link
                      to={`/courses/${encodeURIComponent(course.course_id)}`}
                      className="min-w-0 truncate text-xs text-ink-700 hover:text-accent-700 hover:underline"
                    >
                      {course.title}
                    </Link>
                    <span className="shrink-0 text-[11px] tabular-nums text-ink-400">
                      {fmt.rating(course.rating)}★ · {fmt.hours(course.hours)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  )
}

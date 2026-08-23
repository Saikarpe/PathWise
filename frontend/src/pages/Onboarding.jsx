/**
 * The onboarding wizard.
 *
 * Four steps, and the order is the argument: state your goal, *check what was
 * understood*, fill in the constraints, then look at the plan before it is saved.
 *
 * Step 2 is the one that earns its place. The parse is the most error-prone step
 * in the whole system — a sentence maps onto tracks, careers, skills and declared
 * background, any of which can be read wrongly — and a wrong reading discovered
 * here costs one click, while the same wrong reading discovered later costs a
 * 40-hour roadmap. So the evidence trail is shown verbatim: which phrase matched,
 * which layer matched it, and whether it was read as a goal or as something you
 * already know.
 */
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  BrainCircuit,
  CalendarClock,
  Check,
  Compass,
  Layers,
  Sparkles,
} from 'lucide-react'

import { paths as pathsApi, profile as profileApi } from '../api/endpoints'
import { useAction, useResource } from '../hooks/useApi'
import { useAuth } from '../store/auth'
import { ErrorState, Loading, Markdownish, Spinner, fmt } from '../components/ui'

const STEPS = ['Your goal', 'What we understood', 'Time & level', 'Your plan']

const EXAMPLES = [
  'I want to become a machine learning engineer. I know Python and some statistics, about 10 hours a week.',
  'Mechanical engineering final year, moving into robotics — I have done CAD and dynamics.',
  'Get me into cybersecurity in 16 weeks. I already understand computer networks.',
  'I want to do embedded systems and IoT, I prefer hands-on projects over video courses.',
]

const LAYER_LABELS = {
  lexical: 'exact phrase',
  alias: 'known synonym',
  fuzzy: 'close spelling',
  semantic: 'semantic match',
  llm: 'Claude, validated against the catalogue',
  profile: 'your saved profile',
}

export default function Onboarding() {
  const navigate = useNavigate()
  const { user, setUser } = useAuth()

  const [step, setStep] = useState(0)
  const [goalText, setGoalText] = useState(user?.goal_text || '')
  const [interpretation, setInterpretation] = useState(null)
  const [level, setLevel] = useState(user?.experience_level || 'Beginner')
  const [weeklyHours, setWeeklyHours] = useState(user?.weekly_hours || 8)
  const [timeline, setTimeline] = useState(user?.timeline_weeks || '')
  const [formats, setFormats] = useState(user?.preferred_formats || [])
  const [providers, setProviders] = useState(user?.preferred_providers || [])
  const [preview, setPreview] = useState(null)

  const { data: vocab, loading: vocabLoading } = useResource(() => profileApi.vocabulary(), [])

  // ---- step 1 → 2: parse ------------------------------------------------- //
  const { run: interpret, pending: interpreting, error: interpretError } = useAction(async () => {
    const result = await profileApi.interpret(goalText.trim())
    setInterpretation(result)
    // The parser also extracts constraints — hours, deadline, level — so step 3
    // arrives pre-filled from the learner's own sentence rather than blank.
    if (result.experience_level) setLevel(result.experience_level)
    if (result.weekly_hours) setWeeklyHours(result.weekly_hours)
    if (result.timeline_weeks) setTimeline(result.timeline_weeks)
    if (result.formats?.length) setFormats(result.formats)
    if (result.providers?.length) setProviders(result.providers)
    setStep(1)
    return result
  })

  // ---- step 3 → 4: save profile, then preview a path --------------------- //
  const { run: buildPreview, pending: previewing, error: previewError } = useAction(async () => {
    const updated = await profileApi.update({
      goal_text: goalText.trim(),
      experience_level: level,
      weekly_hours: Number(weeklyHours),
      timeline_weeks: timeline ? Number(timeline) : null,
      preferred_formats: formats,
      preferred_providers: providers,
      target_skills: interpretation?.skills ?? [],
      interests: (interpretation?.tracks ?? []).map((t) => t.track).slice(0, 6),
      target_role: interpretation?.careers?.[0] ?? null,
      primary_branch: interpretation?.branches?.[0] ?? null,
    })
    setUser(updated)
    const result = await pathsApi.preview(goalText.trim())
    setPreview(result)
    setStep(3)
    return result
  })

  // ---- commit ------------------------------------------------------------ //
  const { run: commit, pending: committing, error: commitError } = useAction(async () => {
    await pathsApi.generate({ goal_text: goalText.trim() })
    const me = await profileApi.read()
    setUser(me)
    toast.success('Your learning path is ready')
    navigate('/dashboard', { replace: true })
  })

  const plannable = interpretation?.plannable

  return (
    <div className="min-h-full bg-ink-50 px-4 py-8">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent-600">
            <Compass className="h-4 w-4 text-white" />
          </span>
          <span className="font-semibold text-ink-900">Pathfinder</span>
          <span className="ml-auto text-xs text-ink-500">
            Step {step + 1} of {STEPS.length}
          </span>
        </div>

        <ol className="mb-6 flex items-center gap-2">
          {STEPS.map((label, index) => (
            <li key={label} className="flex flex-1 items-center gap-2">
              <span
                className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold ${
                  index < step
                    ? 'bg-emerald-500 text-white'
                    : index === step
                      ? 'bg-accent-600 text-white'
                      : 'bg-ink-200 text-ink-500'
                }`}
              >
                {index < step ? <Check className="h-3 w-3" /> : index + 1}
              </span>
              <span
                className={`hidden truncate text-xs sm:block ${
                  index === step ? 'font-medium text-ink-900' : 'text-ink-500'
                }`}
              >
                {label}
              </span>
              {index < STEPS.length - 1 ? (
                <span
                  className={`h-px flex-1 ${index < step ? 'bg-emerald-300' : 'bg-ink-200'}`}
                />
              ) : null}
            </li>
          ))}
        </ol>

        {/* ---------------------------------------------------------------- */}
        {step === 0 ? (
          <section className="card p-6">
            <h1 className="text-lg font-semibold text-ink-900">
              What do you want to be able to do?
            </h1>
            <p className="mt-1 text-sm text-ink-600">
              Write it however you would say it out loud. Mention what you already know, roughly how
              many hours a week you have, and any deadline — each one changes the plan, and all
              three are optional.
            </p>

            <textarea
              value={goalText}
              onChange={(event) => setGoalText(event.target.value)}
              rows={4}
              className="input mt-4 resize-none"
              placeholder="I'm a second-year ECE student and I want to get into embedded systems and IoT. I know C and basic circuits. Maybe 6 hours a week."
              autoFocus
            />

            <div className="mt-3 flex flex-wrap gap-1.5">
              {EXAMPLES.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => setGoalText(example)}
                  className="chip max-w-full hover:border-accent-300 hover:bg-accent-50 hover:text-accent-800"
                >
                  <span className="truncate">{example}</span>
                </button>
              ))}
            </div>

            {interpretError ? <ErrorState error={interpretError} className="mt-4" /> : null}

            <div className="mt-5 flex justify-end">
              <button
                type="button"
                disabled={goalText.trim().length < 4 || interpreting}
                onClick={() => interpret().catch(() => {})}
                className="btn-primary"
              >
                {interpreting ? <Spinner /> : null} Read my goal
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </section>
        ) : null}

        {/* ---------------------------------------------------------------- */}
        {step === 1 && interpretation ? (
          <section className="card p-6">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 rounded-lg bg-accent-50 p-2">
                <BrainCircuit className="h-4 w-4 text-accent-600" />
              </span>
              <div>
                <h1 className="text-lg font-semibold text-ink-900">Here is what I understood</h1>
                <p className="mt-1 text-sm text-ink-600">
                  Check this before anything is built. If a phrase was read wrongly, go back and say
                  it differently — correcting it here is one click.
                </p>
              </div>
            </div>

            {!plannable ? (
              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                I could not match that to any track in the catalogue. Try naming a field or a role —
                &ldquo;machine learning&rdquo;, &ldquo;structural engineering&rdquo;, &ldquo;become
                a security analyst&rdquo;.
              </div>
            ) : null}

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Block title="Goal tracks" hint="ranked by relevance">
                {interpretation.resolved_tracks?.length ? (
                  <ul className="space-y-1.5">
                    {interpretation.resolved_tracks.map((track) => (
                      <li key={track.track} className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-sm text-ink-800">
                          {track.track}
                        </span>
                        <span className="shrink-0 text-xs tabular-nums text-ink-400">
                          {track.courses} courses
                        </span>
                        <span className="w-14 shrink-0">
                          <span className="block h-1.5 overflow-hidden rounded-full bg-ink-100">
                            <span
                              className="block h-full rounded-full bg-accent-500"
                              style={{ width: `${Math.min(100, track.relevance * 100)}%` }}
                            />
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Nothing>No track matched.</Nothing>
                )}
              </Block>

              <Block title="Target role" hint="from careers named or implied">
                {interpretation.careers?.length ? (
                  <ChipList items={interpretation.careers} tone="accent" />
                ) : (
                  <Nothing>None stated — the tracks are enough to plan.</Nothing>
                )}
              </Block>

              <Block title="Skills you want" hint="these become the gap analysis">
                {interpretation.skills?.length ? (
                  <ChipList items={interpretation.skills} />
                ) : (
                  <Nothing>
                    None named directly — they will be derived from the tracks above.
                  </Nothing>
                )}
              </Block>

              <Block title="What you already know" hint="the plan starts above this">
                {interpretation.known_tracks?.length || interpretation.known_skills?.length ? (
                  <ChipList
                    items={[
                      ...(interpretation.known_tracks ?? []),
                      ...(interpretation.known_skills ?? []),
                    ]}
                    tone="good"
                  />
                ) : (
                  <Nothing>
                    Nothing declared. You can add completions and self-ratings from your profile
                    later.
                  </Nothing>
                )}
              </Block>
            </div>

            <details className="mt-4 rounded-lg border border-ink-200 bg-ink-50/60 p-3">
              <summary className="cursor-pointer text-sm font-medium text-ink-800">
                Evidence trail — which phrase produced which conclusion
              </summary>
              <table className="mt-3 w-full text-xs">
                <thead className="text-left text-ink-400">
                  <tr>
                    <th className="pb-1 font-medium">Phrase</th>
                    <th className="pb-1 font-medium">Read as</th>
                    <th className="pb-1 font-medium">Matched by</th>
                    <th className="pb-1 font-medium">Role</th>
                  </tr>
                </thead>
                <tbody className="text-ink-700">
                  {(interpretation.evidence ?? []).map((row, index) => (
                    <tr key={index} className="border-t border-ink-200/70">
                      <td className="py-1 pr-2 font-mono">{row.matched}</td>
                      <td className="py-1 pr-2">
                        {row.value} <span className="text-ink-400">({row.kind})</span>
                      </td>
                      <td className="py-1 pr-2">{LAYER_LABELS[row.layer] || row.layer}</td>
                      <td className="py-1">
                        <span className={row.role === 'goal' ? 'chip-accent' : 'chip-good'}>
                          {row.role === 'goal' ? 'goal' : 'already known'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-[11px] text-ink-400">
                Intent read as <strong>{interpretation.intent}</strong> at{' '}
                {fmt.pct(interpretation.intent_confidence)} confidence, via the{' '}
                {interpretation.source} parser.
              </p>
            </details>

            <div className="mt-5 flex items-center justify-between">
              <button type="button" onClick={() => setStep(0)} className="btn-secondary">
                <ArrowLeft className="h-4 w-4" /> Reword it
              </button>
              <button
                type="button"
                disabled={!plannable}
                onClick={() => setStep(2)}
                className="btn-primary"
              >
                That is right <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </section>
        ) : null}

        {/* ---------------------------------------------------------------- */}
        {step === 2 ? (
          <section className="card p-6">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 rounded-lg bg-accent-50 p-2">
                <CalendarClock className="h-4 w-4 text-accent-600" />
              </span>
              <div>
                <h1 className="text-lg font-semibold text-ink-900">Time, level and preferences</h1>
                <p className="mt-1 text-sm text-ink-600">
                  These set the size of the plan. Weekly hours decide how many tracks it can afford;
                  your level decides which tier it starts at.
                </p>
              </div>
            </div>

            {vocabLoading ? <Loading label="Loading options from the catalogue…" /> : null}

            <div className="mt-5 space-y-5">
              <div>
                <span className="label">Where you are now</span>
                <div className="flex flex-wrap gap-2">
                  {['Beginner', 'Intermediate', 'Advanced'].map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setLevel(option)}
                      className={level === option ? 'chip-active' : 'chip'}
                    >
                      {option}
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 text-xs text-ink-400">
                  {level === 'Beginner'
                    ? 'The plan will start from foundations.'
                    : level === 'Intermediate'
                      ? 'Foundations are skipped unless a prerequisite forces them back in.'
                      : 'The plan starts at advanced practice and runs to a capstone.'}
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor="hours">
                    Hours per week — {weeklyHours}h
                  </label>
                  <input
                    id="hours"
                    type="range"
                    min={1}
                    max={40}
                    step={1}
                    value={weeklyHours}
                    onChange={(event) => setWeeklyHours(Number(event.target.value))}
                    className="w-full accent-accent-600"
                  />
                  <p className="mt-1 text-xs text-ink-400">
                    {weeklyHours < 5
                      ? 'A light schedule — expect one focused track.'
                      : weeklyHours < 12
                        ? 'Enough for two tracks over a normal timeline.'
                        : 'Enough to cover up to three tracks in parallel.'}
                  </p>
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
                    value={timeline}
                    onChange={(event) => setTimeline(event.target.value)}
                    className="input"
                    placeholder="24"
                  />
                  <p className="mt-1 text-xs text-ink-400">
                    Used for milestone weeks, and to warn you if the plan overruns.
                  </p>
                </div>
              </div>

              {vocab ? (
                <>
                  <MultiSelect
                    label="Preferred formats"
                    hint="a soft preference — one of the nine ranking factors"
                    options={vocab.formats}
                    selected={formats}
                    onChange={setFormats}
                  />
                  <MultiSelect
                    label="Preferred providers"
                    hint="also soft; a better-matching course from elsewhere still wins"
                    options={vocab.providers}
                    selected={providers}
                    onChange={setProviders}
                  />
                </>
              ) : null}
            </div>

            {previewError ? <ErrorState error={previewError} className="mt-4" /> : null}

            <div className="mt-5 flex items-center justify-between">
              <button type="button" onClick={() => setStep(1)} className="btn-secondary">
                <ArrowLeft className="h-4 w-4" /> Back
              </button>
              <button
                type="button"
                disabled={previewing}
                onClick={() => buildPreview().catch(() => {})}
                className="btn-primary"
              >
                {previewing ? <Spinner /> : <Sparkles className="h-4 w-4" />}
                {previewing ? 'Planning…' : 'Preview my path'}
              </button>
            </div>
          </section>
        ) : null}

        {/* ---------------------------------------------------------------- */}
        {step === 3 && preview ? (
          <PreviewStep
            preview={preview}
            onBack={() => setStep(2)}
            onCommit={() => commit().catch(() => {})}
            committing={committing}
            error={commitError}
          />
        ) : null}
      </div>
    </div>
  )
}

/**
 * The preview step.
 *
 * Shows the plan *and* its analysis — coverage, waivers, and any overrun against
 * the stated deadline — because a roadmap presented without its assumptions is
 * just a list. This is a preview: nothing has been written yet, which is why the
 * commit button is the only thing that changes state.
 */
function PreviewStep({ preview, onBack, onCommit, committing, error }) {
  const plan = preview.plan ?? {}
  const explanation = preview.explanation ?? {}
  const analysis = plan.analysis ?? {}
  const phases = useMemo(() => {
    const byPhase = new Map()
    for (const item of plan.items ?? []) {
      if (!byPhase.has(item.phase_index)) {
        byPhase.set(item.phase_index, { name: item.phase_name, items: [] })
      }
      byPhase.get(item.phase_index).items.push(item)
    }
    return [...byPhase.entries()].sort((a, b) => a[0] - b[0]).map(([index, value]) => ({
      index,
      ...value,
    }))
  }, [plan.items])

  return (
    <section className="card p-6">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 rounded-lg bg-accent-50 p-2">
          <Layers className="h-4 w-4 text-accent-600" />
        </span>
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-ink-900">Your proposed path</h1>
          <p className="mt-1 text-sm text-ink-600">
            <Markdownish text={explanation.headline} />
          </p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ['Courses', plan.total_courses],
          ['Total hours', fmt.hours(plan.total_hours)],
          ['Weeks', plan.estimated_weeks],
          ['Tracks', plan.tracks?.length ?? 0],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-ink-200 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">
              {label}
            </p>
            <p className="text-lg font-semibold tabular-nums text-ink-900">{value}</p>
          </div>
        ))}
      </div>

      {explanation.detail ? (
        <p className="prose-tight mt-4 text-sm leading-relaxed text-ink-600">
          <Markdownish text={explanation.detail} />
        </p>
      ) : null}

      {explanation.caveats?.length ? (
        <ul className="mt-3 space-y-1.5">
          {explanation.caveats.map((caveat, index) => (
            <li
              key={index}
              className="rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-sm text-amber-900"
            >
              <Markdownish text={caveat} />
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-5 space-y-4">
        {phases.map((phase) => (
          <div key={phase.index}>
            <div className="flex items-center gap-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-500">
                {phase.name}
              </h2>
              <span className="h-px flex-1 bg-ink-200" />
              <span className="text-[11px] text-ink-400">
                {fmt.hours(phase.items.reduce((sum, item) => sum + item.hours, 0))}
              </span>
            </div>
            <ol className="mt-2 space-y-1.5">
              {phase.items.map((item) => (
                <li
                  key={item.order_index}
                  className="flex items-start gap-2.5 rounded-lg border border-ink-200 p-2.5"
                >
                  <span
                    className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded
                               bg-ink-100 text-[10px] font-semibold tabular-nums text-ink-600"
                  >
                    {item.order_index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink-900">{item.title}</p>
                    <p className="mt-0.5 text-xs text-ink-500">
                      <Markdownish text={item.rationale} />
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-xs tabular-nums text-ink-500">{fmt.hours(item.hours)}</p>
                    <p className="text-[10px] uppercase tracking-wide text-ink-400">
                      {item.item_type}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        ))}
      </div>

      {analysis.readiness_before !== undefined ? (
        <div className="mt-5 rounded-lg border border-accent-200 bg-accent-50/60 p-3">
          <div className="flex items-center gap-2">
            <BadgeCheck className="h-4 w-4 text-accent-700" />
            <p className="text-sm text-accent-900">
              Goal readiness rises from{' '}
              <strong className="tabular-nums">{fmt.pct(analysis.readiness_before)}</strong> to{' '}
              <strong className="tabular-nums">{fmt.pct(analysis.readiness_after)}</strong> if you
              finish this path.
            </p>
          </div>
        </div>
      ) : null}

      {error ? <ErrorState error={error} className="mt-4" /> : null}

      <div className="mt-5 flex items-center justify-between">
        <button type="button" onClick={onBack} className="btn-secondary">
          <ArrowLeft className="h-4 w-4" /> Adjust
        </button>
        <button type="button" disabled={committing} onClick={onCommit} className="btn-primary">
          {committing ? <Spinner /> : <Check className="h-4 w-4" />}
          Save this as my path
        </button>
      </div>
      <p className="mt-2 text-right text-[11px] text-ink-400">
        Nothing has been saved yet — this preview was computed, not stored.
      </p>
    </section>
  )
}

function Block({ title, hint, children }) {
  return (
    <div className="rounded-lg border border-ink-200 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">{title}</p>
      {hint ? <p className="mb-2 text-[11px] text-ink-400">{hint}</p> : null}
      {children}
    </div>
  )
}

function ChipList({ items, tone = 'default' }) {
  const className = tone === 'accent' ? 'chip-accent' : tone === 'good' ? 'chip-good' : 'chip'
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <span key={item} className={className}>
          {item}
        </span>
      ))}
    </div>
  )
}

function Nothing({ children }) {
  return <p className="text-xs text-ink-400">{children}</p>
}

function MultiSelect({ label, hint, options = [], selected = [], onChange }) {
  return (
    <div>
      <span className="label">{label}</span>
      {hint ? <p className="-mt-1 mb-2 text-[11px] text-ink-400">{hint}</p> : null}
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => {
          const active = selected.includes(option)
          return (
            <button
              key={option}
              type="button"
              onClick={() =>
                onChange(
                  active ? selected.filter((value) => value !== option) : [...selected, option],
                )
              }
              className={active ? 'chip-active' : 'chip'}
            >
              {option}
            </button>
          )
        })}
      </div>
    </div>
  )
}

import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api, pct } from "@/lib/api";
import { useAuth, useRequireAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Chip, ErrorNote, Loading, Meter, Notice, PaceCalibration, Section, Stat } from "@/components/pf";

export const Route = createFileRoute("/onboarding")({
  head: () => ({
    meta: [
      { title: "Set up your path — PathFinder" },
      {
        name: "description",
        content: "Tell PathFinder your goal and preview the learning path it builds for you.",
      },
      { property: "og:title", content: "Set up your path — PathFinder" },
      { property: "og:description", content: "Four short steps from a sentence to a full path." },
    ],
  }),
  component: OnboardingPage,
});

type Interpretation = {
  intent?: string;
  intent_confidence?: number;
  source?: string;
  resolved_tracks?: { track: string; relevance: number; courses?: number }[];
  careers?: string[];
  skills?: string[];
  known_tracks?: string[];
  known_skills?: string[];
  evidence?: { matched: string; value: string; kind: string; layer: string; role: string }[];
  plannable?: boolean;
  weekly_hours?: number | null;
  timeline_weeks?: number | null;
  experience_level?: string | null;
  formats?: string[];
  providers?: string[];
};

type Vocabulary = {
  branches?: string[];
  tracks?: string[];
  skills?: string[];
  careers?: string[];
  sectors?: string[];
  providers?: string[];
  formats?: string[];
  difficulty_levels?: string[];
};

// The generate endpoint's real preview shape nests everything two levels
// deep — { plan: { items, total_courses, ... , analysis }, explanation }.
// There is no top-level title/total_courses/phases[].steps: phases only carry
// their own metadata (name, hours, skills), not a nested item list, so the
// step-by-step view groups `plan.items` by phase_index client-side instead.
type PlanItem = {
  title: string;
  hours?: number;
  item_type?: string;
  phase_index?: number;
  phase_name?: string;
  rationale?: string;
};

type PathPreview = {
  plan?: {
    items?: PlanItem[];
    tracks?: { track: string; relevance?: number }[];
    total_courses?: number;
    total_hours?: number;
    estimated_weeks?: number;
    analysis?: { readiness_before?: number; readiness_after?: number };
  };
  explanation?: { headline?: string; detail?: string; caveats?: string[] };
};

const EXAMPLES = [
  "I'm a final-year CS student and I want to become a machine learning engineer. I know Python, about 10 hours a week.",
  "I'm a marketing analyst who wants to move into data analytics within 6 months.",
  "I can write basic JavaScript and want to be job-ready as a full-stack developer.",
  "I want to move from IT support into cloud engineering, 6 hours a week.",
];

const LEVELS = ["Beginner", "Intermediate", "Advanced"];

function OnboardingPage() {
  const { ready, authed } = useRequireAuth({ allowUnonboarded: true });
  const { refreshUser } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState(1);
  const [goalText, setGoalText] = useState("");
  const [interpretation, setInterpretation] = useState<Interpretation | null>(null);
  const [level, setLevel] = useState("Beginner");
  const [hours, setHours] = useState(10);
  const [deadline, setDeadline] = useState<string>("");
  const [formats, setFormats] = useState<string[]>([]);
  const [providers, setProviders] = useState<string[]>([]);
  const [preview, setPreview] = useState<PathPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  // Populated only when the parse comes back unplannable — real catalogue
  // tracks nearest to the raw text, so "I could not understand that" turns
  // into clickable options instead of a dead end the learner has to guess
  // their way out of.
  const [clarifyOptions, setClarifyOptions] = useState<string[] | null>(null);
  const [clarifying, setClarifying] = useState(false);

  const vocab = useQuery({
    queryKey: ["vocabulary"],
    queryFn: () => api<Vocabulary>("/api/profile/vocabulary"),
    enabled: ready && authed,
    retry: false,
  });

  const toggle = (list: string[], set: (v: string[]) => void, value: string) =>
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  const interpret = async (text: string = goalText) => {
    setBusy(true);
    setError(null);
    setClarifyOptions(null);
    try {
      const r = await api<Interpretation>("/api/profile/interpret", {
        method: "POST",
        body: { text },
      });
      setInterpretation(r);
      if (r.experience_level) setLevel(r.experience_level);
      if (r.weekly_hours) setHours(r.weekly_hours);
      if (r.timeline_weeks) setDeadline(String(r.timeline_weeks));
      if (r.formats?.length) setFormats(r.formats);
      if (r.providers?.length) setProviders(r.providers);
      setStep(2);
      // Nothing matched: fall back to semantic course search on the raw text
      // and offer the nearest real tracks as one-click clarifications, rather
      // than leaving the learner to guess how to rephrase a rejected sentence.
      if (r.plannable === false) {
        setClarifying(true);
        try {
          const found = await api<{ results?: { track?: string }[] }>("/api/catalog/search", {
            method: "POST",
            body: { q: text, limit: 12 },
          });
          const tracks = [
            ...new Set((found.results ?? []).map((c) => c.track).filter((t): t is string => !!t)),
          ].slice(0, 5);
          setClarifyOptions(tracks);
        } catch {
          setClarifyOptions([]);
        } finally {
          setClarifying(false);
        }
      }
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const pickClarification = (track: string) => {
    const clarified = `${goalText.trim()} — specifically ${track}`;
    setGoalText(clarified);
    interpret(clarified).catch(() => {});
  };

  const generatePreview = async () => {
    setBusy(true);
    setError(null);
    try {
      await api("/api/profile", {
        method: "PUT",
        body: {
          // goal_text (or interests/target_role) is what the backend checks to
          // flip `onboarded` to true — omit all three and a new account can
          // generate a full path and still get bounced straight back to this
          // wizard by the dashboard's auth guard, forever.
          goal_text: goalText,
          target_role: interpretation?.careers?.[0] ?? undefined,
          interests: (interpretation?.resolved_tracks ?? []).map((t) => t.track).slice(0, 6),
          experience_level: level,
          weekly_hours: hours,
          timeline_weeks: deadline ? Number(deadline) : null,
          preferred_formats: formats,
          preferred_providers: providers,
        },
      });
      const p = await api<PathPreview>("/api/paths/generate", {
        method: "POST",
        body: { goal_text: goalText, preview: true },
      });
      setPreview(p);
      setStep(4);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const savePath = async () => {
    setBusy(true);
    setError(null);
    try {
      await api("/api/paths/generate", { method: "POST", body: { goal_text: goalText } });
      await refreshUser();
      navigate({ to: "/dashboard", replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  if (!ready) return <Loading />;

  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-16">
      <div className="mb-12 flex items-center gap-2">
        {[1, 2, 3, 4].map((n) => (
          <div
            key={n}
            className={`h-1 flex-1 rounded-full ${n <= step ? "bg-primary" : "bg-secondary"}`}
          />
        ))}
      </div>

      {error ? (
        <div className="mb-6">
          <ErrorNote error={error} />
        </div>
      ) : null}

      {step === 1 ? (
        <div className="space-y-8">
          <div className="space-y-2">
            <h1 className="text-3xl font-semibold">What do you want to be able to do?</h1>
            <p className="text-sm text-muted-foreground">
              One or two sentences is plenty. Mention what you already know and how much time you
              have.
            </p>
          </div>
          <Textarea
            value={goalText}
            onChange={(e) => setGoalText(e.target.value)}
            rows={6}
            className="text-base"
            placeholder="I'm a final-year CS student and I want to become a machine learning engineer, I know Python, about 10 hours a week."
          />
          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map((ex) => (
              <Chip key={ex} onClick={() => setGoalText(ex)}>
                {ex.length > 46 ? `${ex.slice(0, 46)}…` : ex}
              </Chip>
            ))}
          </div>
          <Button size="lg" disabled={!goalText.trim() || busy} onClick={() => interpret()}>
            {busy ? "Reading…" : "Read my goal"}
          </Button>
        </div>
      ) : null}

      {step === 2 && interpretation ? (
        <div className="space-y-10">
          <div className="space-y-2">
            <h1 className="text-3xl font-semibold">Here’s what we understood</h1>
            <p className="text-sm text-muted-foreground">
              {interpretation.intent ? `Read as “${interpretation.intent}”` : null}
              {interpretation.intent_confidence !== undefined
                ? ` · ${pct(interpretation.intent_confidence)} confidence`
                : null}
              {interpretation.source ? ` · ${interpretation.source}` : null}
            </p>
          </div>

          {interpretation.plannable === false ? (
            <div className="space-y-3">
              <Notice>
                We couldn’t match that to anything in the catalogue on its own.
              </Notice>
              {clarifying ? (
                <p className="text-sm text-muted-foreground">Looking for the closest tracks…</p>
              ) : clarifyOptions?.length ? (
                <div>
                  <p className="mb-2 text-sm text-muted-foreground">
                    Did you mean one of these?
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {clarifyOptions.map((track) => (
                      <Chip key={track} onClick={() => pickClarification(track)}>
                        {track}
                      </Chip>
                    ))}
                  </div>
                </div>
              ) : clarifyOptions !== null ? (
                <p className="text-sm text-muted-foreground">
                  Nothing close came up either — try naming a specific role or subject (e.g.
                  “structural engineering” or “become a security analyst”).
                </p>
              ) : null}
            </div>
          ) : null}

          {interpretation.resolved_tracks?.length ? (
            <Section title="Goal tracks">
              <div className="space-y-4 rounded-xl border border-border bg-card p-6">
                {interpretation.resolved_tracks.map((t) => (
                  <Meter
                    key={t.track}
                    value={t.relevance}
                    label={t.track}
                    right={`${pct(t.relevance)}${t.courses ? ` · ${t.courses} courses` : ""}`}
                  />
                ))}
              </div>
            </Section>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <ListCard title="Target role" items={interpretation.careers} />
            <ListCard title="Skills you want" items={interpretation.skills} />
            <ListCard title="Tracks you know" items={interpretation.known_tracks} />
            <ListCard title="Skills you have" items={interpretation.known_skills} />
          </div>

          {interpretation.evidence?.length ? (
            <Accordion type="single" collapsible>
              <AccordionItem value="evidence" className="rounded-xl border border-border px-4">
                <AccordionTrigger className="text-sm">Evidence trail</AccordionTrigger>
                <AccordionContent>
                  <ul className="space-y-3 pb-2">
                    {interpretation.evidence.map((e, i) => (
                      <li key={i} className="text-sm">
                        <span className="text-foreground">“{e.matched}”</span>
                        <span className="text-muted-foreground"> → {e.value}</span>
                        <span className="text-xs text-muted-foreground">
                          {" "}
                          · {e.kind} · {e.layer} · {e.role}
                        </span>
                      </li>
                    ))}
                  </ul>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          ) : null}

          <div className="flex gap-3">
            <Button variant="ghost" onClick={() => setStep(1)}>
              Back
            </Button>
            <Button onClick={() => setStep(3)}>That’s right →</Button>
          </div>
        </div>
      ) : null}

      {step === 3 ? (
        <div className="space-y-10">
          <div className="space-y-2">
            <h1 className="text-3xl font-semibold">How you like to learn</h1>
            <p className="text-sm text-muted-foreground">
              This shapes pacing and which providers we favour.
            </p>
          </div>

          <Section title="Experience level">
            <div className="flex flex-wrap gap-2">
              {(vocab.data?.difficulty_levels?.length
                ? vocab.data.difficulty_levels
                : LEVELS
              ).map((l) => (
                <Chip key={l} active={level === l} onClick={() => setLevel(l)}>
                  {l}
                </Chip>
              ))}
            </div>
          </Section>

          <Section title={`Weekly hours — ${hours}h`}>
            <Slider
              value={[hours]}
              min={1}
              max={40}
              step={1}
              onValueChange={(v) => setHours(v[0])}
              className="max-w-md"
            />
          </Section>

          <Section title="Deadline (optional)">
            <div className="flex max-w-xs items-center gap-3">
              <Input
                type="number"
                min={1}
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                placeholder="—"
              />
              <Label className="text-sm text-muted-foreground">weeks</Label>
            </div>
          </Section>

          {vocab.data?.formats?.length ? (
            <Section title="Preferred formats">
              <div className="flex flex-wrap gap-2">
                {vocab.data.formats.map((f) => (
                  <Chip
                    key={f}
                    active={formats.includes(f)}
                    onClick={() => toggle(formats, setFormats, f)}
                  >
                    {f}
                  </Chip>
                ))}
              </div>
            </Section>
          ) : null}

          {vocab.data?.providers?.length ? (
            <Section title="Preferred providers">
              <div className="flex flex-wrap gap-2">
                {vocab.data.providers.slice(0, 24).map((p) => (
                  <Chip
                    key={p}
                    active={providers.includes(p)}
                    onClick={() => toggle(providers, setProviders, p)}
                  >
                    {p}
                  </Chip>
                ))}
              </div>
            </Section>
          ) : null}

          <div className="flex gap-3">
            <Button variant="ghost" onClick={() => setStep(2)}>
              Back
            </Button>
            <Button onClick={generatePreview} disabled={busy}>
              {busy ? "Building…" : "Preview my path"}
            </Button>
          </div>
        </div>
      ) : null}

      {step === 4 && preview ? (
        <div className="space-y-10">
          <div className="space-y-2">
            <h1 className="text-3xl font-semibold">Your proposed path</h1>
            {preview.explanation?.headline ? (
              <p className="text-sm text-muted-foreground">{preview.explanation.headline}</p>
            ) : null}
            {preview.plan?.tracks?.length ? (
              <p className="text-sm text-muted-foreground">
                {preview.plan.tracks.map((t) => t.track).join(" · ")}
              </p>
            ) : null}
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Courses" value={preview.plan?.total_courses ?? "—"} />
            <Stat label="Hours" value={preview.plan?.total_hours ?? "—"} />
            <Stat label="Weeks" value={preview.plan?.estimated_weeks ?? "—"} />
          </div>

          {preview.plan?.analysis?.readiness_before !== undefined ||
          preview.plan?.analysis?.readiness_after !== undefined ? (
            <div className="rounded-xl border border-border bg-accent px-6 py-5">
              <p className="text-sm text-accent-foreground">
                Readiness for this goal moves from{" "}
                <strong className="font-semibold">
                  {pct(preview.plan?.analysis?.readiness_before)}
                </strong>{" "}
                to{" "}
                <strong className="font-semibold">
                  {pct(preview.plan?.analysis?.readiness_after)}
                </strong>
                .
              </p>
            </div>
          ) : null}

          <PaceCalibration totalHours={preview.plan?.total_hours} currentHours={hours} />

          <div className="space-y-8">
            {phasesFromItems(preview.plan?.items).map(([phaseName, steps], i) => (
              <div key={phaseName ?? i} className="space-y-3">
                <h2 className="text-sm font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  {phaseName ?? `Phase ${i + 1}`}
                </h2>
                <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
                  {steps.map((s, j) => (
                    <li key={j} className="px-5 py-4">
                      <div className="flex items-baseline justify-between gap-4">
                        <p className="text-sm font-medium">{s.title}</p>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {s.item_type ?? ""}
                          {s.hours ? ` · ${s.hours}h` : ""}
                        </span>
                      </div>
                      {s.rationale ? (
                        <p className="mt-1 text-xs text-muted-foreground">{s.rationale}</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          {preview.explanation?.caveats?.length ? (
            <div className="space-y-2">
              {preview.explanation.caveats.map((c, i) => (
                <Notice key={i}>{c}</Notice>
              ))}
            </div>
          ) : null}

          <div className="flex gap-3">
            <Button variant="ghost" onClick={() => setStep(3)}>
              Back
            </Button>
            <Button size="lg" onClick={savePath} disabled={busy}>
              {busy ? "Saving…" : "Save this as my path"}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Groups plan items by phase, in first-seen (already prerequisite-ordered) order. */
function phasesFromItems(items: PlanItem[] = []): [string | undefined, PlanItem[]][] {
  const order: (string | undefined)[] = [];
  const byPhase = new Map<string | undefined, PlanItem[]>();
  for (const item of items) {
    const key = item.phase_name;
    if (!byPhase.has(key)) {
      byPhase.set(key, []);
      order.push(key);
    }
    byPhase.get(key)!.push(item);
  }
  return order.map((key) => [key, byPhase.get(key) ?? []]);
}

function ListCard({ title, items }: { title: string; items?: string[] }) {
  return (
    <div className="rounded-xl border border-border bg-card px-5 py-4">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">{title}</p>
      {items?.length ? (
        <p className="mt-2 text-sm leading-relaxed">{items.join(", ")}</p>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">—</p>
      )}
    </div>
  );
}

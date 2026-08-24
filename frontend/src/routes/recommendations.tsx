import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useRequireAuth } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Chip, Drivers, Empty, ErrorNote, FeedbackBar, Loading, PageHeader } from "@/components/pf";

export const Route = createFileRoute("/recommendations")({
  head: () => ({
    meta: [
      { title: "Recommendations — PathWise" },
      {
        name: "description",
        content: "Ranked course recommendations, each with the drivers behind its score.",
      },
      { property: "og:title", content: "Recommendations — PathWise" },
      { property: "og:description", content: "Why each course is recommended, in plain numbers." },
    ],
  }),
  component: RecommendationsPage,
});

type Course = {
  id?: string | number;
  course_id?: string | number;
  title?: string;
  track?: string;
  branch?: string;
  provider?: string;
  hours?: number;
  rating?: number;
  difficulty?: string;
  skills?: string[];
};

type Rec = {
  course: Course;
  score?: number;
  // The raw per-factor attribution vector — pass this back on feedback so the
  // backend can credit/discredit the right factors even though this course
  // isn't on the learner's path yet (it can only recover this itself from a
  // stored PathItem, which a bare recommendation isn't).
  factors?: Record<string, number>;
  explanation?: { headline?: string; drivers?: { factor: string; share: number }[] };
  alternatives?: { course_id: string | number; title?: string; provider?: string; hours?: number; rating?: number }[];
};

const LIMITS = [5, 10, 20, 30];

function RecommendationsPage() {
  const { ready, authed } = useRequireAuth();
  const [limit, setLimit] = useState(10);
  const [excludePlanned, setExcludePlanned] = useState(true);
  const [goalText, setGoalText] = useState("");
  const [results, setResults] = useState<Rec[] | null>(null);

  const run = useMutation({
    mutationFn: () =>
      api<{ results?: Rec[] }>("/api/recommendations", {
        method: "POST",
        body: {
          goal_text: goalText.trim() || undefined,
          limit,
          exclude_planned: excludePlanned,
        },
      }),
    onSuccess: (data) => setResults(data.results ?? []),
  });

  const started = ready && authed;

  return (
    <AppShell>
      <div className="page space-y-12">
        <PageHeader
          title="Recommendations"
          subtitle="Ranked against your goal and what you already know."
        />

        <div className="space-y-5 rounded-2xl border border-border bg-card p-6">
          <p className="text-sm text-muted-foreground">
            These control how the list below is built — none of it changes your saved profile.
          </p>

          <div className="flex flex-wrap items-center gap-6">
            <div className="flex items-center gap-2">
              <span className="text-xs uppercase tracking-wider text-muted-foreground">
                Results to show
              </span>
              {LIMITS.map((l) => (
                <Chip key={l} active={limit === l} onClick={() => setLimit(l)}>
                  {l}
                </Chip>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="exclude"
                checked={excludePlanned}
                onCheckedChange={setExcludePlanned}
              />
              <Label htmlFor="exclude" className="text-sm text-muted-foreground">
                Hide courses already on my path
              </Label>
            </div>
          </div>

          <div>
            <Label htmlFor="goal-override" className="text-sm font-medium text-foreground">
              Rank against a different goal
              <span className="ml-1 font-normal text-muted-foreground">(optional)</span>
            </Label>
            <p className="mb-2 mt-0.5 text-xs text-muted-foreground">
              By default this ranks against the goal saved in your profile. Type a different one
              here to preview what it would recommend instead — this is a one-off search, not a
              change to your path or profile.
            </p>
            <div className="flex flex-wrap gap-3">
              <Input
                id="goal-override"
                value={goalText}
                onChange={(e) => setGoalText(e.target.value)}
                placeholder="e.g. I want to move into cloud engineering"
                className="max-w-md flex-1"
              />
              <Button onClick={() => run.mutate()} disabled={!started || run.isPending}>
                {run.isPending ? "Ranking…" : "Get recommendations"}
              </Button>
            </div>
          </div>
        </div>

        {run.isPending ? <Loading label="Ranking courses…" /> : null}
        {run.isError ? <ErrorNote error={run.error} /> : null}
        {results && results.length === 0 ? (
          <Empty title="No recommendations" detail="Try widening the count or clearing the goal override." />
        ) : null}

        <div className="space-y-4">
          {(results ?? []).map((r, i) => {
            const c = r.course ?? {};
            const cid = c.course_id ?? c.id;
            const skills = c.skills ?? [];
            return (
              <article
                key={`${cid}-${i}`}
                className="animate-in fade-in slide-in-from-bottom-3 fill-mode-both rounded-2xl border border-border bg-card p-6 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/50 hover:bg-accent/20 hover:shadow-md [animation-duration:500ms]"
                style={{ animationDelay: `${Math.min(i, 11) * 50}ms` }}
              >
                <div className="flex gap-5">
                  <span className="mt-0.5 font-display text-sm text-muted-foreground tabular-nums">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div className="min-w-0 flex-1 space-y-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-3">
                      <h2 className="text-lg font-semibold">
                        {cid !== undefined ? (
                          <Link
                            to="/courses/$courseId"
                            params={{ courseId: String(cid) }}
                            className="hover:text-primary"
                          >
                            {c.title ?? "Untitled course"}
                          </Link>
                        ) : (
                          (c.title ?? "Untitled course")
                        )}
                      </h2>
                      <div className="flex shrink-0 items-center gap-3">
                        {r.score !== undefined ? (
                          <span className="text-sm tabular-nums text-muted-foreground">
                            {Math.round(r.score * 100)}% match
                          </span>
                        ) : null}
                        <FeedbackBar courseId={cid} factors={r.factors} />
                      </div>
                    </div>

                    <p className="text-xs text-muted-foreground">
                      {[c.track, c.branch].filter(Boolean).join(" · ") || "—"}
                    </p>

                    {r.explanation?.headline ? (
                      <p className="text-sm">{r.explanation.headline}</p>
                    ) : null}

                    {r.explanation?.drivers?.length ? (
                      <div className="flex flex-wrap gap-2">
                        {r.explanation.drivers.slice(0, 3).map((d) => (
                          <Chip key={d.factor} as="span">
                            {d.factor} {Math.round(d.share * 100)}%
                          </Chip>
                        ))}
                      </div>
                    ) : null}

                    <p className="text-xs text-muted-foreground">
                      {[
                        c.hours ? `${c.hours}h` : null,
                        c.rating ? `${c.rating}★` : null,
                        c.provider,
                        c.difficulty,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </p>

                    {skills.length ? (
                      <p className="text-xs text-muted-foreground">
                        Teaches: {skills.slice(0, 5).join(", ")}
                        {skills.length > 5 ? ` +${skills.length - 5} more` : ""}
                      </p>
                    ) : null}

                    <Accordion type="single" collapsible>
                      {r.explanation?.drivers?.length ? (
                        <AccordionItem value="why" className="border-t border-border">
                          <AccordionTrigger className="text-sm">Why this?</AccordionTrigger>
                          <AccordionContent>
                            <Drivers drivers={r.explanation.drivers} />
                          </AccordionContent>
                        </AccordionItem>
                      ) : null}
                      {r.alternatives?.length ? (
                        <AccordionItem value="alts" className="border-t border-border">
                          <AccordionTrigger className="text-sm">
                            {r.alternatives.length} other providers, same level
                          </AccordionTrigger>
                          <AccordionContent>
                            <ul className="space-y-2">
                              {r.alternatives.map((a) => (
                                <li
                                  key={String(a.course_id)}
                                  className="flex items-baseline justify-between gap-4 text-sm"
                                >
                                  <Link
                                    to="/courses/$courseId"
                                    params={{ courseId: String(a.course_id) }}
                                    className="truncate hover:text-primary"
                                  >
                                    {a.title}
                                  </Link>
                                  <span className="shrink-0 text-xs text-muted-foreground">
                                    {[a.provider, a.hours ? `${a.hours}h` : null, a.rating ? `${a.rating}★` : null]
                                      .filter(Boolean)
                                      .join(" · ")}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </AccordionContent>
                        </AccordionItem>
                      ) : null}
                    </Accordion>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </AppShell>
  );
}

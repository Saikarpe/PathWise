import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Bar,
  BarChart,
  CartesianGrid,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api, pct } from "@/lib/api";
import { useRequireAuth } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Empty, ErrorNote, FeedbackBar, Loading, Meter, Notice, Section, Stat } from "@/components/pf";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — PathFinder" },
      { name: "description", content: "Your next step, your progress and your readiness." },
      { property: "og:title", content: "Dashboard — PathFinder" },
      { property: "og:description", content: "See exactly what to do next on your learning path." },
    ],
  }),
  component: DashboardPage,
});

type Dashboard = {
  has_path?: boolean;
  progress?: number;
  narrative?: { headline?: string; detail?: string; caveats?: string[] };
  next_item?: {
    id?: string | number;
    title?: string;
    item_type?: string;
    course_id?: string | number;
    hours?: number;
    phase_name?: string;
    rationale?: string;
    skills?: string[];
  } | null;
  next_milestone?: { title?: string; target_week?: number } | null;
  completed_courses?: number;
  total_courses?: number;
  hours_completed?: number;
  total_hours?: number;
  skills_proficient?: number;
  skills_in_progress?: number;
  readiness_before?: number;
  readiness_after?: number;
  weekly_hours?: number;
  weeks_elapsed?: number;
  weeks_behind?: number;
  phases?: {
    index?: number;
    name?: string;
    progress?: number;
    completed?: number;
    total?: number;
    hours?: number;
    hours_done?: number;
  }[];
  milestones?: { title?: string; target_week?: number; achieved?: boolean }[];
  skill_levels?: { skill: string; proficiency: number; declared?: boolean }[];
  activity?: { week: string; hours: number }[];
  path?: { id?: string | number; title?: string; tracks?: string[]; estimated_weeks?: number };
};

function DashboardPage() {
  const { ready, authed } = useRequireAuth();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api<Dashboard>("/api/dashboard"),
    enabled: ready && authed,
    retry: false,
  });

  const progressMutation = useMutation({
    mutationFn: async (vars: { status: "in_progress" | "completed" }) => {
      const pathId = q.data?.path?.id;
      const courseId = q.data?.next_item?.course_id;
      if (pathId === undefined || courseId === undefined)
        throw new Error("This step has no course to track.");
      return api<{ narrative?: string }>(`/api/paths/${pathId}/progress`, {
        method: "POST",
        body: { course_id: courseId, status: vars.status },
      });
    },
    // `narrative` is what the learner actually gained (skills pushed over the
    // proficiency line) — deliberately not the ranking-model `adaptation`
    // note, which is about what the recommender changed about itself, not
    // what finishing this course got you.
    onSuccess: (data) => {
      if (data.narrative) toast.success(data.narrative);
    },
    onSettled: () => {
      setBusy(null);
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });

  const d = q.data;
  const skills = (d?.skill_levels ?? []).slice(0, 10);

  return (
    <AppShell>
      <div className="page space-y-16">
        {!ready || q.isLoading ? <Loading /> : null}
        {q.isError ? <ErrorNote error={q.error} /> : null}

        {d && d.has_path === false ? (
          <Empty
            title="You don’t have a path yet"
            detail="Tell us what you want to be able to do and we’ll build one."
            action={
              <Link to="/onboarding">
                <Button className="mt-2">Build my path</Button>
              </Link>
            }
          />
        ) : null}

        {d && d.has_path !== false ? (
          <>
            <section className="space-y-8">
              <div className="max-w-2xl space-y-2">
                <h1 className="text-3xl font-semibold leading-tight">
                  {d.narrative?.headline ?? d.path?.title ?? "Your path"}
                </h1>
                {d.narrative?.detail ? (
                  <p className="text-sm text-muted-foreground">{d.narrative.detail}</p>
                ) : null}
              </div>

              {d.next_item ? (
                <div className="rounded-2xl border border-border bg-card p-8">
                  <div className="flex items-start justify-between gap-4">
                    <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                      Do this next
                      {d.next_item.phase_name ? ` · ${d.next_item.phase_name}` : ""}
                    </p>
                    <FeedbackBar courseId={d.next_item.course_id} pathId={d.path?.id} />
                  </div>
                  <h2 className="mt-3 text-2xl font-semibold">{d.next_item.title}</h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {[d.next_item.item_type, d.next_item.hours ? `${d.next_item.hours}h` : null]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </p>
                  <div className="mt-6 flex flex-wrap gap-3">
                    <Button
                      onClick={() => {
                        setBusy("in_progress");
                        progressMutation.mutate({ status: "in_progress" });
                      }}
                      disabled={busy !== null}
                    >
                      {busy === "in_progress" ? "Saving…" : "Start"}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setBusy("completed");
                        progressMutation.mutate({ status: "completed" });
                      }}
                      disabled={busy !== null}
                    >
                      {busy === "completed" ? "Saving…" : "Mark complete"}
                    </Button>
                  </div>
                  {progressMutation.isError ? (
                    <div className="mt-4">
                      <ErrorNote error={progressMutation.error} />
                    </div>
                  ) : null}
                  {d.next_item.rationale || d.next_item.skills?.length ? (
                    <Accordion type="single" collapsible className="mt-6">
                      <AccordionItem value="why" className="border-t border-border">
                        <AccordionTrigger className="text-sm">Why this?</AccordionTrigger>
                        <AccordionContent className="space-y-3 text-sm text-muted-foreground">
                          {d.next_item.rationale ? <p>{d.next_item.rationale}</p> : null}
                          {d.next_item.skills?.length ? (
                            <p>Builds: {d.next_item.skills.join(", ")}</p>
                          ) : null}
                        </AccordionContent>
                      </AccordionItem>
                    </Accordion>
                  ) : null}
                </div>
              ) : null}

              {d.narrative?.caveats?.length
                ? d.narrative.caveats.map((c, i) => <Notice key={i}>{c}</Notice>)
                : null}
            </section>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat
                label="Progress"
                value={pct(d.progress)}
                sub={
                  d.total_courses !== undefined
                    ? `${d.completed_courses ?? 0}/${d.total_courses} courses`
                    : undefined
                }
              />
              <Stat
                label="Hours"
                value={d.hours_completed ?? "—"}
                sub={d.total_hours !== undefined ? `of ${d.total_hours}h planned` : undefined}
              />
              <Stat
                label="Skills proficient"
                value={d.skills_proficient ?? "—"}
                sub={
                  d.skills_in_progress !== undefined
                    ? `${d.skills_in_progress} in progress`
                    : undefined
                }
              />
              <Stat
                label="Readiness"
                value={pct(d.readiness_after)}
                sub={
                  d.readiness_before !== undefined ? `from ${pct(d.readiness_before)}` : undefined
                }
              />
            </div>

            {d.phases?.length ? (
              <Section title="Phases">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {d.phases.map((p, i) => (
                    <div key={p.name ?? i} className="rounded-xl border border-border bg-card p-5">
                      <Meter
                        value={p.progress ?? 0}
                        label={p.name ?? `Phase ${i + 1}`}
                        right={
                          p.total !== undefined ? `${p.completed ?? 0}/${p.total}` : pct(p.progress)
                        }
                      />
                    </div>
                  ))}
                </div>
              </Section>
            ) : null}

            {d.next_milestone ? (
              <Section title="Next milestone">
                <div className="rounded-xl border border-border bg-card px-6 py-5">
                  <p className="text-sm font-medium">{d.next_milestone.title}</p>
                  {d.next_milestone.target_week !== undefined ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Target week {d.next_milestone.target_week}
                    </p>
                  ) : null}
                </div>
              </Section>
            ) : null}

            {skills.length ? (
              <div className="grid gap-12 lg:grid-cols-2">
                <Section title="Skill levels" hint="Self-rated skills are marked.">
                  <div className="space-y-4 rounded-xl border border-border bg-card p-6">
                    {skills.map((s) => (
                      <Meter
                        key={s.skill}
                        value={s.proficiency}
                        label={`${s.skill}${s.declared ? " · self-rated" : ""}`}
                        right={pct(s.proficiency)}
                      />
                    ))}
                  </div>
                </Section>
                <Section title="Skill shape">
                  <div className="h-80 rounded-xl border border-border bg-card p-6">
                    <ResponsiveContainer width="100%" height="100%">
                      <RadarChart
                        data={skills.map((s) => ({
                          skill: s.skill,
                          value: Math.round((s.proficiency ?? 0) * 100),
                        }))}
                      >
                        <PolarGrid stroke="var(--border)" />
                        <PolarAngleAxis
                          dataKey="skill"
                          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                        />
                        <Radar
                          dataKey="value"
                          stroke="var(--primary)"
                          fill="var(--primary)"
                          fillOpacity={0.18}
                        />
                      </RadarChart>
                    </ResponsiveContainer>
                  </div>
                </Section>
              </div>
            ) : null}

            {d.activity?.length ? (
              <Section
                title="Weekly activity"
                hint={
                  d.weekly_hours ? `Committed budget: ${d.weekly_hours}h per week` : undefined
                }
              >
                <div className="h-72 rounded-xl border border-border bg-card p-6">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={d.activity}>
                      <CartesianGrid vertical={false} stroke="var(--border)" />
                      <XAxis
                        dataKey="week"
                        tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                        tickLine={false}
                        axisLine={false}
                        width={28}
                      />
                      <Tooltip cursor={{ fill: "var(--secondary)" }} />
                      {d.weekly_hours ? (
                        <ReferenceLine
                          y={d.weekly_hours}
                          stroke="var(--muted-foreground)"
                          strokeDasharray="4 4"
                        />
                      ) : null}
                      <Bar dataKey="hours" fill="var(--primary)" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Section>
            ) : null}
          </>
        ) : null}
      </div>
    </AppShell>
  );
}

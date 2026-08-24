import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api, pct } from "@/lib/api";
import { useRequireAuth } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { RoadmapGraph, type GraphEdge, type GraphNode } from "@/components/RoadmapGraph";
import { SkillGapRadar, type GapSkill } from "@/components/SkillGapRadar";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Drivers,
  Empty,
  ErrorNote,
  FeedbackBar,
  Loading,
  Notice,
  PaceCalibration,
  PageHeader,
  Section,
  Stat,
} from "@/components/pf";

export const Route = createFileRoute("/roadmap")({
  head: () => ({
    meta: [
      { title: "Roadmap — PathWise" },
      { name: "description", content: "Your learning path laid out phase by phase, with prerequisites." },
      { property: "og:title", content: "Roadmap — PathWise" },
      { property: "og:description", content: "Every step of your path, in order, with the reasoning behind it." },
    ],
  }),
  component: RoadmapPage,
});

type ActivePath = {
  id?: string | number;
  title?: string;
  tracks?: string[];
  goal_text?: string;
  estimated_weeks?: number;
  total_hours?: number;
  total_courses?: number;
  milestones?: { title?: string; target_week?: number; achieved?: boolean; skills?: string[] }[];
  // There is no top-level readiness/gap/progress on the path response — the
  // planner's transparency data lives under `analysis`, and per-skill status
  // (not flat name lists) is what the gap analysis actually returns.
  analysis?: {
    readiness_before?: number;
    readiness_after?: number;
    gap?: {
      // `required` and `current` are what make the gap drawable rather than
      // just listable — see SkillGapRadar.
      skills?: GapSkill[];
    };
  };
};

// GraphNode/GraphEdge live with the component that renders them, so there is
// one definition rather than a copy that can drift. The copy that used to be
// here declared `id: string`, but the API sends `order_index` — a number.
type Graph = {
  nodes?: GraphNode[];
  edges?: GraphEdge[];
};

type Explain = {
  headline?: string;
  detail?: string;
  drivers?: { factor: string; share: number }[];
  caveats?: string[];
};

// The endpoint wraps its payload as { item, course, explanation } — the
// headline/detail/drivers the sheet renders live one level down, under
// `explanation`, not at the top of the response.
type ExplainResponse = { explanation?: Explain };

function RoadmapPage() {
  const { ready, authed } = useRequireAuth();
  const [open, setOpen] = useState<GraphNode | null>(null);

  const pathQ = useQuery({
    queryKey: ["active-path"],
    queryFn: () => api<ActivePath>("/api/paths/active"),
    enabled: ready && authed,
    retry: false,
  });
  const pathId = pathQ.data?.id;

  const graphQ = useQuery({
    queryKey: ["graph", pathId],
    queryFn: () => api<Graph>(`/api/paths/${pathId}/graph`),
    enabled: pathId !== undefined,
    retry: false,
  });

  const explainQ = useQuery({
    queryKey: ["explain", pathId, open?.item_id],
    queryFn: () => api<ExplainResponse>(`/api/paths/${pathId}/items/${open?.item_id}/explain`),
    select: (data) => data.explanation,
    enabled: pathId !== undefined && open !== null,
    retry: false,
  });

  const nodes = graphQ.data?.nodes ?? [];

  // No top-level progress field — derive it from each step's own status,
  // same source the graph nodes already carry.
  const progress = nodes.length
    ? nodes.filter((n) => n.status === "completed").length / nodes.length
    : undefined;

  const gapSkills = pathQ.data?.analysis?.gap?.skills ?? [];
  const gap = {
    required_skills: gapSkills.map((s) => s.skill),
    mastered_skills: gapSkills.filter((s) => s.status === "mastered").map((s) => s.skill),
    open_skills: gapSkills.filter((s) => s.status !== "mastered").map((s) => s.skill),
  };

  return (
    <AppShell>
      <div className="page space-y-14">
        <PageHeader
          title={pathQ.data?.title ?? "Roadmap"}
          subtitle={pathQ.data?.tracks?.length ? pathQ.data.tracks.join(" · ") : undefined}
        />

        {!ready || pathQ.isLoading ? <Loading /> : null}
        {pathQ.isError ? <ErrorNote error={pathQ.error} /> : null}
        {pathQ.data && !pathId ? (
          <Empty title="No active path" detail="Generate a path from onboarding first." />
        ) : null}

        {pathId !== undefined ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Steps" value={nodes.length || "—"} />
              <Stat label="Hours" value={pathQ.data?.total_hours ?? "—"} />
              <Stat label="Weeks" value={pathQ.data?.estimated_weeks ?? "—"} />
              <Stat label="Progress" value={pct(progress)} />
            </div>

            <Section
              title="The plan"
              hint="Arrows are hard prerequisites — a step cannot start until everything pointing into it is done. Left-to-right is phase order."
            >
              {graphQ.isLoading ? <Loading /> : null}
              {graphQ.isError ? <ErrorNote error={graphQ.error} /> : null}

              <RoadmapGraph
                nodes={nodes}
                edges={graphQ.data?.edges ?? []}
                onSelect={setOpen}
                selectedId={open?.id ?? null}
              />

              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <svg width="26" height="8" aria-hidden="true">
                    <line x1="0" y1="4" x2="20" y2="4" stroke="var(--color-primary)" strokeWidth="1.75" strokeOpacity="0.5" />
                    <path d="M 20 1 L 26 4 L 20 7 z" fill="var(--color-primary)" />
                  </svg>
                  must be completed first
                </span>
                {[
                  ["completed", "var(--color-success)"],
                  ["in progress", "var(--color-primary)"],
                  ["not started", "var(--color-muted-foreground)"],
                ].map(([label, color]) => (
                  <span key={label} className="inline-flex items-center gap-1.5">
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: color }}
                    />
                    {label}
                  </span>
                ))}
                <span className="text-muted-foreground/70">click any step for its reasoning</span>
              </div>
            </Section>

            {pathQ.data?.milestones?.length ? (
              <Section title="Milestones">
                <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
                  {pathQ.data.milestones.map((m, i) => (
                    <li key={i} className="flex items-center justify-between gap-4 px-5 py-4">
                      <span className="text-sm">{m.title}</span>
                      <span
                        className={`text-xs ${m.achieved ? "text-success" : "text-muted-foreground"}`}
                      >
                        {m.achieved ? "achieved" : m.target_week ? `week ${m.target_week}` : "—"}
                      </span>
                    </li>
                  ))}
                </ul>
              </Section>
            ) : null}

            <PaceCalibration totalHours={pathQ.data?.total_hours} />

            <Section
              title="How this plan was built"
              hint="The distance between the two rings is the gap this path exists to close."
            >
              <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
                <div className="rounded-xl border border-border bg-card px-6 py-5">
                  <SkillGapRadar skills={gapSkills} />
                </div>

                <div className="rounded-xl border border-border bg-card px-6 py-5">
                  <p className="text-sm text-muted-foreground">
                    Readiness for this goal moves from{" "}
                    <strong className="font-medium text-foreground">
                      {pct(pathQ.data?.analysis?.readiness_before)}
                    </strong>{" "}
                    to{" "}
                    <strong className="font-medium text-foreground">
                      {pct(pathQ.data?.analysis?.readiness_after)}
                    </strong>
                    .
                  </p>

                  <div className="mt-4 grid grid-cols-3 gap-3">
                    {[
                      ["Required", gap.required_skills.length, "text-foreground"],
                      ["Mastered", gap.mastered_skills.length, "text-success"],
                      ["Still open", gap.open_skills.length, "text-primary"],
                    ].map(([label, value, tone]) => (
                      <div key={String(label)} className="rounded-lg border border-border px-3 py-2.5">
                        <p className="text-xs text-muted-foreground">{label}</p>
                        <p className={`mt-0.5 text-xl font-semibold tabular-nums ${tone}`}>{value}</p>
                      </div>
                    ))}
                  </div>

                  <Accordion type="single" collapsible className="mt-4">
                    <AccordionItem value="gap" className="border-t border-border">
                      <AccordionTrigger className="text-sm">Every skill, listed</AccordionTrigger>
                      <AccordionContent className="grid gap-4 sm:grid-cols-3">
                        <SkillList title="Required" items={gap.required_skills} />
                        <SkillList title="Already mastered" items={gap.mastered_skills} />
                        <SkillList title="Still open" items={gap.open_skills} />
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                </div>
              </div>
            </Section>
          </>
        ) : null}
      </div>

      <Sheet open={open !== null} onOpenChange={(v) => !v && setOpen(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <div className="flex items-start justify-between gap-4">
              <SheetTitle>{open?.title}</SheetTitle>
              <FeedbackBar courseId={open?.course_id} pathId={pathId} className="shrink-0" />
            </div>
            <SheetDescription>
              {[open?.type, open?.hours ? `${open.hours}h` : null, open?.phase_name]
                .filter(Boolean)
                .join(" · ")}
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-6 px-4 pb-8">
            {explainQ.isLoading ? <Loading /> : null}
            {explainQ.isError ? <ErrorNote error={explainQ.error} /> : null}
            {explainQ.data ? (
              <>
                {explainQ.data.headline ? (
                  <p className="text-sm font-medium">{explainQ.data.headline}</p>
                ) : null}
                {explainQ.data.detail ? (
                  <p className="text-sm text-muted-foreground">{explainQ.data.detail}</p>
                ) : null}
                <Drivers drivers={explainQ.data.drivers} />
                {explainQ.data.caveats?.map((c, i) => <Notice key={i}>{c}</Notice>)}
              </>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>
    </AppShell>
  );
}

function SkillList({ title, items }: { title: string; items?: string[] }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wider text-muted-foreground">{title}</p>
      <p className="mt-2 text-sm leading-relaxed">{items?.length ? items.join(", ") : "—"}</p>
    </div>
  );
}

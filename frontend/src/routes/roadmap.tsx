import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api, pct } from "@/lib/api";
import { useRequireAuth } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
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
      skills?: { skill: string; status: "mastered" | "in_progress" | "missing" }[];
    };
  };
};

type GraphNode = {
  id: string;
  item_id: string | number;
  type?: string;
  title?: string;
  course_id?: string | number;
  phase_index?: number;
  phase_name?: string;
  hours?: number;
  skills?: string[];
  status?: string;
};

type Graph = {
  nodes?: GraphNode[];
  edges?: { source: string; target: string; kind?: string }[];
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
  const prereqTargets = new Set(
    (graphQ.data?.edges ?? []).filter((e) => e.kind === "prerequisite").map((e) => e.target),
  );

  const phases = new Map<number, { name: string; nodes: GraphNode[] }>();
  nodes.forEach((n) => {
    const idx = n.phase_index ?? 0;
    if (!phases.has(idx)) phases.set(idx, { name: n.phase_name ?? `Phase ${idx + 1}`, nodes: [] });
    phases.get(idx)!.nodes.push(n);
  });
  const phaseList = [...phases.entries()].sort((a, b) => a[0] - b[0]);

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
              hint="Solid border = prerequisite of an earlier step. Dashed = suggested order."
            >
              {graphQ.isLoading ? <Loading /> : null}
              {graphQ.isError ? <ErrorNote error={graphQ.error} /> : null}
              <div className="grid gap-6 lg:grid-cols-3">
                {phaseList.map(([idx, phase]) => (
                  <div key={idx} className="space-y-3">
                    <h3 className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                      {phase.name}
                    </h3>
                    <div className="space-y-3">
                      {phase.nodes.map((n) => (
                        <button
                          key={n.id}
                          onClick={() => setOpen(n)}
                          className={`w-full rounded-xl border bg-card px-5 py-4 text-left transition-colors hover:border-primary/50 hover:bg-accent/30 ${
                            prereqTargets.has(n.id) ? "border-border" : "border-dashed border-border"
                          }`}
                        >
                          <p className="text-sm font-medium">{n.title}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {[n.type, n.hours ? `${n.hours}h` : null, n.status]
                              .filter(Boolean)
                              .join(" · ") || "—"}
                          </p>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
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

            <Section title="How this plan was built">
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
                <Accordion type="single" collapsible className="mt-4">
                  <AccordionItem value="gap" className="border-t border-border">
                    <AccordionTrigger className="text-sm">Gap analysis</AccordionTrigger>
                    <AccordionContent className="grid gap-4 sm:grid-cols-3">
                      <SkillList title="Required" items={gap.required_skills} />
                      <SkillList title="Already mastered" items={gap.mastered_skills} />
                      <SkillList title="Still open" items={gap.open_skills} />
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
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

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Briefcase, ChevronDown, Layers } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Chip, ErrorNote, Loading, Meter } from "@/components/pf";

export type SkillRow = { skill: string; proficiency: number; declared?: boolean };

type SkillDetail = {
  skill?: string;
  course_count?: number;
  prevalence?: number;
  central_to_tracks?: { track: string; centrality: number; importance: number; required_level: number }[];
  central_to_careers?: { career: string; centrality: number }[];
};

/**
 * The detail behind "6 skills proficient".
 *
 * A bare count answers nothing a learner actually wants to know — which
 * skills, and does the platform even understand why they matter. This lists
 * them with their measured proficiency, and each one expands into real
 * catalogue data (`/api/catalog/skills/{skill}`): how common it is, which
 * tracks and careers it's actually central to. Not decoration — the same
 * numbers the gap analysis and ranker read, just made visible.
 */
export function SkillsDrawer({
  open,
  onOpenChange,
  proficient,
  inProgress,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  proficient: SkillRow[];
  inProgress: SkillRow[];
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Your skills</SheetTitle>
          <SheetDescription>
            Proficiency is measured from completed courses plus anything you've self-rated. Tap a
            skill to see where it actually matters in the catalogue.
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-8 px-4 pb-8">
          <SkillGroup title="Proficient" rows={proficient} />
          <SkillGroup title="In progress" rows={inProgress} />
          {!proficient.length && !inProgress.length ? (
            <p className="text-sm text-muted-foreground">
              Nothing measured yet — completing a course or self-rating in your profile populates
              this.
            </p>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function SkillGroup({ title, rows }: { title: string; rows: SkillRow[] }) {
  if (!rows.length) return null;
  return (
    <div>
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title} · {rows.length}
      </p>
      <div className="space-y-2">
        {rows.map((row) => (
          <SkillDetailRow key={row.skill} row={row} />
        ))}
      </div>
    </div>
  );
}

function SkillDetailRow({ row }: { row: SkillRow }) {
  const [expanded, setExpanded] = useState(false);

  const q = useQuery({
    queryKey: ["skill-detail", row.skill],
    queryFn: () => api<SkillDetail>(`/api/catalog/skills/${encodeURIComponent(row.skill)}`),
    enabled: expanded,
    retry: false,
  });

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-accent/30"
      >
        <div className="min-w-0 flex-1">
          <Meter
            value={row.proficiency}
            label={`${row.skill}${row.declared ? " · self-rated" : ""}`}
            right={`${Math.round(row.proficiency * 100)}%`}
          />
        </div>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
            expanded && "rotate-180",
          )}
        />
      </button>

      {expanded ? (
        <div className="animate-in fade-in slide-in-from-top-1 border-t border-border bg-secondary/20 px-3 py-3 duration-200">
          {q.isLoading ? <Loading label="Looking it up…" /> : null}
          {q.isError ? <ErrorNote error={q.error} /> : null}
          {q.data ? (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Taught by {q.data.course_count ?? 0} courses · appears in{" "}
                {Math.round((q.data.prevalence ?? 0) * 100)}% of the catalogue.
              </p>
              {q.data.central_to_tracks?.length ? (
                <div>
                  <p className="mb-1.5 flex items-center gap-1 text-xs font-medium text-foreground">
                    <Layers className="h-3 w-3" /> Central to
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {q.data.central_to_tracks.slice(0, 5).map((t) => (
                      <Chip key={t.track} as="span">
                        {t.track}
                      </Chip>
                    ))}
                  </div>
                </div>
              ) : null}
              {q.data.central_to_careers?.length ? (
                <div>
                  <p className="mb-1.5 flex items-center gap-1 text-xs font-medium text-foreground">
                    <Briefcase className="h-3 w-3" /> Valued for
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {q.data.central_to_careers.slice(0, 5).map((c) => (
                      <Chip key={c.career} as="span">
                        {c.career}
                      </Chip>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

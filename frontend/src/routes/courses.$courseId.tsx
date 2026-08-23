import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { CourseCard, type CatalogCourse } from "@/components/CourseCard";
import { Button } from "@/components/ui/button";
import { Chip, ErrorNote, Loading, PageHeader, Section } from "@/components/pf";

export const Route = createFileRoute("/courses/$courseId")({
  head: () => ({
    meta: [
      { title: "Course detail — PathFinder" },
      { name: "description", content: "Prerequisites, skills taught and what this course unlocks." },
      { property: "og:title", content: "Course detail — PathFinder" },
      { property: "og:description", content: "See where a course sits in your learning ladder." },
    ],
  }),
  component: CourseDetailPage,
});

type FullCourse = CatalogCourse & {
  description?: string;
  skills?: string[];
  tools?: string[];
  career_paths?: string[];
  industry_sectors?: string[];
};

type Detail = {
  course?: FullCourse;
  // The real shape is a rung ladder — {branch, track, tier} — not titled course entries.
  prerequisite_chain?: { branch?: string; track?: string; tier?: string | number }[];
  // Real key is "follow_ons", and each entry is a full course dict (has .title).
  follow_ons?: FullCourse[];
  alternatives?: FullCourse[];
  status?: string;
};

function CourseDetailPage() {
  const { courseId } = Route.useParams();
  const { token } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);

  const q = useQuery({
    queryKey: ["course", courseId],
    queryFn: () => api<Detail>(`/api/catalog/courses/${courseId}`),
    retry: false,
  });

  const similar = useQuery({
    queryKey: ["similar", courseId],
    // Real shape is { course, similar: [{ course, similarity }] } — the
    // neighbour course is nested one level deeper than a bare course list.
    queryFn: () =>
      api<{ similar?: { course: CatalogCourse; similarity?: number }[] }>(
        `/api/recommendations/similar/${courseId}`,
      ),
    retry: false,
  });

  const activePath = useQuery({
    queryKey: ["active-path"],
    queryFn: () => api<{ id?: string | number }>("/api/paths/active"),
    enabled: Boolean(token),
    retry: false,
  });

  const d = q.data;
  const course = d?.course;
  const similarList = (similar.data?.similar ?? []).map((s) => s.course);

  const setStatus = async (status: "in_progress" | "completed") => {
    const pathId = activePath.data?.id;
    if (pathId === undefined) return;
    setBusy(status);
    setActionError(null);
    try {
      await api(`/api/paths/${pathId}/progress`, {
        method: "POST",
        body: { course_id: courseId, status },
      });
      q.refetch();
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(null);
    }
  };

  const enrollment = d?.status;

  return (
    <AppShell>
      <div className="page space-y-12">
        {q.isLoading ? <Loading /> : null}
        {q.isError ? <ErrorNote error={q.error} /> : null}

        {course ? (
          <>
            <PageHeader
              title={course.title ?? "Course"}
              subtitle={
                [
                  course.track,
                  course.branch,
                  course.provider,
                  course.hours ? `${course.hours}h` : null,
                  course.difficulty,
                  course.rating ? `${course.rating}★` : null,
                ]
                  .filter(Boolean)
                  .join(" · ") || undefined
              }
              action={
                token && activePath.data?.id !== undefined ? (
                  <div className="flex gap-2">
                    <Button onClick={() => setStatus("in_progress")} disabled={busy !== null}>
                      {busy === "in_progress" ? "Saving…" : "Start"}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => setStatus("completed")}
                      disabled={busy !== null}
                    >
                      {busy === "completed" ? "Saving…" : "Complete"}
                    </Button>
                  </div>
                ) : undefined
              }
            />

            {enrollment ? (
              <p className="-mt-6 text-sm text-muted-foreground">Status: {enrollment}</p>
            ) : null}
            {actionError ? <ErrorNote error={actionError} /> : null}

            {course.description ? (
              <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
                {course.description}
              </p>
            ) : null}

            <div className="grid gap-10 lg:grid-cols-2">
              {d?.prerequisite_chain?.length ? (
                <Section title="Prerequisite ladder">
                  <ol className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
                    {d.prerequisite_chain.map((p, i) => (
                      <li key={i} className="flex items-center justify-between gap-4 px-5 py-3">
                        <span className="text-sm">{p.branch} — {p.track}</span>
                        <span className="text-xs text-muted-foreground">
                          {p.tier !== undefined ? `tier ${p.tier}` : ""}
                        </span>
                      </li>
                    ))}
                  </ol>
                </Section>
              ) : null}

              {d?.follow_ons?.length ? (
                <Section title="Unlocks">
                  <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
                    {d.follow_ons.map((u, i) => (
                      <li key={i} className="px-5 py-3 text-sm">
                        {u.title}
                      </li>
                    ))}
                  </ul>
                </Section>
              ) : null}
            </div>

            <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
              <ChipList title="Skills taught" items={course.skills} />
              <ChipList title="Tools" items={course.tools} />
              <ChipList title="Careers" items={course.career_paths} />
              <ChipList title="Sectors" items={course.industry_sectors} />
            </div>

            {d?.alternatives?.length ? (
              <Section title="Same level, other providers">
                <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                  {d.alternatives.map((a, i) => (
                    <CourseCard key={`${a.course_id ?? a.id ?? i}`} course={a} />
                  ))}
                </div>
              </Section>
            ) : null}

            {similarList.length ? (
              <Section title="Semantically similar">
                <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                  {similarList.map((a, i) => (
                    <CourseCard key={`${a.course_id ?? a.id ?? i}`} course={a} />
                  ))}
                </div>
              </Section>
            ) : null}
          </>
        ) : null}
      </div>
    </AppShell>
  );
}

function ChipList({ title, items }: { title: string; items?: string[] }) {
  return (
    <div className="space-y-3">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">{title}</p>
      {items?.length ? (
        <div className="flex flex-wrap gap-2">
          {items.map((i) => (
            <Chip key={i} as="span">
              {i}
            </Chip>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">—</p>
      )}
    </div>
  );
}

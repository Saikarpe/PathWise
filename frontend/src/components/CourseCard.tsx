import { Link } from "@tanstack/react-router";

export type CatalogCourse = {
  id?: string | number;
  course_id?: string | number;
  title?: string;
  track?: string;
  branch?: string;
  provider?: string;
  hours?: number;
  rating?: number;
  difficulty?: string;
  description?: string;
  skills?: string[];
};

export function CourseCard({ course }: { course: CatalogCourse }) {
  const id = course.course_id ?? course.id;
  const meta = [
    course.provider,
    course.hours ? `${course.hours}h` : null,
    course.difficulty,
    course.rating ? `${course.rating}★` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const body = (
    <>
      <p className="text-xs text-muted-foreground">
        {[course.track, course.branch].filter(Boolean).join(" · ") || "—"}
      </p>
      <h3 className="mt-2 text-base font-semibold leading-snug">{course.title ?? "Untitled"}</h3>
      <p className="mt-3 text-xs text-muted-foreground">{meta || "—"}</p>
    </>
  );

  return (
    <article className="rounded-2xl border border-border bg-card p-6 transition-colors hover:border-primary/40">
      {id !== undefined ? (
        <Link to="/courses/$courseId" params={{ courseId: String(id) }} className="block">
          {body}
        </Link>
      ) : (
        body
      )}
    </article>
  );
}

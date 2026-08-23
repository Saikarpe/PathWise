import { Link } from "@tanstack/react-router";
import { Clock, Star } from "lucide-react";
import { cn } from "@/lib/utils";

export type CatalogCourse = {
  id?: string | number;
  course_id?: string | number;
  title?: string;
  track?: string;
  branch?: string;
  provider?: string;
  hours?: number;
  rating?: number;
  num_reviews?: number;
  difficulty?: string;
  description?: string;
  skills?: string[];
};

const DIFFICULTY_TONE: Record<string, string> = {
  Beginner: "bg-success/10 text-success",
  Intermediate: "bg-warning/15 text-warning-foreground",
  Advanced: "bg-destructive/10 text-destructive",
  Capstone: "bg-accent text-accent-foreground",
};

/**
 * A course, styled the way Coursera/Udemy actually render one: provider as
 * a small caption above the title (that's the trust signal on those
 * platforms, not a decoration), rating as stars-plus-count rather than a
 * bare number, and skills as the scannable payoff at the bottom — the same
 * ordering a learner comparing several cards actually reads in.
 */
export function CourseCard({ course }: { course: CatalogCourse }) {
  const id = course.course_id ?? course.id;
  const rating = course.rating ?? 0;

  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {course.provider || "—"}
        </p>
        {course.difficulty ? (
          <span
            className={cn(
              "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
              DIFFICULTY_TONE[course.difficulty] ?? "bg-secondary text-secondary-foreground",
            )}
          >
            {course.difficulty}
          </span>
        ) : null}
      </div>

      <h3 className="mt-2 line-clamp-2 min-h-10 text-base font-semibold leading-snug text-foreground">
        {course.title ?? "Untitled"}
      </h3>

      <p className="mt-1.5 truncate text-xs text-muted-foreground">
        {[course.track, course.branch].filter(Boolean).join(" · ") || "—"}
      </p>

      <div className="mt-3 flex items-center gap-3 text-xs">
        {rating > 0 ? (
          <span className="inline-flex items-center gap-1 font-semibold text-foreground">
            {rating.toFixed(1)}
            <Star className="h-3.5 w-3.5 fill-rating text-rating" />
            {course.num_reviews ? (
              <span className="font-normal text-muted-foreground">
                ({new Intl.NumberFormat("en-US", { notation: "compact" }).format(course.num_reviews)})
              </span>
            ) : null}
          </span>
        ) : null}
        {course.hours ? (
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            {course.hours}h
          </span>
        ) : null}
      </div>

      {course.skills?.length ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {course.skills.slice(0, 3).map((skill) => (
            <span
              key={skill}
              className="rounded-full border border-border bg-secondary px-2 py-0.5 text-[11px] text-secondary-foreground"
            >
              {skill}
            </span>
          ))}
          {course.skills.length > 3 ? (
            <span className="px-1 py-0.5 text-[11px] text-muted-foreground">
              +{course.skills.length - 3}
            </span>
          ) : null}
        </div>
      ) : null}
    </>
  );

  return (
    <article className="group rounded-lg border border-border bg-card p-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/50 hover:bg-accent/30 hover:shadow-md">
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

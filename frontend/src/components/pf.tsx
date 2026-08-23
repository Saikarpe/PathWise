import { useState } from "react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { AlertCircle, Loader2, ThumbsDown, ThumbsUp, Turtle, Zap } from "lucide-react";

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <header className="mb-10 flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-xl space-y-2">
        <h1 className="text-3xl font-semibold">{title}</h1>
        {subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
      {action}
    </header>
  );
}

export function Section({
  title,
  hint,
  children,
  className,
}: {
  title?: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("space-y-4", className)}>
      {title ? (
        <div className="space-y-1">
          <h2 className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
            {title}
          </h2>
          {hint ? <p className="text-sm text-muted-foreground">{hint}</p> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/**
 * A headline number. Pass `onClick` to make it a door into more detail
 * ("6 skills proficient" is a fine summary, but the learner asking "which
 * ones?" shouldn't be a dead end) — it becomes a real button with a hover
 * affordance and a "view" hint instead of a static tile.
 */
export function Stat({
  label,
  value,
  sub,
  onClick,
}: {
  label: string;
  value: ReactNode;
  sub?: string;
  onClick?: () => void;
}) {
  const className = cn(
    "w-full rounded-xl border border-border bg-card px-5 py-4 text-left",
    onClick && "cursor-pointer transition-colors hover:border-primary/40 hover:bg-accent/30",
  );
  const content = (
    <>
      <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-2 font-display text-2xl font-semibold tabular-nums">{value}</p>
      {sub || onClick ? (
        <p className="mt-1 text-xs text-muted-foreground">
          {sub}
          {sub && onClick ? " · " : ""}
          {onClick ? <span className="text-primary">view →</span> : null}
        </p>
      ) : null}
    </>
  );
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={className}>
        {content}
      </button>
    );
  }
  return <div className={className}>{content}</div>;
}

export function Meter({
  value,
  label,
  right,
  tone = "primary",
}: {
  value: number;
  label?: string;
  right?: ReactNode;
  tone?: "primary" | "muted" | "success";
}) {
  const width = `${Math.max(0, Math.min(1, value || 0)) * 100}%`;
  return (
    <div className="space-y-1.5">
      {label || right ? (
        <div className="flex items-baseline justify-between gap-3 text-sm">
          <span className="truncate text-foreground">{label}</span>
          <span className="shrink-0 tabular-nums text-xs text-muted-foreground">{right}</span>
        </div>
      ) : null}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            tone === "primary" && "bg-primary",
            tone === "muted" && "bg-muted-foreground/40",
            tone === "success" && "bg-success",
          )}
          style={{ width }}
        />
      </div>
    </div>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-16 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      {label}
    </div>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : "Something went wrong.";
  return (
    <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

export function Notice({
  children,
  tone = "warning",
}: {
  children: ReactNode;
  tone?: "warning" | "muted";
}) {
  return (
    <div
      className={cn(
        "rounded-xl border px-4 py-3 text-sm",
        tone === "warning"
          ? "border-warning/40 bg-warning/10 text-warning-foreground"
          : "border-border bg-secondary text-muted-foreground",
      )}
    >
      {children}
    </div>
  );
}

export function Chip({
  children,
  active,
  onClick,
  as = "button",
}: {
  children: ReactNode;
  active?: boolean;
  onClick?: () => void;
  as?: "button" | "span";
}) {
  const className = cn(
    "inline-flex items-center rounded-full border px-3 py-1.5 text-xs transition-colors",
    active
      ? "border-primary bg-primary text-primary-foreground"
      : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground",
  );
  if (as === "span")
    return (
      <span className="inline-flex items-center rounded-full border border-border bg-secondary px-3 py-1 text-xs text-muted-foreground">
        {children}
      </span>
    );
  return (
    <button type="button" className={className} onClick={onClick}>
      {children}
    </button>
  );
}

export function Empty({
  title,
  detail,
  action,
}: {
  title: string;
  detail?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border bg-card px-8 py-20 text-center">
      <h3 className="text-lg font-semibold">{title}</h3>
      {detail ? <p className="max-w-sm text-sm text-muted-foreground">{detail}</p> : null}
      {action}
    </div>
  );
}

/**
 * The reaction row: like / not for me / too easy / too hard.
 *
 * This is the entire adaptive-feedback loop's front door. The backend has
 * had `/api/recommendations/feedback` — online per-learner ranking weights,
 * a difficulty bias, all of it — since the ranker was built, but nothing in
 * the UI ever called it outside of typing "too easy" into chat. Without this,
 * the adaptivity the product is built around was invisible to anyone who
 * didn't know to ask for it in words.
 *
 * `factors` should be passed when reacting to a course the learner has not
 * completed anything for yet (e.g. a raw recommendation) — the backend can
 * only recover the attribution vector on its own when `course_id` matches a
 * `PathItem` already on the learner's path.
 */
export function FeedbackBar({
  courseId,
  factors,
  pathId,
  className,
}: {
  courseId?: string | number;
  factors?: Record<string, number>;
  pathId?: string | number;
  className?: string;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  if (courseId === undefined) return null;

  const send = async (eventType: string) => {
    setBusy(eventType);
    try {
      const result = await api<{ explanation?: string }>("/api/recommendations/feedback", {
        method: "POST",
        body: { event_type: eventType, course_id: courseId, factors, path_id: pathId },
      });
      toast.success(result.explanation || "Got it — that will shape what comes next.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't record that.");
    } finally {
      setBusy(null);
    }
  };

  const buttons: { event: string; icon: typeof ThumbsUp; label: string }[] = [
    { event: "like", icon: ThumbsUp, label: "Good match" },
    { event: "not_relevant", icon: ThumbsDown, label: "Not for me" },
    { event: "too_easy", icon: Turtle, label: "Too easy" },
    { event: "too_hard", icon: Zap, label: "Too hard" },
  ];

  return (
    <div className={cn("flex items-center gap-1", className)}>
      {buttons.map(({ event, icon: Icon, label }) => (
        <button
          key={event}
          type="button"
          title={label}
          aria-label={label}
          disabled={busy !== null}
          onClick={() => send(event)}
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-50"
        >
          {busy === event ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Icon className="h-3.5 w-3.5" />
          )}
        </button>
      ))}
    </div>
  );
}

export function Drivers({ drivers }: { drivers?: { factor: string; share: number }[] }) {
  if (!drivers?.length) return null;
  return (
    <div className="space-y-3">
      {drivers.map((d) => (
        <Meter
          key={d.factor}
          value={d.share}
          label={d.factor}
          right={`${Math.round((d.share || 0) * 100)}%`}
        />
      ))}
    </div>
  );
}

/**
 * "Is my stated pace realistic?" — without claiming to know what other
 * learners do.
 *
 * There is no real population of learners behind this app to compute a
 * genuine "most people finish in N weeks" statistic from, and inventing one
 * would be a fabricated number presented as fact. This answers the same
 * underlying question honestly instead: the same total hours, projected at a
 * few different weekly commitments, so the learner can judge for themselves
 * whether the pace they set is one they can actually sustain — the reference
 * points are arithmetic on their own plan, not a claim about anyone else.
 */
export function PaceCalibration({
  totalHours,
  currentHours,
}: {
  totalHours?: number;
  currentHours?: number;
}) {
  if (!totalHours) return null;
  const refs = [...new Set([5, 10, 20, currentHours].filter((h): h is number => !!h && h > 0))].sort(
    (a, b) => a - b,
  );
  if (refs.length < 2) return null;

  return (
    <div className="rounded-xl border border-border bg-card px-6 py-5">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">
        Same path, different paces
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        Projected from this plan's total hours — not a claim about other learners.
      </p>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {refs.map((h) => {
          const weeks = Math.max(1, Math.round(totalHours / h));
          const isCurrent = h === currentHours;
          return (
            <div
              key={h}
              className={cn(
                "rounded-lg border px-3 py-2.5 text-center",
                isCurrent ? "border-primary bg-accent" : "border-border",
              )}
            >
              <p className="text-xs text-muted-foreground">{h}h/week</p>
              <p className="mt-1 text-sm font-semibold tabular-nums">{weeks}w</p>
              {isCurrent ? <p className="mt-0.5 text-[10px] text-primary">your pace</p> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

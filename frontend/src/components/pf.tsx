import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Loader2, AlertCircle } from "lucide-react";

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

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card px-5 py-4">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-2 font-display text-2xl font-semibold tabular-nums">{value}</p>
      {sub ? <p className="mt-1 text-xs text-muted-foreground">{sub}</p> : null}
    </div>
  );
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

import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "PathFinder — Your goal, turned into a learning path" },
      {
        name: "description",
        content:
          "Describe what you want to be able to do. PathFinder builds an explainable, week-by-week learning path from a real course catalogue.",
      },
      { property: "og:title", content: "PathFinder — Your goal, turned into a learning path" },
      {
        property: "og:description",
        content: "An explainable, personalised learning path recommender for ambitious learners.",
      },
    ],
  }),
  component: Landing,
});

const SECTIONS = [
  {
    step: "01",
    title: "Say it in plain words",
    body: "“I'm a final-year CS student and I want to become an ML engineer, I know Python, about 10 hours a week.” That's the whole input.",
  },
  {
    step: "02",
    title: "See what we understood",
    body: "Goal tracks, target role, skills you already have — each ranked, each traceable back to the exact phrase you wrote.",
  },
  {
    step: "03",
    title: "Get a path, not a list",
    body: "Phases, ordered steps, prerequisites, hours per week and a realistic finish date built around the time you actually have.",
  },
  {
    step: "04",
    title: "Every number is explainable",
    body: "Ask “why?” on any recommendation and see the drivers behind the score. Nothing here is a guess dressed up as a metric.",
  },
];

function Landing() {
  return (
    <div className="min-h-screen bg-background">
      <header className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-6">
        <span className="font-display text-sm font-semibold">PathFinder</span>
        <Link to="/login">
          <Button variant="ghost" size="sm">
            Sign in
          </Button>
        </Link>
      </header>

      <section className="mx-auto w-full max-w-3xl px-6 pb-24 pt-24 text-center">
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
          Personalised learning paths
        </p>
        <h1 className="mt-6 text-balance text-5xl font-semibold leading-[1.05] sm:text-6xl">
          Describe the job you want. Get the path that gets you there.
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-pretty text-base text-muted-foreground">
          PathFinder reads your goal, finds the gap between where you are and where you want to be,
          and lays out the courses, projects and checkpoints in the order that actually works.
        </p>
        <div className="mt-10 flex flex-wrap justify-center gap-3">
          <Link to="/register">
            <Button size="lg">Build my path</Button>
          </Link>
          <Link to="/login">
            <Button size="lg" variant="outline">
              Try a demo account
            </Button>
          </Link>
        </div>
      </section>

      <section className="mx-auto w-full max-w-3xl space-y-px px-6 pb-32">
        {SECTIONS.map((s) => (
          <article
            key={s.step}
            className="grid gap-2 border-t border-border py-10 sm:grid-cols-[6rem_1fr] sm:gap-8"
          >
            <p className="font-display text-sm text-muted-foreground">{s.step}</p>
            <div className="max-w-lg space-y-2">
              <h2 className="text-xl font-semibold">{s.title}</h2>
              <p className="text-sm leading-relaxed text-muted-foreground">{s.body}</p>
            </div>
          </article>
        ))}
      </section>

      <footer className="border-t border-border py-8 text-center text-xs text-muted-foreground">
        PathFinder
      </footer>
    </div>
  );
}

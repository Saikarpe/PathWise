import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useRequireAuth } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { CourseCard, type CatalogCourse } from "@/components/CourseCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Empty, ErrorNote, Loading, PageHeader } from "@/components/pf";

export const Route = createFileRoute("/explore")({
  head: () => ({
    meta: [
      { title: "Explore courses — PathFinder" },
      { name: "description", content: "Browse and search the full course catalogue by track, provider and level." },
      { property: "og:title", content: "Explore courses — PathFinder" },
      { property: "og:description", content: "Search the catalogue behind every PathFinder recommendation." },
    ],
  }),
  component: ExplorePage,
});

type Taxonomy = {
  // Each branch carries its own courses count and track list — there is no
  // flat top-level "tracks" array, so the track filter has to key off the
  // currently-selected branch.
  branches?: { name: string; courses?: number; tracks?: string[] }[];
  providers?: string[];
  difficulty_levels?: string[];
  difficulties?: string[];
};

const ANY = "__any__";

function ExplorePage() {
  const { ready, authed } = useRequireAuth();
  const [q, setQ] = useState("");
  const [branch, setBranch] = useState(ANY);
  const [track, setTrack] = useState(ANY);
  const [difficulty, setDifficulty] = useState(ANY);
  const [provider, setProvider] = useState(ANY);
  const [results, setResults] = useState<CatalogCourse[] | null>(null);

  const tax = useQuery({
    queryKey: ["taxonomy"],
    queryFn: () => api<Taxonomy>("/api/catalog/taxonomy"),
    enabled: ready && authed,
    retry: false,
  });

  const search = useMutation({
    mutationFn: () =>
      api<{ results?: CatalogCourse[]; courses?: CatalogCourse[] }>("/api/catalog/search", {
        method: "POST",
        body: {
          q: q.trim() || undefined,
          branch: branch === ANY ? undefined : branch,
          track: track === ANY ? undefined : track,
          difficulty: difficulty === ANY ? undefined : difficulty,
          provider: provider === ANY ? undefined : provider,
          limit: 24,
        },
      }),
    onSuccess: (data) => setResults(data.results ?? data.courses ?? []),
  });

  useEffect(() => {
    if (ready && authed) search.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, authed]);

  const levels = tax.data?.difficulty_levels ?? tax.data?.difficulties ?? [];
  const branchNames = (tax.data?.branches ?? []).map((b) => b.name);
  const tracksForBranch =
    branch === ANY
      ? []
      : (tax.data?.branches ?? []).find((b) => b.name === branch)?.tracks ?? [];

  return (
    <AppShell>
      <div className="page space-y-10">
        <PageHeader title="Explore" subtitle="The catalogue every recommendation is drawn from." />

        <div className="space-y-4 rounded-2xl border border-border bg-card p-6">
          <div className="flex flex-wrap gap-3">
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && search.mutate()}
              placeholder="Search the catalogue…"
              className="min-w-56 flex-1"
            />
            <Button onClick={() => search.mutate()} disabled={search.isPending}>
              {search.isPending ? "Searching…" : "Search"}
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Filter
              label="Branch"
              value={branch}
              onChange={(v) => {
                setBranch(v);
                setTrack(ANY);
              }}
              options={branchNames}
            />
            <Filter label="Track" value={track} onChange={setTrack} options={tracksForBranch} />
            <Filter label="Level" value={difficulty} onChange={setDifficulty} options={levels} />
            <Filter label="Provider" value={provider} onChange={setProvider} options={tax.data?.providers} />
          </div>
        </div>

        {search.isPending ? <Loading /> : null}
        {search.isError ? <ErrorNote error={search.error} /> : null}
        {results && results.length === 0 ? (
          <Empty title="Nothing matched" detail="Try fewer filters or a broader search." />
        ) : null}

        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {(results ?? []).map((c, i) => (
            <div
              key={`${c.course_id ?? c.id ?? i}`}
              className="animate-in fade-in slide-in-from-bottom-3 fill-mode-both duration-500"
              style={{ animationDelay: `${Math.min(i, 11) * 40}ms` }}
            >
              <CourseCard course={c} />
            </div>
          ))}
        </div>
      </div>
    </AppShell>
  );
}

function Filter({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options?: string[];
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger>
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ANY}>Any {label.toLowerCase()}</SelectItem>
        {(options ?? []).map((o) => (
          <SelectItem key={o} value={o}>
            {o}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

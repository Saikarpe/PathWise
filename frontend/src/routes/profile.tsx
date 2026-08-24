import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, pct } from "@/lib/api";
import { useRequireAuth } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ErrorNote, Loading, Meter, PageHeader, Section } from "@/components/pf";
import type { CatalogCourse } from "@/components/CourseCard";

export const Route = createFileRoute("/profile")({
  head: () => ({
    meta: [
      { title: "Profile — PathWise" },
      { name: "description", content: "Your goal, time budget, self-rated skills and course history." },
      { property: "og:title", content: "Profile — PathWise" },
      { property: "og:description", content: "Keep your learning profile accurate so the path stays accurate." },
    ],
  }),
  component: ProfilePage,
});

type Profile = {
  full_name?: string;
  email?: string;
  experience_level?: string;
  primary_branch?: string;
  target_role?: string;
  weekly_hours?: number;
  timeline_weeks?: number | null;
  interests?: string[];
  preferred_formats?: string[];
  preferred_providers?: string[];
};

type SkillsResponse = {
  skills?: { skill: string; proficiency: number; declared?: boolean }[];
  vocabulary?: string[];
};

type HistoryResponse = {
  history?: {
    // The real endpoint nests the full course object here, not a title string.
    course?: { title?: string; track?: string; provider?: string } | string;
    course_id?: string | number;
    status?: string;
    progress_pct?: number;
    hours_logged?: number;
    on_path?: boolean;
    removable?: boolean;
  }[];
  completed_course_ids?: (string | number)[];
  completed_count?: number;
  hours_logged?: number;
};

function ProfilePage() {
  const { ready, authed } = useRequireAuth();
  const qc = useQueryClient();

  const profileQ = useQuery({
    queryKey: ["profile"],
    queryFn: () => api<Profile>("/api/profile"),
    enabled: ready && authed,
    retry: false,
  });
  const skillsQ = useQuery({
    queryKey: ["profile-skills"],
    queryFn: () => api<SkillsResponse>("/api/profile/skills"),
    enabled: ready && authed,
    retry: false,
  });
  const historyQ = useQuery({
    queryKey: ["profile-history"],
    queryFn: () => api<HistoryResponse>("/api/profile/history"),
    enabled: ready && authed,
    retry: false,
  });

  return (
    <AppShell>
      <div className="page space-y-10">
        <PageHeader
          title="Profile"
          subtitle="What we know about you is what the path is built from."
        />
        {!ready || profileQ.isLoading ? <Loading /> : null}
        {profileQ.isError ? <ErrorNote error={profileQ.error} /> : null}

        {profileQ.data ? (
          <Tabs defaultValue="details">
            <TabsList>
              <TabsTrigger value="details">Details</TabsTrigger>
              <TabsTrigger value="skills">Skills</TabsTrigger>
              <TabsTrigger value="history">History</TabsTrigger>
            </TabsList>

            <TabsContent value="details" className="pt-8">
              <DetailsForm
                profile={profileQ.data}
                onSaved={() => qc.invalidateQueries({ queryKey: ["profile"] })}
              />
            </TabsContent>

            <TabsContent value="skills" className="pt-8">
              {skillsQ.isLoading ? <Loading /> : null}
              {skillsQ.isError ? <ErrorNote error={skillsQ.error} /> : null}
              {skillsQ.data ? (
                <SkillsEditor
                  data={skillsQ.data}
                  onSaved={() => qc.invalidateQueries({ queryKey: ["profile-skills"] })}
                />
              ) : null}
            </TabsContent>

            <TabsContent value="history" className="pt-8">
              {historyQ.isLoading ? <Loading /> : null}
              {historyQ.isError ? <ErrorNote error={historyQ.error} /> : null}
              {historyQ.data ? (
                <HistoryEditor
                  data={historyQ.data}
                  onSaved={() => qc.invalidateQueries({ queryKey: ["profile-history"] })}
                />
              ) : null}
            </TabsContent>
          </Tabs>
        ) : null}
      </div>
    </AppShell>
  );
}

function DetailsForm({ profile, onSaved }: { profile: Profile; onSaved: () => void }) {
  const [form, setForm] = useState<Profile>(profile);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => setForm(profile), [profile]);

  const changed = (Object.keys(form) as (keyof Profile)[]).filter(
    (k) => JSON.stringify(form[k]) !== JSON.stringify(profile[k]),
  );

  const save = async () => {
    if (!changed.length) return;
    setBusy(true);
    setError(null);
    try {
      const patch: Record<string, unknown> = {};
      changed.forEach((k) => (patch[k] = form[k]));
      await api("/api/profile", { method: "PUT", body: patch });
      onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const field = (key: keyof Profile, label: string, type = "text") => (
    <div className="space-y-2">
      <Label htmlFor={key}>{label}</Label>
      <Input
        id={key}
        type={type}
        value={(form[key] as string | number | undefined) ?? ""}
        onChange={(e) =>
          setForm({
            ...form,
            [key]: type === "number" ? (e.target.value ? Number(e.target.value) : null) : e.target.value,
          })
        }
      />
    </div>
  );

  return (
    <div className="max-w-2xl space-y-8">
      <div className="grid gap-5 sm:grid-cols-2">
        {field("full_name", "Name")}
        <div className="space-y-2">
          <Label>Email</Label>
          <Input value={profile.email ?? ""} disabled />
        </div>
        {field("experience_level", "Experience level")}
        {field("primary_branch", "Branch")}
        {field("target_role", "Target role")}
        {field("weekly_hours", "Weekly hours", "number")}
        {field("timeline_weeks", "Deadline (weeks)", "number")}
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <ListField
          label="Interests"
          value={form.interests}
          onChange={(v) => setForm({ ...form, interests: v })}
        />
        <ListField
          label="Preferred formats"
          value={form.preferred_formats}
          onChange={(v) => setForm({ ...form, preferred_formats: v })}
        />
        <ListField
          label="Preferred providers"
          value={form.preferred_providers}
          onChange={(v) => setForm({ ...form, preferred_providers: v })}
        />
      </div>

      {error ? <ErrorNote error={error} /> : null}
      <Button onClick={save} disabled={busy || !changed.length}>
        {busy ? "Saving…" : "Save changes"}
      </Button>
    </div>
  );
}

function ListField({
  label,
  value,
  onChange,
}: {
  label: string;
  value?: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input
        value={(value ?? []).join(", ")}
        placeholder="comma separated"
        onChange={(e) =>
          onChange(
            e.target.value
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
          )
        }
      />
    </div>
  );
}

function SkillsEditor({ data, onSaved }: { data: SkillsResponse; onSaved: () => void }) {
  const declared = (data.skills ?? []).filter((s) => s.declared);
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [pick, setPick] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    const next: Record<string, number> = {};
    declared.forEach((s) => (next[s.skill] = s.proficiency));
    setRatings(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      // Full replacement: always send the complete current set.
      await api("/api/profile", { method: "PUT", body: { self_assessed_skills: ratings } });
      onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const vocabulary = (data.vocabulary ?? []).filter((v) => !(v in ratings));

  return (
    <div className="grid max-w-4xl gap-12 lg:grid-cols-2">
      <Section title="Current proficiency">
        <div className="space-y-4 rounded-xl border border-border bg-card p-6">
          {(data.skills ?? []).length ? (
            (data.skills ?? []).map((s) => (
              <Meter
                key={s.skill}
                value={s.proficiency}
                label={`${s.skill}${s.declared ? " · self-rated" : ""}`}
                right={pct(s.proficiency)}
              />
            ))
          ) : (
            <p className="text-sm text-muted-foreground">—</p>
          )}
        </div>
      </Section>

      <Section title="Self-rated skills" hint="Saving replaces your whole self-rated set.">
        <div className="space-y-6 rounded-xl border border-border bg-card p-6">
          {Object.entries(ratings).map(([skill, value]) => (
            <div key={skill} className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm">{skill}</span>
                <div className="flex items-center gap-3">
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {Math.round(value * 100)}%
                  </span>
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:text-destructive"
                    onClick={() => {
                      const next = { ...ratings };
                      delete next[skill];
                      setRatings(next);
                    }}
                  >
                    Remove
                  </button>
                </div>
              </div>
              <Slider
                value={[Math.round(value * 100)]}
                min={0}
                max={100}
                step={5}
                onValueChange={(v) => setRatings({ ...ratings, [skill]: v[0] / 100 })}
              />
            </div>
          ))}

          <div className="flex gap-2">
            <Select value={pick} onValueChange={setPick}>
              <SelectTrigger className="flex-1">
                <SelectValue placeholder="Add a skill…" />
              </SelectTrigger>
              <SelectContent>
                {vocabulary.slice(0, 200).map((v) => (
                  <SelectItem key={v} value={v}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              disabled={!pick}
              onClick={() => {
                setRatings({ ...ratings, [pick]: 0.5 });
                setPick("");
              }}
            >
              Add
            </Button>
          </div>

          {error ? <ErrorNote error={error} /> : null}
          <Button onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save self-ratings"}
          </Button>
        </div>
      </Section>
    </div>
  );
}

function HistoryEditor({ data, onSaved }: { data: HistoryResponse; onSaved: () => void }) {
  const [ids, setIds] = useState<(string | number)[]>(data.completed_course_ids ?? []);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<CatalogCourse[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => setIds(data.completed_course_ids ?? []), [data]);

  const search = async () => {
    setError(null);
    try {
      const r = await api<{ results?: CatalogCourse[]; courses?: CatalogCourse[] }>(
        "/api/catalog/search",
        { method: "POST", body: { q, limit: 8 } },
      );
      setResults(r.results ?? r.courses ?? []);
    } catch (err) {
      setError(err);
    }
  };

  const save = async (next: (string | number)[]) => {
    setBusy(true);
    setError(null);
    try {
      // Full replacement: send the complete completed list.
      await api("/api/profile", { method: "PUT", body: { completed_course_ids: next } });
      setIds(next);
      onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-12">
      <Section
        title="Course history"
        hint={`${data.completed_count ?? 0} completed · ${data.hours_logged ?? 0}h logged`}
      >
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {(data.history ?? []).map((h, i) => (
            <li key={i} className="flex items-center justify-between gap-4 px-5 py-4">
              <div className="min-w-0">
                <p className="truncate text-sm">
                  {typeof h.course === "string" ? h.course : (h.course?.title ?? "Untitled course")}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {[
                    h.status,
                    h.progress_pct !== undefined ? `${h.progress_pct}%` : null,
                    h.hours_logged ? `${h.hours_logged}h` : null,
                    h.on_path ? "on path" : null,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "—"}
                </p>
              </div>
              {h.removable && h.course_id !== undefined ? (
                <button
                  type="button"
                  disabled={busy}
                  className="shrink-0 text-xs text-muted-foreground hover:text-destructive"
                  onClick={() => save(ids.filter((id) => String(id) !== String(h.course_id)))}
                >
                  Remove
                </button>
              ) : null}
            </li>
          ))}
          {(data.history ?? []).length === 0 ? (
            <li className="px-5 py-6 text-sm text-muted-foreground">Nothing logged yet.</li>
          ) : null}
        </ul>
      </Section>

      <Section title="Add a prior completion">
        <div className="flex gap-3">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && search()}
            placeholder="Search the catalogue…"
          />
          <Button variant="outline" onClick={search}>
            Search
          </Button>
        </div>
        {error ? <ErrorNote error={error} /> : null}
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {results.map((c, i) => {
            const cid = c.course_id ?? c.id;
            const already = ids.some((id) => String(id) === String(cid));
            return (
              <li key={i} className="flex items-center justify-between gap-4 px-5 py-3">
                <span className="truncate text-sm">{c.title}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={already || busy || cid === undefined}
                  onClick={() => cid !== undefined && save([...ids, cid])}
                >
                  {already ? "Added" : "Add"}
                </Button>
              </li>
            );
          })}
        </ul>
      </Section>
    </div>
  );
}

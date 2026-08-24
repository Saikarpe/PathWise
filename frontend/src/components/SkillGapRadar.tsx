import {
  Legend,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

export type GapSkill = {
  skill: string;
  required?: number;
  current?: number;
  gap?: number;
  importance?: number;
  status?: string;
};

/**
 * The skill gap, as a shape rather than a list.
 *
 * The planner's whole decision procedure is "what does this goal require,
 * what does this learner already have, and how big is the difference" — but
 * that was only ever surfaced as three comma-separated lists of skill names.
 * Overlaying *required* against *current* on shared axes makes the gap
 * legible in one glance: the distance between the two rings is exactly what
 * the path is built to close.
 *
 * Skills are ordered by weighted gap and capped, because a radar with twelve
 * axes is unreadable — the largest gaps are also the ones driving the plan,
 * so the cap loses nothing that matters.
 */
export function SkillGapRadar({
  skills,
  max = 8,
  height = 320,
}: {
  skills: GapSkill[];
  max?: number;
  height?: number;
}) {
  const data = [...skills]
    .sort((a, b) => (b.gap ?? 0) * (b.importance ?? 1) - (a.gap ?? 0) * (a.importance ?? 1))
    .slice(0, max)
    .map((s) => ({
      skill: s.skill.length > 15 ? `${s.skill.slice(0, 14)}…` : s.skill,
      Required: Math.round((s.required ?? 0) * 100),
      "You have": Math.round((s.current ?? 0) * 100),
    }));

  if (data.length < 3) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        The gap radar needs at least three measured skills.
      </p>
    );
  }

  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={data} outerRadius="70%">
          <PolarGrid stroke="var(--color-border)" />
          <PolarAngleAxis
            dataKey="skill"
            tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
          />
          <PolarRadiusAxis domain={[0, 100]} tick={{ fontSize: 9, fill: "var(--color-muted-foreground)" }} />
          {/* Required drawn first so the learner's own level sits on top of it. */}
          <Radar
            name="Required"
            dataKey="Required"
            stroke="var(--color-muted-foreground)"
            fill="var(--color-muted-foreground)"
            fillOpacity={0.12}
            strokeDasharray="4 3"
          />
          <Radar
            name="You have"
            dataKey="You have"
            stroke="var(--color-primary)"
            fill="var(--color-primary)"
            fillOpacity={0.3}
          />
          <Tooltip
            formatter={(value: number, name: string) => [`${value}%`, name]}
            contentStyle={{
              borderRadius: 8,
              border: "1px solid var(--color-border)",
              background: "var(--color-card)",
              fontSize: 12,
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}

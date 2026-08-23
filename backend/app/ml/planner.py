"""Learning-path generation: goal -> ordered, prerequisite-safe roadmap.

The generator runs in six stages, each solving a distinct problem:

1. **Track selection.** The learner's goal is matched to a small number of
   *tracks* (ladders), not to loose courses. How many depends on the time budget:
   a 6-week plan gets one ladder, a year-long plan can carry three.

2. **Ladder walk with a start tier.** Each track is a 4-rung ladder
   (Beginner -> Intermediate -> Advanced -> Capstone). A learner's stated level
   *waives* lower rungs rather than silently violating prerequisites; every waiver
   is recorded as an explicit assumption the learner can see and correct. This is
   the honest version of "skip the basics".

3. **One variant per rung.** Each rung is offered by up to three providers. The
   naive approach returns all of them and looks broken. The ranker picks the
   single best variant per rung using the learner's provider/format preferences
   and quality, so redundancy is impossible by construction.

4. **Prerequisite closure.** Any rung pulled in by stage 3 drags in its unmet
   ancestors, so the plan is always topologically valid.

5. **Gap top-up.** The ladders may leave weighted skill gaps open. Greedy set
   cover adds the fewest extra courses that close the most remaining gap, which
   is what turns a track-shaped plan into a goal-shaped one.

6. **Phasing and milestones.** Items are laid out in dependency order, grouped by
   difficulty tier into phases, and converted to week offsets using the learner's
   weekly hours. Milestones fall on phase boundaries and name the skills that
   become proficient there, so progress is measured in capability, not clicks.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np

from app.ml.catalog import DIFFICULTY_ORDER, Catalog
from app.ml.graph import PrerequisiteGraph, Rung
from app.ml.intent import GoalInterpretation
from app.ml.ranker import DEFAULT_WEIGHTS, FACTOR_LABELS, RankedCourse, Ranker, RankingContext
from app.ml.skills import (
    TIER_SKILL_GAIN,
    CompetencyModel,
    GapReport,
    analyse_gap,
    build_target_profile,
    greedy_skill_cover,
    proficiency_from_history,
)
from app.ml.vectorizer import SemanticSpace

#: Tier -> (phase name, focus sentence).
TIER_PHASE: dict[int, tuple[str, str]] = {
    0: ("Foundations", "Build the vocabulary and core concepts you'll rely on later."),
    1: ("Core Skills", "Turn concepts into working competence with guided practice."),
    2: ("Advanced Practice", "Handle realistic, open-ended problems in the domain."),
    3: ("Capstone", "Prove the whole skill set on one substantial piece of work."),
}

#: Experience level -> the rung a learner starts on.
LEVEL_START_TIER: dict[str, int] = {"Beginner": 0, "Intermediate": 1, "Advanced": 2}

#: Roughly the hours one full ladder costs, used to size the plan to the budget.
_LADDER_HOURS = 110.0
_DEFAULT_TIMELINE_WEEKS = 24
_MAX_TRACKS = 3

#: Gap top-ups are capped at Intermediate — they add breadth, not depth, and the
#: cap makes prerequisite validity cheap to guarantee (see :meth:`_gap_top_up`).
_TOP_UP_MAX_TIER = 1
#: A top-up's *track* must reach this fraction of the best-matching track's
#: similarity to the goal. Gating whole tracks rather than individual courses is
#: what stops skill-mass alone dragging in an unrelated ladder from the same branch.
_TOP_UP_TRACK_FLOOR = 0.60
#: How many tracks to consider as top-up sources before the floor is applied.
_TOP_UP_TRACK_POOL = 25


@dataclass
class PlanItem:
    """One step of the roadmap: a course, a project, or an assessment."""

    item_type: str  # "course" | "project" | "assessment"
    title: str
    hours: float
    phase_index: int = 0
    phase_name: str = ""
    order_index: int = 0
    course_id: str | None = None
    score: float = 0.0
    factors: dict[str, float] = field(default_factory=dict)
    contributions: dict[str, float] = field(default_factory=dict)
    rationale: str = ""
    prerequisite_ids: list[str] = field(default_factory=list)
    skills: list[str] = field(default_factory=list)
    #: Where this item came from: "ladder", "prerequisite", "gap_cover", "project", "assessment".
    origin: str = "ladder"
    #: Position within a phase: lower sorts earlier. Lets a placement check precede
    #: the courses it validates and a project follow them.
    sort_hint: int = 1
    meta: dict = field(default_factory=dict)

    def as_dict(self) -> dict:
        return {
            "item_type": self.item_type,
            "title": self.title,
            "hours": round(self.hours, 1),
            "phase_index": self.phase_index,
            "phase_name": self.phase_name,
            "order_index": self.order_index,
            "course_id": self.course_id,
            "score": round(self.score, 4),
            "factors": {k: round(v, 4) for k, v in self.factors.items()},
            "contributions": {k: round(v, 4) for k, v in self.contributions.items()},
            "rationale": self.rationale,
            "prerequisite_ids": self.prerequisite_ids,
            "skills": self.skills,
            "origin": self.origin,
            "meta": self.meta,
        }


@dataclass
class Phase:
    index: int
    name: str
    focus: str
    hours: float = 0.0
    start_week: int = 1
    end_week: int = 1
    item_orders: list[int] = field(default_factory=list)
    skills: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "index": self.index,
            "name": self.name,
            "focus": self.focus,
            "hours": round(self.hours, 1),
            "start_week": self.start_week,
            "end_week": self.end_week,
            "item_orders": self.item_orders,
            "skills": self.skills,
        }


@dataclass
class MilestoneSpec:
    title: str
    description: str
    target_week: int
    progress_threshold: float
    skills_unlocked: list[str] = field(default_factory=list)
    required_course_ids: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "title": self.title,
            "description": self.description,
            "target_week": self.target_week,
            "progress_threshold": round(self.progress_threshold, 4),
            "skills_unlocked": self.skills_unlocked,
            "required_course_ids": self.required_course_ids,
        }


@dataclass
class LearningPlan:
    """A complete, ordered, prerequisite-valid roadmap."""

    items: list[PlanItem] = field(default_factory=list)
    phases: list[Phase] = field(default_factory=list)
    milestones: list[MilestoneSpec] = field(default_factory=list)
    #: Chosen ladders with the reason each was chosen.
    tracks: list[dict] = field(default_factory=list)
    total_hours: float = 0.0
    total_courses: int = 0
    estimated_weeks: int = 0
    #: Gap report, coverage numbers, waivers and other transparency data.
    analysis: dict = field(default_factory=dict)

    @property
    def course_ids(self) -> list[str]:
        return [i.course_id for i in self.items if i.course_id]

    def as_dict(self) -> dict:
        return {
            "items": [i.as_dict() for i in self.items],
            "phases": [p.as_dict() for p in self.phases],
            "milestones": [m.as_dict() for m in self.milestones],
            "tracks": self.tracks,
            "total_hours": round(self.total_hours, 1),
            "total_courses": self.total_courses,
            "estimated_weeks": self.estimated_weeks,
            "analysis": self.analysis,
        }


@dataclass
class LearnerState:
    """The learner side of path generation."""

    experience_level: str = "Beginner"
    weekly_hours: float = 8.0
    timeline_weeks: int | None = None
    completed_ids: list[str] = field(default_factory=list)
    self_assessed: dict[str, float] = field(default_factory=dict)
    preferred_formats: list[str] = field(default_factory=list)
    preferred_providers: list[str] = field(default_factory=list)
    weights: dict[str, float] | None = None
    affinities: dict[str, float] = field(default_factory=dict)
    difficulty_bias: float = 0.0


class PathPlanner:
    """Builds :class:`LearningPlan` objects from a parsed goal plus learner state."""

    def __init__(
        self,
        cat: Catalog,
        space: SemanticSpace,
        graph: PrerequisiteGraph,
        competency: CompetencyModel,
        ranker: Ranker,
    ) -> None:
        self.cat = cat
        self.space = space
        self.graph = graph
        self.competency = competency
        self.ranker = ranker

    # ------------------------------------------------------------------ #
    def generate(self, goal: GoalInterpretation, state: LearnerState) -> LearningPlan:
        plan = LearningPlan()

        level = goal.experience_level or state.experience_level or "Beginner"
        weekly_hours = float(goal.weekly_hours or state.weekly_hours or 8.0)
        timeline = int(goal.timeline_weeks or state.timeline_weeks or _DEFAULT_TIMELINE_WEEKS)
        formats = goal.formats or state.preferred_formats
        providers = goal.providers or state.preferred_providers

        completed = set(state.completed_ids)

        # ---- learner's current competence ----
        current_skills = proficiency_from_history(
            self.cat, list(completed), self_assessed=state.self_assessed
        )
        # Skills the learner said they already have via known_tracks get credit too.
        for track in goal.known_tracks:
            for skill, centrality in self.competency.track_skills.get(track, {}).items():
                if centrality >= 0.5:
                    current_skills[skill] = max(current_skills.get(skill, 0.0), 0.55)

        # ---- stage 1: pick the ladders ----
        capacity_hours = weekly_hours * timeline
        # Charge each ladder only for the rungs this learner will actually walk. A
        # fixed whole-ladder price penalised advanced learners twice: they skip the
        # first half of every ladder *and* were then told they could only afford one,
        # so a four-year mechanical engineer aiming at robotics got a single Capstone
        # course and sixteen skill gaps left open. This is an estimate — the real
        # start tier also depends on completions and declared background, resolved
        # per track below — but it only has to be good enough to choose a count.
        rungs_ahead = max(len(TIER_PHASE) - LEVEL_START_TIER.get(level, 0), 1)
        ladder_hours = _LADDER_HOURS * rungs_ahead / len(TIER_PHASE)
        max_tracks = int(np.clip(capacity_hours // ladder_hours, 1, _MAX_TRACKS))
        chosen = self._select_tracks(goal, max_tracks)
        if not chosen:
            plan.analysis = {"error": "no_matching_track", "goal": goal.as_dict()}
            return plan

        # ---- target profile and gap, scoped to the chosen ladders ----
        track_weights = {name: w for name, _, w in chosen}
        target, target_source = build_target_profile(
            self.competency,
            careers=goal.careers,
            tracks=[name for name, _, _ in chosen],
            explicit_skills=goal.skills,
            track_weights=track_weights,
        )
        gap = analyse_gap(self.competency, target, current_skills, source=target_source)

        goal_text = goal.raw_text or " ".join(name for name, _, _ in chosen)
        ctx = RankingContext(
            goal_vector=self.space.encode(goal_text),
            gap=gap,
            experience_level=level,
            weekly_hours=weekly_hours,
            preferred_formats=formats,
            preferred_providers=providers,
            completed_ids=set(completed),
            weights=dict(state.weights) if state.weights else dict(DEFAULT_WEIGHTS),
            affinities=dict(state.affinities),
            difficulty_bias=state.difficulty_bias,
            track_weights=track_weights,
        )

        # ---- stage 2+3: walk each ladder, one variant per rung ----
        selected: list[tuple[Rung, RankedCourse, str]] = []
        waivers: list[dict] = []
        seen_rungs: set[Rung] = set()

        for track_name, key, weight in chosen:
            branch, _ = key
            start_tier, track_waivers = self._start_tier(key, level, completed, goal)
            waivers.extend(track_waivers)
            # Waived rungs count as satisfied so prerequisite checks stay coherent.
            for waiver in track_waivers:
                ctx.completed_ids.add(waiver["representative_course_id"])

            plan.tracks.append(
                {
                    "track": track_name,
                    "branch": branch,
                    "relevance": round(weight, 3),
                    "start_tier": start_tier,
                    "start_difficulty": DIFFICULTY_ORDER[start_tier],
                }
            )

            for tier in range(start_tier, len(TIER_PHASE)):
                rung: Rung = (branch, key[1], tier)
                if rung in seen_rungs or rung not in self.graph.members:
                    continue
                members = [p for p in self.graph.members[rung]
                           if self.cat.course_ids[p] not in completed]
                if not members:
                    continue
                best = self.ranker.rank(ctx, members, limit=1)
                if not best:
                    continue
                seen_rungs.add(rung)
                selected.append((rung, best[0], "ladder"))

        # ---- stage 4: prerequisite closure ----
        selected = self._close_prerequisites(selected, ctx, completed, seen_rungs)

        # ---- stage 5: gap top-up ----
        ladder_positions = [rc.pos for _, rc, _ in selected]
        used_hours = float(sum(self.cat.hours[p] for p in ladder_positions))
        top_up_budget = max(capacity_hours - used_hours, 0.0)
        # Block whole rungs, not just the course ids already chosen. A rung has up
        # to three provider variants, so id-level exclusion still lets the top-up
        # add a sibling copy of a course the plan already contains — or one it just
        # told the learner it was waiving.
        blocked_rungs = set(seen_rungs) | {
            (w["branch"], w["track"], w["tier"]) for w in waivers
        }
        extras = self._gap_top_up(
            gap,
            ctx,
            chosen,
            exclude={self.cat.course_ids[p] for p in ladder_positions} | completed,
            blocked_rungs=blocked_rungs,
            budget_hours=top_up_budget,
        )
        selected.extend(extras)

        # ---- stage 6: order, phase, schedule ----
        self._assemble(plan, selected, weekly_hours)
        self._add_projects_and_assessments(plan, goal, chosen, waivers)
        self._renumber(plan)
        self._schedule(plan, weekly_hours)
        self._build_milestones(plan)

        # ---- transparency ----
        residual = self._residual_gap(gap, plan, current_skills)
        plan.analysis = {
            "gap": gap.as_dict(),
            "target_source": target_source,
            "readiness_before": gap.readiness,
            "readiness_after": residual["readiness_after"],
            "skills_to_gain": residual["skills_to_gain"],
            "level_used": level,
            "weekly_hours": weekly_hours,
            "timeline_weeks": timeline,
            "capacity_hours": round(capacity_hours, 1),
            "assumptions": waivers,
            "tracks_considered": [
                {"track": t, "relevance": round(w, 3)} for t, w in goal.ranked_tracks[:8]
            ],
            "goal": goal.as_dict(),
        }
        return plan

    # ------------------------------------------------------------------ #
    # Stage 1
    # ------------------------------------------------------------------ #
    def _select_tracks(
        self, goal: GoalInterpretation, max_tracks: int
    ) -> list[tuple[str, tuple[str, str], float]]:
        """Resolve goal tracks to concrete ``(branch, track)`` ladders."""
        ranked = goal.ranked_tracks
        if not ranked and goal.branches:
            # No track named, but a branch was: use its strongest ladders.
            branch = goal.branches[0]
            names = {self.cat.df.iloc[p]["track"] for p in self.cat.branch_index.get(branch, [])}
            ranked = [(n, 0.5) for n in sorted(names)]

        chosen: list[tuple[str, tuple[str, str], float]] = []
        used_names: set[str] = set()
        for name, weight in ranked:
            if len(chosen) >= max_tracks:
                break
            if name in used_names or weight < 0.25:
                continue
            key = self._resolve_track(name, goal.branches)
            if key is None:
                continue
            used_names.add(name)
            chosen.append((name, key, weight))
        return chosen

    def _resolve_track(
        self, track_name: str, preferred_branches: list[str]
    ) -> tuple[str, str] | None:
        """A track name can occur in several branches; pick the right one."""
        keys = [k for k in self.cat.track_index if k[1] == track_name]
        if not keys:
            return None
        for branch in preferred_branches:
            for key in keys:
                if key[0] == branch:
                    return key
        return max(
            keys,
            key=lambda k: (
                len(self.cat.track_index[k]),
                float(self.cat.quality[self.cat.track_index[k]].mean()),
            ),
        )

    # ------------------------------------------------------------------ #
    # Stage 2
    # ------------------------------------------------------------------ #
    def _start_tier(
        self,
        key: tuple[str, str],
        level: str,
        completed: set[str],
        goal: GoalInterpretation,
    ) -> tuple[int, list[dict]]:
        """Where to join this ladder, plus the assumptions that implies."""
        start = LEVEL_START_TIER.get(level, 0)
        if key[1] in goal.known_tracks:
            start = min(start + 1, len(TIER_PHASE) - 1)

        # Completed courses in this track push the start tier up.
        for tier in range(len(TIER_PHASE)):
            rung = (key[0], key[1], tier)
            members = self.graph.members.get(rung, [])
            if members and {self.cat.course_ids[p] for p in members} & completed:
                start = max(start, tier + 1)
        start = min(start, len(TIER_PHASE) - 1)

        waivers: list[dict] = []
        for tier in range(start):
            rung = (key[0], key[1], tier)
            members = self.graph.members.get(rung, [])
            if not members:
                continue
            if {self.cat.course_ids[p] for p in members} & completed:
                continue  # genuinely done, not an assumption
            best = max(members, key=lambda p: float(self.cat.quality[p]))
            waivers.append(
                {
                    "branch": key[0],
                    "track": key[1],
                    "tier": tier,
                    "difficulty": self.cat.df.iloc[best]["difficulty_level"],
                    "representative_course_id": self.cat.course_ids[best],
                    "representative_title": self.cat.df.iloc[best]["course_title"],
                    "reason": f"Skipped because you described yourself as {level}.",
                }
            )
        return start, waivers

    # ------------------------------------------------------------------ #
    # Stage 4
    # ------------------------------------------------------------------ #
    def _close_prerequisites(
        self,
        selected: list[tuple[Rung, RankedCourse, str]],
        ctx: RankingContext,
        completed: set[str],
        seen_rungs: set[Rung],
    ) -> list[tuple[Rung, RankedCourse, str]]:
        """Pull in unmet ancestor rungs so the plan is topologically valid."""
        queue = [rung for rung, _, _ in selected]
        added: list[tuple[Rung, RankedCourse, str]] = []
        while queue:
            rung = queue.pop()
            for prereq in self.graph.prereq_rungs(rung):
                if prereq in seen_rungs:
                    continue
                members = self.graph.members.get(prereq, [])
                member_ids = {self.cat.course_ids[p] for p in members}
                if member_ids & (completed | ctx.completed_ids):
                    continue  # satisfied or waived
                available = [p for p in members if self.cat.course_ids[p] not in completed]
                if not available:
                    continue
                best = self.ranker.rank(ctx, available, limit=1)
                if not best:
                    continue
                seen_rungs.add(prereq)
                added.append((prereq, best[0], "prerequisite"))
                queue.append(prereq)
        return selected + added

    # ------------------------------------------------------------------ #
    # Stage 5
    # ------------------------------------------------------------------ #
    def _gap_top_up(
        self,
        gap: GapReport,
        ctx: RankingContext,
        chosen: list[tuple[str, tuple[str, str], float]],
        exclude: set[str],
        blocked_rungs: set[Rung],
        budget_hours: float,
    ) -> list[tuple[Rung, RankedCourse, str]]:
        """Add the fewest extra courses that close the most remaining gap.

        The ladders teach their own skills well but leave cross-cutting gaps — a
        data-science path may still owe the learner SQL. Greedy set cover fills
        those, subject to three constraints, each one fixing a failure observed in
        testing:

        * **Entry tier only.** A top-up is breadth, not depth, and capping at
          Intermediate makes prerequisite validity cheap to guarantee — an
          unconstrained cover once pulled in a Capstone whose ladder was absent.
        * **Prerequisites satisfied** against everything already planned,
          completed, or waived.
        * **Relevant track.** Gap mass alone chases branch-wide filler, which once
          put HVAC Systems in a robotics path. Whole tracks are gated on similarity
          to the goal, which is a stronger filter than scoring courses one by one.

        Candidates are also reduced to one variant per rung, so cover cannot spend
        two of its picks on the same course from two different providers.
        """
        max_extra = int(np.clip(budget_hours // 30.0, 0, 4))
        if max_extra <= 0 or not gap.open_gaps:
            return []

        allowed_tracks = self._top_up_tracks(ctx, chosen)
        branches = {key[0] for _, key, _ in chosen}
        relevance = self.space.similarity_to_courses(ctx.goal_vector)

        by_rung: dict[Rung, int] = {}
        for branch in branches:
            for p in self.cat.branch_index.get(branch, []):
                if self.cat.course_ids[p] in exclude:
                    continue
                if int(self.cat.tiers[p]) > _TOP_UP_MAX_TIER:
                    continue
                if self.cat.df.iloc[p]["track"] not in allowed_tracks:
                    continue
                rung = self.graph.rung_of.get(p)
                if rung is None or rung in blocked_rungs:
                    continue
                if not self.graph.is_satisfied(self.cat, rung, ctx.completed_ids):
                    continue
                incumbent = by_rung.get(rung)
                if incumbent is None or self._variant_key(p, ctx) > self._variant_key(incumbent, ctx):
                    by_rung[rung] = p

        candidates = list(by_rung.values())
        if not candidates:
            return []

        cover = greedy_skill_cover(
            self.cat,
            gap,
            candidates,
            max_courses=max_extra,
            relevance=relevance,
            cost_sensitive=True,
        )
        if not cover.selected:
            return []

        ranked = {rc.pos: rc for rc in self.ranker.rank(ctx, cover.selected, limit=max_extra)}
        out: list[tuple[Rung, RankedCourse, str]] = []
        for pos in cover.selected:
            rc = ranked.get(pos)
            if rc is None:
                continue
            rc.newly_covered_skills = cover.newly_covered.get(pos, rc.newly_covered_skills)
            rung = self.graph.rung_of.get(pos, ("", "", int(self.cat.tiers[pos])))
            out.append((rung, rc, "gap_cover"))
        return out

    def _top_up_tracks(
        self,
        ctx: RankingContext,
        chosen: list[tuple[str, tuple[str, str], float]],
    ) -> set[str]:
        """Track names a gap top-up may be drawn from."""
        allowed = {name for name, _, _ in chosen}
        ranked = self.space.rank_tracks(ctx.goal_vector, top_n=_TOP_UP_TRACK_POOL)
        if ranked:
            floor = _TOP_UP_TRACK_FLOOR * ranked[0][1]
            allowed.update(name for name, score in ranked if score >= floor)
        return allowed

    def _variant_key(self, pos: int, ctx: RankingContext) -> tuple[int, int, float]:
        """Pick between provider variants of one rung, honouring stated preferences."""
        row = self.cat.df.iloc[pos]
        return (
            1 if row["provider"] in ctx.preferred_providers else 0,
            1 if row["format"] in ctx.preferred_formats else 0,
            float(self.cat.quality[pos]),
        )

    # ------------------------------------------------------------------ #
    # Stage 6
    # ------------------------------------------------------------------ #
    def _assemble(
        self,
        plan: LearningPlan,
        selected: list[tuple[Rung, RankedCourse, str]],
        weekly_hours: float,
    ) -> None:
        """Order by dependency depth, then group into tier-based phases."""
        # Deduplicate defensively: a rung can be reached from several directions.
        unique: dict[str, tuple[Rung, RankedCourse, str]] = {}
        for rung, rc, origin in selected:
            unique.setdefault(rc.course_id, (rung, rc, origin))

        ordered = sorted(
            unique.values(),
            key=lambda t: (
                self.graph.depth.get(t[0], int(self.cat.tiers[t[1].pos])),
                int(self.cat.tiers[t[1].pos]),
                -t[1].score,
            ),
        )

        tiers_present = sorted({int(self.cat.tiers[rc.pos]) for _, rc, _ in ordered})
        phase_of_tier = {tier: i for i, tier in enumerate(tiers_present)}

        for phase_index, tier in enumerate(tiers_present):
            name, focus = TIER_PHASE.get(tier, (f"Stage {phase_index + 1}", ""))
            plan.phases.append(Phase(index=phase_index, name=name, focus=focus))

        for rung, rc, origin in ordered:
            row = self.cat.df.iloc[rc.pos]
            tier = int(self.cat.tiers[rc.pos])
            phase_index = phase_of_tier[tier]
            plan.items.append(
                PlanItem(
                    item_type="course",
                    title=row["course_title"],
                    hours=float(row["estimated_hours"]),
                    phase_index=phase_index,
                    phase_name=plan.phases[phase_index].name,
                    course_id=rc.course_id,
                    score=rc.score,
                    factors=rc.factors,
                    contributions=rc.contributions,
                    rationale=self._rationale(rc, origin),
                    prerequisite_ids=self.graph.prerequisite_course_ids(self.cat, rc.pos),
                    skills=list(row["skills_taught"]),
                    origin=origin,
                    meta={
                        "provider": row["provider"],
                        "format": row["format"],
                        "difficulty": row["difficulty_level"],
                        "track": row["track"],
                        "branch": row["branch"],
                        "rating": float(row["rating"]),
                        "num_reviews": int(row["num_reviews"]),
                        "tier": tier,
                        "covers_skills": rc.newly_covered_skills,
                        "missing_prerequisites": rc.missing_prereq_ids,
                    },
                )
            )

    def _rationale(self, rc: RankedCourse, origin: str) -> str:
        """A short, factual reason. :mod:`app.ml.explainer` produces the prose."""
        if origin == "prerequisite":
            return "Required before a later course in your path."
        if origin == "gap_cover":
            covered = ", ".join(rc.newly_covered_skills[:3])
            return f"Closes remaining gaps: {covered}." if covered else "Closes remaining skill gaps."
        top = rc.top_factors[:2]
        reasons = [FACTOR_LABELS.get(name, name) for name, _ in top]
        return "Chosen because it " + " and ".join(reasons) + "."

    # ------------------------------------------------------------------ #
    def _add_projects_and_assessments(
        self,
        plan: LearningPlan,
        goal: GoalInterpretation,
        chosen: list[tuple[str, tuple[str, str], float]],
        waivers: list[dict],
    ) -> None:
        from app.ml.projects import synthesize_phase_items

        synthesize_phase_items(plan, self.cat, goal, chosen, waivers)

    def _renumber(self, plan: LearningPlan) -> None:
        """Assign final order indices, keeping items grouped by phase."""
        plan.items.sort(key=lambda i: (i.phase_index, i.sort_hint))
        for order, item in enumerate(plan.items):
            item.order_index = order
            item.phase_name = plan.phases[item.phase_index].name if plan.phases else ""
            if plan.phases:
                plan.phases[item.phase_index].item_orders.append(order)

    def _schedule(self, plan: LearningPlan, weekly_hours: float) -> None:
        """Convert cumulative hours into week offsets per phase."""
        rate = max(weekly_hours, 1.0)
        cumulative = 0.0
        for phase in plan.phases:
            phase.hours = sum(i.hours for i in plan.items if i.phase_index == phase.index)
            phase.start_week = int(cumulative / rate) + 1
            cumulative += phase.hours
            phase.end_week = max(int(math.ceil(cumulative / rate)), phase.start_week)
            phase.skills = _unique(
                s for i in plan.items if i.phase_index == phase.index for s in i.skills
            )

        plan.total_hours = cumulative
        plan.total_courses = sum(1 for i in plan.items if i.item_type == "course")
        plan.estimated_weeks = int(math.ceil(cumulative / rate)) if cumulative else 0

    def _build_milestones(self, plan: LearningPlan) -> None:
        """One milestone per phase boundary, named by the capability it proves."""
        if not plan.phases or plan.total_hours <= 0:
            return
        cumulative = 0.0
        earned: set[str] = set()
        for phase in plan.phases:
            cumulative += phase.hours
            new_skills = [s for s in phase.skills if s not in earned]
            earned.update(new_skills)
            required = [
                i.course_id
                for i in plan.items
                if i.phase_index == phase.index and i.course_id
            ]
            plan.milestones.append(
                MilestoneSpec(
                    title=f"{phase.name} complete",
                    description=(
                        f"Finish the {len(required)} course(s) in {phase.name} "
                        f"to demonstrate {', '.join(new_skills[:4]) or 'the phase objectives'}."
                    ),
                    target_week=phase.end_week,
                    progress_threshold=cumulative / plan.total_hours,
                    skills_unlocked=new_skills[:8],
                    required_course_ids=required,
                )
            )

    # ------------------------------------------------------------------ #
    def _residual_gap(
        self, gap: GapReport, plan: LearningPlan, current_skills: dict[str, float]
    ) -> dict:
        """Project the learner's competence forward if they finish the plan."""
        remaining = {s: 1.0 - v for s, v in current_skills.items()}
        for item in plan.items:
            if not item.course_id:
                continue
            pos = self.cat.pos(item.course_id)
            if pos is None:
                continue
            g = TIER_SKILL_GAIN.get(int(self.cat.tiers[pos]), 0.4)
            for skill in self.cat.df.iloc[pos]["skills_taught"]:
                remaining[skill] = remaining.get(skill, 1.0) * (1.0 - g)

        projected = {s: 1.0 - r for s, r in remaining.items()}
        importance = {g.skill: g.importance for g in gap.gaps}
        after = analyse_gap(self.competency, importance, projected, source=gap.source)
        gained = [
            g.skill
            for g in gap.gaps
            if projected.get(g.skill, 0.0) >= g.required > current_skills.get(g.skill, 0.0)
        ]
        return {"readiness_after": after.readiness, "skills_to_gain": gained[:12]}


#: Waivers assumed the learner already knows the skipped tiers; the placement
#: check in :mod:`app.ml.projects` is what lets them verify that cheaply.
def _unique(values) -> list[str]:
    seen: dict[str, None] = {}
    for v in values:
        seen.setdefault(v, None)
    return list(seen)

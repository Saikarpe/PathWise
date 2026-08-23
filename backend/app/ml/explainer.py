"""Turning scores into reasons.

Every explanation in this system is derived from numbers the ranker actually
computed, never from a language model's impression of the catalogue. The ranker
stores each candidate's factor values and each factor's *share* of the final
score (see :mod:`app.ml.ranker`), so an explanation can be built by reading that
attribution vector back out:

    contributions = {"skill_gain": 0.31, "goal_fit": 0.28, "level_fit": 0.18, ...}
    -> "Ranked #1 mainly because it closes 4 of your 9 open skill gaps (31% of
        its score) and matches your stated goal (28%). Its rating is only
        average, which cost it some ground."

That property matters for two reasons. It is *falsifiable* — a learner can check
each claim against the course page — and it stays correct when the learner's
weights drift under feedback, because the same vector that produced the ranking
produces the sentence.

:mod:`app.ml.llm` may later rewrite these strings more fluently, but it is given
this text as the source of truth and is never asked to invent the reasoning. When
no API key is present the templates here are the whole explanation layer, which
is why they are written to read as prose rather than as debug output.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from app.ml.catalog import Catalog
from app.ml.planner import LearningPlan, PlanItem
from app.ml.ranker import FACTOR_LABELS, RankedCourse
from app.ml.skills import GapReport

#: Contribution share below which a factor is not worth mentioning.
_MENTION_FLOOR = 0.08
#: Factor value below which a factor is worth mentioning as a *drawback*.
_WEAKNESS_CEILING = 0.35
#: Factors whose low values are informative rather than noise.
_WEAKNESS_FACTORS = ("quality", "level_fit", "prereq_ready", "effort_fit")

#: Phrasing for a factor scoring poorly, keyed by factor name.
_WEAKNESS_PHRASES: dict[str, str] = {
    "quality": "its learner rating is below average for this catalogue",
    "level_fit": "it sits outside your stated level, so expect some friction",
    "prereq_ready": "it has prerequisites you have not covered yet",
    "effort_fit": "it is long relative to your weekly study time",
}


@dataclass
class Explanation:
    """A layered explanation: one line, a paragraph, and the raw evidence."""

    headline: str
    detail: str
    #: ``(factor label, share)`` pairs, strongest first.
    drivers: list[tuple[str, float]] = field(default_factory=list)
    caveats: list[str] = field(default_factory=list)
    evidence: dict = field(default_factory=dict)

    def as_dict(self) -> dict:
        return {
            "headline": self.headline,
            "detail": self.detail,
            "drivers": [{"factor": f, "share": round(s, 4)} for f, s in self.drivers],
            "caveats": self.caveats,
            "evidence": self.evidence,
        }


class Explainer:
    """Builds explanations for recommendations, plans and progress."""

    def __init__(self, cat: Catalog) -> None:
        self.cat = cat

    # ------------------------------------------------------------------ #
    def explain_course(
        self,
        rc: RankedCourse,
        *,
        rank: int | None = None,
        gap: GapReport | None = None,
        goal_text: str = "",
    ) -> Explanation:
        """Why this course, at this position, for this learner."""
        row = self.cat.df.iloc[rc.pos]
        title = row["course_title"]

        drivers = [
            (FACTOR_LABELS.get(name, name), share)
            for name, share in rc.top_factors
            if share >= _MENTION_FLOOR
        ][:3]

        position = f"Ranked #{rank}" if rank else "Recommended"
        if drivers:
            lead = _join_with_shares(drivers[:2])
            headline = f"{position} because it {lead}."
        else:
            headline = f"{position} as the best overall match in the catalogue."

        sentences: list[str] = []

        # 1. The skills it closes — the most concrete claim available.
        covered = rc.newly_covered_skills
        if covered and gap is not None:
            open_count = len(gap.open_gaps)
            named = ", ".join(covered[:4])
            more = f" and {len(covered) - 4} more" if len(covered) > 4 else ""
            sentences.append(
                f"It covers {len(covered)} of the {open_count} skills you still need "
                f"for this goal — {named}{more}."
            )
        elif covered:
            sentences.append(f"It teaches {', '.join(covered[:4])}.")

        # 2. Level and effort, stated in the learner's own units.
        hours = float(row["estimated_hours"])
        sentences.append(
            f"It is pitched at {row['difficulty_level']} level and takes about "
            f"{hours:.0f} hours, delivered as {_article(row['format'])} "
            f"{row['format'].lower()} on {row['provider']}."
        )

        # 3. Social proof, but honest about the sample size.
        reviews = int(row["num_reviews"])
        sentences.append(
            f"Learners rate it {float(row['rating']):.1f}/5 across "
            f"{reviews:,} reviews"
            + (
                ", which is a thin sample, so we weighted it toward the catalogue average."
                if reviews < 400
                else "."
            )
        )

        # 4. Prerequisites, framed as ordering rather than rejection.
        caveats: list[str] = []
        if rc.missing_prereq_ids:
            names = [self._title(cid) for cid in rc.missing_prereq_ids[:2]]
            caveats.append(
                "Take it after " + " and ".join(names) + " — those come first in your path."
            )

        for name in _WEAKNESS_FACTORS:
            value = rc.factors.get(name, 1.0)
            if value <= _WEAKNESS_CEILING and name in _WEAKNESS_PHRASES:
                if name == "prereq_ready" and rc.missing_prereq_ids:
                    continue  # already said, more specifically
                caveats.append(_WEAKNESS_PHRASES[name].capitalize() + ".")

        if goal_text:
            sentences.append(
                f'Relevance was measured against your own words: "{_clip(goal_text, 110)}".'
            )

        return Explanation(
            headline=headline,
            detail=" ".join(sentences),
            drivers=drivers,
            caveats=caveats,
            evidence={
                "course_id": rc.course_id,
                "title": title,
                "score": round(rc.score, 4),
                "factors": {k: round(v, 4) for k, v in rc.factors.items()},
                "contributions": {k: round(v, 4) for k, v in rc.contributions.items()},
                "covers_skills": covered,
                "missing_prerequisites": rc.missing_prereq_ids,
            },
        )

    # ------------------------------------------------------------------ #
    def explain_plan(self, plan: LearningPlan) -> Explanation:
        """Why the path has this shape, this length, and these assumptions."""
        analysis = plan.analysis or {}
        if analysis.get("error"):
            return Explanation(
                headline="I could not match that goal to a learning track yet.",
                detail=(
                    "Tell me the field or role you are aiming at — for example "
                    '"machine learning", "structural engineering" or "become a '
                    'security analyst" — and I will build the path from there.'
                ),
            )

        tracks = [t["track"] for t in plan.tracks]
        before = float(analysis.get("readiness_before", 0.0))
        after = float(analysis.get("readiness_after", 0.0))
        weekly = float(analysis.get("weekly_hours", 8.0))

        headline = (
            f"{plan.total_courses} courses across {len(plan.phases)} phases, "
            f"about {plan.total_hours:.0f} hours — roughly {plan.estimated_weeks} weeks "
            f"at {weekly:.0f} hours a week."
        )

        sentences = [
            f"The path is built from {_oxford(tracks)}, chosen because "
            f"{'they were' if len(tracks) > 1 else 'it was'} the closest match to "
            f"what you described."
        ]

        gap = analysis.get("gap") or {}
        open_gaps = gap.get("open_gap_count")
        if open_gaps:
            sentences.append(
                f"Against that target you currently meet {before:.0%} of the requirement, "
                f"with {open_gaps} skills open. Finishing this path projects you to "
                f"{after:.0%}."
            )
        else:
            sentences.append(
                f"You currently meet {before:.0%} of the requirement; finishing this "
                f"path projects you to {after:.0%}."
            )

        if analysis.get("target_source"):
            sentences.append(f"The target skill set came from {analysis['target_source']}.")

        phases = ", ".join(f"{p.name} (weeks {p.start_week}–{p.end_week})" for p in plan.phases)
        sentences.append(f"Phases run in prerequisite order: {phases}.")

        origins = {}
        for item in plan.items:
            if item.item_type == "course":
                origins[item.origin] = origins.get(item.origin, 0) + 1
        if origins.get("prerequisite"):
            sentences.append(
                f"{origins['prerequisite']} course(s) were added purely to satisfy "
                f"prerequisites, so nothing in the path arrives before its foundation."
            )
        if origins.get("gap_cover"):
            sentences.append(
                f"{origins['gap_cover']} extra course(s) were added to close skills "
                f"the main tracks do not teach."
            )

        caveats: list[str] = []
        for waiver in analysis.get("assumptions", [])[:4]:
            caveats.append(
                f"Assumed you already know {waiver['track']} at "
                f"{waiver['difficulty']} level, so \"{waiver['representative_title']}\" "
                f"was skipped."
            )
        if caveats:
            caveats.append(
                "The placement check in phase 1 exists to test those assumptions before "
                "they cost you weeks."
            )

        timeline = analysis.get("timeline_weeks")
        if timeline and plan.estimated_weeks > int(timeline):
            caveats.append(
                f"This runs {plan.estimated_weeks - int(timeline)} weeks past the "
                f"{timeline}-week deadline you mentioned. Raise your weekly hours or "
                f"tell me to drop a track and I will re-plan."
            )

        return Explanation(
            headline=headline,
            detail=" ".join(sentences),
            drivers=[(t["track"], float(t["relevance"])) for t in plan.tracks],
            caveats=caveats,
            evidence={
                "tracks": plan.tracks,
                "readiness_before": before,
                "readiness_after": after,
                "total_hours": round(plan.total_hours, 1),
                "estimated_weeks": plan.estimated_weeks,
                "skills_to_gain": analysis.get("skills_to_gain", []),
            },
        )

    # ------------------------------------------------------------------ #
    def explain_item(self, item: PlanItem) -> Explanation:
        """Why a single roadmap step is there — courses, projects and assessments."""
        if item.item_type == "project":
            meta = item.meta
            deliverables = meta.get("deliverables", [])
            return Explanation(
                headline=f"{meta.get('kind', 'Project')}: build {meta.get('artifact', 'something real')}.",
                detail=(
                    item.rationale
                    + (
                        " Deliverables: " + "; ".join(deliverables) + "."
                        if deliverables
                        else ""
                    )
                    + (
                        f" Suggested tools from your courses: {', '.join(meta.get('tools', [])[:4])}."
                        if meta.get("tools")
                        else ""
                    )
                ),
                evidence={"phase": item.phase_name, "hours": item.hours, **meta},
            )

        if item.item_type == "assessment":
            meta = item.meta
            threshold = meta.get("pass_threshold")
            sections = meta.get("sections") or meta.get("waived") or []
            return Explanation(
                headline=f"{meta.get('kind', 'Assessment')} — {item.hours:.1f} hours.",
                detail=(
                    item.rationale
                    + (f" Pass mark is {float(threshold):.0%}." if threshold else "")
                ),
                evidence={"phase": item.phase_name, "sections": sections, **meta},
            )

        drivers = [
            (FACTOR_LABELS.get(name, name), share)
            for name, share in sorted(item.contributions.items(), key=lambda kv: -kv[1])
            if share >= _MENTION_FLOOR
        ][:3]
        headline = item.rationale or "Part of your path."
        detail_parts = [
            f"Phase {item.phase_index + 1} ({item.phase_name}), about {item.hours:.0f} hours."
        ]
        if item.meta.get("covers_skills"):
            detail_parts.append(
                "Closes: " + ", ".join(item.meta["covers_skills"][:5]) + "."
            )
        if item.prerequisite_ids:
            detail_parts.append(
                "Builds on " + ", ".join(self._title(c) for c in item.prerequisite_ids[:2]) + "."
            )
        if drivers:
            detail_parts.append("Score driven by: " + _join_with_shares(drivers) + ".")
        return Explanation(
            headline=headline,
            detail=" ".join(detail_parts),
            drivers=drivers,
            evidence={"course_id": item.course_id, "origin": item.origin, **item.meta},
        )

    # ------------------------------------------------------------------ #
    def explain_progress(self, snapshot: dict) -> Explanation:
        """Narrate a dashboard snapshot: where the learner is and what is next."""
        done = int(snapshot.get("completed_courses", 0))
        total = int(snapshot.get("total_courses", 0)) or 1
        pct = float(snapshot.get("progress", 0.0))
        hours_done = float(snapshot.get("hours_completed", 0.0))
        hours_total = float(snapshot.get("total_hours", 0.0))
        weekly = float(snapshot.get("weekly_hours", 8.0)) or 8.0

        headline = f"{done} of {total} courses done — {pct:.0%} of the path."
        sentences = [
            f"That is {hours_done:.0f} of {hours_total:.0f} hours."
        ]
        remaining = max(hours_total - hours_done, 0.0)
        if remaining > 0:
            sentences.append(
                f"At {weekly:.0f} hours a week you have about "
                f"{max(1, round(remaining / weekly))} weeks left."
            )
        else:
            sentences.append("The planned hours are complete.")

        nxt = snapshot.get("next_item")
        if nxt:
            sentences.append(f"Next up: {nxt.get('title')} ({nxt.get('hours', 0):.0f} hours).")

        milestone = snapshot.get("next_milestone")
        if milestone:
            sentences.append(
                f"The next milestone is \"{milestone.get('title')}\" in week "
                f"{milestone.get('target_week')}."
            )

        gained = snapshot.get("skills_proficient") or []
        if gained:
            sentences.append(
                f"You are now proficient in {len(gained)} skills, including "
                f"{', '.join(gained[:4])}."
            )

        caveats: list[str] = []
        if snapshot.get("weeks_behind"):
            caveats.append(
                f"You are about {snapshot['weeks_behind']} weeks behind the original "
                f"schedule. Ask me to re-plan and I will fit the remainder to your "
                f"current pace."
            )

        return Explanation(
            headline=headline,
            detail=" ".join(sentences),
            caveats=caveats,
            # Only the figures this narrative actually quoted, copied out rather
            # than aliased. Passing the whole snapshot made it self-referential —
            # the caller stores this explanation back onto the snapshot under
            # "narrative", so evidence-is-snapshot is a cycle, and any JSON
            # encoder walking it recurses until it dies.
            evidence={
                "completed_courses": done,
                "total_courses": total,
                "progress": pct,
                "hours_completed": hours_done,
                "total_hours": hours_total,
                "weekly_hours": weekly,
                "hours_remaining": round(remaining, 1),
                "weeks_behind": snapshot.get("weeks_behind", 0),
                "next_item": (nxt or {}).get("title"),
                "next_milestone": (milestone or {}).get("title"),
                "skills_proficient": list(gained),
            },
        )

    # ------------------------------------------------------------------ #
    def _title(self, course_id: str) -> str:
        pos = self.cat.pos(course_id)
        return str(self.cat.df.iloc[pos]["course_title"]) if pos is not None else course_id


# --------------------------------------------------------------------------- #
def _join_with_shares(drivers: list[tuple[str, float]]) -> str:
    """"closes open skill gaps (31%) and matches your stated goal (28%)"."""
    parts = [f"{label} ({share:.0%})" for label, share in drivers]
    if len(parts) <= 1:
        return parts[0] if parts else ""
    return ", ".join(parts[:-1]) + " and " + parts[-1]


def _oxford(items: list[str]) -> str:
    items = [i for i in items if i]
    if not items:
        return "the closest available track"
    if len(items) == 1:
        return f"the {items[0]} track"
    return "the " + ", ".join(items[:-1]) + f" and {items[-1]} tracks"


def _article(word: str) -> str:
    return "an" if word and word[0].lower() in "aeiou" else "a"


def _clip(text: str, limit: int) -> str:
    text = " ".join(text.split())
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"

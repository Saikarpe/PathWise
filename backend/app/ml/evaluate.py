"""Offline evaluation of the recommender and path planner.

Run with ``python -m app.ml.evaluate`` (add ``--json out.json`` to save).

Why this exists: "we built a recommender" is a claim; "we built one and here
is what it scores" is evidence. Every metric here is computed against the real
catalogue, so the numbers describe the system that actually ships.

**On the absence of user data.** This project has no population of real
learners, so there are no historical interactions to hold out — which rules
out the usual offline metrics (precision@k against observed clicks, NDCG
against relevance judgements, collaborative-filtering RMSE). Inventing that
data would make the numbers meaningless, so instead every metric below is
either:

  * a *structural invariant* the system claims to guarantee (prerequisite
    ordering, goal relevance), which can be checked exhaustively without
    labels; or
  * a *behavioural property* measurable against the catalogue itself
    (coverage, gap closure, latency); or
  * accuracy against labels *derived from the catalogue's own taxonomy*
    (intent resolution), not hand-invented.

That is a narrower claim than "our model scores X on a benchmark", and it is
the honest one available here.
"""
from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
from dataclasses import dataclass, field

from sqlalchemy import create_engine as sa_create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.ml.engine import Engine
from app.models.user import User

#: Goal phrasings for the sweep. Deliberately varied in shape — bare track
#: names, role-led sentences, constraint-laden prose, cross-branch moves — so
#: the metrics reflect the range of input the parser actually sees rather than
#: one convenient template.
GOAL_SWEEP: list[str] = [
    "I want to become a machine learning engineer",
    "I want to get into cybersecurity",
    "help me move into cloud engineering, I know linux",
    "I'm a mechanical engineer moving into robotics",
    "become a data engineer, 10 hours a week",
    "I want to learn embedded systems and IoT",
    "structural engineering for earthquake-resistant design",
    "I want to work on autonomous vehicles",
    "get me into VLSI design",
    "I want to do power systems engineering",
    "move from IT support into DevOps",
    "I want to become a full stack web developer",
    "aerospace propulsion, I have done thermodynamics",
    "I want to learn petroleum reservoir engineering",
    "biomedical signal processing for medical devices",
    "become a quality engineer in manufacturing",
    "I want to specialise in water treatment and environmental compliance",
    "chemical process design and simulation",
    "I want to build mobile apps",
    "natural language processing and LLMs",
]


@dataclass
class Metric:
    """One reported number, with the context needed to judge it."""

    name: str
    value: float
    unit: str = ""
    detail: str = ""
    #: Threshold the value should meet, when the metric is a hard invariant.
    target: float | None = None
    higher_is_better: bool = True

    @property
    def passed(self) -> bool | None:
        if self.target is None:
            return None
        return self.value >= self.target if self.higher_is_better else self.value <= self.target

    def as_dict(self) -> dict:
        return {
            "name": self.name,
            "value": round(self.value, 4),
            "unit": self.unit,
            "detail": self.detail,
            "target": self.target,
            "passed": self.passed,
        }


@dataclass
class Report:
    metrics: list[Metric] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    def add(self, metric: Metric) -> None:
        self.metrics.append(metric)

    @property
    def failures(self) -> list[Metric]:
        return [m for m in self.metrics if m.passed is False]

    def as_dict(self) -> dict:
        return {
            "metrics": [m.as_dict() for m in self.metrics],
            "notes": self.notes,
            "failed": [m.name for m in self.failures],
        }

    def render(self) -> str:
        width = max(len(m.name) for m in self.metrics) + 2
        lines = ["", "=" * 78, "RECOMMENDER & PLANNER EVALUATION", "=" * 78, ""]
        for m in self.metrics:
            mark = {True: "PASS", False: "FAIL", None: "    "}[m.passed]
            value = f"{m.value:,.4g}{m.unit}"
            lines.append(f"  [{mark}] {m.name:<{width}} {value:>12}")
            if m.detail:
                lines.append(f"         {' ' * width} {m.detail}")
        if self.notes:
            lines += ["", "-" * 78, "Notes:"]
            lines += [f"  * {n}" for n in self.notes]
        lines += ["", "=" * 78]
        lines.append(
            "RESULT: all checks passed"
            if not self.failures
            else f"RESULT: {len(self.failures)} check(s) failed: "
            + ", ".join(m.name for m in self.failures)
        )
        lines.append("=" * 78)
        return "\n".join(lines)


def _session_factory():
    """In-memory DB. The engine's APIs need a session; nothing is persisted."""
    db_engine = sa_create_engine(
        "sqlite:///:memory:", connect_args={"check_same_thread": False}
    )
    Base.metadata.create_all(db_engine)
    return sessionmaker(bind=db_engine, autoflush=False)


def _probe_user(db, level: str = "Beginner", weekly_hours: float = 10.0) -> User:
    user = User(
        email=f"eval-{level}-{weekly_hours}@local",
        hashed_password="x",
        full_name="Evaluation Probe",
        experience_level=level,
        weekly_hours=weekly_hours,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def evaluate(*, quiet: bool = False) -> Report:
    def say(message: str) -> None:
        if not quiet:
            print(message, file=sys.stderr)

    report = Report()
    say("Warming engine ...")
    eng = Engine()
    warm_started = time.perf_counter()
    eng.warm()
    warm_seconds = time.perf_counter() - warm_started
    cat = eng.catalog
    assert cat is not None and eng.graph is not None

    Session = _session_factory()
    db = Session()
    user = _probe_user(db)

    say(f"Sweeping {len(GOAL_SWEEP)} goals ...")

    interpret_ms: list[float] = []
    recommend_ms: list[float] = []
    plan_ms: list[float] = []

    plannable = 0
    prereq_checked = 0
    prereq_violations = 0
    goal_relevant = 0
    goal_gap_closing = 0
    goal_total = 0
    readiness_gains: list[float] = []
    recommended_positions: set[int] = set()
    planned_positions: set[int] = set()
    milestone_counts: list[int] = []
    project_share: list[float] = []

    for text in GOAL_SWEEP:
        t0 = time.perf_counter()
        goal = eng.interpret(text)
        interpret_ms.append((time.perf_counter() - t0) * 1000)
        if not goal.has_target:
            continue
        plannable += 1
        goal_tracks = {name for name, _ in goal.ranked_tracks[:5]}

        # ---- recommendations ----
        t0 = time.perf_counter()
        recs = eng.recommend(db, user, goal=goal, limit=10)
        recommend_ms.append((time.perf_counter() - t0) * 1000)
        for rec in recs:
            course = rec["course"]
            pos = cat.pos(course["course_id"])
            if pos is not None:
                recommended_positions.add(pos)
            goal_total += 1
            in_track = course.get("track") in goal_tracks
            # `covers_skills` is the intersection of what this course teaches
            # with the learner's *open gap vector* (see Ranker), so a non-empty
            # list means the recommendation is closing a real gap even when it
            # sits outside the literally-resolved tracks.
            closes_gap = bool(rec.get("covers_skills"))
            if in_track:
                goal_relevant += 1
            if in_track or closes_gap:
                goal_gap_closing += 1

        # ---- plan ----
        t0 = time.perf_counter()
        plan, _ = eng.build_plan(db, user, goal=goal)
        plan_ms.append((time.perf_counter() - t0) * 1000)
        if not plan.items:
            continue

        milestone_counts.append(len(plan.milestones))
        courses = [i for i in plan.items if i.item_type == "course"]
        if plan.items:
            project_share.append(
                sum(1 for i in plan.items if i.item_type != "course") / len(plan.items)
            )

        # Prerequisite ordering: every prerequisite that is itself in the plan
        # must appear earlier. This is the planner's central correctness claim.
        position_of = {
            item.course_id: idx for idx, item in enumerate(plan.items) if item.course_id
        }
        for idx, item in enumerate(plan.items):
            for prereq in item.prerequisite_ids or []:
                if prereq in position_of:
                    prereq_checked += 1
                    if position_of[prereq] > idx:
                        prereq_violations += 1

        for item in courses:
            pos = cat.pos(item.course_id or "")
            if pos is not None:
                planned_positions.add(pos)

        analysis = plan.analysis or {}
        before = analysis.get("readiness_before")
        after = analysis.get("readiness_after")
        if before is not None and after is not None:
            readiness_gains.append(float(after) - float(before))

    # ---- intent resolution against catalogue-derived labels ----------------
    # Labels are not hand-invented: each track name in the catalogue is its own
    # ground truth, phrased the way a learner would type it. This measures
    # whether the four-layer parser can round-trip the taxonomy it was built
    # from — a necessary condition, not a sufficient one.
    track_names = sorted(cat.track_name_index)
    sample = track_names[:: max(1, len(track_names) // 60)][:60]
    resolved = 0
    for name in sample:
        interp = eng.interpret(f"I want to learn {name}")
        top = [t for t, _ in interp.ranked_tracks[:3]]
        if name in top:
            resolved += 1

    db.close()

    # ---- assemble ---------------------------------------------------------
    report.add(
        Metric(
            "prerequisite_ordering_valid",
            1.0 if prereq_checked == 0 else 1 - (prereq_violations / prereq_checked),
            unit="",
            detail=f"{prereq_checked - prereq_violations}/{prereq_checked} in-plan prerequisite edges correctly ordered",
            target=1.0,
        )
    )
    report.add(
        Metric(
            "goal_plannable_rate",
            plannable / len(GOAL_SWEEP),
            detail=f"{plannable}/{len(GOAL_SWEEP)} sweep goals resolved to a plannable target",
            target=0.9,
        )
    )
    report.add(
        Metric(
            "intent_resolution_top3",
            resolved / len(sample) if sample else 0.0,
            detail=f"{resolved}/{len(sample)} catalogue tracks recovered in top-3 from a natural phrasing",
            target=0.85,
        )
    )
    # The system's actual claim is "relevant to your goal *or* closing an open
    # skill gap" — an ML-engineer goal legitimately surfaces NLP, Computer
    # Vision and MLOps-adjacent courses that are not in the two tracks the
    # parser literally resolved. That compound claim is the one with a target.
    report.add(
        Metric(
            "recommendation_relevance",
            goal_gap_closing / goal_total if goal_total else 0.0,
            detail=f"{goal_gap_closing}/{goal_total} recommendations were in-track or closed an open gap",
            target=0.9,
        )
    )
    # Reported without a target: strict track-precision is descriptive, not an
    # invariant. Driving it to 1.0 would mean never recommending an adjacent
    # or gap-filling course, which would make the recommender worse, not
    # better — so it is shown for transparency rather than optimised against.
    report.add(
        Metric(
            "recommendation_track_precision",
            goal_relevant / goal_total if goal_total else 0.0,
            detail=f"{goal_relevant}/{goal_total} sat strictly inside the resolved goal tracks (descriptive only)",
        )
    )
    report.add(
        Metric(
            "mean_readiness_gain",
            statistics.mean(readiness_gains) if readiness_gains else 0.0,
            detail=f"projected skill-gap closure per plan, averaged over {len(readiness_gains)} plans",
            target=0.3,
        )
    )
    report.add(
        Metric(
            "catalogue_coverage",
            len(recommended_positions | planned_positions) / cat.size,
            detail=(
                f"{len(recommended_positions | planned_positions)}/{cat.size} distinct courses surfaced "
                f"across {plannable} goals — guards against a recommender that only ever returns the same few"
            ),
        )
    )
    report.add(
        Metric(
            "mean_practice_share",
            statistics.mean(project_share) if project_share else 0.0,
            detail="fraction of plan steps that are projects/assessments rather than courses",
        )
    )
    report.add(
        Metric(
            "mean_milestones_per_plan",
            statistics.mean(milestone_counts) if milestone_counts else 0.0,
            detail=f"over {len(milestone_counts)} plans",
        )
    )
    report.add(
        Metric("engine_warmup", warm_seconds, unit="s", detail="one-off cost at process start")
    )
    for label, samples in (
        ("latency_interpret_p95", interpret_ms),
        ("latency_recommend_p95", recommend_ms),
        ("latency_plan_p95", plan_ms),
    ):
        if not samples:
            continue
        ordered = sorted(samples)
        p95 = ordered[min(len(ordered) - 1, int(len(ordered) * 0.95))]
        report.add(
            Metric(
                label,
                p95,
                unit="ms",
                detail=f"median {statistics.median(samples):.1f}ms over {len(samples)} calls",
                target=1500.0,
                higher_is_better=False,
            )
        )

    report.notes.append(
        "No held-out interaction data exists for this system, so these are structural "
        "and behavioural metrics rather than accuracy against observed learner choices."
    )
    report.notes.append(
        "Intent labels derive from the catalogue's own track taxonomy, not hand-written "
        "judgements, so the score measures taxonomy round-tripping rather than open-ended NLU."
    )
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description="Evaluate the recommender and planner.")
    parser.add_argument("--json", metavar="PATH", help="also write the report as JSON")
    parser.add_argument("--quiet", action="store_true", help="suppress progress output")
    args = parser.parse_args()

    report = evaluate(quiet=args.quiet)
    print(report.render())
    if args.json:
        with open(args.json, "w", encoding="utf-8") as handle:
            json.dump(report.as_dict(), handle, indent=2)
        print(f"\nWrote {args.json}")
    return 1 if report.failures else 0


if __name__ == "__main__":
    sys.exit(main())

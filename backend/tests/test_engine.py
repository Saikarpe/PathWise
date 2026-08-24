"""Tests for the ML engine: parsing, ranking, planning, adaptation.

These assert the *invariants the product claims*, not incidental current
behaviour — a test that pins today's exact recommendation would break on any
tuning change without indicating a real regression. What must never break:
prerequisites come first, completions are never re-recommended, feedback
actually moves the model, and every score is decomposable.
"""
from __future__ import annotations

import pytest
from sqlalchemy.orm import Session

from app.ml.engine import Engine
from app.ml.ranker import FACTORS
from app.models.user import User


# --------------------------------------------------------------------- #
# Intent parsing
# --------------------------------------------------------------------- #
@pytest.mark.parametrize(
    "text,expected_track",
    [
        ("I want to become a machine learning engineer", "Machine Learning"),
        ("I want to get into cybersecurity", "Cybersecurity"),
        ("help me learn robotics programming", "Robotics Programming"),
        ("I want to study thermodynamics", "Thermodynamics"),
    ],
)
def test_interpret_resolves_goal_to_expected_track(
    engine: Engine, text: str, expected_track: str
) -> None:
    goal = engine.interpret(text)
    assert goal.has_target
    assert expected_track in [t for t, _ in goal.ranked_tracks[:3]]


def test_interpret_extracts_stated_constraints(engine: Engine) -> None:
    goal = engine.interpret(
        "I want to become a data engineer, I have about 6 hours a week, in 12 weeks"
    )
    assert goal.weekly_hours == 6
    assert goal.timeline_weeks == 12


def test_interpret_separates_known_from_wanted(engine: Engine) -> None:
    """Stated background must not be mistaken for a goal — the plan starts above it."""
    goal = engine.interpret("I want to learn machine learning, I already know python")
    assert "python" in [s.lower() for s in goal.known_skills]
    assert "python" not in [s.lower() for s in goal.skills]


def test_interpret_rejects_ungroundable_text(engine: Engine) -> None:
    goal = engine.interpret("asdkjh qwoieu zxcvbnm nonsense")
    assert not goal.has_target


def test_interpret_carries_evidence_for_every_conclusion(engine: Engine) -> None:
    """The evidence trail is what makes a misparse correctable rather than mysterious."""
    goal = engine.interpret("I want to become a machine learning engineer")
    assert goal.evidence
    for item in goal.evidence:
        assert item["matched"] and item["value"]
        assert item["layer"] in {"lexical", "alias", "fuzzy", "semantic", "llm", "profile"}


# --------------------------------------------------------------------- #
# Recommendations
# --------------------------------------------------------------------- #
def test_recommend_scores_are_fully_decomposable(
    engine: Engine, db: Session, user: User
) -> None:
    """Every score must break down into factor contributions summing to ~1."""
    goal = engine.interpret("I want to become a machine learning engineer")
    results = engine.recommend(db, user, goal=goal, limit=5)
    assert results
    for result in results:
        contributions = result["contributions"]
        assert set(contributions) == set(FACTORS)
        assert sum(contributions.values()) == pytest.approx(1.0, abs=0.01)
        assert 0.0 <= result["score"] <= 1.0


def test_recommend_never_repeats_a_completed_course(
    engine: Engine, db: Session, user: User
) -> None:
    from app.models.activity import Enrollment

    goal = engine.interpret("I want to become a machine learning engineer")
    first = engine.recommend(db, user, goal=goal, limit=5)
    done = first[0]["course"]["course_id"]

    db.add(
        Enrollment(user_id=user.id, course_id=done, status="completed", progress_pct=100.0)
    )
    db.commit()

    again = engine.recommend(db, user, goal=goal, limit=10)
    assert done not in {r["course"]["course_id"] for r in again}


def test_recommend_orders_by_descending_score(
    engine: Engine, db: Session, user: User
) -> None:
    goal = engine.interpret("I want to get into cloud computing")
    scores = [r["score"] for r in engine.recommend(db, user, goal=goal, limit=8)]
    assert scores == sorted(scores, reverse=True)


# --------------------------------------------------------------------- #
# Path planning
# --------------------------------------------------------------------- #
def test_plan_orders_prerequisites_before_dependents(
    engine: Engine, db: Session, user: User
) -> None:
    """The planner's central correctness claim."""
    goal = engine.interpret("I want to become a machine learning engineer")
    plan, _ = engine.build_plan(db, user, goal=goal)
    assert plan.items

    position = {i.course_id: idx for idx, i in enumerate(plan.items) if i.course_id}
    for idx, item in enumerate(plan.items):
        for prereq in item.prerequisite_ids or []:
            if prereq in position:
                assert position[prereq] < idx, (
                    f"{item.title!r} at {idx} precedes its prerequisite {prereq}"
                )


def test_plan_has_phases_milestones_and_practice(
    engine: Engine, db: Session, user: User
) -> None:
    goal = engine.interpret("I want to become a machine learning engineer")
    plan, _ = engine.build_plan(db, user, goal=goal)

    assert plan.milestones, "a roadmap without milestones has nothing to track against"
    assert {i.item_type for i in plan.items} & {"project", "assessment"}, (
        "a path of only courses never asks the learner to demonstrate anything"
    )
    assert plan.total_hours > 0 and plan.estimated_weeks > 0


def test_plan_respects_weekly_hours_in_its_schedule(
    engine: Engine, db: Session, user: User
) -> None:
    """Fewer hours per week must not silently produce the same timeline."""
    goal = engine.interpret("I want to become a machine learning engineer")

    user.weekly_hours = 20.0
    db.commit()
    fast, _ = engine.build_plan(db, user, goal=goal)

    user.weekly_hours = 4.0
    db.commit()
    slow, _ = engine.build_plan(db, user, goal=goal)

    assert slow.estimated_weeks > fast.estimated_weeks


def test_plan_reports_its_own_gap_analysis(
    engine: Engine, db: Session, user: User
) -> None:
    goal = engine.interpret("I want to become a machine learning engineer")
    plan, _ = engine.build_plan(db, user, goal=goal)
    analysis = plan.analysis

    assert "readiness_before" in analysis and "readiness_after" in analysis
    assert analysis["readiness_after"] >= analysis["readiness_before"], (
        "a plan that does not raise projected readiness is not worth recommending"
    )


def test_unplannable_goal_yields_no_items(
    engine: Engine, db: Session, user: User
) -> None:
    goal = engine.interpret("qwertyuiop asdfghjkl zxcvbnm")
    plan, _ = engine.build_plan(db, user, goal=goal)
    assert not plan.items


# --------------------------------------------------------------------- #
# Online adaptation
# --------------------------------------------------------------------- #
def test_feedback_moves_the_learner_model(
    engine: Engine, db: Session, user: User
) -> None:
    goal = engine.interpret("I want to become a machine learning engineer")
    top = engine.recommend(db, user, goal=goal, limit=1)[0]

    result = engine.record_feedback(
        db,
        user,
        event_type="dislike",
        course_id=top["course"]["course_id"],
        factors=top["contributions"],
    )
    assert result["weight_deltas"], "feedback that changes nothing is not adaptation"
    assert sum(result["weights_after"].values()) == pytest.approx(1.0, abs=0.01), (
        "weights must stay a normalised distribution"
    )


@pytest.mark.parametrize(
    "event,direction", [("too_easy", 1), ("too_hard", -1)]
)
def test_difficulty_feedback_shifts_bias_in_the_right_direction(
    engine: Engine, db: Session, user: User, event: str, direction: int
) -> None:
    before = engine.learner_model(db, user).difficulty_bias or 0.0
    after = engine.record_feedback(db, user, event_type=event)["difficulty_bias"]
    assert (after - before) * direction > 0

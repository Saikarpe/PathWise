"""Dashboard endpoints: progress, skill development, milestones, next actions."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.ml.engine import Engine, get_engine
from app.models.activity import Enrollment, FeedbackEvent
from app.models.user import User

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


@router.get("")
def dashboard(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    engine: Engine = Depends(get_engine),
) -> dict:
    """One snapshot with everything the dashboard renders.

    Deliberately a single call. Progress, phase rollups, milestone achievement,
    skill levels and the next action are all derived from the same enrolment set,
    so computing them together is both cheaper and guaranteed self-consistent —
    separate endpoints could disagree if a course completed between requests.
    """
    return engine.dashboard(db, user)


@router.get("/next")
def next_actions(
    limit: int = 3,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    engine: Engine = Depends(get_engine),
) -> dict:
    """The immediate next actions: the path's next step, then ranked alternatives.

    The alternatives exclude everything already planned, so this answers "what
    should I do now" without repeating the roadmap back at the learner.
    """
    snapshot = engine.dashboard(db, user)
    alternatives = engine.recommend(
        db, user, limit=max(1, min(limit, 10)), exclude_planned=True
    )
    return {
        "next_item": snapshot.get("next_item"),
        "next_milestone": snapshot.get("next_milestone"),
        "progress": snapshot.get("progress", 0.0),
        "weeks_behind": snapshot.get("weeks_behind", 0),
        "alternatives": [
            {
                "course": r["course"],
                "score": r["score"],
                "headline": r["explanation"]["headline"],
                "drivers": r["explanation"]["drivers"],
            }
            for r in alternatives
        ],
    }


@router.get("/activity")
def activity(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Raw activity log, for the trend chart and the feedback history panel."""
    enrollments = list(
        db.scalars(
            select(Enrollment)
            .where(Enrollment.user_id == user.id)
            .order_by(Enrollment.updated_at.desc())
        )
    )
    events = list(
        db.scalars(
            select(FeedbackEvent)
            .where(FeedbackEvent.user_id == user.id)
            .order_by(FeedbackEvent.created_at.desc())
            .limit(50)
        )
    )
    by_status = dict(
        db.execute(
            select(Enrollment.status, func.count())
            .where(Enrollment.user_id == user.id)
            .group_by(Enrollment.status)
        ).all()
    )
    return {
        "counts": by_status,
        "hours_logged": round(sum(float(e.hours_logged or 0.0) for e in enrollments), 1),
        "enrollments": [
            {
                "course_id": e.course_id,
                "status": e.status,
                "progress_pct": e.progress_pct,
                "hours_logged": e.hours_logged,
                "learner_rating": e.learner_rating,
                "completed_at": e.completed_at.isoformat() if e.completed_at else None,
                "updated_at": e.updated_at.isoformat() if e.updated_at else None,
            }
            for e in enrollments
        ],
        "feedback": [
            {
                "event_type": e.event_type,
                "course_id": e.course_id,
                "weight": e.weight,
                "comment": e.comment,
                "created_at": e.created_at.isoformat() if e.created_at else None,
            }
            for e in events
        ],
    }

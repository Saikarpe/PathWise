"""Profile endpoints: the learner-profiling engine's read/write surface.

Two things live here that are not simple CRUD. ``/interpret`` exposes the intent
parser on its own, so the onboarding UI can show the learner what was understood
(and with what evidence) *before* a path is generated — the parse is the most
error-prone step, and letting a learner correct it there is cheaper than letting
them discover it in a 40-hour roadmap. ``/vocabulary`` returns the catalogue's own
tracks, skills, providers and formats, so every dropdown in the frontend is
populated from real data rather than a hand-maintained copy that can drift.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.ml.engine import Engine, get_engine
from app.models.activity import Enrollment
from app.models.user import SkillState, User
from app.schemas import InterpretRequest, ProfileUpdateRequest, UserResponse

router = APIRouter(prefix="/api/profile", tags=["profile"])


@router.get("", response_model=UserResponse)
def read_profile(user: User = Depends(get_current_user)) -> UserResponse:
    return UserResponse.model_validate(user)


@router.put("", response_model=UserResponse)
def update_profile(
    payload: ProfileUpdateRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    engine: Engine = Depends(get_engine),
) -> UserResponse:
    """Patch the profile. Any supplied field replaces its stored value."""
    data = payload.model_dump(exclude_unset=True, exclude_none=True)

    completed = data.pop("completed_course_ids", None)
    self_assessed = data.pop("self_assessed_skills", None)

    for field, value in data.items():
        setattr(user, field, value)

    if completed is not None:
        _replace_completions(db, engine, user, completed)
    if self_assessed is not None:
        _replace_self_assessment(db, user, self_assessed)

    # Enough signal to plan against counts as onboarded.
    if user.goal_text or user.interests or user.target_role:
        user.onboarded = True

    db.commit()
    db.refresh(user)
    return UserResponse.model_validate(user)


@router.post("/interpret")
def interpret(
    payload: InterpretRequest, engine: Engine = Depends(get_engine)
) -> dict:
    """Show what the parser extracted, including its evidence trail.

    The ``evidence`` list names the phrase, the layer that matched it (lexical,
    alias, fuzzy or semantic) and whether it was read as a goal or as stated
    background — which is what makes a wrong reading correctable rather than
    mysterious.
    """
    goal = engine.interpret(payload.text)
    ranked = goal.ranked_tracks
    return {
        **goal.as_dict(),
        "resolved_tracks": [
            {
                "track": name,
                "relevance": round(weight, 4),
                "courses": len(engine.catalog.track_name_index.get(name, [])),  # type: ignore[union-attr]
            }
            for name, weight in ranked[:6]
        ],
        "plannable": goal.has_target,
    }


@router.get("/skills")
def read_skills(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    engine: Engine = Depends(get_engine),
) -> dict:
    """Current proficiency per skill: earned from completions plus self-reported."""
    earned = engine.current_skills(db, user)
    declared = {
        s.skill: float(s.proficiency)
        for s in db.scalars(
            select(SkillState).where(SkillState.user_id == user.id, SkillState.source == "self")
        )
    }
    return {
        "skills": [
            {"skill": skill, "proficiency": round(level, 3), "declared": skill in declared}
            for skill, level in sorted(earned.items(), key=lambda kv: -kv[1])
        ],
        "vocabulary": engine.catalog.skills if engine.catalog else [],
    }


@router.get("/history")
def read_history(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    engine: Engine = Depends(get_engine),
) -> dict:
    """Every course this learner has touched, with the catalogue detail attached.

    ``completed_course_ids`` on the profile update is a *replacement*, so an editor
    for prior history has to be able to read the current list first — otherwise the
    only safe write is an append, and a learner could never retract a mistake.

    ``removable`` says whether dropping the course from that list would actually
    demote it: completions that belong to a path are owned by the path's progress
    log, and :func:`_replace_completions` deliberately leaves those alone.
    """
    assert engine.catalog is not None
    cat = engine.catalog
    rows = []
    for enrollment in db.scalars(
        select(Enrollment)
        .where(Enrollment.user_id == user.id)
        .order_by(Enrollment.updated_at.desc())
    ):
        pos = cat.pos(enrollment.course_id)
        if pos is None:  # catalogue reshuffled under an old row; nothing to show
            continue
        rows.append(
            {
                "course": cat.course_dict(pos),
                "course_id": enrollment.course_id,
                "status": enrollment.status,
                "progress_pct": round(float(enrollment.progress_pct), 1),
                "hours_logged": round(float(enrollment.hours_logged), 1),
                "learner_rating": enrollment.learner_rating,
                "on_path": enrollment.path_id is not None,
                "removable": enrollment.path_id is None,
                "updated_at": enrollment.updated_at,
            }
        )
    completed = [row for row in rows if row["status"] == "completed"]
    return {
        "history": rows,
        "completed_course_ids": [row["course_id"] for row in completed],
        "completed_count": len(completed),
        "hours_logged": round(sum(row["hours_logged"] for row in rows), 1),
    }


@router.get("/vocabulary")
def vocabulary(engine: Engine = Depends(get_engine)) -> dict:
    """Every controlled value a form may offer, read straight from the catalogue."""
    cat = engine.catalog
    assert cat is not None
    return {
        "branches": cat.branches,
        "tracks": sorted(cat.track_name_index),
        "tracks_by_branch": cat.tracks_by_branch,
        "skills": cat.skills,
        "careers": cat.careers,
        "sectors": cat.sectors,
        "providers": cat.providers,
        "formats": cat.formats,
        "difficulty_levels": ["Beginner", "Intermediate", "Advanced", "Expert"],
    }


# --------------------------------------------------------------------------- #
def _replace_completions(
    db: Session, engine: Engine, user: User, course_ids: list[str]
) -> None:
    """Set the learner's completed-course history to exactly this list.

    Unknown ids are dropped rather than rejected: the onboarding form lets a
    learner paste ids, and one typo should not discard a whole submission.
    """
    assert engine.catalog is not None
    valid = [cid for cid in dict.fromkeys(course_ids) if engine.catalog.pos(cid) is not None]

    existing = {
        e.course_id: e
        for e in db.scalars(select(Enrollment).where(Enrollment.user_id == user.id))
    }
    for course_id in valid:
        enrollment = existing.get(course_id)
        if enrollment is None:
            db.add(
                Enrollment(
                    user_id=user.id,
                    course_id=course_id,
                    status="completed",
                    progress_pct=100.0,
                    hours_logged=float(
                        engine.catalog.hours[engine.catalog.pos(course_id)]  # type: ignore[index]
                    ),
                )
            )
        else:
            enrollment.status = "completed"
            enrollment.progress_pct = 100.0

    # A course dropped from the list is prior history the learner retracted; only
    # demote it if nothing else (a path, logged hours) depends on its completion.
    for course_id, enrollment in existing.items():
        if course_id not in valid and enrollment.status == "completed" and not enrollment.path_id:
            enrollment.status = "not_started"
            enrollment.progress_pct = 0.0


def _replace_self_assessment(db: Session, user: User, levels: dict[str, float]) -> None:
    existing = {
        s.skill: s
        for s in db.scalars(
            select(SkillState).where(SkillState.user_id == user.id, SkillState.source == "self")
        )
    }
    for skill, level in levels.items():
        state = existing.pop(skill, None)
        if state is None:
            db.add(
                SkillState(user_id=user.id, skill=skill, proficiency=float(level), source="self")
            )
        else:
            state.proficiency = float(level)
    for stale in existing.values():
        db.delete(stale)

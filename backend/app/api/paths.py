"""Learning-path generation, retrieval and progress tracking."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.ml.engine import Engine, get_engine
from app.ml.skills import PROFICIENT_THRESHOLD
from app.models.activity import Enrollment
from app.models.learning_path import LearningPath, Milestone, PathItem
from app.models.user import User, utcnow
from app.schemas import (
    EnrollmentUpdateRequest,
    LearningPathResponse,
    MilestoneResponse,
    PathGenerateRequest,
    PathItemResponse,
    PathSummary,
)

router = APIRouter(prefix="/api/paths", tags=["paths"])


# --------------------------------------------------------------------------- #
# Generation
# --------------------------------------------------------------------------- #
@router.post("/generate", status_code=status.HTTP_201_CREATED)
def generate(
    payload: PathGenerateRequest,
    response: Response,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    engine: Engine = Depends(get_engine),
) -> dict:
    """Generate a learning path from the stated goal, or from the saved profile.

    With ``preview=true`` the plan is computed and returned without being written,
    which lets the UI show a roadmap before the learner commits to replacing the
    one they already have. A preview downgrades the status to 200, because 201
    Created is a claim about state and a preview creates nothing — a client that
    trusts the status would otherwise cache or link to a path that does not exist.
    """
    goal = engine.interpret(payload.goal_text) if payload.goal_text else None
    if goal is not None and not goal.has_target:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                "Could not match that goal to a track. Try naming a field or role — "
                "\"machine learning\", \"structural engineering\", \"become a security "
                "analyst\"."
            ),
        )

    if payload.preview:
        plan, resolved = engine.build_plan(db, user, goal=goal)
        if not plan.items:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="No plannable courses matched that goal.",
            )
        assert engine.explainer is not None
        response.status_code = status.HTTP_200_OK
        return {
            "preview": True,
            "plan": plan.as_dict(),
            "explanation": engine.explainer.explain_plan(plan).as_dict(),
            "interpretation": resolved.as_dict(),
        }

    path = engine.create_path(db, user, goal=goal, title=payload.title)
    if path is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                "Could not build a path from that. Add a goal to your profile or "
                "describe what you want to be able to do."
            ),
        )
    return {"preview": False, **_path_payload(db, engine, user, path)}


# --------------------------------------------------------------------------- #
# Retrieval
# --------------------------------------------------------------------------- #
@router.get("", response_model=list[PathSummary])
def list_paths(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> list[PathSummary]:
    rows = db.scalars(
        select(LearningPath)
        .where(LearningPath.user_id == user.id)
        .order_by(LearningPath.created_at.desc())
    )
    return [PathSummary.model_validate(row) for row in rows]


@router.get("/active")
def active_path(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    engine: Engine = Depends(get_engine),
) -> dict:
    """The current path, or ``{"has_path": false}`` for a learner without one."""
    path = engine.active_path(db, user)
    if path is None:
        return {"has_path": False}
    return {"has_path": True, **_path_payload(db, engine, user, path)}


@router.get("/{path_id}")
def read_path(
    path_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    engine: Engine = Depends(get_engine),
) -> dict:
    path = _owned_path(db, user, path_id)
    return _path_payload(db, engine, user, path)


@router.get("/{path_id}/graph")
def path_graph(
    path_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    engine: Engine = Depends(get_engine),
) -> dict:
    """The path as nodes and edges, for the roadmap visualisation.

    Edges come from two sources: the prerequisite DAG (a hard dependency) and the
    sequential order within a phase (a suggested order). They are labelled so the
    UI can draw them differently — a learner should be able to tell which arrows
    they must respect and which are just pacing.
    """
    path = _owned_path(db, user, path_id)
    items = sorted(path.items, key=lambda i: i.order_index)
    statuses = _statuses(db, user)

    id_by_course: dict[str, int] = {
        i.course_id: i.order_index for i in items if i.item_type == "course" and i.course_id
    }

    nodes = []
    for item in items:
        nodes.append(
            {
                "id": item.order_index,
                "item_id": item.id,
                "type": item.item_type,
                "title": item.title,
                "course_id": item.course_id if item.item_type == "course" else None,
                "phase_index": item.phase_index,
                "phase_name": item.phase_name,
                "hours": item.hours,
                "skills": item.skills,
                "rationale": item.rationale,
                "factors": item.factors,
                "status": statuses.get(item.course_id or "", "not_started"),
            }
        )

    edges = []
    for item in items:
        for prereq in item.prerequisite_ids or []:
            source = id_by_course.get(prereq)
            if source is not None and source != item.order_index:
                edges.append({"source": source, "target": item.order_index, "kind": "prerequisite"})
    for previous, current in zip(items, items[1:]):
        if any(
            e["source"] == previous.order_index and e["target"] == current.order_index
            for e in edges
        ):
            continue
        edges.append(
            {
                "source": previous.order_index,
                "target": current.order_index,
                "kind": "sequence" if previous.phase_index == current.phase_index else "phase",
            }
        )

    return {
        "path_id": path.id,
        "title": path.title,
        "phases": (path.plan or {}).get("phases", []),
        "nodes": nodes,
        "edges": edges,
    }


@router.get("/{path_id}/items/{item_id}/explain")
def explain_item(
    path_id: int,
    item_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    engine: Engine = Depends(get_engine),
) -> dict:
    """Why one step is in the path, rebuilt from its stored attribution vector."""
    path = _owned_path(db, user, path_id)
    item = db.get(PathItem, item_id)
    if item is None or item.path_id != path.id:
        raise HTTPException(status_code=404, detail="Unknown path item.")

    course = None
    if item.item_type == "course" and item.course_id and engine.catalog is not None:
        pos = engine.catalog.pos(item.course_id)
        if pos is not None:
            course = engine.catalog.course_dict(pos)
    return {
        "item": PathItemResponse.model_validate(item).model_dump(),
        "course": course,
        "explanation": engine.explain_path_item(path, item),
    }


# --------------------------------------------------------------------------- #
# Mutation
# --------------------------------------------------------------------------- #
@router.post("/{path_id}/progress")
def update_progress(
    path_id: int,
    payload: EnrollmentUpdateRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    engine: Engine = Depends(get_engine),
) -> dict:
    """Mark a course started / in progress / complete.

    Completing a course is also a weak positive signal, so it is folded into the
    learner model here rather than requiring a separate feedback call — otherwise
    the strongest available evidence of preference (actually finishing something)
    would never reach the ranker.
    """
    path = _owned_path(db, user, path_id)
    assert engine.catalog is not None
    # Projects and assessments aren't real catalogue entries — create_path
    # gives them a synthetic id ("ASS-0", "PRO-3", ...) purely so progress can
    # be tracked uniformly. Rejecting anything absent from the catalogue would
    # 404 on exactly those two item types, which is most of a typical path.
    # Legitimate here means "actually on this path" for a synthetic id, or
    # "a real course" otherwise — either is enough to accept it.
    on_this_path = any(item.course_id == payload.course_id for item in path.items)
    if not on_this_path and engine.catalog.pos(payload.course_id) is None:
        raise HTTPException(status_code=404, detail="Unknown course id.")

    # Snapshotted before any mutation below: the session autoflushes pending
    # changes ahead of a query, so taking this "before" reading any later than
    # here would already see the completion it is supposed to be a baseline for.
    skills_before = engine.current_skills(db, user)

    enrollment = db.scalar(
        select(Enrollment).where(
            Enrollment.user_id == user.id, Enrollment.course_id == payload.course_id
        )
    )
    if enrollment is None:
        enrollment = Enrollment(user_id=user.id, course_id=payload.course_id, path_id=path.id)
        db.add(enrollment)

    was_completed = enrollment.status == "completed"
    enrollment.path_id = path.id
    enrollment.status = payload.status
    if payload.progress_pct is not None:
        enrollment.progress_pct = payload.progress_pct
    if payload.hours_logged is not None:
        enrollment.hours_logged = payload.hours_logged
    if payload.rating is not None:
        enrollment.learner_rating = payload.rating

    if payload.status == "completed":
        enrollment.progress_pct = 100.0
        enrollment.completed_at = enrollment.completed_at or utcnow()
        if not enrollment.hours_logged:
            pos = engine.catalog.pos(payload.course_id)
            if pos is not None:
                enrollment.hours_logged = float(engine.catalog.hours[pos])  # type: ignore[index]
            else:
                # Synthetic project/assessment id — not in the catalogue, so
                # fall back to the hours the plan itself estimated for it.
                item = next((i for i in path.items if i.course_id == payload.course_id), None)
                enrollment.hours_logged = float(item.hours) if item else 0.0
    db.commit()

    adaptation = None
    narrative = None
    if payload.status == "completed" and not was_completed:
        adaptation = engine.record_feedback(
            db, user, event_type="completed", course_id=payload.course_id, path_id=path.id
        )
        skills_after = engine.current_skills(db, user)
        newly_proficient = sorted(
            skill
            for skill, level in skills_after.items()
            if level >= PROFICIENT_THRESHOLD and skills_before.get(skill, 0.0) < PROFICIENT_THRESHOLD
        )
        item = next((i for i in path.items if i.course_id == payload.course_id), None)
        narrative = _completion_narrative(
            item.title if item else payload.course_id,
            newly_proficient,
            list(item.skills or []) if item else [],
        )
    elif payload.status == "in_progress" and enrollment.progress_pct < 100:
        adaptation = engine.record_feedback(
            db, user, event_type="started", course_id=payload.course_id, path_id=path.id
        )

    return {
        "course_id": payload.course_id,
        "status": enrollment.status,
        "progress_pct": enrollment.progress_pct,
        "hours_logged": enrollment.hours_logged,
        "narrative": narrative,
        "adaptation": adaptation,
        "dashboard": engine.dashboard(db, user),
    }


@router.post("/{path_id}/archive", response_model=PathSummary)
def archive(
    path_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> PathSummary:
    path = _owned_path(db, user, path_id)
    path.status = "archived"
    db.commit()
    db.refresh(path)
    return PathSummary.model_validate(path)


@router.post("/{path_id}/activate", response_model=PathSummary)
def activate(
    path_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> PathSummary:
    """Make an archived path current again, archiving whatever is active now."""
    path = _owned_path(db, user, path_id)
    for other in db.scalars(
        select(LearningPath).where(
            LearningPath.user_id == user.id,
            LearningPath.status == "active",
            LearningPath.id != path.id,
        )
    ):
        other.status = "archived"
    path.status = "active"
    db.commit()
    db.refresh(path)
    return PathSummary.model_validate(path)


@router.delete("/{path_id}", status_code=204, response_model=None)
def delete_path(
    path_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> None:
    path = _owned_path(db, user, path_id)
    db.delete(path)
    db.commit()


# --------------------------------------------------------------------------- #
def _owned_path(db: Session, user: User, path_id: int) -> LearningPath:
    path = db.get(LearningPath, path_id)
    # 404 rather than 403 for someone else's path: confirming existence would leak
    # which ids are real.
    if path is None or path.user_id != user.id:
        raise HTTPException(status_code=404, detail="Path not found.")
    return path


def _statuses(db: Session, user: User) -> dict[str, str]:
    return {
        e.course_id: e.status
        for e in db.scalars(select(Enrollment).where(Enrollment.user_id == user.id))
    }


def _path_payload(db: Session, engine: Engine, user: User, path: LearningPath) -> dict:
    """A path with per-item status, milestone achievement and its explanation."""
    statuses = _statuses(db, user)
    completed = {cid for cid, status_ in statuses.items() if status_ == "completed"}

    items = []
    for item in sorted(path.items, key=lambda i: i.order_index):
        record = PathItemResponse.model_validate(item)
        record.status = statuses.get(item.course_id or "", "not_started")
        items.append(record)

    milestones = []
    for milestone in db.scalars(
        select(Milestone).where(Milestone.path_id == path.id).order_by(Milestone.order_index)
    ):
        record = MilestoneResponse.model_validate(milestone)
        required = set(milestone.required_course_ids or [])
        record.achieved = bool(required) and required <= completed
        milestones.append(record)

    response = LearningPathResponse.model_validate(path)
    response.items = items
    response.milestones = milestones
    response.explanation = engine.explain_path(path)
    return response.model_dump()


def _completion_narrative(
    title: str, newly_proficient: list[str], practiced: list[str]
) -> str:
    """What to tell the learner right after they finish a course.

    Deliberately not the ranking-model adaptation note (see
    ``Engine.record_feedback``'s ``explanation``) — that says what the
    *recommender* just changed about itself, which is honest but not what a
    learner wants to hear the moment they finish something. This says what
    *they* just gained, which is why it is returned as a separate field
    (``narrative``) rather than folded into ``adaptation``.
    """
    if newly_proficient:
        skills = ", ".join(newly_proficient[:4])
        return f'Nice — finishing "{title}" pushed {skills} over the proficiency line.'
    if practiced:
        skills = ", ".join(practiced[:4])
        return f'"{title}" is done. That built toward {skills}.'
    return f'"{title}" is done.'

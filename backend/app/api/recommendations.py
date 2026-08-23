"""Recommendation endpoints, plus the feedback loop that adapts them."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.ml.engine import Engine, get_engine
from app.models.user import User
from app.schemas import FeedbackRequest, FeedbackResponse, RecommendationRequest

router = APIRouter(prefix="/api/recommendations", tags=["recommendations"])


@router.post("")
def recommend(
    payload: RecommendationRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    engine: Engine = Depends(get_engine),
) -> dict:
    """Rank courses for this learner, each with its own attribution and reasons.

    Every result carries ``factors`` (the raw per-factor values), ``contributions``
    (each factor's share of the final score, summing to ~1.0) and an
    ``explanation`` built from those numbers. The UI's "Why this?" drawer renders
    the contributions directly, so what the learner reads is the arithmetic that
    produced the ranking rather than a separate narrative about it.
    """
    goal = engine.interpret(payload.goal_text) if payload.goal_text else None
    if payload.goal_text and goal is not None and not goal.has_target:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                "Could not match that to any track in the catalogue. Name a role, "
                "subject or skill, or leave goal_text empty to use your saved profile."
            ),
        )

    results = engine.recommend(
        db,
        user,
        goal=goal,
        limit=payload.limit,
        exclude_planned=payload.exclude_planned,
    )
    effective = goal or engine.interpret_profile(user)
    return {
        "count": len(results),
        "goal": {
            "text": effective.raw_text,
            "tracks": [
                {"track": name, "relevance": round(weight, 4)}
                for name, weight in effective.ranked_tracks[:5]
            ],
            "careers": effective.careers,
            "source": effective.source,
        },
        "results": results,
    }


@router.get("/similar/{course_id}")
def similar(
    course_id: str,
    limit: int = 6,
    engine: Engine = Depends(get_engine),
) -> dict:
    """Content-based neighbours of one course, from the LSA space.

    Used by the roadmap UI to answer "what else is like this?" without needing a
    learner profile, which is why it is not personalised.
    """
    assert engine.catalog is not None and engine.space is not None
    pos = engine.catalog.pos(course_id)
    if pos is None:
        raise HTTPException(status_code=404, detail="Unknown course id.")

    similarities = engine.space.course_vectors @ engine.space.course_vectors[pos]
    order = similarities.argsort()[::-1]
    out = []
    for candidate in order:
        if int(candidate) == pos:
            continue
        out.append(
            {
                "course": engine.catalog.course_dict(int(candidate)),
                "similarity": round(float(similarities[candidate]), 4),
            }
        )
        if len(out) >= max(1, min(limit, 24)):
            break
    return {"course": engine.catalog.course_dict(pos), "similar": out}


@router.post("/feedback", response_model=FeedbackResponse)
def feedback(
    payload: FeedbackRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    engine: Engine = Depends(get_engine),
) -> FeedbackResponse:
    """Record a reaction and return exactly what it changed in the learner model.

    Returning the before/after weights is deliberate. Adaptation the learner
    cannot see is indistinguishable from no adaptation, so the UI shows the moved
    factors rather than a generic "thanks for your feedback".
    """
    result = engine.record_feedback(
        db,
        user,
        event_type=payload.event_type,
        course_id=payload.course_id,
        comment=payload.comment,
        factors=payload.factors,
        path_id=payload.path_id,
    )
    return FeedbackResponse(**result)


@router.get("/model")
def learner_model(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    engine: Engine = Depends(get_engine),
) -> dict:
    """The learner's current ranking weights — the personalisation, made visible."""
    from app.ml.ranker import DEFAULT_WEIGHTS, FACTOR_LABELS

    model = engine.learner_model(db, user)
    weights = dict(model.weights or DEFAULT_WEIGHTS)
    db.commit()  # learner_model may have created the row

    affinities = dict(model.affinities or {})
    top_affinities = sorted(affinities.items(), key=lambda kv: -abs(kv[1]))[:12]
    return {
        "weights": [
            {
                "factor": factor,
                "label": FACTOR_LABELS.get(factor, factor),
                "weight": round(float(value), 4),
                "default": round(float(DEFAULT_WEIGHTS.get(factor, 0.0)), 4),
                "delta": round(float(value) - float(DEFAULT_WEIGHTS.get(factor, 0.0)), 4),
            }
            for factor, value in weights.items()
        ],
        "affinities": [
            {"key": key, "value": round(value, 3)} for key, value in top_affinities if value
        ],
        "difficulty_bias": round(float(model.difficulty_bias or 0.0), 3),
        "update_count": int(model.update_count or 0),
        "personalised": int(model.update_count or 0) > 0,
    }

"""Catalogue browsing: search, filters, course detail, taxonomy."""
from __future__ import annotations

import numpy as np
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_optional_user
from app.ml.engine import Engine, get_engine
from app.models.activity import Enrollment
from app.models.user import User
from app.schemas import CourseSearchRequest

router = APIRouter(prefix="/api/catalog", tags=["catalog"])


@router.get("/stats")
def stats(engine: Engine = Depends(get_engine)) -> dict:
    """Catalogue size and shape. Shown on the landing page and in the docs."""
    cat = engine.catalog
    assert cat is not None and engine.graph is not None and engine.space is not None
    return {
        "courses": cat.size,
        "branches": len(cat.branches),
        "tracks": len(cat.tracks),
        "skills": len(cat.skills),
        "tools": len(cat.tools),
        "careers": len(cat.careers),
        "providers": len(cat.providers),
        "formats": len(cat.formats),
        "prerequisite_rungs": engine.graph.graph.number_of_nodes(),
        "prerequisite_edges": engine.graph.graph.number_of_edges(),
        "semantic_dimensions": int(engine.space.course_vectors.shape[1]),
        "total_hours": round(float(cat.hours.sum()), 1),
        "mean_rating": round(float(cat.ratings.mean()), 2),
    }


@router.post("/search")
def search(
    payload: CourseSearchRequest, engine: Engine = Depends(get_engine)
) -> dict:
    """Filter then semantically rank.

    Filters are applied first and the free-text query only *orders* what survives.
    Doing it the other way round — rank globally, then filter — would let a narrow
    filter return nothing at all whenever the best semantic matches happened to sit
    outside it, which reads as "no results" when the catalogue has hundreds.
    """
    cat = engine.catalog
    space = engine.space
    assert cat is not None and space is not None

    mask = np.ones(cat.size, dtype=bool)
    applied: dict[str, str] = {}

    if payload.branch:
        positions = cat.branch_positions(payload.branch) or _fuzzy_index(
            cat.branch_index, payload.branch
        )
        mask &= _mask_from(cat.size, positions or [])
        applied["branch"] = payload.branch
    if payload.track:
        positions = cat.track_positions(payload.track) or _fuzzy_index(
            cat.track_name_index, payload.track
        )
        mask &= _mask_from(cat.size, positions or [])
        applied["track"] = payload.track
    if payload.difficulty:
        wanted = payload.difficulty.strip().lower()
        mask &= cat.df["difficulty_level"].str.lower().str.strip().eq(wanted).to_numpy()
        applied["difficulty"] = payload.difficulty
    if payload.provider:
        wanted = payload.provider.strip().lower()
        mask &= cat.df["provider"].str.lower().str.strip().eq(wanted).to_numpy()
        applied["provider"] = payload.provider

    candidates = np.flatnonzero(mask)
    if candidates.size == 0:
        return {"count": 0, "total_matching": 0, "filters": applied, "query": payload.q, "results": []}

    if payload.q:
        scores = space.similarity_to_courses(space.encode(payload.q))[candidates]
        order = candidates[scores.argsort()[::-1]]
        scored = {int(p): float(s) for p, s in zip(candidates, scores)}
    else:
        # No query: quality order is the only sensible default, and it is stable.
        order = candidates[cat.quality[candidates].argsort()[::-1]]
        scored = {int(p): float(cat.quality[p]) for p in candidates}

    results = [
        {**cat.course_dict(int(p)), "relevance": round(scored[int(p)], 4)}
        for p in order[: payload.limit]
    ]
    return {
        "count": len(results),
        "total_matching": int(candidates.size),
        "filters": applied,
        "query": payload.q,
        "results": results,
    }


@router.get("/taxonomy")
def taxonomy(engine: Engine = Depends(get_engine)) -> dict:
    """Every filter value the UI can offer, with counts, derived from the data."""
    cat = engine.catalog
    assert cat is not None
    return {
        "branches": [
            {
                "name": name,
                "courses": len(positions),
                "tracks": cat.tracks_by_branch.get(name, []),
            }
            for name, positions in sorted(cat.branch_index.items())
        ],
        "difficulty_levels": sorted(cat.df["difficulty_level"].dropna().unique().tolist()),
        "providers": cat.providers,
        "formats": cat.formats,
        "skills": cat.skills,
        "careers": cat.careers,
        "sectors": cat.sectors,
    }


@router.get("/courses/{course_id}")
def course_detail(
    course_id: str,
    user: User | None = Depends(get_optional_user),
    db: Session = Depends(get_db),
    engine: Engine = Depends(get_engine),
) -> dict:
    """One course with its prerequisite chain, follow-ons and the learner's status."""
    cat = engine.catalog
    graph = engine.graph
    assert cat is not None and graph is not None
    pos = cat.pos(course_id)
    if pos is None:
        raise HTTPException(status_code=404, detail="Unknown course id.")

    rung = graph.rung_of.get(pos)
    prerequisites = [
        cat.course_dict(p)
        for p in _representatives(cat, graph.prereq_rungs(rung) if rung else [])
    ]
    chain = [
        {"branch": b, "track": t, "tier": tier}
        for b, t, tier in (graph.chain_to(rung) if rung else [])
    ]
    follow_ons: list[dict] = []
    if rung is not None:
        branch, track, tier = rung
        for candidate in cat.variant_index.get((branch, track, tier + 1), [])[:3]:
            follow_ons.append(cat.course_dict(candidate))

    status = "not_started"
    if user is not None:
        enrollment = db.scalar(
            select(Enrollment).where(
                Enrollment.user_id == user.id, Enrollment.course_id == course_id
            )
        )
        if enrollment is not None:
            status = enrollment.status

    return {
        "course": cat.course_dict(pos),
        "rung": {"branch": rung[0], "track": rung[1], "tier": rung[2]} if rung else None,
        "prerequisite_chain": chain,
        "prerequisites": prerequisites,
        "follow_ons": follow_ons,
        "alternatives": [
            cat.course_dict(p)
            for p in cat.variant_index.get(rung, [])[:6]
            if rung is not None and p != pos
        ],
        "status": status,
    }


@router.get("/skills/{skill}")
def skill_detail(
    skill: str,
    limit: int = Query(default=8, ge=1, le=40),
    engine: Engine = Depends(get_engine),
) -> dict:
    """What a skill is worth, where it matters most, and which courses teach it.

    There is no single catalogue-wide "importance" for a skill: the competency
    model scores importance *relative to a goal*, because that is the only way
    distinctiveness means anything. So this reports the skill's prevalence plus
    the tracks and careers where it is most central — which is the honest answer
    to "how important is this?".
    """
    cat = engine.catalog
    competency = engine.competency
    assert cat is not None and competency is not None
    key = skill.strip().lower()
    positions = cat.skill_index.get(key)
    if not positions:
        raise HTTPException(status_code=404, detail="Unknown skill.")

    prevalence = competency.global_skill_freq.get(key, len(positions) / max(cat.size, 1))
    top_tracks = sorted(
        ((track, skills[key]) for track, skills in competency.track_skills.items() if key in skills),
        key=lambda kv: -kv[1],
    )[:6]
    top_careers = sorted(
        (
            (career, skills[key])
            for career, skills in competency.career_skills.items()
            if key in skills
        ),
        key=lambda kv: -kv[1],
    )[:6]

    ranked = sorted(positions, key=lambda p: -cat.quality[p])[:limit]
    return {
        "skill": key,
        "course_count": len(positions),
        "prevalence": round(float(prevalence), 4),
        "central_to_tracks": [
            {
                "track": track,
                "centrality": round(float(value), 3),
                "importance": round(float(competency.importance(key, value)), 3),
                "required_level": round(
                    float(competency.required_level(competency.importance(key, value))), 3
                ),
            }
            for track, value in top_tracks
        ],
        "central_to_careers": [
            {"career": career, "centrality": round(float(value), 3)}
            for career, value in top_careers
        ],
        "taught_by": [cat.course_dict(p) for p in ranked],
    }


# --------------------------------------------------------------------------- #
def _mask_from(size: int, positions: list[int]) -> np.ndarray:
    mask = np.zeros(size, dtype=bool)
    if positions:
        mask[np.fromiter(positions, dtype=int)] = True
    return mask


def _fuzzy_index(index: dict, needle: str) -> list[int] | None:
    """Substring fallback for a filter value the UI spelled loosely.

    ``Catalog.resolve_*`` already handles casing, so this only fires on genuinely
    partial names — "mechanical" for "Mechanical Engineering". That comes up in
    hand-written links and shared URLs, where returning nothing is a worse answer
    than the obvious one.
    """
    token = " ".join(needle.strip().lower().split())
    if not token:
        return None
    for key, positions in index.items():
        if not isinstance(key, str):
            continue
        lowered = key.lower()
        if token in lowered or lowered in token:
            return positions
    return None


def _representatives(cat, rungs: list) -> list[int]:
    """One best course per rung — a prerequisite list, not a provider list."""
    out = []
    for rung in rungs:
        variants = cat.variant_index.get(rung, [])
        if variants:
            out.append(max(variants, key=lambda p: cat.quality[p]))
    return out

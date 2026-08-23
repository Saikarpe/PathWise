"""The recommendation engine: one warm singleton wired to the database.

This module is the seam between the pure-ML layer (:mod:`app.ml.catalog` through
:mod:`app.ml.explainer`, none of which know that a database exists) and the API.
It owns three things:

**Warm state.** Loading the catalogue, fitting the LSA space, building the
prerequisite DAG and deriving the competency model costs about six seconds. That
happens once at startup, not per request, which is why a plan generates in under
150 ms.

**Learner state assembly.** A recommendation depends on the learner's enrolments,
skill states and personalised ranker weights. Gathering those from SQLAlchemy and
handing the ML layer a plain :class:`~app.ml.planner.LearnerState` keeps the ML
code free of ORM coupling and trivially testable.

**Online adaptation.** :meth:`Engine.record_feedback` is the learning loop. Each
recommendation stores the ranker's per-factor attribution vector; when the learner
reacts, blame or credit is assigned to the factors that actually drove that
recommendation, rather than nudging one global knob. Disliking a course that was
ranked mainly on ``quality`` moves ``quality`` down; disliking one ranked mainly on
``goal_fit`` means the goal was misread instead. See :func:`_apply_credit`.
"""
from __future__ import annotations

import logging
import time
from datetime import datetime, timezone

import numpy as np
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.ml.catalog import Catalog, load_catalog
from app.ml.explainer import Explainer
from app.ml.graph import PrerequisiteGraph, build_prerequisite_graph
from app.ml.intent import GoalInterpretation, IntentParser
from app.ml.planner import (
    LearnerState,
    LearningPlan,
    MilestoneSpec,
    PathPlanner,
    Phase,
    PlanItem,
)
from app.ml.ranker import DEFAULT_WEIGHTS, FACTORS, RankedCourse, Ranker, RankingContext
from app.ml.skills import (
    PROFICIENT_THRESHOLD,
    CompetencyModel,
    GapReport,
    analyse_gap,
    build_competency_model,
    build_target_profile,
    proficiency_from_history,
)
from app.ml.vectorizer import SemanticSpace, build_semantic_space
from app.models.activity import Enrollment, FeedbackEvent
from app.models.learning_path import LearningPath, Milestone, PathItem
from app.models.user import LearnerModel, SkillState, User, utcnow

logger = logging.getLogger(__name__)


def _as_utc(stamp: datetime) -> datetime:
    """Read a stored timestamp back as tz-aware UTC.

    Columns are declared ``DateTime(timezone=True)`` and written as aware UTC, but
    SQLite has no timestamp type and hands back a *naive* value. Comparing that
    against local wall-clock time made a path created seconds ago look hours old,
    which was enough to report a learner as behind schedule before they started.
    """
    return stamp if stamp.tzinfo else stamp.replace(tzinfo=timezone.utc)

#: Feedback event -> (sign, magnitude). Sign drives credit assignment; magnitude
#: reflects how much evidence the event carries. Completing a course is weaker
#: evidence of preference than explicitly liking it, but it is not neutral.
EVENT_SIGNS: dict[str, tuple[float, float]] = {
    "like": (+1.0, 1.0),
    "dislike": (-1.0, 1.0),
    "not_relevant": (-1.0, 1.2),
    "completed": (+1.0, 0.5),
    "started": (+1.0, 0.2),
    "skipped": (-1.0, 0.6),
    "too_easy": (0.0, 0.0),
    "too_hard": (0.0, 0.0),
}

#: Difficulty-bias step for the two events that are purely about level.
_DIFFICULTY_STEP = 0.3
_DIFFICULTY_LIMIT = 1.5

#: Bounds keeping any single factor from collapsing or dominating the ranking.
_WEIGHT_FLOOR = 0.01
_WEIGHT_CEILING = 0.45
#: Categorical affinity bounds; ``tanh`` in the ranker keeps the effect gentle.
_AFFINITY_LIMIT = 1.5

#: Extra blame on ``goal_fit`` for "this isn't what I asked for".
_NOT_RELEVANT_FOCUS = "goal_fit"


class Engine:
    """Warm ML state plus the database-facing orchestration."""

    def __init__(self) -> None:
        self.catalog: Catalog | None = None
        self.space: SemanticSpace | None = None
        self.graph: PrerequisiteGraph | None = None
        self.competency: CompetencyModel | None = None
        self.parser: IntentParser | None = None
        self.ranker: Ranker | None = None
        self.planner: PathPlanner | None = None
        self.explainer: Explainer | None = None
        self.warmup_seconds: float = 0.0
        self._ready = False

    # ------------------------------------------------------------------ #
    def warm(self) -> None:
        """Build all ML state. Idempotent; called once from the app lifespan."""
        if self._ready:
            return
        started = time.perf_counter()

        self.catalog = load_catalog(settings.COURSES_CSV)
        self.space = build_semantic_space(self.catalog)
        self.graph = build_prerequisite_graph(self.catalog)
        self.competency = build_competency_model(self.catalog)
        self.parser = IntentParser(self.catalog, self.space)
        self.ranker = Ranker(self.catalog, self.space, self.graph)
        self.planner = PathPlanner(
            self.catalog, self.space, self.graph, self.competency, self.ranker
        )
        self.explainer = Explainer(self.catalog)

        self.warmup_seconds = time.perf_counter() - started
        self._ready = True
        logger.info(
            "Engine warm in %.2fs: %d courses, %d rungs, %d tracks, %d skills.",
            self.warmup_seconds,
            self.catalog.size,
            len(self.graph.members),
            len(self.catalog.tracks),
            len(self.catalog.skills),
        )
        if self.parser.dropped_aliases:
            logger.warning(
                "%d alias target(s) are absent from the catalogue: %s",
                len(self.parser.dropped_aliases),
                self.parser.dropped_aliases[:5],
            )

    @property
    def ready(self) -> bool:
        return self._ready

    def stats(self) -> dict:
        """Health and provenance information, surfaced at ``/api/health``."""
        if not self._ready or self.catalog is None:
            return {"ready": False}
        return {
            "ready": True,
            "warmup_seconds": round(self.warmup_seconds, 2),
            "courses": self.catalog.size,
            "tracks": len(self.catalog.tracks),
            "branches": len(self.catalog.branches),
            "skills": len(self.catalog.skills),
            "prerequisite_rungs": len(self.graph.members) if self.graph else 0,
            "prerequisite_edges": self.graph.graph.number_of_edges() if self.graph else 0,
            "semantic_dimensions": int(self.space.course_vectors.shape[1]) if self.space else 0,
            "semantic_explained_variance": (
                round(self.space.explained_variance, 4) if self.space else 0.0
            ),
            "llm_enabled": settings.llm_enabled,
            "llm_model": settings.ANTHROPIC_MODEL if settings.llm_enabled else None,
        }

    # ------------------------------------------------------------------ #
    # Interpretation
    # ------------------------------------------------------------------ #
    def interpret(self, text: str) -> GoalInterpretation:
        """Parse a learner utterance with the local four-layer parser."""
        assert self.parser is not None
        return self.parser.parse(text)

    def interpret_profile(self, user: User) -> GoalInterpretation:
        """Interpret a stored profile, blending the goal text with structured fields.

        Onboarding form values are appended to the free text so the same parser
        handles both routes; anything the learner selected explicitly then also
        carries the parser's own confidence and evidence trail.
        """
        assert self.parser is not None
        profile = user.profile_dict()
        parts = [profile["goal_text"]]
        if profile["target_role"]:
            parts.append(f"I want to become a {profile['target_role']}")
        if profile["interests"]:
            parts.append("I am interested in " + ", ".join(profile["interests"]))
        if profile["target_skills"]:
            parts.append("I want to learn " + ", ".join(profile["target_skills"]))
        if profile["industry_interests"]:
            parts.append("in the " + ", ".join(profile["industry_interests"]) + " sector")

        goal = self.parser.parse(". ".join(p for p in parts if p))

        # Explicit profile settings win over anything inferred from prose.
        goal.experience_level = profile["experience_level"] or goal.experience_level
        goal.weekly_hours = profile["weekly_hours"] or goal.weekly_hours
        goal.timeline_weeks = profile["timeline_weeks"] or goal.timeline_weeks
        for fmt in profile["preferred_formats"]:
            if fmt not in goal.formats:
                goal.formats.append(fmt)
        for provider in profile["preferred_providers"]:
            if provider not in goal.providers:
                goal.providers.append(provider)
        if profile["primary_branch"] and profile["primary_branch"] not in goal.branches:
            goal.branches.insert(0, profile["primary_branch"])
        return goal

    # ------------------------------------------------------------------ #
    # Learner state
    # ------------------------------------------------------------------ #
    def learner_state(self, db: Session, user: User) -> LearnerState:
        """Assemble the ML-facing learner state from the database."""
        profile = user.profile_dict()
        completed = [
            e.course_id
            for e in db.scalars(
                select(Enrollment).where(
                    Enrollment.user_id == user.id, Enrollment.status == "completed"
                )
            )
        ]
        self_assessed = {
            s.skill: float(s.proficiency)
            for s in db.scalars(
                select(SkillState).where(
                    SkillState.user_id == user.id, SkillState.source == "self"
                )
            )
        }
        model = self.learner_model(db, user)
        return LearnerState(
            experience_level=profile["experience_level"],
            weekly_hours=profile["weekly_hours"],
            timeline_weeks=profile["timeline_weeks"],
            completed_ids=completed,
            self_assessed=self_assessed,
            preferred_formats=profile["preferred_formats"],
            preferred_providers=profile["preferred_providers"],
            weights=dict(model.weights or {}) or None,
            affinities=dict(model.affinities or {}),
            difficulty_bias=float(model.difficulty_bias or 0.0),
        )

    def learner_model(self, db: Session, user: User) -> LearnerModel:
        """Fetch or create this learner's personalised ranker state."""
        model = db.scalar(select(LearnerModel).where(LearnerModel.user_id == user.id))
        if model is None:
            model = LearnerModel(
                user_id=user.id,
                weights=dict(DEFAULT_WEIGHTS),
                affinities={},
                difficulty_bias=0.0,
                update_count=0,
            )
            db.add(model)
            db.flush()
        return model

    def current_skills(self, db: Session, user: User) -> dict[str, float]:
        """The learner's proficiency per skill: earned from courses, plus self-reported."""
        assert self.catalog is not None
        state = self.learner_state(db, user)
        return proficiency_from_history(
            self.catalog, state.completed_ids, self_assessed=state.self_assessed
        )

    # ------------------------------------------------------------------ #
    # Recommendations
    # ------------------------------------------------------------------ #
    def recommend(
        self,
        db: Session,
        user: User,
        *,
        goal: GoalInterpretation | None = None,
        limit: int = 10,
        exclude_planned: bool = False,
    ) -> list[dict]:
        """Rank the catalogue for this learner and explain each result."""
        assert self.catalog is not None and self.ranker is not None
        assert self.explainer is not None and self.competency is not None

        goal = goal or self.interpret_profile(user)
        state = self.learner_state(db, user)
        ctx, gap = self._context(goal, state)

        exclude = set(state.completed_ids) | self._rung_siblings(state.completed_ids)
        if exclude_planned:
            exclude |= {
                item.course_id
                for item in db.scalars(
                    select(PathItem).where(
                        PathItem.user_id == user.id, PathItem.course_id.is_not(None)
                    )
                )
                if item.course_id
            }

        candidates = self._candidate_pool(goal)
        # Over-fetch, because collapsing provider variants below removes rows.
        ranked = self.ranker.rank(ctx, candidates, limit=limit * 4, exclude=exclude)

        out: list[dict] = []
        seen_rungs: set = set()
        for rc in ranked:
            # One entry per prerequisite rung. Three providers selling the same
            # course is a *choice*, not three recommendations, so the runners-up
            # ride along as alternatives instead of consuming three of ten slots.
            rung = self.graph.rung_of.get(rc.pos) if self.graph else None
            if rung is not None:
                if rung in seen_rungs:
                    if out:
                        out[-1]["alternatives"].append(self._variant_dict(rc))
                    continue
                seen_rungs.add(rung)

            rank = len(out) + 1
            explanation = self.explainer.explain_course(
                rc, rank=rank, gap=gap, goal_text=goal.raw_text
            )
            out.append(
                {
                    "rank": rank,
                    "course": self.catalog.course_dict(rc.pos),
                    **rc.as_dict(),
                    "explanation": explanation.as_dict(),
                    "alternatives": [],
                }
            )
            if len(out) >= limit:
                break
        return out

    def _rung_siblings(self, course_ids: list[str]) -> set[str]:
        """Every course sharing a prerequisite rung with one of ``course_ids``.

        Used to widen the recommendation exclusion set. Several providers sell the
        same tier of the same track, so finishing one of them means the learner
        knows that material — a sibling variant is a repeat, not a recommendation.
        Excluding by course id alone put "Introduction to Data Structures &
        Algorithms" back at #1 for a learner who had already completed it under
        another provider's title.
        """
        assert self.catalog is not None
        if self.graph is None:
            return set()
        out: set[str] = set()
        for course_id in course_ids:
            pos = self.catalog.pos(course_id)
            if pos is None:
                continue
            rung = self.graph.rung_of.get(pos)
            if rung is None:
                continue
            for variant in self.catalog.variant_index.get(rung, []):
                out.add(self.catalog.course_ids[variant])
        return out

    def _variant_dict(self, rc: RankedCourse) -> dict:
        """A same-rung runner-up, described just well enough to switch to it."""
        assert self.catalog is not None
        row = self.catalog.df.iloc[rc.pos]
        return {
            "course_id": rc.course_id,
            "title": str(row["course_title"]),
            "provider": str(row["provider"]),
            "format": str(row["format"]),
            "hours": float(row["estimated_hours"]),
            "rating": float(row["rating"]),
            "num_reviews": int(row["num_reviews"]),
            "score": round(rc.score, 4),
        }

    def _candidate_pool(self, goal: GoalInterpretation) -> list[int] | None:
        """Narrow the 2,400-course catalogue to the goal's neighbourhood.

        Ranking everything is fast enough, but scoping to the goal's tracks and
        branches keeps the pool-relative factors (``goal_fit``, ``skill_gain``)
        meaningful: normalising against the whole catalogue compresses every
        candidate into a narrow band and makes the percentages unreadable.
        """
        assert self.catalog is not None
        pool: list[int] = []
        for name, _ in goal.ranked_tracks[:6]:
            pool.extend(self.catalog.track_name_index.get(name, []))
        for branch in goal.branches[:2]:
            pool.extend(self.catalog.branch_index.get(branch, []))
        for skill in goal.skills[:6]:
            pool.extend(self.catalog.skill_index.get(skill, []))
        return list(dict.fromkeys(pool)) or None

    def _context(
        self, goal: GoalInterpretation, state: LearnerState
    ) -> tuple[RankingContext, GapReport]:
        """Build a ranking context and the gap report it is scored against."""
        assert self.catalog is not None and self.space is not None
        assert self.competency is not None

        current = proficiency_from_history(
            self.catalog, state.completed_ids, self_assessed=state.self_assessed
        )
        for track in goal.known_tracks:
            for skill, centrality in self.competency.track_skills.get(track, {}).items():
                if centrality >= 0.5:
                    current[skill] = max(current.get(skill, 0.0), 0.55)

        track_names = [name for name, _ in goal.ranked_tracks[:3]]
        track_weights = {name: weight for name, weight in goal.ranked_tracks[:3]}
        target, source = build_target_profile(
            self.competency,
            careers=goal.careers,
            tracks=track_names,
            explicit_skills=goal.skills,
            track_weights=track_weights,
        )
        gap = analyse_gap(self.competency, target, current, source=source)

        goal_text = goal.raw_text or " ".join(track_names)
        ctx = RankingContext(
            goal_vector=self.space.encode(goal_text),
            gap=gap,
            experience_level=goal.experience_level or state.experience_level,
            weekly_hours=float(goal.weekly_hours or state.weekly_hours),
            preferred_formats=goal.formats or state.preferred_formats,
            preferred_providers=goal.providers or state.preferred_providers,
            completed_ids=set(state.completed_ids),
            weights=dict(state.weights) if state.weights else dict(DEFAULT_WEIGHTS),
            affinities=dict(state.affinities),
            difficulty_bias=state.difficulty_bias,
            track_weights=track_weights,
        )
        return ctx, gap

    # ------------------------------------------------------------------ #
    # Path generation and persistence
    # ------------------------------------------------------------------ #
    def build_plan(
        self, db: Session, user: User, *, goal: GoalInterpretation | None = None
    ) -> tuple[LearningPlan, GoalInterpretation]:
        """Generate a plan without persisting it (used for previews and chat)."""
        assert self.planner is not None
        goal = goal or self.interpret_profile(user)
        state = self.learner_state(db, user)
        return self.planner.generate(goal, state), goal

    def create_path(
        self,
        db: Session,
        user: User,
        *,
        goal: GoalInterpretation | None = None,
        title: str | None = None,
        archive_existing: bool = True,
    ) -> LearningPath | None:
        """Generate, persist and return a learning path. ``None`` if unmatched."""
        plan, goal = self.build_plan(db, user, goal=goal)
        if not plan.items:
            return None

        if archive_existing:
            for existing in db.scalars(
                select(LearningPath).where(
                    LearningPath.user_id == user.id, LearningPath.status == "active"
                )
            ):
                existing.status = "archived"

        version = 1 + (
            db.scalar(
                select(LearningPath.version)
                .where(LearningPath.user_id == user.id)
                .order_by(LearningPath.version.desc())
                .limit(1)
            )
            or 0
        )
        tracks = [t["track"] for t in plan.tracks]
        path = LearningPath(
            user_id=user.id,
            title=title or _path_title(goal, tracks),
            goal_text=goal.raw_text,
            target_role=(goal.careers[0] if goal.careers else None),
            primary_branch=(plan.tracks[0]["branch"] if plan.tracks else None),
            status="active",
            version=version,
            total_courses=plan.total_courses,
            total_hours=round(plan.total_hours, 1),
            estimated_weeks=plan.estimated_weeks,
            tracks=tracks,
            plan=plan.as_dict(),
            analysis=plan.analysis,
        )
        db.add(path)
        db.flush()

        for order, item in enumerate(plan.items):
            db.add(
                PathItem(
                    path_id=path.id,
                    user_id=user.id,
                    item_type=item.item_type,
                    course_id=item.course_id or f"{item.item_type[:3].upper()}-{order}",
                    title=item.title,
                    phase_index=item.phase_index,
                    phase_name=item.phase_name,
                    order_index=item.order_index,
                    hours=round(item.hours, 1),
                    score=round(item.score, 4),
                    factors=item.contributions,
                    rationale=item.rationale,
                    prerequisite_ids=item.prerequisite_ids,
                    skills=item.skills,
                )
            )

        for order, milestone in enumerate(plan.milestones):
            db.add(
                Milestone(
                    path_id=path.id,
                    user_id=user.id,
                    name=milestone.title,
                    description=milestone.description,
                    phase_index=order,
                    order_index=order,
                    target_week=milestone.target_week,
                    progress_threshold=round(milestone.progress_threshold * 100.0, 2),
                    skills_unlocked=milestone.skills_unlocked,
                    required_course_ids=milestone.required_course_ids,
                )
            )

        db.commit()
        db.refresh(path)
        return path

    def active_path(self, db: Session, user: User) -> LearningPath | None:
        return db.scalar(
            select(LearningPath)
            .where(LearningPath.user_id == user.id, LearningPath.status == "active")
            .order_by(LearningPath.created_at.desc())
        )

    def explain_path(self, path: LearningPath) -> dict:
        """Re-derive a stored path's explanation from its plan snapshot.

        The explanation is not persisted, because it is a pure function of the plan
        and of the explainer's current templates — storing it would freeze wording
        at generation time and make an improvement to the explainer invisible on
        every path already in the database. Rehydrating is sub-millisecond.
        """
        assert self.explainer is not None
        return self.explainer.explain_plan(rehydrate_plan(path.plan or {}, path.analysis or {})).as_dict()

    def explain_path_item(self, path: LearningPath, item: PathItem) -> dict:
        """Explain one step, preferring the plan snapshot over the flattened row."""
        assert self.explainer is not None
        raw = next(
            (
                i
                for i in (path.plan or {}).get("items", [])
                if i.get("order_index") == item.order_index
            ),
            None,
        )
        if raw is not None:
            plan_item = PlanItem(**_plan_item_kwargs(raw))
        else:  # a snapshot written by an older schema: rebuild from the row
            plan_item = PlanItem(
                item_type=item.item_type,
                title=item.title,
                hours=item.hours,
                phase_index=item.phase_index,
                phase_name=item.phase_name,
                order_index=item.order_index,
                course_id=item.course_id,
                score=item.score,
                contributions=dict(item.factors or {}),
                rationale=item.rationale,
                prerequisite_ids=list(item.prerequisite_ids or []),
                skills=list(item.skills or []),
            )
        return self.explainer.explain_item(plan_item).as_dict()

    # ------------------------------------------------------------------ #
    # Online adaptation
    # ------------------------------------------------------------------ #
    def record_feedback(
        self,
        db: Session,
        user: User,
        *,
        event_type: str,
        course_id: str | None = None,
        comment: str = "",
        factors: dict[str, float] | None = None,
        path_id: int | None = None,
    ) -> dict:
        """Fold one reaction into the learner model and report what changed.

        Returns the before/after weights so the UI can *show* the learner that
        their feedback moved something — adaptation the learner cannot see is
        indistinguishable from no adaptation.
        """
        assert self.catalog is not None
        model = self.learner_model(db, user)
        before = dict(model.weights or DEFAULT_WEIGHTS)

        # Recover the attribution vector: from the caller, else the stored path item.
        if not factors and course_id:
            item = db.scalar(
                select(PathItem).where(
                    PathItem.user_id == user.id, PathItem.course_id == course_id
                )
            )
            factors = dict(item.factors or {}) if item else {}
        factors = factors or {}

        sign, magnitude = EVENT_SIGNS.get(event_type, (0.0, 0.0))
        weights = dict(before)
        affinities = dict(model.affinities or {})
        bias = float(model.difficulty_bias or 0.0)

        if event_type == "too_hard":
            bias = float(np.clip(bias - _DIFFICULTY_STEP, -_DIFFICULTY_LIMIT, _DIFFICULTY_LIMIT))
        elif event_type == "too_easy":
            bias = float(np.clip(bias + _DIFFICULTY_STEP, -_DIFFICULTY_LIMIT, _DIFFICULTY_LIMIT))

        if sign != 0.0 and factors:
            focus = _NOT_RELEVANT_FOCUS if event_type == "not_relevant" else None
            weights = _apply_credit(weights, factors, sign * magnitude, focus=focus)

        if sign != 0.0 and course_id:
            affinities = _apply_affinity(
                affinities, self.catalog, course_id, sign * magnitude * settings.FEEDBACK_LEARNING_RATE
            )

        model.weights = weights
        model.affinities = affinities
        model.difficulty_bias = bias
        model.update_count = int(model.update_count or 0) + 1

        db.add(
            FeedbackEvent(
                user_id=user.id,
                course_id=course_id,
                path_id=path_id,
                event_type=event_type,
                weight=sign * magnitude,
                comment=comment,
                factors=factors,
            )
        )
        db.commit()

        changed = {
            f: round(weights.get(f, 0.0) - before.get(f, 0.0), 4)
            for f in FACTORS
            if abs(weights.get(f, 0.0) - before.get(f, 0.0)) >= 5e-4
        }
        return {
            "event_type": event_type,
            "weights_before": {k: round(v, 4) for k, v in before.items()},
            "weights_after": {k: round(v, 4) for k, v in weights.items()},
            "weight_deltas": changed,
            "difficulty_bias": round(bias, 3),
            "update_count": model.update_count,
            "explanation": _describe_adaptation(event_type, changed, bias),
        }

    # ------------------------------------------------------------------ #
    # Dashboard
    # ------------------------------------------------------------------ #
    def dashboard(self, db: Session, user: User) -> dict:
        """Everything the progress dashboard renders, computed in one pass."""
        assert self.catalog is not None and self.explainer is not None
        path = self.active_path(db, user)
        enrollments = {
            e.course_id: e
            for e in db.scalars(select(Enrollment).where(Enrollment.user_id == user.id))
        }
        completed_ids = {cid for cid, e in enrollments.items() if e.status == "completed"}

        state = self.learner_state(db, user)
        skills = proficiency_from_history(
            self.catalog, list(completed_ids), self_assessed=state.self_assessed
        )
        proficient = sorted(
            [s for s, v in skills.items() if v >= PROFICIENT_THRESHOLD],
            key=lambda s: -skills[s],
        )

        snapshot: dict = {
            "has_path": path is not None,
            "weekly_hours": state.weekly_hours,
            "experience_level": state.experience_level,
            "skills_proficient": proficient,
            "skills_in_progress": sorted(
                [s for s, v in skills.items() if 0.05 < v < PROFICIENT_THRESHOLD],
                key=lambda s: -skills[s],
            )[:12],
            "skill_levels": [
                {"skill": s, "proficiency": round(v, 3)}
                for s, v in sorted(skills.items(), key=lambda kv: -kv[1])[:14]
            ],
            "activity": self._activity_series(db, user),
            "feedback_count": db.scalar(
                select(LearnerModel.update_count).where(LearnerModel.user_id == user.id)
            )
            or 0,
        }

        if path is None:
            snapshot.update(
                {
                    "completed_courses": len(completed_ids),
                    "total_courses": 0,
                    "progress": 0.0,
                    "hours_completed": 0.0,
                    "total_hours": 0.0,
                    "phases": [],
                    "milestones": [],
                    "next_item": None,
                    "next_milestone": None,
                }
            )
            snapshot["narrative"] = self.explainer.explain_progress(snapshot).as_dict()
            return snapshot

        items = sorted(path.items, key=lambda i: i.order_index)
        # Course-scoped: feeds the "X of Y courses" headline stat specifically.
        course_items = [i for i in items if i.item_type == "course"]
        done_items = [i for i in course_items if i.course_id in completed_ids]

        # Item-scoped (courses, projects and assessments alike): feeds hours,
        # overall progress and "what's next". Projects and assessments are a
        # third to a half of a typical path — crediting only course
        # completions here would make the progress bar unable to reach 100%
        # even after finishing everything, and leave "do this next" pointing
        # at a step the learner already completed.
        hours_total = float(sum(i.hours for i in items))
        hours_done = float(sum(i.hours for i in items if i.course_id in completed_ids))
        for item in items:
            if item.course_id in completed_ids:
                continue
            enrollment = enrollments.get(item.course_id or "")
            if enrollment and enrollment.status == "in_progress":
                hours_done += item.hours * float(enrollment.progress_pct or 0.0) / 100.0

        progress = hours_done / hours_total if hours_total else 0.0
        next_item = next((i for i in items if i.course_id not in completed_ids), None)

        phases: dict[int, dict] = {}
        for item in items:
            phase = phases.setdefault(
                item.phase_index,
                {
                    "index": item.phase_index,
                    "name": item.phase_name,
                    "total": 0,
                    "completed": 0,
                    "hours": 0.0,
                    "hours_done": 0.0,
                },
            )
            phase["total"] += 1
            phase["hours"] += item.hours
            if item.course_id in completed_ids:
                phase["completed"] += 1
                phase["hours_done"] += item.hours
        for phase in phases.values():
            phase["progress"] = round(
                phase["hours_done"] / phase["hours"] if phase["hours"] else 0.0, 4
            )

        milestones = []
        next_milestone = None
        for milestone in db.scalars(
            select(Milestone)
            .where(Milestone.path_id == path.id)
            .order_by(Milestone.order_index)
        ):
            required = set(milestone.required_course_ids or [])
            met = required & completed_ids
            achieved = bool(required) and met == required
            record = {
                "id": milestone.id,
                "title": milestone.name,
                "description": milestone.description,
                "target_week": milestone.target_week,
                "progress_threshold": milestone.progress_threshold,
                "skills_unlocked": milestone.skills_unlocked,
                "required_total": len(required),
                "required_met": len(met),
                "achieved": achieved,
            }
            milestones.append(record)
            if not achieved and next_milestone is None:
                next_milestone = record

        # Pace is measured against *calendar* time since the path was created.
        # Deriving elapsed weeks from hours logged (an earlier version of this) is
        # circular: a learner who has done nothing looks like week 0 and therefore
        # perfectly on schedule, while one who is ahead looks behind.
        weeks_elapsed = 0.0
        if path.created_at is not None:
            elapsed = (utcnow() - _as_utc(path.created_at)).total_seconds()
            weeks_elapsed = max(elapsed / 604800.0, 0.0)
        expected_hours = weeks_elapsed * max(state.weekly_hours, 1.0)
        # 25% slack, and a floor of half a week's hours: a learner who signed up an
        # hour ago is not behind, and one light afternoon is not a schedule slip.
        shortfall = expected_hours * 0.75 - hours_done
        weeks_behind = (
            round(shortfall / max(state.weekly_hours, 1.0))
            if shortfall >= max(state.weekly_hours, 1.0) * 0.5
            else 0
        )

        snapshot.update(
            {
                "path": {
                    "id": path.id,
                    "title": path.title,
                    "goal_text": path.goal_text,
                    "tracks": path.tracks,
                    "version": path.version,
                    "estimated_weeks": path.estimated_weeks,
                    "created_at": path.created_at.isoformat() if path.created_at else None,
                },
                "completed_courses": len(done_items),
                "total_courses": len(course_items),
                "in_progress_courses": sum(
                    1
                    for i in course_items
                    if (enrollments.get(i.course_id or "") or Enrollment()).status == "in_progress"
                ),
                "progress": round(progress, 4),
                "hours_completed": round(hours_done, 1),
                "total_hours": round(hours_total, 1),
                "phases": [phases[k] for k in sorted(phases)],
                "milestones": milestones,
                "next_milestone": next_milestone,
                "next_item": (
                    {
                        "id": next_item.id,
                        "title": next_item.title,
                        "item_type": next_item.item_type,
                        "course_id": next_item.course_id,
                        "hours": next_item.hours,
                        "phase_name": next_item.phase_name,
                        "rationale": next_item.rationale,
                        "skills": next_item.skills,
                    }
                    if next_item
                    else None
                ),
                "readiness_before": (path.analysis or {}).get("readiness_before"),
                "readiness_after": (path.analysis or {}).get("readiness_after"),
                "weeks_elapsed": round(weeks_elapsed, 1),
                "weeks_behind": weeks_behind,
            }
        )
        snapshot["narrative"] = self.explainer.explain_progress(snapshot).as_dict()
        return snapshot

    def _activity_series(self, db: Session, user: User, weeks: int = 8) -> list[dict]:
        """Hours logged per ISO week, for the dashboard's trend chart."""
        buckets: dict[str, float] = {}
        for enrollment in db.scalars(select(Enrollment).where(Enrollment.user_id == user.id)):
            stamp = enrollment.completed_at or enrollment.updated_at
            if stamp is None:
                continue
            key = f"{stamp.isocalendar().year}-W{stamp.isocalendar().week:02d}"
            buckets[key] = buckets.get(key, 0.0) + float(enrollment.hours_logged or 0.0)
        ordered = sorted(buckets.items())[-weeks:]
        return [{"week": week, "hours": round(hours, 1)} for week, hours in ordered]


# --------------------------------------------------------------------------- #
# Plan rehydration
# --------------------------------------------------------------------------- #
def rehydrate_plan(plan: dict, analysis: dict) -> LearningPlan:
    """Rebuild a :class:`LearningPlan` from its stored JSON snapshot.

    Fields are filtered against each dataclass rather than splatted, so a snapshot
    written before a field existed (or after one was removed) still loads instead
    of raising ``TypeError`` on an old row.
    """
    return LearningPlan(
        items=[PlanItem(**_plan_item_kwargs(i)) for i in plan.get("items", [])],
        phases=[Phase(**_kwargs(p, _PHASE_FIELDS)) for p in plan.get("phases", [])],
        milestones=[
            MilestoneSpec(**_kwargs(m, _MILESTONE_FIELDS)) for m in plan.get("milestones", [])
        ],
        tracks=plan.get("tracks", []),
        total_hours=float(plan.get("total_hours", 0.0)),
        total_courses=int(plan.get("total_courses", 0)),
        estimated_weeks=int(plan.get("estimated_weeks", 0)),
        analysis=analysis,
    )


def _kwargs(raw: dict, allowed: frozenset[str]) -> dict:
    return {k: v for k, v in raw.items() if k in allowed}


_PLAN_ITEM_FIELDS = frozenset(
    {
        "item_type", "title", "hours", "phase_index", "phase_name", "order_index",
        "course_id", "score", "factors", "contributions", "rationale",
        "prerequisite_ids", "skills", "origin", "meta",
    }
)
_PHASE_FIELDS = frozenset(
    {"index", "name", "focus", "hours", "start_week", "end_week", "item_orders", "skills"}
)
_MILESTONE_FIELDS = frozenset(
    {
        "title", "description", "target_week", "progress_threshold",
        "skills_unlocked", "required_course_ids",
    }
)


def _plan_item_kwargs(raw: dict) -> dict:
    return _kwargs(raw, _PLAN_ITEM_FIELDS)


# --------------------------------------------------------------------------- #
# Credit assignment
# --------------------------------------------------------------------------- #
def _apply_credit(
    weights: dict[str, float],
    contributions: dict[str, float],
    signed_magnitude: float,
    *,
    focus: str | None = None,
) -> dict[str, float]:
    """Move factor weights in proportion to how much each drove the decision.

    The update is *relative to uniform*: a factor that supplied more than its
    even share of the score is held responsible for the outcome, a factor that
    supplied less is largely spared. That is what makes a thumbs-down
    informative — it says "the reason you picked this was wrong", not merely
    "this was wrong".

    Weights are then floored, capped and renormalised to sum to 1, so no factor
    can vanish (which would make it unrecoverable) or take over the ranking.
    """
    lr = settings.FEEDBACK_LEARNING_RATE
    uniform = 1.0 / len(FACTORS)

    updated: dict[str, float] = {}
    for factor in FACTORS:
        current = float(weights.get(factor, DEFAULT_WEIGHTS[factor]))
        share = float(contributions.get(factor, 0.0))
        delta = lr * signed_magnitude * (share - uniform)
        if focus == factor:
            delta += lr * signed_magnitude * 0.5  # extra blame where the learner pointed
        updated[factor] = float(np.clip(current + delta, _WEIGHT_FLOOR, _WEIGHT_CEILING))

    total = sum(updated.values()) or 1.0
    return {f: round(v / total, 5) for f, v in updated.items()}


def _apply_affinity(
    affinities: dict[str, float], cat: Catalog, course_id: str, step: float
) -> dict[str, float]:
    """Nudge categorical preferences (provider, format, track, branch, tier)."""
    pos = cat.pos(course_id)
    if pos is None:
        return affinities
    row = cat.df.iloc[pos]
    keys = (
        f"provider:{row['provider']}",
        f"format:{row['format']}",
        f"track:{row['track']}",
        f"branch:{row['branch']}",
        f"tier:{int(cat.tiers[pos])}",
    )
    out = dict(affinities)
    for key in keys:
        out[key] = float(
            np.clip(out.get(key, 0.0) + step, -_AFFINITY_LIMIT, _AFFINITY_LIMIT)
        )
    return out


def _describe_adaptation(event_type: str, deltas: dict[str, float], bias: float) -> str:
    """Say plainly what the learner's feedback changed."""
    if event_type == "too_hard":
        return (
            "Noted — I have shifted your target difficulty down "
            f"(bias now {bias:+.2f}) and will favour gentler material."
        )
    if event_type == "too_easy":
        return (
            "Noted — I have shifted your target difficulty up "
            f"(bias now {bias:+.2f}) and will stretch you more."
        )
    if not deltas:
        return "Logged. This one did not move your model much."

    from app.ml.ranker import FACTOR_LABELS

    ranked = sorted(deltas.items(), key=lambda kv: -abs(kv[1]))[:2]
    parts = [
        f"{FACTOR_LABELS.get(f, f)} {'up' if d > 0 else 'down'} {abs(d):.1%}"
        for f, d in ranked
    ]
    return "Adjusted how I weigh " + " and ".join(parts) + " for your next recommendations."


#: Career tags in the dataset are lower-case, and ``str.title()`` mangles the
#: acronyms in them ("ml engineer" -> "Ml Engineer"). Only these need fixing.
_TITLE_ACRONYMS = {
    "Ml": "ML", "Ai": "AI", "Iot": "IoT", "Ui": "UI", "Ux": "UX", "Qa": "QA",
    "Vlsi": "VLSI", "Rf": "RF", "Hvac": "HVAC", "Cad": "CAD", "Cam": "CAM",
    "Nlp": "NLP", "Devops": "DevOps", "Sre": "SRE", "It": "IT", "Bim": "BIM",
    "Pcb": "PCB", "Ev": "EV", "Gis": "GIS", "Erp": "ERP", "Api": "API",
}


def _title_case(text: str) -> str:
    return " ".join(_TITLE_ACRONYMS.get(w, w) for w in text.title().split())


def _path_title(goal: GoalInterpretation, tracks: list[str]) -> str:
    if goal.careers:
        return f"Path to {_title_case(goal.careers[0])}"
    if tracks:
        return f"{tracks[0]} Path" if len(tracks) == 1 else f"{tracks[0]} + {len(tracks) - 1} more"
    return "Personalised Learning Path"


# --------------------------------------------------------------------------- #
#: Process-wide singleton. Warmed once in the FastAPI lifespan hook.
engine = Engine()


def get_engine() -> Engine:
    """FastAPI dependency returning the warm engine."""
    if not engine.ready:
        engine.warm()
    return engine

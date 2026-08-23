"""Multi-factor course ranking with per-factor attribution.

A single similarity score cannot justify itself. This ranker scores every
candidate on nine independent, individually meaningful factors and keeps each
factor's *contribution* to the final number, so the assistant can say

    "Ranked #1 because it closes 4 of your 6 open skill gaps (contributed 31%)
     and sits at your level (18%) — its rating is only average (7%)."

rather than an unfalsifiable "this looks relevant". The same attribution vector
is stored on the recommendation and replayed when the learner gives feedback, so
credit for a thumbs-down can be assigned to the factor that caused it — that is
what makes the online adaptation in :mod:`app.ml.engine` principled instead of a
global fudge factor.

Factor design notes
-------------------
* ``goal_fit`` and ``skill_gain`` are normalised *within the candidate pool*.
  Absolute cosine values sit in a narrow band, so a relative reading is both more
  discriminative and more honest to show a learner as a percentage.
* ``level_fit`` is deliberately **asymmetric**: a course above the learner's level
  is penalised harder than one below it, because too-hard blocks progress while
  too-easy merely wastes time.
* ``prereq_ready`` floors at 0.25 rather than 0, since an unmet prerequisite makes
  a course *later*, not irrelevant — the planner still needs to see it.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from app.ml.catalog import Catalog
from app.ml.graph import PrerequisiteGraph
from app.ml.skills import GapReport
from app.ml.vectorizer import SemanticSpace

#: Ordered factor names. The order is stable so stored attribution vectors stay
#: comparable across versions of a learner's history.
FACTORS: tuple[str, ...] = (
    "goal_fit",
    "skill_gain",
    "level_fit",
    "quality",
    "prereq_ready",
    "effort_fit",
    "format_pref",
    "provider_pref",
    "affinity",
)

#: Starting weights, refined per learner by feedback (see ``LearnerModel``).
DEFAULT_WEIGHTS: dict[str, float] = {
    "goal_fit": 0.25,
    "skill_gain": 0.21,
    "level_fit": 0.13,
    "quality": 0.11,
    "prereq_ready": 0.10,
    "effort_fit": 0.06,
    "format_pref": 0.05,
    "provider_pref": 0.04,
    "affinity": 0.05,
}

#: Human-readable factor labels for the UI and explanations.
FACTOR_LABELS: dict[str, str] = {
    "goal_fit": "matches your stated goal",
    "skill_gain": "closes open skill gaps",
    "level_fit": "suits your current level",
    "quality": "well rated by other learners",
    "prereq_ready": "prerequisites already met",
    "effort_fit": "fits your weekly time budget",
    "format_pref": "in a format you prefer",
    "provider_pref": "from a provider you prefer",
    "affinity": "similar to what you've liked",
}

#: Experience level -> the difficulty tier a learner should be working at.
LEVEL_TO_TIER: dict[str, int] = {"Beginner": 0, "Intermediate": 1, "Advanced": 2}

_TOO_HARD_PENALTY = 0.30
_TOO_EASY_PENALTY = 0.20


@dataclass
class RankingContext:
    """Everything about the learner that influences ranking."""

    goal_vector: np.ndarray
    gap: GapReport | None = None
    experience_level: str = "Beginner"
    weekly_hours: float = 8.0
    preferred_formats: list[str] = field(default_factory=list)
    preferred_providers: list[str] = field(default_factory=list)
    completed_ids: set[str] = field(default_factory=set)
    #: Per-learner factor weights, defaulting to :data:`DEFAULT_WEIGHTS`.
    weights: dict[str, float] = field(default_factory=lambda: dict(DEFAULT_WEIGHTS))
    #: Learned likes/dislikes keyed ``"provider:Udemy"``, ``"track:Machine Learning"``, …
    affinities: dict[str, float] = field(default_factory=dict)
    #: Positive shifts the learner toward harder material.
    difficulty_bias: float = 0.0
    #: Optional per-track relevance from the goal interpretation.
    track_weights: dict[str, float] = field(default_factory=dict)

    @property
    def target_tier(self) -> float:
        base = LEVEL_TO_TIER.get(self.experience_level, 0)
        return float(np.clip(base + self.difficulty_bias, 0.0, 3.0))


@dataclass
class RankedCourse:
    """One scored candidate, carrying the evidence for its score."""

    pos: int
    course_id: str
    score: float
    #: Raw factor values in [0, 1].
    factors: dict[str, float]
    #: Share of the final score each factor supplied; sums to ~1.0.
    contributions: dict[str, float]
    prereq_ready: bool
    missing_prereq_ids: list[str] = field(default_factory=list)
    newly_covered_skills: list[str] = field(default_factory=list)

    @property
    def top_factors(self) -> list[tuple[str, float]]:
        """Factors ordered by how much they drove this course's score."""
        return sorted(self.contributions.items(), key=lambda kv: -kv[1])

    def as_dict(self) -> dict:
        return {
            "course_id": self.course_id,
            "score": round(self.score, 4),
            "factors": {k: round(v, 4) for k, v in self.factors.items()},
            "contributions": {k: round(v, 4) for k, v in self.contributions.items()},
            "prereq_ready": self.prereq_ready,
            "missing_prerequisites": self.missing_prereq_ids,
            "covers_skills": self.newly_covered_skills,
        }


class Ranker:
    """Scores candidate courses against a learner context."""

    def __init__(self, cat: Catalog, space: SemanticSpace, graph: PrerequisiteGraph) -> None:
        self.cat = cat
        self.space = space
        self.graph = graph

    # ------------------------------------------------------------------ #
    def rank(
        self,
        ctx: RankingContext,
        candidates: list[int] | None = None,
        *,
        limit: int = 20,
        exclude: set[str] | None = None,
    ) -> list[RankedCourse]:
        """Score and sort candidates, best first."""
        pool = self._pool(candidates, exclude, ctx)
        if not pool:
            return []

        matrix = self._factor_matrix(pool, ctx)  # (len(pool), len(FACTORS))
        weights = np.array([max(ctx.weights.get(f, DEFAULT_WEIGHTS[f]), 0.0) for f in FACTORS])
        total_weight = float(weights.sum()) or 1.0
        weighted = matrix * weights  # per-factor contribution, unnormalised
        scores = weighted.sum(axis=1) / total_weight

        gap_vec = ctx.gap.gap_vector(self.cat) if ctx.gap else None
        order = np.argsort(scores)[::-1][:limit]

        results: list[RankedCourse] = []
        for local in order:
            pos = pool[int(local)]
            row = weighted[int(local)]
            row_total = float(row.sum()) or 1.0
            factors = {f: float(matrix[int(local), i]) for i, f in enumerate(FACTORS)}
            contributions = {f: float(row[i]) / row_total for i, f in enumerate(FACTORS)}

            missing = self._missing_prereqs(pos, ctx.completed_ids)
            covered: list[str] = []
            if gap_vec is not None:
                cols = np.nonzero(self.cat.skill_matrix[pos] * gap_vec)[0]
                covered = [self.cat.skills[c] for c in cols]

            results.append(
                RankedCourse(
                    pos=pos,
                    course_id=self.cat.course_ids[pos],
                    score=float(scores[int(local)]),
                    factors=factors,
                    contributions=contributions,
                    prereq_ready=not missing,
                    missing_prereq_ids=missing,
                    newly_covered_skills=covered,
                )
            )
        return results

    # ------------------------------------------------------------------ #
    def _pool(
        self,
        candidates: list[int] | None,
        exclude: set[str] | None,
        ctx: RankingContext,
    ) -> list[int]:
        pool = list(dict.fromkeys(candidates)) if candidates else list(range(self.cat.size))
        blocked = set(exclude or set()) | ctx.completed_ids
        if blocked:
            pool = [p for p in pool if self.cat.course_ids[p] not in blocked]
        return pool

    # ------------------------------------------------------------------ #
    def _factor_matrix(self, pool: list[int], ctx: RankingContext) -> np.ndarray:
        n = len(pool)
        idx = np.asarray(pool)
        matrix = np.zeros((n, len(FACTORS)), dtype=np.float64)
        col = {f: i for i, f in enumerate(FACTORS)}

        # --- goal_fit: semantic similarity, pool-normalised ---
        sims = self.space.similarity_to_courses(ctx.goal_vector)[idx]
        # A per-track relevance nudge keeps chosen ladders ahead of stray matches.
        if ctx.track_weights:
            nudge = np.array(
                [0.7 + 0.3 * ctx.track_weights.get(self.cat.df.iloc[p]["track"], 0.0) for p in pool]
            )
            sims = sims * nudge
        matrix[:, col["goal_fit"]] = _pool_normalise(sims)

        # --- skill_gain: weighted gap mass this course would close ---
        if ctx.gap is not None:
            gap_vec = ctx.gap.gap_vector(self.cat)
            gains = self.cat.skill_matrix[idx] @ gap_vec
            matrix[:, col["skill_gain"]] = _pool_normalise(gains)

        # --- level_fit: asymmetric distance from the learner's target tier ---
        delta = self.cat.tiers[idx].astype(float) - ctx.target_tier
        penalty = np.where(delta >= 0, _TOO_HARD_PENALTY, _TOO_EASY_PENALTY)
        matrix[:, col["level_fit"]] = np.clip(1.0 - penalty * np.abs(delta), 0.0, 1.0)

        # --- quality: Bayesian-shrunk rating ---
        matrix[:, col["quality"]] = self.cat.quality[idx]

        # --- prereq_ready ---
        ready = np.array(
            [
                1.0 if self.graph.is_satisfied(self.cat, self.graph.rung_of[p], ctx.completed_ids)
                else 0.25
                for p in pool
            ]
            if self.graph.rung_of
            else np.ones(n)
        )
        matrix[:, col["prereq_ready"]] = ready

        # --- effort_fit: completable in roughly three weeks of the learner's time ---
        budget = max(ctx.weekly_hours, 1.0) * 3.0
        ratio = self.cat.hours[idx] / budget
        matrix[:, col["effort_fit"]] = np.clip(np.where(ratio <= 1.0, 1.0, 1.0 / ratio), 0.0, 1.0)

        # --- stated preferences: neutral 0.5 when the learner said nothing ---
        matrix[:, col["format_pref"]] = _preference(
            [self.cat.df.iloc[p]["format"] for p in pool], ctx.preferred_formats
        )
        matrix[:, col["provider_pref"]] = _preference(
            [self.cat.df.iloc[p]["provider"] for p in pool], ctx.preferred_providers
        )

        # --- affinity: learned from feedback, centred at 0.5 ---
        if ctx.affinities:
            raw = np.array([self._affinity(p, ctx.affinities) for p in pool])
            matrix[:, col["affinity"]] = 0.5 + 0.5 * np.tanh(raw)
        else:
            matrix[:, col["affinity"]] = 0.5

        return matrix

    # ------------------------------------------------------------------ #
    def _affinity(self, pos: int, affinities: dict[str, float]) -> float:
        row = self.cat.df.iloc[pos]
        keys = (
            f"provider:{row['provider']}",
            f"format:{row['format']}",
            f"track:{row['track']}",
            f"branch:{row['branch']}",
            f"tier:{int(self.cat.tiers[pos])}",
        )
        return float(sum(affinities.get(k, 0.0) for k in keys))

    def _missing_prereqs(self, pos: int, completed: set[str]) -> list[str]:
        """Prerequisite rungs with no completed variant, as representative ids."""
        rung = self.graph.rung_of.get(pos)
        if rung is None:
            return []
        missing: list[str] = []
        for prereq in self.graph.prereq_rungs(rung):
            members = self.graph.members.get(prereq, [])
            member_ids = {self.cat.course_ids[p] for p in members}
            if member_ids & completed:
                continue
            if members:
                # Best-quality variant represents the unmet rung.
                best = max(members, key=lambda p: float(self.cat.quality[p]))
                missing.append(self.cat.course_ids[best])
        return missing


# --------------------------------------------------------------------------- #
def _pool_normalise(values: np.ndarray) -> np.ndarray:
    """Scale to [0, 1] by the pool maximum, so the factor reads as a percentage."""
    top = float(values.max()) if values.size else 0.0
    if top <= 1e-9:
        return np.zeros_like(values, dtype=np.float64)
    return np.clip(values / top, 0.0, 1.0).astype(np.float64)


def _preference(values: list[str], preferred: list[str]) -> np.ndarray:
    """1.0 for a preferred value, 0.15 against, neutral 0.5 with no preference."""
    if not preferred:
        return np.full(len(values), 0.5)
    wanted = set(preferred)
    return np.array([1.0 if v in wanted else 0.15 for v in values])

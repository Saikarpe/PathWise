"""Competency modelling, skill-gap analysis and coverage-driven course selection.

Dataset characteristics that shaped this design
-----------------------------------------------
Profiling the catalogue first changed the model substantially:

* ``skills_taught`` is drawn from a **branch-level** pool, not a track-level one.
  Every Computer Science course samples from the same ~12 skills (``algorithms``,
  ``docker``, ``python``, …) whether its track is Machine Learning or Computer
  Networks. There is no ``machine learning`` skill in the vocabulary at all.
* ``career_paths`` is likewise assigned within a branch, so ``ml engineer`` is
  tagged on VLSI Design and Quantum Computing courses. Career tags indicate
  *branch* affinity, not track relevance.
* ``track``, ``difficulty_level`` and ``prerequisite_course_title`` are the clean,
  meaningful signals: 235 well-named tracks each forming a 4-rung ladder.

So competency is modelled at **two levels**:

* *Track mastery* — the spine of a roadmap. Which ladders to climb is decided
  semantically (see :mod:`app.ml.vectorizer`), never from career tags.
* *Skill coverage* — the finer dimension used for gap analysis and for choosing
  between interchangeable provider variants.

Importance weighting therefore uses **centrality × distinctiveness** rather than
raw centrality. Frequency alone would rank the branch-wide filler skills highest
for every goal, producing an identical flat profile for all CSE learners.

Three mechanisms do the work
----------------------------
1. **Derived competency model.** Aggregating skills over the courses of a track
   (or career) gives an empirical profile: *centrality* is the fraction of those
   courses teaching a skill, *distinctiveness* is how concentrated that skill is
   here versus catalogue-wide.

2. **Saturating skill acquisition.** Proficiency is not additive — three courses
   covering ``matlab`` should not yield 300%. Each course applies a tier-scaled
   gain to the *remaining* gap, so proficiency approaches 1.0 asymptotically and
   repeated exposure has diminishing returns.

3. **Greedy weighted set cover.** Choosing the fewest courses closing the most gap
   is max-coverage: NP-hard, but the greedy "best marginal gain per unit effort"
   rule is the standard ``1 - 1/e`` approximation. Selecting by marginal gain
   rather than raw relevance is what stops the recommender returning five
   near-duplicate courses that all teach the same skill.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from app.ml.catalog import Catalog

#: Proficiency a single course confers on each skill it teaches, by tier.
#: Higher tiers teach the skill more deeply.
TIER_SKILL_GAIN: dict[int, float] = {0: 0.35, 1: 0.55, 2: 0.75, 3: 0.85}

#: A skill counts as "held" for prerequisite purposes above this level.
PROFICIENT_THRESHOLD = 0.6


# --------------------------------------------------------------------------- #
# Competency model
# --------------------------------------------------------------------------- #
@dataclass
class CompetencyModel:
    """Empirical skill requirements per career and per track."""

    #: career -> {skill: centrality in [0, 1]}
    career_skills: dict[str, dict[str, float]] = field(default_factory=dict)
    #: track -> {skill: centrality in [0, 1]}
    track_skills: dict[str, dict[str, float]] = field(default_factory=dict)
    #: career -> tracks that most often feed it, ranked
    career_tracks: dict[str, list[tuple[str, float]]] = field(default_factory=dict)
    #: skill -> fraction of the whole catalogue teaching it
    global_skill_freq: dict[str, float] = field(default_factory=dict)

    def required_level(self, importance: float) -> float:
        """Map importance to the proficiency a learner should reach.

        Even a peripheral skill needs some exposure (floor 0.40); a skill central
        and distinctive to the goal should be mastered (ceiling 1.0).
        """
        return 0.40 + 0.60 * min(max(importance, 0.0), 1.0)

    def importance(self, skill: str, centrality: float) -> float:
        """Weight a skill by centrality **and** distinctiveness.

        ``distinctiveness = centrality / (centrality + global_frequency)`` is high
        when a skill concentrates in this track/career and near 0.5 when it is
        catalogue-wide filler. Multiplying by ``2 * distinctiveness`` leaves
        distinctive skills at full centrality while halving ubiquitous ones, so
        goals within one branch no longer produce identical flat profiles.
        """
        freq = self.global_skill_freq.get(skill, 0.0)
        denom = centrality + freq
        distinctiveness = (centrality / denom) if denom > 0 else 0.5
        return float(min(centrality * 2.0 * distinctiveness, 1.0))


def build_competency_model(cat: Catalog) -> CompetencyModel:
    """Aggregate skills over careers and tracks to derive requirement profiles."""
    model = CompetencyModel()

    total_courses = max(cat.size, 1)
    model.global_skill_freq = {
        skill: len(positions) / total_courses for skill, positions in cat.skill_index.items()
    }

    for career, positions in cat.career_index.items():
        total = len(positions)
        counts: dict[str, int] = {}
        track_counts: dict[str, int] = {}
        for p in positions:
            for skill in cat.df.iloc[p]["skills_taught"]:
                counts[skill] = counts.get(skill, 0) + 1
            track = cat.df.iloc[p]["track"]
            track_counts[track] = track_counts.get(track, 0) + 1
        model.career_skills[career] = {
            s: c / total for s, c in sorted(counts.items(), key=lambda kv: -kv[1])
        }
        model.career_tracks[career] = [
            (t, c / total) for t, c in sorted(track_counts.items(), key=lambda kv: -kv[1])
        ]

    for track, positions in cat.track_name_index.items():
        total = len(positions)
        counts = {}
        for p in positions:
            for skill in cat.df.iloc[p]["skills_taught"]:
                counts[skill] = counts.get(skill, 0) + 1
        model.track_skills[track] = {
            s: c / total for s, c in sorted(counts.items(), key=lambda kv: -kv[1])
        }

    return model


# --------------------------------------------------------------------------- #
# Learner skill state
# --------------------------------------------------------------------------- #
def proficiency_from_history(
    cat: Catalog,
    completed_course_ids: list[str],
    self_assessed: dict[str, float] | None = None,
) -> dict[str, float]:
    """Infer per-skill proficiency from completed courses plus self-assessment.

    Gains combine multiplicatively on the remaining gap, so proficiency
    saturates toward 1.0 instead of exceeding it.
    """
    remaining: dict[str, float] = {}  # skill -> (1 - proficiency)

    for skill, level in (self_assessed or {}).items():
        level = min(max(float(level), 0.0), 1.0)
        remaining[skill] = min(remaining.get(skill, 1.0), 1.0 - level)

    for course_id in completed_course_ids:
        pos = cat.pos(course_id)
        if pos is None:
            continue
        gain = TIER_SKILL_GAIN.get(int(cat.tiers[pos]), 0.4)
        for skill in cat.df.iloc[pos]["skills_taught"]:
            remaining[skill] = remaining.get(skill, 1.0) * (1.0 - gain)

    return {skill: round(1.0 - gap, 4) for skill, gap in remaining.items()}


# --------------------------------------------------------------------------- #
# Gap analysis
# --------------------------------------------------------------------------- #
@dataclass
class SkillGap:
    """One skill's requirement versus the learner's current level."""

    skill: str
    required: float
    current: float
    importance: float

    @property
    def gap(self) -> float:
        return max(0.0, self.required - self.current)

    @property
    def weighted_gap(self) -> float:
        return self.gap * self.importance

    def as_dict(self) -> dict:
        return {
            "skill": self.skill,
            "required": round(self.required, 3),
            "current": round(self.current, 3),
            "gap": round(self.gap, 3),
            "importance": round(self.importance, 3),
            "status": (
                "mastered"
                if self.current >= self.required
                else "in_progress"
                if self.current > 0.05
                else "missing"
            ),
        }


@dataclass
class GapReport:
    """The full target-versus-current picture driving path generation."""

    gaps: list[SkillGap] = field(default_factory=list)
    target_skills: dict[str, float] = field(default_factory=dict)  # skill -> required level
    source: str = ""  # how the target was derived, for explanations

    @property
    def open_gaps(self) -> list[SkillGap]:
        return [g for g in self.gaps if g.gap > 0.01]

    @property
    def total_gap_mass(self) -> float:
        return sum(g.weighted_gap for g in self.gaps)

    @property
    def readiness(self) -> float:
        """Fraction of the weighted requirement the learner already meets, 0-1."""
        demand = sum(g.required * g.importance for g in self.gaps)
        if demand <= 0:
            return 1.0
        met = sum(min(g.current, g.required) * g.importance for g in self.gaps)
        return round(met / demand, 4)

    def gap_vector(self, cat: Catalog) -> np.ndarray:
        """Weighted gap per skill, aligned to ``cat.skills`` column order."""
        vec = np.zeros(len(cat.skills), dtype=np.float32)
        for g in self.open_gaps:
            col = cat.skill_to_col.get(g.skill)
            if col is not None:
                vec[col] = g.weighted_gap
        return vec

    def as_dict(self) -> dict:
        return {
            "source": self.source,
            "readiness": self.readiness,
            "total_gap_mass": round(self.total_gap_mass, 3),
            "skills": [g.as_dict() for g in sorted(self.gaps, key=lambda x: -x.weighted_gap)],
            "open_gap_count": len(self.open_gaps),
            "missing_count": sum(1 for g in self.gaps if g.current <= 0.05),
            "mastered_count": sum(1 for g in self.gaps if g.current >= g.required),
        }


#: Career tags are branch-level noise in this dataset (see module docstring), so
#: their skill signal is discounted against the semantically-selected tracks.
CAREER_SIGNAL_WEIGHT = 0.55
TRACK_SIGNAL_WEIGHT = 1.00


def build_target_profile(
    model: CompetencyModel,
    *,
    careers: list[str] | None = None,
    tracks: list[str] | None = None,
    explicit_skills: list[str] | None = None,
    track_weights: dict[str, float] | None = None,
) -> tuple[dict[str, float], str]:
    """Merge every stated goal signal into ``{skill: importance}``.

    Tracks dominate because they are chosen semantically from the learner's goal
    and are the dataset's coherent unit; careers contribute a discounted signal;
    a skill the learner named outright is maximally important. ``track_weights``
    optionally scales each track by its semantic relevance to the goal.

    Returns the profile and a short description of where it came from, which the
    explainer surfaces to the learner.
    """
    importance: dict[str, float] = {}
    sources: list[str] = []

    def contribute(skill: str, value: float) -> None:
        importance[skill] = max(importance.get(skill, 0.0), min(value, 1.0))

    for track in tracks or []:
        profile = model.track_skills.get(track)
        if not profile:
            continue
        relevance = float((track_weights or {}).get(track, 1.0))
        sources.append(f"track '{track}'")
        for skill, centrality in profile.items():
            contribute(skill, TRACK_SIGNAL_WEIGHT * relevance * model.importance(skill, centrality))

    for career in careers or []:
        profile = model.career_skills.get(career)
        if not profile:
            continue
        sources.append(f"target role '{career}'")
        for skill, centrality in profile.items():
            contribute(skill, CAREER_SIGNAL_WEIGHT * model.importance(skill, centrality))

    for skill in explicit_skills or []:
        contribute(skill, 1.0)
        sources.append(f"requested skill '{skill}'")

    unique_sources = list(dict.fromkeys(sources))
    summary = ", ".join(unique_sources[:4]) or "general profile"
    return importance, summary


def analyse_gap(
    model: CompetencyModel,
    target_importance: dict[str, float],
    learner_skills: dict[str, float],
    source: str = "",
) -> GapReport:
    """Compare required proficiency against the learner's current state."""
    gaps = [
        SkillGap(
            skill=skill,
            required=model.required_level(imp),
            current=float(learner_skills.get(skill, 0.0)),
            importance=imp,
        )
        for skill, imp in target_importance.items()
    ]
    return GapReport(
        gaps=gaps,
        target_skills={g.skill: g.required for g in gaps},
        source=source,
    )


# --------------------------------------------------------------------------- #
# Coverage-driven selection
# --------------------------------------------------------------------------- #
@dataclass
class CoverageResult:
    """Outcome of greedy set cover."""

    selected: list[int] = field(default_factory=list)
    #: position -> weighted gap mass this course was the first to cover
    marginal_gain: dict[int, float] = field(default_factory=dict)
    #: position -> skills it was the first to cover
    newly_covered: dict[int, list[str]] = field(default_factory=dict)
    covered_mass: float = 0.0
    total_mass: float = 0.0

    @property
    def coverage_ratio(self) -> float:
        return round(self.covered_mass / self.total_mass, 4) if self.total_mass > 0 else 1.0


def greedy_skill_cover(
    cat: Catalog,
    report: GapReport,
    candidates: list[int],
    *,
    max_courses: int = 12,
    relevance: np.ndarray | None = None,
    cost_sensitive: bool = True,
    coverage_target: float = 0.95,
) -> CoverageResult:
    """Pick courses that close the most weighted skill gap.

    At each step the course with the best marginal gain is taken; with
    ``cost_sensitive`` the gain is divided by effort (hours) so a 12-hour course
    covering two gaps beats a 50-hour course covering three. ``relevance``
    (semantic similarity to the goal) breaks ties so covering courses stay
    on-topic.
    """
    result = CoverageResult()
    if not candidates:
        return result

    gap_vec = report.gap_vector(cat)  # (n_skills,) weighted remaining gap
    result.total_mass = float(gap_vec.sum())
    if result.total_mass <= 0:
        return result

    remaining = gap_vec.copy()
    pool = list(dict.fromkeys(candidates))
    skill_names = cat.skills

    while pool and len(result.selected) < max_courses:
        rows = cat.skill_matrix[pool]  # (len(pool), n_skills)
        gains = rows @ remaining  # weighted gap each course would close

        scores = gains.copy()
        if cost_sensitive:
            effort = np.maximum(cat.hours[pool], 1.0)
            # Normalise effort so the ratio stays on a comparable scale.
            scores = gains / np.sqrt(effort)
        if relevance is not None:
            # Small multiplicative nudge keeps covering courses on-topic.
            scores = scores * (0.75 + 0.5 * relevance[pool])

        best_local = int(np.argmax(scores))
        if gains[best_local] <= 1e-9:
            break  # nothing left to cover

        best_pos = pool[best_local]
        covered_cols = np.nonzero(cat.skill_matrix[best_pos] * remaining)[0]

        result.selected.append(best_pos)
        result.marginal_gain[best_pos] = float(gains[best_local])
        result.newly_covered[best_pos] = [skill_names[c] for c in covered_cols]
        result.covered_mass += float(gains[best_local])

        remaining[covered_cols] = 0.0
        pool.pop(best_local)

        if result.covered_mass / result.total_mass >= coverage_target:
            break

    return result

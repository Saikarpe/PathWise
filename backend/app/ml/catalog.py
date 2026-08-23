"""Course catalogue: loads the dataset and derives every index the engine needs.

The raw CSV is denormalised text. This module turns it into:

* canonical multi-valued fields (skills / tools / careers / sectors)
* integer difficulty tiers, so ordering and "fit" become arithmetic
* inverted indices (skill -> courses, career -> courses, track -> courses)
* variant groups: courses that are the same rung of the same track offered by
  different providers, which is the unit the planner chooses between
* a Bayesian-shrunk quality score, so a 5.0 from 3 reviewers does not outrank a
  4.6 from 900

Everything is computed once at startup and shared read-only.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd

from app.core.config import settings

#: Ordered difficulty ladder. Index == tier.
DIFFICULTY_ORDER: tuple[str, ...] = ("Beginner", "Intermediate", "Advanced", "Capstone")
DIFFICULTY_TIER: dict[str, int] = {name: i for i, name in enumerate(DIFFICULTY_ORDER)}

#: Multi-valued columns stored as "a; b; c" in the CSV.
LIST_COLUMNS: tuple[str, ...] = (
    "skills_taught",
    "tools_covered",
    "career_paths",
    "industry_sectors",
)


def _split_list(value: object) -> list[str]:
    """Parse a "a; b; c" cell into canonical lowercase tokens."""
    if not isinstance(value, str):
        return []
    out: list[str] = []
    for part in value.split(";"):
        token = " ".join(part.strip().lower().split())
        if token and token not in out:
            out.append(token)
    return out


@dataclass
class Catalog:
    """Indexed, read-only view of the course catalogue."""

    df: pd.DataFrame

    # --- identity ---
    course_ids: list[str] = field(default_factory=list)
    id_to_pos: dict[str, int] = field(default_factory=dict)

    # --- vocabularies (sorted, canonical) ---
    skills: list[str] = field(default_factory=list)
    tools: list[str] = field(default_factory=list)
    careers: list[str] = field(default_factory=list)
    sectors: list[str] = field(default_factory=list)
    tracks: list[str] = field(default_factory=list)
    branches: list[str] = field(default_factory=list)
    providers: list[str] = field(default_factory=list)
    formats: list[str] = field(default_factory=list)

    # --- inverted indices: token -> course positions ---
    skill_index: dict[str, list[int]] = field(default_factory=dict)
    career_index: dict[str, list[int]] = field(default_factory=dict)
    sector_index: dict[str, list[int]] = field(default_factory=dict)
    track_index: dict[tuple[str, str], list[int]] = field(default_factory=dict)
    branch_index: dict[str, list[int]] = field(default_factory=dict)
    #: Track name (may be shared across branches) -> positions in any branch.
    track_name_index: dict[str, list[int]] = field(default_factory=dict)

    #: (branch, track, tier) -> interchangeable course positions.
    variant_index: dict[tuple[str, str, int], list[int]] = field(default_factory=dict)

    #: Lower-cased name -> the dataset's own spelling, for branches and tracks.
    #: The token indices (``skill_index`` and friends) are lower-cased at load
    #: because their source columns are token lists, but branch and track names
    #: are displayed to learners verbatim and so keep their original casing. That
    #: split is easy to forget, so every case-insensitive lookup goes through
    #: :meth:`resolve_track` / :meth:`resolve_branch` rather than guessing.
    track_lookup: dict[str, str] = field(default_factory=dict)
    branch_lookup: dict[str, str] = field(default_factory=dict)

    #: Branch -> its track names, in the dataset's own casing. Precomputed at load
    #: because the taxonomy and vocabulary endpoints both need it on every page
    #: load, and deriving it per request meant a per-row ``.iloc`` walk of all
    #: 2,400 courses — 600ms of pure overhead on a value that never changes.
    tracks_by_branch: dict[str, list[str]] = field(default_factory=dict)

    # --- numeric arrays, aligned to df row order ---
    tiers: np.ndarray = field(default_factory=lambda: np.zeros(0, dtype=np.int8))
    hours: np.ndarray = field(default_factory=lambda: np.zeros(0))
    ratings: np.ndarray = field(default_factory=lambda: np.zeros(0))
    reviews: np.ndarray = field(default_factory=lambda: np.zeros(0))
    #: Rating shrunk toward the global mean, normalised to [0, 1].
    quality: np.ndarray = field(default_factory=lambda: np.zeros(0))

    #: Multi-hot course x skill matrix, used for gap coverage arithmetic.
    skill_matrix: np.ndarray = field(default_factory=lambda: np.zeros((0, 0), dtype=np.float32))
    skill_to_col: dict[str, int] = field(default_factory=dict)

    @property
    def size(self) -> int:
        return len(self.df)

    # ------------------------------------------------------------------ #
    # Lookup helpers
    # ------------------------------------------------------------------ #
    def pos(self, course_id: str) -> int | None:
        return self.id_to_pos.get(course_id)

    def row(self, pos: int) -> pd.Series:
        return self.df.iloc[pos]

    def positions_for_ids(self, course_ids: list[str]) -> list[int]:
        return [p for p in (self.id_to_pos.get(cid) for cid in course_ids) if p is not None]

    # ------------------------------------------------------------------ #
    # Case-insensitive structural lookups
    # ------------------------------------------------------------------ #
    def resolve_track(self, name: str) -> str | None:
        """Canonical track name for any casing, or ``None`` if unknown."""
        return self.track_lookup.get(" ".join(name.strip().lower().split()))

    def resolve_branch(self, name: str) -> str | None:
        return self.branch_lookup.get(" ".join(name.strip().lower().split()))

    def track_positions(self, name: str, tier: int | None = None) -> list[int]:
        """Courses on a track, in any branch, optionally restricted to one tier."""
        canonical = self.resolve_track(name)
        if canonical is None:
            return []
        positions = self.track_name_index.get(canonical, [])
        if tier is None:
            return list(positions)
        return [p for p in positions if int(self.tiers[p]) == tier]

    def branch_positions(self, name: str) -> list[int]:
        canonical = self.resolve_branch(name)
        return list(self.branch_index.get(canonical, [])) if canonical else []

    def course_dict(self, pos: int) -> dict:
        """Serialisable representation of one course."""
        r = self.df.iloc[pos]
        return {
            "course_id": r["course_id"],
            "title": r["course_title"],
            "branch": r["branch"],
            "track": r["track"],
            "difficulty": r["difficulty_level"],
            "tier": int(self.tiers[pos]),
            "provider": r["provider"],
            "format": r["format"],
            "description": r["description"],
            "skills": list(r["skills_taught"]),
            "tools": list(r["tools_covered"]),
            "career_paths": list(r["career_paths"]),
            "industry_sectors": list(r["industry_sectors"]),
            "prerequisite_title": (
                r["prerequisite_course_title"]
                if isinstance(r["prerequisite_course_title"], str)
                else None
            ),
            "hours": float(r["estimated_hours"]),
            "rating": float(r["rating"]),
            "num_reviews": int(r["num_reviews"]),
            "quality": round(float(self.quality[pos]), 4),
        }

    def skills_of(self, positions: list[int]) -> list[str]:
        """Union of skills taught across the given courses, order preserved."""
        seen: dict[str, None] = {}
        for p in positions:
            for s in self.df.iloc[p]["skills_taught"]:
                seen.setdefault(s, None)
        return list(seen)


def _build_index(series: pd.Series) -> dict[str, list[int]]:
    """Invert a column of token lists into token -> row positions."""
    index: dict[str, list[int]] = {}
    for pos, tokens in enumerate(series):
        for token in tokens:
            index.setdefault(token, []).append(pos)
    return index


def load_catalog(csv_path: str | Path | None = None) -> Catalog:
    """Read the dataset and derive all indices. Called once per process."""
    path = Path(csv_path or settings.COURSES_CSV)
    if not path.exists():
        raise FileNotFoundError(
            f"Course dataset not found at {path}. "
            "Set COURSES_CSV or place the CSV in backend/data/."
        )

    df = pd.read_csv(path)
    df = df.drop_duplicates(subset=["course_id"]).reset_index(drop=True)

    # ---- canonicalise multi-valued columns ----
    for col in LIST_COLUMNS:
        df[col] = df[col].apply(_split_list) if col in df.columns else [[]] * len(df)

    for col in ("branch", "track", "provider", "format", "difficulty_level", "course_title"):
        df[col] = df[col].astype(str).str.strip()

    df["description"] = df["description"].fillna("").astype(str)
    df["prerequisite_course_title"] = df["prerequisite_course_title"].where(
        df["prerequisite_course_title"].notna(), None
    )
    for col, default in (("estimated_hours", 20.0), ("rating", 4.0), ("num_reviews", 0)):
        df[col] = pd.to_numeric(df[col], errors="coerce").fillna(default)

    cat = Catalog(df=df)

    # ---- identity ----
    cat.course_ids = df["course_id"].tolist()
    cat.id_to_pos = {cid: i for i, cid in enumerate(cat.course_ids)}

    # ---- numeric arrays ----
    cat.tiers = df["difficulty_level"].map(DIFFICULTY_TIER).fillna(0).to_numpy(dtype=np.int8)
    cat.hours = df["estimated_hours"].to_numpy(dtype=float)
    cat.ratings = df["rating"].to_numpy(dtype=float)
    cat.reviews = df["num_reviews"].to_numpy(dtype=float)

    # Bayesian shrinkage toward the global mean, then min-max to [0, 1].
    prior_mean = float(cat.ratings.mean()) if cat.size else 4.0
    w = float(settings.RATING_PRIOR_WEIGHT)
    adjusted = (cat.ratings * cat.reviews + prior_mean * w) / (cat.reviews + w)
    lo, hi = float(adjusted.min()), float(adjusted.max())
    cat.quality = (adjusted - lo) / (hi - lo) if hi > lo else np.full(cat.size, 0.5)

    # ---- vocabularies ----
    cat.skill_index = _build_index(df["skills_taught"])
    cat.career_index = _build_index(df["career_paths"])
    cat.sector_index = _build_index(df["industry_sectors"])
    tool_index = _build_index(df["tools_covered"])

    cat.skills = sorted(cat.skill_index)
    cat.careers = sorted(cat.career_index)
    cat.sectors = sorted(cat.sector_index)
    cat.tools = sorted(tool_index)
    cat.tracks = sorted(df["track"].unique())
    cat.branches = sorted(df["branch"].unique())
    cat.providers = sorted(df["provider"].unique())
    cat.formats = sorted(df["format"].unique())

    # ---- structural indices ----
    for pos, (branch, track, tier) in enumerate(
        zip(df["branch"], df["track"], cat.tiers, strict=True)
    ):
        cat.track_index.setdefault((branch, track), []).append(pos)
        cat.track_name_index.setdefault(track, []).append(pos)
        cat.branch_index.setdefault(branch, []).append(pos)
        cat.variant_index.setdefault((branch, track, int(tier)), []).append(pos)

    cat.track_lookup = {t.lower(): t for t in cat.tracks}
    cat.branch_lookup = {b.lower(): b for b in cat.branches}
    cat.tracks_by_branch = {
        str(branch): sorted({str(t) for t in series.dropna()})
        for branch, series in df.groupby("branch", sort=True)["track"]
    }

    # ---- course x skill multi-hot matrix ----
    cat.skill_to_col = {s: i for i, s in enumerate(cat.skills)}
    matrix = np.zeros((cat.size, len(cat.skills)), dtype=np.float32)
    for pos, tokens in enumerate(df["skills_taught"]):
        for token in tokens:
            col = cat.skill_to_col.get(token)
            if col is not None:
                matrix[pos, col] = 1.0
    cat.skill_matrix = matrix

    return cat

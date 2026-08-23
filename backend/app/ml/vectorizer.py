"""Semantic vector space over the catalogue.

Pipeline: field-weighted text -> TF-IDF -> Truncated SVD (LSA) -> L2 norm.

Why LSA rather than a transformer encoder: the catalogue is 2,400 documents over
a closed vocabulary of ~230 tracks and ~76 skills, and the descriptions are
templated, so almost all discriminative signal lives in the title, track, skill
and career fields. LSA over field-weighted TF-IDF captures that signal, fits in
about two seconds on CPU, needs no model download, and keeps the whole service
installable from ``pip install -r requirements.txt``. Synonymy across the closed
vocabulary is handled by the alias table in :mod:`app.ml.intent`.

Field weighting matters: repeating high-signal fields raises their term counts
before IDF, so "VLSI Design" in a title outweighs the same phrase buried in a
boilerplate description.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from sklearn.decomposition import TruncatedSVD
from sklearn.feature_extraction.text import TfidfVectorizer

from app.core.config import settings
from app.ml.catalog import Catalog

#: How many times each field is repeated in a course's pseudo-document.
FIELD_WEIGHTS: dict[str, int] = {
    "course_title": 3,
    "track": 3,
    "skills_taught": 2,
    "career_paths": 2,
    "tools_covered": 1,
    "branch": 1,
    "industry_sectors": 1,
    "description": 1,
}


def _document(row) -> str:
    """Build one field-weighted pseudo-document for a course."""
    parts: list[str] = []
    for column, weight in FIELD_WEIGHTS.items():
        value = row[column]
        text = " ".join(value) if isinstance(value, list) else str(value or "")
        if text:
            parts.extend([text] * weight)
    return " ".join(parts).lower()


@dataclass
class SemanticSpace:
    """Fitted TF-IDF + LSA space with precomputed course and track vectors."""

    vectorizer: TfidfVectorizer
    svd: TruncatedSVD
    #: (n_courses, n_components), L2-normalised.
    course_vectors: np.ndarray
    #: Track name -> L2-normalised centroid of its courses.
    track_vectors: dict[str, np.ndarray] = field(default_factory=dict)
    track_names: list[str] = field(default_factory=list)
    #: (n_tracks, n_components) stacked in ``track_names`` order.
    track_matrix: np.ndarray = field(default_factory=lambda: np.zeros((0, 0)))
    #: Career name -> L2-normalised centroid of courses tagged with it.
    career_vectors: dict[str, np.ndarray] = field(default_factory=dict)
    explained_variance: float = 0.0

    # ------------------------------------------------------------------ #
    def encode(self, text: str) -> np.ndarray:
        """Project free text into the LSA space as an L2-normalised vector."""
        if not text or not text.strip():
            return np.zeros(self.course_vectors.shape[1])
        vec = self.svd.transform(self.vectorizer.transform([text.lower()]))[0]
        return _l2(vec)

    def similarity_to_courses(self, query: np.ndarray) -> np.ndarray:
        """Cosine similarity of ``query`` against every course, clipped to [0, 1]."""
        if not query.any():
            return np.zeros(self.course_vectors.shape[0])
        return np.clip(self.course_vectors @ query, 0.0, 1.0)

    def rank_tracks(self, query: np.ndarray, top_n: int = 10) -> list[tuple[str, float]]:
        """Most semantically similar tracks to ``query``."""
        if not query.any() or self.track_matrix.size == 0:
            return []
        scores = self.track_matrix @ query
        order = np.argsort(scores)[::-1][:top_n]
        return [(self.track_names[i], float(max(scores[i], 0.0))) for i in order]


def _l2(vec: np.ndarray) -> np.ndarray:
    norm = float(np.linalg.norm(vec))
    return vec / norm if norm > 0 else vec


def build_semantic_space(cat: Catalog) -> SemanticSpace:
    """Fit the TF-IDF + LSA pipeline over the catalogue."""
    documents = [_document(cat.df.iloc[i]) for i in range(cat.size)]

    vectorizer = TfidfVectorizer(
        max_features=settings.TFIDF_MAX_FEATURES,
        ngram_range=(1, 2),
        stop_words="english",
        sublinear_tf=True,
        min_df=2,
    )
    tfidf = vectorizer.fit_transform(documents)

    # SVD cannot produce more components than min(n_samples, n_features) - 1.
    n_components = int(min(settings.SVD_COMPONENTS, min(tfidf.shape) - 1))
    svd = TruncatedSVD(n_components=n_components, random_state=42)
    reduced = svd.fit_transform(tfidf)

    course_vectors = np.vstack([_l2(v) for v in reduced])

    space = SemanticSpace(
        vectorizer=vectorizer,
        svd=svd,
        course_vectors=course_vectors,
        explained_variance=float(svd.explained_variance_ratio_.sum()),
    )

    # ---- track centroids ----
    for track, positions in cat.track_name_index.items():
        space.track_vectors[track] = _l2(course_vectors[positions].mean(axis=0))
    space.track_names = sorted(space.track_vectors)
    space.track_matrix = np.vstack([space.track_vectors[t] for t in space.track_names])

    # ---- career centroids ----
    for career, positions in cat.career_index.items():
        space.career_vectors[career] = _l2(course_vectors[positions].mean(axis=0))

    return space

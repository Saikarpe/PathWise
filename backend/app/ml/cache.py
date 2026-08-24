"""Disk cache for the expensive, deterministic ML artifacts.

``Engine.warm()`` fits a TF-IDF + LSA space, builds the prerequisite graph and
derives the competency model from the course CSV. All four are pure functions
of (CSV contents, a couple of hyperparameters) — so on a machine where nothing
has changed, redoing them on every process start is wasted work. Locally that
is ~11s; on a small shared-CPU host it is minutes, and it is paid again on
every cold start.

The cache is keyed on everything that can change the result — the CSV's own
hash, the two hyperparameters that shape the space, and the library versions
whose pickle formats have to match — so a stale cache can't silently serve
artifacts that disagree with the current data or code.

**A bad cache must never break the app.** Every failure path here (missing
file, unreadable pickle, version skew, key mismatch) falls back to rebuilding
from source rather than raising. The cache is an optimisation, not a
dependency.

Populate it at build time with ``python -m app.ml.build_cache`` so the
artifacts ship inside the deploy image — hosts without a persistent disk
(Render's free tier, for one) discard anything written at runtime, so a
runtime-only cache would never survive to help a cold start.
"""
from __future__ import annotations

import hashlib
import logging
import pickle
from pathlib import Path
from typing import Any

import numpy as np
import sklearn

from app.core.config import BACKEND_DIR, settings

log = logging.getLogger("pathwise.cache")

CACHE_DIR = BACKEND_DIR / ".ml_cache"
CACHE_FILE = CACHE_DIR / "warm_state.pkl"

#: Bump when the *shape* of the cached tuple changes, so an old cache built by
#: a previous version of this module is rejected rather than unpacked wrongly.
CACHE_FORMAT_VERSION = 1


def _file_digest(path: str | Path) -> str:
    """Content hash of the source CSV — the cache's main invalidation trigger."""
    digest = hashlib.sha256()
    try:
        with open(path, "rb") as handle:
            for chunk in iter(lambda: handle.read(1 << 20), b""):
                digest.update(chunk)
    except OSError:
        return "missing"
    return digest.hexdigest()[:16]


def cache_key() -> str:
    """Everything that, if changed, should invalidate the cached artifacts."""
    parts = [
        f"v{CACHE_FORMAT_VERSION}",
        _file_digest(settings.COURSES_CSV),
        f"svd={settings.SVD_COMPONENTS}",
        f"tfidf={settings.TFIDF_MAX_FEATURES}",
        # Pickled sklearn estimators are not guaranteed loadable across
        # versions; numpy shares that caveat for the arrays hanging off them.
        f"sklearn={sklearn.__version__}",
        f"numpy={np.__version__}",
    ]
    return hashlib.sha256("|".join(parts).encode()).hexdigest()[:24]


def load() -> tuple[Any, Any, Any, Any] | None:
    """Return ``(catalog, space, graph, competency)``, or None to rebuild."""
    if not CACHE_FILE.exists():
        return None
    try:
        with open(CACHE_FILE, "rb") as handle:
            payload = pickle.load(handle)
        if payload.get("key") != cache_key():
            log.info("ML cache key mismatch (data or config changed) — rebuilding")
            return None
        artifacts = payload["artifacts"]
        if not isinstance(artifacts, tuple) or len(artifacts) != 4:
            return None
        log.info("loaded ML artifacts from %s", CACHE_FILE)
        return artifacts
    except Exception:
        # Corrupt file, version skew, truncated write — all recoverable by
        # rebuilding, none worth taking the process down for.
        log.warning("ML cache unreadable — rebuilding from source", exc_info=True)
        return None


def save(catalog: Any, space: Any, graph: Any, competency: Any) -> bool:
    """Persist the artifacts. Returns whether it succeeded (never raises)."""
    try:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        payload = {"key": cache_key(), "artifacts": (catalog, space, graph, competency)}
        # Write to a temp file and replace, so an interrupted write can't leave
        # a half-written pickle that the next boot has to discover the hard way.
        tmp = CACHE_FILE.with_suffix(".tmp")
        with open(tmp, "wb") as handle:
            pickle.dump(payload, handle, protocol=pickle.HIGHEST_PROTOCOL)
        tmp.replace(CACHE_FILE)
        log.info("wrote ML cache to %s (%.1f MB)", CACHE_FILE, CACHE_FILE.stat().st_size / 1e6)
        return True
    except Exception:
        log.warning("could not write ML cache — continuing without it", exc_info=True)
        return False

"""Pre-build the ML artifact cache. Run at deploy/build time.

    python -m app.ml.build_cache

Add this to the host's *build* command (not the start command) so the fitted
artifacts are baked into the deploy image:

    pip install -r requirements.txt && python -m app.ml.build_cache

Doing it at build time is what makes it work on hosts with no persistent disk
— anything written at runtime there is discarded when the instance recycles,
so a runtime-only cache would be rebuilt from scratch on every cold start,
which is the exact cost this is meant to remove.
"""
from __future__ import annotations

import logging
import sys
import time

from app.ml import cache
from app.ml.engine import Engine

logging.basicConfig(level=logging.INFO, format="%(levelname)-7s %(name)s  %(message)s")


def main() -> int:
    started = time.perf_counter()
    engine = Engine()
    engine.warm()
    elapsed = time.perf_counter() - started

    if not cache.CACHE_FILE.exists():
        print("ERROR: cache file was not written; a cold start will refit from source.")
        return 1

    size_mb = cache.CACHE_FILE.stat().st_size / 1e6
    print(
        f"\nBuilt ML cache in {elapsed:.1f}s -> {cache.CACHE_FILE} ({size_mb:.1f} MB)\n"
        f"  key      {cache.cache_key()}\n"
        f"  courses  {engine.stats().get('courses')}\n"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())

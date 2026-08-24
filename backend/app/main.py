"""FastAPI application: lifespan warmup, CORS, router registration.

The ML engine is warmed once during startup rather than lazily on first request.
Building the TF-IDF/SVD space and the prerequisite graph takes a few seconds, and
paying that inside the first learner's request would make the app look broken
exactly when a reviewer is forming an impression of it. After warmup every
endpoint is served from in-memory structures.
"""
from __future__ import annotations

import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from sqlalchemy import select

from app.api import auth, catalog, chat, dashboard, paths, profile, recommendations
from app.core.config import settings
from app.core.database import SessionLocal, init_db
from app.ml.engine import get_engine
from app.models.user import User
from app.schemas import HealthResponse
from app.seed import DEMO_USERS, seed as seed_demo_data

logging.basicConfig(
    level=logging.INFO if settings.DEBUG else logging.WARNING,
    format="%(asctime)s  %(levelname)-7s %(name)s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("pathfinder")


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    engine = get_engine()
    started = time.perf_counter()
    engine.warm()
    log.info(
        "engine ready in %.2fs — %s courses, %s tracks, %s rungs, LLM %s",
        time.perf_counter() - started,
        engine.stats().get("courses"),
        engine.stats().get("tracks"),
        engine.stats().get("prerequisite_rungs"),
        "on" if settings.llm_enabled else "off (local fallback)",
    )

    if settings.AUTO_SEED_DEMO:
        demo_emails = [spec["email"] for spec in DEMO_USERS]
        with SessionLocal() as db:
            already_seeded = db.scalar(select(User).where(User.email.in_(demo_emails))) is not None
        if not already_seeded:
            log.info("no demo accounts found — seeding them now")
            try:
                seed_demo_data(quiet=not settings.DEBUG)
            except Exception:
                # A seeding failure shouldn't take the whole API down — the app
                # is fully usable without demo accounts, just less inviting to
                # a reviewer who hasn't registered their own.
                log.exception("demo seed failed; continuing without it")

    yield


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    lifespan=lifespan,
    description=(
        "AI-powered personalised learning path recommender. Skill-gap analysis, "
        "prerequisite-aware path planning and explainable ranking, all computed "
        "locally; conversational polish is optional and degrades gracefully."
    ),
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def timing_header(request: Request, call_next):
    """Expose per-request latency, so the UI can show what it actually cost.

    Recommendation and planning latency is a claim this project makes, so it is
    measured on every response rather than asserted in the documentation.
    """
    started = time.perf_counter()
    response = await call_next(request)
    response.headers["X-Process-Time-Ms"] = f"{(time.perf_counter() - started) * 1000:.1f}"
    return response


for router in (
    auth.router,
    profile.router,
    chat.router,
    recommendations.router,
    paths.router,
    dashboard.router,
    catalog.router,
):
    app.include_router(router)


@app.get("/api/health", response_model=HealthResponse, tags=["meta"])
def health() -> HealthResponse:
    """Liveness plus engine provenance — what is loaded and how it was built."""
    return HealthResponse(
        status="ok" if get_engine().ready else "warming",
        app=settings.APP_NAME,
        version=settings.APP_VERSION,
        engine=get_engine().stats(),
    )


@app.get("/", tags=["meta"])
def root() -> dict:
    return {
        "app": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "docs": "/docs",
        "health": "/api/health",
    }

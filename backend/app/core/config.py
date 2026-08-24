"""Application settings, loaded from environment / .env."""
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(BACKEND_DIR / ".env"), env_file_encoding="utf-8", extra="ignore"
    )

    APP_NAME: str = "PathWise AI"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = True

    # --- storage ---
    DATABASE_URL: str = f"sqlite:///{(BACKEND_DIR / 'pathfinder.db').as_posix()}"
    COURSES_CSV: str = str(BACKEND_DIR / "data" / "engineering_courses_dataset.csv")
    # Seeds the 4 demo learners on startup if none of them exist yet. Matters
    # most on hosts with no persistent disk (Render's free tier, notably) —
    # the SQLite file doesn't survive a redeploy or a sleep/wake cycle there,
    # so shelling in to run `python -m app.seed` by hand (itself a paid-plan
    # feature on Render) would need repeating after every cold start. Demo
    # accounts are already a public, documented feature of this app (see
    # /api/auth/demo-users), so auto-creating them is safe; flip off for a
    # deployment that shouldn't have them at all.
    AUTO_SEED_DEMO: bool = True
    # Cache the fitted TF-IDF/LSA space, prerequisite graph and competency
    # model to disk so a cold start reloads them instead of refitting. See
    # app/ml/cache.py — invalidated automatically by CSV or config changes.
    ML_CACHE_ENABLED: bool = True

    # --- auth ---
    SECRET_KEY: str = "dev-secret-change-me-in-production"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7  # 7 days

    # --- CORS ---
    # 5173/4173 were the old Vite SPA's dev/preview ports; 8080 is the TanStack
    # Start frontend's `vite dev` port (3000 is its common default elsewhere,
    # kept too in case the port picker lands there in a different environment).
    CORS_ORIGINS: str = (
        "http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,"
        "http://localhost:3000,http://127.0.0.1:3000,"
        "http://localhost:8080,http://127.0.0.1:8080"
    )

    # --- optional LLM augmentation ---
    # When ANTHROPIC_API_KEY is absent the app runs entirely on the local ML engine.
    ANTHROPIC_API_KEY: str = ""
    ANTHROPIC_MODEL: str = "claude-sonnet-5"
    LLM_TIMEOUT_SECONDS: float = 30.0
    LLM_MAX_TOKENS: int = 1200

    # --- ML hyperparameters ---
    SVD_COMPONENTS: int = 256
    TFIDF_MAX_FEATURES: int = 40000
    # Bayesian shrinkage strength for course ratings (prior weight in "reviews").
    RATING_PRIOR_WEIGHT: float = 150.0
    # Learning rate for the online per-learner weight updates driven by feedback.
    FEEDBACK_LEARNING_RATE: float = 0.12

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]

    @property
    def llm_enabled(self) -> bool:
        return bool(self.ANTHROPIC_API_KEY.strip())


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()

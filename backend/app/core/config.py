"""Application settings, loaded from environment / .env."""
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(BACKEND_DIR / ".env"), env_file_encoding="utf-8", extra="ignore"
    )

    APP_NAME: str = "PathFinder AI"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = True

    # --- storage ---
    DATABASE_URL: str = f"sqlite:///{(BACKEND_DIR / 'pathfinder.db').as_posix()}"
    COURSES_CSV: str = str(BACKEND_DIR / "data" / "engineering_courses_dataset.csv")

    # --- auth ---
    SECRET_KEY: str = "dev-secret-change-me-in-production"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7  # 7 days

    # --- CORS ---
    CORS_ORIGINS: str = "http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173"

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

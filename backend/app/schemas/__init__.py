"""Request and response schemas.

Deliberately thin. The ML layer already returns well-shaped dictionaries — a
ranked recommendation carries its factor vector, its attribution shares and its
explanation — and re-declaring all of that as nested Pydantic models would add a
second place to change every time a factor is added, with no validation benefit
on the way out. So response models validate the *envelope* and the fields a
client is guaranteed to find, and let the analytic payloads through as ``dict``.

Request models are strict, because those are the untrusted edge: field lengths,
enum membership and numeric bounds are all enforced here rather than in routers.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

EXPERIENCE_LEVELS = ("Beginner", "Intermediate", "Advanced")
FEEDBACK_EVENTS = (
    "like", "dislike", "not_relevant", "completed", "started", "skipped",
    "too_easy", "too_hard",
)
ENROLLMENT_STATUS = ("not_started", "in_progress", "completed", "abandoned")


# --------------------------------------------------------------------------- #
# Auth
# --------------------------------------------------------------------------- #
class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    full_name: str = Field(default="", max_length=120)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class TokenResponse(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_in: int = Field(description="Token lifetime in seconds.")
    user: "UserResponse"


# --------------------------------------------------------------------------- #
# Profile
# --------------------------------------------------------------------------- #
class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: EmailStr
    full_name: str
    onboarded: bool
    experience_level: str
    primary_branch: str | None = None
    target_role: str | None = None
    goal_text: str = ""
    weekly_hours: float
    timeline_weeks: int | None = None
    interests: list[str] = []
    target_skills: list[str] = []
    preferred_formats: list[str] = []
    preferred_providers: list[str] = []
    industry_interests: list[str] = []
    created_at: datetime | None = None


class ProfileUpdateRequest(BaseModel):
    """Every field optional: the onboarding wizard saves incrementally."""

    full_name: str | None = Field(default=None, max_length=120)
    goal_text: str | None = Field(default=None, max_length=2000)
    experience_level: str | None = None
    primary_branch: str | None = Field(default=None, max_length=120)
    target_role: str | None = Field(default=None, max_length=120)
    weekly_hours: float | None = Field(default=None, ge=1, le=80)
    timeline_weeks: int | None = Field(default=None, ge=1, le=260)
    interests: list[str] | None = Field(default=None, max_length=20)
    target_skills: list[str] | None = Field(default=None, max_length=30)
    preferred_formats: list[str] | None = Field(default=None, max_length=10)
    preferred_providers: list[str] | None = Field(default=None, max_length=10)
    industry_interests: list[str] | None = Field(default=None, max_length=15)
    completed_course_ids: list[str] | None = Field(default=None, max_length=200)
    self_assessed_skills: dict[str, float] | None = None

    @field_validator("experience_level")
    @classmethod
    def _known_level(cls, value: str | None) -> str | None:
        if value is not None and value not in EXPERIENCE_LEVELS:
            raise ValueError(f"experience_level must be one of {EXPERIENCE_LEVELS}")
        return value

    @field_validator("self_assessed_skills")
    @classmethod
    def _bounded_proficiency(cls, value: dict[str, float] | None) -> dict[str, float] | None:
        if value is None:
            return None
        if len(value) > 80:
            raise ValueError("at most 80 self-assessed skills")
        for skill, level in value.items():
            if not 0.0 <= float(level) <= 1.0:
                raise ValueError(f"proficiency for '{skill}' must be between 0 and 1")
        return value


class InterpretRequest(BaseModel):
    """Parse-only: shows the learner what the engine understood before planning."""

    text: str = Field(min_length=1, max_length=2000)


# --------------------------------------------------------------------------- #
# Chat
# --------------------------------------------------------------------------- #
class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    session_id: str = Field(default="default", max_length=64)


class ChatResponse(BaseModel):
    reply: str
    intent: str
    intent_confidence: float
    interpretation: dict[str, Any] = {}
    path_id: int | None = None
    recommendations: list[dict[str, Any]] = []
    suggestions: list[str] = []
    source: str = "local"


class ChatMessageResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    role: str
    content: str
    meta: dict[str, Any] = {}
    created_at: datetime | None = None


# --------------------------------------------------------------------------- #
# Recommendations and paths
# --------------------------------------------------------------------------- #
class RecommendationRequest(BaseModel):
    goal_text: str | None = Field(default=None, max_length=2000)
    limit: int = Field(default=10, ge=1, le=40)
    exclude_planned: bool = False


class PathGenerateRequest(BaseModel):
    goal_text: str | None = Field(default=None, max_length=2000)
    title: str | None = Field(default=None, max_length=200)
    #: Preview only — compute the plan and return it without persisting.
    preview: bool = False


class PathItemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    item_type: str
    course_id: str | None = None
    title: str
    phase_index: int
    phase_name: str
    order_index: int
    hours: float
    score: float
    factors: dict[str, float] = {}
    rationale: str = ""
    prerequisite_ids: list[str] = []
    skills: list[str] = []
    status: str = "not_started"


class MilestoneResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    description: str = ""
    phase_index: int
    order_index: int
    target_week: int
    progress_threshold: float
    skills_unlocked: list[str] = []
    required_course_ids: list[str] = []
    achieved: bool = False


class LearningPathResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    goal_text: str = ""
    target_role: str | None = None
    primary_branch: str | None = None
    status: str
    version: int
    total_courses: int
    total_hours: float
    estimated_weeks: int
    tracks: list[str] = []
    plan: dict[str, Any] = {}
    analysis: dict[str, Any] = {}
    created_at: datetime | None = None
    items: list[PathItemResponse] = []
    milestones: list[MilestoneResponse] = []
    explanation: dict[str, Any] = {}


class PathSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    status: str
    version: int
    total_courses: int
    total_hours: float
    estimated_weeks: int
    tracks: list[str] = []
    created_at: datetime | None = None


# --------------------------------------------------------------------------- #
# Progress and feedback
# --------------------------------------------------------------------------- #
class EnrollmentUpdateRequest(BaseModel):
    course_id: str = Field(min_length=1, max_length=64)
    status: str = "in_progress"
    progress_pct: float | None = Field(default=None, ge=0, le=100)
    hours_logged: float | None = Field(default=None, ge=0, le=1000)
    rating: float | None = Field(default=None, ge=1, le=5)

    @field_validator("status")
    @classmethod
    def _known_status(cls, value: str) -> str:
        if value not in ENROLLMENT_STATUS:
            raise ValueError(f"status must be one of {ENROLLMENT_STATUS}")
        return value


class FeedbackRequest(BaseModel):
    event_type: str
    course_id: str | None = Field(default=None, max_length=64)
    path_id: int | None = None
    comment: str = Field(default="", max_length=1000)
    #: Optional attribution vector from the recommendation the learner reacted to.
    #: When omitted the engine recovers it from the stored path item.
    factors: dict[str, float] | None = None

    @field_validator("event_type")
    @classmethod
    def _known_event(cls, value: str) -> str:
        if value not in FEEDBACK_EVENTS:
            raise ValueError(f"event_type must be one of {FEEDBACK_EVENTS}")
        return value


class FeedbackResponse(BaseModel):
    event_type: str
    weights_before: dict[str, float]
    weights_after: dict[str, float]
    weight_deltas: dict[str, float]
    difficulty_bias: float
    update_count: int
    explanation: str


# --------------------------------------------------------------------------- #
# Catalogue and meta
# --------------------------------------------------------------------------- #
class CourseSearchRequest(BaseModel):
    q: str | None = Field(default=None, max_length=200)
    branch: str | None = Field(default=None, max_length=120)
    track: str | None = Field(default=None, max_length=120)
    difficulty: str | None = Field(default=None, max_length=32)
    provider: str | None = Field(default=None, max_length=64)
    limit: int = Field(default=20, ge=1, le=100)


class HealthResponse(BaseModel):
    status: str
    app: str
    version: str
    engine: dict[str, Any]


TokenResponse.model_rebuild()

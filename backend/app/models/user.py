"""Learner account and profile."""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    """A learner: credentials plus the profile that drives recommendations."""

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    full_name: Mapped[str] = mapped_column(String(120), default="")
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)

    # ---- profiling engine fields ----
    experience_level: Mapped[str] = mapped_column(String(32), default="Beginner")
    primary_branch: Mapped[str | None] = mapped_column(String(120), nullable=True)
    target_role: Mapped[str | None] = mapped_column(String(120), nullable=True)

    #: Free-text goal the learner typed, kept verbatim for re-planning.
    goal_text: Mapped[str] = mapped_column(String(1000), default="")

    #: Track / topic names the learner expressed interest in.
    interests: Mapped[list] = mapped_column(JSON, default=list)
    #: Canonical skill names the learner wants to acquire.
    target_skills: Mapped[list] = mapped_column(JSON, default=list)
    #: Delivery formats the learner prefers (e.g. "Interactive Lab").
    preferred_formats: Mapped[list] = mapped_column(JSON, default=list)
    #: Providers the learner favours (e.g. "NPTEL").
    preferred_providers: Mapped[list] = mapped_column(JSON, default=list)
    #: Industry sectors of interest.
    industry_interests: Mapped[list] = mapped_column(JSON, default=list)

    weekly_hours: Mapped[float] = mapped_column(Float, default=8.0)
    timeline_weeks: Mapped[int | None] = mapped_column(Integer, nullable=True)

    onboarded: Mapped[bool] = mapped_column(Boolean, default=False)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )

    skill_states: Mapped[list["SkillState"]] = relationship(
        back_populates="user", cascade="all, delete-orphan", lazy="selectin"
    )

    def profile_dict(self) -> dict:
        """Plain-dict view consumed by the ML engine."""
        return {
            "user_id": self.id,
            "full_name": self.full_name,
            "experience_level": self.experience_level or "Beginner",
            "primary_branch": self.primary_branch,
            "target_role": self.target_role,
            "goal_text": self.goal_text or "",
            "interests": list(self.interests or []),
            "target_skills": list(self.target_skills or []),
            "preferred_formats": list(self.preferred_formats or []),
            "preferred_providers": list(self.preferred_providers or []),
            "industry_interests": list(self.industry_interests or []),
            "weekly_hours": float(self.weekly_hours or 8.0),
            "timeline_weeks": self.timeline_weeks,
            "onboarded": bool(self.onboarded),
        }


class SkillState(Base):
    """Per-learner proficiency in one canonical skill, in [0, 1]."""

    __tablename__ = "skill_states"
    __table_args__ = (UniqueConstraint("user_id", "skill", name="uq_skill_state_user_skill"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    skill: Mapped[str] = mapped_column(String(120), index=True, nullable=False)
    proficiency: Mapped[float] = mapped_column(Float, default=0.0)
    #: "self" (self-assessment) or "earned" (derived from completed courses).
    source: Mapped[str] = mapped_column(String(16), default="self")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )

    user: Mapped["User"] = relationship(back_populates="skill_states")


class LearnerModel(Base):
    """Personalised ranker state, updated online from learner feedback.

    Holds the per-learner factor weight vector plus categorical affinities
    (provider / format / track). Persisting this is what lets recommendations
    adapt across sessions rather than resetting every request.
    """

    __tablename__ = "learner_models"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), unique=True, index=True, nullable=False
    )
    #: {factor_name: weight}
    weights: Mapped[dict] = mapped_column(JSON, default=dict)
    #: {"provider": {name: score}, "format": {...}, "track": {...}}
    affinities: Mapped[dict] = mapped_column(JSON, default=dict)
    #: Shifts the target difficulty band; negative = easier, positive = harder.
    difficulty_bias: Mapped[float] = mapped_column(Float, default=0.0)
    #: Number of feedback events folded into this model.
    update_count: Mapped[int] = mapped_column(Integer, default=0)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )

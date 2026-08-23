"""Learner activity: enrolments, feedback events and chat history."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.user import utcnow


class Enrollment(Base):
    """The learner's real state for one course — the source of truth for progress.

    Kept separate from :class:`~app.models.learning_path.PathItem` because a
    learner can complete a course outside any path (prior history), and a course
    can appear in more than one path.
    """

    __tablename__ = "enrollments"
    __table_args__ = (UniqueConstraint("user_id", "course_id", name="uq_enrollment_user_course"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    course_id: Mapped[str] = mapped_column(String(40), index=True, nullable=False)
    path_id: Mapped[int | None] = mapped_column(
        ForeignKey("learning_paths.id", ondelete="SET NULL"), nullable=True, index=True
    )

    #: "not_started" | "in_progress" | "completed" | "skipped"
    status: Mapped[str] = mapped_column(String(20), default="in_progress", index=True)
    progress_pct: Mapped[float] = mapped_column(Float, default=0.0)
    hours_logged: Mapped[float] = mapped_column(Float, default=0.0)
    #: Learner's own 1-5 rating, used as a feedback signal.
    learner_rating: Mapped[float | None] = mapped_column(Float, nullable=True)

    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=utcnow)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )


class FeedbackEvent(Base):
    """An immutable log of learner reactions that drive online adaptation."""

    __tablename__ = "feedback_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    course_id: Mapped[str | None] = mapped_column(String(40), index=True, nullable=True)
    path_id: Mapped[int | None] = mapped_column(
        ForeignKey("learning_paths.id", ondelete="SET NULL"), nullable=True
    )

    #: like | dislike | too_easy | too_hard | not_relevant | completed | started | skipped
    event_type: Mapped[str] = mapped_column(String(32), index=True, nullable=False)
    #: Signed magnitude applied to the learner model by this event.
    weight: Mapped[float] = mapped_column(Float, default=1.0)
    comment: Mapped[str] = mapped_column(Text, default="")
    #: Snapshot of the ranker factors at recommendation time, enabling credit
    #: assignment: which factors led to an item the learner liked or rejected.
    factors: Mapped[dict] = mapped_column(JSON, default=dict)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


class ChatMessage(Base):
    """One turn of conversation, with the structured interpretation attached."""

    __tablename__ = "chat_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    session_id: Mapped[str] = mapped_column(String(64), index=True, default="default")

    #: "user" | "assistant"
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    content: Mapped[str] = mapped_column(Text, default="")
    #: Intent, extracted entities, generated path id, suggestion chips.
    meta: Mapped[dict] = mapped_column(JSON, default=dict)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)

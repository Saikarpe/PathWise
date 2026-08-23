"""Generated learning paths and their constituent steps."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.user import utcnow


class LearningPath(Base):
    """A generated roadmap for one learner goal.

    ``plan`` holds the fully rendered structure (phases, milestones, projects,
    assessments) so the exact roadmap the learner saw is reproducible even after
    the catalogue or ranker weights change. ``PathItem`` rows mirror the course
    steps relationally so progress can be queried and aggregated.
    """

    __tablename__ = "learning_paths"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )

    title: Mapped[str] = mapped_column(String(200), default="Learning Path")
    goal_text: Mapped[str] = mapped_column(Text, default="")
    target_role: Mapped[str | None] = mapped_column(String(120), nullable=True)
    primary_branch: Mapped[str | None] = mapped_column(String(120), nullable=True)

    #: "active" | "completed" | "archived"
    status: Mapped[str] = mapped_column(String(20), default="active", index=True)
    #: Incremented each time the path is regenerated/adapted for this goal.
    version: Mapped[int] = mapped_column(Integer, default=1)

    total_courses: Mapped[int] = mapped_column(Integer, default=0)
    total_hours: Mapped[float] = mapped_column(Float, default=0.0)
    estimated_weeks: Mapped[int] = mapped_column(Integer, default=0)

    #: Track names covered, ordered by relevance.
    tracks: Mapped[list] = mapped_column(JSON, default=list)
    #: Full rendered roadmap (phases -> steps, milestones, projects, assessments).
    plan: Mapped[dict] = mapped_column(JSON, default=dict)
    #: Goal interpretation + skill-gap analysis + coverage report.
    analysis: Mapped[dict] = mapped_column(JSON, default=dict)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )

    items: Mapped[list["PathItem"]] = relationship(
        back_populates="path",
        cascade="all, delete-orphan",
        lazy="selectin",
        order_by="PathItem.order_index",
    )


class PathItem(Base):
    """One ordered step in a path: a course, a project or an assessment."""

    __tablename__ = "path_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    path_id: Mapped[int] = mapped_column(
        ForeignKey("learning_paths.id", ondelete="CASCADE"), index=True, nullable=False
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )

    #: "course" | "project" | "assessment"
    item_type: Mapped[str] = mapped_column(String(20), default="course")
    #: Catalogue id for courses; synthetic id (e.g. "PRJ-1") otherwise.
    course_id: Mapped[str | None] = mapped_column(String(40), index=True, nullable=True)
    title: Mapped[str] = mapped_column(String(300), default="")

    phase_index: Mapped[int] = mapped_column(Integer, default=0)
    phase_name: Mapped[str] = mapped_column(String(120), default="")
    order_index: Mapped[int] = mapped_column(Integer, default=0)

    hours: Mapped[float] = mapped_column(Float, default=0.0)
    #: Ranker score that put this item in the path.
    score: Mapped[float] = mapped_column(Float, default=0.0)
    #: Per-factor contributions backing the explanation.
    factors: Mapped[dict] = mapped_column(JSON, default=dict)
    #: Human-readable "why this step" text.
    rationale: Mapped[str] = mapped_column(Text, default="")
    #: course_ids this step depends on, from the prerequisite DAG.
    prerequisite_ids: Mapped[list] = mapped_column(JSON, default=list)
    #: Canonical skills this step teaches.
    skills: Mapped[list] = mapped_column(JSON, default=list)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    path: Mapped["LearningPath"] = relationship(back_populates="items")


class Milestone(Base):
    """A checkpoint at a phase boundary, with the skills it certifies."""

    __tablename__ = "milestones"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    path_id: Mapped[int] = mapped_column(
        ForeignKey("learning_paths.id", ondelete="CASCADE"), index=True, nullable=False
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )

    name: Mapped[str] = mapped_column(String(200), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    phase_index: Mapped[int] = mapped_column(Integer, default=0)
    order_index: Mapped[int] = mapped_column(Integer, default=0)
    target_week: Mapped[int] = mapped_column(Integer, default=0)
    #: Fraction of the path complete when this milestone is reached, 0-100.
    progress_threshold: Mapped[float] = mapped_column(Float, default=0.0)
    skills_unlocked: Mapped[list] = mapped_column(JSON, default=list)
    #: course_ids that must be finished to clear the milestone.
    required_course_ids: Mapped[list] = mapped_column(JSON, default=list)
    achieved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

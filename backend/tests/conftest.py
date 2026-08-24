"""Shared fixtures.

The ML engine is warmed once per session and shared: fitting the semantic
space costs seconds, and every test needs the same immutable, read-only
artifacts. Database state is *not* shared — each test gets a fresh in-memory
SQLite so tests can't leak state into one another through persisted rows.
"""
from __future__ import annotations

import pytest
from sqlalchemy import create_engine as sa_create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base
from app.core.security import hash_password
from app.ml.engine import Engine
from app.models.user import User


@pytest.fixture(scope="session")
def engine() -> Engine:
    """A warmed ML engine, shared across the session (read-only after warm)."""
    eng = Engine()
    eng.warm()
    return eng


@pytest.fixture
def db() -> Session:
    """A fresh in-memory database per test."""
    # StaticPool keeps every session on one connection — otherwise each new
    # connection to `:memory:` would open a separate, empty database.
    db_engine = sa_create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(db_engine)
    session = sessionmaker(bind=db_engine, autoflush=False)()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def user(db: Session) -> User:
    """A plain learner with no history — the cold-start case."""
    record = User(
        email="learner@example.com",
        hashed_password=hash_password("testpass123"),
        full_name="Test Learner",
        experience_level="Beginner",
        weekly_hours=10.0,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record

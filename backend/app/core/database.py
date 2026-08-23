"""SQLAlchemy engine, session factory and declarative base."""
from collections.abc import Iterator

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine as SAEngine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import settings

connect_args = {"check_same_thread": False} if settings.DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(settings.DATABASE_URL, connect_args=connect_args, future=True)
SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False, future=True)


@event.listens_for(SAEngine, "connect")
def _enable_sqlite_foreign_keys(dbapi_connection, _record) -> None:
    """Turn on foreign-key enforcement, which SQLite disables by default.

    Without this, ``ON DELETE CASCADE`` is parsed and then ignored: deleting a
    learner leaves their paths, enrolments and feedback behind as orphans. That is
    not merely untidy — SQLite reuses rowids, so the next account created inherits
    the dead rows and appears to have a learning path it never generated. Set per
    connection because the pragma is connection-scoped, and guarded by dialect so
    the same listener is harmless under Postgres.
    """
    if engine.dialect.name != "sqlite":
        return
    cursor = dbapi_connection.cursor()
    try:
        cursor.execute("PRAGMA foreign_keys=ON")
    finally:
        cursor.close()


class Base(DeclarativeBase):
    pass


def get_db() -> Iterator[Session]:
    """FastAPI dependency yielding a scoped database session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    """Create all tables. Safe to call repeatedly."""
    from app import models  # noqa: F401  (registers mappers)

    Base.metadata.create_all(bind=engine)

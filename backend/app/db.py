"""Database engine and session handling."""

from __future__ import annotations

from collections.abc import Iterator

from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker

from .config import get_settings

_settings = get_settings()

_connect_args = {"check_same_thread": False} if _settings.is_sqlite else {}

engine = create_engine(
    _settings.database_url,
    connect_args=_connect_args,
    pool_pre_ping=True,
    future=True,
)


@event.listens_for(engine, "connect")
def _on_connect(dbapi_connection, _connection_record) -> None:
    enable_sqlite_foreign_keys(dbapi_connection)


def enable_sqlite_foreign_keys(dbapi_connection, _connection_record=None) -> None:
    """SQLite ignores ON DELETE CASCADE unless foreign keys are switched on.

    Without this, deleting a Monitor leaves its Checks behind. PostgreSQL
    enforces the constraint itself, and PRAGMA is not valid SQL there, so the
    dialect is checked before touching the connection.

    Takes an optional second argument so it can be registered directly as a
    SQLAlchemy ``connect`` listener.
    """
    if type(dbapi_connection).__module__.split(".")[0] != "sqlite3":
        return

    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db() -> Iterator[Session]:
    """FastAPI dependency yielding a request-scoped session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

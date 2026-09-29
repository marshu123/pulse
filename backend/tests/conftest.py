"""Shared pytest fixtures.

Every test gets an isolated in-memory SQLite database and a client bound to it,
so tests never touch a real database or the network.
"""

from __future__ import annotations

import os
from collections.abc import Iterator

import pytest

os.environ.setdefault("DATABASE_URL", "sqlite://")
os.environ.setdefault("JWT_SECRET", "test-secret")
os.environ.setdefault("SCHEDULER_ENABLED", "0")

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine, event  # noqa: E402
from sqlalchemy.orm import Session, sessionmaker  # noqa: E402

from app import models  # noqa: E402
from app.db import get_db  # noqa: E402
from app.main import create_app  # noqa: E402


@pytest.fixture
def engine():
    # StaticPool keeps one in-memory DB alive across connections.
    from sqlalchemy.pool import StaticPool

    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    # Match production: cascades only work with foreign keys switched on.
    from app.db import enable_sqlite_foreign_keys

    event.listen(engine, "connect", enable_sqlite_foreign_keys)

    models.Base.metadata.create_all(bind=engine)
    yield engine
    event.remove(engine, "connect", enable_sqlite_foreign_keys)
    models.Base.metadata.drop_all(bind=engine)
    engine.dispose()


@pytest.fixture
def db(engine) -> Iterator[Session]:
    Session = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    session = Session()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def client(engine, db) -> Iterator[TestClient]:
    app = create_app()

    def override_get_db() -> Iterator[Session]:
        yield db

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture
def registered(client) -> dict:
    """A registered user plus a ready-to-use auth header."""
    response = client.post(
        "/api/auth/register",
        json={"email": "dev@example.com", "password": "correct-horse-battery"},
    )
    assert response.status_code == 201, response.text
    body = response.json()
    return {
        "user": body["user"],
        "token": body["access_token"],
        "headers": {"Authorization": f"Bearer {body['access_token']}"},
    }

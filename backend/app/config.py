"""Application configuration, read from the environment.

Defaults are chosen so the app runs with no setup at all: a local SQLite file
and a development JWT secret. In production every value is overridden.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from functools import lru_cache


def _bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    try:
        return int(raw)
    except ValueError:
        return default


@dataclass(frozen=True)
class Settings:
    database_url: str = field(
        default_factory=lambda: os.getenv("DATABASE_URL", "sqlite:///./pulse.db")
    )
    jwt_secret: str = field(
        default_factory=lambda: os.getenv("JWT_SECRET", "dev-secret-change-me")
    )
    jwt_algorithm: str = "HS256"
    access_token_minutes: int = field(
        default_factory=lambda: _int("ACCESS_TOKEN_MINUTES", 60 * 24)
    )

    # Probe behaviour
    probe_interval_seconds: int = field(
        default_factory=lambda: _int("PROBE_INTERVAL_SECONDS", 60)
    )
    probe_timeout_seconds: int = field(
        default_factory=lambda: _int("PROBE_TIMEOUT_SECONDS", 10)
    )
    scheduler_enabled: bool = field(
        default_factory=lambda: _bool("SCHEDULER_ENABLED", True)
    )

    # How many recent checks to keep per monitor. Older rows are pruned.
    check_retention: int = field(
        default_factory=lambda: _int("CHECK_RETENTION", 500)
    )

    cors_origins: tuple[str, ...] = field(
        default_factory=lambda: tuple(
            origin.strip()
            for origin in os.getenv("CORS_ORIGINS", "*").split(",")
            if origin.strip()
        )
    )

    @property
    def is_sqlite(self) -> bool:
        return self.database_url.startswith("sqlite")


@lru_cache
def get_settings() -> Settings:
    return Settings()

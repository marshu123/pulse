"""Password hashing and JWT issue/verify.

Isolated in one module so the auth tests can exercise hashing and token
round-trips without touching the database.
"""

from __future__ import annotations

import hashlib
import hmac
import os
from datetime import datetime, timedelta, timezone

import jwt
from jwt import InvalidTokenError

from .config import get_settings

# PBKDF2 keeps the dependency list small and is available in the stdlib.
_PBKDF2_ROUNDS = 260_000


def hash_password(plain: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", plain.encode(), salt, _PBKDF2_ROUNDS)
    return f"pbkdf2_sha256${_PBKDF2_ROUNDS}${salt.hex()}${digest.hex()}"


def verify_password(plain: str, stored: str) -> bool:
    try:
        algorithm, rounds, salt_hex, digest_hex = stored.split("$")
    except ValueError:
        return False

    if algorithm != "pbkdf2_sha256":
        return False

    expected = hashlib.pbkdf2_hmac(
        "sha256", plain.encode(), bytes.fromhex(salt_hex), int(rounds)
    )
    # Constant-time compare so a wrong password cannot be timed out character by
    # character.
    return hmac.compare_digest(expected, bytes.fromhex(digest_hex))


def create_access_token(subject: str) -> str:
    settings = get_settings()
    now = datetime.now(timezone.utc)
    payload = {
        "sub": subject,
        "iat": now,
        "exp": now + timedelta(minutes=settings.access_token_minutes),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> str | None:
    """Return the subject, or None if the token is invalid or expired."""
    settings = get_settings()
    try:
        payload = jwt.decode(
            token, settings.jwt_secret, algorithms=[settings.jwt_algorithm]
        )
    except InvalidTokenError:
        return None
    return payload.get("sub")

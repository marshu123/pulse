"""Password hashing and JWT tests, with no database involved."""

from __future__ import annotations

import pytest

from app.security import (
    create_access_token,
    decode_access_token,
    hash_password,
    verify_password,
)


def test_hash_then_verify_round_trip() -> None:
    stored = hash_password("correct-horse-battery")

    assert verify_password("correct-horse-battery", stored) is True
    assert verify_password("wrong-password", stored) is False


def test_hash_is_salted_so_equal_passwords_differ() -> None:
    first = hash_password("same-password")
    second = hash_password("same-password")

    assert first != second
    assert verify_password("same-password", first)
    assert verify_password("same-password", second)


def test_plaintext_never_appears_in_the_hash() -> None:
    stored = hash_password("correct-horse-battery")

    assert "correct-horse-battery" not in stored


def test_verify_rejects_a_corrupt_hash() -> None:
    assert verify_password("anything", "not-a-valid-hash") is False
    assert verify_password("anything", "") is False


def test_verify_rejects_an_unknown_algorithm() -> None:
    assert verify_password("anything", "md5$1000$aa$bb") is False


def test_token_round_trip() -> None:
    token = create_access_token("42")

    assert decode_access_token(token) == "42"


def test_token_with_a_tampered_payload_is_rejected() -> None:
    token = create_access_token("42")
    head, payload, signature = token.split(".")

    assert decode_access_token(f"{head}.{payload}x.{signature}") is None


def test_malformed_token_is_rejected() -> None:
    assert decode_access_token("") is None
    assert decode_access_token("abc") is None
    assert decode_access_token("a.b.c") is None


def test_token_signed_with_another_secret_is_rejected(monkeypatch) -> None:
    """A token minted under one secret must not validate under another."""
    from app import config, security

    monkeypatch.setenv("JWT_SECRET", "secret-one")
    config.get_settings.cache_clear()
    security.get_settings.cache_clear()
    token = security.create_access_token("42")

    monkeypatch.setenv("JWT_SECRET", "secret-two")
    config.get_settings.cache_clear()
    security.get_settings.cache_clear()

    assert security.decode_access_token(token) is None

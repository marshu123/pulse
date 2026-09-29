"""Auth route tests."""

from __future__ import annotations

from fastapi.testclient import TestClient

PASSWORD = "correct-horse-battery"


def test_register_returns_token_and_user(client: TestClient) -> None:
    response = client.post(
        "/api/auth/register", json={"email": "dev@example.com", "password": PASSWORD}
    )

    assert response.status_code == 201
    body = response.json()
    assert body["token_type"] == "bearer"
    assert body["access_token"]
    assert body["user"]["email"] == "dev@example.com"
    assert "password" not in body["user"]
    assert "hashed_password" not in response.text


def test_register_rejects_duplicate_email(client: TestClient) -> None:
    client.post(
        "/api/auth/register", json={"email": "dev@example.com", "password": PASSWORD}
    )
    response = client.post(
        "/api/auth/register", json={"email": "dev@example.com", "password": PASSWORD}
    )

    assert response.status_code == 409
    assert "already exists" in response.json()["detail"]


def test_register_is_case_insensitive_on_email(client: TestClient) -> None:
    client.post(
        "/api/auth/register", json={"email": "Dev@Example.com", "password": PASSWORD}
    )
    response = client.post(
        "/api/auth/register", json={"email": "dev@example.com", "password": PASSWORD}
    )

    assert response.status_code == 409


def test_register_rejects_short_password(client: TestClient) -> None:
    response = client.post(
        "/api/auth/register", json={"email": "dev@example.com", "password": "short"}
    )

    assert response.status_code == 422


def test_register_rejects_malformed_email(client: TestClient) -> None:
    response = client.post(
        "/api/auth/register", json={"email": "not-an-email", "password": PASSWORD}
    )

    assert response.status_code == 422


def test_login_with_correct_password(client: TestClient) -> None:
    client.post(
        "/api/auth/register", json={"email": "dev@example.com", "password": PASSWORD}
    )
    response = client.post(
        "/api/auth/login", json={"email": "dev@example.com", "password": PASSWORD}
    )

    assert response.status_code == 200
    assert response.json()["access_token"]


def test_login_with_wrong_password_is_unauthorised(client: TestClient) -> None:
    client.post(
        "/api/auth/register", json={"email": "dev@example.com", "password": PASSWORD}
    )
    response = client.post(
        "/api/auth/login", json={"email": "dev@example.com", "password": "wrong"}
    )

    assert response.status_code == 401


def test_login_for_unknown_email_looks_identical_to_wrong_password(
    client: TestClient,
) -> None:
    """The response must not reveal whether an email is registered."""
    client.post(
        "/api/auth/register", json={"email": "dev@example.com", "password": PASSWORD}
    )

    unknown = client.post(
        "/api/auth/login", json={"email": "nobody@example.com", "password": PASSWORD}
    )
    wrong = client.post(
        "/api/auth/login", json={"email": "dev@example.com", "password": "wrong"}
    )

    assert unknown.status_code == wrong.status_code == 401
    assert unknown.json() == wrong.json()


def test_protected_route_requires_a_token(client: TestClient) -> None:
    assert client.get("/api/monitors").status_code == 401


def test_protected_route_rejects_a_garbage_token(client: TestClient) -> None:
    response = client.get(
        "/api/monitors", headers={"Authorization": "Bearer not-a-real-token"}
    )

    assert response.status_code == 401


def test_protected_route_rejects_a_token_for_a_deleted_user(
    client, db, registered
) -> None:
    from app.models import User

    user = db.get(User, registered["user"]["id"])
    db.delete(user)
    db.commit()

    response = client.get("/api/monitors", headers=registered["headers"])

    assert response.status_code == 401

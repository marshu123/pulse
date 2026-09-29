"""Monitor route tests.

Probing is stubbed so no test makes a real network request.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models import Check
from app.probe import ProbeResult

OK_RESULT = ProbeResult(ok=True, status_code=200, latency_ms=120.5, error=None)
DOWN_RESULT = ProbeResult(ok=False, status_code=None, latency_ms=90.0, error="timeout")


@pytest.fixture(autouse=True)
def stub_probe(monkeypatch):
    """Every route that probes records a success unless a test says otherwise."""
    monkeypatch.setattr("app.routers.monitors.probe", lambda *a, **k: OK_RESULT)
    return monkeypatch


def _create(client: TestClient, headers: dict, **overrides) -> dict:
    payload = {
        "name": "Example",
        "url": "https://example.com",
        "interval_seconds": 300,
        **overrides,
    }
    response = client.post("/api/monitors", json=payload, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()


def test_create_monitor_probes_immediately(client, registered) -> None:
    monitor = _create(client, registered["headers"])

    assert monitor["name"] == "Example"
    assert monitor["active"] is True

    summary = client.get("/api/monitors", headers=registered["headers"]).json()
    assert len(summary) == 1
    assert summary[0]["total_checks"] == 1
    assert summary[0]["last_status"] == "up"


def test_create_monitor_adds_a_scheme_to_a_bare_host(client, registered) -> None:
    monitor = _create(client, registered["headers"], url="example.com")

    assert monitor["url"] == "https://example.com"


def test_create_monitor_rejects_a_non_http_url(client, registered) -> None:
    response = client.post(
        "/api/monitors",
        json={"name": "Bad", "url": "javascript:alert(1)"},
        headers=registered["headers"],
    )

    assert response.status_code == 422


def test_create_monitor_rejects_a_blank_name(client, registered) -> None:
    response = client.post(
        "/api/monitors",
        json={"name": "   ", "url": "https://example.com"},
        headers=registered["headers"],
    )

    assert response.status_code == 422


def test_create_monitor_rejects_a_tiny_interval(client, registered) -> None:
    response = client.post(
        "/api/monitors",
        json={"name": "X", "url": "https://example.com", "interval_seconds": 1},
        headers=registered["headers"],
    )

    assert response.status_code == 422


def test_create_monitor_requires_auth(client) -> None:
    response = client.post(
        "/api/monitors", json={"name": "X", "url": "https://example.com"}
    )

    assert response.status_code == 401


def test_list_returns_one_summary_per_monitor(client, registered) -> None:
    _create(client, registered["headers"], name="A", url="a.example.com")
    _create(client, registered["headers"], name="B", url="b.example.com")

    summary = client.get("/api/monitors", headers=registered["headers"]).json()

    assert len(summary) == 2
    assert {s["name"] for s in summary} == {"A", "B"}


def test_monitors_are_scoped_to_their_owner(client, registered, db: Session) -> None:
    from app.models import User

    mine = _create(client, registered["headers"], name="Mine")

    other = User(email="other@example.com", hashed_password="x")
    db.add(other)
    db.commit()

    stolen = client.get(
        f"/api/monitors/{mine['id']}",
        headers={"Authorization": "Bearer not-their-token"},
    )
    assert stolen.status_code == 401

    theirs = client.post(
        "/api/auth/register",
        json={"email": "their@example.com", "password": "correct-horse-battery"},
    )
    their_headers = {
        "Authorization": f"Bearer {theirs.json()['access_token']}"
    }

    response = client.get(f"/api/monitors/{mine['id']}", headers=their_headers)
    assert response.status_code == 404


def test_update_monitor(client, registered) -> None:
    monitor = _create(client, registered["headers"])

    response = client.patch(
        f"/api/monitors/{monitor['id']}",
        json={"name": "Renamed", "active": False},
        headers=registered["headers"],
    )

    assert response.status_code == 200
    assert response.json()["name"] == "Renamed"
    assert response.json()["active"] is False


def test_update_rejects_a_non_http_url(client, registered) -> None:
    monitor = _create(client, registered["headers"])

    response = client.patch(
        f"/api/monitors/{monitor['id']}",
        json={"url": "file:///etc/passwd"},
        headers=registered["headers"],
    )

    assert response.status_code == 422


def test_delete_monitor_removes_it_and_its_checks(client, registered, db: Session) -> None:
    monitor = _create(client, registered["headers"])

    response = client.delete(
        f"/api/monitors/{monitor['id']}", headers=registered["headers"]
    )

    assert response.status_code == 204
    assert client.get("/api/monitors", headers=registered["headers"]).json() == []
    assert db.query(Check).filter(Check.monitor_id == monitor["id"]).count() == 0


def test_delete_unknown_monitor_is_404(client, registered) -> None:
    response = client.delete("/api/monitors/9999", headers=registered["headers"])

    assert response.status_code == 404


def test_run_check_records_a_result(client, registered) -> None:
    monitor = _create(client, registered["headers"])

    response = client.post(
        f"/api/monitors/{monitor['id']}/check", headers=registered["headers"]
    )

    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["latency_ms"] == 120.5


def test_run_check_records_a_failure(client, registered, monkeypatch) -> None:
    monkeypatch.setattr("app.routers.monitors.probe", lambda *a, **k: DOWN_RESULT)
    monitor = _create(client, registered["headers"])

    client.post(f"/api/monitors/{monitor['id']}/check", headers=registered["headers"])

    summary = client.get("/api/monitors", headers=registered["headers"]).json()
    assert summary[0]["last_status"] == "down"


def test_series_returns_points_in_time_order(client, registered, db: Session) -> None:
    from datetime import datetime, timedelta, timezone

    monitor = _create(client, registered["headers"])

    # Creating a monitor probes it once, so drop that row and control the set.
    db.query(Check).filter(Check.monitor_id == monitor["id"]).delete()
    db.commit()

    now = datetime.now(timezone.utc)
    for offset in (3, 1, 2):
        db.add(
            Check(
                monitor_id=monitor["id"],
                ok=True,
                latency_ms=100.0 + offset,
                status_code=200,
                checked_at=now - timedelta(hours=offset),
            )
        )
    db.commit()

    response = client.get(
        f"/api/monitors/{monitor['id']}/series?window=24h",
        headers=registered["headers"],
    )

    assert response.status_code == 200
    body = response.json()
    assert body["total_checks"] == 3
    assert body["uptime_percent"] == 100.0
    timestamps = [p["checked_at"] for p in body["points"]]
    assert timestamps == sorted(timestamps)


def test_series_rejects_an_unknown_window(client, registered) -> None:
    monitor = _create(client, registered["headers"])

    response = client.get(
        f"/api/monitors/{monitor['id']}/series?window=99y",
        headers=registered["headers"],
    )

    assert response.status_code == 422


def test_series_for_a_monitor_with_no_checks_is_empty_not_an_error(
    client, registered, db: Session, monkeypatch
) -> None:
    monkeypatch.setattr("app.routers.monitors.probe", lambda *a, **k: OK_RESULT)
    monitor = _create(client, registered["headers"])
    db.query(Check).filter(Check.monitor_id == monitor["id"]).delete()
    db.commit()

    body = client.get(
        f"/api/monitors/{monitor['id']}/series", headers=registered["headers"]
    ).json()

    assert body["total_checks"] == 0
    assert body["uptime_percent"] is None
    assert body["points"] == []


def test_health_endpoint_needs_no_auth(client) -> None:
    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_openapi_schema_is_valid(client) -> None:
    """Guards against a route signature that cannot be serialised."""
    response = client.get("/openapi.json")

    assert response.status_code == 200
    assert "/api/monitors" in response.json()["paths"]

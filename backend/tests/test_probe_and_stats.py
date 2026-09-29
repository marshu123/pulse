"""Probe and stats tests. The network is never touched."""

from __future__ import annotations

import urllib.error
from datetime import datetime, timedelta, timezone

import pytest

from app.probe import is_valid_url, normalise_url, probe
from app.stats import MonitorSummary, percentile, prune_checks, summarise, uptime_percent
from app.models import Check, Monitor, User


class _FakeResponse:
    def __init__(self, status: int = 200) -> None:
        self.status = status

    def read(self, _n: int = 0) -> bytes:
        return b"ok"

    def __enter__(self):
        return self

    def __exit__(self, *_: object) -> None:
        return None


# ---------------------------------------------------------------- url parsing


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("example.com", "https://example.com"),
        ("https://example.com", "https://example.com"),
        ("http://example.com/x", "http://example.com/x"),
        ("  example.com  ", "https://example.com"),
    ],
)
def test_normalise_url(raw: str, expected: str) -> None:
    assert normalise_url(raw) == expected


@pytest.mark.parametrize(
    "url,valid",
    [
        ("https://example.com", True),
        ("http://example.com", True),
        ("ftp://example.com", False),
        ("javascript:alert(1)", False),
        ("not a url", False),
        ("", False),
    ],
)
def test_is_valid_url(url: str, valid: bool) -> None:
    assert is_valid_url(url) is valid


# -------------------------------------------------------------------- probing


def test_probe_success(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.probe.urllib.request.urlopen", lambda *a, **k: _FakeResponse(200)
    )

    result = probe("https://example.com")

    assert result.ok is True
    assert result.status_code == 200
    assert result.latency_ms >= 0
    assert result.error is None


def test_probe_treats_3xx_as_up(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.probe.urllib.request.urlopen", lambda *a, **k: _FakeResponse(301)
    )

    assert probe("https://example.com").ok is True


def test_probe_treats_4xx_as_down(monkeypatch) -> None:
    def _raise(*_a, **_k):
        raise urllib.error.HTTPError(
            "https://example.com", 404, "Not Found", None, None
        )

    monkeypatch.setattr("app.probe.urllib.request.urlopen", _raise)

    result = probe("https://example.com")

    assert result.ok is False
    assert result.status_code == 404
    assert result.error == "HTTP 404"


def test_probe_reports_network_failure(monkeypatch) -> None:
    def _raise(*_a, **_k):
        raise urllib.error.URLError("name resolution failed")

    monkeypatch.setattr("app.probe.urllib.request.urlopen", _raise)

    result = probe("https://nope.invalid")

    assert result.ok is False
    assert result.status_code is None
    assert "resolution" in (result.error or "")


def test_probe_never_raises(monkeypatch) -> None:
    """A probe must record a failure, not take down the scheduler."""

    def _raise(*_a, **_k):
        raise RuntimeError("something unexpected")

    monkeypatch.setattr("app.probe.urllib.request.urlopen", _raise)

    result = probe("https://example.com")

    assert result.ok is False
    assert result.error == "RuntimeError"


# ---------------------------------------------------------------------- stats


@pytest.mark.parametrize(
    "successful,total,expected",
    [(0, 0, None), (5, 5, 100.0), (0, 4, 0.0), (1, 3, 33.33), (2, 3, 66.67)],
)
def test_uptime_percent(successful: int, total: int, expected: float | None) -> None:
    assert uptime_percent(successful, total) == expected


def test_percentile_of_empty_list_is_none() -> None:
    assert percentile([], 0.95) is None


def test_percentile_picks_the_right_value() -> None:
    values = [float(n) for n in range(1, 101)]

    assert percentile(values, 0.5) == 50.0
    assert percentile(values, 0.95) == 95.0
    assert percentile(values, 1.0) == 100.0


def _user() -> User:
    return User(id=1, email="owner@example.com", hashed_password="x")


def _monitor() -> Monitor:
    return Monitor(id=1, user_id=1, name="Example", url="https://example.com")


def _check(ok: bool, latency: float, minutes_ago: int = 0) -> Check:
    return Check(
        monitor_id=1,
        ok=ok,
        latency_ms=latency,
        status_code=200 if ok else 500,
        checked_at=datetime.now(timezone.utc) - timedelta(minutes=minutes_ago),
    )


def test_summarise_with_no_checks_reports_none_not_zero() -> None:
    summary = summarise(_monitor(), [])

    assert summary.uptime_percent is None
    assert summary.last_status is None
    assert summary.avg_latency_ms is None
    assert summary.in_incident is False


def test_summarise_computes_uptime_and_latency() -> None:
    checks = [
        _check(True, 100.0, minutes_ago=3),
        _check(True, 200.0, minutes_ago=2),
        _check(True, 300.0, minutes_ago=1),
        _check(False, 0.0, minutes_ago=0),
    ]

    summary = summarise(_monitor(), checks)

    assert summary.total_checks == 4
    assert summary.successful_checks == 3
    assert summary.uptime_percent == 75.0
    assert summary.avg_latency_ms == 200.0
    assert summary.p95_latency_ms == 300.0


def test_summarise_flags_a_recent_failure_as_an_incident() -> None:
    checks = [
        _check(True, 100.0, minutes_ago=40),
        _check(False, 0.0, minutes_ago=1),
    ]

    assert summarise(_monitor(), checks).in_incident is True


def test_summarise_ignores_an_old_failure() -> None:
    """A blip from an hour ago should not read as a current incident."""
    checks = [
        _check(False, 0.0, minutes_ago=59),
        _check(True, 120.0, minutes_ago=2),
    ]

    summary = summarise(_monitor(), checks)

    assert summary.in_incident is False
    assert summary.last_status == "up"


def test_prune_checks_keeps_only_the_newest(db) -> None:
    owner = _user()
    db.add(owner)
    db.commit()

    monitor = Monitor(user_id=owner.id, name="Example", url="https://example.com")
    db.add(monitor)
    db.commit()

    for n in range(10):
        db.add(_check(True, float(n), minutes_ago=10 - n))
    db.commit()

    removed = prune_checks(db, monitor.id, keep=3)
    db.commit()

    remaining = db.query(Check).filter(Check.monitor_id == monitor.id).count()
    assert removed == 7
    assert remaining == 3


def test_prune_checks_on_an_empty_monitor_is_a_noop(db) -> None:
    assert prune_checks(db, 999, keep=5) == 0


def test_summary_dataclass_defaults() -> None:
    summary = MonitorSummary(
        monitor_id=1,
        name="x",
        url="https://x.example",
        active=True,
        total_checks=0,
        successful_checks=0,
        uptime_percent=None,
        last_status=None,
        last_checked_at=None,
        avg_latency_ms=None,
        p95_latency_ms=None,
        in_incident=False,
    )

    assert summary.uptime_percent is None

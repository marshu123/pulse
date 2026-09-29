"""Turning raw Check rows into the numbers the dashboard shows.

Kept separate from the routes so the arithmetic can be tested directly.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, desc, func, select
from sqlalchemy.orm import Session

from .models import Check, Monitor

# A check counts as a "recent failure" for incident detection if it is within
# this window of the newest check.
INCIDENT_WINDOW_MINUTES = 15


@dataclass
class MonitorSummary:
    monitor_id: int
    name: str
    url: str
    active: bool
    total_checks: int
    successful_checks: int
    uptime_percent: float | None
    last_status: str | None
    last_checked_at: datetime | None
    avg_latency_ms: float | None
    p95_latency_ms: float | None
    in_incident: bool


def uptime_percent(successful: int, total: int) -> float | None:
    """None rather than 0.0 when there is nothing to measure, so the UI can say
    'no data yet' instead of '0% uptime'."""
    if total == 0:
        return None
    return round(successful / total * 100, 2)


def percentile(values: list[float], fraction: float) -> float | None:
    """Nearest-rank percentile: index = ceil(p * n) - 1. Small and dependency free."""
    if not values:
        return None
    ordered = sorted(values)
    index = math.ceil(fraction * len(ordered)) - 1
    return round(ordered[min(max(index, 0), len(ordered) - 1)], 2)


def summarise(monitor: Monitor, checks: list[Check]) -> MonitorSummary:
    # Sort here rather than trusting the caller, so the incident window and the
    # "latest" fields cannot be wrong because a query returned rows in a
    # different order.
    ordered = sorted(
        checks,
        key=lambda c: c.checked_at or datetime.min.replace(tzinfo=timezone.utc),
        reverse=True,
    )

    total = len(ordered)
    successful = sum(1 for check in ordered if check.ok)
    # Only successful checks contribute a latency. A probe that errored has no
    # meaningful response time, and its near-zero value would drag the average
    # down and make the endpoint look faster than it is.
    latencies = [c.latency_ms for c in ordered if c.ok and c.latency_ms is not None]
    newest = ordered[0] if ordered else None

    incident = False
    if newest is not None and newest.checked_at is not None:
        cutoff = newest.checked_at - timedelta(minutes=INCIDENT_WINDOW_MINUTES)
        recent = [c for c in ordered if c.checked_at and c.checked_at >= cutoff]
        if recent and not recent[0].ok:
            incident = True

    if newest is None:
        status = None
    elif newest.ok:
        status = "up"
    else:
        status = "down"

    return MonitorSummary(
        monitor_id=monitor.id,
        name=monitor.name,
        url=monitor.url,
        active=monitor.active,
        total_checks=total,
        successful_checks=successful,
        uptime_percent=uptime_percent(successful, total),
        last_status=status,
        last_checked_at=newest.checked_at if newest else None,
        avg_latency_ms=(
            round(sum(latencies) / len(latencies), 2) if latencies else None
        ),
        p95_latency_ms=percentile(latencies, 0.95),
        in_incident=incident,
    )


def load_summaries(
    db: Session, user_id: int, limit: int = 200
) -> list[MonitorSummary]:
    """One summary per monitor, using the most recent `limit` checks each."""
    monitors = db.scalars(
        select(Monitor).where(Monitor.user_id == user_id).order_by(Monitor.id)
    ).all()

    summaries: list[MonitorSummary] = []
    for monitor in monitors:
        checks = db.scalars(
            select(Check)
            .where(Check.monitor_id == monitor.id)
            .order_by(desc(Check.checked_at), desc(Check.id))
            .limit(limit)
        ).all()
        summaries.append(summarise(monitor, list(checks)))
    return summaries


def prune_checks(db: Session, monitor_id: int, keep: int) -> int:
    """Keep only the newest `keep` checks for a monitor. Returns rows removed."""
    keep_ids = db.scalars(
        select(Check.id)
        .where(Check.monitor_id == monitor_id)
        .order_by(desc(Check.checked_at), desc(Check.id))
        .limit(keep)
    ).all()
    if not keep_ids:
        return 0

    result = db.execute(
        delete(Check).where(
            Check.monitor_id == monitor_id, Check.id.notin_(keep_ids)
        )
    )
    return result.rowcount or 0


def window_start(window: str) -> datetime:
    """Map a named window onto a start datetime."""
    now = datetime.now(timezone.utc)
    hours = {
        "1h": 1,
        "6h": 6,
        "24h": 24,
        "7d": 24 * 7,
        "30d": 24 * 30,
    }.get(window)
    if hours is None:
        raise ValueError(f"unsupported window: {window}")
    return now - timedelta(hours=hours)

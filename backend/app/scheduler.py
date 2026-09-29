"""The background probe loop.

Runs as an asyncio task on the FastAPI lifespan. Every tick it looks for active
monitors that are due and probes them.

Deliberately single-process and in-process: this is the smallest thing that
works reliably. Running more than one replica would mean two schedulers writing
the same checks, which the notes in the README call out as the thing to replace
with a real queue first.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from sqlalchemy import select

from .config import get_settings
from .db import SessionLocal
from .models import Check, Monitor
from .probe import probe
from .stats import prune_checks

log = logging.getLogger("pulse.scheduler")

# Never spend more than this fraction of a tick on probing, so a slow endpoint
# cannot starve the loop.
TICK_BUDGET_SECONDS = 0.7


def due_monitors(now: datetime) -> list[Monitor]:
    """Active monitors whose interval has elapsed since their last check."""
    settings = get_settings()
    candidates = SessionLocal().scalars(
        select(Monitor).where(Monitor.active.is_(True))
    ).all()

    due: list[Monitor] = []
    for monitor in candidates:
        latest = SessionLocal().scalars(
            select(Check)
            .where(Check.monitor_id == monitor.id)
            .order_by(Check.checked_at.desc(), Check.id.desc())
            .limit(1)
        ).first()

        if latest is None:
            due.append(monitor)
            continue

        checked_at = latest.checked_at
        if checked_at is None:
            due.append(monitor)
            continue

        if checked_at.tzinfo is None:
            checked_at = checked_at.replace(tzinfo=timezone.utc)

        elapsed = (now - checked_at).total_seconds()
        if elapsed >= min(monitor.interval_seconds, settings.probe_interval_seconds):
            due.append(monitor)

    return due


async def tick() -> None:
    settings = get_settings()
    now = datetime.now(timezone.utc)
    deadline = asyncio.get_running_loop().time() + TICK_BUDGET_SECONDS

    monitors = due_monitors(now)
    if not monitors:
        return

    for monitor in monitors:
        if asyncio.get_running_loop().time() >= deadline:
            log.info("tick budget spent, deferring %d monitors", len(monitors))
            break

        result = await asyncio.to_thread(
            probe, monitor.url, settings.probe_timeout_seconds
        )

        db = SessionLocal()
        try:
            db.add(
                Check(
                    monitor_id=monitor.id,
                    status_code=result.status_code,
                    latency_ms=result.latency_ms,
                    ok=result.ok,
                    error=result.error,
                )
            )
            db.commit()
            prune_checks(db, monitor.id, settings.check_retention)
            db.commit()
        except Exception:  # noqa: BLE001
            log.exception("failed to record check for monitor %s", monitor.id)
            db.rollback()
        finally:
            db.close()


async def run_forever() -> None:
    settings = get_settings()
    log.info(
        "scheduler started, interval %ss", settings.probe_interval_seconds
    )
    while True:
        try:
            await tick()
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001
            log.exception("scheduler tick failed")
        await asyncio.sleep(settings.probe_interval_seconds)

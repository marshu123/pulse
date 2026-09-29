"""Monitor routes: CRUD plus an on-demand probe and the stats the UI charts."""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..deps import get_current_user
from ..models import Check, Monitor, User
from ..probe import is_valid_url, normalise_url, probe
from ..stats import (
    load_summaries,
    percentile,
    prune_checks,
    uptime_percent,
    window_start,
)

router = APIRouter(prefix="/api/monitors", tags=["monitors"])


class MonitorCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    url: str = Field(min_length=3, max_length=2048)
    interval_seconds: int = Field(default=300, ge=30, le=86_400)

    @field_validator("url")
    @classmethod
    def _check_url(cls, value: str) -> str:
        url = normalise_url(value)
        if not is_valid_url(url):
            raise ValueError("url must be a valid http or https address")
        return url

    @field_validator("name")
    @classmethod
    def _trim_name(cls, value: str) -> str:
        trimmed = value.strip()
        if not trimmed:
            raise ValueError("name cannot be blank")
        return trimmed


class MonitorUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    url: str | None = Field(default=None, min_length=3, max_length=2048)
    interval_seconds: int | None = Field(default=None, ge=30, le=86_400)
    active: bool | None = None


class MonitorResponse(BaseModel):
    id: int
    name: str
    url: str
    interval_seconds: int
    active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class SummaryResponse(BaseModel):
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


class CheckResponse(BaseModel):
    id: int
    status_code: int | None
    latency_ms: float | None
    ok: bool
    error: str | None
    checked_at: datetime

    model_config = {"from_attributes": True}


class SeriesPoint(BaseModel):
    checked_at: datetime
    latency_ms: float | None
    ok: bool
    status_code: int | None


class SeriesResponse(BaseModel):
    monitor_id: int
    window: str
    uptime_percent: float | None
    avg_latency_ms: float | None
    p95_latency_ms: float | None
    total_checks: int
    points: list[SeriesPoint]


def _owned_monitor(db: Session, user: User, monitor_id: int) -> Monitor:
    monitor = db.get(Monitor, monitor_id)
    # 404 rather than 403 so a user cannot probe for the existence of another
    # account's monitor ids.
    if monitor is None or monitor.user_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Monitor not found"
        )
    return monitor


@router.get("", response_model=list[SummaryResponse])
def list_monitors(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> list[SummaryResponse]:
    return [SummaryResponse(**s.__dict__) for s in load_summaries(db, user.id)]


@router.post("", response_model=MonitorResponse, status_code=status.HTTP_201_CREATED)
def create_monitor(
    payload: MonitorCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Monitor:
    monitor = Monitor(
        user_id=user.id,
        name=payload.name,
        url=payload.url,
        interval_seconds=payload.interval_seconds,
    )
    db.add(monitor)
    db.commit()
    db.refresh(monitor)

    # Probe immediately so the new monitor is not blank until the first tick.
    settings = get_settings()
    result = probe(monitor.url, timeout=settings.probe_timeout_seconds)
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
    db.refresh(monitor)
    return monitor


@router.get("/{monitor_id}", response_model=MonitorResponse)
def read_monitor(
    monitor_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Monitor:
    return _owned_monitor(db, user, monitor_id)


@router.patch("/{monitor_id}", response_model=MonitorResponse)
def update_monitor(
    monitor_id: int,
    payload: MonitorUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Monitor:
    monitor = _owned_monitor(db, user, monitor_id)
    data = payload.model_dump(exclude_unset=True)

    if "url" in data and data["url"] is not None:
        url = normalise_url(data["url"])
        if not is_valid_url(url):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="url must be a valid http or https address",
            )
        data["url"] = url

    if "name" in data and data["name"] is not None:
        name = data["name"].strip()
        if not name:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="name cannot be blank",
            )
        data["name"] = name

    for field, value in data.items():
        setattr(monitor, field, value)

    db.commit()
    db.refresh(monitor)
    return monitor


@router.delete(
    "/{monitor_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_model=None,
)
def delete_monitor(
    monitor_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    monitor = _owned_monitor(db, user, monitor_id)
    db.delete(monitor)
    db.commit()


@router.post("/{monitor_id}/check", response_model=CheckResponse)
def run_check(
    monitor_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Check:
    """Probe now instead of waiting for the next scheduled tick."""
    monitor = _owned_monitor(db, user, monitor_id)
    settings = get_settings()

    result = probe(monitor.url, timeout=settings.probe_timeout_seconds)
    check = Check(
        monitor_id=monitor.id,
        status_code=result.status_code,
        latency_ms=result.latency_ms,
        ok=result.ok,
        error=result.error,
    )
    db.add(check)
    db.commit()
    prune_checks(db, monitor.id, settings.check_retention)
    db.commit()
    db.refresh(check)
    return check


@router.get("/{monitor_id}/series", response_model=SeriesResponse)
def read_series(
    monitor_id: int,
    window: str = Query(default="24h"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SeriesResponse:
    monitor = _owned_monitor(db, user, monitor_id)

    try:
        since = window_start(window)
    except ValueError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(error)
        )

    checks = list(
        db.scalars(
            select(Check)
            .where(Check.monitor_id == monitor.id, Check.checked_at >= since)
            .order_by(Check.checked_at)
        ).all()
    )

    # See stats.summarise: failed probes have no meaningful response time.
    latencies = [c.latency_ms for c in checks if c.ok and c.latency_ms is not None]
    successful = sum(1 for c in checks if c.ok)

    return SeriesResponse(
        monitor_id=monitor.id,
        window=window,
        uptime_percent=uptime_percent(successful, len(checks)),
        avg_latency_ms=(
            round(sum(latencies) / len(latencies), 2) if latencies else None
        ),
        p95_latency_ms=percentile(latencies, 0.95),
        total_checks=len(checks),
        points=[
            SeriesPoint(
                checked_at=c.checked_at,
                latency_ms=c.latency_ms,
                ok=c.ok,
                status_code=c.status_code,
            )
            for c in checks
        ],
    )

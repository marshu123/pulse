"""Pulse API application factory."""

from __future__ import annotations

import asyncio
import contextlib
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .db import engine
from .models import Base
from .routers import auth, monitors
from .scheduler import run_forever

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s"
)
log = logging.getLogger("pulse")


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    Base.metadata.create_all(bind=engine)

    task: asyncio.Task | None = None
    if settings.scheduler_enabled:
        task = asyncio.create_task(run_forever())

    try:
        yield
    finally:
        if task is not None:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title="Pulse API",
        description=(
            "Uptime monitoring. Register a URL, Pulse probes it on a schedule "
            "and records response times so you can see when something broke."
        ),
        version="1.0.0",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(auth.router)
    app.include_router(monitors.router)

    @app.get("/api/health", tags=["meta"])
    def health() -> dict[str, str]:
        return {"status": "ok", "version": app.version}

    return app


app = create_app()

"""The probe: make one HTTP request and turn it into a Check result.

Deliberately uses the stdlib rather than httpx. It keeps the dependency list
small, and it means a probe cannot be broken by an upstream library release.
"""

from __future__ import annotations

import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from urllib.parse import urlsplit

# Anything at or above this is a failure. 3xx is fine, 4xx is not.
FAILURE_STATUS_MIN = 400
MAX_BODY_BYTES = 1024


@dataclass
class ProbeResult:
    ok: bool
    status_code: int | None
    latency_ms: float
    error: str | None = None


def normalise_url(url: str) -> str:
    """Add a scheme if the user pasted a bare host."""
    url = url.strip()
    if not url:
        return url
    if not urlsplit(url).scheme:
        return f"https://{url}"
    return url


def is_valid_url(url: str) -> bool:
    try:
        parts = urlsplit(url)
    except ValueError:
        return False
    return parts.scheme in {"http", "https"} and bool(parts.netloc)


def probe(url: str, timeout: float = 10.0) -> ProbeResult:
    """Issue a single GET and measure how long the response takes."""
    request = urllib.request.Request(
        url,
        method="GET",
        headers={
            # Identify ourselves honestly rather than impersonating a browser.
            "User-Agent": "Pulse/1.0 (+https://github.com/marshu123)",
            "Accept": "*/*",
        },
    )

    started = time.perf_counter()
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            status = response.status
            # Read a little so we measure transfer, not just headers.
            response.read(MAX_BODY_BYTES)
    except urllib.error.HTTPError as error:
        latency = (time.perf_counter() - started) * 1000
        return ProbeResult(
            ok=False,
            status_code=error.code,
            latency_ms=round(latency, 2),
            error=f"HTTP {error.code}",
        )
    except urllib.error.URLError as error:
        latency = (time.perf_counter() - started) * 1000
        return ProbeResult(
            ok=False,
            status_code=None,
            latency_ms=round(latency, 2),
            error=str(error.reason),
        )
    except Exception as error:  # noqa: BLE001 - a probe must never crash the loop
        latency = (time.perf_counter() - started) * 1000
        return ProbeResult(
            ok=False,
            status_code=None,
            latency_ms=round(latency, 2),
            error=error.__class__.__name__,
        )

    latency = (time.perf_counter() - started) * 1000
    return ProbeResult(
        ok=status < FAILURE_STATUS_MIN,
        status_code=status,
        latency_ms=round(latency, 2),
        error=None if status < FAILURE_STATUS_MIN else f"HTTP {status}",
    )

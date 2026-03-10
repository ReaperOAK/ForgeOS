"""Metrics collection for the ForgeOS MCP Server.

Provides in-process metrics collection for monitoring MCP server health,
performance, and operational characteristics.  Tracks:

- **Request counters** — total requests by tool name and status.
- **Request latency** — histogram with p50, p95, p99 per tool name.
- **Active sessions** — gauge of currently connected agents.
- **Claim metrics** — success/failure/expired counts per interval.
- **Database query duration** — histogram per operation type (read/write).

Metrics are exposed via :func:`get_metrics_snapshot` (for ``/metrics``
endpoint or structured log output) and can be periodically emitted as
structured JSON log lines via :func:`emit_metrics_log`.

Design decisions
----------------
* **Zero external dependencies** — uses stdlib only (``time``, ``threading``).
  No Prometheus client library required; the system can be integrated with
  any metrics backend by scraping the snapshot dict.
* **Thread-safe** — all mutations use ``threading.Lock`` for safety under
  concurrent tool invocations.
* **Histogram via sorted insertion** — latency values are stored in bounded
  lists (max 10 000 samples) to compute percentiles without external libs.
* **Singleton registry** — ``MetricsRegistry`` is instantiated once and
  accessed via module-level functions.

Acceptance Criteria (FORGEOS-BE027)
------------------------------------
1. Request counter tracks total requests by tool name and status.
2. Request latency histogram tracks p50, p95, p99 per tool name.
3. Active session gauge tracks current connected agent count.
4. Claim metrics track successful claims, failed claims, expired leases.
5. Database query duration is tracked per operation type (read/write).
6. Metrics exposed via snapshot dict / structured JSON log line.

.. meta::
   :ticket: FORGEOS-BE027
   :last_reviewed: 2026-03-10T22:00:00Z
"""

from __future__ import annotations

import bisect
import logging
import threading
import time
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger("forgeos.metrics")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_MAX_HISTOGRAM_SAMPLES: int = 10_000
"""Maximum number of latency samples to retain per histogram bucket."""


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------


@dataclass
class _Counter:
    """Thread-safe monotonically increasing counter."""

    _value: int = 0
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def increment(self, amount: int = 1) -> None:
        """Increment counter by *amount*."""
        with self._lock:
            self._value += amount

    @property
    def value(self) -> int:
        """Return current counter value."""
        with self._lock:
            return self._value


@dataclass
class _Gauge:
    """Thread-safe gauge that can go up and down."""

    _value: int = 0
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def increment(self, amount: int = 1) -> None:
        """Increase gauge."""
        with self._lock:
            self._value += amount

    def decrement(self, amount: int = 1) -> None:
        """Decrease gauge (floor at 0)."""
        with self._lock:
            self._value = max(0, self._value - amount)

    def set(self, value: int) -> None:
        """Set gauge to an absolute value."""
        with self._lock:
            self._value = value

    @property
    def value(self) -> int:
        """Return current gauge value."""
        with self._lock:
            return self._value


@dataclass
class _Histogram:
    """Thread-safe histogram for latency percentile computation.

    Stores up to ``_MAX_HISTOGRAM_SAMPLES`` sorted samples.  When the
    limit is reached, the oldest half is discarded to make room.
    """

    _samples: list[float] = field(default_factory=list, repr=False)
    _count: int = 0
    _total: float = 0.0
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def observe(self, value: float) -> None:
        """Record a latency observation in seconds."""
        with self._lock:
            self._count += 1
            self._total += value
            bisect.insort(self._samples, value)
            if len(self._samples) > _MAX_HISTOGRAM_SAMPLES:
                # Discard oldest half to keep memory bounded
                self._samples = self._samples[_MAX_HISTOGRAM_SAMPLES // 2 :]

    def percentile(self, p: float) -> float:
        """Compute the *p*-th percentile (0–100) from stored samples.

        Returns 0.0 if no samples have been recorded.
        """
        with self._lock:
            if not self._samples:
                return 0.0
            idx = int(len(self._samples) * p / 100.0)
            idx = min(idx, len(self._samples) - 1)
            return self._samples[idx]

    def snapshot(self) -> dict[str, Any]:
        """Return a dict with count, total, p50, p95, p99."""
        with self._lock:
            samples = list(self._samples)
            count = self._count
            total = self._total

        def _pct(p: float) -> float:
            if not samples:
                return 0.0
            idx = int(len(samples) * p / 100.0)
            idx = min(idx, len(samples) - 1)
            return samples[idx]

        return {
            "count": count,
            "total_seconds": round(total, 6),
            "p50": round(_pct(50), 6),
            "p95": round(_pct(95), 6),
            "p99": round(_pct(99), 6),
        }


# ---------------------------------------------------------------------------
# Metrics Registry
# ---------------------------------------------------------------------------


class MetricsRegistry:
    """Central registry for all MCP server metrics.

    Provides labelled counters, gauges, and histograms for the six
    metric categories required by FORGEOS-BE027.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()

        # 1. Request counters — keyed by (tool_name, status)
        self._request_counters: dict[tuple[str, str], _Counter] = {}

        # 2. Request latency histograms — keyed by tool_name
        self._request_latency: dict[str, _Histogram] = {}

        # 3. Active sessions gauge
        self._active_sessions = _Gauge()

        # 4. Claim metrics
        self._claims_success = _Counter()
        self._claims_failed = _Counter()
        self._claims_expired = _Counter()

        # 5. Database query duration — keyed by operation_type
        self._db_duration: dict[str, _Histogram] = {}

    # -- Request counters --------------------------------------------------

    def record_request(self, tool_name: str, status: str) -> None:
        """Increment the request counter for *tool_name* and *status*.

        Parameters
        ----------
        tool_name : str
            MCP tool name (e.g. ``"tickets.claim"``).
        status : str
            ``"success"`` or ``"error"``.
        """
        key = (tool_name, status)
        with self._lock:
            if key not in self._request_counters:
                self._request_counters[key] = _Counter()
        self._request_counters[key].increment()

    # -- Request latency ---------------------------------------------------

    def record_request_latency(self, tool_name: str, duration_seconds: float) -> None:
        """Record request latency for *tool_name*.

        Parameters
        ----------
        tool_name : str
            MCP tool name.
        duration_seconds : float
            Elapsed time in seconds.
        """
        with self._lock:
            if tool_name not in self._request_latency:
                self._request_latency[tool_name] = _Histogram()
        self._request_latency[tool_name].observe(duration_seconds)

    # -- Active sessions ---------------------------------------------------

    def session_opened(self) -> None:
        """Increment the active sessions gauge."""
        self._active_sessions.increment()

    def session_closed(self) -> None:
        """Decrement the active sessions gauge."""
        self._active_sessions.decrement()

    def set_active_sessions(self, count: int) -> None:
        """Set active sessions to an absolute value."""
        self._active_sessions.set(count)

    # -- Claim metrics -----------------------------------------------------

    def record_claim_success(self) -> None:
        """Record a successful ticket claim."""
        self._claims_success.increment()

    def record_claim_failure(self) -> None:
        """Record a failed ticket claim attempt."""
        self._claims_failed.increment()

    def record_claim_expired(self) -> None:
        """Record an expired lease release."""
        self._claims_expired.increment()

    # -- Database query duration -------------------------------------------

    def record_db_query_duration(
        self, operation_type: str, duration_seconds: float
    ) -> None:
        """Record database query duration.

        Parameters
        ----------
        operation_type : str
            ``"read"`` or ``"write"``.
        duration_seconds : float
            Elapsed time in seconds.
        """
        with self._lock:
            if operation_type not in self._db_duration:
                self._db_duration[operation_type] = _Histogram()
        self._db_duration[operation_type].observe(duration_seconds)

    # -- Snapshot ----------------------------------------------------------

    def snapshot(self) -> dict[str, Any]:
        """Return a complete metrics snapshot as a JSON-serializable dict.

        The snapshot is structured as::

            {
                "timestamp": "...",
                "requests": {
                    "counters": {"tool.status": N, ...},
                    "latency": {"tool": {p50, p95, p99, count, total}, ...}
                },
                "active_sessions": N,
                "claims": {"success": N, "failed": N, "expired": N},
                "database": {
                    "query_duration": {"read": {...}, "write": {...}}
                }
            }
        """
        from datetime import datetime, timezone

        # Request counters
        counters: dict[str, int] = {}
        with self._lock:
            for (tool, status), counter in self._request_counters.items():
                counters[f"{tool}.{status}"] = counter.value

        # Request latency
        latency: dict[str, dict[str, Any]] = {}
        with self._lock:
            for tool, hist in self._request_latency.items():
                latency[tool] = hist.snapshot()

        # DB query duration
        db_duration: dict[str, dict[str, Any]] = {}
        with self._lock:
            for op_type, hist in self._db_duration.items():
                db_duration[op_type] = hist.snapshot()

        return {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "requests": {
                "counters": counters,
                "latency": latency,
            },
            "active_sessions": self._active_sessions.value,
            "claims": {
                "success": self._claims_success.value,
                "failed": self._claims_failed.value,
                "expired": self._claims_expired.value,
            },
            "database": {
                "query_duration": db_duration,
            },
        }

    def reset(self) -> None:
        """Reset all metrics to zero.  Used primarily in tests."""
        with self._lock:
            self._request_counters.clear()
            self._request_latency.clear()
            self._db_duration.clear()
        self._active_sessions.set(0)
        self._claims_success = _Counter()
        self._claims_failed = _Counter()
        self._claims_expired = _Counter()


# ---------------------------------------------------------------------------
# Module-level singleton
# ---------------------------------------------------------------------------

_registry = MetricsRegistry()
"""Module-level singleton metrics registry."""


def get_registry() -> MetricsRegistry:
    """Return the global :class:`MetricsRegistry` singleton."""
    return _registry


# ---------------------------------------------------------------------------
# Convenience functions (delegate to singleton)
# ---------------------------------------------------------------------------


def record_request(tool_name: str, status: str) -> None:
    """Record a tool request. See :meth:`MetricsRegistry.record_request`."""
    _registry.record_request(tool_name, status)


def record_request_latency(tool_name: str, duration_seconds: float) -> None:
    """Record tool latency. See :meth:`MetricsRegistry.record_request_latency`."""
    _registry.record_request_latency(tool_name, duration_seconds)


def session_opened() -> None:
    """Increment active sessions. See :meth:`MetricsRegistry.session_opened`."""
    _registry.session_opened()


def session_closed() -> None:
    """Decrement active sessions. See :meth:`MetricsRegistry.session_closed`."""
    _registry.session_closed()


def record_claim_success() -> None:
    """Record successful claim. See :meth:`MetricsRegistry.record_claim_success`."""
    _registry.record_claim_success()


def record_claim_failure() -> None:
    """Record failed claim. See :meth:`MetricsRegistry.record_claim_failure`."""
    _registry.record_claim_failure()


def record_claim_expired() -> None:
    """Record expired lease. See :meth:`MetricsRegistry.record_claim_expired`."""
    _registry.record_claim_expired()


def record_db_query_duration(operation_type: str, duration_seconds: float) -> None:
    """Record DB query time. See :meth:`MetricsRegistry.record_db_query_duration`."""
    _registry.record_db_query_duration(operation_type, duration_seconds)


def get_metrics_snapshot() -> dict[str, Any]:
    """Return complete metrics snapshot. See :meth:`MetricsRegistry.snapshot`."""
    return _registry.snapshot()


# ---------------------------------------------------------------------------
# Context managers for timing
# ---------------------------------------------------------------------------


class RequestTimer:
    """Context manager that records request latency and counter on exit.

    Usage::

        with RequestTimer("tickets.claim") as timer:
            result = await handle_claim(params)
        # latency + success/error counter recorded automatically

    Set ``timer.error = True`` inside the block to record an error status.
    """

    def __init__(self, tool_name: str) -> None:
        self.tool_name = tool_name
        self.error: bool = False
        self._start: float = 0.0

    def __enter__(self) -> RequestTimer:
        self._start = time.monotonic()
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        exc_tb: Any,
    ) -> None:
        elapsed = time.monotonic() - self._start
        status = "error" if (self.error or exc_type is not None) else "success"
        record_request(self.tool_name, status)
        record_request_latency(self.tool_name, elapsed)


class DbQueryTimer:
    """Context manager that records database query duration.

    Usage::

        with DbQueryTimer("read"):
            rows = await conn.fetch(query)
    """

    def __init__(self, operation_type: str) -> None:
        self.operation_type = operation_type
        self._start: float = 0.0

    def __enter__(self) -> DbQueryTimer:
        self._start = time.monotonic()
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        exc_tb: Any,
    ) -> None:
        elapsed = time.monotonic() - self._start
        record_db_query_duration(self.operation_type, elapsed)


# ---------------------------------------------------------------------------
# Structured log emission
# ---------------------------------------------------------------------------


def emit_metrics_log() -> None:
    """Emit current metrics as a structured JSON log line.

    Uses the ``forgeos.metrics`` logger at INFO level.  The log record
    includes the full snapshot as extra fields, making it parseable by
    any JSON log aggregator.
    """
    snapshot = get_metrics_snapshot()
    logger.info(
        "metrics_snapshot",
        extra={"metrics": snapshot},
    )

"""Background lease heartbeat for ForgeOS agent SDK.

:class:`LeaseHeartbeat` runs a background asyncio task that periodically
extends the active ticket lease by calling the ``tickets.heartbeat`` MCP tool.
"""

from __future__ import annotations

import asyncio
import logging
import os
from types import TracebackType

from forgeos_sdk.client import ForgeOSClient

logger = logging.getLogger("forgeos_sdk")

DEFAULT_INTERVAL_SECONDS: float = 300.0  # 5 minutes


class LeaseHeartbeat:
    """Background task that sends periodic heartbeats to extend a lease.

    Parameters:
        client: Connected ForgeOS client.
        ticket_id: The ticket whose lease to extend.
        interval_seconds: Heartbeat interval in seconds.
            Falls back to ``FORGEOS_HEARTBEAT_INTERVAL`` env var, then
            :data:`DEFAULT_INTERVAL_SECONDS` (300).
    """

    def __init__(
        self,
        client: ForgeOSClient,
        ticket_id: str,
        *,
        interval_seconds: float | None = None,
    ) -> None:
        self._client = client
        self._ticket_id = ticket_id
        self._task: asyncio.Task[None] | None = None
        self._stopped = asyncio.Event()

        if interval_seconds is not None:
            self._interval = float(interval_seconds)
        else:
            env_val = os.environ.get("FORGEOS_HEARTBEAT_INTERVAL")
            if env_val is not None:
                self._interval = float(env_val)
            else:
                self._interval = DEFAULT_INTERVAL_SECONDS

    @property
    def running(self) -> bool:
        """Whether the heartbeat task is currently active."""
        return self._task is not None and not self._task.done()

    @property
    def ticket_id(self) -> str:
        """The ticket ID being heartbeat-monitored."""
        return self._ticket_id

    @property
    def interval_seconds(self) -> float:
        """Heartbeat interval in seconds."""
        return self._interval

    def start(self) -> None:
        """Start the background heartbeat task.

        Does nothing if already running.
        """
        if self.running:
            return
        self._stopped.clear()
        self._task = asyncio.create_task(self._heartbeat_loop())

    async def stop(self) -> None:
        """Stop the background heartbeat task.

        Does nothing if not running. Safe to call multiple times.
        """
        if self._task is None or self._task.done():
            self._task = None
            return
        self._stopped.set()
        self._task.cancel()
        try:
            await self._task
        except asyncio.CancelledError:
            pass
        self._task = None

    async def _heartbeat_loop(self) -> None:
        """Internal loop: sleep for interval then send heartbeat, repeat."""
        while not self._stopped.is_set():
            try:
                await asyncio.wait_for(
                    self._stopped.wait(),
                    timeout=self._interval,
                )
                # _stopped was set — exit the loop
                break
            except asyncio.TimeoutError:
                # Timeout means interval elapsed — time to heartbeat
                pass

            await self._send_heartbeat()

    async def _send_heartbeat(self) -> None:
        """Send a single heartbeat call to the MCP server.

        Logs warnings on failure but never raises, keeping the agent
        alive even when heartbeats fail.
        """
        session = self._client.session
        if session is None:
            logger.warning(
                "Heartbeat skipped for %s: client not connected",
                self._ticket_id,
            )
            return

        try:
            result = await session.call_tool(
                "tickets.heartbeat",
                {"ticket_id": self._ticket_id},
            )
            if result.isError:
                text = ""
                for block in result.content:
                    if hasattr(block, "text"):
                        text = block.text
                        break
                logger.warning(
                    "Heartbeat failed for %s: %s",
                    self._ticket_id,
                    text or "Unknown error",
                )
            else:
                logger.debug("Heartbeat sent for %s", self._ticket_id)
        except Exception:
            logger.warning(
                "Heartbeat error for %s",
                self._ticket_id,
                exc_info=True,
            )

    async def __aenter__(self) -> LeaseHeartbeat:
        """Start heartbeat on context entry."""
        self.start()
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        exc_tb: TracebackType | None,
    ) -> None:
        """Stop heartbeat on context exit."""
        await self.stop()

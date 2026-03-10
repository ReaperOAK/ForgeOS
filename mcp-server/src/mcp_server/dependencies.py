"""Dependency injection container for the ForgeOS MCP server.

Provides a :class:`Dependencies` dataclass that holds all injectable
components (connection pool, repositories) and factory/teardown methods
for the server lifespan.  Tool handlers access repositories through this
container — never touching the pool directly.

Usage::

    deps = await Dependencies.create(dsn="postgresql://...")
    ticket = await deps.ticket_repo.get_by_id("FORGEOS-BE018")
    await deps.close()

.. meta::
   :last_reviewed: 2026-03-12T00:30:00Z
"""

from __future__ import annotations

from dataclasses import dataclass

from mcp_server.db.pool import ConnectionPool, PoolConfig
from mcp_server.observability import get_logger
from mcp_server.repositories import (
    AuditRepository,
    ClaimRepository,
    EventRepository,
    TicketRepository,
)

logger = get_logger("dependencies")


@dataclass(frozen=True)
class Dependencies:
    """Typed container holding all server-level dependencies.

    Instances are created via the :meth:`create` async factory and torn
    down via :meth:`close`.  The container is frozen (immutable) after
    construction to prevent accidental mutation.

    Attributes
    ----------
    pool : ConnectionPool
        The asyncpg connection pool wrapper (lifecycle management, health).
    ticket_repo : TicketRepository
        Data-access object for the ``tickets`` table.
    claim_repo : ClaimRepository
        Data-access object for atomic claim/release operations.
    event_repo : EventRepository
        Append-only event repository for the audit trail.
    """

    pool: ConnectionPool
    ticket_repo: TicketRepository
    claim_repo: ClaimRepository
    event_repo: EventRepository
    audit_repo: AuditRepository

    @staticmethod
    async def create(
        *,
        dsn: str | None = None,
        min_size: int | None = None,
        max_size: int | None = None,
        pool_config: PoolConfig | None = None,
    ) -> Dependencies:
        """Async factory: initialise pool and build repository instances.

        Parameters
        ----------
        dsn : str | None
            PostgreSQL connection URI (overrides ``pool_config.database_url``).
        min_size : int | None
            Minimum pool connections (overrides config).
        max_size : int | None
            Maximum pool connections (overrides config).
        pool_config : PoolConfig | None
            Pool configuration; defaults to loading from env vars.

        Returns
        -------
        Dependencies
            Fully initialised container ready for use.

        Raises
        ------
        ConnectionError
            If the database is unreachable or credentials are invalid.
        """
        config = pool_config or PoolConfig()
        pool = ConnectionPool(
            config=config,
            dsn=dsn,
            min_size=min_size,
            max_size=max_size,
        )
        await pool.initialize()

        raw = pool.raw_pool
        logger.info("Building repository instances")

        return Dependencies(
            pool=pool,
            ticket_repo=TicketRepository(raw),
            claim_repo=ClaimRepository(raw),
            event_repo=EventRepository(raw),
            audit_repo=AuditRepository(raw),
        )

    async def close(self) -> None:
        """Gracefully shut down: drain and close the connection pool."""
        logger.info("Closing dependencies")
        await self.pool.close()
        logger.info("Dependencies closed")

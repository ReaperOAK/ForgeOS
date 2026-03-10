"""Machine service — high-level orchestration for machine auth operations.

Wraps the low-level functions in :mod:`mcp_server.auth.machine_auth`
with a configured :class:`MachineService` that holds the database pool
and registration mode.

.. meta::
   :ticket: FORGEOS-BE052
   :last_reviewed: 2026-03-11T00:00:00Z
"""

from __future__ import annotations

from typing import Any

from mcp_server.auth.machine_auth import (
    MachineIdentity,
    MachineRegistrationMode,
    deactivate_machine,
    get_machine,
    register_machine,
    verify_machine,
)


class MachineService:
    """High-level service wrapping machine auth operations.

    Parameters
    ----------
    db_pool :
        asyncpg connection pool.
    mode : MachineRegistrationMode
        Default registration mode for :meth:`verify`.
    """

    def __init__(
        self,
        db_pool: Any,
        mode: MachineRegistrationMode = MachineRegistrationMode.AUTO,
    ) -> None:
        self._db_pool = db_pool
        self._mode = mode

    @property
    def mode(self) -> MachineRegistrationMode:
        """Current registration mode."""
        return self._mode

    async def register(
        self,
        machine_id: str,
        hostname: str = "",
    ) -> MachineIdentity:
        """Register or update a machine record.

        Parameters
        ----------
        machine_id : str
            Unique machine identifier.
        hostname : str
            Human-readable hostname (defaults to *machine_id*).

        Returns
        -------
        MachineIdentity
        """
        return await register_machine(self._db_pool, machine_id, hostname)

    async def verify(
        self,
        machine_id: str,
        hostname: str = "",
    ) -> MachineIdentity:
        """Verify a machine and optionally auto-register it.

        Parameters
        ----------
        machine_id : str
            Machine identifier to verify.
        hostname : str
            Hostname hint for auto-registration.

        Returns
        -------
        MachineIdentity
        """
        return await verify_machine(
            self._db_pool, machine_id, mode=self._mode, hostname=hostname
        )

    async def lookup(self, machine_id: str) -> MachineIdentity | None:
        """Look up a machine by identifier.

        Parameters
        ----------
        machine_id : str
            Machine identifier to look up.

        Returns
        -------
        MachineIdentity or None
        """
        return await get_machine(self._db_pool, machine_id)

    async def deactivate(self, machine_id: str) -> bool:
        """Deactivate a machine.

        Parameters
        ----------
        machine_id : str
            Machine identifier to deactivate.

        Returns
        -------
        bool
            ``True`` if the machine was found and deactivated.
        """
        return await deactivate_machine(self._db_pool, machine_id)

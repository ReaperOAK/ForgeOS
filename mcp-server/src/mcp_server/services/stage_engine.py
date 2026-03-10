"""SDLC stage engine — validates and computes ticket stage transitions.

Provides pure-domain logic for enforcing the SDLC flow order defined
per ticket.  Each ticket carries its own ``sdlc_flow`` list (e.g.
``["READY", "BACKEND", "QA", "SECURITY", "CI", "DOCS", "VALIDATION", "DONE"]``).
The stage engine verifies that a requested advance moves the ticket to
the *next* stage in that flow — no stage skipping, no reordering.

Public API
----------
* :func:`get_next_stage` — return the next stage in a ticket's SDLC flow.
* :func:`validate_advance` — validate and return the next stage, or raise.
* :exc:`InvalidTransitionError` — raised when a transition is not allowed.

.. meta::
   :ticket: FORGEOS-BE030
   :last_reviewed: 2026-03-11T00:00:00Z
"""

from __future__ import annotations


class InvalidTransitionError(Exception):
    """Raised when a stage transition violates the SDLC flow order.

    Attributes
    ----------
    ticket_id : str
        The ticket that attempted the invalid transition.
    current_stage : str
        The ticket's current stage.
    reason : str
        Human-readable explanation of why the transition is invalid.
    """

    def __init__(
        self,
        ticket_id: str,
        current_stage: str,
        reason: str,
    ) -> None:
        self.ticket_id = ticket_id
        self.current_stage = current_stage
        self.reason = reason
        super().__init__(
            f"Invalid transition for {ticket_id} at stage {current_stage}: {reason}"
        )


def get_next_stage(sdlc_flow: list[str], current_stage: str) -> str | None:
    """Return the next stage in *sdlc_flow* after *current_stage*.

    Parameters
    ----------
    sdlc_flow : list[str]
        Ordered list of stages the ticket traverses.
    current_stage : str
        The ticket's current stage.

    Returns
    -------
    str | None
        The next stage name, or ``None`` if *current_stage* is the last
        stage or is not found in the flow.
    """
    try:
        idx = sdlc_flow.index(current_stage)
    except ValueError:
        return None

    if idx + 1 >= len(sdlc_flow):
        return None

    return sdlc_flow[idx + 1]


def validate_advance(
    ticket_id: str,
    sdlc_flow: list[str],
    current_stage: str,
) -> str:
    """Validate that advancing from *current_stage* is permitted and return the next stage.

    Parameters
    ----------
    ticket_id : str
        Ticket identifier (used in error messages).
    sdlc_flow : list[str]
        The ticket's ordered SDLC flow.
    current_stage : str
        The ticket's current stage.

    Returns
    -------
    str
        The next stage in the flow.

    Raises
    ------
    InvalidTransitionError
        If the flow is empty, the current stage is not in the flow,
        or the ticket is already at the final stage.
    """
    if not sdlc_flow:
        raise InvalidTransitionError(
            ticket_id, current_stage, "Ticket has no SDLC flow defined"
        )

    if current_stage not in sdlc_flow:
        raise InvalidTransitionError(
            ticket_id,
            current_stage,
            f"Current stage '{current_stage}' is not in the ticket's SDLC flow: {sdlc_flow}",
        )

    next_stage = get_next_stage(sdlc_flow, current_stage)
    if next_stage is None:
        raise InvalidTransitionError(
            ticket_id,
            current_stage,
            f"Ticket is already at the final stage '{current_stage}'",
        )

    return next_stage

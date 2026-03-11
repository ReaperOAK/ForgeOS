"""Pipeline overview REST endpoint.

Provides a Starlette route handler for querying the SDLC pipeline at
``GET /api/pipeline``, returning stage-by-stage ticket counts.

Query parameters:
- ``group_by``: Optional grouping. Currently supports ``type`` to break
  down counts by ticket type within each stage.

No authentication required — public read-only endpoint.

.. meta::
   :ticket: FORGEOS-BE038
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from starlette.responses import JSONResponse

from mcp_server.api.schemas import (
    PipelineResponse,
    StageCount,
    StageTypeCount,
)
from mcp_server.observability import get_logger

if TYPE_CHECKING:
    from starlette.requests import Request

    from mcp_server.repositories.ticket_repo import TicketRepository

logger = get_logger("api.routes.pipeline")


def create_pipeline_endpoint(ticket_repo_getter: Any) -> Any:
    """Create the pipeline overview endpoint handler.

    Parameters
    ----------
    ticket_repo_getter : callable
        Returns the current ``TicketRepository`` or ``None``.

    Returns
    -------
    coroutine
        An async Starlette request handler.
    """

    async def pipeline_endpoint(request: Request) -> JSONResponse:
        """Handle GET /api/pipeline requests."""
        ticket_repo: TicketRepository | None = ticket_repo_getter()
        if ticket_repo is None:
            return JSONResponse(
                status_code=503,
                content={"error": "Database unavailable"},
            )

        group_by = request.query_params.get("group_by")

        try:
            stage_counts = await ticket_repo.count_by_stage()

            stages = [
                StageCount(stage=stage, count=count)
                for stage, count in sorted(stage_counts.items())
            ]
            total = sum(stage_counts.values())

            group_by_type: list[StageTypeCount] | None = None
            if group_by == "type":
                raw = await ticket_repo.count_by_stage_and_type()
                group_by_type = [
                    StageTypeCount(stage=r["stage"], type=r["type"], count=r["count"])
                    for r in raw
                ]

            response = PipelineResponse(
                stages=stages,
                total=total,
                group_by_type=group_by_type,
            )

            return JSONResponse(
                status_code=200,
                content=response.model_dump(mode="json"),
            )
        except Exception:
            logger.exception("pipeline_query_failed")
            return JSONResponse(
                status_code=500,
                content={"error": "Internal server error"},
            )

    return pipeline_endpoint

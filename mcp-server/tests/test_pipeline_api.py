"""Tests for GET /api/pipeline — pipeline overview endpoint.

TDD Evidence
------------
- RED: tests written before implementation to define API contract
- GREEN: schemas + routes/pipeline.py + repo.count_by_stage_and_type implemented
- REFACTOR: shared helpers extracted

Ticket: FORGEOS-BE038
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock

from starlette.applications import Starlette
from starlette.routing import Route
from starlette.testclient import TestClient

from mcp_server.api.routes.pipeline import create_pipeline_endpoint
from mcp_server.api.schemas import PipelineResponse, StageCount, StageTypeCount

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_app(repo: Any) -> Starlette:
    """Build a minimal Starlette app with the pipeline endpoint."""
    handler = create_pipeline_endpoint(lambda: repo)
    return Starlette(routes=[Route("/api/pipeline", handler, methods=["GET"])])


def _make_repo(
    stage_counts: dict[str, int] | None = None,
    stage_type_counts: list[dict[str, int | str]] | None = None,
    raise_on_count: Exception | None = None,
) -> AsyncMock:
    """Create a mock TicketRepository with pipeline-relevant methods."""
    repo = AsyncMock()
    if raise_on_count:
        repo.count_by_stage.side_effect = raise_on_count
    else:
        repo.count_by_stage.return_value = stage_counts or {}
    repo.count_by_stage_and_type.return_value = stage_type_counts or []
    return repo


# ===================================================================
# AC1 — GET /api/pipeline returns per-stage ticket counts
# ===================================================================


class TestPipelineBasic:
    """AC1: Pipeline endpoint returns stage-by-stage ticket counts."""

    def test_returns_stage_counts(self) -> None:
        repo = _make_repo(stage_counts={"READY": 5, "BACKEND": 3, "DONE": 10})
        client = TestClient(_make_app(repo))

        resp = client.get("/api/pipeline")

        assert resp.status_code == 200
        body = resp.json()
        assert body["total"] == 18
        stages = {s["stage"]: s["count"] for s in body["stages"]}
        assert stages["READY"] == 5
        assert stages["BACKEND"] == 3
        assert stages["DONE"] == 10

    def test_empty_pipeline(self) -> None:
        repo = _make_repo(stage_counts={})
        client = TestClient(_make_app(repo))

        resp = client.get("/api/pipeline")

        assert resp.status_code == 200
        body = resp.json()
        assert body["total"] == 0
        assert body["stages"] == []
        assert body["group_by_type"] is None

    def test_stages_sorted_alphabetically(self) -> None:
        repo = _make_repo(stage_counts={"QA": 2, "BACKEND": 1, "DONE": 3})
        client = TestClient(_make_app(repo))

        resp = client.get("/api/pipeline")

        body = resp.json()
        stage_names = [s["stage"] for s in body["stages"]]
        assert stage_names == sorted(stage_names)

    def test_response_matches_pydantic_schema(self) -> None:
        repo = _make_repo(stage_counts={"READY": 1})
        client = TestClient(_make_app(repo))

        resp = client.get("/api/pipeline")

        body = resp.json()
        parsed = PipelineResponse(**body)
        assert parsed.total == 1
        assert len(parsed.stages) == 1
        assert parsed.stages[0] == StageCount(stage="READY", count=1)


# ===================================================================
# AC2 — Pipeline with group_by=type
# ===================================================================


class TestPipelineGroupByType:
    """AC2: Pipeline supports optional grouping by ticket type."""

    def test_group_by_type_returns_breakdown(self) -> None:
        repo = _make_repo(
            stage_counts={"READY": 3},
            stage_type_counts=[
                {"stage": "READY", "type": "backend", "count": 2},
                {"stage": "READY", "type": "frontend", "count": 1},
            ],
        )
        client = TestClient(_make_app(repo))

        resp = client.get("/api/pipeline?group_by=type")

        assert resp.status_code == 200
        body = resp.json()
        assert body["group_by_type"] is not None
        assert len(body["group_by_type"]) == 2
        types = {g["type"]: g["count"] for g in body["group_by_type"]}
        assert types["backend"] == 2
        assert types["frontend"] == 1
        repo.count_by_stage_and_type.assert_awaited_once()

    def test_no_group_by_excludes_type_breakdown(self) -> None:
        repo = _make_repo(stage_counts={"READY": 1})
        client = TestClient(_make_app(repo))

        resp = client.get("/api/pipeline")

        body = resp.json()
        assert body["group_by_type"] is None
        repo.count_by_stage_and_type.assert_not_awaited()

    def test_group_by_type_pydantic_parse(self) -> None:
        repo = _make_repo(
            stage_counts={"QA": 2},
            stage_type_counts=[
                {"stage": "QA", "type": "backend", "count": 2},
            ],
        )
        client = TestClient(_make_app(repo))

        resp = client.get("/api/pipeline?group_by=type")

        body = resp.json()
        parsed = PipelineResponse(**body)
        assert parsed.group_by_type is not None
        assert parsed.group_by_type[0] == StageTypeCount(
            stage="QA", type="backend", count=2
        )


# ===================================================================
# AC3 — Database unavailable returns 503
# ===================================================================


class TestPipelineDatabaseUnavailable:
    """AC3: Returns 503 when database is unavailable."""

    def test_returns_503_when_repo_is_none(self) -> None:
        handler = create_pipeline_endpoint(lambda: None)
        app = Starlette(routes=[Route("/api/pipeline", handler, methods=["GET"])])
        client = TestClient(app)

        resp = client.get("/api/pipeline")

        assert resp.status_code == 503
        assert "Database unavailable" in resp.json()["error"]

    def test_returns_500_on_repo_exception(self) -> None:
        repo = _make_repo(raise_on_count=RuntimeError("connection lost"))
        client = TestClient(_make_app(repo))

        resp = client.get("/api/pipeline")

        assert resp.status_code == 500
        assert resp.json()["error"] == "Internal server error"


# ===================================================================
# AC4 — No authentication required (public read-only)
# ===================================================================


class TestPipelineNoAuth:
    """AC4: Pipeline endpoint requires no authentication."""

    def test_accessible_without_auth_headers(self) -> None:
        repo = _make_repo(stage_counts={"READY": 1})
        client = TestClient(_make_app(repo))

        resp = client.get("/api/pipeline")

        assert resp.status_code == 200

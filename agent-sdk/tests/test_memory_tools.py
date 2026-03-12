"""Tests for memory tool models and operations.

Covers acceptance criteria for TASK-INT-BE041:
  AC1: MemorySearchLessonsInput model with query, optional category, optional max_results
  AC2: MemoryAddLessonInput model with ticket_id, title, content, category (Literal enum)
  AC3: MemoryGetContextInput model with optional file_path, optional ticket_id, optional max_lessons
  AC4: Lesson model with id, title, content, category, confidence, similarity_score
  AC5: ContextResponse model with blast_radius, relevant_lessons, context_score
  AC6: Tool definitions registered in SDK tool catalog (operations)
  AC7: Unit tests for all new models (Pydantic validation)

TDD approach: RED -> GREEN -> REFACTOR.
"""

from __future__ import annotations

import inspect
import json
from typing import Any
from unittest.mock import AsyncMock, MagicMock, PropertyMock

import pytest
from pydantic import ValidationError

from forgeos_sdk.client import ForgeOSClient
from forgeos_sdk.exceptions import ToolCallError
from forgeos_sdk.models import (
    ContextResponse,
    Lesson,
    MemoryAddLessonInput,
    MemoryGetContextInput,
    MemorySearchLessonsInput,
    OperationResult,
)
from forgeos_sdk.operations import TicketOperations


# ---------------------------------------------------------------------------
# Helpers (same pattern as test_operations.py)
# ---------------------------------------------------------------------------


def _text_content(data: dict[str, Any] | str) -> MagicMock:
    content = MagicMock()
    content.text = data if isinstance(data, str) else json.dumps(data)
    return content


def _call_result(
    data: dict[str, Any] | str,
    *,
    is_error: bool = False,
) -> MagicMock:
    result = MagicMock()
    result.content = [_text_content(data)]
    result.isError = is_error
    return result


@pytest.fixture()
def mock_session() -> AsyncMock:
    return AsyncMock()


@pytest.fixture()
def mock_client(mock_session: AsyncMock) -> MagicMock:
    client = MagicMock(spec=ForgeOSClient)
    client.agent_id = "test-agent"
    type(client).session = PropertyMock(return_value=mock_session)
    return client


@pytest.fixture()
def ops(mock_client: MagicMock) -> TicketOperations:
    return TicketOperations(mock_client)


# ===========================================================================
# AC1: MemorySearchLessonsInput model
# ===========================================================================


class TestMemorySearchLessonsInput:
    """AC1 — MemorySearchLessonsInput validation."""

    def test_minimal_input(self) -> None:
        inp = MemorySearchLessonsInput(query="connection pool")
        assert inp.query == "connection pool"
        assert inp.category is None
        assert inp.max_results is None

    def test_full_input(self) -> None:
        inp = MemorySearchLessonsInput(
            query="retry logic",
            category="bug_fix",
            max_results=5,
        )
        assert inp.query == "retry logic"
        assert inp.category == "bug_fix"
        assert inp.max_results == 5

    def test_empty_query_rejected(self) -> None:
        with pytest.raises(ValidationError):
            MemorySearchLessonsInput(query="")

    def test_invalid_category_rejected(self) -> None:
        with pytest.raises(ValidationError):
            MemorySearchLessonsInput(query="test", category="invalid_cat")  # type: ignore[arg-type]

    def test_all_valid_categories(self) -> None:
        for cat in (
            "bug_fix", "pattern", "architecture", "performance",
            "security", "testing", "refactor", "tooling",
        ):
            inp = MemorySearchLessonsInput(query="x", category=cat)  # type: ignore[arg-type]
            assert inp.category == cat

    def test_dump_excludes_none(self) -> None:
        inp = MemorySearchLessonsInput(query="search term")
        dumped = inp.model_dump(exclude_none=True)
        assert "category" not in dumped
        assert "max_results" not in dumped
        assert dumped["query"] == "search term"


# ===========================================================================
# AC2: MemoryAddLessonInput model
# ===========================================================================


class TestMemoryAddLessonInput:
    """AC2 — MemoryAddLessonInput validation."""

    def test_valid_input(self) -> None:
        inp = MemoryAddLessonInput(
            ticket_id="FORGEOS-BE003",
            title="Use pgBouncer for pooling",
            content="pgBouncer is preferred over raw pg pools.",
            category="architecture",
        )
        assert inp.ticket_id == "FORGEOS-BE003"
        assert inp.title == "Use pgBouncer for pooling"
        assert inp.category == "architecture"

    def test_empty_ticket_id_rejected(self) -> None:
        with pytest.raises(ValidationError):
            MemoryAddLessonInput(
                ticket_id="",
                title="Title",
                content="Content",
                category="bug_fix",
            )

    def test_empty_title_rejected(self) -> None:
        with pytest.raises(ValidationError):
            MemoryAddLessonInput(
                ticket_id="T-1",
                title="",
                content="Content",
                category="bug_fix",
            )

    def test_empty_content_rejected(self) -> None:
        with pytest.raises(ValidationError):
            MemoryAddLessonInput(
                ticket_id="T-1",
                title="Title",
                content="",
                category="bug_fix",
            )

    def test_invalid_category_rejected(self) -> None:
        with pytest.raises(ValidationError):
            MemoryAddLessonInput(
                ticket_id="T-1",
                title="Title",
                content="Content",
                category="not_a_category",  # type: ignore[arg-type]
            )

    def test_dump_includes_all_fields(self) -> None:
        inp = MemoryAddLessonInput(
            ticket_id="T-1",
            title="Title",
            content="Content",
            category="testing",
        )
        dumped = inp.model_dump()
        assert set(dumped.keys()) == {"ticket_id", "title", "content", "category"}


# ===========================================================================
# AC3: MemoryGetContextInput model
# ===========================================================================


class TestMemoryGetContextInput:
    """AC3 — MemoryGetContextInput validation."""

    def test_minimal_input(self) -> None:
        inp = MemoryGetContextInput()
        assert inp.file_path is None
        assert inp.ticket_id is None
        assert inp.max_lessons is None

    def test_full_input(self) -> None:
        inp = MemoryGetContextInput(
            file_path="src/db/pool.ts",
            ticket_id="FORGEOS-BE003",
            max_lessons=5,
        )
        assert inp.file_path == "src/db/pool.ts"
        assert inp.ticket_id == "FORGEOS-BE003"
        assert inp.max_lessons == 5

    def test_file_path_only(self) -> None:
        inp = MemoryGetContextInput(file_path="src/main.ts")
        assert inp.file_path == "src/main.ts"
        assert inp.ticket_id is None

    def test_ticket_id_only(self) -> None:
        inp = MemoryGetContextInput(ticket_id="T-1")
        assert inp.ticket_id == "T-1"
        assert inp.file_path is None

    def test_dump_excludes_none(self) -> None:
        inp = MemoryGetContextInput(file_path="src/a.ts")
        dumped = inp.model_dump(exclude_none=True)
        assert "ticket_id" not in dumped
        assert "max_lessons" not in dumped
        assert dumped["file_path"] == "src/a.ts"


# ===========================================================================
# AC4: Lesson model
# ===========================================================================


class TestLessonModel:
    """AC4 — Lesson model fields and validation."""

    def test_minimal_lesson(self) -> None:
        lesson = Lesson(id="lesson-001")
        assert lesson.id == "lesson-001"
        assert lesson.title == ""
        assert lesson.content == ""
        assert lesson.category == ""
        assert lesson.confidence == 0.0
        assert lesson.similarity_score == 0.0

    def test_full_lesson(self) -> None:
        lesson = Lesson(
            id="lesson-042",
            title="Use retry with backoff",
            content="Exponential backoff improves reliability.",
            category="pattern",
            confidence=0.95,
            similarity_score=0.87,
        )
        assert lesson.id == "lesson-042"
        assert lesson.title == "Use retry with backoff"
        assert lesson.confidence == 0.95
        assert lesson.similarity_score == 0.87

    def test_lesson_from_dict(self) -> None:
        data = {
            "id": "L-1",
            "title": "Test",
            "content": "Body",
            "category": "bug_fix",
            "confidence": 0.8,
            "similarity_score": 0.6,
        }
        lesson = Lesson.model_validate(data)
        assert lesson.id == "L-1"
        assert lesson.confidence == 0.8

    def test_lesson_allows_extra_fields(self) -> None:
        lesson = Lesson(id="L-1", extra_field="val")
        assert lesson.model_extra is not None
        assert lesson.model_extra.get("extra_field") == "val"

    def test_lesson_requires_id(self) -> None:
        with pytest.raises(ValidationError):
            Lesson()  # type: ignore[call-arg]


# ===========================================================================
# AC5: ContextResponse model
# ===========================================================================


class TestContextResponseModel:
    """AC5 — ContextResponse model fields and validation."""

    def test_minimal_context_response(self) -> None:
        ctx = ContextResponse()
        assert ctx.blast_radius == []
        assert ctx.relevant_lessons == []
        assert ctx.context_score == 0.0

    def test_full_context_response(self) -> None:
        lessons = [
            Lesson(id="L-1", title="Lesson 1", confidence=0.9, similarity_score=0.8),
            Lesson(id="L-2", title="Lesson 2", confidence=0.7, similarity_score=0.6),
        ]
        ctx = ContextResponse(
            blast_radius=["src/db/pool.ts", "src/db/config.ts"],
            relevant_lessons=lessons,
            context_score=0.85,
        )
        assert len(ctx.blast_radius) == 2
        assert len(ctx.relevant_lessons) == 2
        assert ctx.context_score == 0.85
        assert ctx.relevant_lessons[0].id == "L-1"

    def test_context_response_from_dict(self) -> None:
        data = {
            "blast_radius": ["src/a.ts"],
            "relevant_lessons": [
                {"id": "L-1", "title": "T", "confidence": 0.5, "similarity_score": 0.4},
            ],
            "context_score": 0.7,
        }
        ctx = ContextResponse.model_validate(data)
        assert len(ctx.relevant_lessons) == 1
        assert ctx.relevant_lessons[0].id == "L-1"
        assert ctx.context_score == 0.7

    def test_context_response_allows_extra_fields(self) -> None:
        ctx = ContextResponse(context_score=0.5, extra_field="val")
        assert ctx.model_extra is not None
        assert ctx.model_extra.get("extra_field") == "val"


# ===========================================================================
# AC6: Tool definitions registered — memory_search_lessons
# ===========================================================================


class TestMemorySearchLessonsOp:
    """AC6 — memory_search_lessons calls memory.search_lessons."""

    async def test_returns_lesson_list(
        self, ops: TicketOperations, mock_session: AsyncMock,
    ) -> None:
        mock_session.call_tool.return_value = _call_result({
            "lessons": [
                {
                    "id": "L-1",
                    "title": "Retry pattern",
                    "content": "Use exponential backoff",
                    "category": "pattern",
                    "confidence": 0.9,
                    "similarity_score": 0.85,
                },
                {
                    "id": "L-2",
                    "title": "Pool config",
                    "content": "Min 5, max 20",
                    "category": "architecture",
                    "confidence": 0.8,
                    "similarity_score": 0.7,
                },
            ],
        })

        results = await ops.memory_search_lessons("connection")

        assert len(results) == 2
        assert all(isinstance(r, Lesson) for r in results)
        assert results[0].id == "L-1"
        assert results[0].similarity_score == 0.85
        assert results[1].category == "architecture"

    async def test_calls_correct_tool(
        self, ops: TicketOperations, mock_session: AsyncMock,
    ) -> None:
        mock_session.call_tool.return_value = _call_result({"lessons": []})

        await ops.memory_search_lessons("query")

        mock_session.call_tool.assert_called_once_with(
            "memory.search_lessons", {"query": "query"},
        )

    async def test_passes_optional_params(
        self, ops: TicketOperations, mock_session: AsyncMock,
    ) -> None:
        mock_session.call_tool.return_value = _call_result({"lessons": []})

        await ops.memory_search_lessons(
            "retry", category="bug_fix", max_results=3,
        )

        args = mock_session.call_tool.call_args[0][1]
        assert args["query"] == "retry"
        assert args["category"] == "bug_fix"
        assert args["max_results"] == 3

    async def test_empty_results(
        self, ops: TicketOperations, mock_session: AsyncMock,
    ) -> None:
        mock_session.call_tool.return_value = _call_result({"lessons": []})

        results = await ops.memory_search_lessons("nonexistent")
        assert results == []

    async def test_error_response_raises(
        self, ops: TicketOperations, mock_session: AsyncMock,
    ) -> None:
        mock_session.call_tool.return_value = _call_result(
            {"error": "DB unavailable"}, is_error=True,
        )

        with pytest.raises(ToolCallError):
            await ops.memory_search_lessons("anything")

    async def test_is_async(self) -> None:
        assert inspect.iscoroutinefunction(TicketOperations.memory_search_lessons)


# ===========================================================================
# AC6: Tool definitions registered — memory_add_lesson
# ===========================================================================


class TestMemoryAddLessonOp:
    """AC6 — memory_add_lesson calls memory.add_lesson."""

    async def test_returns_operation_result(
        self, ops: TicketOperations, mock_session: AsyncMock,
    ) -> None:
        mock_session.call_tool.return_value = _call_result({
            "lesson_id": "L-new-1",
            "message": "Lesson created",
        })

        result = await ops.memory_add_lesson(
            ticket_id="T-1",
            title="Pool tuning",
            content="Set min=5, max=20",
            category="architecture",
        )

        assert isinstance(result, OperationResult)
        assert result.success is True
        assert result.data["lesson_id"] == "L-new-1"

    async def test_calls_correct_tool(
        self, ops: TicketOperations, mock_session: AsyncMock,
    ) -> None:
        mock_session.call_tool.return_value = _call_result({"message": "OK"})

        await ops.memory_add_lesson(
            ticket_id="T-2",
            title="Title",
            content="Content",
            category="testing",
        )

        call_args = mock_session.call_tool.call_args[0]
        assert call_args[0] == "memory.add_lesson"
        assert call_args[1]["ticket_id"] == "T-2"
        assert call_args[1]["title"] == "Title"
        assert call_args[1]["content"] == "Content"
        assert call_args[1]["category"] == "testing"

    async def test_error_response_raises(
        self, ops: TicketOperations, mock_session: AsyncMock,
    ) -> None:
        mock_session.call_tool.return_value = _call_result(
            {"error": "Invalid category"}, is_error=True,
        )

        with pytest.raises(ToolCallError):
            await ops.memory_add_lesson(
                ticket_id="T-1",
                title="Title",
                content="Content",
                category="bug_fix",
            )

    async def test_is_async(self) -> None:
        assert inspect.iscoroutinefunction(TicketOperations.memory_add_lesson)


# ===========================================================================
# AC6: Tool definitions registered — memory_get_context
# ===========================================================================


class TestMemoryGetContextOp:
    """AC6 — memory_get_context calls memory.get_context."""

    async def test_returns_context_response(
        self, ops: TicketOperations, mock_session: AsyncMock,
    ) -> None:
        mock_session.call_tool.return_value = _call_result({
            "blast_radius": ["src/db/pool.ts", "src/db/config.ts"],
            "relevant_lessons": [
                {
                    "id": "L-1",
                    "title": "Pool lesson",
                    "content": "Use pgBouncer",
                    "category": "architecture",
                    "confidence": 0.9,
                    "similarity_score": 0.85,
                },
            ],
            "context_score": 0.78,
        })

        result = await ops.memory_get_context(file_path="src/db/pool.ts")

        assert isinstance(result, ContextResponse)
        assert len(result.blast_radius) == 2
        assert len(result.relevant_lessons) == 1
        assert result.relevant_lessons[0].id == "L-1"
        assert result.context_score == 0.78

    async def test_calls_correct_tool_with_file_path(
        self, ops: TicketOperations, mock_session: AsyncMock,
    ) -> None:
        mock_session.call_tool.return_value = _call_result({
            "blast_radius": [],
            "relevant_lessons": [],
            "context_score": 0.0,
        })

        await ops.memory_get_context(file_path="src/main.ts")

        mock_session.call_tool.assert_called_once_with(
            "memory.get_context", {"file_path": "src/main.ts"},
        )

    async def test_calls_with_ticket_id(
        self, ops: TicketOperations, mock_session: AsyncMock,
    ) -> None:
        mock_session.call_tool.return_value = _call_result({
            "blast_radius": [],
            "relevant_lessons": [],
            "context_score": 0.0,
        })

        await ops.memory_get_context(ticket_id="T-1")

        args = mock_session.call_tool.call_args[0][1]
        assert args["ticket_id"] == "T-1"
        assert "file_path" not in args

    async def test_calls_with_all_params(
        self, ops: TicketOperations, mock_session: AsyncMock,
    ) -> None:
        mock_session.call_tool.return_value = _call_result({
            "blast_radius": [],
            "relevant_lessons": [],
            "context_score": 0.0,
        })

        await ops.memory_get_context(
            file_path="src/a.ts",
            ticket_id="T-2",
            max_lessons=3,
        )

        args = mock_session.call_tool.call_args[0][1]
        assert args["file_path"] == "src/a.ts"
        assert args["ticket_id"] == "T-2"
        assert args["max_lessons"] == 3

    async def test_no_params_sends_empty(
        self, ops: TicketOperations, mock_session: AsyncMock,
    ) -> None:
        mock_session.call_tool.return_value = _call_result({
            "blast_radius": [],
            "relevant_lessons": [],
            "context_score": 0.0,
        })

        await ops.memory_get_context()

        mock_session.call_tool.assert_called_once_with(
            "memory.get_context", {},
        )

    async def test_error_response_raises(
        self, ops: TicketOperations, mock_session: AsyncMock,
    ) -> None:
        mock_session.call_tool.return_value = _call_result(
            {"error": "Index not ready"}, is_error=True,
        )

        with pytest.raises(ToolCallError):
            await ops.memory_get_context(file_path="src/a.ts")

    async def test_is_async(self) -> None:
        assert inspect.iscoroutinefunction(TicketOperations.memory_get_context)

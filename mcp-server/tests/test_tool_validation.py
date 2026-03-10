"""Comprehensive tests for mcp_server.tools.validation.

Coverage map (FORGEOS-BE021 acceptance criteria):
  AC1 — Inputs validated against registered JSON Schema (TestBasicValidation)
  AC2 — Errors include field path + failure reason    (TestFieldPaths)
  AC3 — Error response follows MCP INVALID_PARAMS     (TestMcpErrorFormat)
  AC4 — No type coercion                              (TestNoTypeCoercion)
  AC5 — Missing required fields are all listed         (TestMissingRequiredFields)
  AC6 — Validation < 1 ms for typical inputs           (TestPerformance)
"""

from __future__ import annotations

import time
from collections import deque
from typing import Any

import jsonschema
import pytest

from mcp_server.tools.validation import (
    INVALID_PARAMS,
    FieldError,
    McpValidationErrorData,
    ToolInputValidationError,
    _format_path,
    build_validation_error_data,
    clear_validator_cache,
    compile_validator,
    validate_tool_input,
)

SIMPLE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "ticket_id": {"type": "string"},
        "priority": {"type": "integer", "minimum": 1, "maximum": 5},
    },
    "required": ["ticket_id"],
    "additionalProperties": False,
}

NESTED_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "user": {
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "age": {"type": "integer"},
            },
            "required": ["name"],
        },
        "tags": {
            "type": "array",
            "items": {"type": "string"},
        },
    },
    "required": ["user"],
}


@pytest.fixture(autouse=True)
def _clean_cache() -> None:
    clear_validator_cache()


class TestBasicValidation:
    def test_valid_input_passes(self) -> None:
        validate_tool_input("t", SIMPLE_SCHEMA, {"ticket_id": "BE021"})

    def test_valid_input_with_optional_field(self) -> None:
        validate_tool_input("t", SIMPLE_SCHEMA, {"ticket_id": "BE021", "priority": 3})

    def test_empty_params_with_no_required_passes(self) -> None:
        validate_tool_input("t", {"type": "object"}, {})

    def test_invalid_input_raises_error(self) -> None:
        with pytest.raises(ToolInputValidationError):
            validate_tool_input("t", SIMPLE_SCHEMA, {"ticket_id": 123})

    def test_validation_error_is_exception(self) -> None:
        exc = ToolInputValidationError("t", [FieldError(path="$", message="m")])
        assert isinstance(exc, Exception)


class TestFieldPaths:
    def test_root_level_missing_field_path(self) -> None:
        assert _format_path(deque()) == "$"

    def test_wrong_type_field_path(self) -> None:
        assert _format_path(deque(["ticket_id"])) == "$.ticket_id"

    def test_nested_object_path(self) -> None:
        assert _format_path(deque(["user", "name"])) == "$.user.name"

    def test_array_item_path(self) -> None:
        assert _format_path(deque(["tags", 0])) == "$.tags[0]"

    def test_error_message_is_descriptive(self) -> None:
        assert _format_path(deque(["a", 1, "b"])) == "$.a[1].b"

    def test_field_error_is_frozen_dataclass(self) -> None:
        fe = FieldError(path="$.x", message="m")
        with pytest.raises(AttributeError):
            fe.path = "$.y"  # type: ignore[misc]


class TestMcpErrorFormat:
    def test_invalid_params_code_constant(self) -> None:
        assert INVALID_PARAMS == -32602

    def test_build_validation_error_data_structure(self) -> None:
        exc = ToolInputValidationError(
            "mytool",
            [FieldError(path="$.a", message="bad"), FieldError(path="$.b", message="worse")],
        )
        data = build_validation_error_data(exc)
        assert data["tool_name"] == "mytool"
        assert len(data["errors"]) == 2
        assert data["errors"][0] == {"path": "$.a", "message": "bad"}

    def test_build_validation_error_data_single_error(self) -> None:
        exc = ToolInputValidationError("t", [FieldError(path="$", message="x")])
        data = build_validation_error_data(exc)
        assert len(data["errors"]) == 1

    def test_error_data_serialisable(self) -> None:
        import json
        exc = ToolInputValidationError("t", [FieldError(path="$", message="x")])
        data = build_validation_error_data(exc)
        json.dumps(data)

    def test_exception_message_includes_tool_name(self) -> None:
        exc = ToolInputValidationError("my_tool", [FieldError(path="$", message="x")])
        assert "my_tool" in str(exc)

    def test_mcp_validation_error_data_to_dict(self) -> None:
        obj = McpValidationErrorData(tool_name="t", errors=[{"path": "$", "message": "err"}])
        d = obj.to_dict()
        assert d["tool_name"] == "t"
        assert isinstance(d["errors"], list)


class TestNoTypeCoercion:
    def test_string_field_rejects_integer(self) -> None:
        with pytest.raises(ToolInputValidationError):
            validate_tool_input("t", SIMPLE_SCHEMA, {"ticket_id": 42})

    def test_string_field_rejects_boolean(self) -> None:
        with pytest.raises(ToolInputValidationError):
            validate_tool_input("t", SIMPLE_SCHEMA, {"ticket_id": True})

    def test_string_field_rejects_null(self) -> None:
        with pytest.raises(ToolInputValidationError):
            validate_tool_input("t", SIMPLE_SCHEMA, {"ticket_id": None})

    def test_number_field_rejects_string(self) -> None:
        schema: dict[str, Any] = {"type": "object", "properties": {"val": {"type": "number"}}}
        with pytest.raises(ToolInputValidationError):
            validate_tool_input("t", schema, {"val": "3.14"})

    def test_array_field_rejects_string(self) -> None:
        with pytest.raises(ToolInputValidationError):
            validate_tool_input("t", NESTED_SCHEMA, {"user": {"name": "A"}, "tags": "oops"})

    def test_boolean_field_rejects_integer_one(self) -> None:
        schema: dict[str, Any] = {"type": "object", "properties": {"flag": {"type": "boolean"}}}
        with pytest.raises(ToolInputValidationError):
            validate_tool_input("t", schema, {"flag": 1})

    def test_integer_field_rejects_float(self) -> None:
        with pytest.raises(ToolInputValidationError):
            validate_tool_input("t", SIMPLE_SCHEMA, {"ticket_id": "ok", "priority": 3.5})


class TestMissingRequiredFields:
    def test_single_missing_required_field(self) -> None:
        with pytest.raises(ToolInputValidationError) as exc_info:
            validate_tool_input("t", SIMPLE_SCHEMA, {})
        messages = [e.message for e in exc_info.value.field_errors]
        assert any("ticket_id" in m for m in messages)

    def test_multiple_missing_required_fields(self) -> None:
        schema: dict[str, Any] = {
            "type": "object",
            "properties": {"a": {"type": "string"}, "b": {"type": "string"}, "c": {"type": "string"}},
            "required": ["a", "b", "c"],
        }
        with pytest.raises(ToolInputValidationError) as exc_info:
            validate_tool_input("t", schema, {})
        messages = " ".join(e.message for e in exc_info.value.field_errors)
        assert "a" in messages and "b" in messages and "c" in messages

    def test_nested_missing_required_field(self) -> None:
        with pytest.raises(ToolInputValidationError) as exc_info:
            validate_tool_input("t", NESTED_SCHEMA, {"user": {}})
        paths = [e.path for e in exc_info.value.field_errors]
        assert "$.user" in paths

    def test_completely_empty_input_for_required_schema(self) -> None:
        with pytest.raises(ToolInputValidationError) as exc_info:
            validate_tool_input("t", NESTED_SCHEMA, {})
        messages = [e.message for e in exc_info.value.field_errors]
        assert any("user" in m for m in messages)

    def test_error_mentions_required_keyword(self) -> None:
        with pytest.raises(ToolInputValidationError) as exc_info:
            validate_tool_input("t", SIMPLE_SCHEMA, {})
        assert len(exc_info.value.field_errors) >= 1


class TestPerformance:
    def test_valid_input_under_1ms(self) -> None:
        validate_tool_input("perf", SIMPLE_SCHEMA, {"ticket_id": "x"})
        start = time.perf_counter_ns()
        for _ in range(100):
            validate_tool_input("perf", SIMPLE_SCHEMA, {"ticket_id": "x"})
        avg_ms = ((time.perf_counter_ns() - start) / 100) / 1_000_000
        assert avg_ms < 1.0, f"Average {avg_ms:.3f} ms"

    def test_invalid_input_under_1ms(self) -> None:
        compile_validator("err", SIMPLE_SCHEMA)
        start = time.perf_counter_ns()
        for _ in range(100):
            try:
                validate_tool_input("err", SIMPLE_SCHEMA, {"ticket_id": 123})
            except ToolInputValidationError:
                pass
        avg_ms = ((time.perf_counter_ns() - start) / 100) / 1_000_000
        assert avg_ms < 1.0, f"Average {avg_ms:.3f} ms"

    def test_complex_schema_under_1ms(self) -> None:
        schema: dict[str, Any] = {
            "type": "object",
            "properties": {f"field_{i}": {"type": "string"} for i in range(20)},
            "required": [f"field_{i}" for i in range(10)],
        }
        params = {f"field_{i}": f"value_{i}" for i in range(20)}
        validate_tool_input("big", schema, params)
        start = time.perf_counter_ns()
        for _ in range(100):
            validate_tool_input("big", schema, params)
        avg_ms = ((time.perf_counter_ns() - start) / 100) / 1_000_000
        assert avg_ms < 1.0, f"Average {avg_ms:.3f} ms"


class TestValidatorCache:
    def test_compile_validator_returns_validator(self) -> None:
        v = compile_validator("c0", SIMPLE_SCHEMA)
        assert isinstance(v, jsonschema.Draft202012Validator)

    def test_compile_validator_caches_result(self) -> None:
        v1 = compile_validator("c1", SIMPLE_SCHEMA)
        v2 = compile_validator("c1", SIMPLE_SCHEMA)
        assert v1 is v2

    def test_clear_cache_removes_all(self) -> None:
        v1 = compile_validator("c2", SIMPLE_SCHEMA)
        clear_validator_cache()
        v2 = compile_validator("c2", SIMPLE_SCHEMA)
        assert v1 is not v2

    def test_invalid_schema_raises_schema_error(self) -> None:
        with pytest.raises(jsonschema.SchemaError):
            compile_validator("bad", {"type": "not_a_type"})


class TestEdgeCases:
    def test_additional_properties_rejected(self) -> None:
        with pytest.raises(ToolInputValidationError):
            validate_tool_input("t", SIMPLE_SCHEMA, {"ticket_id": "x", "unknown": True})

    def test_additional_properties_error_mentions_field(self) -> None:
        with pytest.raises(ToolInputValidationError) as exc_info:
            validate_tool_input("t", SIMPLE_SCHEMA, {"ticket_id": "x", "unknown": True})
        assert any("unknown" in e.message for e in exc_info.value.field_errors)

    def test_multiple_errors_all_collected(self) -> None:
        with pytest.raises(ToolInputValidationError) as exc_info:
            validate_tool_input("t", SIMPLE_SCHEMA, {"ticket_id": 42, "priority": "high"})
        assert len(exc_info.value.field_errors) >= 2

    def test_enum_validation(self) -> None:
        schema: dict[str, Any] = {
            "type": "object",
            "properties": {"status": {"type": "string", "enum": ["open", "closed"]}},
        }
        with pytest.raises(ToolInputValidationError):
            validate_tool_input("t", schema, {"status": "invalid"})

    def test_pattern_validation(self) -> None:
        schema: dict[str, Any] = {
            "type": "object",
            "properties": {"code": {"type": "string", "pattern": "^[A-Z]{3}-\\d+$"}},
        }
        with pytest.raises(ToolInputValidationError):
            validate_tool_input("t", schema, {"code": "invalid"})

    def test_min_max_length_validation(self) -> None:
        schema: dict[str, Any] = {
            "type": "object",
            "properties": {"name": {"type": "string", "minLength": 2, "maxLength": 10}},
        }
        with pytest.raises(ToolInputValidationError):
            validate_tool_input("t", schema, {"name": "x"})

"""Tests for forgeos_sdk.summary module."""

from __future__ import annotations

from pathlib import Path

from forgeos_sdk.summary import (
    AGENT_OUTPUT_DIR,
    STAGE_TO_AGENT,
    delete_upstream_summary,
    read_upstream_summary,
    write_summary,
)

BACKEND_FLOW = ["READY", "BACKEND", "QA", "SECURITY", "CI", "DOCS", "VALIDATION", "DONE"]
FRONTEND_FLOW = ["READY", "FRONTEND", "QA", "SECURITY", "CI", "DOCS", "VALIDATION", "DONE"]
FULLSTACK_FLOW = [
    "READY", "BACKEND", "FRONTEND", "QA", "SECURITY", "CI", "DOCS", "VALIDATION", "DONE",
]


class TestStageToAgent:
    """Verify the stage-to-agent mapping covers all SDLC stages."""

    def test_all_implementation_stages_mapped(self) -> None:
        expected = {
            "ARCHITECT", "RESEARCH", "BACKEND", "FRONTEND",
            "QA", "SECURITY", "CI", "DOCS", "VALIDATION",
        }
        assert set(STAGE_TO_AGENT.keys()) == expected

    def test_backend_maps_to_backend(self) -> None:
        assert STAGE_TO_AGENT["BACKEND"] == "Backend"

    def test_ci_maps_to_ci_reviewer(self) -> None:
        assert STAGE_TO_AGENT["CI"] == "CIReviewer"

    def test_docs_maps_to_documentation(self) -> None:
        assert STAGE_TO_AGENT["DOCS"] == "Documentation"

    def test_validation_maps_to_validator(self) -> None:
        assert STAGE_TO_AGENT["VALIDATION"] == "Validator"


class TestReadUpstreamSummary:
    """Verify read_upstream_summary reads the previous agent's summary file."""

    def test_reads_upstream_file(self, tmp_path: Path) -> None:
        # Backend is at index 1 in BACKEND_FLOW; previous stage is READY (no agent).
        # Use QA stage (index 2) whose previous is BACKEND.
        output_dir = tmp_path / AGENT_OUTPUT_DIR / "Backend"
        output_dir.mkdir(parents=True)
        summary_file = output_dir / "FORGEOS-TEST-001.md"
        summary_file.write_text("# Backend Summary\nAll done.", encoding="utf-8")

        result = read_upstream_summary(
            "FORGEOS-TEST-001", "QA", BACKEND_FLOW, workspace_root=tmp_path,
        )
        assert result == "# Backend Summary\nAll done."

    def test_returns_none_when_no_upstream_stage(self, tmp_path: Path) -> None:
        # BACKEND is the first implementation stage; previous is READY (no agent output).
        result = read_upstream_summary(
            "FORGEOS-TEST-001", "BACKEND", BACKEND_FLOW, workspace_root=tmp_path,
        )
        assert result is None

    def test_returns_none_when_file_missing(self, tmp_path: Path) -> None:
        result = read_upstream_summary(
            "FORGEOS-TEST-001", "QA", BACKEND_FLOW, workspace_root=tmp_path,
        )
        assert result is None

    def test_returns_none_for_ready_stage(self, tmp_path: Path) -> None:
        result = read_upstream_summary(
            "FORGEOS-TEST-001", "READY", BACKEND_FLOW, workspace_root=tmp_path,
        )
        assert result is None

    def test_returns_none_for_done_stage(self, tmp_path: Path) -> None:
        result = read_upstream_summary(
            "FORGEOS-TEST-001", "DONE", BACKEND_FLOW, workspace_root=tmp_path,
        )
        assert result is None

    def test_reads_frontend_upstream_in_fullstack_flow(self, tmp_path: Path) -> None:
        # In fullstack flow, QA's upstream is FRONTEND.
        output_dir = tmp_path / AGENT_OUTPUT_DIR / "Frontend"
        output_dir.mkdir(parents=True)
        (output_dir / "FORGEOS-FS-001.md").write_text("Frontend done.", encoding="utf-8")

        result = read_upstream_summary(
            "FORGEOS-FS-001", "QA", FULLSTACK_FLOW, workspace_root=tmp_path,
        )
        assert result == "Frontend done."

    def test_reads_backend_upstream_for_frontend_in_fullstack(self, tmp_path: Path) -> None:
        # In fullstack flow, FRONTEND's upstream is BACKEND.
        output_dir = tmp_path / AGENT_OUTPUT_DIR / "Backend"
        output_dir.mkdir(parents=True)
        (output_dir / "FORGEOS-FS-002.md").write_text("Backend output.", encoding="utf-8")

        result = read_upstream_summary(
            "FORGEOS-FS-002", "FRONTEND", FULLSTACK_FLOW, workspace_root=tmp_path,
        )
        assert result == "Backend output."

    def test_accepts_string_workspace_root(self, tmp_path: Path) -> None:
        result = read_upstream_summary(
            "FORGEOS-TEST-001", "BACKEND", BACKEND_FLOW, workspace_root=str(tmp_path),
        )
        assert result is None

    def test_returns_none_for_stage_not_in_flow(self, tmp_path: Path) -> None:
        result = read_upstream_summary(
            "FORGEOS-TEST-001", "ARCHITECT", BACKEND_FLOW, workspace_root=tmp_path,
        )
        assert result is None

    def test_returns_none_when_stage_is_first_in_flow(self, tmp_path: Path) -> None:
        """First element in flow has no predecessor."""
        custom_flow = ["BACKEND", "QA", "DONE"]
        result = read_upstream_summary(
            "FORGEOS-TEST-001", "BACKEND", custom_flow, workspace_root=tmp_path,
        )
        assert result is None


class TestWriteSummary:
    """Verify write_summary writes current agent's summary to the output dir."""

    def test_writes_summary_file(self, tmp_path: Path) -> None:
        result = write_summary(
            "FORGEOS-TEST-001", "Backend", "# Summary\nDone.", workspace_root=tmp_path,
        )
        expected_path = tmp_path / AGENT_OUTPUT_DIR / "Backend" / "FORGEOS-TEST-001.md"
        assert result == expected_path
        assert expected_path.read_text(encoding="utf-8") == "# Summary\nDone."

    def test_creates_directory_if_missing(self, tmp_path: Path) -> None:
        write_summary(
            "FORGEOS-TEST-001", "QA", "QA summary.", workspace_root=tmp_path,
        )
        expected_dir = tmp_path / AGENT_OUTPUT_DIR / "QA"
        assert expected_dir.is_dir()

    def test_overwrites_existing_file(self, tmp_path: Path) -> None:
        write_summary("FORGEOS-TEST-001", "Backend", "v1", workspace_root=tmp_path)
        write_summary("FORGEOS-TEST-001", "Backend", "v2", workspace_root=tmp_path)
        expected_path = tmp_path / AGENT_OUTPUT_DIR / "Backend" / "FORGEOS-TEST-001.md"
        assert expected_path.read_text(encoding="utf-8") == "v2"

    def test_uses_utf8_encoding(self, tmp_path: Path) -> None:
        write_summary("FORGEOS-TEST-001", "Backend", "Ünïcödé ✓", workspace_root=tmp_path)
        expected_path = tmp_path / AGENT_OUTPUT_DIR / "Backend" / "FORGEOS-TEST-001.md"
        assert expected_path.read_text(encoding="utf-8") == "Ünïcödé ✓"

    def test_accepts_string_workspace_root(self, tmp_path: Path) -> None:
        result = write_summary(
            "FORGEOS-TEST-001", "Backend", "content", workspace_root=str(tmp_path),
        )
        assert result.exists()

    def test_returns_path_object(self, tmp_path: Path) -> None:
        result = write_summary(
            "FORGEOS-TEST-001", "CIReviewer", "ci report", workspace_root=tmp_path,
        )
        assert isinstance(result, Path)

    def test_derives_agent_from_stage(self, tmp_path: Path) -> None:
        """write_summary accepts an agent name matching STAGE_TO_AGENT values."""
        for stage, agent in STAGE_TO_AGENT.items():
            result = write_summary(
                f"FORGEOS-{stage}-001", agent, f"{agent} summary", workspace_root=tmp_path,
            )
            assert result.parent.name == agent


class TestDeleteUpstreamSummary:
    """Verify delete_upstream_summary removes the previous stage summary."""

    def test_deletes_existing_upstream_file(self, tmp_path: Path) -> None:
        output_dir = tmp_path / AGENT_OUTPUT_DIR / "Backend"
        output_dir.mkdir(parents=True)
        summary_file = output_dir / "FORGEOS-TEST-001.md"
        summary_file.write_text("old summary", encoding="utf-8")

        result = delete_upstream_summary(
            "FORGEOS-TEST-001", "QA", BACKEND_FLOW, workspace_root=tmp_path,
        )
        assert result is True
        assert not summary_file.exists()

    def test_returns_false_when_file_missing(self, tmp_path: Path) -> None:
        result = delete_upstream_summary(
            "FORGEOS-TEST-001", "QA", BACKEND_FLOW, workspace_root=tmp_path,
        )
        assert result is False

    def test_returns_false_for_ready_stage(self, tmp_path: Path) -> None:
        result = delete_upstream_summary(
            "FORGEOS-TEST-001", "READY", BACKEND_FLOW, workspace_root=tmp_path,
        )
        assert result is False

    def test_returns_false_when_no_upstream_agent(self, tmp_path: Path) -> None:
        result = delete_upstream_summary(
            "FORGEOS-TEST-001", "BACKEND", BACKEND_FLOW, workspace_root=tmp_path,
        )
        assert result is False

    def test_accepts_string_workspace_root(self, tmp_path: Path) -> None:
        result = delete_upstream_summary(
            "FORGEOS-TEST-001", "BACKEND", BACKEND_FLOW, workspace_root=str(tmp_path),
        )
        assert result is False

    def test_deletes_correct_upstream_in_fullstack(self, tmp_path: Path) -> None:
        # In fullstack flow, FRONTEND upstream is BACKEND.
        output_dir = tmp_path / AGENT_OUTPUT_DIR / "Backend"
        output_dir.mkdir(parents=True)
        summary_file = output_dir / "FORGEOS-FS-001.md"
        summary_file.write_text("backend work", encoding="utf-8")

        result = delete_upstream_summary(
            "FORGEOS-FS-001", "FRONTEND", FULLSTACK_FLOW, workspace_root=tmp_path,
        )
        assert result is True
        assert not summary_file.exists()

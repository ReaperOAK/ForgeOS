"""Tests for role-based claim restrictions — FORGEOS-BE055.

Covers:
- RoleStagePolicy default mapping for all 14 agent roles
- RoleStagePolicy configurability (add/remove/override mappings)
- check_role_stage_authorization — happy path
- check_role_stage_authorization — mismatch rejection
- Operator bypass with role_override
- RoleStageMismatchError error shape (403, descriptive message)
- TicketService.claim_next integration with role-stage check
- Edge cases (unknown roles, empty strings, case insensitivity)

TDD Evidence
------------
- RED: Tests written first to define expected behavior.
- GREEN: Implementation created to satisfy these tests.
- REFACTOR: Code cleaned up, naming standardized.

.. meta::
   :ticket: FORGEOS-BE055
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from mcp_server.auth.authorization import (
    OPERATOR_ROLE,
    RoleStageMismatchError,
    RoleStagePolicy,
    check_role_stage_authorization,
)
from mcp_server.server import ForgeOSError

# ---------------------------------------------------------------------------
# RoleStageMismatchError
# ---------------------------------------------------------------------------


class TestRoleStageMismatchError:
    """Tests for the RoleStageMismatchError exception."""

    def test_is_forgeos_error(self) -> None:
        err = RoleStageMismatchError("denied")
        assert isinstance(err, ForgeOSError)

    def test_status_code_403(self) -> None:
        err = RoleStageMismatchError("denied")
        assert err.status_code == 403

    def test_message_preserved(self) -> None:
        err = RoleStageMismatchError("Backend cannot claim QA tickets")
        assert str(err) == "Backend cannot claim QA tickets"

    def test_details_preserved(self) -> None:
        err = RoleStageMismatchError(
            "mismatch",
            details={
                "reason": "role_stage_mismatch",
                "agent_role": "backend",
                "ticket_stage": "QA",
            },
        )
        assert err.details["reason"] == "role_stage_mismatch"
        assert err.details["agent_role"] == "backend"
        assert err.details["ticket_stage"] == "QA"


# ---------------------------------------------------------------------------
# OPERATOR_ROLE constant
# ---------------------------------------------------------------------------


class TestOperatorRoleConstant:
    """Tests for the OPERATOR_ROLE constant."""

    def test_operator_role_defined(self) -> None:
        assert isinstance(OPERATOR_ROLE, str)
        assert OPERATOR_ROLE == "operator"


# ---------------------------------------------------------------------------
# RoleStagePolicy — default mapping
# ---------------------------------------------------------------------------


class TestRoleStagePolicyDefaults:
    """Tests for the default role-to-stage mapping in RoleStagePolicy."""

    def setup_method(self) -> None:
        self.policy = RoleStagePolicy()

    def test_architect_maps_to_architect(self) -> None:
        assert self.policy.stage_for_role("architect") == "ARCHITECT"

    def test_research_maps_to_research(self) -> None:
        assert self.policy.stage_for_role("research") == "RESEARCH"

    def test_product_manager_maps_to_product_manager(self) -> None:
        assert self.policy.stage_for_role("product_manager") == "PRODUCT_MANAGER"

    def test_ui_designer_maps_to_ui_design(self) -> None:
        assert self.policy.stage_for_role("ui_designer") == "UI_DESIGN"

    def test_backend_maps_to_backend(self) -> None:
        assert self.policy.stage_for_role("backend") == "BACKEND"

    def test_devops_maps_to_backend(self) -> None:
        assert self.policy.stage_for_role("devops") == "BACKEND"

    def test_frontend_maps_to_frontend(self) -> None:
        assert self.policy.stage_for_role("frontend") == "FRONTEND"

    def test_qa_maps_to_qa(self) -> None:
        assert self.policy.stage_for_role("qa") == "QA"

    def test_security_maps_to_security(self) -> None:
        assert self.policy.stage_for_role("security") == "SECURITY"

    def test_ci_maps_to_ci(self) -> None:
        assert self.policy.stage_for_role("ci") == "CI"

    def test_documentation_maps_to_documentation(self) -> None:
        assert self.policy.stage_for_role("documentation") == "DOCUMENTATION"

    def test_validator_maps_to_validator(self) -> None:
        assert self.policy.stage_for_role("validator") == "VALIDATOR"

    def test_todo_maps_to_none(self) -> None:
        # TODO agent creates tickets, does not process stages
        assert self.policy.stage_for_role("todo") is None

    def test_dispatcher_maps_to_none(self) -> None:
        # ReaperOAK dispatcher does not claim tickets
        assert self.policy.stage_for_role("dispatcher") is None

    def test_unknown_role_returns_none(self) -> None:
        assert self.policy.stage_for_role("nonexistent") is None

    def test_case_insensitive_lookup(self) -> None:
        assert self.policy.stage_for_role("Backend") == "BACKEND"
        assert self.policy.stage_for_role("BACKEND") == "BACKEND"
        assert self.policy.stage_for_role("QA") == "QA"

    def test_all_14_roles_present(self) -> None:
        """Verify all 14 agent roles are in the mapping."""
        expected_roles = {
            "architect", "research", "product_manager", "ui_designer",
            "backend", "devops", "frontend", "qa", "security",
            "ci", "documentation", "validator", "todo", "dispatcher",
        }
        assert expected_roles <= set(self.policy.all_roles())


# ---------------------------------------------------------------------------
# RoleStagePolicy — configurability
# ---------------------------------------------------------------------------


class TestRoleStagePolicyConfigurable:
    """Tests that the role-to-stage mapping is configurable."""

    def test_custom_mapping_overrides_default(self) -> None:
        custom = {"backend": "CUSTOM_STAGE"}
        policy = RoleStagePolicy(overrides=custom)
        assert policy.stage_for_role("backend") == "CUSTOM_STAGE"

    def test_custom_mapping_adds_new_role(self) -> None:
        custom = {"new_role": "NEW_STAGE"}
        policy = RoleStagePolicy(overrides=custom)
        assert policy.stage_for_role("new_role") == "NEW_STAGE"
        # Existing roles still work
        assert policy.stage_for_role("qa") == "QA"

    def test_add_role_updates_policy(self) -> None:
        policy = RoleStagePolicy()
        policy.add_role("custom_agent", "CUSTOM_STAGE")
        assert policy.stage_for_role("custom_agent") == "CUSTOM_STAGE"

    def test_remove_role_deletes_mapping(self) -> None:
        policy = RoleStagePolicy()
        policy.remove_role("backend")
        assert policy.stage_for_role("backend") is None

    def test_all_roles_returns_all_keys(self) -> None:
        policy = RoleStagePolicy()
        roles = policy.all_roles()
        assert "backend" in roles
        assert "qa" in roles

    def test_is_authorized_role(self) -> None:
        policy = RoleStagePolicy()
        assert policy.is_authorized_role("backend") is True
        assert policy.is_authorized_role("nonexistent") is False


# ---------------------------------------------------------------------------
# check_role_stage_authorization — happy paths
# ---------------------------------------------------------------------------


class TestCheckRoleStageAuthorizationHappy:
    """Tests for successful role-stage authorization checks."""

    def test_backend_can_claim_backend_stage(self) -> None:
        check_role_stage_authorization("backend", "BACKEND")

    def test_qa_can_claim_qa_stage(self) -> None:
        check_role_stage_authorization("qa", "QA")

    def test_security_can_claim_security_stage(self) -> None:
        check_role_stage_authorization("security", "SECURITY")

    def test_frontend_can_claim_frontend_stage(self) -> None:
        check_role_stage_authorization("frontend", "FRONTEND")

    def test_ci_can_claim_ci_stage(self) -> None:
        check_role_stage_authorization("ci", "CI")

    def test_documentation_can_claim_docs_stage(self) -> None:
        check_role_stage_authorization("documentation", "DOCUMENTATION")

    def test_validator_can_claim_validation_stage(self) -> None:
        check_role_stage_authorization("validator", "VALIDATOR")

    def test_devops_can_claim_backend_stage(self) -> None:
        check_role_stage_authorization("devops", "BACKEND")

    def test_case_insensitive_role(self) -> None:
        check_role_stage_authorization("Backend", "BACKEND")

    def test_case_insensitive_stage(self) -> None:
        check_role_stage_authorization("backend", "backend")


# ---------------------------------------------------------------------------
# check_role_stage_authorization — mismatch rejections
# ---------------------------------------------------------------------------


class TestCheckRoleStageAuthorizationMismatch:
    """Tests for mismatch role-stage claim rejections."""

    def test_backend_cannot_claim_qa_stage(self) -> None:
        with pytest.raises(RoleStageMismatchError) as exc_info:
            check_role_stage_authorization("backend", "QA")
        assert exc_info.value.status_code == 403
        assert "backend" in str(exc_info.value).lower()
        assert exc_info.value.details["reason"] == "role_stage_mismatch"

    def test_qa_cannot_claim_backend_stage(self) -> None:
        with pytest.raises(RoleStageMismatchError):
            check_role_stage_authorization("qa", "BACKEND")

    def test_frontend_cannot_claim_security_stage(self) -> None:
        with pytest.raises(RoleStageMismatchError):
            check_role_stage_authorization("frontend", "SECURITY")

    def test_unknown_role_raises_mismatch(self) -> None:
        with pytest.raises(RoleStageMismatchError) as exc_info:
            check_role_stage_authorization("nonexistent", "BACKEND")
        assert exc_info.value.details["reason"] == "unknown_agent_role"

    def test_empty_role_raises_mismatch(self) -> None:
        with pytest.raises(RoleStageMismatchError):
            check_role_stage_authorization("", "BACKEND")

    def test_empty_stage_raises_mismatch(self) -> None:
        with pytest.raises(RoleStageMismatchError):
            check_role_stage_authorization("backend", "")

    def test_error_includes_agent_role_in_details(self) -> None:
        with pytest.raises(RoleStageMismatchError) as exc_info:
            check_role_stage_authorization("backend", "QA")
        assert exc_info.value.details["agent_role"] == "backend"
        assert exc_info.value.details["ticket_stage"] == "QA"
        assert exc_info.value.details["authorized_stage"] == "BACKEND"


# ---------------------------------------------------------------------------
# Operator bypass with role_override
# ---------------------------------------------------------------------------


class TestOperatorRoleOverride:
    """Tests for operator claims with explicit role override."""

    def test_operator_bypasses_stage_check(self) -> None:
        # Operator calling with role_override should succeed for any stage
        check_role_stage_authorization(
            "operator", "BACKEND", role_override="backend"
        )

    def test_operator_with_override_checks_override_role(self) -> None:
        # The override role must match the stage
        with pytest.raises(RoleStageMismatchError):
            check_role_stage_authorization(
                "operator", "QA", role_override="backend"
            )

    def test_operator_without_override_can_claim_any_stage(self) -> None:
        # Operator without role_override bypasses all stage checks
        check_role_stage_authorization("operator", "BACKEND")
        check_role_stage_authorization("operator", "QA")
        check_role_stage_authorization("operator", "SECURITY")
        check_role_stage_authorization("operator", "FRONTEND")

    def test_admin_bypasses_stage_check(self) -> None:
        # Admin role also bypasses
        check_role_stage_authorization("admin", "BACKEND")
        check_role_stage_authorization("admin", "QA")


# ---------------------------------------------------------------------------
# Custom policy in check_role_stage_authorization
# ---------------------------------------------------------------------------


class TestCheckWithCustomPolicy:
    """Tests for check_role_stage_authorization with custom policy."""

    def test_custom_policy_used(self) -> None:
        policy = RoleStagePolicy(overrides={"custom_agent": "CUSTOM_STAGE"})
        check_role_stage_authorization("custom_agent", "CUSTOM_STAGE", policy=policy)

    def test_custom_policy_rejects_mismatch(self) -> None:
        policy = RoleStagePolicy(overrides={"custom_agent": "CUSTOM_STAGE"})
        with pytest.raises(RoleStageMismatchError):
            check_role_stage_authorization(
                "custom_agent", "WRONG_STAGE", policy=policy
            )


# ---------------------------------------------------------------------------
# TicketService integration
# ---------------------------------------------------------------------------


class TestTicketServiceRoleStageIntegration:
    """Tests that TicketService.claim_next enforces role-stage authorization."""

    async def test_claim_next_rejects_role_stage_mismatch(self) -> None:
        """Backend agent cannot claim a ticket in QA stage."""
        from mcp_server.locking.claim_queue import ClaimQueue
        from mcp_server.services.ticket_service import TicketService

        mock_queue = MagicMock(spec=ClaimQueue)
        service = TicketService(claim_queue=mock_queue)

        with pytest.raises(RoleStageMismatchError):
            await service.claim_next(
                agent_role="backend",
                machine_id="pop-os",
                operator="ReaperOAK",
                target_stage="QA",
            )

    async def test_claim_next_allows_matching_role_stage(self) -> None:
        """Backend agent can claim when target_stage matches."""
        from mcp_server.locking.claim_queue import ClaimQueue, ClaimResult
        from mcp_server.services.ticket_service import TicketService

        mock_result = MagicMock(spec=ClaimResult)
        mock_result.ticket_id = "FORGEOS-BE001"
        mock_result.title = "Test ticket"
        mock_result.ticket_type = "backend"
        mock_result.stage = "BACKEND"
        mock_result.file_paths = []
        mock_result.acceptance_criteria = []

        mock_queue = AsyncMock(spec=ClaimQueue)
        mock_queue.claim_next.return_value = mock_result

        service = TicketService(claim_queue=mock_queue)

        result = await service.claim_next(
            agent_role="backend",
            machine_id="pop-os",
            operator="ReaperOAK",
        )
        assert result.ticket_id == "FORGEOS-BE001"

    async def test_claim_next_operator_bypasses_with_override(self) -> None:
        """Operator can claim any ticket with explicit role_override."""
        from mcp_server.locking.claim_queue import ClaimQueue, ClaimResult
        from mcp_server.services.ticket_service import TicketService

        mock_result = MagicMock(spec=ClaimResult)
        mock_result.ticket_id = "FORGEOS-BE002"
        mock_result.title = "Test ticket 2"
        mock_result.ticket_type = "backend"
        mock_result.stage = "BACKEND"
        mock_result.file_paths = []
        mock_result.acceptance_criteria = []

        mock_queue = AsyncMock(spec=ClaimQueue)
        mock_queue.claim_next.return_value = mock_result

        service = TicketService(claim_queue=mock_queue)

        result = await service.claim_next(
            agent_role="operator",
            machine_id="pop-os",
            operator="ReaperOAK",
            role_override="backend",
        )
        assert result.ticket_id == "FORGEOS-BE002"

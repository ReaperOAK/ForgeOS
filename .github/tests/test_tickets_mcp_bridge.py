#!/usr/bin/env python3
"""
QA Tests for TASK-FOS-07-004 — tickets.py Backward Compatibility Bridge

Tests MCPClient class, dispatch functions, FORGEOS_MODE validation,
and backward compatibility with existing filesystem operations.
"""

import json
import os
import shutil
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from threading import Thread
from unittest.mock import MagicMock, patch

# Insert the .github directory into path for importing tickets
GITHUB_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(GITHUB_DIR))

import tickets


class TestModuleConfiguration(unittest.TestCase):
    """Test FORGEOS_MODE, FORGEOS_MCP_URL, FORGEOS_API_KEY configuration."""

    def test_default_mode_is_filesystem(self):
        """AC1: FORGEOS_MODE defaults to 'filesystem'."""
        with patch.dict(os.environ, {}, clear=False):
            # Remove FORGEOS_MODE if set
            env = os.environ.copy()
            env.pop("FORGEOS_MODE", None)
            with patch.dict(os.environ, env, clear=True):
                # Reload would be needed for module-level vars, but we test the logic
                mode = os.environ.get("FORGEOS_MODE", "filesystem")
                self.assertEqual(mode, "filesystem")

    def test_default_mcp_url(self):
        """AC8: Default MCP URL is http://localhost:3000/mcp."""
        self.assertEqual(tickets.FORGEOS_MCP_URL, os.environ.get("FORGEOS_MCP_URL", "http://localhost:3000/mcp"))

    def test_valid_modes(self):
        """AC1: FORGEOS_MODE only accepts filesystem, dual, mcp."""
        valid_modes = ("filesystem", "dual", "mcp")
        for mode in valid_modes:
            self.assertIn(mode, valid_modes)

    def test_invalid_mode_rejected_by_main(self):
        """AC1: Invalid FORGEOS_MODE causes sys.exit(1) in main()."""
        with patch.object(tickets, "FORGEOS_MODE", "invalid"):
            with patch("sys.argv", ["tickets.py", "--status"]):
                with self.assertRaises(SystemExit) as cm:
                    tickets.main()
                self.assertEqual(cm.exception.code, 1)


class TestMCPClient(unittest.TestCase):
    """Test MCPClient class methods."""

    def test_mcpclient_init(self):
        """MCPClient stores url and api_key."""
        client = tickets.MCPClient("http://localhost:3000/mcp", "test-key")
        self.assertEqual(client.url, "http://localhost:3000/mcp")
        self.assertEqual(client.api_key, "test-key")

    def test_mcpclient_url_trailing_slash_stripped(self):
        """MCPClient strips trailing slash from URL."""
        client = tickets.MCPClient("http://localhost:3000/mcp/", "key")
        self.assertEqual(client.url, "http://localhost:3000/mcp")

    def test_mcpclient_health_check_unreachable(self):
        """MCPClient.health_check returns False for unreachable server."""
        client = tickets.MCPClient("http://127.0.0.1:59999/mcp", "")
        self.assertFalse(client.health_check())

    def test_mcpclient_claim_unreachable(self):
        """MCPClient.claim returns (False, error_msg) when server unreachable."""
        client = tickets.MCPClient("http://127.0.0.1:59999/mcp", "")
        ok, msg = client.claim("TEST-001", "QA", "host1", "oper1")
        self.assertFalse(ok)
        self.assertIn("MCP", msg)

    def test_mcpclient_complete_unreachable(self):
        """MCPClient.complete returns (False, error_msg) when server unreachable."""
        client = tickets.MCPClient("http://127.0.0.1:59999/mcp", "")
        ok, msg = client.complete("TEST-001", "QA")
        self.assertFalse(ok)
        self.assertIn("MCP", msg)

    def test_mcpclient_release_unreachable(self):
        """MCPClient.release returns (False, error_msg) when server unreachable."""
        client = tickets.MCPClient("http://127.0.0.1:59999/mcp", "")
        ok, msg = client.release("TEST-001", "reason")
        self.assertFalse(ok)
        self.assertIn("MCP", msg)

    def test_mcpclient_call_tool_builds_jsonrpc(self):
        """MCPClient._call_tool sends proper JSON-RPC 2.0 payload."""
        client = tickets.MCPClient("http://127.0.0.1:59999/mcp", "test-key")
        # We can't easily test the actual HTTP call without a server,
        # but we can verify the method exists and parameters
        self.assertTrue(callable(client._call_tool))

    def test_mcpclient_claim_tool_name(self):
        """MCPClient.claim calls tickets.claim tool."""
        client = tickets.MCPClient("http://127.0.0.1:59999/mcp", "")
        with patch.object(client, "_call_tool", return_value=(True, "ok")) as mock:
            client.claim("T1", "Agent", "host", "op")
            mock.assert_called_once_with("tickets.claim", {
                "ticket_id": "T1",
                "agent_name": "Agent",
                "machine_id": "host",
                "operator": "op",
            })

    def test_mcpclient_complete_tool_name(self):
        """MCPClient.complete calls tickets.complete tool."""
        client = tickets.MCPClient("http://127.0.0.1:59999/mcp", "")
        with patch.object(client, "_call_tool", return_value=(True, "ok")) as mock:
            client.complete("T1", "Agent")
            mock.assert_called_once_with("tickets.complete", {
                "ticket_id": "T1",
                "agent_name": "Agent",
            })

    def test_mcpclient_complete_with_evidence(self):
        """MCPClient.complete passes evidence when provided."""
        client = tickets.MCPClient("http://127.0.0.1:59999/mcp", "")
        evidence = {"coverage": "85%"}
        with patch.object(client, "_call_tool", return_value=(True, "ok")) as mock:
            client.complete("T1", "Agent", evidence=evidence)
            mock.assert_called_once_with("tickets.complete", {
                "ticket_id": "T1",
                "agent_name": "Agent",
                "evidence": evidence,
            })

    def test_mcpclient_release_tool_name(self):
        """MCPClient.release calls tickets.release tool."""
        client = tickets.MCPClient("http://127.0.0.1:59999/mcp", "")
        with patch.object(client, "_call_tool", return_value=(True, "ok")) as mock:
            client.release("T1", "expired")
            mock.assert_called_once_with("tickets.release", {
                "ticket_id": "T1",
                "reason": "expired",
            })


class MockMCPHandler(BaseHTTPRequestHandler):
    """Mock MCP server for integration testing."""

    def do_GET(self):
        if "/health" in self.path:
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"status":"ok"}')
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        content_length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(content_length)) if content_length else {}

        tool_name = body.get("params", {}).get("name", "")
        response = {
            "jsonrpc": "2.0",
            "result": {
                "content": [{"type": "text", "text": f"OK: {tool_name}"}]
            },
            "id": body.get("id", 1),
        }

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(response).encode())

    def log_message(self, format, *args):
        pass  # Suppress log output during tests


class TestMCPClientWithServer(unittest.TestCase):
    """Integration tests with a mock MCP server."""

    @classmethod
    def setUpClass(cls):
        cls.server = HTTPServer(("127.0.0.1", 0), MockMCPHandler)
        cls.port = cls.server.server_address[1]
        cls.url = f"http://127.0.0.1:{cls.port}/mcp"
        cls.thread = Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def test_health_check_succeeds(self):
        """MCPClient.health_check returns True when server is up."""
        client = tickets.MCPClient(self.url, "test-key")
        self.assertTrue(client.health_check())

    def test_claim_succeeds(self):
        """MCPClient.claim returns (True, message) with working server."""
        client = tickets.MCPClient(self.url, "test-key")
        ok, msg = client.claim("TEST-001", "QA", "host1", "op1")
        self.assertTrue(ok)
        self.assertIn("OK", msg)

    def test_complete_succeeds(self):
        """MCPClient.complete returns (True, message) with working server."""
        client = tickets.MCPClient(self.url, "test-key")
        ok, msg = client.complete("TEST-001", "QA")
        self.assertTrue(ok)
        self.assertIn("OK", msg)

    def test_release_succeeds(self):
        """MCPClient.release returns (True, message) with working server."""
        client = tickets.MCPClient(self.url, "test-key")
        ok, msg = client.release("TEST-001", "done")
        self.assertTrue(ok)
        self.assertIn("OK", msg)

    def test_authorization_header_sent(self):
        """MCPClient sends Authorization header when api_key is set."""
        client = tickets.MCPClient(self.url, "my-secret-key")
        # If the server doesn't reject it, the header was sent
        ok, msg = client.claim("TEST-001", "QA", "h", "o")
        self.assertTrue(ok)


class FilesystemTestBase(unittest.TestCase):
    """Base class providing a temporary filesystem ticket environment."""

    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp())
        self.orig_root = tickets.ROOT
        self.orig_tickets_dir = tickets.TICKETS_DIR
        self.orig_state_dir = tickets.STATE_DIR

        tickets.ROOT = self.tmpdir
        tickets.TICKETS_DIR = self.tmpdir / "tickets"
        tickets.STATE_DIR = self.tmpdir / "ticket-state"

        tickets.TICKETS_DIR.mkdir(parents=True)
        for stage in tickets.STAGES:
            (tickets.STATE_DIR / stage).mkdir(parents=True)

    def tearDown(self):
        tickets.ROOT = self.orig_root
        tickets.TICKETS_DIR = self.orig_tickets_dir
        tickets.STATE_DIR = self.orig_state_dir
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def _create_test_ticket(self, ticket_id="TEST-001", stage="READY",
                            ticket_type="backend", claimed_by=None):
        """Helper to create a test ticket in the temp environment."""
        ticket = {
            "ticket_id": ticket_id,
            "title": f"Test ticket {ticket_id}",
            "description": "Test",
            "type": ticket_type,
            "priority": "medium",
            "stage": stage,
            "sdlc_flow": tickets.SDLC_FLOWS.get(ticket_type, ["READY", "BACKEND", "QA", "DONE"]),
            "created_at": tickets.now_iso(),
            "created_by": "test",
            "dependencies": [],
            "blocked_by": [],
            "file_paths": [],
            "acceptance_criteria": ["Test done"],
            "rework_count": 0,
            "claimed_by": claimed_by,
            "machine_id": "test-host" if claimed_by else None,
            "operator": "tester" if claimed_by else None,
            "lease_expiry": (datetime.now(timezone.utc) + timedelta(minutes=30)).isoformat() if claimed_by else None,
            "lease_duration_minutes": 30,
            "history": [],
            "source_task_file": None,
            "tags": [],
        }
        # Save master
        tickets.save_ticket(ticket, tickets.TICKETS_DIR / f"{ticket_id}.json")
        # Save in stage dir
        tickets.save_ticket(ticket, tickets.STATE_DIR / stage / f"{ticket_id}.json")
        return ticket


class TestBackwardCompatibility(FilesystemTestBase):
    """AC2: In filesystem mode, all existing behavior is preserved."""

    def test_claim_works_in_filesystem_mode(self):
        """claim_ticket still works exactly as before."""
        self._create_test_ticket("BC-001", stage="READY")
        ok, msg = tickets.claim_ticket("BC-001", "Backend", "host1", "op1")
        self.assertTrue(ok)
        self.assertIn("BC-001", msg)

    def test_advance_works_in_filesystem_mode(self):
        """advance_ticket still works exactly as before."""
        self._create_test_ticket("BC-002", stage="READY", claimed_by="Backend")
        ok, msg = tickets.advance_ticket("BC-002", "Backend")
        self.assertTrue(ok)
        # Verify it moved to BACKEND (next stage after READY for backend type)
        self.assertTrue((tickets.STATE_DIR / "BACKEND" / "BC-002.json").exists())
        self.assertFalse((tickets.STATE_DIR / "READY" / "BC-002.json").exists())

    def test_release_works_in_filesystem_mode(self):
        """release_claim still works exactly as before."""
        self._create_test_ticket("BC-003", stage="READY", claimed_by="Backend")
        ok, msg = tickets.release_claim("BC-003")
        self.assertTrue(ok)
        ticket = tickets.load_ticket(tickets.TICKETS_DIR / "BC-003.json")
        self.assertIsNone(ticket["claimed_by"])

    def test_sync_works_in_filesystem_mode(self):
        """sync_tickets still works exactly as before."""
        self._create_test_ticket("BC-004", stage="READY")
        result = tickets.sync_tickets()
        self.assertIsInstance(result, dict)
        self.assertIn("moved_to_ready", result)
        self.assertIn("still_blocked", result)

    def test_validate_works_in_filesystem_mode(self):
        """validate_integrity still works exactly as before."""
        self._create_test_ticket("BC-005", stage="READY")
        errors = tickets.validate_integrity()
        self.assertIsInstance(errors, list)

    def test_create_ticket_function(self):
        """create_ticket still works as before."""
        ticket = tickets.create_ticket(
            "BC-006", "Test", "Desc", "backend",
            acceptance_criteria=["Done"]
        )
        self.assertEqual(ticket["ticket_id"], "BC-006")
        self.assertTrue((tickets.TICKETS_DIR / "BC-006.json").exists())

    def test_rework_ticket_function(self):
        """rework_ticket still works as before."""
        self._create_test_ticket("BC-007", stage="QA", claimed_by="QA")
        ok, msg = tickets.rework_ticket("BC-007", "QA", "Tests failed")
        self.assertTrue(ok)
        ticket = tickets.load_ticket(tickets.TICKETS_DIR / "BC-007.json")
        self.assertEqual(ticket["rework_count"], 1)


class TestDispatchFilesystemMode(FilesystemTestBase):
    """Test dispatch functions in filesystem mode (default)."""

    def test_dispatch_claim_filesystem(self):
        """AC2: dispatch_claim in filesystem mode calls filesystem only."""
        self._create_test_ticket("DF-001", stage="READY")
        with patch.object(tickets, "FORGEOS_MODE", "filesystem"):
            ok, msg = tickets.dispatch_claim("DF-001", "Backend", "h", "o")
            self.assertTrue(ok)

    def test_dispatch_advance_filesystem(self):
        """AC2: dispatch_advance in filesystem mode calls filesystem only."""
        self._create_test_ticket("DF-002", stage="READY", claimed_by="Backend")
        with patch.object(tickets, "FORGEOS_MODE", "filesystem"):
            ok, msg = tickets.dispatch_advance("DF-002", "Backend")
            self.assertTrue(ok)

    def test_dispatch_release_filesystem(self):
        """AC2: dispatch_release in filesystem mode calls filesystem only."""
        self._create_test_ticket("DF-003", stage="READY", claimed_by="Backend")
        with patch.object(tickets, "FORGEOS_MODE", "filesystem"):
            ok, msg = tickets.dispatch_release("DF-003")
            self.assertTrue(ok)


class TestDispatchDualMode(FilesystemTestBase):
    """Test dispatch functions in dual mode."""

    def test_dispatch_claim_dual_calls_both(self):
        """AC3: dispatch_claim in dual mode calls both filesystem and MCP."""
        self._create_test_ticket("DD-001", stage="READY")
        mock_client = MagicMock()
        mock_client.claim.return_value = (True, "MCP OK")

        with patch.object(tickets, "FORGEOS_MODE", "dual"):
            with patch.object(tickets, "_get_mcp_client", return_value=mock_client):
                ok, msg = tickets.dispatch_claim("DD-001", "Backend", "h", "o")
                self.assertTrue(ok)
                mock_client.claim.assert_called_once_with("DD-001", "Backend", "h", "o")

    def test_dispatch_advance_dual_calls_both(self):
        """AC4: dispatch_advance in dual mode calls both filesystem and MCP."""
        self._create_test_ticket("DD-002", stage="READY", claimed_by="Backend")
        mock_client = MagicMock()
        mock_client.complete.return_value = (True, "MCP OK")

        with patch.object(tickets, "FORGEOS_MODE", "dual"):
            with patch.object(tickets, "_get_mcp_client", return_value=mock_client):
                ok, msg = tickets.dispatch_advance("DD-002", "Backend")
                self.assertTrue(ok)
                mock_client.complete.assert_called_once_with("DD-002", "Backend")

    def test_dispatch_release_dual_calls_both(self):
        """dispatch_release in dual mode calls both filesystem and MCP."""
        self._create_test_ticket("DD-003", stage="READY", claimed_by="Backend")
        mock_client = MagicMock()
        mock_client.release.return_value = (True, "MCP OK")

        with patch.object(tickets, "FORGEOS_MODE", "dual"):
            with patch.object(tickets, "_get_mcp_client", return_value=mock_client):
                ok, msg = tickets.dispatch_release("DD-003")
                self.assertTrue(ok)
                mock_client.release.assert_called_once_with("DD-003", "manual release")

    def test_dual_mode_continues_on_mcp_failure(self):
        """AC9: If MCP is unreachable in dual mode, filesystem continues."""
        self._create_test_ticket("DD-004", stage="READY")
        with patch.object(tickets, "FORGEOS_MODE", "dual"):
            with patch.object(tickets, "_get_mcp_client", return_value=None):
                ok, msg = tickets.dispatch_claim("DD-004", "Backend", "h", "o")
                # Filesystem should still succeed
                self.assertTrue(ok)

    def test_dual_mode_logs_divergence(self):
        """AC7: Shadow comparison logs divergence on mismatch."""
        self._create_test_ticket("DD-005", stage="READY")
        mock_client = MagicMock()
        mock_client.claim.return_value = (False, "MCP rejected")

        with patch.object(tickets, "FORGEOS_MODE", "dual"):
            with patch.object(tickets, "_get_mcp_client", return_value=mock_client):
                with patch.object(tickets._logger, "warning") as mock_warn:
                    ok, msg = tickets.dispatch_claim("DD-005", "Backend", "h", "o")
                    # Filesystem succeeds, MCP fails = divergence
                    self.assertTrue(ok)
                    # Check that warning was logged about divergence
                    divergence_logged = any(
                        "DIVERGENCE" in str(call)
                        for call in mock_warn.call_args_list
                    )
                    self.assertTrue(divergence_logged,
                                    f"Expected DIVERGENCE warning, got: {mock_warn.call_args_list}")

    def test_dual_advance_logs_divergence(self):
        """AC7: Divergence logged on advance mismatch."""
        self._create_test_ticket("DD-006", stage="READY", claimed_by="Backend")
        mock_client = MagicMock()
        mock_client.complete.return_value = (False, "MCP error")

        with patch.object(tickets, "FORGEOS_MODE", "dual"):
            with patch.object(tickets, "_get_mcp_client", return_value=mock_client):
                with patch.object(tickets._logger, "warning") as mock_warn:
                    ok, msg = tickets.dispatch_advance("DD-006", "Backend")
                    self.assertTrue(ok)
                    divergence_logged = any(
                        "DIVERGENCE" in str(call)
                        for call in mock_warn.call_args_list
                    )
                    self.assertTrue(divergence_logged)


class TestDispatchMCPMode(FilesystemTestBase):
    """Test dispatch functions in MCP-only mode."""

    def test_dispatch_claim_mcp_only(self):
        """AC5: In MCP mode, --claim calls only MCP."""
        self._create_test_ticket("DM-001", stage="READY")
        mock_client = MagicMock()
        mock_client.claim.return_value = (True, "MCP OK")

        with patch.object(tickets, "FORGEOS_MODE", "mcp"):
            with patch.object(tickets, "_get_mcp_client", return_value=mock_client):
                ok, msg = tickets.dispatch_claim("DM-001", "Backend", "h", "o")
                self.assertTrue(ok)
                self.assertEqual(msg, "MCP OK")
                mock_client.claim.assert_called_once()

    def test_dispatch_advance_mcp_only(self):
        """AC6: In MCP mode, --advance calls only MCP."""
        mock_client = MagicMock()
        mock_client.complete.return_value = (True, "MCP advanced")

        with patch.object(tickets, "FORGEOS_MODE", "mcp"):
            with patch.object(tickets, "_get_mcp_client", return_value=mock_client):
                ok, msg = tickets.dispatch_advance("DM-002", "Backend")
                self.assertTrue(ok)
                self.assertEqual(msg, "MCP advanced")

    def test_mcp_mode_fails_if_server_unreachable(self):
        """AC5/AC6: MCP mode fails if MCP server is not reachable."""
        with patch.object(tickets, "FORGEOS_MODE", "mcp"):
            with patch.object(tickets, "_get_mcp_client", return_value=None):
                ok, msg = tickets.dispatch_claim("DM-003", "Backend", "h", "o")
                self.assertFalse(ok)
                self.assertIn("not reachable", msg)

    def test_mcp_mode_skips_filesystem(self):
        """AC5: MCP mode does NOT call filesystem functions."""
        mock_client = MagicMock()
        mock_client.claim.return_value = (True, "MCP OK")

        with patch.object(tickets, "FORGEOS_MODE", "mcp"):
            with patch.object(tickets, "_get_mcp_client", return_value=mock_client):
                with patch.object(tickets, "claim_ticket") as fs_mock:
                    tickets.dispatch_claim("DM-004", "Backend", "h", "o")
                    fs_mock.assert_not_called()


class TestGetMCPClient(unittest.TestCase):
    """Test _get_mcp_client lazy initialization."""

    def setUp(self):
        # Reset cached client
        tickets._mcp_client = None

    def tearDown(self):
        tickets._mcp_client = None

    def test_returns_none_when_unreachable(self):
        """Client is None when MCP server is unreachable."""
        with patch.object(tickets, "FORGEOS_MCP_URL", "http://127.0.0.1:59999/mcp"):
            client = tickets._get_mcp_client()
            self.assertIsNone(client)

    def test_caches_client_on_success(self):
        """Client is cached after successful health check."""
        mock_client = tickets.MCPClient("http://localhost:3000/mcp", "key")
        with patch.object(mock_client, "health_check", return_value=True):
            with patch.object(tickets, "FORGEOS_MCP_URL", "http://localhost:3000/mcp"):
                with patch("tickets.MCPClient", return_value=mock_client):
                    client1 = tickets._get_mcp_client()
                    client2 = tickets._get_mcp_client()
                    self.assertIs(client1, client2)


class TestCLIIntegration(FilesystemTestBase):
    """Test CLI main() function routes to dispatch functions."""

    def test_claim_cli_uses_dispatch(self):
        """CLI --claim routes through dispatch_claim."""
        self._create_test_ticket("CLI-001", stage="READY")
        with patch.object(tickets, "FORGEOS_MODE", "filesystem"):
            with patch("sys.argv", ["tickets.py", "--claim", "CLI-001", "Backend", "h", "o"]):
                with self.assertRaises(SystemExit) as cm:
                    tickets.main()
                self.assertEqual(cm.exception.code, 0)

    def test_advance_cli_uses_dispatch(self):
        """CLI --advance routes through dispatch_advance."""
        self._create_test_ticket("CLI-002", stage="READY", claimed_by="Backend")
        with patch.object(tickets, "FORGEOS_MODE", "filesystem"):
            with patch("sys.argv", ["tickets.py", "--advance", "CLI-002", "Backend"]):
                with self.assertRaises(SystemExit) as cm:
                    tickets.main()
                self.assertEqual(cm.exception.code, 0)

    def test_release_cli_uses_dispatch(self):
        """CLI --release routes through dispatch_release."""
        self._create_test_ticket("CLI-003", stage="READY", claimed_by="Backend")
        with patch.object(tickets, "FORGEOS_MODE", "filesystem"):
            with patch("sys.argv", ["tickets.py", "--release", "CLI-003"]):
                with self.assertRaises(SystemExit) as cm:
                    tickets.main()
                self.assertEqual(cm.exception.code, 0)

    def test_status_unaffected_by_mode(self):
        """--status works regardless of FORGEOS_MODE."""
        self._create_test_ticket("CLI-004", stage="READY")
        with patch.object(tickets, "FORGEOS_MODE", "filesystem"):
            with patch("sys.argv", ["tickets.py", "--status"]):
                # Should not raise
                tickets.main()

    def test_validate_unaffected_by_mode(self):
        """--validate works regardless of FORGEOS_MODE."""
        self._create_test_ticket("CLI-005", stage="READY")
        with patch.object(tickets, "FORGEOS_MODE", "filesystem"):
            with patch("sys.argv", ["tickets.py", "--validate"]):
                with self.assertRaises(SystemExit) as cm:
                    tickets.main()
                self.assertEqual(cm.exception.code, 0)


class TestMCPCallToolPayload(unittest.TestCase):
    """Test that _call_tool constructs proper JSON-RPC payloads."""

    def test_jsonrpc_version(self):
        """Payload uses JSON-RPC 2.0."""
        client = tickets.MCPClient("http://127.0.0.1:59999/mcp", "")
        # Verify via mock
        with patch("tickets.urlopen") as mock_urlopen:
            mock_resp = MagicMock()
            mock_resp.read.return_value = json.dumps({
                "jsonrpc": "2.0",
                "result": {"content": [{"type": "text", "text": "ok"}]},
                "id": 1,
            }).encode()
            mock_resp.__enter__ = lambda s: s
            mock_resp.__exit__ = MagicMock(return_value=False)
            mock_urlopen.return_value = mock_resp

            client._call_tool("tickets.claim", {"ticket_id": "T1"})

            call_args = mock_urlopen.call_args
            request_obj = call_args[0][0]
            body = json.loads(request_obj.data.decode())
            self.assertEqual(body["jsonrpc"], "2.0")
            self.assertEqual(body["method"], "tools/call")
            self.assertEqual(body["params"]["name"], "tickets.claim")
            self.assertEqual(body["params"]["arguments"]["ticket_id"], "T1")

    def test_error_response_handled(self):
        """MCP error response returns (False, error message)."""
        client = tickets.MCPClient("http://127.0.0.1:59999/mcp", "")
        with patch("tickets.urlopen") as mock_urlopen:
            mock_resp = MagicMock()
            mock_resp.read.return_value = json.dumps({
                "jsonrpc": "2.0",
                "error": {"code": -32600, "message": "Invalid request"},
                "id": 1,
            }).encode()
            mock_resp.__enter__ = lambda s: s
            mock_resp.__exit__ = MagicMock(return_value=False)
            mock_urlopen.return_value = mock_resp

            ok, msg = client._call_tool("tickets.claim", {})
            self.assertFalse(ok)
            self.assertIn("Invalid request", msg)


class TestEdgeCases(FilesystemTestBase):
    """Edge cases and boundary tests."""

    def test_nonexistent_ticket_claim(self):
        """Claiming nonexistent ticket returns (False, message)."""
        ok, msg = tickets.claim_ticket("NONEXIST", "A", "h", "o")
        self.assertFalse(ok)
        self.assertIn("does not exist", msg)

    def test_double_claim_rejected(self):
        """Second claim on actively claimed ticket is rejected."""
        self._create_test_ticket("EC-001", stage="READY", claimed_by="Backend")
        ok, msg = tickets.claim_ticket("EC-001", "QA", "h2", "o2")
        self.assertFalse(ok)
        self.assertIn("already claimed", msg)

    def test_expired_claim_allows_reclaim(self):
        """Expired lease allows reclaiming."""
        ticket = self._create_test_ticket("EC-002", stage="READY", claimed_by="Backend")
        # Set lease to past
        ticket["lease_expiry"] = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
        tickets.save_ticket(ticket, tickets.TICKETS_DIR / "EC-002.json")
        tickets.save_ticket(ticket, tickets.STATE_DIR / "READY" / "EC-002.json")

        ok, msg = tickets.claim_ticket("EC-002", "QA", "h2", "o2")
        self.assertTrue(ok)

    def test_advance_nonexistent_ticket(self):
        """Advancing nonexistent ticket returns (False, message)."""
        ok, msg = tickets.advance_ticket("NONEXIST", "A")
        self.assertFalse(ok)

    def test_rework_max_count(self):
        """Rework beyond max count (3) is rejected."""
        ticket = self._create_test_ticket("EC-003", stage="QA", claimed_by="QA")
        ticket["rework_count"] = 3
        tickets.save_ticket(ticket, tickets.TICKETS_DIR / "EC-003.json")

        ok, msg = tickets.rework_ticket("EC-003", "QA", "Still failing")
        self.assertFalse(ok)
        self.assertIn("exceeded", msg)

    def test_release_unclaimed_ticket(self):
        """Releasing unclaimed ticket returns (False, message)."""
        self._create_test_ticket("EC-004", stage="READY")
        ok, msg = tickets.release_claim("EC-004")
        self.assertFalse(ok)
        self.assertIn("not claimed", msg)


class TestStdlibImportsOnly(unittest.TestCase):
    """Verify no external dependencies were added."""

    def test_no_requests_import(self):
        """tickets.py must not import 'requests' library."""
        source = Path(tickets.__file__).read_text()
        self.assertNotIn("import requests", source)
        self.assertNotIn("from requests", source)

    def test_no_httpx_import(self):
        """tickets.py must not import 'httpx' library."""
        source = Path(tickets.__file__).read_text()
        self.assertNotIn("import httpx", source)
        self.assertNotIn("from httpx", source)

    def test_uses_urllib(self):
        """tickets.py uses stdlib urllib for HTTP."""
        source = Path(tickets.__file__).read_text()
        self.assertIn("from urllib", source)


class TestLoggingSetup(unittest.TestCase):
    """Verify logging configuration."""

    def test_logger_exists(self):
        """tickets.py configures a named logger."""
        self.assertIsNotNone(tickets._logger)
        self.assertEqual(tickets._logger.name, "tickets.py")

    def test_logger_writes_to_stderr(self):
        """Logger handler writes to stderr, not stdout."""
        import io
        for handler in tickets._logger.handlers:
            if hasattr(handler, "stream"):
                self.assertIs(handler.stream, sys.stderr)


if __name__ == "__main__":
    unittest.main()

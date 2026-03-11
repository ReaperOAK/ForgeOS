# FORGEOS-BE068 — Security Review

**Agent:** Security Engineer
**Machine:** pop-os
**Operator:** ReaperOAK
**Timestamp:** 2026-03-11T02:10:00Z
**Verdict:** PASS
**Confidence:** HIGH

## Files Reviewed

| File | Lines | Purpose |
|------|-------|---------|
| `mcp-server/src/mcp_server/migration/dual_mode.py` | 534 | Dual-mode wrapper, FileMode, McpMode, DualModeWrapper |
| `mcp-server/src/mcp_server/migration/config.py` | 72 | DualModeConfig (pydantic-settings), OperationMode enum |
| `mcp-server/src/mcp_server/migration/__init__.py` | 32 | Package re-exports |

## STRIDE Threat Model

### Trust Boundary: Agent Caller → DualModeWrapper

| Threat | Assessment | Score |
|--------|-----------|-------|
| **Spoofing** | Wrapper is an internal library, not an API endpoint. No authentication surface. Callers are trusted internal agents. | Impact=2 × Likelihood=1 = 2 (LOW) |
| **Tampering** | `OperationResult` is `@dataclass(frozen=True)` — immutable after creation. Config loaded from env vars via pydantic-settings (type-validated). | Impact=2 × Likelihood=1 = 2 (LOW) |
| **Repudiation** | All operations logged via `logger.info`/`logger.warning` with operation name and mode used. Structured log extras included. | Impact=2 × Likelihood=1 = 2 (LOW) |
| **Information Disclosure** | No PII or secrets logged. Only operation names, mode labels, and success booleans appear in logs. Subprocess stderr captured but not logged to external sinks. | Impact=2 × Likelihood=1 = 2 (LOW) |
| **Denial of Service** | `operation_timeout` (default 30s) enforced on both subprocess and HTTP calls. `asyncio.wait_for` prevents hung subprocesses. | Impact=3 × Likelihood=2 = 6 (LOW) |
| **Elevation of Privilege** | Wrapper delegates to `tickets.py` or MCP server — no privilege escalation path. Subprocess runs as same user. MCP calls go to localhost by default. | Impact=2 × Likelihood=1 = 2 (LOW) |

### Trust Boundary: DualModeWrapper → tickets.py subprocess (FileMode)

| Threat | Assessment | Score |
|--------|-----------|-------|
| **Injection** | Uses `asyncio.create_subprocess_exec` (NOT `shell=True`). Arguments passed as list elements, preventing shell injection. `sys.executable` used for Python binary — no PATH manipulation risk. | Impact=4 × Likelihood=1 = 4 (LOW) |
| **Tampering** | Subprocess stdout/stderr captured and returned as-is. No file writes by the wrapper itself. | Impact=2 × Likelihood=1 = 2 (LOW) |
| **DoS** | Timeout via `asyncio.wait_for(proc.communicate(), timeout=...)`. TimeoutError caught and returned as failed OperationResult. | Impact=3 × Likelihood=1 = 3 (LOW) |

### Trust Boundary: DualModeWrapper → MCP Server (McpMode)

| Threat | Assessment | Score |
|--------|-----------|-------|
| **Spoofing** | MCP URL comes from `FORGEOS_MCP_SERVER_URL` env var (default `http://localhost:8080`). Internal-only endpoint. No auth token exchange (server is local). | Impact=3 × Likelihood=1 = 3 (LOW) |
| **Tampering** | JSON-RPC payload is hardcoded structure with typed parameters. Responses parsed as JSON; `ConnectionError` raised on RPC-level errors. | Impact=3 × Likelihood=1 = 3 (LOW) |
| **Information Disclosure** | Only ticket IDs, agent names, and machine IDs transit over the wire — all non-sensitive operational data. Connection is localhost by default. | Impact=2 × Likelihood=1 = 2 (LOW) |
| **SSRF** | URL constructed as `f"{self._url}/mcp"` where `self._url` is from config. Only operators with env var write access can change this. Not externally controllable. Low SSRF risk. | Impact=3 × Likelihood=1 = 3 (LOW) |
| **DoS** | `urlopen(req, timeout=...)` enforces HTTP timeout. Connection failures caught and converted to failed OperationResult. Health check prevents routing to dead server. | Impact=3 × Likelihood=1 = 3 (LOW) |

## OWASP Top 10 Checklist

| Category | Status | Notes |
|----------|--------|-------|
| **A01 Broken Access Control** | N/A | Library module, no direct API endpoints. Access control is upstream concern. |
| **A02 Cryptographic Failures** | PASS | No cryptographic operations. No secrets stored or transmitted. Config via env vars (pydantic-settings). |
| **A03 Injection** | PASS | `create_subprocess_exec` used (not `shell=True`). Arguments are list elements, not string-interpolated. JSON-RPC payloads are typed dicts, not string-concatenated. No SQL. |
| **A04 Insecure Design** | PASS | Protocol-based design (`TicketOperations`). Immutable results. Health-check-then-dispatch pattern with mid-operation fallback. |
| **A05 Security Misconfiguration** | PASS | Sensible defaults (file mode, fallback enabled, 30s timeout). No debug flags. No overly permissive settings. |
| **A06 Vulnerable Components** | PASS | Uses stdlib only (`asyncio`, `urllib`, `json`, `sys`). External deps: `pydantic-settings` (well-maintained). No known CVEs in used versions. |
| **A07 Auth Failures** | N/A | No authentication mechanism in this module. Upstream responsibility. |
| **A08 Data Integrity** | PASS | `OperationResult` is frozen dataclass. Config validated by pydantic. JSON parsing with proper error handling. |
| **A09 Logging Failures** | PASS | Structured logging via `get_logger`. Operation name, mode, and success status logged. No PII or secrets in log output. |
| **A10 SSRF** | PASS | MCP URL from env var only (not user input). Default is `localhost:8080`. Path is hardcoded `/mcp`. No user-controllable URL components. |

## LLM Top 10

N/A — No AI/LLM features in this module. It is a pure infrastructure wrapper for ticket operations.

## Dependency Audit

| Dependency | Source | CVE Status |
|------------|--------|------------|
| `asyncio` | stdlib | N/A |
| `json` | stdlib | N/A |
| `urllib.request` | stdlib | N/A |
| `sys` | stdlib | N/A |
| `pydantic` | PyPI | No known critical/high CVEs |
| `pydantic-settings` | PyPI | No known critical/high CVEs |

No external HTTP client libraries added. SBOM scope: 2 third-party packages (pydantic, pydantic-settings), both well-maintained.

## Secret Scanning

| Check | Result |
|-------|--------|
| Hardcoded API keys | None found |
| Hardcoded passwords | None found |
| Hardcoded tokens | None found |
| Private keys | None found |
| `.env` file exposure | N/A — uses env vars via pydantic-settings |

## Input Validation Analysis

### FileMode — Subprocess Arguments

`FileMode` passes user-supplied strings (`ticket_id`, `agent`, `machine_id`, `operator`, `reason`) as individual list elements to `create_subprocess_exec`. This is safe because:

1. **No shell interpretation** — `create_subprocess_exec` does NOT invoke a shell. Each list element becomes a separate `argv` entry. Shell metacharacters (`;`, `|`, `&&`, `` ` ``, `$()`) are treated as literal characters.
2. **Fixed command prefix** — `[sys.executable, self._path]` uses the currently running Python interpreter and the configured `tickets.py` path.
3. **No string concatenation** — Arguments are never concatenated into a shell command string.

**Medium-severity note (informational):** The `tickets_py_path` config field accepts any string path without validation that it points to an actual `tickets.py` file. However, this is set via environment variable by operators, not by external users, so the risk is administrative misconfiguration only.

### McpMode — HTTP Request Construction

1. URL is `f"{self._url}/mcp"` — path `/mcp` is hardcoded. Base URL from config (env var).
2. JSON-RPC payload uses typed dict keys (`"jsonrpc"`, `"method"`, `"params"`). Values are from caller (ticket IDs, agent names) but these go into JSON body, not URL path.
3. Response parsed via `json.loads` with proper `JSONDecodeError` handling.
4. No raw string interpolation into URLs beyond the base URL.

## API Security Review

| Check | Result |
|-------|--------|
| Rate limiting | N/A — library, not API endpoint |
| CORS | N/A — no HTTP server |
| Auth headers required | N/A — localhost MCP server |
| Request timeouts | PASS — configurable `operation_timeout` on all operations |

## SARIF Findings

```json
{
  "version": "2.1.0",
  "$schema": "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/sarif-2.1/schema/sarif-schema-2.1.0.json",
  "runs": [
    {
      "tool": {
        "driver": {
          "name": "ForgeOS-Security-Engineer",
          "version": "1.0.0",
          "rules": [
            {
              "id": "SEC-BE068-001",
              "name": "NoInputValidationOnTicketsPyPath",
              "shortDescription": { "text": "tickets_py_path config field accepts any string path" },
              "helpUri": "https://cwe.mitre.org/data/definitions/426.html",
              "properties": { "severity": "LOW", "cwe": "CWE-426" }
            },
            {
              "id": "SEC-BE068-002",
              "name": "NoTLSOnMcpConnection",
              "shortDescription": { "text": "MCP server URL defaults to http (not https)" },
              "helpUri": "https://cwe.mitre.org/data/definitions/319.html",
              "properties": { "severity": "LOW", "cwe": "CWE-319" }
            }
          ]
        }
      },
      "results": [
        {
          "ruleId": "SEC-BE068-001",
          "level": "note",
          "message": { "text": "DualModeConfig.tickets_py_path accepts arbitrary string without path validation. Risk is limited to operator misconfiguration via env var (not externally exploitable)." },
          "locations": [
            {
              "physicalLocation": {
                "artifactLocation": { "uri": "mcp-server/src/mcp_server/migration/config.py" },
                "region": { "startLine": 53, "endLine": 56 }
              }
            }
          ]
        },
        {
          "ruleId": "SEC-BE068-002",
          "level": "note",
          "message": { "text": "MCP server URL defaults to http://localhost:8080. Acceptable for localhost communication but should use TLS when deployed across network boundaries." },
          "locations": [
            {
              "physicalLocation": {
                "artifactLocation": { "uri": "mcp-server/src/mcp_server/migration/config.py" },
                "region": { "startLine": 49, "endLine": 52 }
              }
            }
          ]
        }
      ]
    }
  ]
}
```

## SBOM Summary

| Component | Version | License | Vulnerability |
|-----------|---------|---------|---------------|
| Python stdlib (asyncio, json, urllib, sys) | 3.12+ | PSF | None |
| pydantic | >=2.0 | MIT | None known |
| pydantic-settings | >=2.0 | MIT | None known |

Total external dependencies: 2 (both well-maintained, no critical/high CVEs).

## Verdict

**PASS** — Zero critical or high findings.

Two LOW/informational findings documented:
1. **SEC-BE068-001** (LOW): `tickets_py_path` lacks path validation — acceptable risk since config is operator-controlled via env var.
2. **SEC-BE068-002** (LOW): Default HTTP (not HTTPS) for MCP URL — acceptable for localhost; TLS should be used in cross-network deployments.

### Security Strengths

- `asyncio.create_subprocess_exec` used correctly — no shell injection surface.
- Immutable `OperationResult` prevents post-creation tampering.
- Timeouts enforced on all I/O paths (subprocess + HTTP).
- No secrets, PII, or sensitive data in logs.
- pydantic-settings provides type-validated configuration.
- Health-check-before-dispatch pattern prevents routing to dead backends.
- Mid-operation fallback catches `ConnectionError/OSError/TimeoutError` gracefully.
- No `eval()`, `exec()`, `shell=True`, or `os.system()` patterns.
- JSON-RPC payload construction uses typed dicts, not string interpolation.

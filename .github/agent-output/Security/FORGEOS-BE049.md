# FORGEOS-BE049 — Security Review

## Ticket
- **ID:** FORGEOS-BE049
- **Title:** Implement Filesystem Fallback Mode
- **Type:** backend
- **Stage:** SECURITY → CI
- **Verdict:** PASS
- **Confidence:** HIGH

## Files Reviewed
- `agent-sdk/src/forgeos_sdk/fallback.py` (new — 121 stmts)
- `agent-sdk/src/forgeos_sdk/client.py` (modified — mode/fallback integration)
- `agent-sdk/src/forgeos_sdk/config.py` (modified — OperationMode enum)
- `agent-sdk/src/forgeos_sdk/__init__.py` (modified — exports)

---

## STRIDE Threat Model

### Trust Boundaries Identified

| # | Boundary | Components |
|---|----------|-----------|
| TB1 | SDK → subprocess (tickets.py) | `_run_tickets_py()` invokes `python3 tickets.py` with arguments |
| TB2 | SDK → filesystem (ticket JSON) | `_find_ticket_path()`, `_load_ticket_json()` read `.github/ticket-state/` |
| TB3 | SDK → git CLI | `_detect_repo_root()` invokes `git rev-parse --show-toplevel` |
| TB4 | Environment → config | `SDKConfig` reads `FORGEOS_*` env vars via pydantic-settings |

### STRIDE per Boundary

| Boundary | Threat | Analysis | Impact×Likelihood | Severity |
|----------|--------|----------|-------------------|----------|
| TB1 | **Spoofing** | `python3` resolved from PATH. Attacker would need PATH manipulation on localhost. SDK runs in trusted agent environment. | 2×1=2 | LOW |
| TB1 | **Tampering** | Subprocess args passed as list (no `shell=True`). No injection vector. `tickets.py` path validated to exist at init. | 1×1=1 | LOW |
| TB1 | **Repudiation** | Operations logged via Python logging. tickets.py has its own audit trail. | 1×1=1 | LOW |
| TB1 | **Info Disclosure** | `capture_output=True` — stdout/stderr not leaked. Only agent_id and repo_root logged. No credentials in args. | 1×1=1 | LOW |
| TB1 | **DoS** | `timeout=30` on CLI calls, `timeout=10` on git. Prevents hanging. | 2×1=2 | LOW |
| TB1 | **Elevation** | List-form subprocess — no shell expansion. No privilege escalation. | 1×1=1 | LOW |
| TB2 | **Spoofing** | Filesystem reads from trusted repo dirs. No external input determines paths directly. | 1×1=1 | LOW |
| TB2 | **Tampering** | Ticket JSON could be tampered on disk; appropriate for local dev tool. No integrity signatures needed. | 2×1=2 | LOW |
| TB2 | **Info Disclosure** | Reads only ticket JSON (non-sensitive metadata). No PII exposure. | 1×1=1 | LOW |
| TB3 | **Spoofing** | `git` resolved from PATH, same as TB1. Fallback to directory walking if git unavailable. | 2×1=2 | LOW |
| TB3 | **DoS** | `timeout=10` prevents hanging. | 1×1=1 | LOW |
| TB4 | **Tampering** | Env vars validated by Pydantic. Invalid mode/transport raises `ConfigurationError`. `api_key` validated not-blank-when-set. | 1×1=1 | LOW |

**Maximum STRIDE score: 2 (LOW)** — No critical, high, or medium threats.

---

## OWASP Top 10 Checklist

| Category | Status | Evidence |
|----------|--------|----------|
| **A01 Broken Access Control** | ✅ PASS | Local SDK library; no network access control surface. Fallback delegates auth decisions to tickets.py. |
| **A02 Cryptographic Failures** | ✅ N/A | No cryptographic operations in fallback code. `api_key` not used in filesystem mode. |
| **A03 Injection** | ✅ PASS | `subprocess.run()` uses list-form args (lines 90-100 fallback.py). `shell=True` never used. `reason` param in `rework()` also passed as list element — no injection. |
| **A04 Insecure Design** | ✅ PASS | Defense in depth: mutations delegate to tickets.py (same trust model). Auto-failover logged at WARNING level. Mode switch is transparent but auditable. |
| **A05 Security Misconfiguration** | ✅ PASS | No debug mode. Default `OperationMode.AUTO` is safe (tries MCP first). No verbose secret logging. |
| **A06 Vulnerable Components** | ✅ PASS | Uses pydantic-settings (well-maintained). Subprocess calls use stdlib only. No new external dependencies. |
| **A07 Auth Failures** | ✅ PASS | No authentication needed in local CLI fallback. `api_key` config field has blank-check validator. |
| **A08 Data Integrity** | ✅ PASS | JSON parsing wrapped in try/except for `JSONDecodeError` and `OSError`. Invalid data raises `ToolCallError`. |
| **A09 Logging Failures** | ✅ PASS | Structured logging via Python `logging` module. Only repo_root, agent_id, mode logged. No PII, no credentials. |
| **A10 SSRF** | ✅ N/A | No outbound network requests in fallback mode. Filesystem-only operations. |

**Result: 10/10 categories checked, 0 findings.**

---

## Subprocess Security (Focused Review)

### `_run_tickets_py()` (fallback.py:83-100)
- ✅ **List-form args**: `cmd = ["python3", str(self._tickets_py), *args]` — prevents shell injection
- ✅ **No `shell=True`**: Uses default `shell=False`
- ✅ **Timeout**: `timeout=30` — prevents indefinite hang
- ✅ **Captured output**: `capture_output=True` — stdout/stderr not leaked to caller environment
- ✅ **Controlled CWD**: `cwd=str(self._repo_root)` — working directory is the validated repo root
- ✅ **Path validation**: `self._tickets_py` existence checked in `__init__` before any execution
- ✅ **Error handling**: `TimeoutExpired` → `ToolCallError`, `FileNotFoundError` → `ConfigurationError`

### `_detect_repo_root()` (fallback.py:268-284)
- ✅ **List-form args**: `["git", "rev-parse", "--show-toplevel"]`
- ✅ **Timeout**: `timeout=10`
- ✅ **Graceful fallback**: On failure, walks parent directories looking for `.github/tickets.py`

---

## Path Traversal Analysis (Focused Review)

### `_find_ticket_path(ticket_id)` (fallback.py:115-120)
```python
path = self._state_dir() / stage / f"{ticket_id}.json"
```
- `ticket_id` is used as a filename component without format validation.
- **Theoretical risk**: A `ticket_id` containing `../` could escape the stage directory.
- **Mitigated by**: All callers pass ticket IDs from trusted agent code (same process). `claim_next()` reads from filesystem JSON created by the system.
- **Severity**: LOW (Impact=2, Likelihood=1, Score=2)

### `_load_ticket_json(ticket_id)` (fallback.py:122-137)
- Same pattern: `self._tickets_dir() / f"{ticket_id}.json"`
- Same mitigation: trusted input sources only.
- **Severity**: LOW

### Recommendation (informational, non-blocking)
Consider adding a defensive ticket_id format check (e.g., `re.match(r'^FORGEOS-[A-Z]+\d+$', ticket_id)`) as defense-in-depth. This is not required for PASS but would harden against future use in less-trusted contexts.

---

## File System Access Review

| Operation | Location | Access Type | Scope |
|-----------|----------|-------------|-------|
| Read ticket JSON | `_find_ticket_path` / `_load_ticket_json` | Read-only | `.github/ticket-state/`, `.github/tickets/` |
| Scan READY dir | `claim_next` | Read-only (directory listing) | `.github/ticket-state/READY/` |
| Check tickets.py exists | `__init__` | `Path.exists()` | `.github/tickets.py` |
| Detect repo root | `_detect_repo_root` | subprocess + `Path.exists()` | Parent directories |

- ✅ **No file writes** in fallback mode — all mutations go through tickets.py subprocess.
- ✅ **Proper encoding**: `read_text(encoding="utf-8")` used consistently.
- ✅ **Error handling**: `OSError` and `JSONDecodeError` caught and wrapped.

---

## Secret Scanning

| Check | Result |
|-------|--------|
| Hardcoded API keys/tokens | ✅ None found |
| Hardcoded passwords | ✅ None found |
| Private keys | ✅ None found |
| Credentials in log messages | ✅ None — only agent_id, repo_root, mode logged |
| `api_key` exposure | ✅ Not used in fallback mode; validator rejects blank values |

---

## Dependency Audit

No new external dependencies introduced by this ticket. The fallback module uses only:
- Python stdlib: `subprocess`, `json`, `pathlib`, `logging`
- Internal SDK: `forgeos_sdk.exceptions`, `forgeos_sdk.models`

`config.py` uses `pydantic-settings` (already a dependency).

**CVE scan**: N/A — no new packages added.

---

## SARIF Findings

```json
{
  "version": "2.1.0",
  "$schema": "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/sarif-2.1/schema/sarif-schema-2.1.0.json",
  "runs": [
    {
      "tool": {
        "driver": {
          "name": "ForgeOS-Security-Agent",
          "version": "1.0.0",
          "rules": [
            {
              "id": "SEC-PATH-001",
              "name": "PathTraversalTheoretical",
              "shortDescription": {
                "text": "Ticket ID used in path construction without format validation"
              },
              "defaultConfiguration": { "level": "note" },
              "properties": { "cwe": "CWE-22" }
            }
          ]
        }
      },
      "results": [
        {
          "ruleId": "SEC-PATH-001",
          "level": "note",
          "message": {
            "text": "ticket_id parameter used in Path construction without explicit format validation. Mitigated by trusted input sources (agent code, filesystem JSON). Defense-in-depth recommendation: add regex validation."
          },
          "locations": [
            {
              "physicalLocation": {
                "artifactLocation": { "uri": "agent-sdk/src/forgeos_sdk/fallback.py" },
                "region": { "startLine": 117 }
              }
            },
            {
              "physicalLocation": {
                "artifactLocation": { "uri": "agent-sdk/src/forgeos_sdk/fallback.py" },
                "region": { "startLine": 126 }
              }
            }
          ]
        }
      ]
    }
  ]
}
```

**0 critical, 0 high, 0 medium findings. 1 informational note (non-blocking).**

---

## Verdict

**PASS** — Zero critical or high findings. One informational note (CWE-22 theoretical path traversal, mitigated by trusted inputs). All OWASP Top 10 categories checked. STRIDE maximum score = 2 (LOW). Subprocess security is clean: list-form args, timeouts, no shell injection vectors. No secrets in code or logs. No new dependencies.

**Confidence: HIGH**

## Artifacts
- `.github/agent-output/Security/FORGEOS-BE049.md` (this report)

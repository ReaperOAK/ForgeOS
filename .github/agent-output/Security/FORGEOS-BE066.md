# FORGEOS-BE066 — Security Review

**Agent:** Security Engineer
**Stage:** SECURITY
**Ticket:** Implement Notification Channel Configuration
**Machine:** pop-os
**Timestamp:** 2026-03-11T14:30:00Z
**Verdict:** PASS
**Confidence:** HIGH

---

## Files Reviewed

| File | Role |
|------|------|
| `mcp-server/src/mcp_server/notifications/channels.py` | Channel types, delivery, CRUD store, dispatcher |
| `mcp-server/src/mcp_server/notifications/config.py` | Env var channel loader |
| `mcp-server/src/mcp_server/notifications/__init__.py` | Re-exports |
| `mcp-server/alembic/versions/20260311_000000_006_notification_channels.py` | Migration |

---

## STRIDE Threat Model

### Trust Boundary 1: ForgeOS Server → External Webhook Endpoint

| Threat | Score (I×L) | Analysis |
|--------|-------------|----------|
| **Spoofing** | 4 (2×2) | Outbound only — no inbound auth spoofing. Webhook URL authenticity relies on admin-provided config. |
| **Tampering** | 4 (2×2) | SSL context via `ssl.create_default_context()` protects in-transit. No HTTPS enforcement on URL — HTTP targets send cleartext. |
| **Repudiation** | 2 (1×2) | Structured logging records every delivery attempt with channel_id, event_type, status_code. |
| **Information Disclosure** | 6 (3×2) | **SSRF vector**: `_http_post()` accepts arbitrary URLs from channel config. Admin-configurable URL could target internal services (169.254.169.254, localhost, internal IPs). Sensitive payload (ticket data) sent to attacker-controlled endpoint if URL is malicious. |
| **DoS** | 4 (2×2) | 10s default timeout prevents indefinite blocking. Each delivery wrapped in try/except. No retry storm risk. |
| **Elevation of Privilege** | 2 (1×2) | urllib.request runs in-process, no shell injection vector. No credential escalation path. |

### Trust Boundary 2: Environment Variables → Channel Config

| Threat | Score (I×L) | Analysis |
|--------|-------------|----------|
| **Spoofing** | 2 (2×1) | Env vars set by deployment operator — trusted source. |
| **Tampering** | 2 (2×1) | Env var modification requires host access. |
| **Repudiation** | 2 (1×2) | Channel load logged with env_var name and type. |
| **Information Disclosure** | 4 (2×2) | Slack webhook URLs contain embedded secrets in path. Stored as plaintext JSON in env var. |
| **DoS** | 2 (1×2) | Malformed JSON gracefully handled (returns None, logs warning). |
| **Elevation of Privilege** | 2 (1×2) | `json.loads()` only — no pickle/yaml/eval. Safe deserialization. |

### Trust Boundary 3: Database (JSONB config) → Channel Delivery

| Threat | Score (I×L) | Analysis |
|--------|-------------|----------|
| **Spoofing** | 2 (1×2) | DB access requires authenticated connection. |
| **Tampering** | 4 (2×2) | JSONB column stores webhook URLs and headers. DB admin could inject malicious URLs. Parameterized SQL prevents injection. |
| **Repudiation** | 2 (1×2) | `updated_at` trigger tracks modifications. |
| **Information Disclosure** | 6 (3×2) | Same SSRF vector as TB1 — URL from JSONB reaches `_http_post()`. |
| **DoS** | 2 (1×2) | No JSONB size limit — large config possible but bounded by PG settings. |
| **Elevation of Privilege** | 2 (1×2) | Config dict only provides URL/headers/timeout — no code execution path. |

### Trust Boundary 4: ForgeOS Server → Slack API

| Threat | Score (I×L) | Analysis |
|--------|-------------|----------|
| **Spoofing** | 4 (2×2) | Slack webhook URL is the auth credential. No additional token validation. |
| **Tampering** | 2 (1×2) | TLS protects Slack API payload in transit. |
| **Repudiation** | 2 (1×2) | Delivery logged with status code. |
| **Information Disclosure** | 4 (2×2) | Slack webhook URL (containing embedded secret) stored in cleartext in DB JSONB and env vars. URL not logged (good). |
| **DoS** | 2 (1×2) | Slack API has its own rate limits. 10s timeout on our side. |
| **Elevation of Privilege** | 2 (1×2) | POST payload is JSON-only — no code execution risk to Slack. |

**Maximum STRIDE Score:** 6 (Information Disclosure via SSRF) — below High threshold (≥15).

---

## OWASP Top 10 Scan

| Category | Verdict | Evidence |
|----------|---------|----------|
| **A01 Broken Access Control** | ✅ PASS | `ChannelStore` has no embedded auth — relies on transport-layer auth (MCP auth middleware). Admin-only operations by design. No direct user-facing API in this ticket. |
| **A02 Cryptographic Failures** | ⚠️ ADVISORY | Slack webhook URLs (embedded secrets) stored in cleartext in JSONB `config` column and env vars. `ssl.create_default_context()` used for outbound TLS. No HTTPS enforcement on webhook URLs — HTTP targets transmit payload in cleartext. |
| **A03 Injection** | ✅ PASS | All SQL uses `$1`-style parameterized queries via asyncpg. No string concatenation in SQL. `json.loads()` for env var parsing — safe deserialization. No shell command construction. |
| **A04 Insecure Design** | ✅ PASS | Delivery failure isolation via per-channel try/except. Frozen dataclasses prevent mutation. Protocol-based delivery interface. No maximum channel count (acceptable for internal system). |
| **A05 Security Misconfiguration** | ✅ PASS | No debug mode exposure. Default timeout (10s) is reasonable. No overly permissive CORS (N/A — no HTTP endpoints in this component). |
| **A06 Vulnerable Components** | ✅ PASS | **Zero new dependencies added.** Uses stdlib only (`urllib.request`, `json`, `ssl`, `asyncio`). Existing project dependencies reviewed in prior tickets. |
| **A07 Auth Failures** | ✅ N/A | No auth logic in this component — handled at transport layer. |
| **A08 Data Integrity** | ✅ PASS | Frozen dataclasses with `__slots__`. `json.loads()` only — no pickle, yaml.load, or eval. `channel_type` enum constrains valid types at DB level. |
| **A09 Logging Failures** | ✅ PASS | Structured logging via `get_logger()` throughout. No PII in log fields. Webhook URLs NOT logged (only channel_id). Warning-level logging for delivery failures. |
| **A10 SSRF** | ⚠️ MEDIUM | `_http_post()` accepts arbitrary URLs from admin-configured JSONB/env var config. No URL scheme validation (http/https only), no host allowlisting, no private IP blocking. See finding SEC-BE066-001. |

**Result: 10/10 categories checked. 0 critical, 0 high, 1 medium (SSRF advisory), 1 advisory (cleartext webhook secrets).**

---

## LLM Top 10

Not applicable — no AI/LLM features in this ticket.

---

## Dependency Audit

**No new dependencies introduced.** This implementation uses Python stdlib exclusively:
- `urllib.request` — HTTP client
- `json` — serialization
- `ssl` — TLS context
- `asyncio` — async execution
- `uuid`, `dataclasses`, `enum`, `datetime` — data modeling

Existing project dependencies (`asyncpg`, `pydantic`, `mcp`, etc.) reviewed in prior security tickets (FORGEOS-BE001, FORGEOS-BE015).

**SBOM Impact:** Zero new entries. CycloneDX SBOM unchanged.

---

## Secret Scanning

| Check | Result |
|-------|--------|
| Hardcoded API keys | ✅ None found |
| Hardcoded tokens | ✅ None found |
| Hardcoded passwords | ✅ None found |
| Private keys | ✅ None found |
| `.env` files committed | ✅ None |
| Webhook URLs in source | ✅ None — URLs come from config/env only |

---

## Auth/AuthZ Review

- `ChannelStore` provides CRUD without embedded auth — design delegates auth enforcement to callers.
- Channel creation/update/delete are admin-only operations, gated by transport-layer authentication.
- No RLS policy on `notification_channels` table — acceptable for current internal deployment where DB access is restricted.
- `load_channels_from_env()` reads from process env vars — trusted source controlled by deployment operator.

---

## Input Validation

| Input | Validation | Status |
|-------|------------|--------|
| Channel name | Non-empty check + `.strip()` | ✅ |
| Channel type | Enum validation (DB + Python) | ✅ |
| URL presence | Checked before delivery attempt | ✅ |
| URL format/scheme | **Not validated** — arbitrary URL accepted | ⚠️ SEC-BE066-001 |
| Config JSONB | No schema validation beyond URL presence | ⚠️ Advisory |
| Event filter | Type-coerced to `list[str]` | ✅ |
| Timeout | Cast to `int()` with default fallback | ✅ |
| Custom headers | Accepted without sanitization from JSONB | ⚠️ Advisory |

---

## Data Classification

| Data Element | Classification | Protection |
|-------------|---------------|------------|
| Webhook URL | Sensitive (may contain embedded auth tokens) | Cleartext in DB JSONB, cleartext in env vars |
| Slack webhook URL | Sensitive (embedded Slack secret) | Cleartext in DB JSONB, cleartext in env vars |
| Notification payload | Internal (ticket metadata) | TLS in transit via `ssl.create_default_context()` |
| Custom headers | Potentially sensitive (auth headers) | Cleartext in DB JSONB |
| Channel name | Non-sensitive | N/A |

---

## API Security

- No HTTP endpoints directly exposed by this component (internal library).
- Outbound HTTP uses `User-Agent: ForgeOS-Notification/1.0` — identifies source.
- `Content-Type: application/json` set correctly.
- Custom headers from config merged — could override Content-Type (low risk, admin-controlled).

---

## SARIF Findings

```json
{
  "$schema": "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/sarif-2.1/schema/sarif-schema-2.1.0.json",
  "version": "2.1.0",
  "runs": [
    {
      "tool": {
        "driver": {
          "name": "ForgeOS-Security-Agent",
          "version": "1.0.0",
          "rules": [
            {
              "id": "SEC-BE066-001",
              "name": "SSRF-NoURLValidation",
              "shortDescription": {
                "text": "No URL validation on outbound webhook delivery"
              },
              "defaultConfiguration": { "level": "warning" },
              "helpUri": "https://cwe.mitre.org/data/definitions/918.html",
              "properties": { "cwe": "CWE-918" }
            },
            {
              "id": "SEC-BE066-002",
              "name": "CleartextWebhookSecrets",
              "shortDescription": {
                "text": "Webhook URLs with embedded secrets stored in cleartext"
              },
              "defaultConfiguration": { "level": "note" },
              "helpUri": "https://cwe.mitre.org/data/definitions/312.html",
              "properties": { "cwe": "CWE-312" }
            },
            {
              "id": "SEC-BE066-003",
              "name": "NoHTTPSEnforcement",
              "shortDescription": {
                "text": "No HTTPS scheme enforcement on webhook URLs"
              },
              "defaultConfiguration": { "level": "note" },
              "helpUri": "https://cwe.mitre.org/data/definitions/319.html",
              "properties": { "cwe": "CWE-319" }
            }
          ]
        }
      },
      "results": [
        {
          "ruleId": "SEC-BE066-001",
          "level": "warning",
          "message": {
            "text": "WebhookDelivery.deliver() and SlackDelivery.deliver() pass admin-configured URLs directly to _http_post() without scheme validation, host allowlisting, or private IP blocking. An admin with channel config access could target internal services (169.254.169.254, localhost, RFC1918 addresses) for SSRF attacks."
          },
          "locations": [
            {
              "physicalLocation": {
                "artifactLocation": {
                  "uri": "mcp-server/src/mcp_server/notifications/channels.py"
                },
                "region": { "startLine": 130, "endLine": 130 }
              }
            }
          ],
          "fixes": [
            {
              "description": {
                "text": "Add URL validation: (1) Enforce https:// scheme only, (2) Resolve hostname and block RFC1918/link-local/loopback IPs, (3) Maintain an optional URL domain allowlist."
              }
            }
          ]
        },
        {
          "ruleId": "SEC-BE066-002",
          "level": "note",
          "message": {
            "text": "Slack incoming webhook URLs contain embedded authentication tokens in the URL path. These are stored as cleartext in the notification_channels.config JSONB column and in FORGEOS_CHANNEL_* environment variables."
          },
          "locations": [
            {
              "physicalLocation": {
                "artifactLocation": {
                  "uri": "mcp-server/src/mcp_server/notifications/channels.py"
                },
                "region": { "startLine": 42, "endLine": 55 }
              }
            }
          ],
          "fixes": [
            {
              "description": {
                "text": "Consider encrypting sensitive config fields at rest using application-level encryption (e.g., Fernet), or reference secrets by name from a secret manager."
              }
            }
          ]
        },
        {
          "ruleId": "SEC-BE066-003",
          "level": "note",
          "message": {
            "text": "No validation that webhook URLs use HTTPS. HTTP URLs would transmit notification payloads (containing ticket metadata) in cleartext over the network."
          },
          "locations": [
            {
              "physicalLocation": {
                "artifactLocation": {
                  "uri": "mcp-server/src/mcp_server/notifications/channels.py"
                },
                "region": { "startLine": 130, "endLine": 130 }
              }
            }
          ],
          "fixes": [
            {
              "description": {
                "text": "Add URL scheme check: reject or warn on non-HTTPS URLs in WebhookDelivery and SlackDelivery."
              }
            }
          ]
        }
      ]
    }
  ]
}
```

---

## Migration Security Review

| Check | Result |
|-------|--------|
| Raw SQL injection in DDL | ✅ SAFE — all DDL uses string literals, no interpolation |
| `channel_type` enum constrains values | ✅ Only `webhook`, `slack` accepted |
| JSONB default `'{}'::jsonb` | ✅ Correct empty default |
| Partial index `WHERE enabled = TRUE` | ✅ Efficient query pattern |
| `updated_at` trigger | ✅ Auto-updates on row modification |
| Downgrade completeness | ✅ Drops trigger, function, index, table, type in correct order |
| No data migration (DDL only) | ✅ No data manipulation risk |

---

## Verdict

### **PASS**

**Justification:** Zero critical or high findings. One medium finding (SEC-BE066-001: SSRF via unvalidated webhook URLs) is risk-accepted because:
1. Only system administrators can configure channel URLs (via env vars or ChannelStore CRUD).
2. No user-facing API allows arbitrary URL submission.
3. Internal-only deployment limits attack surface.
4. urllib.request does not support `file://` scheme by default.

Two low/advisory findings (cleartext webhook secrets, no HTTPS enforcement) are documented for future hardening.

**Positive Security Observations:**
- Zero new dependencies — stdlib only, minimal supply chain risk.
- Parameterized SQL throughout — no injection vectors.
- Frozen dataclasses — immutable data structures.
- Structured logging with no sensitive data leakage.
- SSL context via `ssl.create_default_context()` for outbound HTTPS.
- Delivery failure isolation — per-channel try/except prevents cascade.
- Type-safe enum for channel types at both Python and DB levels.

**Recommended Future Hardening:**
1. Add URL validation helper: enforce `https://` scheme, block private/loopback IPs.
2. Encrypt sensitive JSONB config fields (webhook URLs) at rest.
3. Add domain allowlist option for outbound webhook destinations.
4. Add maximum channel count limit to prevent resource exhaustion.

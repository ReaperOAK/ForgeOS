# ForgeOS Error Catalog and API Standards

> **Ticket:** FORGEOS-ARCH010  
> **Author:** Architect Agent  
> **Status:** Accepted  
> **Date:** 2026-03-07  
> **Related:** [OpenAPI Spec](./openapi-spec.yaml) · [MCP Tool Definitions](./mcp-tool-definitions.md) · [Database Schema](../database-schema.md)

---

## Table of Contents

1. [Standard Error Response Format](#1-standard-error-response-format)
2. [Error Code Taxonomy](#2-error-code-taxonomy)
3. [Error Code Catalog](#3-error-code-catalog)
4. [Validation Error Format](#4-validation-error-format)
5. [Pagination Contract](#5-pagination-contract)
6. [Filtering Syntax](#6-filtering-syntax)
7. [Idempotency Key Contract](#7-idempotency-key-contract)
8. [Rate Limiting Policy](#8-rate-limiting-policy)
9. [Machine-Readable Error Reference (JSON)](#9-machine-readable-error-reference-json)
10. [Implementation Guide](#10-implementation-guide)

---

## 1. Standard Error Response Format

All API error responses follow a single envelope format. This applies to both
REST endpoints (under `/api`) and MCP tool handler error responses (returned
as `text` content blocks over JSON-RPC).

### 1.1 ErrorResponse Schema

```typescript
interface ErrorResponse {
  /** Machine-readable error code from ForgeOSErrorCode enum. */
  error: ForgeOSErrorCode;
  /** Human-readable error description. Safe for logging and display. */
  message: string;
  /** Optional additional context (e.g., conflicting paths, field errors). */
  details?: Record<string, unknown>;
  /** The ticket involved in the error, if applicable. */
  ticket_id?: string;
  /** ISO 8601 timestamp when the error occurred. */
  timestamp: string;
}
```

### 1.2 Example Error Response

```json
{
  "error": "ALREADY_CLAIMED",
  "message": "Ticket FORGEOS-ARCH010 is already claimed by Backend Engineer",
  "details": {
    "claimed_by": "Backend Engineer",
    "machine_id": "forgeos-dev",
    "lease_expiry": "2026-03-07T14:30:00.000Z"
  },
  "ticket_id": "FORGEOS-ARCH010",
  "timestamp": "2026-03-07T14:00:00.000Z"
}
```

### 1.3 Production Behavior

| Field       | Development                          | Production                         |
|-------------|--------------------------------------|------------------------------------|
| `message`   | Actual error message                 | Generic: `"An error occurred"`     |
| `details`   | Full context                         | Omitted for `INTERNAL_ERROR`       |
| Stack trace | Logged internally                    | Never exposed to client            |

### 1.4 HTTP Response Headers (Error Responses)

| Header            | Value                     | When                    |
|-------------------|---------------------------|-------------------------|
| `Content-Type`    | `application/json`        | Always                  |
| `X-Request-Id`    | UUID v4                   | Always                  |
| `Retry-After`     | Seconds until rate limit resets | `429` responses only |

---

## 2. Error Code Taxonomy

Error codes are organized into 6 categories with a consistent naming convention.

| Category       | Prefix / Pattern      | HTTP Range | Count | Description                              |
|----------------|-----------------------|------------|-------|------------------------------------------|
| **Claim**      | `ALREADY_CLAIMED`, `NOT_CLAIM_OWNER` | 403, 409 | 2 | Ticket claim ownership conflicts         |
| **State**      | `INVALID_TRANSITION`, `LEASE_EXPIRED`, `LEASE_TOO_LONG` | 400, 410 | 3 | SDLC lifecycle and lease violations      |
| **Validation** | `TICKET_NOT_FOUND`, `MISSING_EVIDENCE`, `INVALID_SUBTASK`, `FILE_CONFLICT`, `VALIDATION_ERROR` | 400, 404, 409 | 5 | Input and business rule violations       |
| **Auth**       | `UNAUTHORIZED`, `FORBIDDEN` | 401, 403 | 2 | Authentication and authorization         |
| **Rate Limit** | `RATE_LIMITED`        | 429        | 1     | API rate limit exceeded                  |
| **System**     | `INTERNAL_ERROR`, `DB_UNAVAILABLE`, `SERVICE_TIMEOUT`, `DEPENDENCY_BLOCKED`, `IDEMPOTENT_REPLAY`, `CONCURRENT_MODIFICATION`, `LEASE_CONFLICT` | 500, 503, 504, 409, 422 | 7 | Infrastructure and internal errors |

**Total: 20 error codes** (14 existing + 6 new)

---

## 3. Error Code Catalog

### 3.1 Claim Errors

| Numeric | String Code        | HTTP | Message Template                                              | Trigger Conditions                                       | Recovery Action                           |
|---------|--------------------|------|---------------------------------------------------------------|----------------------------------------------------------|-------------------------------------------|
| 1001    | `ALREADY_CLAIMED`  | 409  | `Ticket {ticket_id} is already claimed by {agent_name}`      | Claim attempt on a ticket with an active, unexpired lease | Wait for lease expiry or request release  |
| 1002    | `NOT_CLAIM_OWNER`  | 403  | `Agent {agent_name} does not own the claim on {ticket_id}`   | Update/complete/release by non-owning agent              | Use the correct agent session             |

### 3.2 State Errors

| Numeric | String Code          | HTTP | Message Template                                              | Trigger Conditions                                       | Recovery Action                           |
|---------|----------------------|------|---------------------------------------------------------------|----------------------------------------------------------|-------------------------------------------|
| 2001    | `INVALID_TRANSITION` | 400  | `Cannot transition {ticket_id} from {from_stage} to {to_stage}` | Stage advance violates SDLC flow for ticket type        | Follow the SDLC flow defined for the ticket type |
| 2002    | `LEASE_EXPIRED`      | 410  | `Lease on {ticket_id} expired at {expiry_time}`              | Operation attempted after lease expiry                   | Re-claim the ticket                       |
| 2003    | `LEASE_TOO_LONG`     | 400  | `Requested lease of {minutes}m exceeds project maximum of {max}m` | Lease duration exceeds `max_lease_minutes`             | Request a shorter lease duration          |

### 3.3 Validation Errors

| Numeric | String Code          | HTTP | Message Template                                              | Trigger Conditions                                       | Recovery Action                           |
|---------|----------------------|------|---------------------------------------------------------------|----------------------------------------------------------|-------------------------------------------|
| 3001    | `TICKET_NOT_FOUND`   | 404  | `Ticket {ticket_id} not found`                               | Lookup by `ticket_id` returns no rows                    | Verify the ticket ID                      |
| 3002    | `MISSING_EVIDENCE`   | 400  | `Stage completion requires evidence: {missing_fields}`       | `tickets.complete` called without required evidence fields | Provide artifacts, test_results, confidence |
| 3003    | `INVALID_SUBTASK`    | 400  | `Subtask violates parent constraints: {reason}`              | Spawned child violates parent scope / constraints        | Adjust subtask parameters                 |
| 3004    | `FILE_CONFLICT`      | 409  | `File {file_path} is locked by ticket {blocking_ticket_id}`  | File in `file_paths` is locked by another ticket         | Wait for blocking ticket to release       |
| 3005    | `VALIDATION_ERROR`   | 400  | `Request validation failed`                                  | Zod schema validation failure on body/query/params       | Fix invalid fields per `details.fields`   |

### 3.4 Auth Errors

| Numeric | String Code     | HTTP | Message Template                                              | Trigger Conditions                                       | Recovery Action                           |
|---------|-----------------|------|---------------------------------------------------------------|----------------------------------------------------------|-------------------------------------------|
| 4001    | `UNAUTHORIZED`  | 401  | `Authentication required`                                    | Missing/invalid `Authorization` or `X-API-Key` header    | Provide valid credentials                 |
| 4002    | `FORBIDDEN`     | 403  | `Insufficient permissions for {operation}`                   | Agent lacks required permission for the operation        | Use an agent with the required role       |

### 3.5 Rate Limit Errors

| Numeric | String Code    | HTTP | Message Template                                              | Trigger Conditions                                       | Recovery Action                           |
|---------|----------------|------|---------------------------------------------------------------|----------------------------------------------------------|-------------------------------------------|
| 5001    | `RATE_LIMITED`  | 429  | `Rate limit exceeded. Retry after {seconds}s`                | Request count exceeds configured threshold               | Wait for `Retry-After` seconds            |

### 3.6 System Errors

| Numeric | String Code              | HTTP | Message Template                                              | Trigger Conditions                                           | Recovery Action                           |
|---------|--------------------------|------|---------------------------------------------------------------|--------------------------------------------------------------|-------------------------------------------|
| 6001    | `INTERNAL_ERROR`         | 500  | `An internal error occurred`                                 | Unhandled exception, deserialization failure, logic bug       | Retry; if persistent, report bug          |
| 6002    | `DB_UNAVAILABLE`         | 503  | `Database service unavailable`                               | PostgreSQL connection refused, pool exhausted, timeout        | Retry with backoff; check infra health    |
| 6003    | `SERVICE_TIMEOUT`        | 504  | `Upstream service timed out after {timeout_ms}ms`            | Database query or external call exceeds timeout threshold     | Retry with backoff                        |
| 6004    | `DEPENDENCY_BLOCKED`     | 422  | `Ticket {ticket_id} is blocked by unresolved dependencies: {deps}` | Attempt to claim/advance a ticket with unmet `depends_on` | Complete blocking tickets first           |
| 6005    | `IDEMPOTENT_REPLAY`      | 200  | `Request already processed (idempotency key: {key})`        | Duplicate request with same idempotency key within window    | Use the cached response                  |
| 6006    | `CONCURRENT_MODIFICATION`| 409  | `Ticket {ticket_id} was modified concurrently`               | Optimistic lock violation (version mismatch)                 | Re-read and retry                         |
| 6007    | `LEASE_CONFLICT`         | 409  | `Cannot extend lease: ticket {ticket_id} was reclaimed`      | Lease extension attempted but ticket was reclaimed           | Re-claim the ticket                       |

---

## 4. Validation Error Format

Validation errors (HTTP 400 from Zod schema enforcement) use an extended format
with field-level detail. The top-level `error` field is always `VALIDATION_ERROR`.

### 4.1 ValidationErrorResponse Schema

```typescript
interface ValidationErrorResponse {
  /** Fixed error identifier. */
  error: 'VALIDATION_ERROR';
  /** Summary message. */
  message: string;
  /** Field-level error details. */
  details: {
    fields: FieldError[];
  };
  /** ISO 8601 timestamp. */
  timestamp: string;
}

interface FieldError {
  /** Dot-joined path to the invalid field (e.g., "evidence.artifacts"). */
  field: string;
  /** Human-readable error description. */
  message: string;
  /** Zod issue code (e.g., "invalid_type", "too_small"). */
  code: string;
}
```

### 4.2 Example Validation Error

```json
{
  "error": "VALIDATION_ERROR",
  "message": "Request validation failed",
  "details": {
    "fields": [
      {
        "field": "evidence.artifacts",
        "message": "Required",
        "code": "invalid_type"
      },
      {
        "field": "evidence.confidence",
        "message": "Invalid enum value. Expected 'HIGH' | 'MEDIUM' | 'LOW', received 'VERY_HIGH'",
        "code": "invalid_enum_value"
      }
    ]
  },
  "timestamp": "2026-03-07T14:00:00.000Z"
}
```

---

## 5. Pagination Contract

### 5.1 Strategy: Offset-Based Pagination

ForgeOS uses **offset-based pagination** for all list endpoints. This aligns
with the existing `TicketListResponse` schema and dashboard UX requirements
(page navigation, total count display).

**Rationale:** The ticket dataset is bounded (typically < 10,000 items), rarely
changes during a pagination session, and the dashboard requires total count and
page numbers. Cursor-based pagination adds complexity without benefit here.

### 5.2 Request Parameters

| Parameter   | Type    | Default | Min | Max  | Description                     |
|-------------|---------|---------|-----|------|---------------------------------|
| `page`      | integer | 1       | 1   | —    | Page number (1-indexed)         |
| `page_size` | integer | 20      | 1   | 100  | Number of items per page        |

### 5.3 Response Envelope

All list endpoints return a standard paginated envelope:

```typescript
interface PaginatedResponse<T> {
  /** Array of items for the current page. */
  items: T[];
  /** Total number of items matching the filter criteria. */
  total: number;
  /** Current page number. */
  page: number;
  /** Number of items per page. */
  page_size: number;
  /** Total number of pages (ceil(total / page_size)). */
  total_pages: number;
}
```

> **Note:** The existing `TicketListResponse` uses `tickets` as the array key
> instead of `items`. Endpoint-specific list responses MAY use a domain-specific
> key (e.g., `tickets`, `events`) as an alias for `items`, but the pagination
> metadata fields (`total`, `page`, `page_size`, `total_pages`) are mandatory.

### 5.4 Example Paginated Response

```json
{
  "tickets": [
    { "ticket_id": "FORGEOS-ARCH010", "title": "Design Error Catalog", "..." : "..." }
  ],
  "total": 42,
  "page": 2,
  "page_size": 20,
  "total_pages": 3
}
```

### 5.5 Edge Cases

| Condition                      | Behavior                                     |
|--------------------------------|----------------------------------------------|
| `page` > `total_pages`        | Return empty `items` array, correct metadata |
| `page_size` > available items | Return remaining items, correct `total`      |
| No items match filters         | `items: []`, `total: 0`, `total_pages: 0`    |
| `page` < 1                    | 400 `VALIDATION_ERROR`                       |
| `page_size` > 100             | 400 `VALIDATION_ERROR`                       |

---

## 6. Filtering Syntax

### 6.1 Design: Query Parameter Filters

List endpoints accept filters as query parameters. For simple equality, the
field name is used directly. For advanced operators, a bracket syntax is used.

### 6.2 Supported Operators

| Operator | Syntax                          | SQL Equivalent       | Example                          |
|----------|---------------------------------|----------------------|----------------------------------|
| `eq`     | `?field=value`                  | `field = value`      | `?stage=READY`                   |
| `in`     | `?field=val1,val2`              | `field IN (...)`     | `?stage=READY,BACKEND`           |
| `gt`     | `?field[gt]=value`              | `field > value`      | `?rework_count[gt]=1`            |
| `gte`    | `?field[gte]=value`             | `field >= value`     | `?created_at[gte]=2026-03-01`    |
| `lt`     | `?field[lt]=value`              | `field < value`      | `?priority[lt]=high`             |
| `lte`    | `?field[lte]=value`             | `field <= value`     | `?updated_at[lte]=2026-03-07`    |
| `ne`     | `?field[ne]=value`              | `field != value`     | `?status[ne]=DONE`               |
| `like`   | `?field[like]=pattern`          | `field ILIKE pattern`| `?title[like]=%error%`           |

### 6.3 Filterable Fields by Endpoint

#### `GET /api/tickets`

| Field          | Type     | Operators Supported       | Notes                            |
|----------------|----------|---------------------------|----------------------------------|
| `stage`        | enum     | `eq`, `in`                | SDLC pipeline stage              |
| `type`         | enum     | `eq`, `in`                | Ticket classification            |
| `priority`     | enum     | `eq`, `in`                | Priority level                   |
| `status`       | enum     | `eq`, `in`, `ne`          | Lifecycle status                 |
| `claimed_by`   | string   | `eq`                      | Agent name holding claim         |
| `tags`         | string   | `eq` (array contains)     | `?tags=phase1` matches `["phase1","api"]` |
| `created_at`   | datetime | `gt`, `gte`, `lt`, `lte`  | ISO 8601 datetime                |
| `updated_at`   | datetime | `gt`, `gte`, `lt`, `lte`  | ISO 8601 datetime                |
| `rework_count` | integer  | `eq`, `gt`, `gte`, `lt`, `lte` | Number of rework cycles     |

#### `GET /api/tickets/:id/events`

| Field          | Type     | Operators Supported       | Notes                            |
|----------------|----------|---------------------------|----------------------------------|
| `event_type`   | enum     | `eq`, `in`                | Audit event type                 |
| `agent_name`   | string   | `eq`                      | Agent that triggered the event   |
| `created_at`   | datetime | `gt`, `gte`, `lt`, `lte`  | Event timestamp                  |

### 6.4 Combination Logic

- Multiple filters on **different fields** combine with `AND`.
- Multiple values for the **same field** (comma-separated) combine with `OR` (i.e., `IN`).
- Unsupported filter fields are **silently ignored** (no error, to allow forward compatibility).

### 6.5 Example Filtered Request

```
GET /api/tickets?stage=READY,BACKEND&priority=critical,high&created_at[gte]=2026-03-01&page=1&page_size=10
```

SQL equivalent:
```sql
SELECT * FROM tickets
WHERE stage IN ('READY', 'BACKEND')
  AND priority IN ('critical', 'high')
  AND created_at >= '2026-03-01'
ORDER BY priority_order ASC, created_at ASC
LIMIT 10 OFFSET 0;
```

---

## 7. Idempotency Key Contract

### 7.1 Purpose

Mutating operations (POST, PUT, PATCH, DELETE) that modify ticket state support
idempotency keys to safely handle client retries and network failures.

### 7.2 Header Specification

| Property              | Value                                   |
|-----------------------|-----------------------------------------|
| **Header name**       | `Idempotency-Key`                       |
| **Key format**        | UUID v4 (client-generated)              |
| **Max length**        | 64 characters                           |
| **Character set**     | `[a-zA-Z0-9\-]`                         |
| **Required?**         | Optional for all mutating endpoints     |

### 7.3 Behavior

| Scenario                                  | Server Action                                                |
|-------------------------------------------|--------------------------------------------------------------|
| **First request** with key                | Execute normally; cache `{key, status, response, expires_at}` |
| **Duplicate request** with same key       | Return cached response with original HTTP status (200/201/204) |
| **Duplicate request**, original in-flight | Return `409 Conflict` with error code `CONCURRENT_MODIFICATION` |
| **No idempotency key**                    | Execute normally; no replay protection                       |
| **Expired key** (past dedup window)       | Treat as new request                                         |

### 7.4 Deduplication Window

| Property              | Value            | Notes                                   |
|-----------------------|------------------|-----------------------------------------|
| **Default TTL**       | 24 hours         | Configurable via `IDEMPOTENCY_TTL_HOURS` |
| **Storage**           | PostgreSQL table | `idempotency_keys` table                |
| **Cleanup**           | Periodic job     | Delete expired keys every hour          |

### 7.5 Response Semantics

When a cached response is replayed, the server includes an additional header:

| Header                    | Value                          | When                   |
|---------------------------|--------------------------------|------------------------|
| `Idempotent-Replayed`     | `true`                         | Replayed responses only|

### 7.6 Applicable Endpoints

| Method | Endpoint                          | Idempotency Supported |
|--------|-----------------------------------|-----------------------|
| POST   | `/api/tickets/:id/claim`          | Yes                   |
| POST   | `/api/tickets/:id/advance`        | Yes                   |
| POST   | `/api/tickets/:id/reject`         | Yes                   |
| POST   | `/api/tickets/:id/release`        | Yes                   |
| POST   | `/api/tickets/:id/spawn`          | Yes                   |
| PUT    | `/api/tickets/:id`                | Yes                   |
| GET    | (all list/read endpoints)         | N/A (inherently safe) |
| DELETE | (reserved for future use)         | Yes                   |

### 7.7 Idempotency Keys Table Schema

```sql
CREATE TABLE idempotency_keys (
  key          TEXT PRIMARY KEY,
  endpoint     TEXT NOT NULL,
  method       TEXT NOT NULL,
  status_code  INTEGER NOT NULL,
  response     JSONB NOT NULL,
  agent_id     UUID REFERENCES agents(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '24 hours'
);

CREATE INDEX idx_idempotency_keys_expires ON idempotency_keys (expires_at);
```

---

## 8. Rate Limiting Policy

### 8.1 Strategy: Token Bucket

Rate limiting uses a **token bucket** algorithm per identity, allowing burst
capacity while enforcing sustained throughput limits.

### 8.2 Rate Limit Tiers

| Tier           | Identity Key          | Requests/Minute | Burst Capacity | Description                        |
|----------------|-----------------------|-----------------|----------------|------------------------------------|
| **Per-Agent**  | `agent_id`            | 120              | 20             | Per authenticated agent            |
| **Per-Machine**| `machine_id`          | 300              | 50             | Per machine (across all agents)    |
| **Per-Endpoint (mutating)** | `agent_id + endpoint` | 30  | 10             | POST/PUT/PATCH/DELETE endpoints    |
| **Per-Endpoint (read)**     | `agent_id + endpoint` | 120 | 30             | GET endpoints                      |
| **Global**     | (none)                | 1000             | 200            | Server-wide limit                  |

### 8.3 Rate Limit Response Format

```json
{
  "error": "RATE_LIMITED",
  "message": "Rate limit exceeded. Retry after 12s",
  "details": {
    "limit": 120,
    "remaining": 0,
    "reset_at": "2026-03-07T14:01:00.000Z",
    "retry_after_seconds": 12
  },
  "timestamp": "2026-03-07T14:00:48.000Z"
}
```

### 8.4 Rate Limit Response Headers

All responses include rate limit headers:

| Header                  | Value                                  | Description                     |
|-------------------------|----------------------------------------|---------------------------------|
| `X-RateLimit-Limit`     | Max requests per window                | Applicable tier limit           |
| `X-RateLimit-Remaining` | Remaining requests in current window   | Decremented per request         |
| `X-RateLimit-Reset`     | Unix epoch seconds when window resets  | When the bucket refills         |
| `Retry-After`           | Seconds to wait                        | Only on `429` responses         |

### 8.5 Rate Limit Bypass

| Case                     | Behavior                                 |
|--------------------------|------------------------------------------|
| Health check (`/health`) | Exempt from all rate limits              |
| Admin API key            | Elevated tier (10x standard limits)      |
| SSE/WebSocket streams    | Connection-limited, not request-limited  |

---

## 9. Machine-Readable Error Reference (JSON)

The complete error catalog as a machine-readable JSON structure, suitable for
code generation, client SDK error handling, and documentation tooling.

```json
{
  "$schema": "https://forgeos.dev/schemas/error-catalog-v1.json",
  "version": "1.0.0",
  "generated": "2026-03-07T00:00:00Z",
  "categories": {
    "claim": {
      "description": "Ticket claim ownership conflicts",
      "errors": {
        "ALREADY_CLAIMED": {
          "numeric_code": 1001,
          "http_status": 409,
          "message_template": "Ticket {ticket_id} is already claimed by {agent_name}",
          "description": "The ticket is already claimed by another agent with an active lease",
          "retryable": false,
          "details_schema": {
            "claimed_by": "string",
            "machine_id": "string",
            "lease_expiry": "string (ISO 8601)"
          }
        },
        "NOT_CLAIM_OWNER": {
          "numeric_code": 1002,
          "http_status": 403,
          "message_template": "Agent {agent_name} does not own the claim on {ticket_id}",
          "description": "The caller does not own the claim on this ticket",
          "retryable": false,
          "details_schema": {
            "owner": "string",
            "caller": "string"
          }
        }
      }
    },
    "state": {
      "description": "SDLC lifecycle and lease violations",
      "errors": {
        "INVALID_TRANSITION": {
          "numeric_code": 2001,
          "http_status": 400,
          "message_template": "Cannot transition {ticket_id} from {from_stage} to {to_stage}",
          "description": "The requested stage transition violates the ticket's SDLC flow",
          "retryable": false,
          "details_schema": {
            "ticket_type": "string",
            "current_stage": "string",
            "requested_stage": "string",
            "allowed_stages": "string[]"
          }
        },
        "LEASE_EXPIRED": {
          "numeric_code": 2002,
          "http_status": 410,
          "message_template": "Lease on {ticket_id} expired at {expiry_time}",
          "description": "The agent's lease on the ticket has expired",
          "retryable": false,
          "details_schema": {
            "expired_at": "string (ISO 8601)",
            "agent_name": "string"
          }
        },
        "LEASE_TOO_LONG": {
          "numeric_code": 2003,
          "http_status": 400,
          "message_template": "Requested lease of {minutes}m exceeds project maximum of {max}m",
          "description": "The requested lease duration exceeds the project maximum",
          "retryable": false,
          "details_schema": {
            "requested_minutes": "number",
            "max_minutes": "number"
          }
        }
      }
    },
    "validation": {
      "description": "Input and business rule violations",
      "errors": {
        "TICKET_NOT_FOUND": {
          "numeric_code": 3001,
          "http_status": 404,
          "message_template": "Ticket {ticket_id} not found",
          "description": "The requested ticket does not exist",
          "retryable": false,
          "details_schema": {}
        },
        "MISSING_EVIDENCE": {
          "numeric_code": 3002,
          "http_status": 400,
          "message_template": "Stage completion requires evidence: {missing_fields}",
          "description": "Completion was attempted without required evidence fields",
          "retryable": false,
          "details_schema": {
            "missing_fields": "string[]"
          }
        },
        "INVALID_SUBTASK": {
          "numeric_code": 3003,
          "http_status": 400,
          "message_template": "Subtask violates parent constraints: {reason}",
          "description": "The spawned subtask violates parent scope or constraints",
          "retryable": false,
          "details_schema": {
            "parent_id": "string",
            "violation": "string"
          }
        },
        "FILE_CONFLICT": {
          "numeric_code": 3004,
          "http_status": 409,
          "message_template": "File {file_path} is locked by ticket {blocking_ticket_id}",
          "description": "A file in the ticket's scope is locked by another ticket",
          "retryable": true,
          "details_schema": {
            "file_path": "string",
            "blocking_ticket_id": "string",
            "blocking_agent": "string"
          }
        },
        "VALIDATION_ERROR": {
          "numeric_code": 3005,
          "http_status": 400,
          "message_template": "Request validation failed",
          "description": "The request body, query, or params failed Zod schema validation",
          "retryable": false,
          "details_schema": {
            "fields": [
              {
                "field": "string (dot-joined path)",
                "message": "string",
                "code": "string (Zod issue code)"
              }
            ]
          }
        }
      }
    },
    "auth": {
      "description": "Authentication and authorization failures",
      "errors": {
        "UNAUTHORIZED": {
          "numeric_code": 4001,
          "http_status": 401,
          "message_template": "Authentication required",
          "description": "Missing or invalid credentials (Bearer token or API key)",
          "retryable": false,
          "details_schema": {}
        },
        "FORBIDDEN": {
          "numeric_code": 4002,
          "http_status": 403,
          "message_template": "Insufficient permissions for {operation}",
          "description": "The agent lacks the required permission for this operation",
          "retryable": false,
          "details_schema": {
            "required_permission": "string",
            "agent_permissions": "string[]"
          }
        }
      }
    },
    "rate_limit": {
      "description": "API rate limit exceeded",
      "errors": {
        "RATE_LIMITED": {
          "numeric_code": 5001,
          "http_status": 429,
          "message_template": "Rate limit exceeded. Retry after {seconds}s",
          "description": "The agent has exceeded the API rate limit for this endpoint or tier",
          "retryable": true,
          "details_schema": {
            "limit": "number",
            "remaining": "number",
            "reset_at": "string (ISO 8601)",
            "retry_after_seconds": "number"
          }
        }
      }
    },
    "system": {
      "description": "Infrastructure and internal errors",
      "errors": {
        "INTERNAL_ERROR": {
          "numeric_code": 6001,
          "http_status": 500,
          "message_template": "An internal error occurred",
          "description": "An unexpected internal error occurred (unhandled exception, deserialization failure)",
          "retryable": true,
          "details_schema": {}
        },
        "DB_UNAVAILABLE": {
          "numeric_code": 6002,
          "http_status": 503,
          "message_template": "Database service unavailable",
          "description": "The PostgreSQL database is unreachable (connection refused, pool exhausted, timeout)",
          "retryable": true,
          "details_schema": {
            "pg_code": "string (SQLSTATE, optional)"
          }
        },
        "SERVICE_TIMEOUT": {
          "numeric_code": 6003,
          "http_status": 504,
          "message_template": "Upstream service timed out after {timeout_ms}ms",
          "description": "A database query or external call exceeded the configured timeout threshold",
          "retryable": true,
          "details_schema": {
            "timeout_ms": "number",
            "operation": "string"
          }
        },
        "DEPENDENCY_BLOCKED": {
          "numeric_code": 6004,
          "http_status": 422,
          "message_template": "Ticket {ticket_id} is blocked by unresolved dependencies: {deps}",
          "description": "An operation was attempted on a ticket whose depends_on tickets are not DONE",
          "retryable": false,
          "details_schema": {
            "blocking_tickets": "string[]",
            "blocking_stages": "Record<string, string>"
          }
        },
        "IDEMPOTENT_REPLAY": {
          "numeric_code": 6005,
          "http_status": 200,
          "message_template": "Request already processed (idempotency key: {key})",
          "description": "A duplicate request with the same idempotency key was received within the dedup window",
          "retryable": false,
          "details_schema": {
            "idempotency_key": "string",
            "original_timestamp": "string (ISO 8601)"
          }
        },
        "CONCURRENT_MODIFICATION": {
          "numeric_code": 6006,
          "http_status": 409,
          "message_template": "Ticket {ticket_id} was modified concurrently",
          "description": "An optimistic lock violation occurred (version mismatch on update)",
          "retryable": true,
          "details_schema": {
            "expected_version": "number",
            "actual_version": "number"
          }
        },
        "LEASE_CONFLICT": {
          "numeric_code": 6007,
          "http_status": 409,
          "message_template": "Cannot extend lease: ticket {ticket_id} was reclaimed",
          "description": "A lease extension was attempted but the ticket was reclaimed by another agent",
          "retryable": false,
          "details_schema": {
            "new_owner": "string",
            "reclaimed_at": "string (ISO 8601)"
          }
        }
      }
    }
  }
}
```

---

## 10. Implementation Guide

### 10.1 PostgreSQL Error Code Mapping

The error handler maps PostgreSQL SQLSTATE codes to ForgeOS error codes.
Below is the complete mapping:

| SQLSTATE Class | Codes           | ForgeOS Error Code    | Scenario                      |
|----------------|-----------------|----------------------|-------------------------------|
| 08 (Connection) | 08000–08006    | `DB_UNAVAILABLE`     | Connection exception          |
| 23 (Integrity)  | 23502          | `INTERNAL_ERROR`     | NOT NULL violation            |
| 23 (Integrity)  | 23503          | `TICKET_NOT_FOUND`   | Foreign key violation         |
| 23 (Integrity)  | 23505          | `ALREADY_CLAIMED`    | Unique constraint violation   |
| 40 (Transaction)| 40001          | `INTERNAL_ERROR`     | Serialization failure         |
| 40 (Transaction)| 40P01          | `INTERNAL_ERROR`     | Deadlock detected             |
| 42 (Syntax)     | 42P01          | `DB_UNAVAILABLE`     | Undefined table               |
| 57 (Operator)   | 57P01–57P03    | `DB_UNAVAILABLE`     | Admin/crash shutdown          |

### 10.2 Error Code → HTTP Status Mapping

Complete mapping table for all 20 error codes:

| ForgeOS Error Code       | HTTP Status | Category       |
|--------------------------|-------------|----------------|
| `TICKET_NOT_FOUND`       | 404         | Validation     |
| `ALREADY_CLAIMED`        | 409         | Claim          |
| `NOT_CLAIM_OWNER`        | 403         | Claim          |
| `FILE_CONFLICT`          | 409         | Validation     |
| `INVALID_TRANSITION`     | 400         | State          |
| `MISSING_EVIDENCE`       | 400         | Validation     |
| `INVALID_SUBTASK`        | 400         | Validation     |
| `LEASE_EXPIRED`          | 410         | State          |
| `LEASE_TOO_LONG`         | 400         | State          |
| `RATE_LIMITED`            | 429         | Rate Limit     |
| `UNAUTHORIZED`           | 401         | Auth           |
| `FORBIDDEN`              | 403         | Auth           |
| `INTERNAL_ERROR`         | 500         | System         |
| `DB_UNAVAILABLE`         | 503         | System         |
| `VALIDATION_ERROR`       | 400         | Validation     |
| `SERVICE_TIMEOUT`        | 504         | System         |
| `DEPENDENCY_BLOCKED`     | 422         | System         |
| `IDEMPOTENT_REPLAY`      | 200         | System         |
| `CONCURRENT_MODIFICATION`| 409         | System         |
| `LEASE_CONFLICT`         | 409         | System         |

### 10.3 Extending the Error Catalog

To add a new error code:

1. Add the string code to the `ForgeOSErrorCode` enum in `forgeos-server/src/types/index.ts`
2. Add the HTTP mapping to `HTTP_STATUS_MAP` in `forgeos-server/src/middleware/error-handler.ts`
3. Add the PostgreSQL mapping (if applicable) to `PG_ERROR_MAP`
4. Add the entry to the machine-readable JSON in Section 9
5. Update the OpenAPI spec `ForgeOSErrorCode` enum in `docs/architecture/api/openapi-spec.yaml`
6. Ensure clients handle the new code gracefully (unknown codes fallback to `INTERNAL_ERROR`)

### 10.4 Client Error Handling Pattern

```typescript
async function handleApiResponse(response: Response): Promise<void> {
  if (!response.ok) {
    const body: ErrorResponse = await response.json();

    switch (body.error) {
      case 'ALREADY_CLAIMED':
        // Wait for lease expiry, then retry
        const leaseExpiry = body.details?.lease_expiry as string;
        await waitUntil(leaseExpiry);
        break;

      case 'RATE_LIMITED':
        // Respect Retry-After header
        const retryAfter = parseInt(response.headers.get('Retry-After') ?? '60');
        await sleep(retryAfter * 1000);
        break;

      case 'LEASE_EXPIRED':
        // Re-claim the ticket
        await reclaimTicket(body.ticket_id!);
        break;

      case 'DB_UNAVAILABLE':
      case 'SERVICE_TIMEOUT':
      case 'INTERNAL_ERROR':
        // Retry with exponential backoff
        await retryWithBackoff(request, { maxRetries: 3 });
        break;

      case 'VALIDATION_ERROR':
        // Log field-level errors
        const fields = (body.details as any)?.fields ?? [];
        fields.forEach((f: any) => console.error(`${f.field}: ${f.message}`));
        break;

      default:
        // Unknown error — log and surface to operator
        console.error(`Unhandled error: ${body.error} — ${body.message}`);
    }
  }
}
```

---

## Appendix A: OpenAPI Error Response Schema

The following schema is already defined in the OpenAPI spec and used by all
error-returning endpoints:

```yaml
ErrorResponse:
  type: object
  required:
    - error
    - message
    - timestamp
  properties:
    error:
      $ref: '#/components/schemas/ForgeOSErrorCode'
    message:
      type: string
      description: Human-readable error description
    details:
      type: object
      additionalProperties: true
      description: Optional additional context
    ticket_id:
      type: string
      description: The ticket involved in the error, if applicable
    timestamp:
      type: string
      format: date-time
      description: ISO 8601 timestamp when the error occurred
```

## Appendix B: ADR — Error Catalog Design Decisions

### ADR: Offset-Based Pagination over Cursor-Based

**Status:** Accepted

**Context:** ForgeOS ticket lists are bounded (< 10k items), dashboard requires
total counts and page numbers, and data rarely mutates during a pagination session.

**Decision:** Use offset-based (`page` + `page_size`) pagination.

**Consequences:** Simpler implementation; adequate for bounded dataset. If ticket
volume exceeds 100k, re-evaluate cursor-based approach.

### ADR: Token Bucket Rate Limiting

**Status:** Accepted

**Context:** Agents operate in bursts (claim + multiple updates + complete). Fixed
window rate limiting penalizes burst patterns.

**Decision:** Use token bucket algorithm with per-agent, per-machine, and per-endpoint tiers.

**Consequences:** Accommodates burst patterns; requires token bucket state tracking
in Redis or PostgreSQL.

### ADR: Numeric Error Codes alongside String Codes

**Status:** Accepted

**Context:** String codes (`ALREADY_CLAIMED`) are human-readable but verbose for
logging and monitoring. Numeric codes enable compact dashboards and alerting rules.

**Decision:** Assign stable numeric codes per category range (1xxx claim, 2xxx state,
3xxx validation, 4xxx auth, 5xxx rate limit, 6xxx system). String codes remain the
primary identifier in the API. Numeric codes are for metrics and documentation only.

**Consequences:** Dual identification system; string codes are authoritative in API
payloads.

### ADR: Idempotency Key with 24-Hour TTL

**Status:** Accepted

**Context:** Agent retries after network failures must not duplicate state mutations
(e.g., double-claiming a ticket).

**Decision:** Support optional `Idempotency-Key` header on mutating endpoints with
24-hour deduplication window stored in PostgreSQL.

**Consequences:** Adds an `idempotency_keys` table; requires periodic cleanup job.
In-memory (Redis) caching may be added later for performance.

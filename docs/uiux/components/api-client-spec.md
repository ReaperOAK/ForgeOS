---
title: API Client and Data Models — Interface Specification
ticket: FORGEOS-FE002
type: component-spec
author: UIDesigner
date: 2026-03-11T00:00:00Z
status: APPROVED
---

# API Client and Data Models — Interface Specification

> **Ticket:** FORGEOS-FE002 | **Agent:** UIDesigner | **Date:** 2026-03-11

This document defines the TypeScript interface contracts, API function signatures,
error handling patterns, and configuration model for the dashboard API client layer.
These specs are the **gate artifact** for Frontend implementation.

---

## 1. File Structure

```
dashboard/src/lib/api/
├── types.ts      — Data model interfaces and type aliases
├── client.ts     — Base API client class (extends existing api-client.ts)
├── tickets.ts    — Ticket-specific API functions
└── index.ts      — Public barrel export
```

### Relationship to Existing Code

- `dashboard/src/lib/api-client.ts` — Existing base `ApiClient` class with `get<T>()`, `healthCheck()`, `ApiResponse<T>`, `ApiError`. The new `client.ts` extends this pattern.
- `dashboard/src/lib/types.ts` — Existing app-level types (`Theme`, `ConnectionStatus`, `HealthCheckResult`). The new `types.ts` adds domain-specific API models.

---

## 2. Data Model Interfaces (`types.ts`)

All interfaces mirror the backend models defined in `forgeos-server/src/types/index.ts`
and the PostgreSQL schema. Only fields needed by the dashboard are included.

### 2.1 Enums and Type Aliases

```typescript
/** SDLC pipeline stage. Matches backend TicketStage enum. */
export type TicketStage =
  | 'READY' | 'RESEARCH' | 'ARCHITECT' | 'PRODUCT_MANAGER' | 'UI_DESIGN'
  | 'BACKEND' | 'FRONTEND' | 'QA' | 'SECURITY' | 'CI'
  | 'DOCUMENTATION' | 'VALIDATOR' | 'DONE';

/** Ticket operational status. Matches backend TicketStatus enum. */
export type TicketStatus =
  | 'READY' | 'BLOCKED' | 'CLAIMED' | 'IN_PROGRESS'
  | 'DONE' | 'FAILED' | 'ESCALATED';

/** Ticket classification type. Determines SDLC flow. */
export type TicketType =
  | 'backend' | 'frontend' | 'fullstack' | 'infra' | 'security'
  | 'docs' | 'research' | 'architecture' | 'product' | 'design';

/** Ticket priority level. */
export type TicketPriority = 'critical' | 'high' | 'medium' | 'low';

/** Audit event type. Matches backend EventType enum. */
export type EventType =
  | 'CREATED' | 'CLAIMED' | 'RELEASED' | 'STAGE_ADVANCED' | 'STAGE_REJECTED'
  | 'UPDATED' | 'SPAWNED' | 'ESCALATED' | 'LEASE_EXTENDED' | 'FORCE_RELEASED'
  | 'RECONCILED' | 'FILE_LOCKED' | 'FILE_UNLOCKED' | 'HEARTBEAT' | 'COMPLETED';
```

### 2.2 Ticket

The core domain model. All 28 fields map to the backend `Ticket` interface.

```typescript
export interface Ticket {
  id: string;                          // UUID primary key
  ticket_id: string;                   // Human-readable ID (e.g., "FORGEOS-FE002")
  project_id: string | null;
  title: string;
  description: string | null;
  type: TicketType;
  priority: TicketPriority;
  status: TicketStatus;
  stage: TicketStage;
  sdlc_flow: TicketStage[];
  claimed_by: string | null;           // Agent UUID
  claimed_by_name: string | null;      // Agent display name
  machine_id: string | null;
  operator: string | null;
  lease_expiry: string | null;         // ISO 8601
  lease_duration_minutes: number;
  depends_on: string[];                // Array of ticket_id values
  file_paths: string[];
  acceptance_criteria: string[];
  tags: string[];
  rework_count: number;
  max_reworks: number;
  metadata: Record<string, unknown>;
  parent_id: string | null;
  source_task_file: string | null;
  created_at: string;                  // ISO 8601
  updated_at: string;                  // ISO 8601
  completed_at: string | null;         // ISO 8601
}
```

### 2.3 Claim

Derived from Ticket fields relevant to the Claims view.

```typescript
export interface Claim {
  ticket_id: string;
  title: string;
  stage: TicketStage;
  claimed_by_name: string;
  machine_id: string;
  operator: string | null;
  lease_expiry: string;                // ISO 8601
  lease_duration_minutes: number;
  status: TicketStatus;
}
```

> **Note:** The backend does not have a separate `/api/claims` endpoint. Claims
> are derived by filtering tickets with `status = 'CLAIMED' | 'IN_PROGRESS'`.
> The Frontend should use `fetchTickets({ status: 'CLAIMED' })` and map results.

### 2.4 StageTransition

Represents a single stage/status change event in the ticket history.

```typescript
export interface StageTransition {
  previous_stage: TicketStage | null;
  new_stage: TicketStage | null;
  previous_status: TicketStatus | null;
  new_status: TicketStatus | null;
  timestamp: string;                   // ISO 8601
  agent_name: string | null;
  machine_id: string | null;
}
```

### 2.5 EventHistory

Full audit event from the backend `TicketEvent` model.

```typescript
export interface EventHistory {
  id: string;                          // UUID
  ticket_id: string;
  event_type: EventType;
  agent_id: string | null;
  agent_name: string | null;
  machine_id: string | null;
  operator: string | null;
  previous_stage: TicketStage | null;
  new_stage: TicketStage | null;
  previous_status: TicketStatus | null;
  new_status: TicketStatus | null;
  payload: Record<string, unknown>;
  created_at: string;                  // ISO 8601
}
```

### 2.6 PipelineOverview

Matches the backend `GET /api/stages` response shape.

```typescript
export interface StageSummary {
  count: number;
  claimed: number;
  ready: number;
}

export interface PipelineOverview {
  stages: Record<string, StageSummary>;
  total_tickets: number;
  timestamp: string;                   // ISO 8601
}
```

### 2.7 Pagination

Generic pagination wrapper matching the backend `PaginatedResponse<T>`.

```typescript
export interface PaginationInfo {
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: PaginationInfo;
}
```

### 2.8 TicketDetail

Extended ticket model returned by `GET /api/tickets/:id` with resolved dependency info.

```typescript
export interface DependencyStatus {
  ticket_id: string;
  title: string | null;
  status: string;
  is_resolved: boolean;
}

export interface TicketDetail extends Ticket {
  dependency_status: DependencyStatus[];
}
```

---

## 3. Error Handling Model

### 3.1 ApiError Interface

Extends the existing `ApiError` from `api-client.ts` with structured fields.

```typescript
export interface ApiError {
  message: string;
  status: number;
  code?: string;          // Machine-readable error code (e.g., "TICKET_NOT_FOUND")
  details?: unknown;      // Optional validation details from Zod
}
```

### 3.2 Error Response Mapping

| HTTP Status | Meaning | `code` | Dashboard Behavior |
|-------------|---------|--------|--------------------|
| 400 | Invalid query params | `VALIDATION_ERROR` | Show inline validation message |
| 401 | Missing/invalid auth | `UNAUTHORIZED` | Redirect to auth or show banner |
| 403 | Insufficient permissions | `FORBIDDEN` | Show "access denied" banner |
| 404 | Ticket not found | `NOT_FOUND` | Show "ticket not found" state |
| 429 | Rate limited | `RATE_LIMITED` | Show retry countdown |
| 500 | Server error | `INTERNAL_ERROR` | Show generic error with retry button |
| 503 | Service unavailable | `SERVICE_UNAVAILABLE` | Show offline banner |
| 0 (network) | Network failure / timeout | `NETWORK_ERROR` | Show connection error toast |

### 3.3 Error Parsing

```typescript
async function parseErrorResponse(response: Response): Promise<ApiError> {
  // Attempt to parse JSON body for structured error
  // Fall back to status text if body is not JSON
  // Return { message, status, code?, details? }
}
```

### 3.4 Abort/Timeout Handling

The existing `ApiClient` uses `AbortController` with a configurable timeout
(`DEFAULT_TIMEOUT = 10_000`). Aborted requests should produce:

```typescript
{ message: 'Request timeout', status: 0, code: 'NETWORK_ERROR' }
```

---

## 4. API Function Signatures (`tickets.ts`)

All functions use the base `ApiClient.get<T>()` method from the existing client.

### 4.1 Ticket List Filters

```typescript
export interface TicketFilters {
  stage?: TicketStage;
  type?: TicketType;
  status?: TicketStatus;
  priority?: TicketPriority;
  claimed_by?: string;
  limit?: number;    // default: 20, max: 100
  offset?: number;   // default: 0
}
```

### 4.2 fetchTickets

```typescript
/**
 * Fetch paginated, filterable ticket list.
 * Backend endpoint: GET /api/tickets?stage=...&type=...&limit=...&offset=...
 *
 * @param filters - Optional query filters
 * @returns Paginated array of Ticket objects
 * @throws ApiError on network or server failure
 */
export async function fetchTickets(
  filters?: TicketFilters,
): Promise<PaginatedResponse<Ticket>>;
```

**Query string construction:** Convert `filters` to URL search params, omitting
`undefined` values. Example: `?stage=BACKEND&priority=critical&limit=20&offset=0`

### 4.3 fetchTicket

```typescript
/**
 * Fetch full ticket detail by ticket_id (human-readable ID, not UUID).
 * Backend endpoint: GET /api/tickets/:id
 * Returns ticket with resolved dependency status array.
 *
 * @param ticketId - Human-readable ticket ID (e.g., "FORGEOS-FE002")
 * @returns TicketDetail with dependency resolution info
 * @throws ApiError with status 404 if ticket not found
 */
export async function fetchTicket(
  ticketId: string,
): Promise<TicketDetail>;
```

### 4.4 fetchPipelineOverview

```typescript
/**
 * Fetch pipeline overview with counts per stage.
 * Backend endpoint: GET /api/stages
 *
 * @returns PipelineOverview with stage-level count/claimed/ready metrics
 * @throws ApiError on network or server failure
 */
export async function fetchPipelineOverview(): Promise<PipelineOverview>;
```

### 4.5 fetchTicketHistory

```typescript
/**
 * Fetch ordered event timeline for a specific ticket.
 * Backend endpoint: GET /api/tickets/:id/history
 *
 * @param ticketId - Human-readable ticket ID
 * @returns Array of EventHistory ordered by created_at ascending
 * @throws ApiError with status 404 if ticket not found
 */
export async function fetchTicketHistory(
  ticketId: string,
): Promise<EventHistory[]>;
```

---

## 5. Configuration Interface (`client.ts`)

### 5.1 ApiClientConfig

```typescript
export interface ApiClientConfig {
  /** Base URL for the ForgeOS MCP server. Defaults to NEXT_PUBLIC_API_URL. */
  baseUrl: string;
  /** Request timeout in milliseconds. Default: 10000. */
  timeout: number;
  /** Additional headers to include in every request. */
  headers: Record<string, string>;
}
```

### 5.2 Default Configuration

```typescript
const DEFAULT_CONFIG: ApiClientConfig = {
  baseUrl: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3011',
  timeout: 10_000,
  headers: {
    'Content-Type': 'application/json',
  },
};
```

### 5.3 Client Singleton

The existing `apiClient` singleton pattern in `api-client.ts` should be preserved.
The new `client.ts` re-exports and/or extends it:

```typescript
// Extend the existing ApiClient with ticket-specific convenience
export const apiClient = new ApiClient(DEFAULT_CONFIG.baseUrl, DEFAULT_CONFIG.timeout);
```

---

## 6. Barrel Export (`index.ts`)

```typescript
// Re-export all types
export type {
  Ticket, TicketDetail, Claim, StageTransition, EventHistory,
  PipelineOverview, StageSummary, PaginatedResponse, PaginationInfo,
  DependencyStatus, TicketFilters, ApiClientConfig, ApiError,
  TicketStage, TicketStatus, TicketType, TicketPriority, EventType,
} from './types';

// Re-export API functions
export {
  fetchTickets, fetchTicket, fetchPipelineOverview, fetchTicketHistory,
} from './tickets';

// Re-export client
export { apiClient } from './client';
```

---

## 7. Backend API Reference

Summary of backend endpoints consumed by this client:

| Endpoint | Method | Response Shape | Auth |
|----------|--------|----------------|------|
| `/api/tickets` | GET | `PaginatedResponse<Ticket>` | Required |
| `/api/tickets/:id` | GET | `TicketDetail` | Required |
| `/api/tickets/:id/history` | GET | `EventHistory[]` | Required |
| `/api/stages` | GET | `PipelineOverview` | Required |
| `/api/health` | GET | `{ status: string }` | None |
| `/api/events` | GET (SSE) | Server-Sent Events stream | Optional |

### Query Parameters for `/api/tickets`

| Param | Type | Default | Validation |
|-------|------|---------|------------|
| `stage` | `TicketStage` | — | Must be valid stage enum value |
| `type` | `TicketType` | — | Must be valid type enum value |
| `status` | `TicketStatus` | — | Must be valid status enum value |
| `priority` | `TicketPriority` | — | Must be valid priority enum value |
| `claimed_by` | `string` | — | Agent name string |
| `limit` | `number` | 20 | 1–100, integer |
| `offset` | `number` | 0 | ≥0, integer |

---

## 8. Implementation Notes for Frontend Engineer

1. **Extend, don't replace** the existing `api-client.ts`. The new `dashboard/src/lib/api/client.ts` can import and wrap the existing client or create a new instance with the same pattern.

2. **Type re-use**: Keep backend-specific types (Agent, Session, FileLock) out of the dashboard types. Only include what the dashboard actually renders.

3. **Error boundary integration**: `ApiError` should be catchable by React error boundaries. Consider wrapping API calls in a `useQuery`-style hook later (separate ticket).

4. **SSE events** are out of scope for this ticket. The `/api/events` SSE stream will be handled by a separate real-time data ticket.

5. **Authentication headers**: The backend expects authentication via the `authMiddleware`. For the initial dashboard, API key–based auth headers should be configurable via `ApiClientConfig.headers`.

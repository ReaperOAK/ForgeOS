---
title: "PRD: ForgeOS MCP Server — Operational Readiness"
id: PRD-MCP-OPS-001
type: prd
author: Product Manager
date: 2026-03-12T00:00:00Z
status: DRAFT
priority: P0
audience: Architect, Backend Engineers, DevOps, QA
upstream: .github/agent-output/Research/CTO-research.md
tags: [mcp, operational, p0, infrastructure, typescript]
---

# PRD: ForgeOS MCP Server — Operational Readiness

> **Author:** Product Manager | **Date:** 2026-03-12  
> **Upstream:** Research Analyst gap analysis (CTO-research.md)  
> **Confidence:** HIGH (90%)

---

## Table of Contents

1. [Problem Statement](#1-problem-statement)
2. [Success Criteria](#2-success-criteria)
3. [User Personas](#3-user-personas)
4. [Feature Requirements](#4-feature-requirements)
5. [Non-Functional Requirements](#5-non-functional-requirements)
6. [Acceptance Criteria](#6-acceptance-criteria)
7. [Out of Scope](#7-out-of-scope)
8. [Risks and Mitigations](#8-risks-and-mitigations)
9. [Assumptions](#9-assumptions)
10. [Dependencies](#10-dependencies)
11. [Glossary](#11-glossary)

---

## 1. Problem Statement

### 1.1 Current State

The ForgeOS project contains a TypeScript MCP server (`forgeos-server/`), PostgreSQL infrastructure, a Python Agent SDK (`agent-sdk/`), and a Next.js dashboard (`dashboard/`). Over 150 tickets have been marked DONE. **None of these components can be started, compiled, or used.** The system has never been run end-to-end.

### 1.2 Specific Problems

| # | Problem | Evidence | Impact |
|---|---------|----------|--------|
| 1 | TypeScript cannot compile | `tsconfig.json` does not exist | `npm run build` fails; Docker build fails |
| 2 | Docker Compose cannot start | `infra/secrets/db_password` does not exist | `docker compose up` fails immediately |
| 3 | Database authentication fails | `DATABASE_URL` in compose files has no password but PostgreSQL requires one | Server crash on first connection attempt |
| 4 | MCP protocol is broken | New transport created per HTTP request; `mcpServer.connect()` called per request | Race conditions, memory leaks, broken sessions |
| 5 | Middleware chain is incomplete | `requestIdMiddleware` and `errorHandler` not mounted in Express app | Missing correlation IDs, raw error stack traces leaked |
| 6 | REST API is unreachable | `createApiRouter()` defined but never mounted on the Express app | Dashboard and monitoring endpoints return 404 |
| 7 | Agent bootstrap is impossible | Auth middleware blocks all requests; agents table starts empty; no bootstrap flow | First agent can never register |
| 8 | Two tools are invisible | `tickets.release` and `tickets.stats` are fully implemented but not registered | Agents cannot release claims or query statistics |
| 9 | Database migrations conflict | Docker `initdb.d` runs migrations AND the app re-runs them at startup | Startup crash from duplicate enum/type creation |
| 10 | Tool handler bugs | `tickets.reject` uses hardcoded agent name `'system'`; `tickets.update` skips ownership check | Rejection always fails; any agent can modify any ticket |

### 1.3 Cost of Inaction

- **AI agents cannot connect** — the entire multi-agent orchestration system is inert.
- **Human operators cannot monitor** — the dashboard has no data source.
- **150+ completed tickets** represent dead engineering effort until the platform runs.
- **No integration testing** is possible — nothing starts.

### 1.4 Business Goal

Make the ForgeOS MCP server start, accept MCP connections, and execute the core ticket lifecycle so that AI agents can claim work, perform tasks, and advance tickets through the SDLC pipeline.

---

## 2. Success Criteria (Definition of "Working MCP")

"The MCP server works" means ALL of the following are true simultaneously:

| # | Criterion | Verification Method |
|---|-----------|-------------------|
| SC-1 | `npm run build` compiles with zero errors | Run `cd forgeos-server && npm run build` — exit code 0, `dist/` directory produced |
| SC-2 | `docker compose up` starts all services | Run `docker compose -f infra/docker-compose.yml up -d` — postgres, mcp-server containers healthy within 60s |
| SC-3 | PostgreSQL accepts connections with migrations applied | `psql` into the container; verify `tickets`, `agents`, `events`, `file_locks` tables exist |
| SC-4 | MCP endpoint responds to `initialize` | Send MCP `initialize` request to `POST http://localhost:3011/mcp` — receive valid MCP response with `serverInfo` and tool list |
| SC-5 | All 9 tools are listed | MCP `tools/list` response includes: `tickets.next`, `tickets.claim`, `tickets.complete`, `tickets.reject`, `tickets.extend`, `tickets.update`, `tickets.spawn`, `tickets.release`, `tickets.stats` |
| SC-6 | An agent can register and authenticate | POST to a bootstrap/registration endpoint returns an API key; subsequent MCP requests with that key succeed |
| SC-7 | Core lifecycle executes end-to-end | Seed a ticket → agent claims it via `tickets.claim` → agent completes via `tickets.complete` → ticket moves to next stage |
| SC-8 | `/health` returns accurate status | `GET http://localhost:3011/health` returns `200` with `{ "status": "ok", "database": "connected" }` |
| SC-9 | REST API is accessible | `GET http://localhost:3011/api/tickets` returns ticket list; `GET http://localhost:3011/api/stages` returns stage pipeline |
| SC-10 | Agent SDK connects successfully | Python script using `forgeos_sdk` connects to `http://localhost:3011/mcp`, lists tools, claims a ticket |
| SC-11 | Dashboard loads and shows data | `GET http://localhost:3011/dashboard` returns HTML; ticket board renders with seeded data |
| SC-12 | SSE events stream updates | Client subscribes to SSE endpoint; performing a `tickets.claim` action produces a real-time event |

---

## 3. User Personas

### 3.1 AI Agent (Primary User)

| Attribute | Detail |
|-----------|--------|
| **Who** | Autonomous LLM-based coding agents (Backend, Frontend, QA, Security, etc.) |
| **Interface** | MCP JSON-RPC over Streamable HTTP (`POST /mcp`) |
| **Goal** | Claim a ticket, execute stage work, advance the pipeline |
| **Key needs** | Reliable tool invocation, structured error responses, lease management, deterministic state transitions |
| **Pain points** | Cannot connect at all; no bootstrap flow; no error detail on failure |
| **Success metric** | Complete a claim→work→advance cycle without manual intervention |

### 3.2 Human Operator

| Attribute | Detail |
|-----------|--------|
| **Who** | Software engineer or team lead running the ForgeOS dispatcher dispatcher |
| **Interface** | CLI (`tickets.py`), web dashboard, REST API |
| **Goal** | Monitor agent progress, intervene on stuck tickets, verify pipeline health |
| **Key needs** | Real-time visibility into ticket states, agent activity, error logs |
| **Pain points** | Dashboard shows nothing; REST API returns 404; no structured logs |
| **Success metric** | See live ticket board with agent activity within 30 seconds of action |

### 3.3 DevOps / System Admin

| Attribute | Detail |
|-----------|--------|
| **Who** | Engineer responsible for deploying and maintaining ForgeOS infrastructure |
| **Interface** | Docker Compose, environment variables, health checks, logs |
| **Goal** | Start the system reliably, monitor health, recover from failures |
| **Key needs** | One-command startup, accurate health checks, structured logs, clean shutdown |
| **Pain points** | Docker build fails; secrets missing; double migration crashes; no health signal |
| **Success metric** | `docker compose up` produces healthy system in < 60 seconds |

---

## 4. Feature Requirements

### 4.1 P0 — System Must Start and Accept Connections (MVP)

These are hard blockers. Without every P0, no user can interact with the system.

#### P0-1: TypeScript Compilation

**As a** DevOps engineer, **I want** `npm run build` to compile the TypeScript server, **so that** I can produce a deployable artifact.

**Acceptance Criteria:**
- Given the `forgeos-server/` directory, when I run `npm run build`, then it exits with code 0
- Given a successful build, then a `dist/` directory exists with compiled JS files
- Given the compiled output, when I run `node dist/index.js` with valid env vars, then the server starts

#### P0-2: Docker Build Succeeds

**As a** DevOps engineer, **I want** `docker build` to produce a container image, **so that** I can deploy via Docker Compose.

**Acceptance Criteria:**
- Given the `forgeos-server/` directory, when I run `docker build .`, then it exits with code 0
- Given the built image, when I run `docker run <image> --help`, then the process starts without error
- Given the Dockerfile, then `COPY ... tsconfig.json` succeeds (file exists)

#### P0-3: Docker Compose Starts All Services

**As a** DevOps engineer, **I want** `docker compose up` to start PostgreSQL and the MCP server, **so that** the system is ready to accept connections.

**Acceptance Criteria:**
- Given `infra/docker-compose.yml`, when I run `docker compose up -d`, then both `postgres` and `mcp-server` containers reach `healthy` status within 60 seconds
- Given Docker secrets are configured, then `infra/secrets/db_password` exists and is readable
- Given the `DATABASE_URL`, then it includes the correct password matching the PostgreSQL secret

#### P0-4: Database Migrations Run Once Without Error

**As a** DevOps engineer, **I want** migrations to execute exactly once on startup, **so that** the schema is correctly initialized.

**Acceptance Criteria:**
- Given a fresh PostgreSQL container, when the MCP server starts, then all tables (`tickets`, `agents`, `events`, `file_locks`, `schema_migrations`) exist
- Given migrations have already run, when the server restarts, then no duplicate migration errors occur
- Given the `event_type` enum, then it includes all values referenced by TypeScript (`HEARTBEAT`, `COMPLETED` included)

#### P0-5: MCP Endpoint Accepts Connections

**As an** AI agent, **I want** to send MCP `initialize` requests to `/mcp`, **so that** I can discover available tools.

**Acceptance Criteria:**
- Given the server is running, when I `POST` a valid MCP `initialize` request to `http://localhost:3011/mcp`, then I receive a valid MCP response with `serverInfo`
- Given a connected MCP session, when I send `tools/list`, then I receive a list of 9 tools
- Given concurrent MCP requests from 2 agents, then both receive correct responses without interference

#### P0-6: Agent Authentication and Bootstrap

**As an** AI agent connecting for the first time, **I want** to register and receive an API key, **so that** I can authenticate subsequent requests.

**Acceptance Criteria:**
- Given a fresh system with no agents, when an admin creates the first agent, then the agent receives a valid API key
- Given a valid API key, when the agent sends an MCP request with `Authorization: Bearer <key>`, then the request is authenticated
- Given an invalid API key, when the agent sends an MCP request, then it receives a `401 Unauthorized` error with structured JSON body

#### P0-7: Core Ticket Lifecycle (Claim → Work → Advance)

**As an** AI agent, **I want** to claim a ticket, perform work, and advance it to the next stage, **so that** the SDLC pipeline progresses.

**Acceptance Criteria:**
- Given a ticket in READY state, when agent calls `tickets.next` with its stage, then it receives the ticket details
- Given an unclaimed ticket, when agent calls `tickets.claim` with ticket ID and agent name, then the ticket is claimed with a 30-minute lease
- Given a claimed ticket, when the owning agent calls `tickets.complete`, then the ticket moves to the next SDLC stage
- Given a claimed ticket, when a *different* agent calls `tickets.complete`, then the request is rejected with `NOT_CLAIM_OWNER`

---

### 4.2 P1 — System Is Usable by Agents

Agents can complete full workflows with proper error handling and monitoring.

#### P1-1: All 9 Tools Registered and Functional

**As an** AI agent, **I want** all ticket lifecycle tools to be available and correct, **so that** I can perform any operation.

**Acceptance Criteria:**
- Given the MCP server, then `tickets.release` and `tickets.stats` appear in `tools/list`
- Given a claimed ticket, when calling `tickets.reject` with the correct agent name, then the ticket enters REWORK
- Given a claimed ticket, when calling `tickets.update` from a non-owner agent, then the request is rejected

#### P1-2: REST API Accessible

**As a** human operator, **I want** the REST API to be mounted and respond, **so that** the dashboard has a data source.

**Acceptance Criteria:**
- Given the server is running, then `GET /api/tickets` returns a JSON array of tickets
- Given the server is running, then `GET /api/stages` returns the stage pipeline
- Given the server is running, then `GET /api/events` returns an SSE stream

#### P1-3: Structured Error Responses

**As an** AI agent, **I want** error responses to be structured JSON, **so that** I can programmatically handle failures.

**Acceptance Criteria:**
- Given an unhandled Express error, then the response is `{ "error": { "code": "<CODE>", "message": "<MSG>" } }` — never a raw stack trace
- Given a tool invocation error, then the MCP error response includes a machine-readable error code

#### P1-4: Lease Management (Heartbeat, Extend, Expire)

**As an** AI agent holding a ticket claim, **I want** to extend my lease and have expired leases auto-released, **so that** long-running work isn't interrupted and stuck tickets are recovered.

**Acceptance Criteria:**
- Given a claimed ticket with 5 minutes remaining, when agent calls `tickets.extend`, then the lease is extended by 30 minutes
- Given an expired lease, when another agent calls `tickets.claim`, then the ticket is claimable

#### P1-5: Agent SDK Integration

**As an** AI agent developer, **I want** the Python Agent SDK to connect to the TypeScript MCP server, **so that** I have a typed client.

**Acceptance Criteria:**
- Given `FORGEOS_SERVER_URL=http://localhost:3011/mcp`, when SDK calls `client.connect()`, then the session is established
- Given a connected SDK session, when calling `ops.claim_next(stage="BACKEND")`, then a ticket is claimed

#### P1-6: Dashboard Shows Real-Time State

**As a** human operator, **I want** the dashboard to load and display ticket data, **so that** I can monitor pipeline progress.

**Acceptance Criteria:**
- Given the server is running with seeded data, when I open `http://localhost:3011/dashboard`, then I see a Kanban board with ticket cards
- Given an agent claims a ticket, then the dashboard updates within 5 seconds via SSE

---

### 4.3 P2 — System Is Robust

Production-grade reliability for continuous multi-agent operation.

#### P2-1: Concurrent Agent Safety

**As a** system architect, **I want** concurrent agents to operate without corrupting ticket state, **so that** the system is reliable under load.

**Acceptance Criteria:**
- Given 5 agents calling `tickets.claim` simultaneously on 5 different tickets, then each claim succeeds independently
- Given 2 agents calling `tickets.claim` on the same ticket, then exactly 1 succeeds and 1 receives `ALREADY_CLAIMED`

#### P2-2: Failed Agent Recovery

**As a** system administrator, **I want** claims from crashed agents to be automatically recovered, **so that** tickets don't get stuck.

**Acceptance Criteria:**
- Given a ticket claimed by an agent that crashes (no heartbeat for > lease duration), then `tickets.release` or lease expiry makes the ticket available
- Given an expired-lease ticket, when a new agent claims it, then the new claim succeeds

#### P2-3: Structured Logging

**As a** DevOps engineer, **I want** all logs to be structured JSON with correlation IDs, **so that** I can query them.

**Acceptance Criteria:**
- Given any request to the server, then the log entry includes `requestId`, `method`, `path`, `statusCode`, `durationMs`
- Given a tool invocation, then the log includes `toolName`, `ticketId`, `agentName`

#### P2-4: Health Checks

**As a** DevOps engineer, **I want** `/health` to accurately report system status, **so that** my orchestrator knows when the system is ready.

**Acceptance Criteria:**
- Given all services healthy, then `/health` returns `200 { status: "ok", database: "connected" }`
- Given the database is unreachable, then `/health` returns `503 { status: "degraded", database: "disconnected" }`

---

## 5. Non-Functional Requirements

| Requirement | Target | Measurement |
|-------------|--------|-------------|
| Startup time (Docker Compose → all healthy) | < 60 seconds | Timed from `docker compose up -d` to all health checks passing |
| MCP tool response time (p50) | < 100ms | Measured at MCP endpoint under single-agent load |
| MCP tool response time (p99) | < 500ms | Measured at MCP endpoint under 5-agent concurrent load |
| Graceful shutdown data loss | Zero | All in-flight transactions committed or rolled back before SIGTERM completes |
| Database connection pool | 20 connections (configurable) | `pg` pool max setting |
| Log format | Structured JSON (one object per line) | All stdout/stderr output is valid JSON |
| Container image size | < 200MB | `docker images` compressed size |
| API availability | 99.5% during local development | Measured over 24-hour continuous run |

---

## 6. Acceptance Criteria (Verification Protocol)

### 6.1 P0 Verification Script

The following sequence verifies all P0 features. Each step must pass for the system to be considered operational.

```
Step 1: Build
  cd forgeos-server && npm run build
  ASSERT: exit code 0
  ASSERT: dist/index.js exists

Step 2: Docker Build
  cd forgeos-server && docker build -t forgeos-mcp .
  ASSERT: exit code 0

Step 3: Docker Compose Up
  cd infra && docker compose up -d
  ASSERT: postgres container healthy within 30s
  ASSERT: mcp-server container healthy within 60s

Step 4: Database Schema
  docker exec postgres psql -U forgeos -d forgeos -c "\dt"
  ASSERT: tables include tickets, agents, events, file_locks, schema_migrations

Step 5: Health Check
  curl http://localhost:3011/health
  ASSERT: 200 { "status": "ok" }

Step 6: Agent Bootstrap
  (Create first agent via admin endpoint or seed)
  ASSERT: API key returned

Step 7: MCP Initialize
  POST http://localhost:3011/mcp (MCP initialize request with API key)
  ASSERT: valid MCP response with serverInfo

Step 8: Tools List
  (Send MCP tools/list)
  ASSERT: 9 tools returned

Step 9: End-to-End Lifecycle
  Seed a READY ticket
  Call tickets.next → receive ticket
  Call tickets.claim → claim succeeds
  Call tickets.complete → ticket advances
  ASSERT: ticket now in next stage

Step 10: REST API
  curl http://localhost:3011/api/tickets
  ASSERT: 200, JSON array

Step 11: Dashboard
  curl http://localhost:3011/dashboard
  ASSERT: 200, HTML content

Step 12: SSE Events
  Subscribe to SSE endpoint
  Perform a tickets.claim action
  ASSERT: SSE event received within 5s
```

### 6.2 P1/P2 Verification

P1 and P2 features are verified via automated integration tests (Jest + Supertest for HTTP, MCP SDK client for protocol tests).

---

## 7. Out of Scope

The following are explicitly excluded from this PRD:

| Item | Reason |
|------|--------|
| Python MCP server (`mcp-server/`) | Focus on TypeScript server only; Python server has incompatible schema |
| Kubernetes deployment | Docker Compose is sufficient for MVP |
| Multi-region failover | Single-machine operation is the target |
| Dashboard UI redesign | Current static HTML/CSS/JS Kanban is sufficient |
| PgBouncer connection pooling | Node.js `pg` pool is sufficient at < 20 concurrent agents |
| Tool API unification (TS vs Python) | Deferred until canonical server is chosen |
| Next.js dashboard (`dashboard/`) | Separate from the MCP server's built-in static dashboard |
| Performance optimization beyond stated NFRs | No premature optimization |
| RBAC (role-based access control) beyond agent auth | Simple API-key auth is sufficient for MVP |

---

## 8. Risks and Mitigations

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|-----------|--------|------------|
| R1 | MCP SDK upgrade changes transport API | LOW | HIGH | Pin `@modelcontextprotocol/sdk` to exact version; test on upgrade |
| R2 | TypeScript compilation reveals additional type errors | MEDIUM | MEDIUM | Fix incrementally; `strict: true` may surface hidden issues |
| R3 | Double migration fix introduces data loss | LOW | HIGH | Test on clean DB first; never migrate with data in dev |
| R4 | Auth bootstrap leaves system open during setup | MEDIUM | MEDIUM | Use admin API key with explicit env var; document rotation |
| R5 | Concurrent agent testing reveals PostgreSQL locking issues | MEDIUM | HIGH | SQL stored functions already use `SELECT ... FOR UPDATE`; test with 5+ concurrent agents |
| R6 | Docker secrets approach differs across dev/CI environments | MEDIUM | LOW | Provide `.env`-based fallback for local dev; secrets for Docker |

---

## 9. Assumptions

| # | Assumption | Validation Plan |
|---|-----------|-----------------|
| A1 | TypeScript codebase is structurally sound (only config/wiring is broken) | Confirmed by Research Analyst: "code quality is generally good" |
| A2 | SQL stored functions (`claim_ticket`, `advance_ticket`, etc.) work correctly | Verified by schema review; functional testing in P0-7 |
| A3 | The `@modelcontextprotocol/sdk ^1.27.1` version supports stateless Streamable HTTP | Confirmed by MCP SDK documentation and the existing import pattern |
| A4 | PostgreSQL 17 with the current schema supports the required concurrency model | Row-level locking via `FOR UPDATE` is the standard approach |
| A5 | Node 22 LTS is the target runtime | Confirmed by Dockerfile `FROM node:22-alpine` |
| A6 | Agent SDK `mcp>=1.25,<2` supports `streamablehttp_client` | Needs verification; fallback is raw HTTP |

---

## 10. Dependencies

| Dependency | Version | Purpose | Risk |
|-----------|---------|---------|------|
| `@modelcontextprotocol/sdk` | ^1.27.1 | MCP protocol implementation | API stability |
| `express` | ^5.1.0 | HTTP server framework | Stable |
| `pg` | ^8.16.0 | PostgreSQL client | Stable |
| `zod` | ^3.25.23 | Schema validation | Stable |
| `pino` | ^9.7.0 | Structured logging | Stable |
| PostgreSQL | 17 | Database | LTS |
| Docker / Docker Compose | Latest | Container orchestration | Stable |
| Node.js | 22 (Alpine) | Runtime | LTS |

---

## 11. Glossary

| Term | Definition |
|------|-----------|
| **MCP** | Model Context Protocol — JSON-RPC protocol for LLM tool invocation |
| **Streamable HTTP** | MCP transport that uses standard HTTP POST/GET/DELETE with streaming support |
| **Tool** | An MCP-exposed function that agents can invoke (e.g., `tickets.claim`) |
| **Lease** | Time-bounded lock on a ticket; expires after 30 minutes if not extended |
| **SDLC Stage** | A phase in the software development lifecycle (READY → BACKEND → QA → ... → DONE) |
| **Claim** | An agent asserting exclusive ownership of a ticket for a specific stage |
| **Agent SDK** | Python library that wraps MCP protocol calls into typed operations |
| **Heartbeat** | Periodic signal from an agent to extend its lease |
| **SSE** | Server-Sent Events — HTTP-based real-time push from server to client |

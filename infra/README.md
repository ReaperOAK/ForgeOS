<!-- last_reviewed: 2026-03-10T00:00:00Z -->
<!-- audience: developer -->
<!-- diataxis: how-to -->

# ForgeOS Local Development — Docker Compose

Start the full ForgeOS stack locally with a single command. This guide covers
the three-service Docker Compose setup, the development overlay for hot-reload,
and common operational tasks.

## Prerequisites

| Requirement          | Minimum Version |
|----------------------|-----------------|
| Docker Engine        | 24.0            |
| Docker Compose (V2)  | 2.20            |
| Disk space           | 1 GB free       |

Verify your installation:

```bash
docker --version
docker compose version
```

## Quick Start

```bash
# From the repository root:
cd infra

# Start all services (foreground — logs stream to terminal)
docker compose up

# Or start detached (background)
docker compose up -d
```

All services start with a single command. PostgreSQL initialises the database,
applies migrations, and the MCP server connects once PostgreSQL reports healthy.

### Access Points

| Service     | URL / Port             | Purpose                     |
|-------------|------------------------|-----------------------------|
| MCP Server  | http://localhost:3000   | MCP Streamable HTTP endpoint |
| PostgreSQL  | localhost:5432          | Direct database access       |
| pgAdmin     | http://localhost:5050   | Database administration UI   |

**pgAdmin default login:** `admin@forgeos.local` / `admin` (override with
`PGADMIN_EMAIL` and `PGADMIN_PASSWORD` environment variables).

## Architecture Overview

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   pgAdmin    │     │  MCP Server  │     │  Agent Client │
│  :5050       │     │  :3000       │     │  (VS Code)    │
└──────┬───────┘     └──────┬───────┘     └──────┬────────┘
       │                    │                     │
       │     depends_on     │                     │
       │   (service_healthy)│                     │
       ▼                    ▼                     │
┌──────────────────────────────────────┐          │
│         PostgreSQL 17 Alpine         │◀─────────┘
│         :5432                        │  (via MCP Server)
│  Volume: forgeos-pgdata             │
└──────────────────────────────────────┘
         forgeos-net (bridge)
```

All three services run on the `forgeos-net` bridge network. Inter-service
communication uses container hostnames (`postgres`, `mcp-server`, `pgadmin`).

## Services

### PostgreSQL (`postgres`)

| Property        | Value                                       |
|-----------------|---------------------------------------------|
| Image           | `postgres:17-alpine`                        |
| Container name  | `forgeos-postgres`                          |
| Port            | 5432 (mapped to host)                       |
| Database        | `forgeos`                                   |
| User            | `forgeos`                                   |
| Password        | Loaded from Docker secret (`db_password`)   |
| Data volume     | `forgeos-pgdata` (named, persistent)        |
| Health check    | `pg_isready` every 10 s, 5 retries          |
| Resource limits | 0.50 CPU, 256 MB memory                     |

SQL migrations from `forgeos-server/src/db/migrations/` are mounted read-only
into `/docker-entrypoint-initdb.d/` and applied automatically on first start.

### MCP Server (`mcp-server`)

| Property        | Value                                       |
|-----------------|---------------------------------------------|
| Image           | Built from `forgeos-server/Dockerfile`      |
| Container name  | `forgeos-mcp`                               |
| Port            | 3000 (mapped to host)                       |
| Node.js         | 22 (Alpine)                                 |
| Environment     | `NODE_ENV=production`, `LOG_LEVEL=info`     |
| Depends on      | `postgres` (healthy)                        |
| Resource limits | 0.50 CPU, 256 MB memory                     |

The server is stateless (`sessionIdGenerator: undefined`). Horizontal scaling
is possible by running additional container instances behind a load balancer.

### pgAdmin (`pgadmin`)

| Property        | Value                                       |
|-----------------|---------------------------------------------|
| Image           | `dpage/pgadmin4:8.14`                       |
| Container name  | `forgeos-pgadmin`                           |
| Port            | 5050 (mapped to host)                       |
| Data volume     | `forgeos-pgadmin-data` (named, persistent)  |
| Depends on      | `postgres` (healthy)                        |
| Resource limits | 0.25 CPU, 256 MB memory                     |

## Development Mode (Hot-Reload)

Layer the development overlay on top of the base configuration for live-reload:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
```

### What Changes in Development Mode

| Aspect          | Base (Production)       | Dev Overlay                      |
|-----------------|-------------------------|----------------------------------|
| Build target    | `runtime` (compiled JS) | `builder` (TypeScript source)    |
| Entry command   | `node dist/index.js`    | `npx tsx watch src/index.ts`     |
| `NODE_ENV`      | `production`            | `development`                    |
| `LOG_LEVEL`     | `info`                  | `debug`                          |
| Source mount    | None                    | `src/`, `package.json`, `tsconfig.json` mounted read-only |
| Debugger port   | Not exposed             | 9229 (Node.js inspector)         |
| Container name  | `forgeos-mcp`           | `forgeos-mcp-dev`                |
| PG logging      | Default                 | All queries logged (`log_statement=all`) |

Source code changes on the host are reflected inside the container immediately.
No image rebuild is needed during development.

### Attaching a Debugger

The dev overlay exposes Node.js inspector on port 9229. In VS Code, add this
launch configuration:

```json
{
  "type": "node",
  "request": "attach",
  "name": "Attach to Docker",
  "port": 9229,
  "address": "localhost",
  "localRoot": "${workspaceFolder}/forgeos-server",
  "remoteRoot": "/app",
  "restart": true
}
```

## Environment Variables

The base compose file supports variable substitution with defaults. Override
by setting variables in your shell or creating an `infra/.env` file.

| Variable           | Default                       | Description                       |
|--------------------|-------------------------------|-----------------------------------|
| `ADMIN_API_KEY`    | `forgeos_admin_CHANGE_ME`     | MCP server admin API key          |
| `PGADMIN_EMAIL`    | `admin@forgeos.local`         | pgAdmin login email               |
| `PGADMIN_PASSWORD` | `admin`                       | pgAdmin login password            |

**Production warning:** Change `ADMIN_API_KEY` and `PGADMIN_PASSWORD` before
deploying outside local development.

### Database Password

The database password uses Docker's file-based secrets mechanism rather than
environment variables. Set the password in:

```
forgeos-server/secrets/db_password
```

This file is read by the `postgres` container at startup. Change the default
placeholder value before first use.

## Volumes

| Volume Name          | Mount Point                        | Purpose                           |
|----------------------|------------------------------------|-----------------------------------|
| `forgeos-pgdata`     | `/var/lib/postgresql/data`         | PostgreSQL data persistence       |
| `forgeos-pgadmin-data` | `/var/lib/pgadmin`              | pgAdmin session/config persistence |

Data persists across `docker compose down` but is removed by
`docker compose down -v`.

## Networks

| Network Name   | Driver  | Purpose                                  |
|----------------|---------|------------------------------------------|
| `forgeos-net`  | bridge  | Isolates ForgeOS services from other containers |

Services communicate using container hostnames: `postgres`, `mcp-server`,
`pgadmin`.

## Common Operations

### View Logs

```bash
# All services
docker compose logs -f

# Single service
docker compose logs -f mcp-server
docker compose logs -f postgres
```

### Stop Services

```bash
# Stop containers (data preserved)
docker compose down

# Stop and delete all data volumes
docker compose down -v
```

### Rebuild MCP Server Image

```bash
docker compose build mcp-server
# or force a clean rebuild
docker compose build --no-cache mcp-server
```

### Connect to PostgreSQL Directly

```bash
# Using psql from the host (requires psql client)
psql -h localhost -p 5432 -U forgeos -d forgeos

# Using psql inside the container
docker compose exec postgres psql -U forgeos -d forgeos
```

### Reset Database

```bash
# Remove the data volume and restart — migrations re-apply on init
docker compose down -v
docker compose up
```

## Troubleshooting

### MCP Server Fails to Start

**Symptom:** `forgeos-mcp` exits immediately or restarts repeatedly.

**Check:** PostgreSQL health status.

```bash
docker compose ps
docker compose logs postgres
```

The MCP server waits for `postgres` to be healthy (`pg_isready` succeeds)
before starting. If PostgreSQL fails its health check, the MCP server never
receives the start signal.

### Port Conflicts

**Symptom:** `bind: address already in use` on startup.

**Fix:** Check which process occupies the port and either stop it or change
the compose port mapping.

```bash
# Check ports 3000, 5432, 5050
lsof -i :3000 -i :5432 -i :5050
```

### pgAdmin Cannot Connect to PostgreSQL

**Symptom:** pgAdmin web UI shows a connection error.

**Fix:** When adding a server in pgAdmin, use `postgres` (the container
hostname) as the host, not `localhost`. Port is `5432`, user is `forgeos`.

### Volume Permission Errors

**Symptom:** PostgreSQL fails to write data.

**Fix:** On Linux, ensure Docker has permission to write to the named volume.
Alternatively, run `docker compose down -v` to remove stale volumes and
restart fresh.

## File Reference

| File                           | Purpose                                      |
|--------------------------------|----------------------------------------------|
| `docker-compose.yml`          | Base configuration (3 services, production-like) |
| `docker-compose.dev.yml`      | Development overlay (hot-reload, debug port)  |
| `../forgeos-server/Dockerfile` | Multi-stage Dockerfile for MCP server        |
| `../forgeos-server/secrets/db_password` | Database password (Docker secret)   |
| `../forgeos-server/src/db/migrations/`  | SQL migrations (auto-applied on init) |

## Related Documentation

- [System Components Architecture](../docs/architecture/system-components.md)
  — Section 7 covers the deployment topology.
- [ADR-001: PostgreSQL Decision](../docs/architecture/adr/adr-001-postgresql.md)
  — Rationale for PostgreSQL as the state store.
- [ForgeOS Server README](../forgeos-server/README.md) — Server-level docs
  including the `forgeos-server/docker-compose.yml` (PgBouncer stack).

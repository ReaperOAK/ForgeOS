<!-- last_reviewed: 2026-03-10T15:00:00Z -->
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

## Makefile Quick Reference

The root `Makefile` wraps Docker Compose and common operations into short
targets. Run `make help` from the repository root to list all targets with
descriptions.

### Service Lifecycle

| Target | Command | Description |
|--------|---------|-------------|
| `make up` | `docker compose up -d --build` | Start services in dev mode |
| `make down` | `docker compose down` | Stop containers, keep volumes |
| `make restart` | down + up | Restart all services |
| `make logs` | `docker compose logs -f` | Tail logs |
| `make ps` | `docker compose ps` | Show container status |

### Database

| Target | Description |
|--------|-------------|
| `make migrate` | Apply pending migrations inside the MCP server container |
| `make seed` | Run the TypeScript seed script to load sample data |
| `make db-shell` | Open an interactive `psql` session |
| `make db-reset` | Drop and recreate the database (destructive, 3 s grace period) |

### Quality

| Target | Description |
|--------|-------------|
| `make test` | Run vitest suite |
| `make test-watch` | Run tests in watch mode |
| `make test-coverage` | Run tests with coverage report |
| `make lint` | ESLint (TypeScript) + Ruff (Python) |
| `make typecheck` | TypeScript type checking (no emit) |
| `make format` | Auto-format with Prettier + Ruff |

### Setup and Cleanup

| Target | Description |
|--------|-------------|
| `make setup` | Check prerequisites, create `.env`, install npm deps |
| `make clean` | Remove build artefacts and stopped containers |
| `make clean-all` | Clean + remove Docker volumes (destructive) |

## Helper Scripts

### `scripts/setup.sh`

First-time environment setup. Checks 7 prerequisites (Docker, Docker Compose,
Node.js >= 22, npm, Python 3, Git, Make) with version validation. Creates
`infra/.env` from template, installs Node.js dependencies, and provisions
default Docker secrets.

```bash
# Via Makefile (recommended)
make setup

# Directly
bash infra/scripts/setup.sh
```

### `scripts/seed.sh`

Database seed wrapper. Runs the TypeScript seed module inside the MCP server
container by default, or directly on the host with the `--local` flag.
Checks service readiness, waits for the database with a bounded retry loop
(30 attempts), and optionally imports ticket JSON files from
`.github/tickets/`.

```bash
# Via Makefile (recommended)
make seed

# Via Docker container
bash infra/scripts/seed.sh

# Directly on host (requires DATABASE_URL)
bash infra/scripts/seed.sh --local
```

## Health Checks

Every container in the stack runs a periodic health check. Docker restarts
unhealthy containers automatically via the `unless-stopped` restart policy.

### PostgreSQL Health Check

**Script:** `docker/healthchecks/check-postgres.sh`

The script runs three checks in sequence. Any failure exits with code 1
(unhealthy).

| Check | Command | Purpose |
|-------|---------|---------|
| 1. Connection | `pg_isready` | Verifies PostgreSQL accepts connections |
| 2. Query | `SELECT 1` via `psql` | Confirms query processing works |
| 3. Extensions | Query `pg_extension` | Verifies `uuid-ossp` and `pgcrypto` are loaded |

**Docker Compose wiring:**

```yaml
healthcheck:
  test: ["CMD", "sh", "/usr/local/bin/check-postgres.sh"]
  interval: 10s
  timeout: 5s
  retries: 5
  start_period: 30s
```

**Environment variables** (all optional, with defaults):

| Variable | Default | Description |
|----------|---------|-------------|
| `POSTGRES_USER` | `forgeos` | PostgreSQL user |
| `POSTGRES_DB` | `forgeos` | Database name |
| `PGHOST` | `localhost` | Host address |
| `PGPORT` | `5432` | Port number |

### MCP Server Health Check

**Script:** `docker/healthchecks/check-mcp.sh`

The script runs two checks. Any failure exits with code 1 (unhealthy).

| Check | Method | Purpose |
|-------|--------|---------|
| 1. HTTP status | `curl` to `/health` | Verifies endpoint returns HTTP 200 |
| 2. Response body | JSON grep | Confirms `"status": "ok"` in response |

**Docker Compose wiring:**

```yaml
healthcheck:
  test: ["CMD", "sh", "/app/check-mcp.sh"]
  interval: 15s
  timeout: 5s
  retries: 3
  start_period: 20s
```

**Environment variables** (all optional, with defaults):

| Variable | Default | Description |
|----------|---------|-------------|
| `MCP_HOST` | `localhost` | MCP server hostname |
| `MCP_PORT` | `3000` | MCP server port |
| `TIMEOUT` | `5` | Request timeout in seconds |

### Writing a Custom Health Check

Follow this pattern when adding health checks for new services:

1. Create a POSIX shell script (`#!/bin/sh`) under `docker/healthchecks/`.
2. Use `set -e` and exit `0` for healthy or `1` for unhealthy.
3. Accept configuration via environment variables with safe defaults
   (`${VAR:-default}`).
4. Print a descriptive status message before exiting (aids log diagnosis).
5. Mount the script read-only into the container and wire it into the
   `healthcheck` block in `docker-compose.yml`.

## Monitoring Stack (Optional)

An optional Prometheus + Grafana stack provides local observability. It runs
as a Docker Compose override so it does not affect the base stack.

### Starting the Monitoring Stack

```bash
cd infra
docker compose -f docker-compose.yml \
  -f monitoring/docker-compose.monitoring.yml up -d
```

### Stopping the Monitoring Stack

```bash
docker compose -f docker-compose.yml \
  -f monitoring/docker-compose.monitoring.yml down
```

To remove monitoring data volumes as well:

```bash
docker compose -f docker-compose.yml \
  -f monitoring/docker-compose.monitoring.yml down -v
```

### Access Points

| Service    | URL                        | Default Login    |
|------------|----------------------------|------------------|
| Prometheus | http://localhost:9090       | N/A              |
| Grafana    | http://localhost:3001       | `admin` / `admin` |

Change the Grafana password on first login. Override defaults with
`GRAFANA_ADMIN_USER` and `GRAFANA_ADMIN_PASSWORD` environment variables.

### Prometheus

**Image:** `prom/prometheus:v2.51.0`

Prometheus scrapes two targets:

| Job | Target | Interval | Description |
|-----|--------|----------|-------------|
| `prometheus` | `localhost:9090` | 15 s | Self-monitoring |
| `forgeos-mcp-server` | `mcp-server:3000/health` | 10 s | MCP health probe |
| `forgeos-postgres` | `postgres:5432` | 15 s | TCP availability check |

Data retains for 7 days (`--storage.tsdb.retention.time=7d`).

**Configuration files** (mounted read-only):

- `monitoring/prometheus/prometheus.yml` — scrape config and target definitions.
- `monitoring/prometheus/alert-rules.yml` — alert rules (see below).

**Resource limits:** 0.50 CPU, 512 MB memory.

### Alert Rules

Alert rules live in `monitoring/prometheus/alert-rules.yml`. Four alert groups
cover service health, error rates, resource usage, and SLO burn rate.

| Alert | Severity | Condition | Duration |
|-------|----------|-----------|----------|
| `McpServerDown` | critical | MCP server unreachable | 1 min |
| `PostgresDown` | critical | PostgreSQL unreachable | 30 s |
| `PrometheusDown` | warning | Self-scrape failing | 1 min |
| `HighErrorRate` | warning | 5xx rate > 1% | 5 min |
| `CriticalErrorRate` | critical | 5xx rate > 5% | 5 min |
| `ContainerRestarted` | warning | Restart count > 0 | immediate |
| `ErrorBudgetFastBurn` | critical | 2%+ budget burned in 1 h | 5 min |
| `ErrorBudgetLow` | warning | < 10% budget remaining | 1 h |

### Grafana

**Image:** `grafana/grafana:11.0.0`

Grafana starts fully provisioned with zero manual setup:

- **Datasource:** Prometheus auto-configured via
  `monitoring/grafana/provisioning/datasources/prometheus.yml`.
- **Dashboards:** Pre-loaded from
  `monitoring/grafana/provisioning/dashboards/json/forgeos-health.json`.

Grafana depends on Prometheus being healthy before starting.

**Resource limits:** 0.25 CPU, 256 MB memory.

### Monitoring Architecture

```
+------------------------------------------------------+
|                   forgeos-net                        |
|                                                      |
|  +---------+    scrape     +------------+            |
|  |  MCP    +---------------+ Prometheus |            |
|  | Server  |  /health:3000 |  :9090     |            |
|  +---------+               +------+-----+            |
|                                   |                  |
|  +----------+   TCP probe         |  datasource      |
|  |PostgreSQL+---------------------+                  |
|  |  :5432   |                     |                  |
|  +----------+               +-----+------+           |
|                             |  Grafana   |           |
|                             |  :3001     |           |
|                             +------------+           |
+------------------------------------------------------+
```

All monitoring services join the existing `forgeos-net` bridge network.
Prometheus stores metrics in a named volume (`forgeos-prometheus-data`).
Grafana stores dashboards and preferences in `forgeos-grafana-data`.

## Backup & Restore

ForgeOS includes automated PostgreSQL backup and restore scripts with
checksum verification, retention rotation, and Docker-aware operation.

### Quick Reference

```bash
# Full backup (custom format, compressed)
make backup

# SQL-only backup
make backup-sql

# List available backups
make backup-list

# Restore from latest backup
make restore

# Dry-run restore (validate without applying)
make restore-dry-run

# List contents of a backup file
make restore-list BACKUP_FILE=path/to/backup.dump

# Restore a specific backup
make restore BACKUP_FILE=path/to/backup.dump
```

### Scripts

| Script              | Purpose                                              |
|---------------------|------------------------------------------------------|
| `scripts/backup.sh` | Create compressed backups with SHA-256 checksums     |
| `scripts/restore.sh`| Validate and restore backups with post-restore checks|

### Configuration

Backup behavior is controlled via environment variables:

| Variable          | Default          | Description                        |
|-------------------|------------------|------------------------------------|
| `PGHOST`          | `localhost`      | PostgreSQL host                    |
| `PGPORT`          | `5432`           | PostgreSQL port                    |
| `PGUSER`          | `forgeos`        | PostgreSQL user                    |
| `PGDATABASE`      | `forgeos`        | Target database                    |
| `BACKUP_DIR`      | `./backups`      | Backup storage directory           |
| `BACKUP_RETENTION`| `7`              | Days to keep old backups           |

For the full strategy including WAL archiving, PITR, and disaster recovery,
see the [Backup Strategy Guide](../docs/operations/backup-strategy.md).

## File Reference

| File                           | Purpose                                      |
|--------------------------------|----------------------------------------------|
| `docker-compose.yml`          | Base configuration (3 services, production-like) |
| `docker-compose.dev.yml`      | Development overlay (hot-reload, debug port)  |
| `../forgeos-server/Dockerfile` | Multi-stage Dockerfile for MCP server        |
| `../forgeos-server/secrets/db_password` | Database password (Docker secret)   |
| `../forgeos-server/src/db/migrations/`  | SQL migrations (auto-applied on init) |
| `scripts/setup.sh`            | Prerequisite checks and environment setup     |
| `scripts/seed.sh`             | Database seed wrapper (Docker + local modes)  |
| `scripts/backup.sh`           | PostgreSQL backup with checksums and rotation |
| `scripts/restore.sh`          | Backup restore with validation and dry-run    |
| `Makefile`                     | Build/backup/restore convenience targets      |
| `../Makefile`                  | Root Makefile with 23 development targets     |

## Related Documentation

- [Root Makefile](../Makefile) — All development workflow targets.
- [System Components Architecture](../docs/architecture/system-components.md)
  — Section 7 covers the deployment topology.
- [ADR-001: PostgreSQL Decision](../docs/architecture/adr/adr-001-postgresql.md)
  — Rationale for PostgreSQL as the state store.
- [ForgeOS Server README](../forgeos-server/README.md) — Server-level docs
  including the `forgeos-server/docker-compose.yml` (PgBouncer stack).
- [Backup Strategy](../docs/operations/backup-strategy.md) — Frequency,
  retention policy, WAL archiving, PITR, and disaster recovery procedures.

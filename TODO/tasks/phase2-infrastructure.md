# Phase 2 — Infrastructure L3 Tickets

Source blocks: BLK-12-01 (Local Development Environment), BLK-12-02 (CI/CD Pipeline & Operations)

---

## FORGEOS-DO001: Create Docker Compose for Local Development

**Type:** infra
**Priority:** critical
**Dependencies:** FORGEOS-ARCH001, FORGEOS-ARCH002
**Files:** infra/docker-compose.yml, infra/docker-compose.dev.yml
**Tags:** infra, docker, devenv, phase2, BLK-12-01

### Description

Create the Docker Compose configuration for local development of the ForgeOS distributed orchestration platform. Define service containers for the MCP server (Python), PostgreSQL (with persistent volume), and database admin tooling (pgAdmin). Configure networking, volume mounts, and service dependencies so that all services start in the correct order. Support both development (with hot-reload/volume mounts) and production-like profiles.

### Acceptance Criteria

- [ ] Docker Compose file defines MCP server, PostgreSQL, and pgAdmin services
- [ ] PostgreSQL service uses a named volume for data persistence across restarts
- [ ] Service dependency ordering ensures PostgreSQL starts and is healthy before MCP server
- [ ] Development profile mounts source code as volumes for live reloading
- [ ] Network configuration isolates services on a dedicated bridge network
- [ ] All services can be started with a single `docker compose up` command
- [ ] Docker Compose validates cleanly with `docker compose config`

---

## FORGEOS-DO002: Configure PostgreSQL Container with Init Scripts

**Type:** infra
**Priority:** critical
**Dependencies:** FORGEOS-DO001
**Files:** infra/docker/postgres/Dockerfile, infra/docker/postgres/init.sql, infra/docker/postgres/pg-healthcheck.sh
**Tags:** infra, postgres, docker, phase2, BLK-12-01

### Description

Configure the PostgreSQL container for the ForgeOS platform. Create a custom Dockerfile (or init script) that sets up the initial database and user, applies baseline configuration (connection limits, shared_buffers, work_mem for development), and includes a health check script. The container must initialize the forgeos database and forgeos_user on first startup.

### Acceptance Criteria

- [ ] PostgreSQL container initializes forgeos database and forgeos_user on first startup
- [ ] Health check script verifies PostgreSQL is accepting connections and database exists
- [ ] PostgreSQL configuration tuned for development workloads (reasonable defaults)
- [ ] Container logs are accessible via `docker compose logs postgres`
- [ ] Data persists across container stop/start via named volume
- [ ] Container passes health check within 30 seconds of startup

---

## FORGEOS-DO003: Create Development Tooling and Makefile

**Type:** infra
**Priority:** high
**Dependencies:** FORGEOS-DO001, FORGEOS-DO002
**Files:** Makefile, infra/scripts/setup.sh, infra/scripts/seed.sh
**Tags:** infra, devtools, makefile, phase2, BLK-12-01

### Description

Create developer ergonomics tooling for the ForgeOS platform. Build a Makefile with targets for common operations: start/stop services, run database migrations, seed test data, run tests, and show logs. Create setup and seed scripts that automate first-time environment setup and loading sample data respectively.

### Acceptance Criteria

- [ ] Makefile provides targets: up, down, restart, migrate, seed, test, logs, clean
- [ ] `make up` starts all services in the correct order in a single command
- [ ] `make down` stops and removes all containers (preserves volumes)
- [ ] `make migrate` applies pending database migrations
- [ ] `make seed` loads sample ticket data into the database
- [ ] Setup script checks prerequisites (Docker, Docker Compose, Python) and reports missing tools
- [ ] All Makefile targets include help text accessible via `make help`

---

## FORGEOS-DO004: Create Environment Configuration Profiles

**Type:** infra
**Priority:** high
**Dependencies:** FORGEOS-DO001
**Files:** infra/.env.template, infra/.env.test, infra/config/settings.py
**Tags:** infra, config, environment, phase2, BLK-12-01

### Description

Define environment configuration templates and profiles for the ForgeOS platform. Create .env.template with all required variables documented (database connection, MCP server ports, log levels, feature flags). Create a test environment configuration for CI. Implement a settings module that loads configuration from environment variables with sensible defaults for development.

### Acceptance Criteria

- [ ] `.env.template` documents all required environment variables with descriptions and example values
- [ ] `.env.test` provides test-specific configuration (test database name, debug logging)
- [ ] Settings module loads configuration from environment variables with fallback defaults
- [ ] No secrets or credentials are hardcoded; all sensitive values come from environment
- [ ] Configuration validates required variables on startup and reports missing values clearly
- [ ] Development, test, and production profiles are distinguishable via a single ENVIRONMENT variable

---

## FORGEOS-DO005: Create GitHub Actions CI Workflow for MCP Server

**Type:** infra
**Priority:** high
**Dependencies:** FORGEOS-DO001, FORGEOS-DO002
**Files:** .github/workflows/mcp-server-ci.yml
**Tags:** infra, ci, github-actions, phase2, BLK-12-02

### Description

Create a GitHub Actions workflow for continuous integration of the MCP server. The workflow should run on push and pull request events, set up Python, install dependencies, run linting (ruff), type checking (mypy), and execute unit tests with pytest. Use a PostgreSQL service container for integration tests.

### Acceptance Criteria

- [ ] Workflow triggers on push to main and pull request events
- [ ] PostgreSQL service container starts and is available for tests
- [ ] Linting step runs ruff and fails the build on violations
- [ ] Type checking step runs mypy in strict mode
- [ ] Unit tests run with pytest and report coverage
- [ ] Workflow completes within 10 minutes on standard GitHub Actions runners
- [ ] Workflow status badge can be embedded in README

---

## FORGEOS-DO006: Create Database Migration CI Step

**Type:** infra
**Priority:** high
**Dependencies:** FORGEOS-DO005
**Files:** .github/workflows/database-ci.yml
**Tags:** infra, ci, database, migrations, phase2, BLK-12-02

### Description

Create a GitHub Actions workflow (or job within the MCP server CI) that validates database migrations in CI. The workflow applies all migrations to a clean PostgreSQL instance, validates the resulting schema, tests rollback of the most recent migration, and re-applies it to verify idempotency.

### Acceptance Criteria

- [ ] CI applies all migrations to a clean PostgreSQL database from scratch
- [ ] Schema validation step checks that all expected tables and indexes exist
- [ ] Most recent migration is rolled back and reapplied to test reversibility
- [ ] CI fails if any migration produces errors during apply or rollback
- [ ] Migration CI uses the same PostgreSQL version as production configuration
- [ ] Workflow reports which migrations were applied and their execution time

---

## FORGEOS-DO007: Create PostgreSQL Backup and Restore Scripts

**Type:** infra
**Priority:** medium
**Dependencies:** FORGEOS-DO002
**Files:** infra/scripts/backup.sh, infra/scripts/restore.sh, docs/operations/backup-strategy.md
**Tags:** infra, backup, postgres, phase2, BLK-12-02

### Description

Create database backup and restore scripts for the ForgeOS PostgreSQL instance. Implement pg_dump-based backup with timestamped output files, a restore script that validates the backup before applying, and a strategy document describing backup frequency, retention, and WAL archiving recommendations for production.

### Acceptance Criteria

- [ ] Backup script creates timestamped pg_dump output files in a configurable directory
- [ ] Restore script validates backup file integrity before applying to the database
- [ ] Restore script requires explicit confirmation before overwriting existing data
- [ ] Backup strategy document covers frequency, retention policy, and WAL archiving guidance
- [ ] Scripts work with both local Docker and remote PostgreSQL instances
- [ ] Backup and restore can be invoked via Makefile targets (`make backup`, `make restore`)

---

## FORGEOS-DO008: Define Container Health Checks and Monitoring

**Type:** infra
**Priority:** medium
**Dependencies:** FORGEOS-DO001, FORGEOS-DO002
**Files:** infra/docker/healthchecks/check-mcp.sh, infra/docker/healthchecks/check-postgres.sh, infra/monitoring/docker-compose.monitoring.yml
**Tags:** infra, healthcheck, monitoring, phase2, BLK-12-02

### Description

Define health check scripts for all Docker containers and an optional monitoring stack. Create health check scripts for the MCP server (HTTP endpoint) and PostgreSQL (connection test). Provide an optional docker-compose override for monitoring tools (e.g., Prometheus, Grafana) that can be enabled for local observability.

### Acceptance Criteria

- [ ] PostgreSQL health check script verifies connection and database existence
- [ ] MCP server health check script verifies the /health endpoint responds with 200
- [ ] Health checks are wired into Docker Compose with appropriate intervals and retries
- [ ] Optional monitoring compose override adds Prometheus and Grafana services
- [ ] Health check failures trigger container restart via Docker restart policy
- [ ] All health check scripts exit with code 0 (healthy) or 1 (unhealthy)

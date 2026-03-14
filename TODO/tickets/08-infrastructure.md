# Infrastructure Tickets

## TASK-FOS-08-001: Dockerfile for ForgeOS Server

**Type:** infra
**Priority:** critical
**Dependencies:** TASK-FOS-02-001
**Files:** forgeos-server/Dockerfile, forgeos-server/.dockerignore

### Description
Create a multi-stage Dockerfile for the ForgeOS MCP server as specified in Architecture §8.2. Stage 1 (builder): Node.js 22 Alpine base, install dependencies with npm ci, copy source and compile TypeScript with npm run build. Stage 2 (runtime): Node.js 22 Alpine base, copy compiled dist/ and node_modules/ from builder, copy dashboard static files, set NODE_ENV=production, run as non-root user (node), expose port 3011, add HEALTHCHECK instruction that curls /health endpoint, CMD to run the compiled entry point. Include a .dockerignore file that excludes node_modules, .git, dist, *.md, .env, and other non-essential files.

### Acceptance Criteria
- [ ] Multi-stage build: builder stage uses node:22-alpine, compiles TypeScript
- [ ] Builder stage installs dependencies with npm ci (not npm install) for reproducible builds
- [ ] Runtime stage uses node:22-alpine, copies only dist/, node_modules/, and dashboard static files
- [ ] Runtime stage sets NODE_ENV=production and USER node (non-root)
- [ ] EXPOSE 3011 directive present
- [ ] HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD curl -f http://localhost:3011/health
- [ ] CMD ["node", "dist/index.js"] as the entry point
- [ ] .dockerignore excludes: node_modules, .git, dist, *.md (except README), .env, .env.*, secrets/
- [ ] Built image size under 200MB

---

## TASK-FOS-08-002: Docker Compose with PostgreSQL and Server

**Type:** infra
**Priority:** critical
**Dependencies:** TASK-FOS-08-001, TASK-FOS-01-001
**Files:** forgeos-server/docker-compose.yml, forgeos-server/secrets/.gitkeep

### Description
Create Docker Compose configuration as specified in Architecture §8.1 with three services: postgres (PostgreSQL 17 Alpine with healthcheck, persistent volume, init scripts mounted from migrations directory), pgbouncer (edoburu/pgbouncer in transaction mode with 50 default pool size and 200 max client connections), and mcp-server (built from Dockerfile, depends on postgres healthy + pgbouncer started, connects through pgbouncer, mounts workspace read-only). Include named volume for PostgreSQL data persistence, Docker secrets for database password, and configurable ports via environment variables. Every service has restart: unless-stopped policy.

### Acceptance Criteria
- [ ] Three services defined: postgres, pgbouncer, mcp-server
- [ ] postgres uses image postgres:17-alpine with POSTGRES_DB=forgeos, POSTGRES_USER=forgeos, POSTGRES_PASSWORD_FILE=/run/secrets/db_password
- [ ] postgres has healthcheck: pg_isready -U forgeos -d forgeos with interval=10s, retries=5, start_period=30s
- [ ] postgres mounts migrations directory to /docker-entrypoint-initdb.d:ro for auto-schema setup
- [ ] postgres has persistent named volume pgdata for /var/lib/postgresql/data
- [ ] pgbouncer in transaction mode, depends_on postgres service_healthy, exposes port 6432
- [ ] mcp-server built from local Dockerfile, depends_on postgres service_healthy + pgbouncer service_started
- [ ] mcp-server DATABASE_URL points to pgbouncer:6432 (not postgres directly)
- [ ] mcp-server mounts workspace path as read-only volume
- [ ] Docker secrets configured for db_password (file-based secret)
- [ ] docker compose up starts all services successfully with no manual intervention
- [ ] All services have restart: unless-stopped policy

---

## TASK-FOS-08-003: Environment Configuration

**Type:** infra
**Priority:** high
**Dependencies:**
**Files:** forgeos-server/.env.example, forgeos-server/src/config/index.ts

### Description
Create the environment configuration template and config loader module. The .env.example file documents all required and optional environment variables with descriptions and example values as specified in Architecture §8.3. The config loader (config/index.ts) reads environment variables with validation and sensible defaults, exports a typed Config object, and fails fast on missing required variables in production mode. Variables include: database connection (POSTGRES_PORT, DB_PASSWORD), PgBouncer (PGBOUNCER_PORT), MCP server (MCP_PORT, NODE_ENV, LOG_LEVEL), authentication (ADMIN_API_KEY), webhooks (WEBHOOK_SECRET), workspace (WORKSPACE_PATH), rate limiting, and lease defaults.

### Acceptance Criteria
- [ ] .env.example contains all variables from Architecture §8.3 with descriptions and example values
- [ ] .env.example includes: POSTGRES_PORT, DB_PASSWORD, PGBOUNCER_PORT, MCP_PORT, NODE_ENV, LOG_LEVEL
- [ ] .env.example includes: ADMIN_API_KEY, WEBHOOK_SECRET, WORKSPACE_PATH, RATE_LIMIT_PER_MINUTE
- [ ] .env.example includes: DEFAULT_LEASE_MINUTES, MAX_LEASE_MINUTES
- [ ] config/index.ts exports typed Config interface with all configuration fields
- [ ] Config loader reads from process.env with sensible defaults (PORT=3011, LOG_LEVEL=info, DEFAULT_LEASE_MINUTES=30)
- [ ] Config loader validates required variables in production: DB_PASSWORD, WEBHOOK_SECRET
- [ ] Config loader throws descriptive error on missing required variables listing all missing vars
- [ ] Config object is frozen (Object.freeze) after initialization to prevent mutation

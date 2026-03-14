# =============================================================================
# ForgeOS — PostgreSQL 17 + pgvector Container
# =============================================================================
# Custom PostgreSQL image for the ForgeOS distributed orchestration platform.
#
# Features:
#   - PostgreSQL 17 with pgvector 0.7+ (vector similarity search)
#   - Init script creates the forgeos database, user, and required extensions
#   - Health check script via pg_isready
#   - Development-tuned configuration (shared_buffers, work_mem, connections)
#   - Non-root runtime (inherits postgres user from base image)
#   - Read-only init scripts for immutability
#
# Build:
#   docker build -t forgeos-postgres:17 .
#
# Ticket:  FORGEOS-DO002, TASK-INT-DO002
# Author:  DevOps Engineer
# Date:    2026-03-07 (updated 2026-03-12)
# =============================================================================

# pgvector/pgvector:pg17 ships pgvector 0.8.0 pre-installed on Debian-based PG17.
# This eliminates the need to compile from source or install packages manually.
FROM pgvector/pgvector:pg17

LABEL maintainer="ForgeOS DevOps <devops@forgeos.local>"
LABEL org.opencontainers.image.title="ForgeOS PostgreSQL"
LABEL org.opencontainers.image.description="PostgreSQL 17 with pgvector for ForgeOS"
LABEL org.opencontainers.image.version="17.1"
LABEL org.opencontainers.image.source="https://github.com/Ticketer/ForgeOS"

# ---------------------------------------------------------------------------
# Install health check script
# ---------------------------------------------------------------------------
COPY pg-healthcheck.sh /usr/local/bin/pg-healthcheck.sh
RUN chmod 555 /usr/local/bin/pg-healthcheck.sh

# ---------------------------------------------------------------------------
# Install database initialization script
# ---------------------------------------------------------------------------
# Scripts in /docker-entrypoint-initdb.d/ run once on first container startup
# (when the data volume is empty). They execute in alphabetical order.
# Prefix with 00_ to ensure this runs before any migration scripts.
# ---------------------------------------------------------------------------
COPY init.sql /docker-entrypoint-initdb.d/00_init.sql
RUN chmod 444 /docker-entrypoint-initdb.d/00_init.sql

# ---------------------------------------------------------------------------
# PostgreSQL configuration tuning (development defaults)
# ---------------------------------------------------------------------------
# These can be overridden at runtime via docker-compose command or env vars.
# Values are conservative defaults suitable for development workloads.
# Production deployments should use a dedicated postgresql.conf or ConfigMap.
# ---------------------------------------------------------------------------
RUN CONF_SAMPLE="$(find /usr/share/postgresql -name postgresql.conf.sample | head -n 1)" && \
    test -n "$CONF_SAMPLE" && \
    echo "" >> "$CONF_SAMPLE" && \
    echo "# --- ForgeOS Development Defaults ---" >> "$CONF_SAMPLE" && \
    echo "shared_buffers = 128MB" >> "$CONF_SAMPLE" && \
    echo "work_mem = 8MB" >> "$CONF_SAMPLE" && \
    echo "maintenance_work_mem = 64MB" >> "$CONF_SAMPLE" && \
    echo "effective_cache_size = 256MB" >> "$CONF_SAMPLE" && \
    echo "max_connections = 50" >> "$CONF_SAMPLE" && \
    echo "wal_level = replica" >> "$CONF_SAMPLE" && \
    echo "log_timezone = 'UTC'" >> "$CONF_SAMPLE" && \
    echo "timezone = 'UTC'" >> "$CONF_SAMPLE" && \
    echo "log_min_duration_statement = 500" >> "$CONF_SAMPLE" && \
    echo "log_line_prefix = '%m [%p] %q%u@%d '" >> "$CONF_SAMPLE"

# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------
# Verifies PostgreSQL is accepting connections AND the forgeos database exists.
# Interval is tight for fast container readiness detection.
# ---------------------------------------------------------------------------
HEALTHCHECK --interval=10s --timeout=5s --retries=5 --start-period=30s \
    CMD ["/usr/local/bin/pg-healthcheck.sh"]

# ---------------------------------------------------------------------------
# Expose default PostgreSQL port
# ---------------------------------------------------------------------------
EXPOSE 5432

# ---------------------------------------------------------------------------
# Data volume mount point (inherited from base image)
# ---------------------------------------------------------------------------
VOLUME ["/var/lib/postgresql/data"]


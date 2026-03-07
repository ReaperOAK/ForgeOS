# =============================================================================
# ForgeOS — PostgreSQL 17 Alpine Container
# =============================================================================
# Custom PostgreSQL image for the ForgeOS distributed orchestration platform.
#
# Features:
#   - PostgreSQL 17 on Alpine (minimal footprint)
#   - Init script creates the forgeos database, user, and required extensions
#   - Health check script via pg_isready
#   - Development-tuned configuration (shared_buffers, work_mem, connections)
#   - Non-root runtime (inherits postgres user from base image)
#   - Read-only init scripts for immutability
#
# Build:
#   docker build -t forgeos-postgres:17 .
#
# Ticket:  FORGEOS-DO002
# Author:  DevOps Engineer
# Date:    2026-03-07
# =============================================================================

FROM postgres:17-alpine

LABEL maintainer="ForgeOS DevOps <devops@forgeos.local>"
LABEL org.opencontainers.image.title="ForgeOS PostgreSQL"
LABEL org.opencontainers.image.description="PostgreSQL 17 Alpine with ForgeOS init scripts"
LABEL org.opencontainers.image.version="17.0"
LABEL org.opencontainers.image.source="https://github.com/ReaperOAK/ForgeOS"

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
RUN echo "" >> /usr/local/share/postgresql/postgresql.conf.sample && \
    echo "# --- ForgeOS Development Defaults ---" >> /usr/local/share/postgresql/postgresql.conf.sample && \
    echo "shared_buffers = 128MB" >> /usr/local/share/postgresql/postgresql.conf.sample && \
    echo "work_mem = 8MB" >> /usr/local/share/postgresql/postgresql.conf.sample && \
    echo "maintenance_work_mem = 64MB" >> /usr/local/share/postgresql/postgresql.conf.sample && \
    echo "effective_cache_size = 256MB" >> /usr/local/share/postgresql/postgresql.conf.sample && \
    echo "max_connections = 50" >> /usr/local/share/postgresql/postgresql.conf.sample && \
    echo "wal_level = replica" >> /usr/local/share/postgresql/postgresql.conf.sample && \
    echo "log_timezone = 'UTC'" >> /usr/local/share/postgresql/postgresql.conf.sample && \
    echo "timezone = 'UTC'" >> /usr/local/share/postgresql/postgresql.conf.sample && \
    echo "log_min_duration_statement = 500" >> /usr/local/share/postgresql/postgresql.conf.sample && \
    echo "log_line_prefix = '%m [%p] %q%u@%d '" >> /usr/local/share/postgresql/postgresql.conf.sample

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

# ---------------------------------------------------------------------------
# Default user: postgres (inherited from base image, non-root)
# ---------------------------------------------------------------------------
USER postgres

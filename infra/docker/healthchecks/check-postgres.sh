#!/bin/sh
# =============================================================================
# ForgeOS — PostgreSQL Health Check Script
# =============================================================================
# Verifies that PostgreSQL is:
#   1. Accepting connections (pg_isready)
#   2. The forgeos database exists and is queryable (SELECT 1)
#   3. Critical extensions are loaded (uuid-ossp, pgcrypto)
#
# Used by Docker Compose HEALTHCHECK and Kubernetes liveness/readiness probes.
#
# Exit codes:
#   0 = healthy (all checks pass)
#   1 = unhealthy (any check fails)
#
# Environment variables (overridable):
#   POSTGRES_USER    — PostgreSQL user (default: forgeos)
#   POSTGRES_DB      — Database name (default: forgeos)
#   PGHOST           — Host (default: localhost)
#   PGPORT           — Port (default: 5432)
#
# Ticket:  FORGEOS-DO008
# Author:  DevOps Engineer
# Date:    2026-03-07
# =============================================================================

set -e

# ---------------------------------------------------------------------------
# Configuration (can be overridden via environment variables)
# ---------------------------------------------------------------------------
PGUSER="${POSTGRES_USER:-forgeos}"
PGDATABASE="${POSTGRES_DB:-forgeos}"
PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5432}"

# ---------------------------------------------------------------------------
# Check 1: pg_isready — Is PostgreSQL accepting connections?
# ---------------------------------------------------------------------------
if ! pg_isready -U "$PGUSER" -d "$PGDATABASE" -h "$PGHOST" -p "$PGPORT" -q; then
    echo "UNHEALTHY: PostgreSQL is not accepting connections"
    exit 1
fi

# ---------------------------------------------------------------------------
# Check 2: Database query — Can we execute a simple query?
# ---------------------------------------------------------------------------
# Verifies the database is not only accepting connections but also
# able to process queries. Catches recovery or corruption scenarios.
# ---------------------------------------------------------------------------
if ! psql -U "$PGUSER" -d "$PGDATABASE" -h "$PGHOST" -p "$PGPORT" \
    -c "SELECT 1;" -t -A > /dev/null 2>&1; then
    echo "UNHEALTHY: PostgreSQL cannot execute queries on ${PGDATABASE}"
    exit 1
fi

# ---------------------------------------------------------------------------
# Check 3: Required extensions — Are uuid-ossp and pgcrypto loaded?
# ---------------------------------------------------------------------------
EXTENSIONS=$(psql -U "$PGUSER" -d "$PGDATABASE" -h "$PGHOST" -p "$PGPORT" \
    -c "SELECT extname FROM pg_extension WHERE extname IN ('uuid-ossp','pgcrypto');" \
    -t -A 2>/dev/null | wc -l)

if [ "$EXTENSIONS" -lt 2 ]; then
    echo "UNHEALTHY: Required extensions missing (expected uuid-ossp + pgcrypto, found ${EXTENSIONS})"
    exit 1
fi

echo "HEALTHY: PostgreSQL is accepting connections, queries succeed, extensions loaded"
exit 0

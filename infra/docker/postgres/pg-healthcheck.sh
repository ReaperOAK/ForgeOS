#!/bin/sh
# =============================================================================
# ForgeOS — PostgreSQL Health Check Script
# =============================================================================
# Verifies that PostgreSQL is:
#   1. Accepting connections (pg_isready)
#   2. The forgeos database exists and is queryable
#
# Used by Docker HEALTHCHECK and Kubernetes liveness/readiness probes.
#
# Exit codes:
#   0 = healthy (accepting connections + database accessible)
#   1 = unhealthy
#
# Ticket:  FORGEOS-DO002
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
# pg_isready returns 0 if the server is accepting connections,
# 1 if rejecting, 2 if no response, 3 if no attempt was made.
# ---------------------------------------------------------------------------
if ! pg_isready -U "$PGUSER" -d "$PGDATABASE" -h "$PGHOST" -p "$PGPORT" -q; then
    echo "UNHEALTHY: PostgreSQL is not accepting connections"
    exit 1
fi

# ---------------------------------------------------------------------------
# Check 2: Database query — Can we execute a simple query?
# ---------------------------------------------------------------------------
# Verifies the database is not only accepting connections but also
# able to process queries. This catches scenarios where pg_isready
# succeeds but the database is in recovery or corrupt.
# ---------------------------------------------------------------------------
if ! psql -U "$PGUSER" -d "$PGDATABASE" -h "$PGHOST" -p "$PGPORT" \
    -c "SELECT 1;" -t -A > /dev/null 2>&1; then
    echo "UNHEALTHY: PostgreSQL cannot execute queries on ${PGDATABASE}"
    exit 1
fi

exit 0

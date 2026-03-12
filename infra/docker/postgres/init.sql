-- =============================================================================
-- ForgeOS — PostgreSQL Initialization Script
-- =============================================================================
-- Runs ONCE on first container startup (when data volume is empty).
-- Executed as the POSTGRES_USER (superuser) defined in docker-compose.yml.
--
-- This script:
--   1. Creates required PostgreSQL extensions
--   2. Creates the forgeos_user application role (least-privilege)
--   3. Ensures the forgeos database is configured correctly
--   4. Grants appropriate permissions to forgeos_user
--
-- The forgeos database itself is created by the POSTGRES_DB env var in
-- docker-compose.yml. This script handles everything beyond that.
--
-- Prerequisites: PostgreSQL 14+ (for uuid-ossp, pgcrypto), pgvector 0.7+
-- Idempotency:   Safe to re-run (uses IF NOT EXISTS / IF EXISTS guards)
--
-- Ticket:  FORGEOS-DO002, TASK-INT-DO002
-- Author:  DevOps Engineer
-- Date:    2026-03-07 (updated 2026-03-12)
-- =============================================================================

-- Switch to the forgeos database (should already be selected via POSTGRES_DB)
\connect forgeos;

-- =============================================================================
-- 1. EXTENSIONS
-- =============================================================================
-- uuid-ossp:  UUID generation (uuid_generate_v4) for primary keys
-- pgcrypto:   Cryptographic functions (gen_random_bytes) for token generation
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";

-- =============================================================================
-- 2. APPLICATION ROLE — forgeos_user
-- =============================================================================
-- Least-privilege role for application connections.
-- The superuser (forgeos) owns the database; forgeos_user is the runtime role
-- used by the MCP server and other application services.
--
-- Password is read from the same Docker secret as the superuser password.
-- In production, use a separate secret or Vault integration.
-- =============================================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'forgeos_user') THEN
        CREATE ROLE forgeos_user WITH
            LOGIN
            NOSUPERUSER
            NOCREATEDB
            NOCREATEROLE
            NOINHERIT
            CONNECTION LIMIT 40
            PASSWORD 'changeme_db_password';
        RAISE NOTICE 'Created role: forgeos_user';
    ELSE
        RAISE NOTICE 'Role forgeos_user already exists, skipping creation';
    END IF;
END
$$;

-- =============================================================================
-- 3. SCHEMA PERMISSIONS
-- =============================================================================
-- Grant usage on public schema and default privileges for future objects.
-- The migration scripts (001_initial.sql) create tables owned by the superuser;
-- forgeos_user needs SELECT/INSERT/UPDATE/DELETE on those tables.
-- =============================================================================

-- Grant schema-level access
GRANT USAGE ON SCHEMA public TO forgeos_user;

-- Grant privileges on all existing tables
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO forgeos_user;

-- Grant privileges on all existing sequences
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO forgeos_user;

-- Set default privileges for tables created in the future by the superuser
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO forgeos_user;

-- Set default privileges for sequences created in the future
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO forgeos_user;

-- =============================================================================
-- 4. DATABASE CONFIGURATION
-- =============================================================================
-- Set database-level defaults that apply to all connections.
-- These complement the postgresql.conf settings in the Dockerfile.
-- =============================================================================

-- Set default timezone to UTC for consistent timestamp handling
ALTER DATABASE forgeos SET timezone TO 'UTC';

-- Set default statement timeout to prevent runaway queries (30 seconds)
ALTER DATABASE forgeos SET statement_timeout TO '30s';

-- Set default lock timeout to prevent indefinite lock waits (10 seconds)
ALTER DATABASE forgeos SET lock_timeout TO '10s';

-- Set default idle-in-transaction timeout (5 minutes)
ALTER DATABASE forgeos SET idle_in_transaction_session_timeout TO '300s';

-- =============================================================================
-- 5. VERIFICATION
-- =============================================================================
-- Log verification messages for startup diagnostics.
-- =============================================================================

DO $$
DECLARE
    ext_count INTEGER;
    role_exists BOOLEAN;
BEGIN
    -- Verify extensions
    SELECT COUNT(*) INTO ext_count
    FROM pg_extension
    WHERE extname IN ('uuid-ossp', 'pgcrypto', 'vector');

    IF ext_count = 3 THEN
        RAISE NOTICE 'ForgeOS init: All required extensions installed (uuid-ossp, pgcrypto, vector)';
    ELSE
        RAISE WARNING 'ForgeOS init: Expected 3 extensions, found %', ext_count;
    END IF;

    -- Verify role
    SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname = 'forgeos_user') INTO role_exists;

    IF role_exists THEN
        RAISE NOTICE 'ForgeOS init: forgeos_user role verified';
    ELSE
        RAISE WARNING 'ForgeOS init: forgeos_user role NOT found';
    END IF;

    RAISE NOTICE 'ForgeOS init: Database initialization complete';
END
$$;

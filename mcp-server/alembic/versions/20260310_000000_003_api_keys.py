"""API keys table — per-agent key management with hashed storage.

Revision ID: 003
Revises: 002
Create Date: 2026-03-10

Creates the api_keys table for agent API key authentication (FORGEOS-BE051):
- Stores SHA-256 hashed keys (never plaintext)
- key_prefix for indexed lookups (first 8 hex chars)
- Foreign key to agents table for identity resolution
- Supports key rotation via multiple keys per agent
- Expiration and revocation tracking
- last_used_at for auditing
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "003"
down_revision: Union[str, None] = "002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create api_keys table."""
    op.execute("""
        CREATE TABLE api_keys (
            id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            agent_id        UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
            key_hash        TEXT NOT NULL,
            key_prefix      TEXT NOT NULL,
            label           TEXT NOT NULL DEFAULT 'default',
            is_active       BOOLEAN NOT NULL DEFAULT TRUE,
            expires_at      TIMESTAMPTZ,
            revoked_at      TIMESTAMPTZ,
            last_used_at    TIMESTAMPTZ,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    """)

    # Index on key_prefix for fast lookups during authentication
    op.execute("CREATE INDEX idx_api_keys_prefix ON api_keys(key_prefix);")

    # Index on agent_id for listing keys per agent
    op.execute("CREATE INDEX idx_api_keys_agent_id ON api_keys(agent_id);")

    # Partial index: active keys only (most auth queries)
    op.execute("""
        CREATE INDEX idx_api_keys_active
            ON api_keys(key_prefix)
            WHERE is_active = TRUE AND revoked_at IS NULL;
    """)

    # Unique constraint: one hash globally
    op.execute("""
        CREATE UNIQUE INDEX idx_api_keys_hash_unique ON api_keys(key_hash);
    """)


def downgrade() -> None:
    """Drop api_keys table."""
    op.execute("DROP TABLE IF EXISTS api_keys CASCADE;")

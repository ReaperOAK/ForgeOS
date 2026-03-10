"""Create notification_channels table for configurable delivery targets.

Revision ID: 006
Revises: 005
Create Date: 2026-03-11

.. meta::
   :ticket: FORGEOS-BE066
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op

revision: str = "006"
down_revision: Union[str, None] = "005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create notification_channels table with channel_type enum."""
    op.execute(
        "CREATE TYPE channel_type AS ENUM ('webhook', 'slack')"
    )

    op.execute(
        "CREATE TABLE notification_channels ("
        "  channel_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),"
        "  name TEXT NOT NULL,"
        "  type channel_type NOT NULL,"
        "  config JSONB NOT NULL DEFAULT '{}'::jsonb,"
        "  event_filter TEXT[] NOT NULL DEFAULT '{}'::text[],"
        "  enabled BOOLEAN NOT NULL DEFAULT TRUE,"
        "  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),"
        "  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()"
        ")"
    )

    op.execute(
        "CREATE INDEX idx_notification_channels_enabled"
        " ON notification_channels (enabled)"
        " WHERE enabled = TRUE"
    )

    op.execute(
        "CREATE OR REPLACE FUNCTION update_notification_channels_updated_at()"
        " RETURNS TRIGGER AS $$"
        " BEGIN"
        "   NEW.updated_at = NOW();"
        "   RETURN NEW;"
        " END;"
        " $$ LANGUAGE plpgsql"
    )

    op.execute(
        "CREATE TRIGGER trg_notification_channels_updated_at"
        " BEFORE UPDATE ON notification_channels"
        " FOR EACH ROW"
        " EXECUTE FUNCTION update_notification_channels_updated_at()"
    )


def downgrade() -> None:
    """Drop notification_channels table and supporting objects."""
    op.execute(
        "DROP TRIGGER IF EXISTS trg_notification_channels_updated_at"
        " ON notification_channels"
    )
    op.execute("DROP FUNCTION IF EXISTS update_notification_channels_updated_at()")
    op.execute("DROP INDEX IF EXISTS idx_notification_channels_enabled")
    op.execute("DROP TABLE IF EXISTS notification_channels")
    op.execute("DROP TYPE IF EXISTS channel_type")

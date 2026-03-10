"""Create notification_queue table and supporting objects.

Revision ID: 004
Revises: 003
Create Date: 2026-03-10

.. meta::
   :ticket: FORGEOS-BE064
"""

from alembic import op

revision = "004"
down_revision = "003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Create notification_queue table with status enum and dequeue index."""
    op.execute(
        "CREATE TYPE notification_status AS ENUM"
        " ('pending', 'processing', 'delivered', 'failed', 'dead_letter')"
    )

    op.execute(
        "CREATE TABLE notification_queue ("
        "  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),"
        "  event_type TEXT NOT NULL,"
        "  payload JSONB NOT NULL DEFAULT '{}'::jsonb,"
        "  status notification_status NOT NULL DEFAULT 'pending',"
        "  retry_count INTEGER NOT NULL DEFAULT 0"
        "    CHECK (retry_count >= 0),"
        "  max_retries INTEGER NOT NULL DEFAULT 5"
        "    CHECK (max_retries >= 1),"
        "  next_retry_at TIMESTAMPTZ,"
        "  error_message TEXT,"
        "  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),"
        "  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()"
        ")"
    )

    # Partial index for dequeue queries
    op.execute(
        "CREATE INDEX idx_notification_queue_dequeue"
        " ON notification_queue (status, next_retry_at)"
        " WHERE status IN ('pending', 'failed')"
    )

    # Auto-update trigger for updated_at
    op.execute(
        "CREATE OR REPLACE FUNCTION update_notification_queue_updated_at()"
        " RETURNS TRIGGER AS $$"
        " BEGIN"
        "   NEW.updated_at = NOW();"
        "   RETURN NEW;"
        " END;"
        " $$ LANGUAGE plpgsql"
    )

    op.execute(
        "CREATE TRIGGER trg_notification_queue_updated_at"
        " BEFORE UPDATE ON notification_queue"
        " FOR EACH ROW"
        " EXECUTE FUNCTION update_notification_queue_updated_at()"
    )


def downgrade() -> None:
    """Drop notification_queue table and supporting objects."""
    op.execute("DROP TRIGGER IF EXISTS trg_notification_queue_updated_at ON notification_queue")
    op.execute("DROP FUNCTION IF EXISTS update_notification_queue_updated_at()")
    op.execute("DROP INDEX IF EXISTS idx_notification_queue_dequeue")
    op.execute("DROP TABLE IF EXISTS notification_queue")
    op.execute("DROP TYPE IF EXISTS notification_status")

"""Create audit_log table for comprehensive audit logging.

Revision ID: 006
Revises: 005
Create Date: 2026-03-11

Creates the ``audit_log`` table for recording all authenticated MCP tool
calls and REST API requests. Records are append-only at the application
level (no UPDATE or DELETE operations performed by the application).

Columns:
- audit_id: UUID primary key
- identity_type: agent, operator, or admin
- identity_id: identifier of the authenticated entity
- operation: the action performed (e.g. tool call name, HTTP method + path)
- target: target resource (e.g. ticket ID, endpoint path)
- result: outcome (success, failure, error)
- timestamp: when the operation occurred
- metadata: arbitrary JSONB payload (request details, error info)
- source_machine: machine/IP that originated the request

.. meta::
   :ticket: FORGEOS-BE058
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op

revision: str = "006"
down_revision: Union[str, None] = "005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create audit_log table with indexes."""
    op.execute("""
        CREATE TABLE audit_log (
            audit_id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            identity_type   TEXT NOT NULL,
            identity_id     TEXT NOT NULL,
            operation       TEXT NOT NULL,
            target          TEXT NOT NULL DEFAULT '',
            result          TEXT NOT NULL DEFAULT 'success',
            timestamp       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            metadata        JSONB NOT NULL DEFAULT '{}',
            source_machine  TEXT NOT NULL DEFAULT ''
        );
    """)

    op.execute("""
        CREATE INDEX idx_audit_log_identity_id ON audit_log (identity_id);
    """)
    op.execute("""
        CREATE INDEX idx_audit_log_operation ON audit_log (operation);
    """)
    op.execute("""
        CREATE INDEX idx_audit_log_timestamp ON audit_log (timestamp);
    """)
    op.execute("""
        CREATE INDEX idx_audit_log_identity_type ON audit_log (identity_type);
    """)


def downgrade() -> None:
    """Drop audit_log table and its indexes."""
    op.execute("DROP INDEX IF EXISTS idx_audit_log_identity_type;")
    op.execute("DROP INDEX IF EXISTS idx_audit_log_timestamp;")
    op.execute("DROP INDEX IF EXISTS idx_audit_log_operation;")
    op.execute("DROP INDEX IF EXISTS idx_audit_log_identity_id;")
    op.execute("DROP TABLE IF EXISTS audit_log;")

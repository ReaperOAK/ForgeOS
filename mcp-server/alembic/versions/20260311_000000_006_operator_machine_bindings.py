"""Create operator_machine_bindings table for machine-scoped permissions.

Revision ID: 006
Revises: 005
Create Date: 2026-03-11

Implements the operator-machine binding table for FORGEOS-BE056.
Each row maps an operator to a machine they are allowed to act on.
Operators can belong to multiple machines (many-to-many).

.. meta::
   :ticket: FORGEOS-BE056
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op

revision: str = "006"
down_revision: Union[str, None] = "005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create operator_machine_bindings table."""
    op.execute("""
        CREATE TABLE operator_machine_bindings (
            id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            operator_id     UUID NOT NULL REFERENCES operators(operator_id) ON DELETE CASCADE,
            machine_id      TEXT NOT NULL,
            registered_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    """)

    # Composite unique: one binding per operator-machine pair
    op.execute(
        "ALTER TABLE operator_machine_bindings "
        "ADD CONSTRAINT uq_operator_machine UNIQUE (operator_id, machine_id);"
    )

    # Index for fast lookups by operator
    op.execute(
        "CREATE INDEX idx_omb_operator_id "
        "ON operator_machine_bindings(operator_id);"
    )

    # Index for fast lookups by machine
    op.execute(
        "CREATE INDEX idx_omb_machine_id "
        "ON operator_machine_bindings(machine_id);"
    )


def downgrade() -> None:
    """Drop operator_machine_bindings table."""
    op.execute("DROP TABLE IF EXISTS operator_machine_bindings;")

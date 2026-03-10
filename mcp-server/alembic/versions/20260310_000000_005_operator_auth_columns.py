"""Add operator authentication columns to operators table.

Revision ID: 005
Revises: 004
Create Date: 2026-03-10

Adds password_hash, role, and is_active columns to the operators table
to support JWT-based operator token authentication (FORGEOS-BE053).

.. meta::
   :ticket: FORGEOS-BE053
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op

revision: str = "005"
down_revision: Union[str, None] = "004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add authentication columns to operators table."""
    op.execute(
        "ALTER TABLE operators "
        "ADD COLUMN password_hash TEXT NOT NULL DEFAULT '';"
    )
    op.execute(
        "ALTER TABLE operators "
        "ADD COLUMN role TEXT NOT NULL DEFAULT 'operator';"
    )
    op.execute(
        "ALTER TABLE operators "
        "ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE;"
    )


def downgrade() -> None:
    """Remove authentication columns from operators table."""
    op.execute("ALTER TABLE operators DROP COLUMN IF EXISTS is_active;")
    op.execute("ALTER TABLE operators DROP COLUMN IF EXISTS role;")
    op.execute("ALTER TABLE operators DROP COLUMN IF EXISTS password_hash;")

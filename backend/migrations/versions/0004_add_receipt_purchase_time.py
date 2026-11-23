"""add_receipt_purchase_time

Revision ID: 0004_add_receipt_purchase_time
Revises: 0003_drop_store_use_firefly_account_id
Create Date: 2026-11-22 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0004_add_receipt_purchase_time"
down_revision: Union[str, None] = "0003_drop_store_use_firefly_account_id"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("receipt", schema=None) as batch_op:
        batch_op.add_column(sa.Column("purchase_time", sa.Time(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("receipt", schema=None) as batch_op:
        batch_op.drop_column("purchase_time")

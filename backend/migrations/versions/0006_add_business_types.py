"""add_business_types_to_company_and_account_metadata

Revision ID: 0006_add_business_types
Revises: 0005_account_metadata_and_classification
Create Date: 2026-11-24 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0006_add_business_types"
down_revision: Union[str, None] = "0005_account_metadata_and_classification"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if "company" in inspector.get_table_names():
        comp_cols = [c["name"] for c in inspector.get_columns("company")]
        if "business_types" not in comp_cols:
            op.add_column(
                "company",
                sa.Column("business_types", sa.Text(), nullable=True, server_default="[]"),
            )

    if "account_metadata" in inspector.get_table_names():
        meta_cols = [c["name"] for c in inspector.get_columns("account_metadata")]
        if "business_types" not in meta_cols:
            op.add_column(
                "account_metadata",
                sa.Column("business_types", sa.Text(), nullable=True, server_default="[]"),
            )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if "account_metadata" in inspector.get_table_names():
        meta_cols = [c["name"] for c in inspector.get_columns("account_metadata")]
        if "business_types" in meta_cols:
            with op.batch_alter_table("account_metadata") as batch_op:
                batch_op.drop_column("business_types")

    if "company" in inspector.get_table_names():
        comp_cols = [c["name"] for c in inspector.get_columns("company")]
        if "business_types" in comp_cols:
            with op.batch_alter_table("company") as batch_op:
                batch_op.drop_column("business_types")

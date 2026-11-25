"""asset_account_metadata

Revision ID: 0008_asset_account_metadata
Revises: 0007_cleanup_legacy_default_category
Create Date: 2026-11-25 14:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0008_asset_account_metadata"
down_revision: Union[str, None] = "0007_cleanup_legacy_default_category"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if "asset_account_metadata" not in inspector.get_table_names():
        op.create_table(
            "asset_account_metadata",
            sa.Column("firefly_account_id", sa.Integer(), nullable=False),
            sa.Column(
                "asset_type",
                sa.String(length=32),
                nullable=False,
                server_default="standard",
            ),
            sa.Column("voucher_unit_value", sa.Float(), nullable=True),
            sa.Column("default_revenue_account_id", sa.Integer(), nullable=True),
            sa.Column("default_recharge_description", sa.String(), nullable=True),
            sa.Column("notes", sa.String(), nullable=True),
            sa.Column(
                "created_at",
                sa.DateTime(),
                nullable=False,
                server_default=sa.func.now(),
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(),
                nullable=False,
                server_default=sa.func.now(),
            ),
            sa.PrimaryKeyConstraint("firefly_account_id"),
        )
        op.create_index(
            "ix_asset_account_metadata_asset_type",
            "asset_account_metadata",
            ["asset_type"],
            unique=False,
        )
        op.create_index(
            "ix_asset_account_metadata_default_revenue_account_id",
            "asset_account_metadata",
            ["default_revenue_account_id"],
            unique=False,
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "asset_account_metadata" in inspector.get_table_names():
        op.drop_index(
            "ix_asset_account_metadata_default_revenue_account_id",
            table_name="asset_account_metadata",
        )
        op.drop_index(
            "ix_asset_account_metadata_asset_type",
            table_name="asset_account_metadata",
        )
        op.drop_table("asset_account_metadata")

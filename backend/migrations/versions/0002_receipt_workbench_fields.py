"""receipt_workbench_fields

Revision ID: 0002_receipt_workbench_fields
Revises: 0001_pre_workbench_baseline
Create Date: 2026-11-11 00:01:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0002_receipt_workbench_fields"
down_revision: Union[str, None] = "0001_pre_workbench_baseline"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("pricerecord", schema=None) as batch_op:
        batch_op.add_column(sa.Column("package_size", sa.Float(), nullable=True))
        batch_op.add_column(
            sa.Column("normalized_regular_price", sa.Float(), nullable=True)
        )

    with op.batch_alter_table("receipt", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "basket_discount",
                sa.Float(),
                nullable=False,
                server_default=sa.text("0.0"),
            )
        )
        batch_op.add_column(
            sa.Column("source_account_id", sa.Integer(), nullable=True)
        )
        batch_op.add_column(
            sa.Column(
                "payment_mode",
                sa.String(),
                nullable=False,
                server_default=sa.text("'single'"),
            )
        )
        batch_op.add_column(
            sa.Column("voucher_account_id", sa.Integer(), nullable=True)
        )
        batch_op.add_column(
            sa.Column(
                "voucher_count",
                sa.Integer(),
                nullable=False,
                server_default=sa.text("0"),
            )
        )
        batch_op.add_column(
            sa.Column(
                "voucher_unit_value",
                sa.Float(),
                nullable=False,
                server_default=sa.text("5.16"),
            )
        )
        batch_op.add_column(
            sa.Column("firefly_voucher_transaction_id", sa.Integer(), nullable=True)
        )
        batch_op.create_index(
            "ix_receipt_firefly_voucher_transaction_id",
            ["firefly_voucher_transaction_id"],
            unique=False,
        )

    with op.batch_alter_table("receiptitem", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "package_size",
                sa.Float(),
                nullable=False,
                server_default=sa.text("1.0"),
            )
        )
        batch_op.alter_column(
            "regular_price", existing_type=sa.Float(), nullable=True
        )

    with op.batch_alter_table("receiptattachment", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "sha256_hash",
                sa.String(),
                nullable=False,
                server_default=sa.text("''"),
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("receiptattachment", schema=None) as batch_op:
        batch_op.drop_column("sha256_hash")

    with op.batch_alter_table("receiptitem", schema=None) as batch_op:
        batch_op.alter_column(
            "regular_price", existing_type=sa.Float(), nullable=False
        )
        batch_op.drop_column("package_size")

    with op.batch_alter_table("receipt", schema=None) as batch_op:
        batch_op.drop_index("ix_receipt_firefly_voucher_transaction_id")
        batch_op.drop_column("firefly_voucher_transaction_id")
        batch_op.drop_column("voucher_unit_value")
        batch_op.drop_column("voucher_count")
        batch_op.drop_column("voucher_account_id")
        batch_op.drop_column("payment_mode")
        batch_op.drop_column("source_account_id")
        batch_op.drop_column("basket_discount")

    with op.batch_alter_table("pricerecord", schema=None) as batch_op:
        batch_op.drop_column("normalized_regular_price")
        batch_op.drop_column("package_size")

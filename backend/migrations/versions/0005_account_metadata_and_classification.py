"""account_metadata_and_classification

Revision ID: 0005_account_metadata_and_classification
Revises: 0004_add_receipt_purchase_time
Create Date: 2026-11-23 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0005_account_metadata_and_classification"
down_revision: Union[str, None] = "0004_add_receipt_purchase_time"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()

    # 1. Create table account_metadata
    op.create_table(
        "account_metadata",
        sa.Column("firefly_account_id", sa.Integer(), nullable=False),
        sa.Column("role", sa.String(length=32), nullable=False, server_default="unclassified"),
        sa.Column("category", sa.String(length=255), nullable=True),
        sa.Column("company_id", sa.Integer(), nullable=True),
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
        sa.ForeignKeyConstraint(
            ["company_id"], ["company.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("firefly_account_id"),
    )
    op.create_index(
        "ix_account_metadata_role",
        "account_metadata",
        ["role"],
        unique=False,
    )
    op.create_index(
        "ix_account_metadata_category",
        "account_metadata",
        ["category"],
        unique=False,
    )
    op.create_index(
        "ix_account_metadata_company_id",
        "account_metadata",
        ["company_id"],
        unique=False,
    )

    # 2. Backfill existing chain links from companyaccountlink if present
    # Check if companyaccountlink table exists
    inspector = sa.inspect(bind)
    if "companyaccountlink" in inspector.get_table_names():
        bind.execute(
            sa.text(
                """
                INSERT OR IGNORE INTO account_metadata (firefly_account_id, role, company_id, created_at, updated_at)
                SELECT firefly_account_id, 'chain', company_id, created_at, created_at
                FROM companyaccountlink
                WHERE company_id IS NOT NULL;
                """
            )
        )


def downgrade() -> None:
    op.drop_index("ix_account_metadata_company_id", table_name="account_metadata")
    op.drop_index("ix_account_metadata_category", table_name="account_metadata")
    op.drop_index("ix_account_metadata_role", table_name="account_metadata")
    op.drop_table("account_metadata")

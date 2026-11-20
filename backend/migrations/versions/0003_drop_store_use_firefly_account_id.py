"""drop_store_use_firefly_account_id

Revision ID: 0003_drop_store_use_firefly_account_id
Revises: 0002_receipt_workbench_fields
Create Date: 2026-11-20 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0003_drop_store_use_firefly_account_id"
down_revision: Union[str, None] = "0002_receipt_workbench_fields"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()

    # 1. Create table companyaccountlink
    op.create_table(
        "companyaccountlink",
        sa.Column("firefly_account_id", sa.Integer(), nullable=False),
        sa.Column("company_id", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
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
        "ix_companyaccountlink_company_id",
        "companyaccountlink",
        ["company_id"],
        unique=False,
    )

    # 2. Validate pre-condition: ensure no receipt or pricerecord references a store with NULL firefly_account_id
    receipt_null_count = bind.execute(
        sa.text(
            """
            SELECT COUNT(*) FROM receipt r
            JOIN store s ON r.store_id = s.id
            WHERE s.firefly_account_id IS NULL
            """
        )
    ).scalar() or 0

    price_null_count = bind.execute(
        sa.text(
            """
            SELECT COUNT(*) FROM pricerecord p
            JOIN store s ON p.store_id = s.id
            WHERE s.firefly_account_id IS NULL
            """
        )
    ).scalar() or 0

    if receipt_null_count > 0 or price_null_count > 0:
        raise RuntimeError(
            f"Migration aborted: Found {receipt_null_count} receipts and {price_null_count} "
            "price records referencing stores where firefly_account_id is NULL. "
            "All active stores must be mapped to Firefly III accounts before upgrading."
        )

    # 3. Populate companyaccountlink from store
    bind.execute(
        sa.text(
            """
            INSERT INTO companyaccountlink (firefly_account_id, company_id, created_at)
            SELECT firefly_account_id, company_id, CURRENT_TIMESTAMP
            FROM store
            WHERE store.company_id IS NOT NULL AND store.firefly_account_id IS NOT NULL
            """
        )
    )

    # 4. Alter receipt: add firefly_account_id, backfill, make NOT NULL, index, drop store_id
    with op.batch_alter_table("receipt", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("firefly_account_id", sa.Integer(), nullable=True)
        )

    bind.execute(
        sa.text(
            """
            UPDATE receipt
            SET firefly_account_id = (
                SELECT s.firefly_account_id FROM store s WHERE s.id = receipt.store_id
            )
            """
        )
    )

    with op.batch_alter_table("receipt", schema=None) as batch_op:
        batch_op.alter_column(
            "firefly_account_id", existing_type=sa.Integer(), nullable=False
        )
        batch_op.create_index(
            "ix_receipt_firefly_account_id", ["firefly_account_id"], unique=False
        )
        batch_op.drop_index("ix_receipt_store_id")
        batch_op.drop_column("store_id")

    # 5. Alter pricerecord: add firefly_account_id, backfill, make NOT NULL, index, drop store_id
    with op.batch_alter_table("pricerecord", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("firefly_account_id", sa.Integer(), nullable=True)
        )

    bind.execute(
        sa.text(
            """
            UPDATE pricerecord
            SET firefly_account_id = (
                SELECT s.firefly_account_id FROM store s WHERE s.id = pricerecord.store_id
            )
            """
        )
    )

    with op.batch_alter_table("pricerecord", schema=None) as batch_op:
        batch_op.alter_column(
            "firefly_account_id", existing_type=sa.Integer(), nullable=False
        )
        batch_op.create_index(
            "ix_pricerecord_firefly_account_id",
            ["firefly_account_id"],
            unique=False,
        )
        batch_op.drop_index("ix_pricerecord_store_id")
        batch_op.drop_column("store_id")

    # 6. Drop store table
    op.drop_index("ix_store_company_id", table_name="store")
    op.drop_index("ix_store_firefly_account_id", table_name="store")
    op.drop_index("ix_store_name", table_name="store")
    op.drop_table("store")


def downgrade() -> None:
    bind = op.get_bind()

    # 1. Recreate store table
    op.create_table(
        "store",
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("company_id", sa.Integer(), nullable=False),
        sa.Column("address", sa.String(), nullable=True),
        sa.Column("firefly_account_id", sa.Integer(), nullable=True),
        sa.Column("firefly_account_name", sa.String(), nullable=True),
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["company_id"], ["company.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_store_name", "store", ["name"], unique=False)
    op.create_index(
        "ix_store_company_id", "store", ["company_id"], unique=False
    )
    op.create_index(
        "ix_store_firefly_account_id",
        "store",
        ["firefly_account_id"],
        unique=True,
    )

    # 2. Ensure fallback company exists
    fallback_id = bind.execute(
        sa.text("SELECT id FROM company LIMIT 1")
    ).scalar()
    if not fallback_id:
        bind.execute(
            sa.text(
                "INSERT INTO company (name, created_at) VALUES ('Unassigned', CURRENT_TIMESTAMP)"
            )
        )
        fallback_id = bind.execute(
            sa.text("SELECT id FROM company WHERE name = 'Unassigned'")
        ).scalar()

    # Repopulate store from distinct firefly_account_id values
    bind.execute(
        sa.text(
            f"""
            INSERT INTO store (name, company_id, firefly_account_id, created_at)
            SELECT
                COALESCE('Account #' || accounts.firefly_account_id, 'Store'),
                COALESCE(cal.company_id, {fallback_id}),
                accounts.firefly_account_id,
                CURRENT_TIMESTAMP
            FROM (
                SELECT firefly_account_id FROM receipt WHERE firefly_account_id IS NOT NULL
                UNION
                SELECT firefly_account_id FROM pricerecord WHERE firefly_account_id IS NOT NULL
                UNION
                SELECT firefly_account_id FROM companyaccountlink WHERE firefly_account_id IS NOT NULL
            ) AS accounts
            LEFT JOIN companyaccountlink cal ON cal.firefly_account_id = accounts.firefly_account_id
            """
        )
    )

    # 3. Restore store_id on receipt
    with op.batch_alter_table("receipt", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("store_id", sa.Integer(), nullable=True)
        )

    bind.execute(
        sa.text(
            """
            UPDATE receipt
            SET store_id = (
                SELECT s.id FROM store s WHERE s.firefly_account_id = receipt.firefly_account_id
            )
            """
        )
    )

    with op.batch_alter_table("receipt", schema=None) as batch_op:
        batch_op.alter_column(
            "store_id", existing_type=sa.Integer(), nullable=False
        )
        batch_op.create_foreign_key(
            "fk_receipt_store_id", "store", ["store_id"], ["id"]
        )
        batch_op.create_index(
            "ix_receipt_store_id", ["store_id"], unique=False
        )
        batch_op.drop_index("ix_receipt_firefly_account_id")
        batch_op.drop_column("firefly_account_id")

    # 4. Restore store_id on pricerecord
    with op.batch_alter_table("pricerecord", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("store_id", sa.Integer(), nullable=True)
        )

    bind.execute(
        sa.text(
            """
            UPDATE pricerecord
            SET store_id = (
                SELECT s.id FROM store s WHERE s.firefly_account_id = pricerecord.firefly_account_id
            )
            """
        )
    )

    with op.batch_alter_table("pricerecord", schema=None) as batch_op:
        batch_op.alter_column(
            "store_id", existing_type=sa.Integer(), nullable=False
        )
        batch_op.create_foreign_key(
            "fk_pricerecord_store_id", "store", ["store_id"], ["id"]
        )
        batch_op.create_index(
            "ix_pricerecord_store_id", ["store_id"], unique=False
        )
        batch_op.drop_index("ix_pricerecord_firefly_account_id")
        batch_op.drop_column("firefly_account_id")

    # 5. Drop companyaccountlink
    op.drop_index(
        "ix_companyaccountlink_company_id", table_name="companyaccountlink"
    )
    op.drop_table("companyaccountlink")

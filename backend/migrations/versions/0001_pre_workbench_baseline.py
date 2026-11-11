"""pre_workbench_baseline

Revision ID: 0001_pre_workbench_baseline
Revises:
Create Date: 2026-11-11 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0001_pre_workbench_baseline"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "brand",
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("is_private_label", sa.Boolean(), nullable=False),
        sa.Column("notes", sa.String(), nullable=True),
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_brand_name", "brand", ["name"], unique=True)

    op.create_table(
        "company",
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("default_category", sa.String(), nullable=True),
        sa.Column("notes", sa.String(), nullable=True),
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_company_name", "company", ["name"], unique=True)

    op.create_table(
        "tag",
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("group", sa.String(), nullable=False),
        sa.Column("color", sa.String(), nullable=True),
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_tag_group", "tag", ["group"], unique=False)
    op.create_index("ix_tag_name", "tag", ["name"], unique=True)

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
    op.create_index("ix_store_company_id", "store", ["company_id"], unique=False)
    op.create_index("ix_store_firefly_account_id", "store", ["firefly_account_id"], unique=True)
    op.create_index("ix_store_name", "store", ["name"], unique=False)

    op.create_table(
        "product",
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("brand_id", sa.Integer(), nullable=True),
        sa.Column("barcode", sa.String(), nullable=True),
        sa.Column("default_unit", sa.String(), nullable=False),
        sa.Column("package_size", sa.Float(), nullable=False),
        sa.Column("notes", sa.String(), nullable=True),
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["brand_id"], ["brand.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_product_barcode", "product", ["barcode"], unique=False)
    op.create_index("ix_product_brand_id", "product", ["brand_id"], unique=False)
    op.create_index("ix_product_name", "product", ["name"], unique=False)

    op.create_table(
        "producttaglink",
        sa.Column("product_id", sa.Integer(), nullable=False),
        sa.Column("tag_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["product_id"], ["product.id"]),
        sa.ForeignKeyConstraint(["tag_id"], ["tag.id"]),
        sa.PrimaryKeyConstraint("product_id", "tag_id"),
    )

    op.create_table(
        "pricerecord",
        sa.Column("product_id", sa.Integer(), nullable=False),
        sa.Column("store_id", sa.Integer(), nullable=False),
        sa.Column("recorded_date", sa.Date(), nullable=False),
        sa.Column("regular_price", sa.Float(), nullable=False),
        sa.Column("paid_price", sa.Float(), nullable=False),
        sa.Column("is_discount", sa.Boolean(), nullable=False),
        sa.Column("discount_type", sa.String(), nullable=True),
        sa.Column("discount_note", sa.String(), nullable=True),
        sa.Column("quantity", sa.Float(), nullable=False),
        sa.Column("unit", sa.String(), nullable=False),
        sa.Column("normalized_unit_price", sa.Float(), nullable=True),
        sa.Column("firefly_transaction_id", sa.Integer(), nullable=True),
        sa.Column("notes", sa.String(), nullable=True),
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["product_id"], ["product.id"]),
        sa.ForeignKeyConstraint(["store_id"], ["store.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_pricerecord_firefly_transaction_id", "pricerecord", ["firefly_transaction_id"], unique=False)
    op.create_index("ix_pricerecord_is_discount", "pricerecord", ["is_discount"], unique=False)
    op.create_index("ix_pricerecord_product_id", "pricerecord", ["product_id"], unique=False)
    op.create_index("ix_pricerecord_recorded_date", "pricerecord", ["recorded_date"], unique=False)
    op.create_index("ix_pricerecord_store_id", "pricerecord", ["store_id"], unique=False)

    op.create_table(
        "receipt",
        sa.Column("store_id", sa.Integer(), nullable=False),
        sa.Column("purchase_date", sa.Date(), nullable=False),
        sa.Column("total_amount", sa.Float(), nullable=False),
        sa.Column("firefly_transaction_id", sa.Integer(), nullable=True),
        sa.Column("notes", sa.String(), nullable=True),
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["store_id"], ["store.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_receipt_firefly_transaction_id", "receipt", ["firefly_transaction_id"], unique=False)
    op.create_index("ix_receipt_purchase_date", "receipt", ["purchase_date"], unique=False)
    op.create_index("ix_receipt_store_id", "receipt", ["store_id"], unique=False)

    op.create_table(
        "receiptitem",
        sa.Column("receipt_id", sa.Integer(), nullable=False),
        sa.Column("product_id", sa.Integer(), nullable=False),
        sa.Column("quantity", sa.Float(), nullable=False),
        sa.Column("unit", sa.String(), nullable=False),
        sa.Column("regular_price", sa.Float(), nullable=False),
        sa.Column("paid_price", sa.Float(), nullable=False),
        sa.Column("is_discount", sa.Boolean(), nullable=False),
        sa.Column("line_total", sa.Float(), nullable=False),
        sa.Column("id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["product_id"], ["product.id"]),
        sa.ForeignKeyConstraint(["receipt_id"], ["receipt.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_receiptitem_product_id", "receiptitem", ["product_id"], unique=False)
    op.create_index("ix_receiptitem_receipt_id", "receiptitem", ["receipt_id"], unique=False)

    op.create_table(
        "receiptattachment",
        sa.Column("receipt_id", sa.Integer(), nullable=False),
        sa.Column("filename", sa.String(), nullable=False),
        sa.Column("stored_path", sa.String(), nullable=False),
        sa.Column("file_type", sa.String(), nullable=False),
        sa.Column("file_size_bytes", sa.Integer(), nullable=False),
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("uploaded_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["receipt_id"], ["receipt.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_receiptattachment_receipt_id", "receiptattachment", ["receipt_id"], unique=False)


def downgrade() -> None:
    op.drop_table("receiptattachment")
    op.drop_table("receiptitem")
    op.drop_table("receipt")
    op.drop_table("pricerecord")
    op.drop_table("producttaglink")
    op.drop_table("product")
    op.drop_table("store")
    op.drop_table("tag")
    op.drop_table("company")
    op.drop_table("brand")

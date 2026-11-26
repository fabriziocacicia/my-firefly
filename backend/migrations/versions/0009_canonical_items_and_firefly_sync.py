"""canonical_items_and_firefly_sync

Revision ID: 0009_canonical_items_and_firefly_sync
Revises: 0008_asset_account_metadata
Create Date: 2026-11-26 12:15:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0009_canonical_items_and_firefly_sync"
down_revision: Union[str, None] = "0008_asset_account_metadata"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "tag" in tables:
        tag_cols = {c["name"] for c in inspector.get_columns("tag")}
        tag_indexes = {idx["name"] for idx in inspector.get_indexes("tag")}
        if "firefly_tag_id" not in tag_cols:
            op.add_column("tag", sa.Column("firefly_tag_id", sa.Integer(), nullable=True))
        if "ix_tag_firefly_tag_id" not in tag_indexes:
            op.create_index("ix_tag_firefly_tag_id", "tag", ["firefly_tag_id"], unique=True)

    if "tag_implication" not in tables:
        op.create_table(
            "tag_implication",
            sa.Column("child_tag_id", sa.Integer(), sa.ForeignKey("tag.id"), nullable=False),
            sa.Column("parent_tag_id", sa.Integer(), sa.ForeignKey("tag.id"), nullable=False),
            sa.PrimaryKeyConstraint("child_tag_id", "parent_tag_id"),
        )

    if "product" in tables:
        prod_cols = {c["name"] for c in inspector.get_columns("product")}
        prod_indexes = {idx["name"] for idx in inspector.get_indexes("product")}
        if "sale_mode" not in prod_cols:
            op.add_column(
                "product",
                sa.Column("sale_mode", sa.String(length=24), nullable=False, server_default="packaged"),
            )
        if "pack_count" not in prod_cols:
            op.add_column(
                "product",
                sa.Column("pack_count", sa.Integer(), nullable=False, server_default="1"),
            )
        if "unit_size" not in prod_cols:
            op.add_column(
                "product",
                sa.Column("unit_size", sa.Float(), nullable=False, server_default="1.0"),
            )
            op.execute(
                "UPDATE product SET unit_size = CASE WHEN package_size > 0 THEN package_size ELSE 1.0 END"
            )
        if "firefly_category_id" not in prod_cols:
            op.add_column("product", sa.Column("firefly_category_id", sa.Integer(), nullable=True))
        if "firefly_category_name" not in prod_cols:
            op.add_column("product", sa.Column("firefly_category_name", sa.String(), nullable=True))
        if "ix_product_firefly_category_id" not in prod_indexes:
            op.create_index(
                "ix_product_firefly_category_id", "product", ["firefly_category_id"], unique=False
            )
        if "ix_product_firefly_category_name" not in prod_indexes:
            op.create_index(
                "ix_product_firefly_category_name", "product", ["firefly_category_name"], unique=False
            )

    if "item_firefly_alias" not in tables:
        op.create_table(
            "item_firefly_alias",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("product_id", sa.Integer(), sa.ForeignKey("product.id"), nullable=False),
            sa.Column("raw_description", sa.String(), nullable=False),
            sa.Column("normalized_description", sa.String(), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(
            "ix_item_firefly_alias_product_id", "item_firefly_alias", ["product_id"], unique=False
        )
        op.create_index(
            "ix_item_firefly_alias_normalized_description",
            "item_firefly_alias",
            ["normalized_description"],
            unique=True,
        )

    if "pricerecord" in tables:
        price_cols = {c["name"] for c in inspector.get_columns("pricerecord")}
        price_indexes = {idx["name"] for idx in inspector.get_indexes("pricerecord")}
        if "transaction_journal_id" not in price_cols:
            op.add_column("pricerecord", sa.Column("transaction_journal_id", sa.Integer(), nullable=True))
        if "source_type" not in price_cols:
            op.add_column(
                "pricerecord",
                sa.Column("source_type", sa.String(length=32), nullable=False, server_default="receipt"),
            )
        if "ix_pricerecord_transaction_journal_id" not in price_indexes:
            op.create_index(
                "ix_pricerecord_transaction_journal_id",
                "pricerecord",
                ["transaction_journal_id"],
                unique=True,
            )

    if "firefly_synced_split" not in tables:
        op.create_table(
            "firefly_synced_split",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("transaction_journal_id", sa.Integer(), nullable=False),
            sa.Column("firefly_transaction_id", sa.Integer(), nullable=False),
            sa.Column("tx_type", sa.String(length=32), nullable=False, server_default="withdrawal"),
            sa.Column("tx_date", sa.Date(), nullable=False),
            sa.Column("amount_cents", sa.Integer(), nullable=False),
            sa.Column("description", sa.String(), nullable=False),
            sa.Column("normalized_description", sa.String(), nullable=False),
            sa.Column("firefly_expense_account_id", sa.Integer(), nullable=True),
            sa.Column("firefly_expense_account_name", sa.String(), nullable=True),
            sa.Column("firefly_category_name", sa.String(), nullable=True),
            sa.Column("tags_json", sa.Text(), nullable=False, server_default="[]"),
            sa.Column("linked_product_id", sa.Integer(), sa.ForeignKey("product.id"), nullable=True),
            sa.Column("is_ignored", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("synced_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(
            "ix_firefly_synced_split_transaction_journal_id",
            "firefly_synced_split",
            ["transaction_journal_id"],
            unique=True,
        )
        op.create_index(
            "ix_firefly_synced_split_firefly_transaction_id",
            "firefly_synced_split",
            ["firefly_transaction_id"],
            unique=False,
        )
        op.create_index(
            "ix_firefly_synced_split_tx_type",
            "firefly_synced_split",
            ["tx_type"],
            unique=False,
        )
        op.create_index(
            "ix_firefly_synced_split_tx_date",
            "firefly_synced_split",
            ["tx_date"],
            unique=False,
        )
        op.create_index(
            "ix_firefly_synced_split_description",
            "firefly_synced_split",
            ["description"],
            unique=False,
        )
        op.create_index(
            "ix_firefly_synced_split_normalized_description",
            "firefly_synced_split",
            ["normalized_description"],
            unique=False,
        )
        op.create_index(
            "ix_firefly_synced_split_firefly_expense_account_id",
            "firefly_synced_split",
            ["firefly_expense_account_id"],
            unique=False,
        )
        op.create_index(
            "ix_firefly_synced_split_firefly_category_name",
            "firefly_synced_split",
            ["firefly_category_name"],
            unique=False,
        )
        op.create_index(
            "ix_firefly_synced_split_linked_product_id",
            "firefly_synced_split",
            ["linked_product_id"],
            unique=False,
        )
        op.create_index(
            "ix_firefly_synced_split_is_ignored",
            "firefly_synced_split",
            ["is_ignored"],
            unique=False,
        )

    if "firefly_sync_state" not in tables:
        op.create_table(
            "firefly_sync_state",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("last_full_sync_at", sa.DateTime(), nullable=True),
            sa.Column("last_incremental_sync_at", sa.DateTime(), nullable=True),
            sa.Column("high_watermark_date", sa.Date(), nullable=True),
            sa.PrimaryKeyConstraint("id"),
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "firefly_sync_state" in tables:
        op.drop_table("firefly_sync_state")

    if "firefly_synced_split" in tables:
        op.drop_table("firefly_synced_split")

    if "pricerecord" in tables:
        price_cols = {c["name"] for c in inspector.get_columns("pricerecord")}
        price_indexes = {idx["name"] for idx in inspector.get_indexes("pricerecord")}
        if "ix_pricerecord_transaction_journal_id" in price_indexes:
            op.drop_index("ix_pricerecord_transaction_journal_id", table_name="pricerecord")
        with op.batch_alter_table("pricerecord") as batch_op:
            if "source_type" in price_cols:
                batch_op.drop_column("source_type")
            if "transaction_journal_id" in price_cols:
                batch_op.drop_column("transaction_journal_id")

    if "item_firefly_alias" in tables:
        op.drop_table("item_firefly_alias")

    if "product" in tables:
        prod_cols = {c["name"] for c in inspector.get_columns("product")}
        prod_indexes = {idx["name"] for idx in inspector.get_indexes("product")}
        if "ix_product_firefly_category_name" in prod_indexes:
            op.drop_index("ix_product_firefly_category_name", table_name="product")
        if "ix_product_firefly_category_id" in prod_indexes:
            op.drop_index("ix_product_firefly_category_id", table_name="product")
        with op.batch_alter_table("product") as batch_op:
            for col in (
                "firefly_category_name",
                "firefly_category_id",
                "unit_size",
                "pack_count",
                "sale_mode",
            ):
                if col in prod_cols:
                    batch_op.drop_column(col)

    if "tag_implication" in tables:
        op.drop_table("tag_implication")

    if "tag" in tables:
        tag_cols = {c["name"] for c in inspector.get_columns("tag")}
        tag_indexes = {idx["name"] for idx in inspector.get_indexes("tag")}
        if "ix_tag_firefly_tag_id" in tag_indexes:
            op.drop_index("ix_tag_firefly_tag_id", table_name="tag")
        if "firefly_tag_id" in tag_cols:
            with op.batch_alter_table("tag") as batch_op:
                batch_op.drop_column("firefly_tag_id")

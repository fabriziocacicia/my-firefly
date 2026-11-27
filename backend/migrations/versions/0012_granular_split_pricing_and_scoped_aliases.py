"""granular_split_pricing_and_scoped_aliases

Revision ID: 0012_granular_split_pricing_and_scoped_aliases
Revises: 0011_sanitize_redundant_product_tags
Create Date: 2026-11-27 17:40:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0012_granular_split_pricing_and_scoped_aliases"
down_revision: Union[str, None] = "0011_sanitize_redundant_product_tags"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "pricerecord" in tables:
        price_cols = {c["name"]: c for c in inspector.get_columns("pricerecord")}
        price_indexes = {idx["name"] for idx in inspector.get_indexes("pricerecord")}
        needs_qty_nullable = (
            "quantity" in price_cols and not price_cols["quantity"]["nullable"]
        )
        needs_status_col = "verification_status" not in price_cols

        if needs_qty_nullable or needs_status_col:
            with op.batch_alter_table("pricerecord") as batch_op:
                if needs_qty_nullable:
                    batch_op.alter_column(
                        "quantity",
                        existing_type=sa.Float(),
                        nullable=True,
                    )
                if needs_status_col:
                    batch_op.add_column(
                        sa.Column(
                            "verification_status",
                            sa.String(length=24),
                            nullable=False,
                            server_default="verified",
                        )
                    )

        refreshed_indexes = {
            idx["name"] for idx in sa.inspect(bind).get_indexes("pricerecord")
        }
        if "ix_pricerecord_verification_status" not in refreshed_indexes:
            op.create_index(
                "ix_pricerecord_verification_status",
                "pricerecord",
                ["verification_status"],
                unique=False,
            )

        if "product" in tables:
            bind.execute(
                sa.text(
                    "UPDATE pricerecord "
                    "SET verification_status = 'needs_review' "
                    "WHERE source_type = 'firefly_sync' "
                    "AND product_id IN (SELECT id FROM product WHERE sale_mode = 'loose_weight')"
                )
            )

    if "item_firefly_alias" in tables:
        alias_cols = {c["name"] for c in inspector.get_columns("item_firefly_alias")}
        alias_indexes = {
            idx["name"]: idx for idx in inspector.get_indexes("item_firefly_alias")
        }
        if "scope_key" not in alias_cols:
            with op.batch_alter_table("item_firefly_alias") as batch_op:
                desc_idx = alias_indexes.get("ix_item_firefly_alias_normalized_description")
                if desc_idx is not None:
                    batch_op.drop_index("ix_item_firefly_alias_normalized_description")
                batch_op.add_column(
                    sa.Column("company_id", sa.Integer(), nullable=True)
                )
                batch_op.add_column(
                    sa.Column("firefly_account_id", sa.Integer(), nullable=True)
                )
                batch_op.add_column(
                    sa.Column(
                        "scope_key",
                        sa.String(length=64),
                        nullable=False,
                        server_default="global",
                    )
                )
                if "company" in tables:
                    batch_op.create_foreign_key(
                        "fk_item_firefly_alias_company_id",
                        "company",
                        ["company_id"],
                        ["id"],
                    )
                batch_op.create_unique_constraint(
                    "uq_item_firefly_alias_desc_scope",
                    ["normalized_description", "scope_key"],
                )
                batch_op.create_index(
                    "ix_item_firefly_alias_normalized_description",
                    ["normalized_description"],
                    unique=False,
                )
                batch_op.create_index(
                    "ix_item_firefly_alias_company_id",
                    ["company_id"],
                    unique=False,
                )
                batch_op.create_index(
                    "ix_item_firefly_alias_firefly_account_id",
                    ["firefly_account_id"],
                    unique=False,
                )
                batch_op.create_index(
                    "ix_item_firefly_alias_scope_key",
                    ["scope_key"],
                    unique=False,
                )


def downgrade() -> None:
    pass

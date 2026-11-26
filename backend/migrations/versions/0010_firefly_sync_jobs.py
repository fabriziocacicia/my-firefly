"""firefly_sync_jobs

Revision ID: 0010_firefly_sync_jobs
Revises: 0009_canonical_items_and_firefly_sync
Create Date: 2026-11-26 16:05:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0010_firefly_sync_jobs"
down_revision: Union[str, None] = "0009_canonical_items_and_firefly_sync"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "firefly_sync_job" not in tables:
        op.create_table(
            "firefly_sync_job",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("job_type", sa.String(), nullable=False),
            sa.Column(
                "product_id",
                sa.Integer(),
                sa.ForeignKey("product.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("product_name", sa.String(), nullable=False),
            sa.Column("status", sa.String(), nullable=False, server_default="queued"),
            sa.Column("total_transactions", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("processed_transactions", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("updated_transactions", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("total_splits", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("linked_splits", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("updated_splits", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("failed_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("failed_transactions_json", sa.Text(), nullable=False, server_default="[]"),
            sa.Column("target_journal_ids_json", sa.Text(), nullable=False, server_default="[]"),
            sa.Column("error_message", sa.Text(), nullable=True),
            sa.Column("dismissed_at", sa.DateTime(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("started_at", sa.DateTime(), nullable=True),
            sa.Column("finished_at", sa.DateTime(), nullable=True),
        )
        op.create_index("ix_firefly_sync_job_job_type", "firefly_sync_job", ["job_type"])
        op.create_index("ix_firefly_sync_job_product_id", "firefly_sync_job", ["product_id"])
        op.create_index("ix_firefly_sync_job_status", "firefly_sync_job", ["status"])
        op.create_index("ix_firefly_sync_job_dismissed_at", "firefly_sync_job", ["dismissed_at"])
        op.create_index("ix_firefly_sync_job_created_at", "firefly_sync_job", ["created_at"])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "firefly_sync_job" in set(inspector.get_table_names()):
        op.drop_table("firefly_sync_job")

"""sanitize_redundant_product_tags

Revision ID: 0011_sanitize_redundant_product_tags
Revises: 0010_firefly_sync_jobs
Create Date: 2026-11-27 14:55:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0011_sanitize_redundant_product_tags"
down_revision: Union[str, None] = "0010_firefly_sync_jobs"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "tag_implication" not in tables or "producttaglink" not in tables:
        return

    imp_rows = bind.execute(
        sa.text("SELECT child_tag_id, parent_tag_id FROM tag_implication")
    ).fetchall()
    if not imp_rows:
        return

    implications: dict[int, set[int]] = {}
    for child_id, parent_id in imp_rows:
        implications.setdefault(int(child_id), set()).add(int(parent_id))

    link_rows = bind.execute(
        sa.text("SELECT product_id, tag_id FROM producttaglink")
    ).fetchall()
    by_product: dict[int, list[int]] = {}
    for product_id, tag_id in link_rows:
        if product_id is not None and tag_id is not None:
            by_product.setdefault(int(product_id), []).append(int(tag_id))

    for product_id, tag_ids in by_product.items():
        if len(tag_ids) <= 1:
            continue
        redundant_ancestors: set[int] = set()
        for tid in tag_ids:
            stack = list(implications.get(tid, ()))
            visited: set[int] = set()
            while stack:
                current = stack.pop()
                if current in visited or current == tid:
                    continue
                visited.add(current)
                redundant_ancestors.add(current)
                stack.extend(implications.get(current, ()))

        for tid in set(tag_ids):
            if tid in redundant_ancestors:
                bind.execute(
                    sa.text(
                        "DELETE FROM producttaglink "
                        "WHERE product_id = :pid AND tag_id = :tid"
                    ),
                    {"pid": product_id, "tid": tid},
                )


def downgrade() -> None:
    pass

"""cleanup_legacy_default_category

Revision ID: 0007_cleanup_legacy_default_category
Revises: 0006_add_business_types
Create Date: 2026-11-24 17:00:00.000000

"""
import json
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0007_cleanup_legacy_default_category"
down_revision: Union[str, None] = "0006_add_business_types"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if "company" in inspector.get_table_names():
        comp_cols = [c["name"] for c in inspector.get_columns("company")]
        if "default_category" in comp_cols:
            conn = bind.connection if hasattr(bind, "connection") else bind
            cursor = conn.cursor() if hasattr(conn, "cursor") else None
            if cursor:
                cursor.execute(
                    "SELECT id, default_category, business_types FROM company WHERE default_category IS NOT NULL AND default_category != ''"
                )
                rows = cursor.fetchall()
                for cid, def_cat, btypes_raw in rows:
                    btypes = []
                    if btypes_raw:
                        try:
                            parsed = json.loads(btypes_raw)
                            if isinstance(parsed, list):
                                btypes = parsed
                        except Exception:
                            pass
                    if not btypes and def_cat and def_cat.strip():
                        btypes = [def_cat.strip()]
                    cursor.execute(
                        "UPDATE company SET default_category = NULL, business_types = ? WHERE id = ?",
                        (json.dumps(btypes), cid),
                    )

    if "account_metadata" in inspector.get_table_names():
        meta_cols = [c["name"] for c in inspector.get_columns("account_metadata")]
        if "role" in meta_cols and "category" in meta_cols:
            conn = bind.connection if hasattr(bind, "connection") else bind
            cursor = conn.cursor() if hasattr(conn, "cursor") else None
            if cursor:
                cursor.execute(
                    "UPDATE account_metadata SET category = NULL WHERE role = 'chain' AND category IS NOT NULL"
                )


def downgrade() -> None:
    pass

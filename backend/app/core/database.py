import sqlite3
from sqlalchemy import event
from sqlalchemy.engine import Engine
from sqlmodel import SQLModel, create_engine, Session
from app.core.config import settings

# Handle sqlite relative path and thread checks
connect_args = {}
if settings.DATABASE_URL.startswith("sqlite"):
    connect_args = {"check_same_thread": False}

engine = create_engine(
    settings.DATABASE_URL,
    echo=False,
    connect_args=connect_args
)


def configure_sqlite_pragmas(target_engine, foreign_keys: bool = True):
    @event.listens_for(target_engine, "connect")
    def _set_sqlite_pragma(dbapi_connection, connection_record):
        if isinstance(dbapi_connection, sqlite3.Connection):
            cursor = dbapi_connection.cursor()
            if foreign_keys:
                cursor.execute("PRAGMA foreign_keys = ON")
            else:
                cursor.execute("PRAGMA foreign_keys = OFF")
            cursor.execute("PRAGMA journal_mode = WAL")
            cursor.execute("PRAGMA busy_timeout = 5000")
            cursor.close()


configure_sqlite_pragmas(engine, foreign_keys=True)


def auto_migrate_sqlite_columns(target_engine=engine):
    """Ensure newly added columns exist in existing SQLite tables and clean up legacy category data."""
    if not str(target_engine.url).startswith("sqlite"):
        return
    import json
    with target_engine.connect() as conn:
        cursor = conn.connection.cursor()
        try:
            cursor.execute("PRAGMA table_info(company)")
            comp_cols = [row[1] for row in cursor.fetchall()]
            if comp_cols and "business_types" not in comp_cols:
                cursor.execute("ALTER TABLE company ADD COLUMN business_types TEXT DEFAULT '[]'")

            cursor.execute("PRAGMA table_info(account_metadata)")
            meta_cols = [row[1] for row in cursor.fetchall()]
            if meta_cols and "business_types" not in meta_cols:
                cursor.execute("ALTER TABLE account_metadata ADD COLUMN business_types TEXT DEFAULT '[]'")

            # Migrate company.default_category into business_types if empty, then clear default_category
            if comp_cols and "default_category" in comp_cols:
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

            # Clear legacy category tag on chain accounts
            if meta_cols and "role" in meta_cols and "category" in meta_cols:
                cursor.execute(
                    "UPDATE account_metadata SET category = NULL WHERE role = 'chain' AND category IS NOT NULL"
                )

            conn.connection.commit()
        except Exception:
            pass
        finally:
            cursor.close()


def create_db_and_tables(target_engine=engine):
    import app.models  # noqa: F401
    SQLModel.metadata.create_all(target_engine)
    auto_migrate_sqlite_columns(target_engine)


def get_session():
    with Session(engine) as session:
        yield session

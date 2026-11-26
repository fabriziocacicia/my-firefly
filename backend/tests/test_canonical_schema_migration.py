import tempfile
import unittest
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text


class CanonicalSchemaMigrationTests(unittest.TestCase):
    def test_upgrade_0008_to_0009_backfills_product_packaging_and_creates_sync_tables(self):
        backend_dir = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = Path(tmpdir) / "test_mig.db"
            db_url = f"sqlite:///{db_path}"

            cfg = Config(str(backend_dir / "alembic.ini"))
            cfg.set_main_option("script_location", str(backend_dir / "migrations"))
            cfg.set_main_option("sqlalchemy.url", db_url)

            command.upgrade(cfg, "0008_asset_account_metadata")

            engine = create_engine(db_url)
            try:
                with engine.begin() as conn:
                    conn.execute(
                        text(
                            "INSERT INTO product (name, default_unit, package_size, created_at) "
                            "VALUES ('Spaghetti N.5', 'g', 500.0, CURRENT_TIMESTAMP)"
                        )
                    )
                    conn.execute(
                        text(
                            "INSERT INTO tag (name, \"group\", created_at) "
                            "VALUES ('Bio', 'Attribute', CURRENT_TIMESTAMP)"
                        )
                    )

                command.upgrade(cfg, "head")

                inspector = inspect(engine)
                tables = set(inspector.get_table_names())
                self.assertIn("tag_implication", tables)
                self.assertIn("item_firefly_alias", tables)
                self.assertIn("firefly_synced_split", tables)
                self.assertIn("firefly_sync_state", tables)

                with engine.connect() as conn:
                    row = conn.execute(
                        text(
                            "SELECT sale_mode, pack_count, unit_size, package_size, firefly_category_name "
                            "FROM product WHERE name = 'Spaghetti N.5'"
                        )
                    ).fetchone()
                    self.assertIsNotNone(row)
                    self.assertEqual(row[0], "packaged")
                    self.assertEqual(row[1], 1)
                    self.assertEqual(row[2], 500.0)
                    self.assertEqual(row[3], 500.0)
                    self.assertIsNone(row[4])
            finally:
                engine.dispose()

    def test_upgrade_0009_to_0010_creates_firefly_sync_job_table(self):
        backend_dir = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = Path(tmpdir) / "test_mig_0010.db"
            db_url = f"sqlite:///{db_path}"

            cfg = Config(str(backend_dir / "alembic.ini"))
            cfg.set_main_option("script_location", str(backend_dir / "migrations"))
            cfg.set_main_option("sqlalchemy.url", db_url)

            command.upgrade(cfg, "0009_canonical_items_and_firefly_sync")
            command.upgrade(cfg, "0010_firefly_sync_jobs")

            engine = create_engine(db_url)
            try:
                inspector = inspect(engine)
                tables = set(inspector.get_table_names())
                self.assertIn("firefly_sync_job", tables)
                cols = {c["name"] for c in inspector.get_columns("firefly_sync_job")}
                self.assertTrue(
                    {
                        "id",
                        "job_type",
                        "product_id",
                        "product_name",
                        "status",
                        "total_transactions",
                        "processed_transactions",
                        "updated_transactions",
                        "total_splits",
                        "linked_splits",
                        "updated_splits",
                        "failed_count",
                        "failed_transactions_json",
                        "target_journal_ids_json",
                        "error_message",
                        "dismissed_at",
                        "created_at",
                        "started_at",
                        "finished_at",
                    }.issubset(cols)
                )
            finally:
                engine.dispose()


if __name__ == "__main__":
    unittest.main()

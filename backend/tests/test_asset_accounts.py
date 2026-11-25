import tempfile
import unittest
from pathlib import Path

import sqlalchemy as sa
from alembic import command
from alembic.config import Config
from sqlmodel import Session, SQLModel, create_engine, select

from app.main import run_db_migrations
from app.models.asset_account import (
    AssetAccountMetadata,
    AssetAccountType,
)
from app.services.vouchers import (
    compute_voucher_balance_status,
    max_vouchers_for_total,
)


class VoucherMathTests(unittest.TestCase):
    def test_exact_multiple_avoiding_float_drift(self):
        status = compute_voucher_balance_status(51.60, 5.16)
        self.assertEqual(status.usable_vouchers, 10)
        self.assertTrue(status.is_exact_multiple)
        self.assertEqual(status.remainder_cents, 0)
        self.assertEqual(status.balance_discrepancy, 0.0)

    def test_non_multiple_balance_reports_discrepancy(self):
        status = compute_voucher_balance_status(50.00, 5.16)
        self.assertEqual(status.usable_vouchers, 9)
        self.assertFalse(status.is_exact_multiple)
        self.assertEqual(status.remainder_cents, 356)
        self.assertAlmostEqual(status.balance_discrepancy, 3.56, places=2)

    def test_zero_balance_is_exact_multiple_with_zero_vouchers(self):
        status = compute_voucher_balance_status(0.0, 5.16)
        self.assertEqual(status.usable_vouchers, 0)
        self.assertTrue(status.is_exact_multiple)
        self.assertEqual(status.balance_discrepancy, 0.0)

    def test_negative_balance_warns_and_returns_zero_usable(self):
        status = compute_voucher_balance_status(-5.16, 5.16)
        self.assertEqual(status.usable_vouchers, 0)
        self.assertFalse(status.is_exact_multiple)
        self.assertAlmostEqual(status.balance_discrepancy, -5.16, places=2)

    def test_max_vouchers_for_total_has_no_hardcoded_eight_cap(self):
        self.assertEqual(max_vouchers_for_total(100.00, 5.16, 12), 12)
        self.assertEqual(max_vouchers_for_total(25.80, 5.16, 10), 5)
        self.assertEqual(max_vouchers_for_total(9.00, 5.16, 10), 1)
        self.assertEqual(max_vouchers_for_total(5.00, 5.16, 10), 0)
        self.assertEqual(max_vouchers_for_total(20.00, 5.16, 0), 0)


class AssetAccountModelTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:", echo=False)
        SQLModel.metadata.create_all(self.engine)

    def tearDown(self):
        SQLModel.metadata.drop_all(self.engine)

    def test_create_meal_voucher_asset_metadata(self):
        with Session(self.engine) as session:
            meta = AssetAccountMetadata(
                firefly_account_id=7,
                asset_type=AssetAccountType.MEAL_VOUCHER,
                voucher_unit_value=5.16,
                default_revenue_account_id=42,
                default_recharge_description="Monthly Buoni Pasto",
                notes="Edenred card",
            )
            session.add(meta)
            session.commit()
            session.refresh(meta)

            self.assertEqual(meta.firefly_account_id, 7)
            self.assertEqual(meta.asset_type, AssetAccountType.MEAL_VOUCHER)
            self.assertAlmostEqual(meta.voucher_unit_value, 5.16, places=2)
            self.assertEqual(meta.default_revenue_account_id, 42)
            self.assertEqual(meta.default_recharge_description, "Monthly Buoni Pasto")

    def test_raw_sqlite_asset_type_deserialization_and_fallback(self):
        with self.engine.connect() as conn:
            conn.execute(
                sa.text(
                    """
                    INSERT INTO asset_account_metadata
                        (firefly_account_id, asset_type, voucher_unit_value, created_at, updated_at)
                    VALUES
                        (1, 'meal_voucher', 8.00, '2026-01-01 00:00:00', '2026-01-01 00:00:00'),
                        (2, 'MEAL_VOUCHER', 5.16, '2026-01-01 00:00:00', '2026-01-01 00:00:00'),
                        (3, 'standard', NULL, '2026-01-01 00:00:00', '2026-01-01 00:00:00'),
                        (4, 'future_type', NULL, '2026-01-01 00:00:00', '2026-01-01 00:00:00')
                    """
                )
            )
            conn.commit()

        with Session(self.engine) as session:
            rows = session.exec(select(AssetAccountMetadata)).all()
            row_map = {r.firefly_account_id: r for r in rows}

            self.assertEqual(row_map[1].asset_type, AssetAccountType.MEAL_VOUCHER)
            self.assertEqual(row_map[2].asset_type, AssetAccountType.MEAL_VOUCHER)
            self.assertEqual(row_map[3].asset_type, AssetAccountType.STANDARD)
            self.assertEqual(row_map[4].asset_type, AssetAccountType.STANDARD)

    def test_alembic_upgrade_0008_creates_asset_account_metadata(self):
        with tempfile.NamedTemporaryFile(suffix=".db") as tmp:
            tmp_db_url = f"sqlite:///{tmp.name}"
            tmp_engine = create_engine(tmp_db_url)
            backend_dir = Path(__file__).resolve().parents[1]
            alembic_cfg = Config(str(backend_dir / "alembic.ini"))
            alembic_cfg.set_main_option("script_location", str(backend_dir / "migrations"))
            alembic_cfg.set_main_option("sqlalchemy.url", tmp_db_url)

            command.upgrade(alembic_cfg, "0007_cleanup_legacy_default_category")
            run_db_migrations(tmp_engine)

            inspector = sa.inspect(tmp_engine)
            self.assertIn("asset_account_metadata", inspector.get_table_names())

            with Session(tmp_engine) as session:
                meta = AssetAccountMetadata(
                    firefly_account_id=99,
                    asset_type=AssetAccountType.MEAL_VOUCHER,
                    voucher_unit_value=7.00,
                )
                session.add(meta)
                session.commit()
                session.refresh(meta)
                self.assertEqual(meta.asset_type, AssetAccountType.MEAL_VOUCHER)
                self.assertAlmostEqual(meta.voucher_unit_value, 7.00, places=2)


if __name__ == "__main__":
    unittest.main()

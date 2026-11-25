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


class AssetAccountsApiTests(unittest.TestCase):
    def setUp(self):
        from fastapi.testclient import TestClient
        from sqlalchemy.pool import StaticPool
        from app.core.database import get_session
        from app.main import app

        self.engine = create_engine(
            "sqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        SQLModel.metadata.create_all(self.engine)

        def override_get_session():
            with Session(self.engine) as session:
                yield session

        app.dependency_overrides[get_session] = override_get_session
        self.app = app
        self.client = TestClient(app)

    def tearDown(self):
        self.app.dependency_overrides.clear()
        SQLModel.metadata.drop_all(self.engine)

    def test_put_asset_account_metadata_validation_and_persistence(self):
        # Reject meal_voucher without positive unit value
        bad_res = self.client.put(
            "/api/v1/asset-accounts/10/metadata",
            json={"asset_type": "meal_voucher", "voucher_unit_value": 0},
        )
        self.assertEqual(bad_res.status_code, 422)

        # Configure valid meal voucher account
        ok_res = self.client.put(
            "/api/v1/asset-accounts/10/metadata",
            json={
                "asset_type": "meal_voucher",
                "voucher_unit_value": 5.16,
                "default_revenue_account_id": 40,
                "default_recharge_description": "Employer Top-up",
            },
        )
        self.assertEqual(ok_res.status_code, 200)
        body = ok_res.json()
        self.assertEqual(body["asset_type"], "meal_voucher")
        self.assertAlmostEqual(body["voucher_unit_value"], 5.16, places=2)
        self.assertEqual(body["default_revenue_account_id"], 40)

        # Updating employer revenue account later works cleanly
        upd_res = self.client.put(
            "/api/v1/asset-accounts/10/metadata",
            json={
                "asset_type": "meal_voucher",
                "voucher_unit_value": 8.00,
                "default_revenue_account_id": 41,
            },
        )
        self.assertEqual(upd_res.status_code, 200)
        self.assertEqual(upd_res.json()["default_revenue_account_id"], 41)

        # Switching back to standard clears voucher config
        std_res = self.client.put(
            "/api/v1/asset-accounts/10/metadata",
            json={"asset_type": "standard"},
        )
        self.assertEqual(std_res.status_code, 200)
        self.assertEqual(std_res.json()["asset_type"], "standard")
        self.assertIsNone(std_res.json()["voucher_unit_value"])
        self.assertIsNone(std_res.json()["default_revenue_account_id"])

    def test_list_asset_and_revenue_accounts_hydrated_with_voucher_status(self):
        from unittest.mock import AsyncMock, patch

        self.client.put(
            "/api/v1/asset-accounts/10/metadata",
            json={
                "asset_type": "meal_voucher",
                "voucher_unit_value": 5.16,
                "default_revenue_account_id": 40,
            },
        )
        self.client.put(
            "/api/v1/asset-accounts/11/metadata",
            json={
                "asset_type": "meal_voucher",
                "voucher_unit_value": 5.16,
            },
        )

        mock_assets = [
            {"id": "10", "attributes": {"name": "Edenred", "current_balance": "51.60", "active": True, "currency_code": "EUR"}},
            {"id": "11", "attributes": {"name": "Ticket Rest", "current_balance": "50.00", "active": True, "currency_code": "EUR"}},
            {"id": "12", "attributes": {"name": "Checking", "current_balance": "1200.00", "active": True, "currency_code": "EUR"}},
        ]
        mock_revs = [
            {"id": "40", "attributes": {"name": "Acme Corp", "active": True}},
            {"id": "41", "attributes": {"name": "Old Employer", "active": False}},
        ]

        with patch("app.api.v1.firefly.firefly_client.get_all_asset_accounts", new=AsyncMock(return_value=mock_assets)), \
             patch("app.api.v1.firefly.firefly_client.get_all_revenue_accounts", new=AsyncMock(return_value=mock_revs)):
            res = self.client.get("/api/v1/firefly/asset-accounts")
            self.assertEqual(res.status_code, 200)
            items = {item["id"]: item for item in res.json()}

            self.assertEqual(items[10]["usable_vouchers"], 10)
            self.assertTrue(items[10]["is_exact_multiple"])
            self.assertEqual(items[10]["default_revenue_account_name"], "Acme Corp")

            self.assertEqual(items[11]["usable_vouchers"], 9)
            self.assertFalse(items[11]["is_exact_multiple"])
            self.assertAlmostEqual(items[11]["balance_discrepancy"], 3.56, places=2)

            self.assertEqual(items[12]["asset_type"], "standard")
            self.assertIsNone(items[12]["usable_vouchers"])

            rev_res = self.client.get("/api/v1/firefly/revenue-accounts")
            self.assertEqual(rev_res.status_code, 200)
            self.assertEqual(rev_res.json(), [{"id": 40, "name": "Acme Corp"}])

    def test_recharge_meal_vouchers_success_and_guards(self):
        from unittest.mock import AsyncMock, patch

        # Unconfigured account fails
        res_unconf = self.client.post(
            "/api/v1/asset-accounts/10/recharge",
            json={"count": 5, "recharge_date": "2026-11-25", "recharge_time": "09:30:00"},
        )
        self.assertEqual(res_unconf.status_code, 400)

        # Configure without default revenue account -> missing revenue account fails
        self.client.put(
            "/api/v1/asset-accounts/10/metadata",
            json={"asset_type": "meal_voucher", "voucher_unit_value": 5.16},
        )
        res_no_rev = self.client.post(
            "/api/v1/asset-accounts/10/recharge",
            json={"count": 5, "recharge_date": "2026-11-25", "recharge_time": "09:30:00"},
        )
        self.assertEqual(res_no_rev.status_code, 400)

        # Configure default revenue account and test deposit
        self.client.put(
            "/api/v1/asset-accounts/10/metadata",
            json={
                "asset_type": "meal_voucher",
                "voucher_unit_value": 5.16,
                "default_revenue_account_id": 40,
                "default_recharge_description": "Ticket Restaurant",
            },
        )

        mock_get_acc = AsyncMock(
            side_effect=[
                {"id": "10", "attributes": {"name": "Edenred", "type": "asset", "active": True, "current_balance": "51.60"}},
                {"id": "40", "attributes": {"name": "Acme Corp", "type": "revenue", "active": True}},
                {"id": "10", "attributes": {"name": "Edenred", "type": "asset", "active": True, "current_balance": "103.20"}},
            ]
        )
        mock_deposit = AsyncMock(return_value={"data": {"id": "888"}})

        with patch("app.api.v1.asset_accounts.firefly_client.get_account_by_id", new=mock_get_acc), \
             patch("app.api.v1.asset_accounts.firefly_client.create_voucher_recharge_deposit", new=mock_deposit):
            res = self.client.post(
                "/api/v1/asset-accounts/10/recharge",
                json={"count": 10, "recharge_date": "2026-11-25", "recharge_time": "09:30:00"},
            )
            self.assertEqual(res.status_code, 200)
            data = res.json()
            self.assertEqual(data["firefly_transaction_id"], 888)
            self.assertAlmostEqual(data["amount"], 51.60, places=2)
            self.assertEqual(data["count"], 10)
            self.assertEqual(data["usable_vouchers"], 20)
            self.assertTrue(data["is_exact_multiple"])
            mock_deposit.assert_awaited_once()
            kwargs = mock_deposit.call_args.kwargs
            self.assertEqual(kwargs["revenue_account_id"], 40)
            self.assertEqual(kwargs["description"], "10 x Ticket Restaurant Meal Vouchers")
            self.assertEqual(kwargs["category_name"], "Income: Benefits")
            self.assertEqual(kwargs["tags"], ["Meal Voucher"])


if __name__ == "__main__":
    unittest.main()

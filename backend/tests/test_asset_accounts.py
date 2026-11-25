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

    def test_decimal_precision_avoids_binary_float_rounding_trap(self):
        from app.services.vouchers import to_cents

        self.assertEqual(to_cents(1.005), 101)
        with self.assertRaises(ValueError):
            to_cents(float("nan"))

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
                        (4, 'future_type', NULL, '2026-01-01 00:00:00', '2026-01-01 00:00:00'),
                        (5, 'bank_account', NULL, '2026-01-01 00:00:00', '2026-01-01 00:00:00'),
                        (6, 'CASH', NULL, '2026-01-01 00:00:00', '2026-01-01 00:00:00'),
                        (7, 'digital_credit', NULL, '2026-01-01 00:00:00', '2026-01-01 00:00:00'),
                        (8, 'investment_account', NULL, '2026-01-01 00:00:00', '2026-01-01 00:00:00')
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
            self.assertEqual(row_map[5].asset_type, AssetAccountType.BANK_ACCOUNT)
            self.assertEqual(row_map[6].asset_type, AssetAccountType.CASH)
            self.assertEqual(row_map[7].asset_type, AssetAccountType.DIGITAL_CREDIT)
            self.assertEqual(row_map[8].asset_type, AssetAccountType.INVESTMENT_ACCOUNT)

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
        # Default GET returns standard fallback
        get_default = self.client.get("/api/v1/asset-accounts/10/metadata")
        self.assertEqual(get_default.status_code, 200)
        self.assertEqual(get_default.json()["asset_type"], "standard")

        # Reject meal_voucher without positive unit value
        bad_res = self.client.put(
            "/api/v1/asset-accounts/10/metadata",
            json={"asset_type": "meal_voucher", "voucher_unit_value": 0},
        )
        self.assertEqual(bad_res.status_code, 422)

        # Configure valid meal voucher account with notes
        ok_res = self.client.put(
            "/api/v1/asset-accounts/10/metadata",
            json={
                "asset_type": "meal_voucher",
                "voucher_unit_value": 5.16,
                "default_revenue_account_id": 40,
                "default_recharge_description": "Employer Top-up",
                "notes": "Initial note",
            },
        )
        self.assertEqual(ok_res.status_code, 200)
        body = ok_res.json()
        self.assertEqual(body["asset_type"], "meal_voucher")
        self.assertAlmostEqual(body["voucher_unit_value"], 5.16, places=2)
        self.assertEqual(body["default_revenue_account_id"], 40)
        self.assertEqual(body["notes"], "Initial note")

        # Clearing notes with null must erase persisted notes
        clear_notes_res = self.client.put(
            "/api/v1/asset-accounts/10/metadata",
            json={
                "asset_type": "meal_voucher",
                "voucher_unit_value": 5.16,
                "default_revenue_account_id": 40,
                "notes": None,
            },
        )
        self.assertEqual(clear_notes_res.status_code, 200)
        self.assertIsNone(clear_notes_res.json()["notes"])

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

    def test_configure_bank_cash_and_digital_credit_types_and_guards(self):
        from unittest.mock import AsyncMock, patch

        # Seed as meal_voucher first, then switch to digital_credit and verify voucher fields clear
        self.client.put(
            "/api/v1/asset-accounts/20/metadata",
            json={
                "asset_type": "meal_voucher",
                "voucher_unit_value": 5.16,
                "default_revenue_account_id": 40,
                "default_recharge_description": "Edenred",
            },
        )

        for account_id, asset_type, note in [
            (20, "digital_credit", "Amazon balance"),
            (21, "bank_account", "Main checking"),
            (22, "cash", "Physical wallet"),
            (23, "investment_account", "ETF portfolio"),
        ]:
            res = self.client.put(
                f"/api/v1/asset-accounts/{account_id}/metadata",
                json={"asset_type": asset_type, "notes": note},
            )
            self.assertEqual(res.status_code, 200)
            body = res.json()
            self.assertEqual(body["asset_type"], asset_type)
            self.assertEqual(body["notes"], note)
            self.assertIsNone(body["voucher_unit_value"])
            self.assertIsNone(body["default_revenue_account_id"])
            self.assertIsNone(body["default_recharge_description"])

            recharge_res = self.client.post(
                f"/api/v1/asset-accounts/{account_id}/recharge",
                json={"count": 1, "recharge_date": "2026-11-25", "recharge_time": "10:00:00"},
            )
            self.assertEqual(recharge_res.status_code, 400)

        mock_assets = [
            {"id": "20", "attributes": {"name": "Amazon", "current_balance": "50.00", "active": True, "currency_code": "EUR", "include_net_worth": False}},
            {"id": "21", "attributes": {"name": "Checking", "current_balance": "1200.00", "active": True, "currency_code": "EUR", "include_net_worth": True}},
            {"id": "22", "attributes": {"name": "Cash Wallet", "current_balance": "45.00", "active": True, "currency_code": "EUR"}},
            {"id": "23", "attributes": {"name": "Trade Republic", "current_balance": "2416.15", "active": True, "currency_code": "EUR", "include_net_worth": True}},
        ]
        with patch("app.api.v1.firefly.firefly_client.get_all_asset_accounts", new=AsyncMock(return_value=mock_assets)):
            list_res = self.client.get("/api/v1/firefly/asset-accounts")
            self.assertEqual(list_res.status_code, 200)
            items = {item["id"]: item for item in list_res.json()}
            self.assertEqual(items[20]["asset_type"], "digital_credit")
            self.assertIsNone(items[20]["usable_vouchers"])
            self.assertFalse(items[20]["include_net_worth"])
            self.assertEqual(items[21]["asset_type"], "bank_account")
            self.assertIsNone(items[21]["usable_vouchers"])
            self.assertTrue(items[21]["include_net_worth"])
            self.assertEqual(items[22]["asset_type"], "cash")
            self.assertIsNone(items[22]["usable_vouchers"])
            self.assertTrue(items[22]["include_net_worth"])
            self.assertEqual(items[23]["asset_type"], "investment_account")
            self.assertIsNone(items[23]["usable_vouchers"])
            self.assertTrue(items[23]["include_net_worth"])

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

    def test_recharge_error_paths_override_and_fallback_balance(self):
        from unittest.mock import AsyncMock, patch
        import httpx

        self.client.put(
            "/api/v1/asset-accounts/10/metadata",
            json={
                "asset_type": "meal_voucher",
                "voucher_unit_value": 5.16,
                "default_revenue_account_id": 40,
            },
        )

        # Non-positive revenue_account_id rejected with 422 (no silent fallback)
        bad_rev = self.client.post(
            "/api/v1/asset-accounts/10/recharge",
            json={
                "count": 5,
                "recharge_date": "2026-11-25",
                "recharge_time": "09:30:00",
                "revenue_account_id": 0,
            },
        )
        self.assertEqual(bad_rev.status_code, 422)

        # 404 when asset account missing in Firefly
        with patch(
            "app.api.v1.asset_accounts.firefly_client.get_account_by_id",
            new=AsyncMock(side_effect=[None, {"id": "40", "attributes": {"active": True}}]),
        ):
            r404 = self.client.post(
                "/api/v1/asset-accounts/10/recharge",
                json={"count": 5, "recharge_date": "2026-11-25", "recharge_time": "09:30:00"},
            )
            self.assertEqual(r404.status_code, 404)

        # 400 when revenue account is inactive
        with patch(
            "app.api.v1.asset_accounts.firefly_client.get_account_by_id",
            new=AsyncMock(
                side_effect=[
                    {"id": "10", "attributes": {"active": True, "current_balance": "0"}},
                    {"id": "99", "attributes": {"active": False}},
                ]
            ),
        ):
            r400 = self.client.post(
                "/api/v1/asset-accounts/10/recharge",
                json={
                    "count": 5,
                    "recharge_date": "2026-11-25",
                    "recharge_time": "09:30:00",
                    "revenue_account_id": 99,
                },
            )
            self.assertEqual(r400.status_code, 400)

        # 502 when Firefly deposit call fails
        with (
            patch(
                "app.api.v1.asset_accounts.firefly_client.get_account_by_id",
                new=AsyncMock(
                    side_effect=[
                        {"id": "10", "attributes": {"active": True, "current_balance": "10.32"}},
                        {"id": "40", "attributes": {"active": True}},
                    ]
                ),
            ),
            patch(
                "app.api.v1.asset_accounts.firefly_client.create_voucher_recharge_deposit",
                new=AsyncMock(side_effect=httpx.ConnectError("Connection refused")),
            ),
        ):
            r502 = self.client.post(
                "/api/v1/asset-accounts/10/recharge",
                json={"count": 5, "recharge_date": "2026-11-25", "recharge_time": "09:30:00"},
            )
            self.assertEqual(r502.status_code, 502)

        # Override revenue account + fallback balance when post-deposit refresh fails
        with (
            patch(
                "app.api.v1.asset_accounts.firefly_client.get_account_by_id",
                new=AsyncMock(
                    side_effect=[
                        {"id": "10", "attributes": {"active": True, "current_balance": "10.32"}},
                        {"id": "55", "attributes": {"active": True}},
                        httpx.ConnectError("Timeout on post-refresh"),
                    ]
                ),
            ),
            patch(
                "app.api.v1.asset_accounts.firefly_client.create_voucher_recharge_deposit",
                new=AsyncMock(return_value={"data": {"id": "999"}}),
            ) as mock_dep,
        ):
            ok_fallback = self.client.post(
                "/api/v1/asset-accounts/10/recharge",
                json={
                    "count": 2,
                    "recharge_date": "2026-11-25",
                    "recharge_time": "10:00:00",
                    "revenue_account_id": 55,
                },
            )
            self.assertEqual(ok_fallback.status_code, 200)
            body = ok_fallback.json()
            self.assertEqual(body["revenue_account_id"], 55)
            self.assertEqual(body["current_balance"], "20.64")
            self.assertEqual(body["usable_vouchers"], 4)
            self.assertEqual(mock_dep.call_args.kwargs["description"], "2 x Meal Vouchers")


if __name__ == "__main__":
    unittest.main()

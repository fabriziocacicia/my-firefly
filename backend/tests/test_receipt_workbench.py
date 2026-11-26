import os
import tempfile
import unittest
from datetime import date
from io import BytesIO
from pathlib import Path
from unittest.mock import AsyncMock, patch

import alembic.config
import httpx
import pillow_heif
from alembic import command
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import create_engine, inspect, pool, text
from sqlmodel import Session, SQLModel

from app.api.v1.receipts import (
    _allocate_weighted_cents,
    _expand_billable_split_units,
    _partition_split_units_for_vouchers,
)
from app.core.config import settings
from app.core.database import get_session
from app.main import app, run_db_migrations
from app.models.company import Company, CompanyAccountLink
from app.models.product import Brand, Product
from app.models.receipt import Receipt, ReceiptItem
from app.services.pricing import compute_deal_analysis, normalize_unit_price

pillow_heif.register_heif_opener()


class PricingAndSplitMathTests(unittest.TestCase):
    def test_pricing_normalization_pcs_and_median(self):
        self.assertEqual(normalize_unit_price(3.00, 1.0, "pcs", 6.0), 0.5)
        self.assertEqual(normalize_unit_price(6.00, 2.0, "pcs", 6.0), 0.5)
        self.assertEqual(normalize_unit_price(1.49, 1.0, "g", 500.0), 2.98)
        self.assertIsNone(normalize_unit_price(0.0, 1.0, "pcs", 1.0))

        # Even-length regular price list must average the two middle values (median)
        analysis = compute_deal_analysis(
            current_price=1.80,
            regular_price=2.00,
            history_prices=[1.80, 2.50],
            history_regular_prices=[2.00, 3.00],
            normalized_current_price=3.60,
            normalized_prices=[3.60, 5.00],
            normalized_regular_prices=[4.00, 6.00],
        )
        self.assertEqual(analysis["baseline_regular_price"], 2.5)
        self.assertEqual(analysis["normalized_baseline_regular_price"], 5.0)
        self.assertEqual(analysis["deal_rating"], "ALL_TIME_LOW")

    def test_allocate_receipt_cents_floor_and_discount(self):
        items = [
            ReceiptItem(
                receipt_id=1, product_id=1, quantity=1, unit="pcs",
                package_size=1, paid_price=10.00, regular_price=10.00, line_total=10.00,
            ),
            ReceiptItem(
                receipt_id=1, product_id=2, quantity=1, unit="pcs",
                package_size=1, paid_price=0.05, regular_price=0.05, line_total=0.05,
            ),
        ]
        units = _expand_billable_split_units(items)
        allocated = _allocate_weighted_cents([w for _, w, _ in units], 105)
        self.assertEqual(sum(allocated), 105)
        self.assertTrue(all(c >= 1 for c in allocated))

    def test_sequential_boundary_partitioning_crossover_and_exact(self):
        items = [
            ReceiptItem(
                id=1, receipt_id=1, product_id=1, quantity=1, unit="pcs",
                package_size=1, paid_price=6.00, line_total=6.00,
            ),
            ReceiptItem(
                id=2, receipt_id=1, product_id=2, quantity=1, unit="pcs",
                package_size=1, paid_price=8.00, line_total=8.00,
            ),
            ReceiptItem(
                id=3, receipt_id=1, product_id=3, quantity=1, unit="pcs",
                package_size=1, paid_price=4.00, line_total=4.00,
            ),
        ]
        units = [(i, w, "") for i, w in zip(items, [600, 800, 400])]
        allocated = [600, 800, 400]

        # Crossover case: voucher covers 10.32 -> item 2 splits 4.32 + 3.68
        v_splits, c_splits = _partition_split_units_for_vouchers(units, allocated, 1032)
        self.assertEqual(sum(c for _, c, _ in v_splits), 1032)
        self.assertEqual(sum(c for _, c, _ in c_splits), 768)
        self.assertEqual(v_splits[-1][0].product_id, 2)
        self.assertIn("[Voucher]", v_splits[-1][2])
        self.assertEqual(c_splits[0][0].product_id, 2)
        self.assertIn("[Card Remainder]", c_splits[0][2])

        # Exact boundary case: voucher covers 14.00 -> item 2 stays whole on voucher, no €0.00 split on card
        v_exact, c_exact = _partition_split_units_for_vouchers(units, allocated, 1400)
        self.assertEqual([i.product_id for i, _, _ in v_exact], [1, 2])
        self.assertEqual([i.product_id for i, _, _ in c_exact], [3])
        self.assertEqual(v_exact[-1][2], "")
        self.assertEqual(c_exact[0][2], "")


class ReceiptsApiAndMigrationTests(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.tmpdir.name) / "test_companion.db"
        self.storage_dir = Path(self.tmpdir.name) / "receipts"
        self.storage_dir.mkdir(parents=True, exist_ok=True)
        self.orig_storage_dir = settings.STORAGE_DIR
        settings.STORAGE_DIR = str(self.storage_dir)

        self.engine = create_engine(
            f"sqlite:///{self.db_path}",
            connect_args={"check_same_thread": False},
        )
        run_db_migrations(self.engine)

        def override_get_session():
            with Session(self.engine) as session:
                yield session

        app.dependency_overrides[get_session] = override_get_session
        self.client = TestClient(app)

        with Session(self.engine, expire_on_commit=False) as session:
            company = Company(name="Conad")
            session.add(company)
            session.commit()

            link = CompanyAccountLink(firefly_account_id=101, company_id=company.id)
            brand = Brand(name="De Cecco")
            session.add(link)
            session.add(brand)
            session.commit()

            pasta = Product(
                name="Penne Rigate N.41",
                brand_id=brand.id,
                default_unit="g",
                package_size=500.0,
            )
            bags = Product(
                name="Bio Carrier Bag",
                default_unit="pcs",
                package_size=1.0,
            )
            promo_sample = Product(
                name="Promo Sample",
                default_unit="pcs",
                package_size=1.0,
            )
            session.add_all([pasta, bags, promo_sample])
            session.commit()

            self.company_id = company.id
            self.active_account_id = 101
            self.inactive_account_id = 102
            self.pasta_id = pasta.id
            self.bags_id = bags.id
            self.promo_sample_id = promo_sample.id

        # Setup standard FireflyClient mocks
        async def mock_get_acc(aid: int):
            if aid == 101:
                return {
                    "id": "101",
                    "attributes": {"name": "Conad Via Roma", "active": True},
                }
            if aid == 102:
                return {
                    "id": "102",
                    "attributes": {"name": "Inactive Store", "active": False},
                }
            return None

        async def mock_resolve_names(aids: set[int]):
            mapping = {
                101: "Conad Via Roma",
                102: "Inactive Store",
                99: "Lidl North",
            }
            return {aid: mapping.get(aid, f"Account #{aid}") for aid in aids}

        patcher_receipts_get = patch(
            "app.api.v1.receipts.firefly_client.get_expense_account",
            side_effect=mock_get_acc,
        )
        patcher_receipts_res = patch(
            "app.api.v1.receipts.firefly_client.resolve_expense_account_names",
            side_effect=mock_resolve_names,
        )
        patcher_prices_get = patch(
            "app.api.v1.prices.firefly_client.get_expense_account",
            side_effect=mock_get_acc,
        )
        patcher_prices_res = patch(
            "app.api.v1.prices.firefly_client.resolve_expense_account_names",
            side_effect=mock_resolve_names,
        )
        patcher_comp_get = patch(
            "app.api.v1.companies.firefly_client.get_expense_account",
            side_effect=mock_get_acc,
        )

        patcher_receipts_get.start()
        patcher_receipts_res.start()
        patcher_prices_get.start()
        patcher_prices_res.start()
        patcher_comp_get.start()

        self.addCleanup(patcher_receipts_get.stop)
        self.addCleanup(patcher_receipts_res.stop)
        self.addCleanup(patcher_prices_get.stop)
        self.addCleanup(patcher_prices_res.stop)
        self.addCleanup(patcher_comp_get.stop)

    def tearDown(self):
        app.dependency_overrides.clear()
        settings.STORAGE_DIR = self.orig_storage_dir
        self.engine.dispose()
        self.tmpdir.cleanup()

    def test_create_receipt_price_history_and_freebie(self):
        empty_hist = self.client.get(f"/api/v1/prices/history/{self.pasta_id}")
        self.assertEqual(empty_hist.status_code, 200)
        empty_body = empty_hist.json()
        self.assertEqual(empty_body["default_unit"], "g")
        self.assertIsNone(empty_body["analysis"])
        self.assertEqual(empty_body["records"], [])

        payload = {
            "firefly_account_id": self.active_account_id,
            "purchase_date": "2026-11-10",
            "basket_discount": 0.50,
            "source_account_id": 1,
            "payment_mode": "single",
            "items": [
                {
                    "product_id": self.pasta_id,
                    "quantity": 2,
                    "unit": "g",
                    "package_size": 500,
                    "paid_price": 1.85,
                    "regular_price": 2.10,
                    "is_discount": True,
                },
                {
                    "product_id": self.promo_sample_id,
                    "quantity": 1,
                    "unit": "pcs",
                    "package_size": 1,
                    "paid_price": 0.0,
                    "regular_price": 1.0,
                    "is_discount": True,
                },
            ],
        }
        res = self.client.post("/api/v1/receipts/", json=payload)
        self.assertEqual(res.status_code, 200, res.text)
        created = res.json()
        self.assertEqual(created["total_amount"], 3.20)
        self.assertEqual(created["basket_discount"], 0.50)
        self.assertEqual(len(created["items"]), 2)
        self.assertEqual(created["store_name"], "Conad Via Roma")

        hist = self.client.get(f"/api/v1/prices/history/{self.pasta_id}")
        self.assertEqual(hist.status_code, 200)
        hist_body = hist.json()
        self.assertEqual(len(hist_body["records"]), 1)
        self.assertEqual(hist_body["records"][0]["store_name"], "Conad Via Roma")
        self.assertEqual(hist_body["analysis"]["normalized_current_price"], 3.7)
        self.assertEqual(hist_body["analysis"]["normalized_baseline_regular_price"], 4.2)

    def test_create_receipt_computes_total_and_rejects_invalid_totals(self):
        # Reject receipts whose computed total (items - basket_discount) is <= 0
        for discount in (2.00, 5.00):
            non_positive_res = self.client.post(
                "/api/v1/receipts/",
                json={
                    "firefly_account_id": self.active_account_id,
                    "purchase_date": "2026-11-10",
                    "basket_discount": discount,
                    "source_account_id": 1,
                    "payment_mode": "single",
                    "items": [
                        {
                            "product_id": self.pasta_id,
                            "quantity": 1,
                            "unit": "g",
                            "package_size": 500,
                            "paid_price": 2.00,
                        }
                    ],
                },
            )
            self.assertEqual(non_positive_res.status_code, 422)

        # Client-supplied total_amount is ignored in favor of server-computed total
        tampered_res = self.client.post(
            "/api/v1/receipts/",
            json={
                "firefly_account_id": self.active_account_id,
                "purchase_date": "2026-11-10",
                "total_amount": 999.99,
                "source_account_id": 1,
                "payment_mode": "single",
                "items": [
                    {
                        "product_id": self.pasta_id,
                        "quantity": 1,
                        "unit": "g",
                        "package_size": 500,
                        "paid_price": 2.00,
                    }
                ],
            },
        )
        self.assertEqual(tampered_res.status_code, 200, tampered_res.text)
        self.assertEqual(tampered_res.json()["total_amount"], 2.00)

        # Non-finite item float is rejected
        inf_res = self.client.post(
            "/api/v1/receipts/",
            json={
                "firefly_account_id": self.active_account_id,
                "purchase_date": "2026-11-10",
                "source_account_id": 1,
                "payment_mode": "single",
                "items": [
                    {
                        "product_id": self.pasta_id,
                        "quantity": 1,
                        "unit": "g",
                        "package_size": 500,
                        "paid_price": "inf",
                    }
                ],
            },
        )
        self.assertEqual(inf_res.status_code, 422)

    def test_attachment_security_and_heif_to_jpeg(self):
        receipt_res = self.client.post(
            "/api/v1/receipts/",
            json={
                "firefly_account_id": self.active_account_id,
                "purchase_date": "2026-11-10",
                "source_account_id": 1,
                "payment_mode": "single",
                "items": [
                    {
                        "product_id": self.pasta_id,
                        "quantity": 1,
                        "unit": "g",
                        "package_size": 500,
                        "paid_price": 2.00,
                    }
                ],
            },
        )
        receipt_id = receipt_res.json()["id"]

        # Reject spoofed file extension
        spoofed = self.client.post(
            f"/api/v1/receipts/{receipt_id}/attachments",
            files={"file": ("fake.jpg", b"not an image at all", "image/jpeg")},
        )
        self.assertEqual(spoofed.status_code, 415)

        # Reject > 15MB
        oversized = self.client.post(
            f"/api/v1/receipts/{receipt_id}/attachments",
            files={"file": ("huge.jpg", b"x" * (15 * 1024 * 1024 + 10), "image/jpeg")},
        )
        self.assertEqual(oversized.status_code, 413)

        # Real HEIF/HEIC upload -> converted to RGB JPEG
        heif_buf = BytesIO()
        Image.new("RGB", (24, 16), color=(20, 120, 220)).save(heif_buf, format="HEIF")
        heif_res = self.client.post(
            f"/api/v1/receipts/{receipt_id}/attachments",
            files={"file": ("IMG_1234.heic", heif_buf.getvalue(), "image/heic")},
        )
        self.assertEqual(heif_res.status_code, 200, heif_res.text)
        att = heif_res.json()
        self.assertEqual(att["file_type"], "image/jpeg")
        self.assertTrue(att["stored_path"].endswith(".jpg"))
        saved_file = self.storage_dir / att["stored_path"]
        self.assertTrue(saved_file.exists())
        self.assertEqual(saved_file.read_bytes()[:3], b"\xff\xd8\xff")

        # Stream inline
        stream_res = self.client.get(
            f"/api/v1/receipts/{receipt_id}/attachments/{att['id']}"
        )
        self.assertEqual(stream_res.status_code, 200)
        self.assertEqual(stream_res.headers["content-type"], "image/jpeg")

    def test_push_to_firefly_guards_rollback_and_partial_recovery(self):
        # 1. Inactive account blocked on creation
        inactive_res = self.client.post(
            "/api/v1/receipts/",
            json={
                "firefly_account_id": self.inactive_account_id,
                "purchase_date": "2026-11-10",
                "source_account_id": 1,
                "items": [{"product_id": self.pasta_id, "paid_price": 2.00}],
            },
        )
        self.assertEqual(inactive_res.status_code, 400)

        # 2. Split vouchers with €0 freebie + rollback compensation & recovery
        split_res = self.client.post(
            "/api/v1/receipts/",
            json={
                "firefly_account_id": self.active_account_id,
                "purchase_date": "2026-11-10",
                "source_account_id": 1,
                "payment_mode": "split_vouchers",
                "voucher_account_id": 2,
                "voucher_count": 2,
                "voucher_unit_value": 5.16,
                "items": [
                    {"product_id": self.pasta_id, "quantity": 1, "paid_price": 6.00},
                    {"product_id": self.bags_id, "quantity": 1, "paid_price": 9.00},
                    {"product_id": self.promo_sample_id, "quantity": 1, "paid_price": 0.00},
                ],
            },
        )
        receipt_id = split_res.json()["id"]

        asset_accounts_mock = AsyncMock(return_value=[{"id": "1"}, {"id": "2"}])

        # Scenario A: Tx1 succeeds, Tx2 fails, rollback succeeds
        with (
            patch("app.api.v1.receipts.firefly_client.get_all_asset_accounts", asset_accounts_mock),
            patch(
                "app.api.v1.receipts.firefly_client.create_transaction",
                AsyncMock(
                    side_effect=[
                        {"data": {"id": "901"}},
                        httpx.ConnectError("Firefly timeout on Tx2"),
                    ]
                ),
            ),
            patch(
                "app.api.v1.receipts.firefly_client.delete_transaction",
                AsyncMock(return_value=None),
            ) as mock_del,
        ):
            fail_res = self.client.post(f"/api/v1/receipts/{receipt_id}/push-to-firefly")
            self.assertEqual(fail_res.status_code, 502)
            mock_del.assert_awaited_once_with(901)

        rec_after_rollback = self.client.get(f"/api/v1/receipts/{receipt_id}").json()
        self.assertIsNone(rec_after_rollback["firefly_voucher_transaction_id"])
        self.assertIsNone(rec_after_rollback["firefly_transaction_id"])

        # Scenario B: Tx1 succeeds, Tx2 fails, rollback ALSO fails -> retained for force=true recovery
        with (
            patch("app.api.v1.receipts.firefly_client.get_all_asset_accounts", asset_accounts_mock),
            patch(
                "app.api.v1.receipts.firefly_client.create_transaction",
                AsyncMock(
                    side_effect=[
                        {"data": {"id": "902"}},
                        httpx.ConnectError("Firefly timeout on Tx2"),
                    ]
                ),
            ),
            patch(
                "app.api.v1.receipts.firefly_client.delete_transaction",
                AsyncMock(side_effect=httpx.ConnectError("Delete failed")),
            ),
        ):
            partial_fail = self.client.post(f"/api/v1/receipts/{receipt_id}/push-to-firefly")
            self.assertEqual(partial_fail.status_code, 502)

        # Without force -> 409 Conflict
        conflict = self.client.post(f"/api/v1/receipts/{receipt_id}/push-to-firefly")
        self.assertEqual(conflict.status_code, 409)

        # Resume with force=True -> only Tx2 created, group_title formatted with account name
        create_mock = AsyncMock(return_value={"data": {"id": "903"}})
        with (
            patch("app.api.v1.receipts.firefly_client.get_all_asset_accounts", asset_accounts_mock),
            patch("app.api.v1.receipts.firefly_client.create_transaction", create_mock),
        ):
            recovered = self.client.post(
                f"/api/v1/receipts/{receipt_id}/push-to-firefly",
                json={"force": True},
            )
            self.assertEqual(recovered.status_code, 200, recovered.text)
            create_mock.assert_awaited_once()
            call_payload = create_mock.await_args.args[0]
            self.assertEqual(
                call_payload["group_title"], "Conad Via Roma - 2026-11-10"
            )
            sent_splits = call_payload["transactions"]
            self.assertEqual(len(sent_splits), 1)
            self.assertEqual(sent_splits[0]["amount"], "4.68")

        rec_final = recovered.json()
        self.assertEqual(rec_final["firefly_voucher_transaction_id"], 902)
        self.assertEqual(rec_final["firefly_transaction_id"], 903)

    def test_receipt_purchase_time_custom_and_fallback(self):
        # 1. Explicit purchase_time is saved and sent to Firefly
        res = self.client.post(
            "/api/v1/receipts/",
            json={
                "firefly_account_id": self.active_account_id,
                "purchase_date": "2026-11-15",
                "purchase_time": "09:30:00",
                "source_account_id": 1,
                "payment_mode": "single",
                "items": [{"product_id": self.pasta_id, "paid_price": 2.00}],
            },
        )
        self.assertEqual(res.status_code, 200, res.text)
        data = res.json()
        self.assertEqual(data["purchase_time"], "09:30:00")
        receipt_id = data["id"]

        create_mock = AsyncMock(return_value={"data": {"id": "1001"}})
        asset_mock = AsyncMock(return_value=[{"id": "1"}])
        with (
            patch("app.api.v1.receipts.firefly_client.get_all_asset_accounts", asset_mock),
            patch("app.api.v1.receipts.firefly_client.create_transaction", create_mock),
        ):
            push_res = self.client.post(f"/api/v1/receipts/{receipt_id}/push-to-firefly")
            self.assertEqual(push_res.status_code, 200, push_res.text)
            create_mock.assert_awaited_once()
            call_payload = create_mock.await_args.args[0]
            self.assertEqual(call_payload["transactions"][0]["date"], "2026-11-15T09:30:00")

        # 2. Null purchase_time falls back to 12:00:00
        with Session(self.engine) as session:
            rec = session.get(Receipt, receipt_id)
            rec.purchase_time = None
            rec.firefly_transaction_id = None
            session.add(rec)
            session.commit()

        create_mock2 = AsyncMock(return_value={"data": {"id": "1002"}})
        with (
            patch("app.api.v1.receipts.firefly_client.get_all_asset_accounts", asset_mock),
            patch("app.api.v1.receipts.firefly_client.create_transaction", create_mock2),
        ):
            push_res2 = self.client.post(f"/api/v1/receipts/{receipt_id}/push-to-firefly")
            self.assertEqual(push_res2.status_code, 200, push_res2.text)
            call_payload2 = create_mock2.await_args.args[0]
            self.assertEqual(call_payload2["transactions"][0]["date"], "2026-11-15T12:00:00")

    def test_meal_voucher_full_payment_no_source_account_required(self):
        self.client.put(
            "/api/v1/asset-accounts/2/metadata",
            json={"asset_type": "meal_voucher", "voucher_unit_value": 5.16},
        )
        # Client sends tampered unit value 9.99 and source_account_id=None (100% voucher payment)
        res = self.client.post(
            "/api/v1/receipts/",
            json={
                "firefly_account_id": self.active_account_id,
                "purchase_date": "2026-11-25",
                "source_account_id": None,
                "payment_mode": "split_vouchers",
                "voucher_account_id": 2,
                "voucher_count": 2,
                "voucher_unit_value": 9.99,
                "items": [{"product_id": self.pasta_id, "paid_price": 10.32}],
            },
        )
        self.assertEqual(res.status_code, 200, res.text)
        body = res.json()
        self.assertAlmostEqual(body["voucher_unit_value"], 5.16, places=2)
        self.assertIsNone(body["source_account_id"])

        receipt_id = body["id"]
        asset_mock = AsyncMock(
            return_value=[{"id": "2", "attributes": {"name": "Edenred", "current_balance": "15.48"}}]
        )
        create_mock = AsyncMock(return_value={"data": {"id": "2001"}})
        with (
            patch("app.api.v1.receipts.firefly_client.get_all_asset_accounts", asset_mock),
            patch("app.api.v1.receipts.firefly_client.create_transaction", create_mock),
        ):
            push_res = self.client.post(f"/api/v1/receipts/{receipt_id}/push-to-firefly")
            self.assertEqual(push_res.status_code, 200, push_res.text)
            pushed = push_res.json()
            self.assertEqual(pushed["firefly_voucher_transaction_id"], 2001)
            self.assertIsNone(pushed["firefly_transaction_id"])
            create_mock.assert_awaited_once()
            tx = create_mock.await_args.args[0]["transactions"][0]
            self.assertEqual(tx["amount"], "10.32")
            self.assertEqual(tx["source_id"], "2")

    def test_meal_voucher_over_total_and_insufficient_balance_rejected(self):
        self.client.put(
            "/api/v1/asset-accounts/2/metadata",
            json={"asset_type": "meal_voucher", "voucher_unit_value": 5.16},
        )
        # 1. Voucher face value (10.32) > receipt total (9.00) -> 422 on create
        over_res = self.client.post(
            "/api/v1/receipts/",
            json={
                "firefly_account_id": self.active_account_id,
                "purchase_date": "2026-11-25",
                "source_account_id": 1,
                "payment_mode": "split_vouchers",
                "voucher_account_id": 2,
                "voucher_count": 2,
                "voucher_unit_value": 5.16,
                "items": [{"product_id": self.pasta_id, "paid_price": 9.00}],
            },
        )
        self.assertEqual(over_res.status_code, 422)

        # 2. Valid create (2 x 5.16 = 10.32 <= 15.00), but live Firefly balance only has 1 usable voucher
        ok_res = self.client.post(
            "/api/v1/receipts/",
            json={
                "firefly_account_id": self.active_account_id,
                "purchase_date": "2026-11-25",
                "source_account_id": 1,
                "payment_mode": "split_vouchers",
                "voucher_account_id": 2,
                "voucher_count": 2,
                "voucher_unit_value": 5.16,
                "items": [{"product_id": self.pasta_id, "paid_price": 15.00}],
            },
        )
        self.assertEqual(ok_res.status_code, 200, ok_res.text)
        receipt_id = ok_res.json()["id"]

        asset_mock = AsyncMock(
            return_value=[
                {"id": "1", "attributes": {"current_balance": "100.00"}},
                {"id": "2", "attributes": {"current_balance": "5.16"}},
            ]
        )
        with patch("app.api.v1.receipts.firefly_client.get_all_asset_accounts", asset_mock):
            push_res = self.client.post(f"/api/v1/receipts/{receipt_id}/push-to-firefly")
            self.assertEqual(push_res.status_code, 422)

    def test_meal_voucher_more_than_eight_vouchers_and_snapshot_immutability(self):
        self.client.put(
            "/api/v1/asset-accounts/2/metadata",
            json={"asset_type": "meal_voucher", "voucher_unit_value": 5.16},
        )
        # 1. Create and push receipt with 9 vouchers (46.44 vouchers + 3.56 card = 50.00)
        res = self.client.post(
            "/api/v1/receipts/",
            json={
                "firefly_account_id": self.active_account_id,
                "purchase_date": "2026-11-25",
                "source_account_id": 1,
                "payment_mode": "split_vouchers",
                "voucher_account_id": 2,
                "voucher_count": 9,
                "voucher_unit_value": 5.16,
                "items": [{"product_id": self.pasta_id, "paid_price": 50.00}],
            },
        )
        self.assertEqual(res.status_code, 200, res.text)
        receipt_id = res.json()["id"]

        # Simulate employer raising unit value to 8.00 AFTER receipt was created,
        # and Tx1 succeeding then Tx2 failing so partial recovery must preserve 5.16 snapshot!
        self.client.put(
            "/api/v1/asset-accounts/2/metadata",
            json={"asset_type": "meal_voucher", "voucher_unit_value": 8.00},
        )
        asset_mock = AsyncMock(
            return_value=[
                {"id": "1", "attributes": {"current_balance": "100.00"}},
                {"id": "2", "attributes": {"current_balance": "51.60"}},
            ]
        )
        with (
            patch("app.api.v1.receipts.firefly_client.get_all_asset_accounts", asset_mock),
            patch(
                "app.api.v1.receipts.firefly_client.create_transaction",
                AsyncMock(
                    side_effect=[
                        {"data": {"id": "3001"}},
                        httpx.ConnectError("Tx2 timeout"),
                    ]
                ),
            ),
            patch(
                "app.api.v1.receipts.firefly_client.delete_transaction",
                AsyncMock(side_effect=httpx.ConnectError("Delete failed")),
            ),
        ):
            partial = self.client.post(f"/api/v1/receipts/{receipt_id}/push-to-firefly")
            self.assertEqual(partial.status_code, 502)

        # Resume with force=True: Tx2 must still use 50.00 - (9 * 5.16) = 3.56, NOT 8.00!
        resume_create = AsyncMock(return_value={"data": {"id": "3002"}})
        with (
            patch("app.api.v1.receipts.firefly_client.get_all_asset_accounts", asset_mock),
            patch("app.api.v1.receipts.firefly_client.create_transaction", resume_create),
        ):
            resumed = self.client.post(
                f"/api/v1/receipts/{receipt_id}/push-to-firefly",
                json={"force": True},
            )
            self.assertEqual(resumed.status_code, 200, resumed.text)
            body = resumed.json()
            self.assertAlmostEqual(body["voucher_unit_value"], 5.16, places=2)
            sent_tx2 = resume_create.await_args.args[0]["transactions"][0]
            self.assertEqual(sent_tx2["amount"], "3.56")

    def test_company_crud_and_account_linking(self):
        # 1. Create company
        res = self.client.post("/api/v1/companies/", json={"name": "Esselunga"})
        self.assertEqual(res.status_code, 201)
        comp_id = res.json()["id"]

        # Duplicate rejection (case-insensitive)
        dup = self.client.post("/api/v1/companies/", json={"name": "  esselunga  "})
        self.assertEqual(dup.status_code, 400)

        # 2. Patch company
        patch_res = self.client.patch(
            f"/api/v1/companies/{comp_id}",
            json={"name": "Esselunga Superstore", "default_category": "Groceries"},
        )
        self.assertEqual(patch_res.status_code, 200)
        self.assertEqual(patch_res.json()["name"], "Esselunga Superstore")

        # 3. Assign account to company
        assign_res = self.client.put(
            "/api/v1/companies/accounts/101/company",
            json={"company_id": comp_id},
        )
        self.assertEqual(assign_res.status_code, 200)
        self.assertEqual(assign_res.json()["company_id"], comp_id)

        # Validation: mutual exclusion (both company_id and company_name) -> 422
        mutual_res = self.client.put(
            "/api/v1/companies/accounts/101/company",
            json={"company_id": comp_id, "company_name": "Another Company"},
        )
        self.assertEqual(mutual_res.status_code, 422)

        # Validation: whitespace-only company_name -> 422
        ws_res = self.client.put(
            "/api/v1/companies/accounts/101/company",
            json={"company_name": "   "},
        )
        self.assertEqual(ws_res.status_code, 422)

        # Verify count on GET /companies/
        comps = self.client.get("/api/v1/companies/").json()
        target = next((c for c in comps if c["id"] == comp_id), None)
        self.assertIsNotNone(target)
        self.assertEqual(target["store_count"], 1)

        # 4. Unlink account (even if account is deleted from Firefly -> succeeds without 404)
        unlink_res = self.client.put(
            "/api/v1/companies/accounts/101/company",
            json={"company_id": None, "company_name": None},
        )
        self.assertEqual(unlink_res.status_code, 204)

        # 5. Delete company
        del_res = self.client.delete(f"/api/v1/companies/{comp_id}")
        self.assertEqual(del_res.status_code, 204)

    def test_company_assignment_and_price_recording_firefly_502(self):
        with patch(
            "app.api.v1.companies.firefly_client.get_expense_account",
            AsyncMock(side_effect=httpx.ConnectError("Firefly unreachable")),
        ):
            res = self.client.put(
                "/api/v1/companies/accounts/101/company",
                json={"company_name": "New Co"},
            )
            self.assertEqual(res.status_code, 502)

        with patch(
            "app.api.v1.prices.firefly_client.get_expense_account",
            AsyncMock(side_effect=httpx.ConnectError("Firefly unreachable")),
        ):
            res = self.client.post(
                "/api/v1/prices/",
                json={
                    "product_id": self.pasta_id,
                    "firefly_account_id": self.active_account_id,
                    "recorded_date": "2026-11-20",
                    "paid_price": 1.50,
                    "regular_price": 1.50,
                },
            )
            self.assertEqual(res.status_code, 502)

    def test_firefly_search_and_directory_endpoints(self):
        with (
            patch(
                "app.api.v1.firefly.firefly_client.search_expense_accounts",
                AsyncMock(
                    return_value=[
                        {"id": "102", "attributes": {"name": "Penny Market", "active": True}},
                        {"id": "103", "attributes": {"name": "Conad Closed", "active": False}},
                        {"id": "101", "attributes": {"name": "Conad Via Roma", "active": True}},
                    ]
                ),
            ),
            patch(
                "app.api.v1.firefly.firefly_client.get_all_expense_accounts",
                AsyncMock(
                    return_value=[
                        {"id": "101", "attributes": {"name": "Conad Via Roma", "active": True}},
                        {"id": "102", "attributes": {"name": "Penny Market", "active": True}},
                    ]
                ),
            ),
        ):
            # Autocomplete search filters out inactive and sorts alphabetically
            search_res = self.client.get(
                "/api/v1/firefly/expense-accounts/search?query=Conad"
            )
            self.assertEqual(search_res.status_code, 200)
            items = search_res.json()
            self.assertEqual(len(items), 2)  # Inactive id 103 filtered out
            self.assertEqual(items[0]["name"], "Conad Via Roma")
            self.assertEqual(items[1]["name"], "Penny Market")

            # Autocomplete with empty query returns empty list without upstream sweeps
            empty_res = self.client.get(
                "/api/v1/firefly/expense-accounts/search?query="
            )
            self.assertEqual(empty_res.status_code, 200)
            empty_items = empty_res.json()
            self.assertEqual(len(empty_items), 0)

            # Full directory
            list_res = self.client.get("/api/v1/firefly/expense-accounts")
            self.assertEqual(list_res.status_code, 200)
            accounts = list_res.json()
            self.assertEqual(len(accounts), 2)
            conad = next(a for a in accounts if a["id"] == 101)
            self.assertEqual(conad["company_name"], "Conad")


class LegacyDatabaseMigrationTests(unittest.TestCase):
    def test_pre_workbench_db_upgrades_non_destructively(self):
        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "legacy.db"
            legacy_engine = create_engine(
                f"sqlite:///{db_path}", poolclass=pool.NullPool
            )

            backend_dir = Path(__file__).resolve().parents[1]
            cfg = alembic.config.Config(str(backend_dir / "alembic.ini"))
            cfg.set_main_option("script_location", str(backend_dir / "migrations"))
            cfg.set_main_option(
                "sqlalchemy.url", legacy_engine.url.render_as_string(hide_password=False)
            )
            # Create baseline schema (0001) and remove alembic_version to simulate pre-Alembic DB
            command.upgrade(cfg, "0001_pre_workbench_baseline")
            with legacy_engine.begin() as conn:
                conn.execute(text("DROP TABLE alembic_version"))
                conn.execute(
                    text(
                        "INSERT INTO company (id, name, created_at) VALUES (1, 'Lidl', '2026-01-01 00:00:00')"
                    )
                )
                conn.execute(
                    text(
                        "INSERT INTO store (id, name, company_id, firefly_account_id, created_at) VALUES (1, 'Lidl North', 1, 99, '2026-01-01 00:00:00')"
                    )
                )
                conn.execute(
                    text(
                        "INSERT INTO product (id, name, default_unit, package_size, created_at) VALUES (1, 'Milk', 'l', 1.0, '2026-01-01 00:00:00')"
                    )
                )
                conn.execute(
                    text(
                        "INSERT INTO receipt (id, store_id, purchase_date, total_amount, created_at) VALUES (1, 1, '2026-01-02', 1.50, '2026-01-02 00:00:00')"
                    )
                )
                conn.execute(
                    text(
                        "INSERT INTO receiptitem (id, receipt_id, product_id, quantity, unit, regular_price, paid_price, is_discount, line_total) "
                        "VALUES (1, 1, 1, 1.0, 'l', 1.50, 1.50, 0, 1.50)"
                    )
                )

            run_db_migrations(legacy_engine)

            insp = inspect(legacy_engine)
            self.assertTrue(insp.has_table("alembic_version"))
            self.assertTrue(insp.has_table("companyaccountlink"))
            self.assertFalse(insp.has_table("store"))
            receipt_cols = {c["name"] for c in insp.get_columns("receipt")}
            self.assertIn("firefly_account_id", receipt_cols)
            self.assertNotIn("store_id", receipt_cols)
            self.assertIn("basket_discount", receipt_cols)
            self.assertIn("firefly_voucher_transaction_id", receipt_cols)
            self.assertIn("purchase_time", receipt_cols)
            item_cols = {c["name"]: c for c in insp.get_columns("receiptitem")}
            self.assertTrue(item_cols["regular_price"]["nullable"])
            self.assertIn("package_size", item_cols)

            with Session(legacy_engine) as s:
                row = s.get(Receipt, 1)
                self.assertIsNotNone(row)
                self.assertEqual(row.total_amount, 1.50)
                self.assertEqual(row.firefly_account_id, 99)
                self.assertEqual(row.payment_mode, "single")
                self.assertEqual(row.basket_discount, 0.0)
                self.assertIsNone(row.purchase_time)

            legacy_engine.dispose()


if __name__ == "__main__":
    unittest.main()

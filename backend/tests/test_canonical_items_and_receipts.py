import unittest
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, Session

from app.core.database import configure_sqlite_pragmas, get_session
from app.main import app
from app.models.product import Product
from app.models.tag import Tag, TagImplication
from app.services.pricing import normalize_unit_price


class CanonicalItemsAndReceiptsTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        configure_sqlite_pragmas(self.engine, foreign_keys=True)
        SQLModel.metadata.create_all(self.engine)

        def override_get_session():
            with Session(self.engine) as session:
                yield session

        app.dependency_overrides[get_session] = override_get_session
        self.client = TestClient(app)

        with Session(self.engine) as session:
            t_food = Tag(name="Alimentari", firefly_tag_id=1)
            t_fruit = Tag(name="Frutta", firefly_tag_id=2)
            t_apples = Tag(name="Mele", firefly_tag_id=3)
            t_bio = Tag(name="Bio", firefly_tag_id=4)
            t_pasta = Tag(name="Pasta", firefly_tag_id=5)
            session.add_all([t_food, t_fruit, t_apples, t_bio, t_pasta])
            session.commit()
            for t in (t_food, t_fruit, t_apples, t_bio, t_pasta):
                session.refresh(t)
            session.add_all(
                [
                    TagImplication(child_tag_id=t_apples.id, parent_tag_id=t_fruit.id),
                    TagImplication(child_tag_id=t_fruit.id, parent_tag_id=t_food.id),
                    TagImplication(child_tag_id=t_pasta.id, parent_tag_id=t_food.id),
                ]
            )
            session.commit()
            self.tag_ids = {
                "Alimentari": t_food.id,
                "Frutta": t_fruit.id,
                "Mele": t_apples.id,
                "Bio": t_bio.id,
                "Pasta": t_pasta.id,
            }

    def tearDown(self):
        app.dependency_overrides.clear()
        self.engine.dispose()

    def test_create_update_and_filter_canonical_product_with_effective_tags(self):
        brand_resp = self.client.post("/api/v1/products/brands", json={"name": "MD"})
        brand_id = brand_resp.json()["id"]

        create_resp = self.client.post(
            "/api/v1/products/",
            json={
                "name": "Fusilli Integrali Bio",
                "brand_id": brand_id,
                "sale_mode": "packaged",
                "pack_count": 1,
                "unit_size": 500,
                "default_unit": "g",
                "firefly_category_id": 10,
                "firefly_category_name": "Groceries",
                "tag_ids": [self.tag_ids["Mele"], self.tag_ids["Bio"]],
            },
        )
        self.assertEqual(create_resp.status_code, 200)
        prod = create_resp.json()
        self.assertEqual(prod["sale_mode"], "packaged")
        self.assertEqual(prod["pack_count"], 1)
        self.assertEqual(prod["unit_size"], 500.0)
        self.assertEqual(prod["package_size"], 500.0)
        self.assertEqual(prod["firefly_category_name"], "Groceries")
        self.assertEqual(prod["firefly_description"], "Fusilli Integrali Bio MD 500g")
        effective_names = {t["name"] for t in prod["effective_tags"]}
        self.assertEqual(effective_names, {"Mele", "Frutta", "Alimentari", "Bio"})

        # Search also matches by brand name ("MD")
        search_brand = self.client.get("/api/v1/products/?search=MD")
        self.assertEqual(search_brand.status_code, 200)
        self.assertEqual(len(search_brand.json()), 1)

        # Filtering by implied parent tag ("Frutta") returns items tagged with "Mele"
        list_resp = self.client.get(
            f"/api/v1/products/?tag_id={self.tag_ids['Frutta']}"
        )
        self.assertEqual(list_resp.status_code, 200)
        self.assertEqual(len(list_resp.json()), 1)

        # PATCH to pieces format ("Uova Bio MD x4")
        patch_resp = self.client.patch(
            f"/api/v1/products/{prod['id']}",
            json={"name": "Uova Bio", "pack_count": 4, "unit_size": 1, "default_unit": "pcs"},
        )
        self.assertEqual(patch_resp.status_code, 200)
        updated = patch_resp.json()
        self.assertEqual(updated["name"], "Uova Bio")
        self.assertEqual(updated["package_size"], 4.0)
        self.assertEqual(updated["firefly_description"], "Uova Bio MD x4")

        # Multipack format ("Birra Moretti 6x330ml")
        multipack = self.client.post(
            "/api/v1/products/",
            json={
                "name": "Birra Moretti",
                "sale_mode": "packaged",
                "pack_count": 6,
                "unit_size": 330,
                "default_unit": "ml",
                "firefly_category_name": "Groceries",
                "tag_ids": [],
            },
        ).json()
        self.assertEqual(multipack["firefly_description"], "Birra Moretti 6x330ml")

    def test_pricing_normalization_for_multipack_and_loose_weight(self):
        # 6x330ml = 1980ml = 1.98L at €3.96 => €2.00/L
        self.assertEqual(
            normalize_unit_price(price=3.96, quantity=1.0, unit="ml", package_size=1980.0),
            2.0,
        )
        # Loose weight 0.84 kg at €2.50/kg => €2.50/kg
        self.assertEqual(
            normalize_unit_price(price=2.50, quantity=1.0, unit="kg", package_size=1.0),
            2.5,
        )

    def test_receipt_derives_item_metadata_rejects_fractional_packaged_and_supports_total_price(self):
        p_resp = self.client.post(
            "/api/v1/products/",
            json={
                "name": "Pasta Barilla Fusilli 1kg",
                "sale_mode": "packaged",
                "pack_count": 1,
                "unit_size": 1.0,
                "default_unit": "kg",
                "firefly_category_name": "Groceries",
                "tag_ids": [self.tag_ids["Pasta"]],
            },
        )
        pasta_id = p_resp.json()["id"]

        mock_expense = AsyncMock(
            return_value={"id": "50", "attributes": {"name": "Conad", "type": "expense", "active": True}}
        )
        with patch("app.api.v1.receipts.firefly_client.get_expense_account", new=mock_expense):
            bad_qty = self.client.post(
                "/api/v1/receipts/",
                json={
                    "firefly_account_id": 50,
                    "purchase_date": "2026-11-26",
                    "purchase_time": "12:00:00",
                    "items": [{"product_id": pasta_id, "quantity": 1.5, "paid_price": 1.20}],
                },
            )
            self.assertEqual(bad_qty.status_code, 422)

            # Create using total_price (3 packs for €2.00 total) and omitted unit/package_size
            good_rec = self.client.post(
                "/api/v1/receipts/",
                json={
                    "firefly_account_id": 50,
                    "purchase_date": "2026-11-26",
                    "purchase_time": "12:00:00",
                    "items": [{"product_id": pasta_id, "quantity": 3, "total_price": 2.00}],
                },
            )
            self.assertEqual(good_rec.status_code, 200)
            rec = good_rec.json()
            self.assertEqual(rec["total_amount"], 2.00)
            self.assertEqual(rec["items"][0]["unit"], "kg")
            self.assertEqual(rec["items"][0]["package_size"], 1.0)
            self.assertEqual(rec["items"][0]["line_total"], 2.00)

    def test_push_to_firefly_expands_n_packs_into_n_splits_with_category_and_expanded_tags(self):
        barilla_id = self.client.post("/api/v1/products/brands", json={"name": "Barilla"}).json()["id"]
        pasta = self.client.post(
            "/api/v1/products/",
            json={
                "name": "Fusilli",
                "brand_id": barilla_id,
                "sale_mode": "packaged",
                "pack_count": 1,
                "unit_size": 1.0,
                "default_unit": "kg",
                "firefly_category_name": "Groceries",
                "tag_ids": [self.tag_ids["Pasta"]],
            },
        ).json()

        banane = self.client.post(
            "/api/v1/products/",
            json={
                "name": "Banane Bio",
                "sale_mode": "loose_weight",
                "default_unit": "kg",
                "firefly_category_name": "Groceries",
                "tag_ids": [self.tag_ids["Mele"], self.tag_ids["Bio"]],
            },
        ).json()

        mock_expense = AsyncMock(
            return_value={"id": "50", "attributes": {"name": "Conad", "type": "expense", "active": True}}
        )
        mock_assets = AsyncMock(
            return_value=[{"id": "1", "attributes": {"name": "Intesa", "type": "asset"}}]
        )
        captured_payloads = []

        async def mock_create_tx(payload):
            captured_payloads.append(payload)
            return {"data": {"id": "999"}}

        with (
            patch("app.api.v1.receipts.firefly_client.get_expense_account", new=mock_expense),
            patch("app.api.v1.receipts.firefly_client.get_all_asset_accounts", new=mock_assets),
            patch("app.api.v1.receipts.firefly_client.create_transaction", side_effect=mock_create_tx),
        ):
            rec_resp = self.client.post(
                "/api/v1/receipts/",
                json={
                    "firefly_account_id": 50,
                    "source_account_id": 1,
                    "purchase_date": "2026-11-26",
                    "purchase_time": "12:15:00",
                    "basket_discount": 0.50,
                    "items": [
                        {"product_id": pasta["id"], "quantity": 5, "paid_price": 1.20},
                        {"product_id": banane["id"], "quantity": 0.84, "paid_price": 2.50},
                    ],
                },
            )
            self.assertEqual(rec_resp.status_code, 200)
            receipt_id = rec_resp.json()["id"]

            push_resp = self.client.post(f"/api/v1/receipts/{receipt_id}/push-to-firefly")
            self.assertEqual(push_resp.status_code, 200)

        self.assertEqual(len(captured_payloads), 1)
        splits = captured_payloads[0]["transactions"]
        # 5 packs of Pasta + 1 loose-weight Banane = 6 splits
        self.assertEqual(len(splits), 6)

        pasta_splits = [s for s in splits if s["description"] == "Fusilli Barilla 1kg"]
        self.assertEqual(len(pasta_splits), 5)
        for s in pasta_splits:
            self.assertEqual(s["category_name"], "Groceries")
            self.assertEqual(set(s["tags"]), {"Pasta", "Alimentari"})

        banane_splits = [s for s in splits if s["description"] == "Banane Bio"]
        self.assertEqual(len(banane_splits), 1)
        self.assertIn("0.84 kg", banane_splits[0]["notes"])
        self.assertEqual(set(banane_splits[0]["tags"]), {"Mele", "Frutta", "Alimentari", "Bio"})

        # Exact cent sum after basket discount: 5*1.20 + 2.10 - 0.50 = 7.60
        total_cents = sum(round(float(s["amount"]) * 100) for s in splits)
        self.assertEqual(total_cents, 760)


if __name__ == "__main__":
    unittest.main()

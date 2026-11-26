import unittest
from datetime import date

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, Session, select

from app.core.database import configure_sqlite_pragmas, get_session
from app.main import app
from app.models.firefly_cache import FireflySyncedSplit
from app.models.price import PriceRecord
from app.models.product import Product
from app.models.receipt import Receipt, ReceiptItem
from app.models.tag import ProductTagLink, Tag, TagImplication


class TagAnalyticsTests(unittest.TestCase):
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
            session.add_all([t_food, t_fruit, t_apples, t_bio])
            session.commit()
            for t in (t_food, t_fruit, t_apples, t_bio):
                session.refresh(t)
            session.add_all(
                [
                    TagImplication(child_tag_id=t_apples.id, parent_tag_id=t_fruit.id),
                    TagImplication(child_tag_id=t_fruit.id, parent_tag_id=t_food.id),
                ]
            )
            session.commit()

            p_mele_bio = Product(
                name="Mele Rosse Bio 600g",
                sale_mode="packaged",
                pack_count=1,
                unit_size=600.0,
                default_unit="g",
                package_size=600.0,
                firefly_category_name="Groceries",
            )
            p_mele_std = Product(
                name="Mele Golden 1kg",
                sale_mode="packaged",
                pack_count=1,
                unit_size=1.0,
                default_unit="kg",
                package_size=1.0,
                firefly_category_name="Groceries",
            )
            p_pasta_bio = Product(
                name="Pasta Bio 500g",
                sale_mode="packaged",
                pack_count=1,
                unit_size=500.0,
                default_unit="g",
                package_size=500.0,
                firefly_category_name="Groceries",
            )
            session.add_all([p_mele_bio, p_mele_std, p_pasta_bio])
            session.commit()
            for p in (p_mele_bio, p_mele_std, p_pasta_bio):
                session.refresh(p)

            session.add_all(
                [
                    ProductTagLink(product_id=p_mele_bio.id, tag_id=t_apples.id),
                    ProductTagLink(product_id=p_mele_bio.id, tag_id=t_bio.id),
                    ProductTagLink(product_id=p_mele_std.id, tag_id=t_apples.id),
                    ProductTagLink(product_id=p_pasta_bio.id, tag_id=t_bio.id),
                ]
            )
            session.commit()

            # 1. Companion receipt pushed to Firefly (tx 900): 2x Mele Bio = €4.80
            rec_pushed = Receipt(
                firefly_account_id=20,
                purchase_date=date(2026, 11, 20),
                total_amount=4.80,
                firefly_transaction_id=900,
            )
            session.add(rec_pushed)
            session.commit()
            session.refresh(rec_pushed)
            session.add(
                ReceiptItem(
                    receipt_id=rec_pushed.id,
                    product_id=p_mele_bio.id,
                    quantity=2,
                    unit="g",
                    package_size=600.0,
                    paid_price=2.40,
                    regular_price=2.40,
                    line_total=4.80,
                )
            )
            # Also present in FireflySyncedSplit for tx 900 -> MUST NOT double count
            session.add(
                FireflySyncedSplit(
                    transaction_journal_id=9001,
                    firefly_transaction_id=900,
                    tx_date=date(2026, 11, 20),
                    amount_cents=240,
                    description="Mele Rosse Bio 600g",
                    normalized_description="mele rosse bio 600g",
                    firefly_expense_account_id=20,
                    firefly_category_name="Groceries",
                    linked_product_id=p_mele_bio.id,
                )
            )

            # 2. Historical linked Firefly splits (not from companion receipt)
            session.add_all(
                [
                    FireflySyncedSplit(
                        transaction_journal_id=551,
                        firefly_transaction_id=55,
                        tx_date=date(2026, 11, 10),
                        amount_cents=240,
                        description="Mele Rosse Bio 600g",
                        normalized_description="mele rosse bio 600g",
                        firefly_expense_account_id=20,
                        firefly_category_name="Groceries",
                        linked_product_id=p_mele_bio.id,
                    ),
                    FireflySyncedSplit(
                        transaction_journal_id=561,
                        firefly_transaction_id=56,
                        tx_date=date(2026, 11, 12),
                        amount_cents=180,
                        description="Mele Golden 1kg",
                        normalized_description="mele golden 1kg",
                        firefly_expense_account_id=20,
                        firefly_category_name="Groceries",
                        linked_product_id=p_mele_std.id,
                    ),
                ]
            )

            # 3. Local-only receipt for Pasta Bio: €1.50
            rec_local = Receipt(
                firefly_account_id=20,
                purchase_date=date(2026, 11, 22),
                total_amount=1.50,
            )
            session.add(rec_local)
            session.commit()
            session.refresh(rec_local)
            session.add(
                ReceiptItem(
                    receipt_id=rec_local.id,
                    product_id=p_pasta_bio.id,
                    quantity=1,
                    unit="g",
                    package_size=500.0,
                    paid_price=1.50,
                    regular_price=1.50,
                    line_total=1.50,
                )
            )

            # PriceRecords for Mele Bio (€4.00/kg and €5.00/kg)
            session.add_all(
                [
                    PriceRecord(
                        product_id=p_mele_bio.id,
                        firefly_account_id=20,
                        recorded_date=date(2026, 11, 10),
                        regular_price=2.40,
                        paid_price=2.40,
                        unit="g",
                        package_size=600.0,
                        normalized_unit_price=4.0,
                        transaction_journal_id=551,
                        source_type="firefly_sync",
                    ),
                    PriceRecord(
                        product_id=p_mele_bio.id,
                        firefly_account_id=20,
                        recorded_date=date(2026, 11, 20),
                        regular_price=3.00,
                        paid_price=3.00,
                        unit="g",
                        package_size=600.0,
                        normalized_unit_price=5.0,
                        source_type="receipt",
                    ),
                ]
            )
            session.commit()

            self.tag_ids = {
                "Alimentari": t_food.id,
                "Frutta": t_fruit.id,
                "Mele": t_apples.id,
                "Bio": t_bio.id,
            }

    def tearDown(self):
        app.dependency_overrides.clear()
        self.engine.dispose()

    def test_hierarchical_single_and_multi_tag_intersections_without_double_counting(self):
        # Query Frutta -> matches Mele Rosse Bio (€4.80 + €2.40 = €7.20) + Mele Golden (€1.80) = €9.00
        fruit_resp = self.client.get(
            f"/api/v1/analytics/tags?tag_ids={self.tag_ids['Frutta']}"
        )
        self.assertEqual(fruit_resp.status_code, 200)
        fruit = fruit_resp.json()
        self.assertEqual(fruit["total_spend"], 9.0)
        self.assertEqual(fruit["matching_item_count"], 2)

        # Query Frutta + Bio -> matches ONLY Mele Rosse Bio (€7.20)
        fruit_bio_resp = self.client.get(
            f"/api/v1/analytics/tags?tag_ids={self.tag_ids['Frutta']}&tag_ids={self.tag_ids['Bio']}"
        )
        self.assertEqual(fruit_bio_resp.status_code, 200)
        fruit_bio = fruit_bio_resp.json()
        self.assertEqual(fruit_bio["total_spend"], 7.2)
        self.assertEqual(fruit_bio["matching_item_count"], 1)
        item = fruit_bio["items"][0]
        self.assertEqual(item["product_name"], "Mele Rosse Bio 600g")
        self.assertEqual(item["min_unit_price"], 4.0)
        self.assertEqual(item["latest_unit_price"], 5.0)
        self.assertEqual(item["normalized_unit_label"], "€/kg")

        # Query Bio -> matches Mele Rosse Bio (€7.20) + Pasta Bio (€1.50) = €8.70
        bio_resp = self.client.get(
            f"/api/v1/analytics/tags?tag_ids={self.tag_ids['Bio']}"
        )
        self.assertEqual(bio_resp.status_code, 200)
        self.assertEqual(bio_resp.json()["total_spend"], 8.7)

        # Date window excludes synced split on 2026-11-10, keeps 2026-11-20 receipt (€4.80) + Pasta Bio (€1.50)
        window_resp = self.client.get(
            f"/api/v1/analytics/tags?tag_ids={self.tag_ids['Bio']}&start_date=2026-11-15&category_name=Groceries"
        )
        self.assertEqual(window_resp.status_code, 200)
        self.assertEqual(window_resp.json()["total_spend"], 6.3)

        # Ignored split is excluded even if linked_product_id is set
        with Session(self.engine) as session:
            s551 = session.exec(
                select(FireflySyncedSplit).where(FireflySyncedSplit.transaction_journal_id == 551)
            ).first()
            s551.is_ignored = True
            session.add(s551)
            session.commit()
        after_ignore = self.client.get(f"/api/v1/analytics/tags?tag_ids={self.tag_ids['Bio']}")
        self.assertEqual(after_ignore.json()["total_spend"], 6.3)

        # Empty tag_ids returns all catalog items
        all_resp = self.client.get("/api/v1/analytics/tags")
        self.assertEqual(all_resp.status_code, 200)
        self.assertEqual(all_resp.json()["matching_item_count"], 3)


if __name__ == "__main__":
    unittest.main()

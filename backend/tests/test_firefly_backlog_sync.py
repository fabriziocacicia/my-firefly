import unittest
from datetime import date, datetime, timezone
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, Session, select

from app.core.database import configure_sqlite_pragmas, get_session
from app.main import app
from app.models.firefly_cache import FireflySyncState, FireflySyncedSplit
from app.models.price import PriceRecord
from app.models.product import ItemFireflyAlias, Product
from app.models.tag import ProductTagLink, Tag, TagImplication


class FireflyBacklogSyncTests(unittest.TestCase):
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
            t_fruit = Tag(name="Frutta", firefly_tag_id=10)
            t_apples = Tag(name="Mele", firefly_tag_id=11)
            t_bio = Tag(name="Bio", firefly_tag_id=12)
            session.add_all([t_fruit, t_apples, t_bio])
            session.commit()
            for t in (t_fruit, t_apples, t_bio):
                session.refresh(t)
            session.add(TagImplication(child_tag_id=t_apples.id, parent_tag_id=t_fruit.id))
            session.commit()

            prod = Product(
                name="Mele Rosse Bio 600g",
                sale_mode="packaged",
                pack_count=1,
                unit_size=600.0,
                default_unit="g",
                package_size=600.0,
                firefly_category_id=1,
                firefly_category_name="Groceries",
            )
            session.add(prod)
            session.commit()
            session.refresh(prod)
            session.add_all(
                [
                    ProductTagLink(product_id=prod.id, tag_id=t_apples.id),
                    ProductTagLink(product_id=prod.id, tag_id=t_bio.id),
                ]
            )
            session.commit()
            self.product_id = prod.id
            self.tag_ids = {"Frutta": t_fruit.id, "Mele": t_apples.id, "Bio": t_bio.id}

    def tearDown(self):
        app.dependency_overrides.clear()
        self.engine.dispose()

    def test_full_and_incremental_sync_with_cooldown_and_backlog_counts(self):
        mock_txs = [
            {
                "id": "55",
                "attributes": {
                    "transactions": [
                        {
                            "transaction_journal_id": "551",
                            "type": "withdrawal",
                            "date": "2026-11-20T10:00:00+00:00",
                            "amount": "2.40",
                            "description": "mele rosse bioo 600g",
                            "destination_id": "20",
                            "destination_name": "Conad",
                            "category_name": "Groceries",
                            "tags": ["Mele"],
                        },
                        {
                            "transaction_journal_id": "552",
                            "type": "withdrawal",
                            "date": "2026-11-20T10:00:00+00:00",
                            "amount": "1.50",
                            "description": "Latte Intero 1L",
                            "destination_id": "20",
                            "destination_name": "Conad",
                            "category_name": "Groceries",
                            "tags": [],
                        },
                    ]
                },
            },
            {
                "id": "56",
                "attributes": {
                    "transactions": [
                        {
                            "transaction_journal_id": "561",
                            "type": "withdrawal",
                            "date": "2026-11-22T12:00:00+00:00",
                            "amount": "2.40",
                            "description": "mele rosse bioo 600g",
                            "destination_id": "21",
                            "destination_name": "Lidl",
                            "category_name": "Groceries",
                            "tags": [],
                        },
                        {
                            "transaction_journal_id": "562",
                            "type": "withdrawal",
                            "date": "2026-11-22T12:00:00+00:00",
                            "amount": "800.00",
                            "description": "Affitto Novembre",
                            "destination_id": "30",
                            "destination_name": "Landlord",
                            "category_name": None,
                            "tags": [],
                        },
                    ]
                },
            },
        ]

        # Incremental before initial full sync reports requires_full_sync
        inc_before = self.client.post("/api/v1/firefly-sync/transactions?mode=incremental")
        self.assertEqual(inc_before.status_code, 200)
        self.assertEqual(inc_before.json()["status"], "requires_full_sync")

        with patch(
            "app.api.v1.firefly_sync.firefly_client.get_all_transactions",
            new=AsyncMock(return_value=mock_txs),
        ):
            full_resp = self.client.post("/api/v1/firefly-sync/transactions?mode=full")

        self.assertEqual(full_resp.status_code, 200)
        self.assertEqual(full_resp.json()["status"], "synced")
        self.assertEqual(full_resp.json()["splits_upserted"], 4)

        # Immediate incremental call hits 60s cooldown without querying Firefly
        inc_cooldown = self.client.post("/api/v1/firefly-sync/transactions?mode=incremental")
        self.assertEqual(inc_cooldown.status_code, 200)
        self.assertEqual(inc_cooldown.json()["status"], "skipped_cooldown")

        # Backlog returns category counts & grouped occurrences
        backlog_resp = self.client.get("/api/v1/firefly-sync/backlog")
        self.assertEqual(backlog_resp.status_code, 200)
        backlog = backlog_resp.json()
        self.assertEqual(backlog["total_unassociated"], 4)
        cat_counts = {c["category_name"]: c["count"] for c in backlog["category_counts"]}
        self.assertEqual(cat_counts["Groceries"], 3)
        self.assertEqual(cat_counts[None], 1)

        # Filter by Groceries
        groceries_resp = self.client.get("/api/v1/firefly-sync/backlog?category=Groceries")
        groups = groceries_resp.json()["groups"]
        self.assertEqual(len(groups), 2)
        self.assertEqual(groups[0]["sample_description"], "mele rosse bioo 600g")
        self.assertEqual(groups[0]["occurrence_count"], 2)
        self.assertEqual(groups[0]["total_amount"], 4.8)

        # Ignore rent transaction
        ignore_resp = self.client.post(
            "/api/v1/firefly-sync/backlog/ignore",
            json={"transaction_journal_ids": [562], "ignored": True},
        )
        self.assertEqual(ignore_resp.status_code, 200)
        after_ignore = self.client.get("/api/v1/firefly-sync/backlog").json()
        self.assertEqual(after_ignore["total_unassociated"], 3)
        self.assertEqual(after_ignore["ignored_count"], 1)

    def test_link_backlog_safely_preserves_sibling_splits_and_upserts_price_records(self):
        with Session(self.engine) as session:
            session.add_all(
                [
                    FireflySyncedSplit(
                        transaction_journal_id=551,
                        firefly_transaction_id=55,
                        tx_type="withdrawal",
                        tx_date=date(2026, 11, 20),
                        amount_cents=240,
                        description="mele rosse bioo 600g",
                        normalized_description="mele rosse bioo 600g",
                        firefly_expense_account_id=20,
                        firefly_expense_account_name="Conad",
                        firefly_category_name="Groceries",
                        tags_json="[]",
                    ),
                    FireflySyncedSplit(
                        transaction_journal_id=552,
                        firefly_transaction_id=55,
                        tx_type="withdrawal",
                        tx_date=date(2026, 11, 20),
                        amount_cents=150,
                        description="Latte Intero 1L",
                        normalized_description="latte intero 1l",
                        firefly_expense_account_id=20,
                        firefly_expense_account_name="Conad",
                        firefly_category_name="Groceries",
                        tags_json="[]",
                    ),
                ]
            )
            session.commit()

        captured_puts = []

        async def mock_get_tx(tx_id):
            return {
                "id": str(tx_id),
                "attributes": {
                    "transactions": [
                        {"transaction_journal_id": "551", "description": "mele rosse bioo 600g"},
                        {"transaction_journal_id": "552", "description": "Latte Intero 1L"},
                    ]
                },
            }

        async def mock_put_tx(tx_id, payload):
            captured_puts.append((tx_id, payload))
            return {"data": {"id": str(tx_id)}}

        with (
            patch("app.api.v1.firefly_sync.firefly_client.get_transaction_by_id", side_effect=mock_get_tx),
            patch("app.api.v1.firefly_sync.firefly_client.update_transaction", side_effect=mock_put_tx),
        ):
            link_resp = self.client.post(
                "/api/v1/firefly-sync/backlog/link",
                json={
                    "product_id": self.product_id,
                    "transaction_journal_ids": [551],
                },
            )

        self.assertEqual(link_resp.status_code, 200)
        body = link_resp.json()
        self.assertEqual(body["linked_splits"], 1)
        self.assertEqual(body["updated_transactions"], 1)
        self.assertEqual(body["failed_transactions"], [])

        # Verify PUT payload preserved sibling split 552 and updated split 551
        self.assertEqual(len(captured_puts), 1)
        tx_id, put_payload = captured_puts[0]
        self.assertEqual(tx_id, 55)
        self.assertEqual(put_payload["apply_rules"], False)
        self.assertEqual(put_payload["fire_webhooks"], False)
        tx_splits = put_payload["transactions"]
        self.assertEqual(len(tx_splits), 2)
        by_jid = {s["transaction_journal_id"]: s for s in tx_splits}
        self.assertEqual(by_jid[552], {"transaction_journal_id": 552})
        self.assertEqual(by_jid[551]["description"], "Mele Rosse Bio 600g")
        self.assertEqual(by_jid[551]["category_name"], "Groceries")
        self.assertEqual(set(by_jid[551]["tags"]), {"Mele", "Frutta", "Bio"})

        # Verify alias and deduplicated PriceRecord created
        with Session(self.engine) as session:
            aliases = session.exec(select(ItemFireflyAlias)).all()
            self.assertEqual(len(aliases), 1)
            self.assertEqual(aliases[0].normalized_description, "mele rosse bioo 600g")
            prices = session.exec(select(PriceRecord)).all()
            self.assertEqual(len(prices), 1)
            self.assertEqual(prices[0].transaction_journal_id, 551)
            self.assertEqual(prices[0].paid_price, 2.40)
            self.assertEqual(prices[0].normalized_unit_price, 4.0)  # 2.40 / 0.6kg

    def test_explicit_propagate_updates_linked_firefly_splits_after_product_edit(self):
        with Session(self.engine) as session:
            session.add(
                FireflySyncedSplit(
                    transaction_journal_id=701,
                    firefly_transaction_id=70,
                    tx_type="withdrawal",
                    tx_date=date(2026, 11, 21),
                    amount_cents=250,
                    description="Mele Rosse Bio 600g",
                    normalized_description="mele rosse bio 600g",
                    firefly_expense_account_id=20,
                    firefly_expense_account_name="Conad",
                    firefly_category_name="Groceries",
                    tags_json='["Mele", "Bio", "Frutta"]',
                    linked_product_id=self.product_id,
                )
            )
            session.commit()

        # PATCH product does NOT call Firefly automatically
        patch_resp = self.client.patch(
            f"/api/v1/products/{self.product_id}",
            json={"name": "Mele Rosse Melinda Bio 600g"},
        )
        self.assertEqual(patch_resp.status_code, 200)
        self.assertEqual(patch_resp.json()["affected_firefly_count"], 1)

        captured_puts = []

        async def mock_get_tx(tx_id):
            return {
                "id": str(tx_id),
                "attributes": {
                    "transactions": [{"transaction_journal_id": "701", "description": "Mele Rosse Bio 600g"}]
                },
            }

        async def mock_put_tx(tx_id, payload):
            captured_puts.append((tx_id, payload))
            return {"data": {"id": str(tx_id)}}

        with (
            patch("app.api.v1.firefly_sync.firefly_client.get_transaction_by_id", side_effect=mock_get_tx),
            patch("app.api.v1.firefly_sync.firefly_client.update_transaction", side_effect=mock_put_tx),
        ):
            prop_resp = self.client.post(f"/api/v1/products/{self.product_id}/propagate-firefly")

        self.assertEqual(prop_resp.status_code, 200)
        self.assertEqual(prop_resp.json()["updated_transactions"], 1)
        self.assertEqual(
            captured_puts[0][1]["transactions"][0]["description"],
            "Mele Rosse Melinda Bio 600g",
        )


if __name__ == "__main__":
    unittest.main()

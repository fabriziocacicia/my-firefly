import json
import threading
import time
import unittest
from datetime import date, datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import httpx
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, Session, select

from app.core.database import configure_sqlite_pragmas, get_session
from app.main import app
from app.models.firefly_cache import FireflySyncJob, FireflySyncState, FireflySyncedSplit
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
        self.addCleanup(self.engine.dispose)
        self.addCleanup(app.dependency_overrides.clear)
        self.enterContext(patch("app.main.engine", self.engine))
        self.enterContext(patch("app.main.run_db_migrations"))
        self.client = self.enterContext(TestClient(app))

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
                name="Mele Rosse Bio",
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
        pass

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
                            "tags": ["Bio"],
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
        self.assertEqual(set(groups[0]["sample_tags"]), {"Mele", "Bio"})

        # Ignore rent transaction
        ignore_resp = self.client.post(
            "/api/v1/firefly-sync/backlog/ignore",
            json={"transaction_journal_ids": [562], "ignored": True},
        )
        self.assertEqual(ignore_resp.status_code, 200)
        after_ignore = self.client.get("/api/v1/firefly-sync/backlog").json()
        self.assertEqual(after_ignore["total_unassociated"], 3)
        self.assertEqual(after_ignore["ignored_count"], 1)

    def _wait_for_job(self, job_id: int, timeout: float = 3.0) -> dict:
        deadline = time.monotonic() + timeout
        last_body = {}
        while time.monotonic() < deadline:
            resp = self.client.get(f"/api/v1/firefly-sync/jobs/{job_id}")
            self.assertEqual(resp.status_code, 200)
            last_body = resp.json()
            if last_body["status"] in {"completed", "completed_with_errors", "failed"}:
                return last_body
            time.sleep(0.02)
        self.fail(f"Job {job_id} did not finish within {timeout}s; last state: {last_body}")

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
                    "group_title": "Conad - 2026-11-20",
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
            patch("app.services.firefly_sync_jobs.firefly_client.get_transaction_by_id", side_effect=mock_get_tx),
            patch("app.services.firefly_sync_jobs.firefly_client.update_transaction", side_effect=mock_put_tx),
        ):
            link_resp = self.client.post(
                "/api/v1/firefly-sync/backlog/link",
                json={
                    "product_id": self.product_id,
                    "transaction_journal_ids": [551],
                },
            )
            self.assertEqual(link_resp.status_code, 202)
            job_init = link_resp.json()
            self.assertEqual(job_init["job_type"], "backlog_link")
            self.assertEqual(job_init["product_id"], self.product_id)
            body = self._wait_for_job(job_init["id"])

        self.assertEqual(body["status"], "completed")
        self.assertEqual(body["linked_splits"], 1)
        self.assertEqual(body["updated_transactions"], 1)
        self.assertEqual(body["failed_transactions"], [])

        # Verify PUT payload preserved sibling split 552 and updated split 551
        self.assertEqual(len(captured_puts), 1)
        tx_id, put_payload = captured_puts[0]
        self.assertEqual(tx_id, 55)
        self.assertEqual(put_payload["apply_rules"], False)
        self.assertEqual(put_payload["fire_webhooks"], False)
        self.assertEqual(put_payload["group_title"], "Conad - 2026-11-20")
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
            json={"name": "Mele Rosse Melinda Bio"},
        )
        self.assertEqual(patch_resp.status_code, 200)
        self.assertEqual(patch_resp.json()["affected_firefly_count"], 1)
        self.assertEqual(patch_resp.json()["firefly_description"], "Mele Rosse Melinda Bio 600g")

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
            patch("app.services.firefly_sync_jobs.firefly_client.get_transaction_by_id", side_effect=mock_get_tx),
            patch("app.services.firefly_sync_jobs.firefly_client.update_transaction", side_effect=mock_put_tx),
        ):
            prop_resp = self.client.post(f"/api/v1/products/{self.product_id}/propagate-firefly")
            self.assertEqual(prop_resp.status_code, 202)
            prop_job = self._wait_for_job(prop_resp.json()["id"])

        self.assertEqual(prop_job["status"], "completed")
        self.assertEqual(prop_job["updated_transactions"], 1)
        self.assertEqual(
            captured_puts[0][1]["transactions"][0]["description"],
            "Mele Rosse Melinda Bio 600g",
        )

    def test_backlog_status_filter_linked_ignored_and_unlink(self):
        with Session(self.engine) as session:
            session.add_all(
                [
                    FireflySyncedSplit(
                        transaction_journal_id=801,
                        firefly_transaction_id=80,
                        tx_type="withdrawal",
                        tx_date=date(2026, 11, 21),
                        amount_cents=240,
                        description="Mele Rosse Bio 600g",
                        normalized_description="mele rosse bio 600g",
                        firefly_expense_account_id=20,
                        firefly_expense_account_name="Conad",
                        firefly_category_name="Groceries",
                        tags_json="[]",
                        linked_product_id=self.product_id,
                    ),
                    FireflySyncedSplit(
                        transaction_journal_id=802,
                        firefly_transaction_id=80,
                        tx_type="withdrawal",
                        tx_date=date(2026, 11, 21),
                        amount_cents=500,
                        description="Bolletta Luce",
                        normalized_description="bolletta luce",
                        firefly_expense_account_id=21,
                        firefly_expense_account_name="Enel",
                        firefly_category_name="Utilities",
                        tags_json="[]",
                        is_ignored=True,
                    ),
                    FireflySyncedSplit(
                        transaction_journal_id=803,
                        firefly_transaction_id=81,
                        tx_type="withdrawal",
                        tx_date=date(2026, 11, 22),
                        amount_cents=120,
                        description="Acqua Naturale",
                        normalized_description="acqua naturale",
                        firefly_expense_account_id=20,
                        firefly_expense_account_name="Conad",
                        firefly_category_name="Groceries",
                        tags_json="[]",
                    ),
                ]
            )
            session.commit()

        # Default (unassociated) hides linked (801) and ignored (802)
        unassoc = self.client.get("/api/v1/firefly-sync/backlog").json()
        self.assertEqual(unassoc["total_unassociated"], 1)
        self.assertEqual(unassoc["linked_count"], 1)
        self.assertEqual(unassoc["ignored_count"], 1)
        self.assertEqual(len(unassoc["groups"]), 1)
        self.assertEqual(unassoc["groups"][0]["sample_description"], "Acqua Naturale")

        # Linked tab shows 801 with linked_product_name
        linked = self.client.get("/api/v1/firefly-sync/backlog?status=linked").json()
        self.assertEqual(len(linked["groups"]), 1)
        self.assertEqual(linked["groups"][0]["linked_product_id"], self.product_id)
        self.assertEqual(linked["groups"][0]["linked_product_name"], "Mele Rosse Bio")

        # Ignored tab shows 802
        ignored = self.client.get("/api/v1/firefly-sync/backlog?status=ignored").json()
        self.assertEqual(len(ignored["groups"]), 1)
        self.assertEqual(ignored["groups"][0]["sample_description"], "Bolletta Luce")

        # Unlink 801 returns it to unassociated backlog
        unlink_resp = self.client.post(
            "/api/v1/firefly-sync/backlog/unlink",
            json={"transaction_journal_ids": [801]},
        )
        self.assertEqual(unlink_resp.status_code, 200)
        unassoc_after = self.client.get("/api/v1/firefly-sync/backlog").json()
        self.assertEqual(unassoc_after["total_unassociated"], 2)
        self.assertEqual(unassoc_after["linked_count"], 0)

    def test_link_omits_null_category_and_formats_firefly_http_errors(self):
        with Session(self.engine) as session:
            uncat_product = Product(
                name="Sapone Mani",
                sale_mode="packaged",
                pack_count=1,
                default_unit="pcs",
                firefly_category_name=None,
            )
            session.add(uncat_product)
            session.flush()
            uncat_pid = uncat_product.id
            session.add_all(
                [
                    FireflySyncedSplit(
                        transaction_journal_id=901,
                        firefly_transaction_id=90,
                        tx_type="withdrawal",
                        tx_date=date(2026, 11, 22),
                        amount_cents=199,
                        description="Sapone Liquid",
                        normalized_description="sapone liquid",
                        firefly_expense_account_id=20,
                        firefly_expense_account_name="Conad",
                        firefly_category_name="Personal Care",
                        tags_json="[]",
                    ),
                    FireflySyncedSplit(
                        transaction_journal_id=902,
                        firefly_transaction_id=91,
                        tx_type="withdrawal",
                        tx_date=date(2026, 11, 22),
                        amount_cents=199,
                        description="Sapone Liquid",
                        normalized_description="sapone liquid",
                        firefly_expense_account_id=20,
                        firefly_expense_account_name="Conad",
                        firefly_category_name="Personal Care",
                        tags_json="[]",
                    ),
                ]
            )
            session.commit()

        captured_puts = []

        async def mock_get_tx(tx_id):
            if tx_id == 90:
                return {
                    "id": str(tx_id),
                    "attributes": {
                        "group_title": None,
                        "transactions": [
                            {
                                "transaction_journal_id": "901",
                                "description": "Sapone Liquid",
                                "destination_name": "Conad",
                                "date": "2026-11-22T12:00:00+00:00",
                            },
                            {
                                "transaction_journal_id": "999",
                                "description": "Altro",
                            },
                        ],
                    },
                }
            return {
                "id": str(tx_id),
                "attributes": {
                    "transactions": [{"transaction_journal_id": "902", "description": "Sapone Liquid"}]
                },
            }

        async def mock_put_tx(tx_id, payload):
            if tx_id == 91:
                req = httpx.Request("PUT", f"http://firefly/api/v1/transactions/{tx_id}")
                resp = httpx.Response(
                    422,
                    request=req,
                    json={
                        "message": "The given data was invalid.",
                        "errors": {"transactions.0.description": ["Too long."]},
                    },
                )
                raise httpx.HTTPStatusError("422", request=req, response=resp)
            captured_puts.append((tx_id, payload))
            return {"data": {"id": str(tx_id)}}

        with (
            patch("app.services.firefly_sync_jobs.firefly_client.get_transaction_by_id", side_effect=mock_get_tx),
            patch("app.services.firefly_sync_jobs.firefly_client.update_transaction", side_effect=mock_put_tx),
        ):
            link_resp = self.client.post(
                "/api/v1/firefly-sync/backlog/link",
                json={"product_id": uncat_pid, "transaction_journal_ids": [901, 902]},
            )
            self.assertEqual(link_resp.status_code, 202)
            body = self._wait_for_job(link_resp.json()["id"])

        self.assertEqual(body["status"], "completed_with_errors")
        self.assertEqual(body["total_splits"], 2)
        self.assertEqual(body["processed_splits"], 2)
        self.assertEqual(body["linked_splits"], 1)
        self.assertEqual(body["failed_count"], 1)
        self.assertEqual(len(body["failed_transactions"]), 1)
        self.assertEqual(body["failed_transactions"][0]["firefly_transaction_id"], 91)
        self.assertIn("HTTP 422", body["failed_transactions"][0]["error"])
        self.assertIn("transactions.0.description: Too long.", body["failed_transactions"][0]["error"])
        # Null category_name omitted cleanly from PUT payload, and fallback group_title synthesized for multi-split
        self.assertNotIn("category_name", captured_puts[0][1]["transactions"][0])
        self.assertEqual(captured_puts[0][1]["group_title"], "Conad - 2026-11-22")

    def test_async_job_conflict_dismiss_sse_stream_and_startup_recovery(self):
        from app.services.firefly_sync_jobs import mark_interrupted_sync_jobs_failed

        with Session(self.engine) as session:
            stale = FireflySyncJob(
                job_type="backlog_link",
                product_id=self.product_id,
                product_name="Mele Rosse Bio",
                status="running",
                total_transactions=10,
                processed_transactions=3,
            )
            session.add(stale)
            session.add(
                FireflySyncedSplit(
                    transaction_journal_id=950,
                    firefly_transaction_id=95,
                    tx_type="withdrawal",
                    tx_date=date(2026, 11, 22),
                    amount_cents=120,
                    description="Mele Rosse Bio 600g",
                    normalized_description="mele rosse bio 600g",
                    firefly_expense_account_id=20,
                    firefly_expense_account_name="Conad",
                    firefly_category_name="Groceries",
                    tags_json="[]",
                )
            )
            session.commit()
            stale_id = stale.id

        # Startup recovery clears stale running jobs
        recovered = mark_interrupted_sync_jobs_failed(self.engine)
        self.assertEqual(recovered, 1)
        stale_resp = self.client.get(f"/api/v1/firefly-sync/jobs/{stale_id}")
        self.assertEqual(stale_resp.status_code, 200)
        self.assertEqual(stale_resp.json()["status"], "failed")
        self.assertIn("Interrupted", stale_resp.json()["error_message"])

        # Dismiss finished stale job
        dismiss_stale = self.client.post(f"/api/v1/firefly-sync/jobs/{stale_id}/dismiss")
        self.assertEqual(dismiss_stale.status_code, 200)
        self.assertEqual(self.client.get("/api/v1/firefly-sync/jobs").json(), [])

        # Deterministic gate keeps job running during conflict/dismiss/delete 409 checks
        import asyncio
        release_gate = threading.Event()

        async def gated_get_tx(tx_id):
            while not release_gate.is_set():
                await asyncio.sleep(0.005)
            return {
                "id": str(tx_id),
                "attributes": {
                    "transactions": [{"transaction_journal_id": "950", "description": "Mele Rosse Bio 600g"}]
                },
            }

        async def ok_put_tx(tx_id, payload):
            return {"data": {"id": str(tx_id)}}

        with (
            patch("app.services.firefly_sync_jobs.firefly_client.get_transaction_by_id", side_effect=gated_get_tx),
            patch("app.services.firefly_sync_jobs.firefly_client.update_transaction", side_effect=ok_put_tx),
        ):
            r1 = self.client.post(
                "/api/v1/firefly-sync/backlog/link",
                json={"product_id": self.product_id, "transaction_journal_ids": [950]},
            )
            self.assertEqual(r1.status_code, 202)
            active_job_id = r1.json()["id"]

            # Duplicate link with a different split/alias must return 409 and NOT overwrite existing alias
            other_prod = Product(name="Other Product", sale_mode="packaged", pack_count=1, default_unit="pcs")
            with Session(self.engine) as session:
                session.add(other_prod)
                session.flush()
                other_pid = other_prod.id
                session.add(
                    FireflySyncedSplit(
                        transaction_journal_id=951,
                        firefly_transaction_id=95,
                        tx_type="withdrawal",
                        tx_date=date(2026, 11, 22),
                        amount_cents=120,
                        description="Mela Conf",
                        normalized_description="mela conf",
                        tags_json="[]",
                    )
                )
                session.add(
                    ItemFireflyAlias(
                        product_id=other_pid,
                        raw_description="Mela Conf",
                        normalized_description="mela conf",
                    )
                )
                session.commit()

            r2 = self.client.post(
                "/api/v1/firefly-sync/backlog/link",
                json={"product_id": self.product_id, "transaction_journal_ids": [951]},
            )
            self.assertEqual(r2.status_code, 409)
            with Session(self.engine) as session:
                preserved_alias = session.exec(
                    select(ItemFireflyAlias).where(ItemFireflyAlias.normalized_description == "mela conf")
                ).first()
                self.assertIsNotNone(preserved_alias)
                self.assertEqual(preserved_alias.product_id, other_pid)

            dismiss_active = self.client.post(f"/api/v1/firefly-sync/jobs/{active_job_id}/dismiss")
            self.assertEqual(dismiss_active.status_code, 409)

            del_active = self.client.delete(f"/api/v1/products/{self.product_id}")
            self.assertEqual(del_active.status_code, 409)

            timer = threading.Timer(0.04, release_gate.set)
            timer.start()
            sse_lines = []
            try:
                with self.client.stream("GET", "/api/v1/firefly-sync/jobs/stream") as stream_resp:
                    self.assertEqual(stream_resp.status_code, 200)
                    self.assertIn("text/event-stream", stream_resp.headers.get("content-type", ""))
                    self.assertEqual(stream_resp.headers.get("x-accel-buffering"), "no")
                    for line in stream_resp.iter_lines():
                        if line:
                            sse_lines.append(line)
            finally:
                release_gate.set()
                timer.cancel()

            data_events = [
                json.loads(line[6:]) for line in sse_lines if line.startswith("data: ")
            ]
            self.assertGreaterEqual(len(data_events), 1)
            final_jobs = data_events[-1]
            self.assertEqual(final_jobs[0]["id"], active_job_id)
            self.assertEqual(final_jobs[0]["status"], "completed")

    def test_incremental_sync_backlog_filters_and_pushed_receipt_propagation(self):
        # Seed full sync state + uncategorized & alias-hinted splits + pushed receipt
        with Session(self.engine) as session:
            session.add(
                FireflySyncState(
                    id=1,
                    last_full_sync_at=datetime(2026, 11, 20, tzinfo=timezone.utc),
                    last_incremental_sync_at=datetime(2026, 11, 20, tzinfo=timezone.utc),
                    high_watermark_date=date(2026, 11, 20),
                )
            )
            session.add(
                ItemFireflyAlias(
                    product_id=self.product_id,
                    raw_description="Mela Rossa Biologica",
                    normalized_description="mela rossa biologica",
                )
            )
            session.add(
                FireflySyncedSplit(
                    transaction_journal_id=961,
                    firefly_transaction_id=96,
                    tx_date=date(2026, 11, 21),
                    amount_cents=300,
                    description="Mela Rossa Biologica",
                    normalized_description="mela rossa biologica",
                    firefly_category_name=None,
                    tags_json="[]",
                )
            )
            session.commit()

        captured_sync_starts = []

        async def mock_all_txs(tx_type="withdrawal", start=None, end=None, max_pages=200):
            captured_sync_starts.append(start)
            return [
                {
                    "id": "97",
                    "attributes": {
                        "transactions": [
                            {
                                "transaction_journal_id": "971",
                                "type": "withdrawal",
                                "date": "2026-11-22T10:00:00+00:00",
                                "amount": "1.99",
                                "description": "Acqua Naturale 1.5L",
                                "category_name": "Beverages",
                                "tags": [],
                            }
                        ]
                    },
                }
            ]

        with patch(
            "app.api.v1.firefly_sync.firefly_client.get_all_transactions",
            side_effect=mock_all_txs,
        ):
            inc_resp = self.client.post("/api/v1/firefly-sync/transactions?mode=incremental")
        self.assertEqual(inc_resp.status_code, 200)
        self.assertEqual(inc_resp.json()["status"], "synced")
        self.assertEqual(captured_sync_starts, ["2026-11-13"])  # high_watermark - 7 days

        # Verify __uncategorized__, search, and alias hint suggestion
        uncat = self.client.get("/api/v1/firefly-sync/backlog?category=__uncategorized__").json()
        self.assertEqual(len(uncat["groups"]), 1)
        self.assertEqual(uncat["groups"][0]["suggested_product_id"], self.product_id)

        searched = self.client.get("/api/v1/firefly-sync/backlog?search=acqua").json()
        self.assertEqual(len(searched["groups"]), 1)
        self.assertEqual(searched["groups"][0]["sample_description"], "Acqua Naturale 1.5L")

        # Verify ignore_backlog clears linked_product_id and excludes from affected_firefly_count
        with Session(self.engine) as session:
            split = session.exec(
                select(FireflySyncedSplit).where(FireflySyncedSplit.transaction_journal_id == 961)
            ).first()
            split.linked_product_id = self.product_id
            session.add(split)
            session.commit()
        self.assertEqual(self.client.get(f"/api/v1/products/{self.product_id}").json()["affected_firefly_count"], 1)

        self.client.post(
            "/api/v1/firefly-sync/backlog/ignore",
            json={"transaction_journal_ids": [961], "ignored": True},
        )
        self.assertEqual(self.client.get(f"/api/v1/products/{self.product_id}").json()["affected_firefly_count"], 0)

    def test_list_jobs_auto_expires_old_completed_banners_but_preserves_history_and_errors(self):
        now = datetime.now(timezone.utc)
        with Session(self.engine) as session:
            recent_completed = FireflySyncJob(
                job_type="backlog_link",
                product_id=self.product_id,
                product_name="Recent Completed",
                status="completed",
                created_at=now - timedelta(seconds=90),
                finished_at=now - timedelta(seconds=60),
            )
            expired_completed = FireflySyncJob(
                job_type="backlog_link",
                product_id=self.product_id,
                product_name="Expired Completed",
                status="completed",
                created_at=now - timedelta(seconds=400),
                finished_at=now - timedelta(seconds=360),
            )
            expired_no_finished_at = FireflySyncJob(
                job_type="product_propagate",
                product_id=self.product_id,
                product_name="Expired Fallback",
                status="completed",
                created_at=now - timedelta(seconds=360),
                finished_at=None,
            )
            old_failed = FireflySyncJob(
                job_type="backlog_link",
                product_id=self.product_id,
                product_name="Old Failed",
                status="failed",
                error_message="Connection refused",
                created_at=now - timedelta(hours=2),
                finished_at=now - timedelta(hours=2),
            )
            old_partial = FireflySyncJob(
                job_type="product_propagate",
                product_id=self.product_id,
                product_name="Old Partial",
                status="completed_with_errors",
                failed_count=1,
                created_at=now - timedelta(hours=2),
                finished_at=now - timedelta(hours=2),
            )
            active_running = FireflySyncJob(
                job_type="backlog_link",
                product_id=self.product_id,
                product_name="Active Running",
                status="running",
                created_at=now - timedelta(hours=1),
            )
            session.add_all([
                recent_completed,
                expired_completed,
                expired_no_finished_at,
                old_failed,
                old_partial,
                active_running,
            ])
            session.commit()
            expected_visible_ids = {
                recent_completed.id,
                old_failed.id,
                old_partial.id,
                active_running.id,
            }
            all_ids = {
                recent_completed.id,
                expired_completed.id,
                expired_no_finished_at.id,
                old_failed.id,
                old_partial.id,
                active_running.id,
            }

        visible_resp = self.client.get("/api/v1/firefly-sync/jobs")
        self.assertEqual(visible_resp.status_code, 200)
        visible_ids = {j["id"] for j in visible_resp.json()}
        self.assertEqual(visible_ids, expected_visible_ids)

        history_resp = self.client.get("/api/v1/firefly-sync/jobs?include_dismissed=true&limit=50")
        self.assertEqual(history_resp.status_code, 200)
        history_ids = {j["id"] for j in history_resp.json()}
        self.assertEqual(history_ids, all_ids)

    def test_dismiss_all_jobs_clears_finished_only_and_keeps_active_jobs(self):
        now = datetime.now(timezone.utc)
        already_dismissed_at = now - timedelta(minutes=1)
        with Session(self.engine) as session:
            running_job = FireflySyncJob(
                job_type="backlog_link",
                product_id=self.product_id,
                product_name="Running Job",
                status="running",
                created_at=now - timedelta(seconds=10),
            )
            queued_job = FireflySyncJob(
                job_type="product_propagate",
                product_id=self.product_id,
                product_name="Queued Job",
                status="queued",
                created_at=now - timedelta(seconds=5),
            )
            recent_done = FireflySyncJob(
                job_type="backlog_link",
                product_id=self.product_id,
                product_name="Recent Done",
                status="completed",
                created_at=now - timedelta(seconds=40),
                finished_at=now - timedelta(seconds=30),
            )
            failed_job = FireflySyncJob(
                job_type="backlog_link",
                product_id=self.product_id,
                product_name="Failed Job",
                status="failed",
                error_message="Boom",
                created_at=now - timedelta(minutes=10),
                finished_at=now - timedelta(minutes=10),
            )
            already_dismissed = FireflySyncJob(
                job_type="backlog_link",
                product_id=self.product_id,
                product_name="Already Dismissed",
                status="completed",
                created_at=now - timedelta(seconds=50),
                finished_at=now - timedelta(seconds=45),
                dismissed_at=already_dismissed_at,
            )
            session.add_all([running_job, queued_job, recent_done, failed_job, already_dismissed])
            session.commit()
            active_ids = {running_job.id, queued_job.id}
            already_dismissed_id = already_dismissed.id

        resp = self.client.post("/api/v1/firefly-sync/jobs/dismiss-all")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["dismissed_count"], 2)

        visible_after = self.client.get("/api/v1/firefly-sync/jobs")
        self.assertEqual(visible_after.status_code, 200)
        self.assertEqual({j["id"] for j in visible_after.json()}, active_ids)

        history_after = self.client.get("/api/v1/firefly-sync/jobs?include_dismissed=true&limit=50")
        self.assertEqual(history_after.status_code, 200)
        self.assertEqual(len(history_after.json()), 5)

        with Session(self.engine) as session:
            preserved = session.get(FireflySyncJob, already_dismissed_id)
            self.assertIsNotNone(preserved)
            self.assertEqual(
                preserved.dismissed_at.replace(tzinfo=timezone.utc),
                already_dismissed_at,
            )

    def test_price_record_nullable_quantity_and_scoped_alias_uniqueness(self):
        from sqlalchemy.exc import IntegrityError

        with Session(self.engine) as session:
            pr = PriceRecord(
                product_id=self.product_id,
                firefly_account_id=20,
                recorded_date=date(2026, 11, 25),
                regular_price=2.50,
                paid_price=2.50,
                quantity=None,
                unit="kg",
                source_type="firefly_sync",
                verification_status="missing",
            )
            session.add(pr)

            a1 = ItemFireflyAlias(
                product_id=self.product_id,
                raw_description="Banane Bio",
                normalized_description="banane bio",
                firefly_account_id=20,
                scope_key="store:20",
            )
            a2 = ItemFireflyAlias(
                product_id=self.product_id,
                raw_description="Banane Bio",
                normalized_description="banane bio",
                firefly_account_id=21,
                scope_key="store:21",
            )
            session.add_all([a1, a2])
            session.commit()
            session.refresh(pr)
            self.assertIsNone(pr.quantity)
            self.assertEqual(pr.verification_status, "missing")

            dup = ItemFireflyAlias(
                product_id=self.product_id,
                raw_description="Banane Bio",
                normalized_description="banane bio",
                firefly_account_id=20,
                scope_key="store:20",
            )
            session.add(dup)
            with self.assertRaises(IntegrityError):
                session.commit()
            session.rollback()

    def test_loose_weight_backlog_link_starts_missing_and_patch_price_verifies_locally(self):
        with Session(self.engine) as session:
            bananas = Product(
                name="Banane Bio",
                sale_mode="loose_weight",
                pack_count=1,
                unit_size=1.0,
                default_unit="kg",
                package_size=1.0,
                firefly_category_id=1,
                firefly_category_name="Groceries",
            )
            session.add(bananas)
            session.commit()
            session.refresh(bananas)
            session.add(ProductTagLink(product_id=bananas.id, tag_id=self.tag_ids["Bio"]))
            session.add(
                FireflySyncedSplit(
                    transaction_journal_id=8801,
                    firefly_transaction_id=880,
                    tx_type="withdrawal",
                    tx_date=date(2026, 11, 24),
                    amount_cents=240,
                    description="Banane Bio",
                    normalized_description="banane bio",
                    firefly_expense_account_id=20,
                    firefly_expense_account_name="Lidl",
                    firefly_category_name="Groceries",
                    tags_json="[]",
                )
            )
            session.commit()
            bananas_id = bananas.id

        async def mock_get_tx(tx_id):
            return {
                "id": str(tx_id),
                "attributes": {
                    "group_title": "Lidl",
                    "transactions": [
                        {
                            "transaction_journal_id": "8801",
                            "description": "Banane Bio",
                            "category_name": "Groceries",
                            "tags": [],
                        }
                    ],
                },
            }

        async def mock_put_tx(tx_id, payload):
            return {"data": {"id": str(tx_id)}}

        with (
            patch("app.services.firefly_sync_jobs.firefly_client.get_transaction_by_id", side_effect=mock_get_tx),
            patch("app.services.firefly_sync_jobs.firefly_client.update_transaction", side_effect=mock_put_tx),
            patch("app.api.v1.prices.firefly_client.resolve_expense_account_names", new=AsyncMock(return_value={20: "Lidl"})),
        ):
            link_resp = self.client.post(
                "/api/v1/firefly-sync/backlog/link",
                json={"product_id": bananas_id, "transaction_journal_ids": [8801]},
            )
            self.assertEqual(link_resp.status_code, 202)
            self._wait_for_job(link_resp.json()["id"])

            with Session(self.engine) as session:
                pr = session.exec(
                    select(PriceRecord).where(PriceRecord.transaction_journal_id == 8801)
                ).first()
                self.assertIsNotNone(pr)
                self.assertIsNone(pr.quantity)
                self.assertIsNone(pr.normalized_unit_price)
                self.assertIsNone(pr.normalized_regular_price)
                self.assertEqual(pr.verification_status, "missing")
                pr_id = pr.id

            # Analytics and history must not fabricate a 2.40 €/kg unit price while missing
            analytics_before = self.client.get(
                f"/api/v1/analytics/tags?tag_ids={self.tag_ids['Bio']}"
            ).json()
            banana_row = next(i for i in analytics_before["items"] if i["product_id"] == bananas_id)
            self.assertEqual(banana_row["total_spend"], 2.40)
            self.assertEqual(banana_row["purchase_count"], 1)
            self.assertIsNone(banana_row["median_unit_price"])

            history_before = self.client.get(f"/api/v1/prices/history/{bananas_id}").json()
            self.assertIsNone(history_before["analysis"]["normalized_current_price"])
            self.assertIsNone(history_before["analysis"]["normalized_baseline_regular_price"])

            # Cannot verify without a quantity
            bad_verify = self.client.patch(
                f"/api/v1/prices/{pr_id}",
                json={"confirm_verified": True},
            )
            self.assertEqual(bad_verify.status_code, 422)

            # Enrich locally with 800g on discount (regular_price 3.00) -> 3.00 €/kg paid, 3.75 €/kg regular
            with patch("app.api.v1.prices.firefly_client.update_transaction", side_effect=AssertionError("Must not call Firefly")) as _:
                patch_resp = self.client.patch(
                    f"/api/v1/prices/{pr_id}",
                    json={
                        "quantity": 800.0,
                        "unit": "g",
                        "is_discount": True,
                        "regular_price": 3.00,
                        "confirm_verified": True,
                    },
                )
            self.assertEqual(patch_resp.status_code, 200)
            updated = patch_resp.json()
            self.assertEqual(updated["quantity"], 800.0)
            self.assertEqual(updated["unit"], "g")
            self.assertTrue(updated["is_discount"])
            self.assertEqual(updated["regular_price"], 3.00)
            self.assertEqual(updated["normalized_unit_price"], 3.0)
            self.assertEqual(updated["normalized_regular_price"], 3.75)
            self.assertEqual(updated["verification_status"], "verified")

            # Same-product sync/upsert preserves verified edits; different-product re-link resets
            from app.services.firefly_sync_jobs import _upsert_price_record_for_split_values

            with Session(self.engine) as session:
                split = session.exec(
                    select(FireflySyncedSplit).where(FireflySyncedSplit.transaction_journal_id == 8801)
                ).first()
                _upsert_price_record_for_split_values(
                    session,
                    product_id=bananas_id,
                    default_unit="kg",
                    package_size=1.0,
                    sale_mode="loose_weight",
                    split=split,
                )
                session.commit()
                preserved = session.get(PriceRecord, pr_id)
                self.assertEqual(preserved.quantity, 800.0)
                self.assertEqual(preserved.unit, "g")
                self.assertTrue(preserved.is_discount)
                self.assertEqual(preserved.regular_price, 3.00)
                self.assertEqual(preserved.verification_status, "verified")

    def test_patch_price_one_click_confirms_needs_review_record(self):
        with Session(self.engine) as session:
            pr = PriceRecord(
                product_id=self.product_id,
                firefly_account_id=20,
                recorded_date=date(2026, 11, 18),
                regular_price=2.40,
                paid_price=2.40,
                quantity=1.0,
                unit="g",
                package_size=600.0,
                normalized_unit_price=4.0,
                normalized_regular_price=4.0,
                source_type="firefly_sync",
                verification_status="needs_review",
            )
            session.add(pr)
            session.commit()
            session.refresh(pr)
            pr_id = pr.id

        with patch("app.api.v1.prices.firefly_client.resolve_expense_account_names", new=AsyncMock(return_value={20: "Conad"})):
            resp = self.client.patch(
                f"/api/v1/prices/{pr_id}",
                json={"confirm_verified": True},
            )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["verification_status"], "verified")
        self.assertEqual(resp.json()["quantity"], 1.0)
        self.assertEqual(resp.json()["normalized_unit_price"], 4.0)

    def test_scoped_alias_hints_chain_store_precedence_and_backlog_filters(self):
        from app.models.company import AccountMetadata, AccountRole, Company

        with Session(self.engine) as session:
            lidl_chain = Company(name="Lidl")
            famila_chain = Company(name="Famila")
            session.add_all([lidl_chain, famila_chain])
            session.commit()
            session.refresh(lidl_chain)
            session.refresh(famila_chain)

            session.add_all(
                [
                    AccountMetadata(firefly_account_id=101, role=AccountRole.CHAIN, company_id=lidl_chain.id),
                    AccountMetadata(firefly_account_id=102, role=AccountRole.CHAIN, company_id=lidl_chain.id),
                    AccountMetadata(firefly_account_id=103, role=AccountRole.CHAIN, company_id=famila_chain.id),
                ]
            )
            p_lidl = Product(name="Banane Bio Alce Nero", sale_mode="loose_weight", default_unit="kg", firefly_category_name="Groceries")
            p_lidl_branch = Product(name="Banane Bio Branch Override", sale_mode="loose_weight", default_unit="kg", firefly_category_name="Groceries")
            p_famila = Product(name="Banane Bio Almaverde", sale_mode="loose_weight", default_unit="kg", firefly_category_name="Groceries")
            session.add_all([p_lidl, p_lidl_branch, p_famila])
            session.commit()
            for obj in (p_lidl, p_lidl_branch, p_famila):
                session.refresh(obj)

            session.add_all(
                [
                    FireflySyncedSplit(
                        transaction_journal_id=9101,
                        firefly_transaction_id=910,
                        tx_date=date(2026, 11, 20),
                        amount_cents=220,
                        description="Banane Bio",
                        normalized_description="banane bio",
                        firefly_expense_account_id=101,
                        firefly_expense_account_name="Lidl Hotel dei Pini",
                        firefly_category_name="Groceries",
                    ),
                    FireflySyncedSplit(
                        transaction_journal_id=9102,
                        firefly_transaction_id=911,
                        tx_date=date(2026, 11, 21),
                        amount_cents=230,
                        description="Banane Bio",
                        normalized_description="banane bio",
                        firefly_expense_account_id=102,
                        firefly_expense_account_name="Lidl via Cilestri",
                        firefly_category_name="Groceries",
                    ),
                    FireflySyncedSplit(
                        transaction_journal_id=9103,
                        firefly_transaction_id=912,
                        tx_date=date(2026, 11, 22),
                        amount_cents=260,
                        description="Banane Bio",
                        normalized_description="banane bio",
                        firefly_expense_account_id=103,
                        firefly_expense_account_name="Famila h24",
                        firefly_category_name="Groceries",
                    ),
                ]
            )
            session.commit()
            lidl_id, famila_id = lidl_chain.id, famila_chain.id
            p_lidl_id, p_branch_id, p_famila_id = p_lidl.id, p_lidl_branch.id, p_famila.id

        async def mock_get_tx(tx_id):
            jid_map = {910: "9101", 911: "9102", 912: "9103"}
            return {
                "id": str(tx_id),
                "attributes": {
                    "group_title": "Store",
                    "transactions": [{"transaction_journal_id": jid_map[tx_id], "description": "Banane Bio"}],
                },
            }

        async def mock_put_tx(tx_id, payload):
            return {"data": {"id": str(tx_id)}}

        with (
            patch("app.services.firefly_sync_jobs.firefly_client.get_transaction_by_id", side_effect=mock_get_tx),
            patch("app.services.firefly_sync_jobs.firefly_client.update_transaction", side_effect=mock_put_tx),
        ):
            # Link Lidl branch 101 at chain scope -> sets chain:lidl_id
            r1 = self.client.post(
                "/api/v1/firefly-sync/backlog/link",
                json={"product_id": p_lidl_id, "transaction_journal_ids": [9101], "alias_scope": "chain"},
            )
            self.assertEqual(r1.status_code, 202)
            self._wait_for_job(r1.json()["id"])

            # Link Famila branch 103 at chain scope -> sets chain:famila_id without touching Lidl
            r2 = self.client.post(
                "/api/v1/firefly-sync/backlog/link",
                json={"product_id": p_famila_id, "transaction_journal_ids": [9103], "alias_scope": "chain"},
            )
            self.assertEqual(r2.status_code, 202)
            self._wait_for_job(r2.json()["id"])

        # Now add two new unassociated splits for Lidl branch 101 & branch 102 and Famila 103
        with Session(self.engine) as session:
            session.add(
                ItemFireflyAlias(
                    product_id=p_branch_id,
                    raw_description="Banane Bio",
                    normalized_description="banane bio",
                    firefly_account_id=101,
                    scope_key="store:101",
                )
            )
            session.add_all(
                [
                    FireflySyncedSplit(
                        transaction_journal_id=9104,
                        firefly_transaction_id=913,
                        tx_date=date(2026, 11, 25),
                        amount_cents=210,
                        description="Banane Bio",
                        normalized_description="banane bio",
                        firefly_expense_account_id=101,
                        firefly_expense_account_name="Lidl Hotel dei Pini",
                        firefly_category_name="Groceries",
                    ),
                    FireflySyncedSplit(
                        transaction_journal_id=9105,
                        firefly_transaction_id=914,
                        tx_date=date(2026, 11, 26),
                        amount_cents=250,
                        description="Banane Bio",
                        normalized_description="banane bio",
                        firefly_expense_account_id=103,
                        firefly_expense_account_name="Famila h24",
                        firefly_category_name="Groceries",
                    ),
                ]
            )
            session.commit()

        # Filter backlog by Lidl branch 101 -> store override beats chain alias
        b_store101 = self.client.get("/api/v1/firefly-sync/backlog?account_id=101").json()
        self.assertEqual(len(b_store101["groups"]), 1)
        self.assertEqual(b_store101["groups"][0]["suggested_product_id"], p_branch_id)
        self.assertEqual(b_store101["groups"][0]["journal_ids"], [9104])

        # Filter backlog by Lidl chain -> includes unassociated 9102 + 9104 and exposes available_chains/stores
        b_lidl = self.client.get(f"/api/v1/firefly-sync/backlog?company_id={lidl_id}").json()
        self.assertEqual(set(b_lidl["groups"][0]["journal_ids"]), {9102, 9104})
        self.assertGreaterEqual(len(b_lidl["available_chains"]), 2)
        self.assertGreaterEqual(b_lidl["needs_attention_count"], 2)

        # Filter backlog by Famila chain -> suggests p_famila_id
        b_famila = self.client.get(f"/api/v1/firefly-sync/backlog?company_id={famila_id}").json()
        self.assertEqual(b_famila["groups"][0]["suggested_product_id"], p_famila_id)

    def test_backlog_attention_queue_lists_and_filters_missing_and_needs_review(self):
        with Session(self.engine) as session:
            bananas = Product(name="Banane Bio", sale_mode="loose_weight", default_unit="kg", firefly_category_name="Groceries")
            session.add(bananas)
            session.commit()
            session.refresh(bananas)
            session.add_all(
                [
                    FireflySyncedSplit(
                        transaction_journal_id=9201,
                        firefly_transaction_id=920,
                        tx_date=date(2026, 11, 20),
                        amount_cents=240,
                        description="Banane Bio",
                        normalized_description="banane bio",
                        firefly_expense_account_id=201,
                        firefly_expense_account_name="Lidl",
                        firefly_category_name="Groceries",
                        linked_product_id=bananas.id,
                    ),
                    FireflySyncedSplit(
                        transaction_journal_id=9202,
                        firefly_transaction_id=921,
                        tx_date=date(2026, 11, 21),
                        amount_cents=310,
                        description="Banane Bio",
                        normalized_description="banane bio",
                        firefly_expense_account_id=202,
                        firefly_expense_account_name="Famila",
                        firefly_category_name="Groceries",
                        linked_product_id=bananas.id,
                    ),
                ]
            )
            session.add_all(
                [
                    PriceRecord(
                        product_id=bananas.id,
                        firefly_account_id=201,
                        recorded_date=date(2026, 11, 20),
                        regular_price=2.40,
                        paid_price=2.40,
                        quantity=1.0,
                        unit="kg",
                        normalized_unit_price=2.40,
                        firefly_transaction_id=920,
                        transaction_journal_id=9201,
                        source_type="firefly_sync",
                        verification_status="needs_review",
                    ),
                    PriceRecord(
                        product_id=bananas.id,
                        firefly_account_id=202,
                        recorded_date=date(2026, 11, 21),
                        regular_price=3.10,
                        paid_price=3.10,
                        quantity=None,
                        unit="kg",
                        normalized_unit_price=None,
                        firefly_transaction_id=921,
                        transaction_journal_id=9202,
                        source_type="firefly_sync",
                        verification_status="missing",
                    ),
                ]
            )
            session.commit()

        res = self.client.get("/api/v1/firefly-sync/backlog/attention")
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(body["missing_count"], 1)
        self.assertEqual(body["needs_review_count"], 1)
        self.assertEqual(len(body["items"]), 2)
        # missing items appear first
        self.assertEqual(body["items"][0]["verification_status"], "missing")
        self.assertEqual(body["items"][0]["store_name"], "Famila")
        self.assertEqual(body["items"][1]["verification_status"], "needs_review")

        filtered = self.client.get("/api/v1/firefly-sync/backlog/attention?account_id=201").json()
        self.assertEqual(len(filtered["items"]), 1)
        self.assertEqual(filtered["items"][0]["transaction_journal_id"], 9201)


if __name__ == "__main__":
    unittest.main()

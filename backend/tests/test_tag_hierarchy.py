import time
import unittest
from datetime import date
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, Session

from app.core.database import configure_sqlite_pragmas, get_session
from app.main import app
from app.models.firefly_cache import FireflySyncJob, FireflySyncedSplit
from app.models.product import Product
from app.models.tag import ProductTagLink, Tag, TagImplication
from app.services.taxonomy import (
    expand_tag_ids,
    prune_redundant_ancestor_tag_ids,
    would_create_cycle,
)


class TaxonomyUnitTests(unittest.TestCase):
    def test_cycle_detection_blocks_self_loop_and_multi_hop_cycle(self):
        # 1 (Mele) -> 2 (Frutta) -> 3 (Alimentari)
        implications = {1: {2}, 2: {3}}

        self.assertTrue(would_create_cycle(1, 1, implications))
        self.assertTrue(would_create_cycle(2, 1, implications))
        self.assertTrue(would_create_cycle(3, 1, implications))

        # Diamond DAG is valid: 1 (Mele) -> 4 (Vegetale), 4 -> 3 (Alimentari)
        self.assertFalse(would_create_cycle(1, 4, implications))
        self.assertFalse(would_create_cycle(4, 3, implications))

    def test_expand_tag_ids_resolves_multi_hop_and_orthogonal_tags(self):
        # 1 (Mele) -> 2 (Frutta) -> 3 (Alimentari); 4 (Bio) has no parent
        implications = {1: {2}, 2: {3}}
        self.assertEqual(expand_tag_ids([1, 4], implications), {1, 2, 3, 4})
        self.assertEqual(expand_tag_ids([4], implications), {4})

    def test_prune_redundant_ancestor_tag_ids(self):
        # 1 (Mele) -> 2 (Frutta) -> 3 (Alimentari); 1 -> 5 (Fresco) -> 3; 4 (Bio) orthogonal
        implications = {1: {2, 5}, 2: {3}, 5: {3}}

        self.assertEqual(
            prune_redundant_ancestor_tag_ids([2, 1, 3, 4, 1], implications),
            [1, 4],
        )
        self.assertEqual(
            prune_redundant_ancestor_tag_ids([2, 4, 3], implications),
            [2, 4],
        )
        self.assertEqual(
            prune_redundant_ancestor_tag_ids([3, 4], implications),
            [3, 4],
        )


class TagHierarchyApiTests(unittest.TestCase):
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

    def tearDown(self):
        app.dependency_overrides.clear()
        self.engine.dispose()

    def test_sync_firefly_tags_preserves_implications_on_rename(self):
        with Session(self.engine) as session:
            mele = Tag(name="Mele", firefly_tag_id=101)
            frutta = Tag(name="Frutta", firefly_tag_id=102)
            bio_local = Tag(name="Bio", firefly_tag_id=None)
            session.add_all([mele, frutta, bio_local])
            session.commit()
            session.refresh(mele)
            session.refresh(frutta)
            session.add(TagImplication(child_tag_id=mele.id, parent_tag_id=frutta.id))
            session.commit()
            mele_id = mele.id
            frutta_id = frutta.id

        mock_firefly_tags = [
            {"id": "101", "attributes": {"tag": "Mele Fresche"}},
            {"id": "102", "attributes": {"tag": "Frutta"}},
            {"id": "103", "attributes": {"tag": "bio"}},
            {"id": "104", "attributes": {"tag": "Alimentari"}},
        ]

        with patch(
            "app.api.v1.tags.firefly_client.get_all_tags",
            new=AsyncMock(return_value=mock_firefly_tags),
        ):
            resp = self.client.post("/api/v1/tags/sync-firefly")

        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body["created_count"], 1)
        self.assertEqual(body["updated_count"], 2)  # Mele renamed + bio linked by name

        tags_by_ff_id = {t["firefly_tag_id"]: t for t in body["tags"]}
        self.assertEqual(tags_by_ff_id[101]["id"], mele_id)
        self.assertEqual(tags_by_ff_id[101]["name"], "Mele Fresche")
        self.assertEqual(tags_by_ff_id[103]["name"], "bio")
        self.assertIn(104, tags_by_ff_id)

        imp_resp = self.client.get("/api/v1/tags/implications")
        self.assertEqual(imp_resp.status_code, 200)
        self.assertEqual(
            imp_resp.json(),
            [{"child_tag_id": mele_id, "parent_tag_id": frutta_id}],
        )

    def test_create_tag_creates_on_firefly_and_stores_id(self):
        with (
            patch(
                "app.api.v1.tags.firefly_client.get_all_tags",
                new=AsyncMock(return_value=[]),
            ),
            patch(
                "app.api.v1.tags.firefly_client.create_tag",
                new=AsyncMock(
                    return_value={"data": {"id": "205", "attributes": {"tag": "Senza Glutine"}}}
                ),
            ),
        ):
            resp = self.client.post(
                "/api/v1/tags/",
                json={"name": "Senza Glutine", "group": "Dietary"},
            )

        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["name"], "Senza Glutine")
        self.assertEqual(data["firefly_tag_id"], 205)

    def test_implications_crud_rejects_cycles_and_deletes_cleanly(self):
        with Session(self.engine) as session:
            t1 = Tag(name="Mele", firefly_tag_id=1)
            t2 = Tag(name="Frutta", firefly_tag_id=2)
            t3 = Tag(name="Alimentari", firefly_tag_id=3)
            session.add_all([t1, t2, t3])
            session.commit()
            session.refresh(t1)
            session.refresh(t2)
            session.refresh(t3)
            id1, id2, id3 = t1.id, t2.id, t3.id

        r1 = self.client.post(
            "/api/v1/tags/implications",
            json={"child_tag_id": id1, "parent_tag_id": id2},
        )
        self.assertEqual(r1.status_code, 200)

        r2 = self.client.post(
            "/api/v1/tags/implications",
            json={"child_tag_id": id2, "parent_tag_id": id3},
        )
        self.assertEqual(r2.status_code, 200)

        # Cycle: Alimentari -> Mele
        r_cycle = self.client.post(
            "/api/v1/tags/implications",
            json={"child_tag_id": id3, "parent_tag_id": id1},
        )
        self.assertEqual(r_cycle.status_code, 422)

        # Delete edge
        r_del = self.client.delete(f"/api/v1/tags/implications/{id1}/{id2}")
        self.assertEqual(r_del.status_code, 204)

    def test_list_firefly_categories_sorted(self):
        mock_cats = [
            {"id": "2", "attributes": {"name": "Utilities"}},
            {"id": "1", "attributes": {"name": "Groceries"}},
        ]
        with patch(
            "app.api.v1.firefly.firefly_client.get_all_categories",
            new=AsyncMock(return_value=mock_cats),
        ):
            resp = self.client.get("/api/v1/firefly/categories")

        self.assertEqual(resp.status_code, 200)
        self.assertEqual(
            resp.json(),
            [
                {"id": 1, "name": "Groceries"},
                {"id": 2, "name": "Utilities"},
            ],
        )

    def test_product_create_and_update_prune_redundant_parent_tags(self):
        with Session(self.engine) as session:
            mele = Tag(name="Mele", firefly_tag_id=1)
            frutta = Tag(name="Frutta", firefly_tag_id=2)
            bio = Tag(name="Bio", firefly_tag_id=3)
            session.add_all([mele, frutta, bio])
            session.commit()
            session.refresh(mele)
            session.refresh(frutta)
            session.refresh(bio)
            session.add(TagImplication(child_tag_id=mele.id, parent_tag_id=frutta.id))
            session.commit()
            mele_id, frutta_id, bio_id = mele.id, frutta.id, bio.id

        # Creating product with both Frutta and Mele stores only minimal direct tags [Mele, Bio]
        create_resp = self.client.post(
            "/api/v1/products/",
            json={
                "name": "Mele Rosse",
                "default_unit": "kg",
                "sale_mode": "loose_weight",
                "tag_ids": [frutta_id, mele_id, bio_id],
            },
        )
        self.assertEqual(create_resp.status_code, 200)
        created = create_resp.json()
        self.assertEqual([t["id"] for t in created["tags"]], [mele_id, bio_id])
        self.assertEqual(
            {t["id"] for t in created["effective_tags"]},
            {mele_id, frutta_id, bio_id},
        )

        # Updating product to add Frutta directly still normalizes to [Mele, Bio]
        patch_resp = self.client.patch(
            f"/api/v1/products/{created['id']}",
            json={"tag_ids": [mele_id, frutta_id, bio_id]},
        )
        self.assertEqual(patch_resp.status_code, 200)
        updated = patch_resp.json()
        self.assertEqual([t["id"] for t in updated["tags"]], [mele_id, bio_id])

    def test_create_implication_sanitizes_existing_redundant_product_tags(self):
        with Session(self.engine) as session:
            mele = Tag(name="Mele", firefly_tag_id=1)
            frutta = Tag(name="Frutta", firefly_tag_id=2)
            bio = Tag(name="Bio", firefly_tag_id=3)
            p1 = Product(name="Mele Fuji", default_unit="kg", sale_mode="loose_weight")
            p2 = Product(name="Pere Abate", default_unit="kg", sale_mode="loose_weight")
            session.add_all([mele, frutta, bio, p1, p2])
            session.commit()
            for obj in (mele, frutta, bio, p1, p2):
                session.refresh(obj)
            # p1 has both Mele and Frutta directly before the implication rule exists
            session.add_all(
                [
                    ProductTagLink(product_id=p1.id, tag_id=mele.id),
                    ProductTagLink(product_id=p1.id, tag_id=frutta.id),
                    ProductTagLink(product_id=p1.id, tag_id=bio.id),
                    ProductTagLink(product_id=p2.id, tag_id=frutta.id),
                ]
            )
            session.commit()
            mele_id, frutta_id, bio_id = mele.id, frutta.id, bio.id
            p1_id, p2_id = p1.id, p2.id

        imp_resp = self.client.post(
            "/api/v1/tags/implications",
            json={"child_tag_id": mele_id, "parent_tag_id": frutta_id},
        )
        self.assertEqual(imp_resp.status_code, 200)

        p1_data = self.client.get(f"/api/v1/products/{p1_id}").json()
        self.assertEqual([t["id"] for t in p1_data["tags"]], [mele_id, bio_id])
        self.assertEqual(
            {t["id"] for t in p1_data["effective_tags"]},
            {mele_id, frutta_id, bio_id},
        )

        # Removing Mele from p1 now leaves only Bio (Frutta is also gone)
        patch_resp = self.client.patch(
            f"/api/v1/products/{p1_id}",
            json={"tag_ids": [bio_id]},
        )
        self.assertEqual(patch_resp.status_code, 200)
        self.assertEqual([t["id"] for t in patch_resp.json()["effective_tags"]], [bio_id])

        # p2 had Frutta alone (no Mele), so Frutta remains untouched
        p2_data = self.client.get(f"/api/v1/products/{p2_id}").json()
        self.assertEqual([t["id"] for t in p2_data["tags"]], [frutta_id])

    def test_migration_0011_sanitizes_redundant_product_tag_links(self):
        import importlib.util
        from pathlib import Path
        from alembic.migration import MigrationContext
        from alembic.operations import Operations

        mig_path = (
            Path(__file__).resolve().parents[1]
            / "migrations"
            / "versions"
            / "0011_sanitize_redundant_product_tags.py"
        )
        self.assertTrue(mig_path.exists(), f"Missing migration {mig_path}")
        spec = importlib.util.spec_from_file_location("mig0011", mig_path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)

        with Session(self.engine) as session:
            mele = Tag(name="Mele", firefly_tag_id=1)
            frutta = Tag(name="Frutta", firefly_tag_id=2)
            cibo = Tag(name="Cibo", firefly_tag_id=3)
            p1 = Product(name="Mele Renette", default_unit="kg", sale_mode="loose_weight")
            session.add_all([mele, frutta, cibo, p1])
            session.commit()
            for obj in (mele, frutta, cibo, p1):
                session.refresh(obj)
            session.add_all(
                [
                    TagImplication(child_tag_id=mele.id, parent_tag_id=frutta.id),
                    TagImplication(child_tag_id=frutta.id, parent_tag_id=cibo.id),
                    ProductTagLink(product_id=p1.id, tag_id=mele.id),
                    ProductTagLink(product_id=p1.id, tag_id=frutta.id),
                    ProductTagLink(product_id=p1.id, tag_id=cibo.id),
                ]
            )
            session.commit()
            mele_id, p1_id = mele.id, p1.id

        with self.engine.begin() as conn:
            ctx = MigrationContext.configure(conn)
            with Operations.context(ctx):
                mod.upgrade()

        p1_data = self.client.get(f"/api/v1/products/{p1_id}").json()
        self.assertEqual([t["id"] for t in p1_data["tags"]], [mele_id])
        self.assertEqual(len(p1_data["effective_tags"]), 3)


class ImplicationImpactAndBatchSyncTests(unittest.TestCase):
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

    def test_implication_impact_preview_for_add_remove_and_cycle(self):
        with Session(self.engine) as session:
            mele = Tag(name="Mele", firefly_tag_id=1)
            frutta = Tag(name="Frutta", firefly_tag_id=2)
            frutta_bio = Tag(name="FruttaBio", firefly_tag_id=3)
            p_mele = Product(name="Mele Fuji", default_unit="kg", sale_mode="loose_weight")
            p_both = Product(name="Mele Renette", default_unit="kg", sale_mode="loose_weight")
            p_diamond = Product(name="Mele Bio", default_unit="kg", sale_mode="loose_weight")
            session.add_all([mele, frutta, frutta_bio, p_mele, p_both, p_diamond])
            session.commit()
            for obj in (mele, frutta, frutta_bio, p_mele, p_both, p_diamond):
                session.refresh(obj)
            session.add_all(
                [
                    TagImplication(child_tag_id=frutta_bio.id, parent_tag_id=frutta.id),
                    ProductTagLink(product_id=p_mele.id, tag_id=mele.id),
                    ProductTagLink(product_id=p_both.id, tag_id=mele.id),
                    ProductTagLink(product_id=p_both.id, tag_id=frutta.id),
                    ProductTagLink(product_id=p_diamond.id, tag_id=mele.id),
                    ProductTagLink(product_id=p_diamond.id, tag_id=frutta_bio.id),
                    FireflySyncedSplit(
                        transaction_journal_id=1001,
                        firefly_transaction_id=100,
                        tx_type="withdrawal",
                        tx_date=date(2026, 11, 20),
                        amount_cents=350,
                        description="Mele Fuji",
                        normalized_description="mele fuji",
                        linked_product_id=p_mele.id,
                    ),
                    FireflySyncedSplit(
                        transaction_journal_id=1002,
                        firefly_transaction_id=101,
                        tx_type="withdrawal",
                        tx_date=date(2026, 11, 21),
                        amount_cents=450,
                        description="Mele Fuji",
                        normalized_description="mele fuji",
                        linked_product_id=p_mele.id,
                    ),
                ]
            )
            session.commit()
            mele_id, frutta_id = mele.id, frutta.id
            p_mele_id = p_mele.id

        # Unknown tag -> 404
        r_missing = self.client.get(
            "/api/v1/tags/implications/impact",
            params={"action": "add", "child_tag_id": 9999, "parent_tag_id": frutta_id},
        )
        self.assertEqual(r_missing.status_code, 404)

        # Self-cycle -> 422
        r_cycle = self.client.get(
            "/api/v1/tags/implications/impact",
            params={"action": "add", "child_tag_id": mele_id, "parent_tag_id": mele_id},
        )
        self.assertEqual(r_cycle.status_code, 422)

        # Preview adding Mele -> Frutta: only p_mele changes effective_tags (p_both & p_diamond already include Frutta)
        r_add = self.client.get(
            "/api/v1/tags/implications/impact",
            params={"action": "add", "child_tag_id": mele_id, "parent_tag_id": frutta_id},
        )
        self.assertEqual(r_add.status_code, 200)
        add_body = r_add.json()
        self.assertEqual(add_body["total_affected_items"], 1)
        self.assertEqual(add_body["total_affected_transactions"], 2)
        self.assertEqual(add_body["total_affected_splits"], 2)
        self.assertEqual(add_body["affected_items"][0]["product_id"], p_mele_id)
        self.assertEqual(add_body["affected_items"][0]["before_tags"], ["Mele"])
        self.assertEqual(add_body["affected_items"][0]["after_tags"], ["Mele", "Frutta"])

        # Apply Mele -> Frutta (which also prunes p_both's redundant direct Frutta)
        self.assertEqual(
            self.client.post(
                "/api/v1/tags/implications",
                json={"child_tag_id": mele_id, "parent_tag_id": frutta_id},
            ).status_code,
            200,
        )

        # Preview removing Mele -> Frutta: both p_mele and p_both lose Frutta; p_diamond keeps Frutta via FruttaBio
        r_rem = self.client.get(
            "/api/v1/tags/implications/impact",
            params={"action": "remove", "child_tag_id": mele_id, "parent_tag_id": frutta_id},
        )
        self.assertEqual(r_rem.status_code, 200)
        rem_body = r_rem.json()
        self.assertEqual(rem_body["total_affected_items"], 2)
        rem_names = [item["product_name"] for item in rem_body["affected_items"]]
        self.assertEqual(rem_names, ["Mele Fuji", "Mele Renette"])
        self.assertEqual(rem_body["affected_items"][0]["after_tags"], ["Mele"])

    def test_propagate_firefly_batch_enqueues_jobs_and_skips_zero_or_active(self):
        with Session(self.engine) as session:
            mele = Tag(name="Mele", firefly_tag_id=1)
            frutta = Tag(name="Frutta", firefly_tag_id=2)
            p1 = Product(name="Mele Fuji", default_unit="kg", sale_mode="loose_weight")
            p_empty = Product(name="Mele Senza Split", default_unit="kg", sale_mode="loose_weight")
            p_busy = Product(name="Mele Busy", default_unit="kg", sale_mode="loose_weight")
            session.add_all([mele, frutta, p1, p_empty, p_busy])
            session.commit()
            for obj in (mele, frutta, p1, p_empty, p_busy):
                session.refresh(obj)
            session.add_all(
                [
                    TagImplication(child_tag_id=mele.id, parent_tag_id=frutta.id),
                    ProductTagLink(product_id=p1.id, tag_id=mele.id),
                    ProductTagLink(product_id=p_empty.id, tag_id=mele.id),
                    ProductTagLink(product_id=p_busy.id, tag_id=mele.id),
                    FireflySyncedSplit(
                        transaction_journal_id=2001,
                        firefly_transaction_id=200,
                        tx_type="withdrawal",
                        tx_date=date(2026, 11, 20),
                        amount_cents=300,
                        description="Mele Fuji",
                        normalized_description="mele fuji",
                        linked_product_id=p1.id,
                    ),
                    FireflySyncedSplit(
                        transaction_journal_id=2002,
                        firefly_transaction_id=201,
                        tx_type="withdrawal",
                        tx_date=date(2026, 11, 20),
                        amount_cents=300,
                        description="Mele Busy",
                        normalized_description="mele busy",
                        linked_product_id=p_busy.id,
                    ),
                    FireflySyncJob(
                        job_type="product_propagate",
                        product_id=p_busy.id,
                        product_name=p_busy.name,
                        status="running",
                        total_transactions=1,
                        total_splits=1,
                    ),
                ]
            )
            session.commit()
            p1_id, p_empty_id, p_busy_id = p1.id, p_empty.id, p_busy.id

        captured_puts = []

        async def mock_get_tx(tx_id):
            return {
                "id": str(tx_id),
                "attributes": {"transactions": [{"transaction_journal_id": "2001"}]},
            }

        async def mock_put_tx(tx_id, payload):
            captured_puts.append((tx_id, payload))
            return {"data": {"id": str(tx_id)}}

        with (
            patch("app.services.firefly_sync_jobs.firefly_client.get_transaction_by_id", side_effect=mock_get_tx),
            patch("app.services.firefly_sync_jobs.firefly_client.update_transaction", side_effect=mock_put_tx),
        ):
            resp = self.client.post(
                "/api/v1/products/propagate-firefly-batch",
                json={"product_ids": [p1_id, p_empty_id, p_busy_id]},
            )
            self.assertEqual(resp.status_code, 202)
            body = resp.json()
            self.assertEqual(len(body["jobs"]), 1)
            self.assertEqual(body["jobs"][0]["product_id"], p1_id)
            self.assertEqual(body["skipped_active_product_ids"], [p_busy_id])

            job_done = self._wait_for_job(body["jobs"][0]["id"])

        self.assertEqual(job_done["status"], "completed")
        self.assertEqual(
            captured_puts[0][1]["transactions"][0]["tags"],
            ["Mele", "Frutta"],
        )


if __name__ == "__main__":
    unittest.main()

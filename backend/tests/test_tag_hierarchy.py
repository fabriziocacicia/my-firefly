import unittest
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, Session

from app.core.database import configure_sqlite_pragmas, get_session
from app.main import app
from app.models.tag import Tag, TagImplication
from app.services.taxonomy import expand_tag_ids, would_create_cycle


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


if __name__ == "__main__":
    unittest.main()

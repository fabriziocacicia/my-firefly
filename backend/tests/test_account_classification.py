import unittest
from unittest.mock import AsyncMock, patch
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel, create_engine
from sqlalchemy.pool import StaticPool

from app.core.database import get_session
from app.main import app
from app.models.account_metadata import AccountRole, AccountMetadata
from app.models.company import Company


class AccountClassificationApiTests(unittest.TestCase):
    def setUp(self):
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
        self.client = TestClient(app)

    def tearDown(self):
        app.dependency_overrides.clear()
        SQLModel.metadata.drop_all(self.engine)

    def test_categories_endpoint_empty_and_aggregated(self):
        # 1. Empty initially
        res = self.client.get("/api/v1/categories")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json(), [])

        # 2. Add company with category and account with category
        with Session(self.engine) as session:
            comp1 = Company(name="Conad", default_category="Supermarket")
            comp2 = Company(name="Eni", default_category="Gas Station")
            session.add(comp1)
            session.add(comp2)
            meta1 = AccountMetadata(
                firefly_account_id=1,
                role=AccountRole.INDEPENDENT,
                category="Bakery",
            )
            # Duplicate category with different casing
            meta2 = AccountMetadata(
                firefly_account_id=2,
                role=AccountRole.INDEPENDENT,
                category="supermarket",
            )
            session.add(meta1)
            session.add(meta2)
            session.commit()

        res = self.client.get("/api/v1/categories")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data, ["Bakery", "Gas Station", "Supermarket"])

    def test_get_account_metadata_unclassified_fallback(self):
        res = self.client.get("/api/v1/accounts/999/metadata")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["firefly_account_id"], 999)
        self.assertEqual(data["role"], "unclassified")
        self.assertIsNone(data["category"])
        self.assertFalse(data["is_inherited_category"])
        self.assertIsNone(data["company_id"])

    def test_update_account_metadata_independent(self):
        payload = {
            "role": "independent",
            "category": "Pharmacy",
            "notes": "Main street pharmacy",
        }
        res = self.client.put("/api/v1/accounts/101/metadata", json=payload)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["firefly_account_id"], 101)
        self.assertEqual(data["role"], "independent")
        self.assertEqual(data["category"], "Pharmacy")
        self.assertFalse(data["is_inherited_category"])
        self.assertIsNone(data["company_id"])
        self.assertEqual(data["notes"], "Main street pharmacy")

    def test_update_account_metadata_local_business_multi_types(self):
        payload = {
            "role": "local_business",
            "business_types": ["Bar/Cafe", "Tobacconist"],
            "category": "Food & Drink",
            "notes": "Bar and tobacconist shop",
        }
        res = self.client.put("/api/v1/accounts/101/metadata", json=payload)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["firefly_account_id"], 101)
        self.assertEqual(data["role"], "local_business")
        self.assertEqual(data["business_types"], ["Bar/Cafe", "Tobacconist"])
        self.assertEqual(data["effective_business_types"], ["Bar/Cafe", "Tobacconist"])
        self.assertEqual(data["category"], "Food & Drink")
        self.assertFalse(data["is_inherited_category"])
        self.assertIsNone(data["company_id"])

    def test_chain_branch_inherits_and_extends_business_types(self):
        with Session(self.engine) as session:
            comp = Company(
                name="Eni",
                default_category="Gas Station",
                business_types=["Gas Station"],
            )
            session.add(comp)
            session.commit()
            session.refresh(comp)
            comp_id = comp.id

        payload = {
            "role": "chain",
            "company_id": comp_id,
            "business_types": ["Bar/Cafe", "Carwash"],
        }
        res = self.client.put("/api/v1/accounts/102/metadata", json=payload)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["role"], "chain")
        self.assertEqual(data["company_id"], comp_id)
        self.assertEqual(data["category"], "Gas Station")
        self.assertTrue(data["is_inherited_category"])
        self.assertEqual(data["inherited_business_types"], ["Gas Station"])
        self.assertEqual(data["business_types"], ["Bar/Cafe", "Carwash"])
        self.assertEqual(
            data["effective_business_types"],
            ["Gas Station", "Bar/Cafe", "Carwash"],
        )

    def test_update_chain_account_metadata_strips_duplicate_inherited_types(self):
        """
        Regression test: Verify that if a payload attempts to add a business type
        that is already inherited from the parent chain (e.g. 'Fast Food' on Burger King),
        the backend automatically purges the duplicate from the branch's business_types.
        """
        with Session(self.engine) as session:
            comp = Company(
                name="Burger King",
                default_category="Fast Food",
                business_types=["Fast Food"],
            )
            session.add(comp)
            session.commit()
            session.refresh(comp)
            comp_id = comp.id

        payload = {
            "role": "chain",
            "company_id": comp_id,
            "business_types": ["Fast Food", "Drive-thru", "fast food"],
        }
        res = self.client.put("/api/v1/accounts/103/metadata", json=payload)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["role"], "chain")
        self.assertEqual(data["inherited_business_types"], ["Fast Food"])
        # 'Fast Food' must not be in local business_types because it's already inherited
        self.assertEqual(data["business_types"], ["Drive-thru"])
        # effective_business_types contains each type exactly once
        self.assertEqual(data["effective_business_types"], ["Fast Food", "Drive-thru"])

    def test_update_account_metadata_chain_requires_valid_company(self):
        # Missing company_id
        res = self.client.put(
            "/api/v1/accounts/102/metadata",
            json={"role": "chain"},
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn("company_id is required", res.json()["detail"])

        # Non-existent company_id
        res = self.client.put(
            "/api/v1/accounts/102/metadata",
            json={"role": "chain", "company_id": 9999},
        )
        self.assertEqual(res.status_code, 404)

        # Create company and link
        with Session(self.engine) as session:
            comp = Company(name="Lidl", default_category="Supermarket")
            session.add(comp)
            session.commit()
            session.refresh(comp)
            comp_id = comp.id

        res = self.client.put(
            "/api/v1/accounts/102/metadata",
            json={"role": "chain", "company_id": comp_id},
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["role"], "chain")
        self.assertEqual(data["company_id"], comp_id)
        self.assertEqual(data["company_name"], "Lidl")
        self.assertEqual(data["category"], "Supermarket")
        self.assertTrue(data["is_inherited_category"])

    def test_update_account_metadata_person_clears_associations(self):
        # First set as independent
        self.client.put(
            "/api/v1/accounts/103/metadata",
            json={"role": "independent", "category": "Bar"},
        )
        # Then switch to person
        res = self.client.put(
            "/api/v1/accounts/103/metadata",
            json={"role": "person"},
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["role"], "person")
        self.assertIsNone(data["category"])
        self.assertIsNone(data["company_id"])

    @patch("app.api.v1.firefly.firefly_client.get_all_expense_accounts")
    def test_list_expense_accounts_enrichment(self, mock_get_all):
        mock_get_all.return_value = [
            {"id": "1", "attributes": {"name": "Conad Via Roma", "active": True}},
            {"id": "2", "attributes": {"name": "Panificio Rossi", "active": True}},
            {"id": "3", "attributes": {"name": "Alice", "active": True}},
            {"id": "4", "attributes": {"name": "Enel", "active": True}},
        ]

        with Session(self.engine) as session:
            comp = Company(name="Conad", default_category="Supermarket")
            session.add(comp)
            session.commit()
            session.refresh(comp)

            # Account 1: Chain
            meta1 = AccountMetadata(
                firefly_account_id=1,
                role=AccountRole.CHAIN,
                company_id=comp.id,
            )
            # Account 2: Independent
            meta2 = AccountMetadata(
                firefly_account_id=2,
                role=AccountRole.INDEPENDENT,
                category="Bakery",
            )
            # Account 3: Person
            meta3 = AccountMetadata(
                firefly_account_id=3,
                role=AccountRole.PERSON,
            )
            # Account 4: Unclassified (no row in DB)
            session.add_all([meta1, meta2, meta3])
            session.commit()

        res = self.client.get("/api/v1/firefly/expense-accounts")
        self.assertEqual(res.status_code, 200)
        items = res.json()
        self.assertEqual(len(items), 4)

        acc1 = next(a for a in items if a["id"] == 1)
        self.assertEqual(acc1["role"], "chain")
        self.assertEqual(acc1["category"], "Supermarket")
        self.assertTrue(acc1["is_inherited_category"])
        self.assertEqual(acc1["company_name"], "Conad")

        acc2 = next(a for a in items if a["id"] == 2)
        self.assertEqual(acc2["role"], "independent")
        self.assertEqual(acc2["category"], "Bakery")
        self.assertFalse(acc2["is_inherited_category"])

        acc3 = next(a for a in items if a["id"] == 3)
        self.assertEqual(acc3["role"], "person")
        self.assertIsNone(acc3["category"])

        acc4 = next(a for a in items if a["id"] == 4)
        self.assertEqual(acc4["role"], "unclassified")
        self.assertIsNone(acc4["category"])
        self.assertIsNone(acc4["company_id"])

    def test_delete_company_unlinks_account_metadata(self):
        with Session(self.engine) as session:
            comp = Company(name="Esselunga", default_category="Supermarket")
            session.add(comp)
            session.commit()
            session.refresh(comp)
            comp_id = comp.id

            meta = AccountMetadata(
                firefly_account_id=505,
                role=AccountRole.CHAIN,
                company_id=comp_id,
            )
            session.add(meta)
            session.commit()

        # Delete company
        res = self.client.delete(f"/api/v1/companies/{comp_id}")
        self.assertEqual(res.status_code, 204)

        # Check account metadata is reset to unclassified
        meta_res = self.client.get("/api/v1/accounts/505/metadata")
        self.assertEqual(meta_res.status_code, 200)
        self.assertEqual(meta_res.json()["role"], "unclassified")
        self.assertIsNone(meta_res.json()["company_id"])


if __name__ == "__main__":
    unittest.main()

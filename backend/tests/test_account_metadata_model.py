import unittest
from sqlmodel import SQLModel, Session, create_engine, select
from app.models.account_metadata import (
    AccountRole,
    AccountMetadata,
    AccountMetadataUpdate,
    AccountMetadataRead,
)
from app.models.company import Company


class AccountMetadataModelTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:", echo=False)
        SQLModel.metadata.create_all(self.engine)

    def tearDown(self):
        SQLModel.metadata.drop_all(self.engine)

    def test_account_role_enum_values(self):
        self.assertEqual(AccountRole.UNCLASSIFIED.value, "unclassified")
        self.assertEqual(AccountRole.PERSON.value, "person")
        self.assertEqual(AccountRole.CHAIN.value, "chain")
        self.assertEqual(AccountRole.INDEPENDENT.value, "independent")

    def test_create_unclassified_account_metadata_defaults(self):
        with Session(self.engine) as session:
            meta = AccountMetadata(firefly_account_id=101)
            session.add(meta)
            session.commit()
            session.refresh(meta)

            self.assertEqual(meta.firefly_account_id, 101)
            self.assertEqual(meta.role, AccountRole.UNCLASSIFIED)
            self.assertIsNone(meta.category)
            self.assertIsNone(meta.company_id)
            self.assertIsNotNone(meta.created_at)
            self.assertIsNotNone(meta.updated_at)

    def test_create_chain_account_metadata(self):
        with Session(self.engine) as session:
            company = Company(name="Conad", default_category="Supermarket")
            session.add(company)
            session.commit()
            session.refresh(company)

            meta = AccountMetadata(
                firefly_account_id=202,
                role=AccountRole.CHAIN,
                company_id=company.id,
            )
            session.add(meta)
            session.commit()
            session.refresh(meta)

            self.assertEqual(meta.role, AccountRole.CHAIN)
            self.assertEqual(meta.company_id, company.id)
            self.assertIsNotNone(meta.company)
            self.assertEqual(meta.company.name, "Conad")

    def test_create_independent_account_metadata(self):
        with Session(self.engine) as session:
            meta = AccountMetadata(
                firefly_account_id=303,
                role=AccountRole.INDEPENDENT,
                category="Bakery",
                notes="Local organic bakery",
            )
            session.add(meta)
            session.commit()
            session.refresh(meta)

            self.assertEqual(meta.role, AccountRole.INDEPENDENT)
            self.assertEqual(meta.category, "Bakery")
            self.assertEqual(meta.notes, "Local organic bakery")
            self.assertIsNone(meta.company_id)

    def test_create_person_account_metadata(self):
        with Session(self.engine) as session:
            meta = AccountMetadata(
                firefly_account_id=404,
                role=AccountRole.PERSON,
            )
            session.add(meta)
            session.commit()
            session.refresh(meta)

            self.assertEqual(meta.role, AccountRole.PERSON)
            self.assertIsNone(meta.category)
            self.assertIsNone(meta.company_id)

    def test_account_metadata_update_schema(self):
        update = AccountMetadataUpdate(
            role=AccountRole.INDEPENDENT,
            category="Pharmacy",
        )
        self.assertEqual(update.role, AccountRole.INDEPENDENT)
        self.assertEqual(update.category, "Pharmacy")
        self.assertIsNone(update.company_id)


if __name__ == "__main__":
    unittest.main()

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
        self.assertEqual(AccountRole.PHYSICAL_STORE.value, "physical_store")
        self.assertEqual(AccountRole.ECOMMERCE.value, "ecommerce")
        self.assertEqual(AccountRole.SERVICE.value, "service")
        self.assertEqual(AccountRole.INDEPENDENT.value, "independent")

    def test_create_ecommerce_and_physical_store_metadata(self):
        with Session(self.engine) as session:
            meta_ecom = AccountMetadata(
                firefly_account_id=505,
                role=AccountRole.ECOMMERCE,
                category="Supplements",
            )
            meta_phys = AccountMetadata(
                firefly_account_id=506,
                role=AccountRole.PHYSICAL_STORE,
                category="Pharmacy",
            )
            session.add(meta_ecom)
            session.add(meta_phys)
            session.commit()
            session.refresh(meta_ecom)
            session.refresh(meta_phys)

            self.assertEqual(meta_ecom.role, AccountRole.ECOMMERCE)
            self.assertEqual(meta_ecom.category, "Supplements")
            self.assertEqual(meta_phys.role, AccountRole.PHYSICAL_STORE)
            self.assertEqual(meta_phys.category, "Pharmacy")

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

    def test_raw_sqlite_lowercase_enum_values_deserialization(self):
        """
        Regression test: Verify that raw SQLite rows storing lowercase strings
        ('chain', 'person', 'independent', 'unclassified') or uppercase variants
        deserialize cleanly into AccountRole enum instances without LookupError.
        """
        import sqlalchemy as sa

        with self.engine.connect() as conn:
            conn.execute(
                sa.text(
                    """
                    INSERT INTO account_metadata (firefly_account_id, role, created_at, updated_at)
                    VALUES
                        (1001, 'chain', '2026-01-01 00:00:00', '2026-01-01 00:00:00'),
                        (1002, 'CHAIN', '2026-01-01 00:00:00', '2026-01-01 00:00:00'),
                        (1003, 'independent', '2026-01-01 00:00:00', '2026-01-01 00:00:00'),
                        (1004, 'person', '2026-01-01 00:00:00', '2026-01-01 00:00:00'),
                        (1005, 'unclassified', '2026-01-01 00:00:00', '2026-01-01 00:00:00'),
                        (1006, 'non_existent_future_value', '2026-01-01 00:00:00', '2026-01-01 00:00:00')
                    """
                )
            )
            conn.commit()

        with Session(self.engine) as session:
            rows = session.exec(select(AccountMetadata).where(AccountMetadata.firefly_account_id >= 1001)).all()
            row_map = {r.firefly_account_id: r for r in rows}

            self.assertEqual(row_map[1001].role, AccountRole.CHAIN)
            self.assertEqual(row_map[1002].role, AccountRole.CHAIN)
            self.assertEqual(row_map[1003].role, AccountRole.INDEPENDENT)
            self.assertEqual(row_map[1004].role, AccountRole.PERSON)
            self.assertEqual(row_map[1005].role, AccountRole.UNCLASSIFIED)
            self.assertEqual(row_map[1006].role, AccountRole.UNCLASSIFIED)


if __name__ == "__main__":
    unittest.main()

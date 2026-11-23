from datetime import datetime, timezone
from enum import Enum
from typing import Optional, List
from sqlmodel import SQLModel, Field, Relationship


class AccountRole(str, Enum):
    UNCLASSIFIED = "unclassified"
    PERSON = "person"
    CHAIN = "chain"
    INDEPENDENT = "independent"


class CompanyBase(SQLModel):
    name: str = Field(index=True, unique=True)
    default_category: Optional[str] = Field(default=None)  # e.g. "Groceries", "Household"
    notes: Optional[str] = Field(default=None)


class Company(CompanyBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    account_links: List["CompanyAccountLink"] = Relationship(
        back_populates="company", cascade_delete=True
    )
    account_metadatas: List["AccountMetadata"] = Relationship(
        back_populates="company", cascade_delete=True
    )


class CompanyCreate(CompanyBase):
    pass


class CompanyUpdate(SQLModel):
    name: Optional[str] = None
    default_category: Optional[str] = None
    notes: Optional[str] = None


class CompanyRead(CompanyBase):
    id: int
    created_at: datetime


class CompanyWithCountRead(CompanyRead):
    store_count: int = 0


class CompanyAccountLink(SQLModel, table=True):
    firefly_account_id: int = Field(primary_key=True)
    company_id: int = Field(foreign_key="company.id", index=True)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    company: Optional[Company] = Relationship(back_populates="account_links")


class CompanyAccountLinkRead(SQLModel):
    firefly_account_id: int
    company_id: int
    created_at: datetime


class AccountCompanyAssign(SQLModel):
    company_id: Optional[int] = None
    company_name: Optional[str] = None


class AccountMetadataBase(SQLModel):
    role: AccountRole = Field(default=AccountRole.UNCLASSIFIED, index=True)
    category: Optional[str] = Field(default=None, index=True)
    company_id: Optional[int] = Field(default=None, foreign_key="company.id", index=True)
    notes: Optional[str] = Field(default=None)


class AccountMetadata(AccountMetadataBase, table=True):
    __tablename__ = "account_metadata"

    firefly_account_id: int = Field(primary_key=True)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    company: Optional[Company] = Relationship(back_populates="account_metadatas")


class AccountMetadataCreate(AccountMetadataBase):
    firefly_account_id: int


class AccountMetadataUpdate(SQLModel):
    role: AccountRole = AccountRole.UNCLASSIFIED
    category: Optional[str] = None
    company_id: Optional[int] = None
    notes: Optional[str] = None


class AccountMetadataRead(AccountMetadataBase):
    firefly_account_id: int
    created_at: datetime
    updated_at: datetime

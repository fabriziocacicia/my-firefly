from datetime import datetime, timezone
from typing import Optional, List, TYPE_CHECKING
from sqlmodel import SQLModel, Field, Relationship

if TYPE_CHECKING:
    from app.models.account_metadata import AccountMetadata


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

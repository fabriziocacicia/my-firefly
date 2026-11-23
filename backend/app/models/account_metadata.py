from datetime import datetime, timezone
from enum import Enum
from typing import Optional, TYPE_CHECKING
from sqlmodel import SQLModel, Field, Relationship

if TYPE_CHECKING:
    from app.models.company import Company


class AccountRole(str, Enum):
    UNCLASSIFIED = "unclassified"
    PERSON = "person"
    CHAIN = "chain"
    INDEPENDENT = "independent"


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

    company: Optional["Company"] = Relationship(back_populates="account_metadatas")


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

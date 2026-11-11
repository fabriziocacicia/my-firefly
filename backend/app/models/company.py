from datetime import datetime, timezone
from typing import Optional, List
from sqlmodel import SQLModel, Field, Relationship

class CompanyBase(SQLModel):
    name: str = Field(index=True, unique=True)
    default_category: Optional[str] = Field(default=None) # e.g. "Groceries", "Household"
    notes: Optional[str] = Field(default=None)

class Company(CompanyBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    
    stores: List["Store"] = Relationship(back_populates="company")

class CompanyCreate(CompanyBase):
    pass

class CompanyRead(CompanyBase):
    id: int
    created_at: datetime

class StoreBase(SQLModel):
    name: str = Field(index=True) # e.g. "Semafori Porto Empedocle" or "Via Milano Catania"
    company_id: int = Field(foreign_key="company.id", index=True)
    address: Optional[str] = Field(default=None)
    firefly_account_id: Optional[int] = Field(default=None, index=True, unique=True)
    firefly_account_name: Optional[str] = Field(default=None)

class Store(StoreBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    
    company: Optional[Company] = Relationship(back_populates="stores")

class StoreCreate(StoreBase):
    pass

class StoreRead(StoreBase):
    id: int
    created_at: datetime
    company: Optional[CompanyRead] = None

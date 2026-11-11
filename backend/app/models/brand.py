from datetime import datetime, timezone
from typing import Optional
from sqlmodel import SQLModel, Field

class BrandBase(SQLModel):
    name: str = Field(index=True, unique=True)
    is_private_label: bool = Field(default=False) # e.g. Lidl Milbona, Conad Smart
    notes: Optional[str] = Field(default=None)

class Brand(BrandBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class BrandCreate(BrandBase):
    pass

class BrandRead(BrandBase):
    id: int
    created_at: datetime

from datetime import datetime, timezone
from typing import Optional
from sqlmodel import SQLModel, Field


class ProductTagLink(SQLModel, table=True):
    product_id: Optional[int] = Field(default=None, foreign_key="product.id", primary_key=True)
    tag_id: Optional[int] = Field(default=None, foreign_key="tag.id", primary_key=True)


class TagImplication(SQLModel, table=True):
    __tablename__ = "tag_implication"

    child_tag_id: int = Field(foreign_key="tag.id", primary_key=True)
    parent_tag_id: int = Field(foreign_key="tag.id", primary_key=True)


class TagImplicationCreate(SQLModel):
    child_tag_id: int
    parent_tag_id: int


class TagImplicationRead(SQLModel):
    child_tag_id: int
    parent_tag_id: int


class TagBase(SQLModel):
    name: str = Field(index=True, unique=True)
    firefly_tag_id: Optional[int] = Field(default=None, index=True, unique=True)
    group: str = Field(default="General", index=True)  # e.g. "Department", "Dietary", "Attribute"
    color: Optional[str] = Field(default="#3B82F6")  # Hex color for UI pill


class Tag(TagBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class TagCreate(TagBase):
    pass


class TagRead(TagBase):
    id: int
    created_at: datetime

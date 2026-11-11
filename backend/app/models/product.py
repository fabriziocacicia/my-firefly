from datetime import datetime, timezone
from typing import Optional, List
from sqlmodel import SQLModel, Field, Relationship
from app.models.tag import Tag, TagRead, ProductTagLink
from app.models.brand import Brand, BrandRead

class ProductBase(SQLModel):
    name: str = Field(index=True) # e.g. "Spaghetti N.5" or "Organic Golden Apples"
    brand_id: Optional[int] = Field(default=None, foreign_key="brand.id", index=True)
    barcode: Optional[str] = Field(default=None, index=True) # EAN / UPC
    default_unit: str = Field(default="g") # g, kg, ml, l, pcs
    package_size: float = Field(default=1.0) # e.g. 500 (g), 1.0 (kg), 6 (pcs)
    notes: Optional[str] = Field(default=None)

class Product(ProductBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    brand: Optional[Brand] = Relationship()
    tags: List[Tag] = Relationship(link_model=ProductTagLink)

class ProductCreate(ProductBase):
    tag_ids: List[int] = []

class ProductUpdate(SQLModel):
    name: Optional[str] = None
    brand_id: Optional[int] = None
    barcode: Optional[str] = None
    default_unit: Optional[str] = None
    package_size: Optional[float] = None
    notes: Optional[str] = None
    tag_ids: Optional[List[int]] = None

class ProductRead(ProductBase):
    id: int
    created_at: datetime
    brand: Optional[BrandRead] = None
    tags: List[TagRead] = []

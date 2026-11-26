from datetime import datetime, timezone
from typing import Optional, List, Literal
from pydantic import model_validator
from sqlmodel import SQLModel, Field, Relationship
from app.models.tag import Tag, TagRead, ProductTagLink
from app.models.brand import Brand, BrandRead


class ItemFireflyAliasBase(SQLModel):
    product_id: int = Field(foreign_key="product.id", index=True)
    raw_description: str
    normalized_description: str = Field(index=True, unique=True)


class ItemFireflyAlias(ItemFireflyAliasBase, table=True):
    __tablename__ = "item_firefly_alias"

    id: Optional[int] = Field(default=None, primary_key=True)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    product: Optional["Product"] = Relationship(back_populates="aliases")


class ItemFireflyAliasRead(ItemFireflyAliasBase):
    id: int
    created_at: datetime


class ProductBase(SQLModel):
    name: str = Field(index=True)  # e.g. "Spaghetti N.5" or "Mele Rosse Bio 600g"
    brand_id: Optional[int] = Field(default=None, foreign_key="brand.id", index=True)
    barcode: Optional[str] = Field(default=None, index=True)  # EAN / UPC
    sale_mode: str = Field(default="packaged")  # "packaged" | "loose_weight"
    pack_count: int = Field(default=1, ge=1)
    unit_size: float = Field(default=1.0, gt=0)
    default_unit: str = Field(default="g")  # g, kg, ml, l, pcs
    package_size: float = Field(default=1.0, gt=0)  # kept in sync: pack_count * unit_size
    firefly_category_id: Optional[int] = Field(default=None, index=True)
    firefly_category_name: Optional[str] = Field(default=None, index=True)
    notes: Optional[str] = Field(default=None)


class Product(ProductBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    brand: Optional[Brand] = Relationship()
    tags: List[Tag] = Relationship(link_model=ProductTagLink)
    aliases: List[ItemFireflyAlias] = Relationship(back_populates="product")


class ProductCreate(SQLModel):
    name: str
    brand_id: Optional[int] = None
    barcode: Optional[str] = None
    sale_mode: Literal["packaged", "loose_weight"] = "packaged"
    pack_count: int = Field(default=1, ge=1)
    unit_size: Optional[float] = Field(default=None, gt=0)
    default_unit: Literal["g", "kg", "ml", "l", "pcs"] = "g"
    package_size: Optional[float] = Field(default=None, gt=0)
    firefly_category_id: Optional[int] = None
    firefly_category_name: Optional[str] = None
    notes: Optional[str] = None
    tag_ids: List[int] = []

    @model_validator(mode="after")
    def _sync_packaging_fields(self) -> "ProductCreate":
        if self.sale_mode == "loose_weight":
            self.pack_count = 1
            self.unit_size = 1.0
            self.package_size = 1.0
            return self

        if self.unit_size is not None:
            self.package_size = round(self.pack_count * self.unit_size, 6)
        elif self.package_size is not None:
            self.unit_size = round(self.package_size / self.pack_count, 6)
        else:
            self.unit_size = 1.0
            self.package_size = float(self.pack_count)
        return self


class ProductUpdate(SQLModel):
    name: Optional[str] = None
    brand_id: Optional[int] = None
    barcode: Optional[str] = None
    sale_mode: Optional[Literal["packaged", "loose_weight"]] = None
    pack_count: Optional[int] = Field(default=None, ge=1)
    unit_size: Optional[float] = Field(default=None, gt=0)
    default_unit: Optional[Literal["g", "kg", "ml", "l", "pcs"]] = None
    package_size: Optional[float] = Field(default=None, gt=0)
    firefly_category_id: Optional[int] = None
    firefly_category_name: Optional[str] = None
    notes: Optional[str] = None
    tag_ids: Optional[List[int]] = None


class ProductRead(ProductBase):
    id: int
    created_at: datetime
    brand: Optional[BrandRead] = None
    tags: List[TagRead] = []
    effective_tags: List[TagRead] = []
    aliases: List[ItemFireflyAliasRead] = []
    affected_firefly_count: int = 0

from datetime import datetime, timezone
from typing import Optional, List, Literal
import sqlalchemy as sa
from pydantic import field_validator, model_validator
from sqlmodel import SQLModel, Field, Relationship
from app.models.tag import Tag, TagRead, ProductTagLink
from app.models.brand import Brand, BrandRead


def build_alias_scope_key(
    company_id: Optional[int] = None,
    firefly_account_id: Optional[int] = None,
) -> str:
    """Returns canonical scope key with precedence: store > chain > global."""
    if firefly_account_id is not None:
        return f"store:{firefly_account_id}"
    if company_id is not None:
        return f"chain:{company_id}"
    return "global"


class ItemFireflyAliasBase(SQLModel):
    product_id: int = Field(foreign_key="product.id", index=True)
    raw_description: str
    normalized_description: str = Field(index=True)
    company_id: Optional[int] = Field(default=None, foreign_key="company.id", index=True)
    firefly_account_id: Optional[int] = Field(default=None, index=True)
    scope_key: str = Field(default="global", index=True)


class ItemFireflyAlias(ItemFireflyAliasBase, table=True):
    __tablename__ = "item_firefly_alias"
    __table_args__ = (
        sa.UniqueConstraint(
            "normalized_description",
            "scope_key",
            name="uq_item_firefly_alias_desc_scope",
        ),
    )

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

    @field_validator("name")
    @classmethod
    def _validate_non_blank_name(cls, v: str) -> str:
        cleaned = v.strip()
        if not cleaned:
            raise ValueError("Item name cannot be blank")
        return cleaned

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

    @model_validator(mode="after")
    def _reject_null_required_fields(self) -> "ProductUpdate":
        sent = self.model_fields_set
        non_nullable = ("name", "sale_mode", "pack_count", "unit_size", "default_unit")
        for field_name in non_nullable:
            if field_name in sent and getattr(self, field_name) is None:
                raise ValueError(f"Field '{field_name}' cannot be null")
        if "name" in sent and isinstance(self.name, str):
            cleaned = self.name.strip()
            if not cleaned:
                raise ValueError("Item name cannot be blank")
            self.name = cleaned
        return self


class ProductRead(ProductBase):
    id: int
    created_at: datetime
    brand: Optional[BrandRead] = None
    tags: List[TagRead] = []
    effective_tags: List[TagRead] = []
    aliases: List[ItemFireflyAliasRead] = []
    affected_firefly_count: int = 0
    firefly_description: str = ""


def _format_clean_number(value: float) -> str:
    if abs(value - round(value)) < 1e-6:
        return str(int(round(value)))
    return f"{value:.4f}".rstrip("0").rstrip(".")


def format_firefly_description(product: Product) -> str:
    """
    Builds the canonical Firefly III transaction/split description:
    - loose_weight: "<name> [<brand>]"
    - packaged (pcs): "<name> [<brand>] x<total_pcs>"
    - packaged (g/kg/ml/l, pack_count=1): "<name> [<brand>] <unit_size><default_unit>"
    - packaged (multipack, pack_count>1): "<name> [<brand>] <pack_count>x<unit_size><default_unit>"
    """
    parts: List[str] = [product.name.strip()]
    if product.brand and product.brand.name and product.brand.name.strip():
        parts.append(product.brand.name.strip())

    if product.sale_mode != "loose_weight":
        unit = (product.default_unit or "pcs").strip()
        pack_count = max(1, int(product.pack_count or 1))
        unit_size = float(product.unit_size or product.package_size or 1.0)
        if unit == "pcs":
            total_pcs = pack_count * unit_size
            parts.append(f"x{_format_clean_number(total_pcs)}")
        else:
            size_token = f"{_format_clean_number(unit_size)}{unit}"
            if pack_count > 1:
                parts.append(f"{pack_count}x{size_token}")
            else:
                parts.append(size_token)

    return " ".join(part for part in parts if part)

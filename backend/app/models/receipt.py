from datetime import datetime, date, time, timezone
import math
from typing import Optional, List, Literal
from pydantic import field_validator, model_validator
from sqlmodel import SQLModel, Field, Relationship
from app.models.product import Product, ProductRead


class ReceiptBase(SQLModel):
    firefly_account_id: int = Field(index=True)
    purchase_date: date = Field(default_factory=date.today, index=True)
    purchase_time: Optional[time] = Field(default=None, description="Time of purchase on receipt (HH:MM:SS)")
    total_amount: float = Field(default=0.0)
    basket_discount: float = Field(default=0.0)
    source_account_id: Optional[int] = Field(default=None, description="Primary Firefly asset account")
    payment_mode: str = Field(default="single", description="'single' or 'split_vouchers'")
    voucher_account_id: Optional[int] = Field(default=None, description="Firefly voucher asset account")
    voucher_count: int = Field(default=0)
    voucher_unit_value: float = Field(default=5.16)
    firefly_transaction_id: Optional[int] = Field(default=None, index=True)
    firefly_voucher_transaction_id: Optional[int] = Field(default=None, index=True)
    notes: Optional[str] = Field(default=None)


class Receipt(ReceiptBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    items: List["ReceiptItem"] = Relationship(back_populates="receipt")
    attachments: List["ReceiptAttachment"] = Relationship(back_populates="receipt")


class ReceiptItemBase(SQLModel):
    receipt_id: int = Field(foreign_key="receipt.id", index=True)
    product_id: int = Field(foreign_key="product.id", index=True)
    quantity: float = Field(default=1.0)
    unit: str = Field(default="pcs")
    package_size: float = Field(default=1.0)
    paid_price: float
    regular_price: Optional[float] = Field(default=None)
    is_discount: bool = Field(default=False)
    line_total: float


class ReceiptItem(ReceiptItemBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)

    receipt: Optional[Receipt] = Relationship(back_populates="items")
    product: Optional[Product] = Relationship()


class ReceiptAttachmentBase(SQLModel):
    receipt_id: int = Field(foreign_key="receipt.id", index=True)
    filename: str
    stored_path: str
    file_type: str
    file_size_bytes: int
    sha256_hash: str


class ReceiptAttachment(ReceiptAttachmentBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    uploaded_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    receipt: Optional[Receipt] = Relationship(back_populates="attachments")


class ReceiptItemCreate(SQLModel):
    product_id: int
    quantity: float = Field(default=1.0, gt=0)
    unit: Optional[Literal["g", "kg", "ml", "l", "pcs"]] = None
    package_size: Optional[float] = Field(default=None, gt=0)
    paid_price: Optional[float] = Field(default=None, ge=0)
    total_price: Optional[float] = Field(default=None, ge=0)
    regular_price: Optional[float] = Field(default=None, ge=0)
    is_discount: bool = False

    @field_validator("quantity", "package_size", "paid_price", "total_price", "regular_price")
    @classmethod
    def _validate_finite_item_float(cls, v: Optional[float]) -> Optional[float]:
        if v is not None and not math.isfinite(v):
            raise ValueError("Item numeric values must be finite numbers")
        return v

    @model_validator(mode="after")
    def _ensure_price_present(self) -> "ReceiptItemCreate":
        if self.paid_price is None and self.total_price is None:
            raise ValueError("Either paid_price or total_price must be provided")
        return self


class ReceiptCreate(SQLModel):
    firefly_account_id: int
    purchase_date: date = Field(default_factory=date.today)
    purchase_time: Optional[time] = Field(
        default_factory=lambda: datetime.now().time().replace(microsecond=0)
    )
    basket_discount: float = Field(default=0.0, ge=0)
    source_account_id: Optional[int] = None
    payment_mode: Literal["single", "split_vouchers"] = "single"
    voucher_account_id: Optional[int] = None
    voucher_count: int = Field(default=0, ge=0)
    voucher_unit_value: float = Field(default=5.16, gt=0)
    notes: Optional[str] = None
    items: List[ReceiptItemCreate] = Field(min_length=1)

    @field_validator("basket_discount", "voucher_unit_value")
    @classmethod
    def _validate_finite_float(cls, v: float) -> float:
        if not math.isfinite(v):
            raise ValueError("Monetary values must be finite numbers")
        return v


class ReceiptItemRead(ReceiptItemBase):
    id: int
    product: Optional[ProductRead] = None


class ReceiptRead(ReceiptBase):
    id: int
    created_at: datetime
    store_name: str = ""
    items: List[ReceiptItemRead] = []
    attachments: List[ReceiptAttachment] = []


class ReceiptPushRequest(SQLModel):
    force: bool = False

from datetime import datetime, date, timezone
from typing import Optional
from sqlmodel import SQLModel, Field, Relationship
from app.models.product import Product, ProductRead
from app.models.company import Store, StoreRead

class PriceRecordBase(SQLModel):
    product_id: int = Field(foreign_key="product.id", index=True)
    store_id: int = Field(foreign_key="store.id", index=True)
    recorded_date: date = Field(default_factory=date.today, index=True)
    
    # Pricing fields
    regular_price: float = Field(description="Regular / baseline shelf price (€)")
    paid_price: float = Field(description="Actual price paid (€)")
    is_discount: bool = Field(default=False, index=True)
    discount_type: Optional[str] = Field(default=None) # e.g. "percentage", "3x2", "coupon", "markdown"
    discount_note: Optional[str] = Field(default=None)
    
    # Quantity & Normalized price
    quantity: float = Field(default=1.0)
    unit: str = Field(default="pcs") # g, kg, ml, l, pcs
    package_size: Optional[float] = Field(default=None)
    normalized_unit_price: Optional[float] = Field(default=None, description="Calculated €/kg or €/L or €/pc")
    normalized_regular_price: Optional[float] = Field(default=None, description="Normalized regular shelf price (€/kg, €/L, €/pc)")
    
    # External reference
    firefly_transaction_id: Optional[int] = Field(default=None, index=True)
    notes: Optional[str] = Field(default=None)

class PriceRecord(PriceRecordBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    product: Optional[Product] = Relationship()
    store: Optional[Store] = Relationship()

class PriceRecordCreate(PriceRecordBase):
    pass

class PriceRecordRead(PriceRecordBase):
    id: int
    created_at: datetime
    product: Optional[ProductRead] = None
    store: Optional[StoreRead] = None

from datetime import datetime, date, timezone
from typing import Optional
from sqlmodel import SQLModel, Field


class FireflySyncedSplit(SQLModel, table=True):
    __tablename__ = "firefly_synced_split"

    id: Optional[int] = Field(default=None, primary_key=True)
    transaction_journal_id: int = Field(index=True, unique=True)
    firefly_transaction_id: int = Field(index=True)
    tx_type: str = Field(default="withdrawal", index=True)
    tx_date: date = Field(index=True)
    amount_cents: int
    description: str = Field(index=True)
    normalized_description: str = Field(index=True)
    firefly_expense_account_id: Optional[int] = Field(default=None, index=True)
    firefly_expense_account_name: Optional[str] = Field(default=None)
    firefly_category_name: Optional[str] = Field(default=None, index=True)
    tags_json: str = Field(default="[]")
    linked_product_id: Optional[int] = Field(default=None, foreign_key="product.id", index=True)
    is_ignored: bool = Field(default=False, index=True)
    synced_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class FireflySyncState(SQLModel, table=True):
    __tablename__ = "firefly_sync_state"

    id: int = Field(default=1, primary_key=True)
    last_full_sync_at: Optional[datetime] = Field(default=None)
    last_incremental_sync_at: Optional[datetime] = Field(default=None)
    high_watermark_date: Optional[date] = Field(default=None)

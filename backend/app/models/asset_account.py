from datetime import datetime, timezone
from enum import Enum
from typing import Optional
import sqlalchemy as sa
from sqlmodel import SQLModel, Field


class AssetAccountType(str, Enum):
    """Extensible classification for Firefly III asset accounts."""

    STANDARD = "standard"
    MEAL_VOUCHER = "meal_voucher"


class AssetAccountTypeDecorator(sa.TypeDecorator):
    """
    SQLAlchemy TypeDecorator storing AssetAccountType as lowercase VARCHAR(32)
    and deserializing case-insensitively with a safe fallback to STANDARD.
    """

    impl = sa.String(32)
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return AssetAccountType.STANDARD.value
        if isinstance(value, AssetAccountType):
            return value.value
        return str(value).lower()

    def process_result_value(self, value, dialect):
        if value is None:
            return AssetAccountType.STANDARD
        val_str = str(value).lower()
        for member in AssetAccountType:
            if member.value == val_str or member.name.lower() == val_str:
                return member
        return AssetAccountType.STANDARD


class AssetAccountMetadataBase(SQLModel):
    firefly_account_id: int = Field(primary_key=True)
    asset_type: AssetAccountType = Field(
        default=AssetAccountType.STANDARD,
        sa_column=sa.Column(
            AssetAccountTypeDecorator(),
            nullable=False,
            server_default="standard",
            index=True,
        ),
    )
    voucher_unit_value: Optional[float] = Field(default=None)
    default_revenue_account_id: Optional[int] = Field(default=None, index=True)
    default_recharge_description: Optional[str] = Field(default=None)
    notes: Optional[str] = Field(default=None)


class AssetAccountMetadata(AssetAccountMetadataBase, table=True):
    __tablename__ = "asset_account_metadata"

    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class AssetAccountMetadataUpdate(SQLModel):
    asset_type: AssetAccountType = AssetAccountType.STANDARD
    voucher_unit_value: Optional[float] = None
    default_revenue_account_id: Optional[int] = None
    default_recharge_description: Optional[str] = None
    notes: Optional[str] = None


class AssetAccountMetadataRead(AssetAccountMetadataBase):
    created_at: datetime
    updated_at: datetime

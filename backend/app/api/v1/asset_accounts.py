from datetime import date, datetime, time, timezone
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import Session

from app.core.database import get_session
from app.models.asset_account import (
    AssetAccountMetadata,
    AssetAccountMetadataUpdate,
    AssetAccountType,
)
from app.services.firefly import firefly_client
from app.services.vouchers import compute_voucher_balance_status, to_cents

router = APIRouter(prefix="/asset-accounts", tags=["Asset Accounts"])


class AssetAccountMetadataResponse(BaseModel):
    firefly_account_id: int
    asset_type: AssetAccountType
    voucher_unit_value: Optional[float] = None
    default_revenue_account_id: Optional[int] = None
    default_recharge_description: Optional[str] = None
    notes: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class VoucherRechargeRequest(BaseModel):
    count: int = Field(gt=0, description="Number of whole vouchers to deposit")
    recharge_date: date
    recharge_time: time
    revenue_account_id: Optional[int] = Field(default=None, gt=0)
    description: Optional[str] = None
    notes: Optional[str] = None


class VoucherRechargeResponse(BaseModel):
    firefly_transaction_id: int
    account_id: int
    revenue_account_id: int
    count: int
    unit_value: float
    amount: float
    current_balance: str
    usable_vouchers: int
    is_exact_multiple: bool
    balance_discrepancy: float


def _build_metadata_response(
    account_id: int, meta: Optional[AssetAccountMetadata]
) -> AssetAccountMetadataResponse:
    if not meta:
        return AssetAccountMetadataResponse(
            firefly_account_id=account_id,
            asset_type=AssetAccountType.STANDARD,
        )
    return AssetAccountMetadataResponse(
        firefly_account_id=meta.firefly_account_id,
        asset_type=meta.asset_type,
        voucher_unit_value=meta.voucher_unit_value,
        default_revenue_account_id=meta.default_revenue_account_id,
        default_recharge_description=meta.default_recharge_description,
        notes=meta.notes,
        created_at=meta.created_at,
        updated_at=meta.updated_at,
    )


@router.get("/{account_id}/metadata", response_model=AssetAccountMetadataResponse)
def get_asset_account_metadata(
    account_id: int,
    session: Session = Depends(get_session),
):
    """Fetch configuration metadata for a Firefly asset account."""
    meta = session.get(AssetAccountMetadata, account_id)
    return _build_metadata_response(account_id, meta)


@router.put("/{account_id}/metadata", response_model=AssetAccountMetadataResponse)
def update_asset_account_metadata(
    account_id: int,
    payload: AssetAccountMetadataUpdate,
    session: Session = Depends(get_session),
):
    """Configure an asset account as standard or meal_voucher with unit value and employer default."""
    asset_type = payload.asset_type
    voucher_unit_value: Optional[float] = None
    default_revenue_account_id: Optional[int] = None
    default_recharge_description: Optional[str] = None

    if asset_type == AssetAccountType.MEAL_VOUCHER:
        unit_cents = to_cents(payload.voucher_unit_value)
        if payload.voucher_unit_value is None or unit_cents <= 0:
            raise HTTPException(
                status_code=422,
                detail="voucher_unit_value must be greater than 0 for meal_voucher accounts",
            )
        voucher_unit_value = unit_cents / 100
        if payload.default_revenue_account_id is not None:
            if payload.default_revenue_account_id <= 0:
                raise HTTPException(
                    status_code=422,
                    detail="default_revenue_account_id must be a positive Firefly account ID",
                )
            default_revenue_account_id = payload.default_revenue_account_id
        if payload.default_recharge_description:
            stripped = payload.default_recharge_description.strip()
            default_recharge_description = stripped or None

    notes = payload.notes.strip() if payload.notes and payload.notes.strip() else None
    now = datetime.now(timezone.utc)
    meta = session.get(AssetAccountMetadata, account_id)
    if not meta:
        meta = AssetAccountMetadata(
            firefly_account_id=account_id,
            asset_type=asset_type,
            voucher_unit_value=voucher_unit_value,
            default_revenue_account_id=default_revenue_account_id,
            default_recharge_description=default_recharge_description,
            notes=notes,
            created_at=now,
            updated_at=now,
        )
    else:
        meta.asset_type = asset_type
        meta.voucher_unit_value = voucher_unit_value
        meta.default_revenue_account_id = default_revenue_account_id
        meta.default_recharge_description = default_recharge_description
        meta.notes = notes
        meta.updated_at = now

    session.add(meta)
    session.commit()
    session.refresh(meta)
    return _build_metadata_response(account_id, meta)


def _format_firefly_http_error(prefix: str, exc: httpx.HTTPError) -> str:
    if isinstance(exc, httpx.HTTPStatusError) and exc.response is not None:
        snippet = exc.response.text.strip().replace("\n", " ")[:300]
        if snippet:
            return f"{prefix}: HTTP {exc.response.status_code} ({snippet})"
    return f"{prefix}: {exc}"


@router.post("/{account_id}/recharge", response_model=VoucherRechargeResponse)
async def recharge_meal_vouchers(
    account_id: int,
    payload: VoucherRechargeRequest,
    session: Session = Depends(get_session),
):
    """Create a Firefly III deposit transaction adding `count` whole meal vouchers."""
    meta = session.get(AssetAccountMetadata, account_id)
    if (
        not meta
        or meta.asset_type != AssetAccountType.MEAL_VOUCHER
        or not meta.voucher_unit_value
        or to_cents(meta.voucher_unit_value) <= 0
    ):
        raise HTTPException(
            status_code=400,
            detail="Account is not configured as a meal voucher account",
        )

    revenue_account_id = (
        payload.revenue_account_id
        if payload.revenue_account_id is not None
        else meta.default_revenue_account_id
    )
    if not revenue_account_id:
        raise HTTPException(
            status_code=400,
            detail="An employer revenue account is required to recharge meal vouchers",
        )

    try:
        asset_acc = await firefly_client.get_account_by_id(
            account_id, expected_type="asset"
        )
        revenue_acc = await firefly_client.get_account_by_id(
            revenue_account_id, expected_type="revenue"
        )
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=502,
            detail=_format_firefly_http_error(
                "Unable to reach Firefly III to validate accounts", exc
            ),
        ) from exc

    if not asset_acc:
        raise HTTPException(
            status_code=404,
            detail=f"Firefly asset account #{account_id} not found",
        )
    if not asset_acc.get("attributes", {}).get("active", True):
        raise HTTPException(
            status_code=400,
            detail=f"Firefly asset account #{account_id} is inactive",
        )
    if not revenue_acc:
        raise HTTPException(
            status_code=404,
            detail=f"Firefly revenue account #{revenue_account_id} not found",
        )
    if not revenue_acc.get("attributes", {}).get("active", True):
        raise HTTPException(
            status_code=400,
            detail=f"Firefly revenue account #{revenue_account_id} is inactive",
        )

    unit_cents = to_cents(meta.voucher_unit_value)
    unit_value = unit_cents / 100
    amount_cents = payload.count * unit_cents
    amount = amount_cents / 100

    voucher_name = (meta.default_recharge_description or "").strip()
    default_formatted_desc = (
        f"{payload.count} x {voucher_name} Meal Vouchers"
        if voucher_name
        else f"{payload.count} x Meal Vouchers"
    )
    description = (payload.description or "").strip() or default_formatted_desc

    try:
        tx_resp = await firefly_client.create_voucher_recharge_deposit(
            voucher_account_id=account_id,
            revenue_account_id=revenue_account_id,
            amount=amount,
            recharge_date=payload.recharge_date,
            recharge_time=payload.recharge_time,
            description=description,
            category_name="Income: Benefits",
            tags=["Meal Voucher"],
            notes=payload.notes,
        )
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=502,
            detail=_format_firefly_http_error(
                "Failed to post recharge deposit to Firefly III", exc
            ),
        ) from exc

    tx_id = int(tx_resp["data"]["id"])

    # Refresh live balance from Firefly III (best-effort fallback if immediate fetch fails)
    refreshed_balance = asset_acc.get("attributes", {}).get("current_balance", "0")
    try:
        refreshed = await firefly_client.get_account_by_id(
            account_id, expected_type="asset"
        )
        if refreshed:
            refreshed_balance = refreshed.get("attributes", {}).get(
                "current_balance", refreshed_balance
            )
    except httpx.HTTPError:
        fallback_cents = to_cents(refreshed_balance) + amount_cents
        refreshed_balance = f"{fallback_cents / 100:.2f}"

    status = compute_voucher_balance_status(refreshed_balance, unit_value)
    return VoucherRechargeResponse(
        firefly_transaction_id=tx_id,
        account_id=account_id,
        revenue_account_id=revenue_account_id,
        count=payload.count,
        unit_value=unit_value,
        amount=amount,
        current_balance=str(refreshed_balance),
        usable_vouchers=status.usable_vouchers,
        is_exact_multiple=status.is_exact_multiple,
        balance_discrepancy=status.balance_discrepancy,
    )

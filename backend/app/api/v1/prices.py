from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, status
import httpx
from sqlalchemy.orm import selectinload
from sqlmodel import Session, select

from app.core.database import get_session
from app.models.price import (
    PriceRecord,
    PriceRecordCreate,
    PriceRecordRead,
    PriceRecordUpdate,
)
from app.models.product import Product
from app.services.firefly import firefly_client
from app.services.pricing import compute_deal_analysis, normalize_unit_price

router = APIRouter(prefix="/prices", tags=["Price Intelligence & History"])


def _resolve_normalized_regular_price(
    record: PriceRecord, product: Product
) -> Optional[float]:
    if record.normalized_regular_price is not None:
        return record.normalized_regular_price
    if record.paid_price > 0 and record.normalized_unit_price is not None:
        return round(
            record.regular_price * (record.normalized_unit_price / record.paid_price),
            3,
        )
    if record.quantity is None or record.quantity <= 0:
        return None
    pkg_size = (
        record.package_size
        if record.package_size is not None
        else product.package_size
    )
    return normalize_unit_price(
        price=record.regular_price,
        quantity=record.quantity,
        unit=record.unit or product.default_unit,
        package_size=pkg_size,
    )


async def _serialize_price_record(record: PriceRecord) -> PriceRecordRead:
    resolved_names = await firefly_client.resolve_expense_account_names(
        {record.firefly_account_id}
    )
    store_name = resolved_names.get(
        record.firefly_account_id,
        f"Account #{record.firefly_account_id}",
    )
    data = record.model_dump()
    data["product"] = record.product
    data["store_name"] = store_name
    return PriceRecordRead(**data)


@router.get("/history/{product_id}")
async def get_product_price_history(
    product_id: int, session: Session = Depends(get_session)
):
    product = session.exec(
        select(Product)
        .where(Product.id == product_id)
        .options(selectinload(Product.brand))
    ).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    records = session.exec(
        select(PriceRecord)
        .where(PriceRecord.product_id == product_id)
        .options(
            selectinload(PriceRecord.product).selectinload(Product.brand),
            selectinload(PriceRecord.product).selectinload(Product.tags),
        )
        .order_by(PriceRecord.recorded_date.asc(), PriceRecord.id.asc())
    ).all()

    base_payload = {
        "product_id": product.id,
        "product_name": product.name,
        "brand": product.brand.name if product.brand else None,
        "default_unit": product.default_unit,
    }

    if not records:
        return {
            **base_payload,
            "analysis": None,
            "records": [],
        }

    paid_prices = [r.paid_price for r in records]
    reg_prices = [r.regular_price for r in records]
    norm_paid_prices = [
        r.normalized_unit_price
        for r in records
        if r.normalized_unit_price is not None
    ]
    norm_reg_prices = [
        norm_reg
        for r in records
        if (norm_reg := _resolve_normalized_regular_price(r, product)) is not None
    ]
    latest = records[-1]

    analysis = compute_deal_analysis(
        current_price=latest.paid_price,
        regular_price=latest.regular_price,
        history_prices=paid_prices,
        history_regular_prices=reg_prices,
        normalized_current_price=latest.normalized_unit_price,
        normalized_prices=norm_paid_prices,
        normalized_regular_prices=norm_reg_prices,
    )

    account_ids = {r.firefly_account_id for r in records if r.firefly_account_id}
    resolved_names = await firefly_client.resolve_expense_account_names(account_ids)

    serialized_records: List[PriceRecordRead] = []
    for r in records:
        data = r.model_dump()
        data["product"] = r.product
        data["store_name"] = resolved_names.get(
            r.firefly_account_id, f"Account #{r.firefly_account_id}"
        )
        serialized_records.append(PriceRecordRead(**data))

    return {
        **base_payload,
        "analysis": analysis,
        "records": serialized_records,
    }


@router.post("/", response_model=PriceRecordRead, status_code=status.HTTP_201_CREATED)
async def record_price(
    price_in: PriceRecordCreate, session: Session = Depends(get_session)
):
    # 1. Validate product
    product = session.get(Product, price_in.product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    # 2. Validate Firefly account exists & is active
    try:
        acc = await firefly_client.get_expense_account(price_in.firefly_account_id)
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Unable to reach Firefly III to validate expense account: {exc}",
        ) from exc

    if not acc:
        raise HTTPException(
            status_code=404,
            detail=f"Firefly expense account #{price_in.firefly_account_id} not found in Firefly III",
        )
    if not acc.get("attributes", {}).get("active", True):
        raise HTTPException(
            status_code=400,
            detail=f"Firefly expense account #{price_in.firefly_account_id} is inactive",
        )

    effective_unit = price_in.unit or product.default_unit
    effective_pkg_size = (
        price_in.package_size
        if price_in.package_size is not None
        else product.package_size
    )

    norm_price = normalize_unit_price(
        price=price_in.paid_price,
        quantity=price_in.quantity,
        unit=effective_unit,
        package_size=effective_pkg_size,
    )
    norm_reg_price = normalize_unit_price(
        price=price_in.regular_price,
        quantity=price_in.quantity,
        unit=effective_unit,
        package_size=effective_pkg_size,
    )

    price_record = PriceRecord(
        product_id=price_in.product_id,
        firefly_account_id=price_in.firefly_account_id,
        recorded_date=price_in.recorded_date,
        regular_price=price_in.regular_price,
        paid_price=price_in.paid_price,
        is_discount=price_in.is_discount,
        discount_type=price_in.discount_type,
        discount_note=price_in.discount_note,
        quantity=price_in.quantity,
        unit=effective_unit,
        package_size=effective_pkg_size,
        normalized_unit_price=norm_price,
        normalized_regular_price=norm_reg_price,
        firefly_transaction_id=price_in.firefly_transaction_id,
        source_type="manual",
        verification_status="verified",
        notes=price_in.notes,
    )

    session.add(price_record)
    session.commit()

    loaded = session.exec(
        select(PriceRecord)
        .where(PriceRecord.id == price_record.id)
        .options(
            selectinload(PriceRecord.product).selectinload(Product.brand),
            selectinload(PriceRecord.product).selectinload(Product.tags),
        )
    ).first()
    return await _serialize_price_record(loaded)


@router.patch("/{price_record_id}", response_model=PriceRecordRead)
async def update_price_record(
    price_record_id: int,
    payload: PriceRecordUpdate,
    session: Session = Depends(get_session),
):
    """Locally updates quantity, unit, discount metadata, and verification status without touching Firefly III."""
    record = session.exec(
        select(PriceRecord)
        .where(PriceRecord.id == price_record_id)
        .options(
            selectinload(PriceRecord.product).selectinload(Product.brand),
            selectinload(PriceRecord.product).selectinload(Product.tags),
        )
    ).first()
    if not record:
        raise HTTPException(status_code=404, detail="Price record not found")

    sent = payload.model_fields_set
    if "quantity" in sent and payload.quantity is not None:
        record.quantity = payload.quantity
    if "unit" in sent and payload.unit is not None:
        record.unit = payload.unit
    if "notes" in sent:
        record.notes = payload.notes

    if "is_discount" in sent and payload.is_discount is not None:
        record.is_discount = payload.is_discount
        if not payload.is_discount and "regular_price" not in sent:
            record.regular_price = record.paid_price

    if "regular_price" in sent and payload.regular_price is not None:
        record.regular_price = payload.regular_price
        if "is_discount" not in sent:
            record.is_discount = payload.regular_price > record.paid_price

    if record.quantity is None or record.quantity <= 0:
        if payload.confirm_verified:
            raise HTTPException(
                status_code=422,
                detail="Cannot verify a price record without a valid quantity",
            )
        record.normalized_unit_price = None
        record.normalized_regular_price = None
    else:
        eff_pkg_size = (
            record.package_size
            if record.package_size is not None and record.package_size > 0
            else (record.product.package_size if record.product else 1.0)
        )
        eff_unit = record.unit or (record.product.default_unit if record.product else "pcs")
        record.normalized_unit_price = normalize_unit_price(
            price=record.paid_price,
            quantity=record.quantity,
            unit=eff_unit,
            package_size=eff_pkg_size,
        )
        record.normalized_regular_price = normalize_unit_price(
            price=record.regular_price,
            quantity=record.quantity,
            unit=eff_unit,
            package_size=eff_pkg_size,
        )
        if payload.confirm_verified:
            record.verification_status = "verified"

    session.add(record)
    session.commit()
    session.refresh(record)

    loaded = session.exec(
        select(PriceRecord)
        .where(PriceRecord.id == record.id)
        .options(
            selectinload(PriceRecord.product).selectinload(Product.brand),
            selectinload(PriceRecord.product).selectinload(Product.tags),
        )
    ).first()
    return await _serialize_price_record(loaded)

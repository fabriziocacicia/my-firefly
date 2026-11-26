import statistics
from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.orm import selectinload
from sqlmodel import Session, select

from app.core.database import get_session
from app.models.firefly_cache import FireflySyncedSplit
from app.models.price import PriceRecord
from app.models.product import Product
from app.models.receipt import Receipt, ReceiptItem
from app.models.tag import Tag, TagRead
from app.services.taxonomy import (
    expand_tag_ids,
    expand_tags_ordered,
    get_implication_map,
)

router = APIRouter(prefix="/analytics", tags=["Analytics"])


class ItemAnalyticsSummary(BaseModel):
    product_id: int
    product_name: str
    brand_name: Optional[str] = None
    firefly_category_name: Optional[str] = None
    sale_mode: str
    default_unit: str
    effective_tag_names: List[str] = []
    total_spend: float
    purchase_count: int
    min_unit_price: Optional[float] = None
    median_unit_price: Optional[float] = None
    latest_unit_price: Optional[float] = None
    normalized_unit_label: str


class TagAnalyticsResponse(BaseModel):
    total_spend: float
    total_purchases: int
    matching_item_count: int
    applied_tags: List[TagRead] = []
    items: List[ItemAnalyticsSummary] = []


def _normalized_unit_label(default_unit: str) -> str:
    clean = (default_unit or "").lower().strip()
    if clean in ("g", "kg"):
        return "€/kg"
    if clean in ("ml", "l"):
        return "€/L"
    return "€/pc"


@router.get("/tags", response_model=TagAnalyticsResponse)
def get_tag_analytics(
    tag_ids: List[int] = Query(default=[]),
    category_name: Optional[str] = Query(default=None),
    start_date: Optional[date] = Query(default=None),
    end_date: Optional[date] = Query(default=None),
    session: Session = Depends(get_session),
):
    all_tags = session.exec(select(Tag)).all()
    all_tags_by_id = {t.id: t for t in all_tags if t.id is not None}
    implications = get_implication_map(session)

    required_tag_set = set(tag_ids)
    applied_tags = [all_tags_by_id[tid] for tid in tag_ids if tid in all_tags_by_id]

    products = session.exec(
        select(Product).options(
            selectinload(Product.brand),
            selectinload(Product.tags),
        )
    ).all()

    matched_products: dict[int, tuple[Product, List[Tag]]] = {}
    for prod in products:
        if prod.id is None:
            continue
        if category_name and prod.firefly_category_name != category_name:
            continue
        direct_ids = [t.id for t in prod.tags if t.id is not None]
        effective_ids = expand_tag_ids(direct_ids, implications)
        if required_tag_set and not required_tag_set.issubset(effective_ids):
            continue
        ordered_effective = expand_tags_ordered(prod.tags, all_tags_by_id, implications)
        matched_products[prod.id] = (prod, ordered_effective)

    if not matched_products:
        return TagAnalyticsResponse(
            total_spend=0.0,
            total_purchases=0,
            matching_item_count=0,
            applied_tags=applied_tags,
            items=[],
        )

    matched_ids = list(matched_products.keys())
    spend_cents_by_pid: dict[int, int] = {pid: 0 for pid in matched_ids}
    count_by_pid: dict[int, int] = {pid: 0 for pid in matched_ids}

    # Collect Firefly transaction IDs already owned by companion-app receipts to prevent double counting
    receipt_tx_rows = session.exec(
        select(Receipt.firefly_transaction_id, Receipt.firefly_voucher_transaction_id).where(
            (Receipt.firefly_transaction_id.is_not(None))
            | (Receipt.firefly_voucher_transaction_id.is_not(None))
        )
    ).all()
    pushed_ff_tx_ids: set[int] = set()
    for tx_id, v_tx_id in receipt_tx_rows:
        if tx_id is not None:
            pushed_ff_tx_ids.add(tx_id)
        if v_tx_id is not None:
            pushed_ff_tx_ids.add(v_tx_id)

    # 1. Companion ReceiptItem observations
    ri_query = (
        select(ReceiptItem, Receipt.purchase_date)
        .join(Receipt, Receipt.id == ReceiptItem.receipt_id)
        .where(ReceiptItem.product_id.in_(matched_ids))
    )
    if start_date is not None:
        ri_query = ri_query.where(Receipt.purchase_date >= start_date)
    if end_date is not None:
        ri_query = ri_query.where(Receipt.purchase_date <= end_date)
    for ri, _ in session.exec(ri_query).all():
        spend_cents_by_pid[ri.product_id] += round(ri.line_total * 100)
        count_by_pid[ri.product_id] += 1

    # 2. Historical linked FireflySyncedSplit observations (excluding pushed receipt tx IDs and ignored splits)
    split_query = select(FireflySyncedSplit).where(
        FireflySyncedSplit.linked_product_id.in_(matched_ids),
        FireflySyncedSplit.is_ignored.is_(False),
    )
    if start_date is not None:
        split_query = split_query.where(FireflySyncedSplit.tx_date >= start_date)
    if end_date is not None:
        split_query = split_query.where(FireflySyncedSplit.tx_date <= end_date)
    for split in session.exec(split_query).all():
        if split.firefly_transaction_id in pushed_ff_tx_ids:
            continue
        if split.linked_product_id is not None:
            spend_cents_by_pid[split.linked_product_id] += split.amount_cents
            count_by_pid[split.linked_product_id] += 1

    # 3. Normalized unit-price intelligence from PriceRecords
    price_query = (
        select(PriceRecord)
        .where(PriceRecord.product_id.in_(matched_ids))
        .order_by(PriceRecord.recorded_date.asc(), PriceRecord.id.asc())
    )
    if start_date is not None:
        price_query = price_query.where(PriceRecord.recorded_date >= start_date)
    if end_date is not None:
        price_query = price_query.where(PriceRecord.recorded_date <= end_date)

    norm_prices_by_pid: dict[int, List[float]] = {pid: [] for pid in matched_ids}
    for pr in session.exec(price_query).all():
        if pr.normalized_unit_price is not None:
            norm_prices_by_pid[pr.product_id].append(pr.normalized_unit_price)

    items_summary: List[ItemAnalyticsSummary] = []
    total_spend_cents = 0
    total_purchases = 0

    for pid, (prod, eff_tags) in matched_products.items():
        cents = spend_cents_by_pid[pid]
        purchases = count_by_pid[pid]
        total_spend_cents += cents
        total_purchases += purchases

        prices = norm_prices_by_pid[pid]
        items_summary.append(
            ItemAnalyticsSummary(
                product_id=pid,
                product_name=prod.name,
                brand_name=prod.brand.name if prod.brand else None,
                firefly_category_name=prod.firefly_category_name,
                sale_mode=prod.sale_mode,
                default_unit=prod.default_unit,
                effective_tag_names=[t.name for t in eff_tags],
                total_spend=round(cents / 100.0, 2),
                purchase_count=purchases,
                min_unit_price=min(prices) if prices else None,
                median_unit_price=(
                    round(statistics.median(prices), 3) if prices else None
                ),
                latest_unit_price=prices[-1] if prices else None,
                normalized_unit_label=_normalized_unit_label(prod.default_unit),
            )
        )

    items_summary.sort(key=lambda i: (-i.total_spend, i.product_name.lower()))

    return TagAnalyticsResponse(
        total_spend=round(total_spend_cents / 100.0, 2),
        total_purchases=total_purchases,
        matching_item_count=len(items_summary),
        applied_tags=applied_tags,
        items=items_summary,
    )

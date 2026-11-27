from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy import or_
from sqlalchemy.orm import selectinload
from sqlmodel import Session, select

from app.services.firefly_sync_jobs import (
    FireflySyncJobResponse,
    enqueue_firefly_rewrite_job,
    serialize_sync_job,
)
from app.core.database import get_session
from app.models.brand import Brand, BrandCreate, BrandRead
from app.models.firefly_cache import FireflySyncJob, FireflySyncedSplit
from app.models.price import PriceRecord
from app.models.product import (
    ItemFireflyAlias,
    Product,
    ProductCreate,
    ProductRead,
    ProductUpdate,
    format_firefly_description,
)
from app.models.receipt import Receipt, ReceiptItem
from app.models.tag import ProductTagLink, Tag
from app.services.taxonomy import (
    expand_tags_ordered,
    get_descendant_tag_ids,
    get_implication_map,
    prune_redundant_ancestor_tag_ids,
)

router = APIRouter(prefix="/products", tags=["Products & Brands"])


def compute_affected_firefly_stats(
    session: Session, product_ids: list[int]
) -> dict[int, tuple[set[int], int]]:
    """
    Returns `{product_id: (distinct_firefly_tx_ids, total_split_count)}` across
    non-ignored FireflySyncedSplit rows and pushed Receipt transactions.
    """
    if not product_ids:
        return {}

    tx_sets: dict[int, set[int]] = {pid: set() for pid in product_ids}
    synced_tx_sets: dict[int, set[int]] = {pid: set() for pid in product_ids}
    split_counts: dict[int, int] = {pid: 0 for pid in product_ids}

    synced_rows = session.exec(
        select(
            FireflySyncedSplit.linked_product_id,
            FireflySyncedSplit.firefly_transaction_id,
        ).where(
            FireflySyncedSplit.linked_product_id.in_(product_ids),
            FireflySyncedSplit.is_ignored.is_(False),
        )
    ).all()
    for pid, tx_id in synced_rows:
        if pid is not None and pid in tx_sets:
            split_counts[pid] += 1
            if tx_id is not None:
                tx_sets[pid].add(tx_id)
                synced_tx_sets[pid].add(tx_id)

    receipt_rows = session.exec(
        select(
            ReceiptItem.product_id,
            Receipt.firefly_transaction_id,
            Receipt.firefly_voucher_transaction_id,
        )
        .join(Receipt, Receipt.id == ReceiptItem.receipt_id)
        .where(ReceiptItem.product_id.in_(product_ids))
    ).all()
    extra_tx_sets: dict[int, set[int]] = {pid: set() for pid in product_ids}
    for pid, tx_id, v_tx_id in receipt_rows:
        if pid in tx_sets:
            for candidate_tx in (tx_id, v_tx_id):
                if candidate_tx is not None:
                    tx_sets[pid].add(candidate_tx)
                    if candidate_tx not in synced_tx_sets[pid]:
                        extra_tx_sets[pid].add(candidate_tx)

    return {
        pid: (tx_sets[pid], split_counts[pid] + len(extra_tx_sets[pid]))
        for pid in product_ids
    }


def _compute_affected_firefly_counts(
    session: Session, product_ids: list[int]
) -> dict[int, int]:
    """Counts distinct linked Firefly transaction IDs per product across cache & pushed receipts."""
    stats = compute_affected_firefly_stats(session, product_ids)
    return {pid: len(tx_ids) for pid, (tx_ids, _) in stats.items()}


def serialize_products(session: Session, products: list[Product]) -> list[ProductRead]:
    if not products:
        return []
    all_tags = session.exec(select(Tag)).all()
    all_tags_by_id = {t.id: t for t in all_tags if t.id is not None}
    implications = get_implication_map(session)
    affected_counts = _compute_affected_firefly_counts(
        session, [p.id for p in products if p.id is not None]
    )

    serialized: list[ProductRead] = []
    for p in products:
        effective = expand_tags_ordered(p.tags, all_tags_by_id, implications)
        data = p.model_dump()
        data["brand"] = p.brand
        data["tags"] = p.tags
        data["effective_tags"] = effective
        data["aliases"] = p.aliases
        data["affected_firefly_count"] = affected_counts.get(p.id, 0)
        data["firefly_description"] = format_firefly_description(p)
        serialized.append(ProductRead(**data))
    return serialized


def _load_product_or_404(session: Session, product_id: int) -> Product:
    product = session.exec(
        select(Product)
        .where(Product.id == product_id)
        .options(
            selectinload(Product.brand),
            selectinload(Product.tags),
            selectinload(Product.aliases),
        )
    ).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    return product


# Brands
@router.get("/brands", response_model=list[BrandRead])
def list_brands(session: Session = Depends(get_session)):
    return session.exec(select(Brand)).all()


@router.post("/brands", response_model=BrandRead)
def create_brand(brand_in: BrandCreate, session: Session = Depends(get_session)):
    existing = session.exec(select(Brand).where(Brand.name == brand_in.name)).first()
    if existing:
        return existing
    brand = Brand.model_validate(brand_in)
    session.add(brand)
    session.commit()
    session.refresh(brand)
    return brand


# Products
@router.get("/", response_model=list[ProductRead])
def list_products(
    search: str | None = None,
    brand_id: int | None = None,
    tag_id: int | None = None,
    firefly_category_name: str | None = None,
    session: Session = Depends(get_session),
):
    query = select(Product).options(
        selectinload(Product.brand),
        selectinload(Product.tags),
        selectinload(Product.aliases),
    )
    if search:
        query = query.outerjoin(Brand).where(
            or_(
                Product.name.ilike(f"%{search}%"),
                Brand.name.ilike(f"%{search}%"),
            )
        )
    if brand_id:
        query = query.where(Product.brand_id == brand_id)
    if firefly_category_name:
        query = query.where(Product.firefly_category_name == firefly_category_name)
    if tag_id:
        implications = get_implication_map(session)
        matching_tag_ids = get_descendant_tag_ids(tag_id, implications)
        query = (
            query.join(ProductTagLink)
            .where(ProductTagLink.tag_id.in_(matching_tag_ids))
            .distinct()
        )

    products = session.exec(query).all()
    products.sort(key=lambda p: p.name.lower())
    return serialize_products(session, products)


@router.get("/{product_id}", response_model=ProductRead)
def get_product(product_id: int, session: Session = Depends(get_session)):
    product = _load_product_or_404(session, product_id)
    return serialize_products(session, [product])[0]


def _sync_product_tag_links(
    session: Session, product_id: int, raw_tag_ids: list[int], replace: bool = False
) -> None:
    """Resolves valid tag IDs, prunes redundant implied ancestors, and writes ProductTagLink rows."""
    if replace:
        existing_links = session.exec(
            select(ProductTagLink).where(ProductTagLink.product_id == product_id)
        ).all()
        for link in existing_links:
            session.delete(link)
        session.flush()

    valid_ids = [
        tid
        for tid in dict.fromkeys(raw_tag_ids)
        if session.get(Tag, tid) is not None
    ]
    implications = get_implication_map(session)
    minimal_ids = prune_redundant_ancestor_tag_ids(valid_ids, implications)
    for tid in minimal_ids:
        session.add(ProductTagLink(product_id=product_id, tag_id=tid))


@router.post("/", response_model=ProductRead)
def create_product(product_in: ProductCreate, session: Session = Depends(get_session)):
    if product_in.brand_id is not None and not session.get(Brand, product_in.brand_id):
        raise HTTPException(status_code=404, detail="Brand not found")

    product = Product(
        name=product_in.name.strip(),
        brand_id=product_in.brand_id,
        barcode=product_in.barcode,
        sale_mode=product_in.sale_mode,
        pack_count=product_in.pack_count,
        unit_size=product_in.unit_size or 1.0,
        default_unit=product_in.default_unit,
        package_size=product_in.package_size or 1.0,
        firefly_category_id=product_in.firefly_category_id,
        firefly_category_name=(
            product_in.firefly_category_name.strip()
            if product_in.firefly_category_name
            else None
        ),
        notes=product_in.notes,
    )
    session.add(product)
    session.flush()

    _sync_product_tag_links(session, product.id, product_in.tag_ids, replace=False)
    session.commit()

    loaded = _load_product_or_404(session, product.id)
    return serialize_products(session, [loaded])[0]


@router.patch("/{product_id}", response_model=ProductRead)
def update_product(
    product_id: int,
    product_in: ProductUpdate,
    session: Session = Depends(get_session),
):
    product = _load_product_or_404(session, product_id)
    updates = product_in.model_dump(exclude_unset=True)
    tag_ids = updates.pop("tag_ids", None)

    if updates.get("brand_id") is not None and not session.get(Brand, updates["brand_id"]):
        raise HTTPException(status_code=404, detail="Brand not found")

    for key, value in updates.items():
        if key == "name" and isinstance(value, str):
            value = value.strip()
        elif key == "firefly_category_name" and isinstance(value, str):
            value = value.strip() or None
        setattr(product, key, value)

    if product.sale_mode == "loose_weight":
        product.pack_count = 1
        product.unit_size = 1.0
        product.package_size = 1.0
    else:
        if "package_size" in updates and "unit_size" not in updates and updates["package_size"]:
            product.unit_size = round(float(updates["package_size"]) / max(product.pack_count, 1), 6)
        product.package_size = round(max(product.pack_count, 1) * max(product.unit_size, 0.0001), 6)

    session.add(product)

    if tag_ids is not None:
        _sync_product_tag_links(session, product.id, tag_ids, replace=True)

    session.commit()
    loaded = _load_product_or_404(session, product.id)
    return serialize_products(session, [loaded])[0]


class BatchPropagateRequest(BaseModel):
    product_ids: list[int]


class BatchPropagateResponse(BaseModel):
    jobs: list[FireflySyncJobResponse]
    skipped_active_product_ids: list[int]


def _collect_and_enqueue_propagation_job(
    session: Session, product: Product
) -> FireflySyncJob:
    """Collects linked splits & receipt transactions for `product` and enqueues a rewrite job."""
    linked_splits = session.exec(
        select(FireflySyncedSplit).where(
            FireflySyncedSplit.linked_product_id == product.id,
            FireflySyncedSplit.is_ignored.is_(False),
        )
    ).all()
    synced_tx_ids = {s.firefly_transaction_id for s in linked_splits}
    receipt_tx_rows = session.exec(
        select(
            Receipt.firefly_transaction_id,
            Receipt.firefly_voucher_transaction_id,
        )
        .select_from(Receipt)
        .join(ReceiptItem, ReceiptItem.receipt_id == Receipt.id)
        .where(ReceiptItem.product_id == product.id)
    ).all()
    extra_tx_ids: set[int] = set()
    for tx_id, v_tx_id in receipt_tx_rows:
        if tx_id is not None and tx_id not in synced_tx_ids:
            extra_tx_ids.add(tx_id)
        if v_tx_id is not None and v_tx_id not in synced_tx_ids:
            extra_tx_ids.add(v_tx_id)

    match_descriptions = {
        format_firefly_description(product).lower(),
        product.name.strip().lower(),
        *(a.normalized_description for a in product.aliases),
    }

    return enqueue_firefly_rewrite_job(
        session,
        product,
        linked_splits,
        job_type="product_propagate",
        extra_tx_ids=extra_tx_ids,
        match_descriptions_lower=match_descriptions,
    )


@router.post("/propagate-firefly-batch", status_code=202, response_model=BatchPropagateResponse)
async def propagate_products_batch_to_firefly(
    payload: BatchPropagateRequest,
    session: Session = Depends(get_session),
):
    """
    Enqueues Firefly III propagation jobs for multiple products, skipping items
    with zero linked transactions or already running jobs.
    """
    unique_ids = list(dict.fromkeys(payload.product_ids))
    if not unique_ids:
        return BatchPropagateResponse(jobs=[], skipped_active_product_ids=[])

    active_rows = session.exec(
        select(FireflySyncJob.product_id).where(
            FireflySyncJob.product_id.in_(unique_ids),
            FireflySyncJob.status.in_(["queued", "running"]),
        )
    ).all()
    active_pids = set(active_rows)
    stats = compute_affected_firefly_stats(session, unique_ids)

    jobs: list[FireflySyncJobResponse] = []
    skipped_active: list[int] = []
    for pid in unique_ids:
        if pid in active_pids:
            skipped_active.append(pid)
            continue
        tx_ids, _ = stats.get(pid, (set(), 0))
        if not tx_ids:
            continue
        product = session.exec(
            select(Product)
            .where(Product.id == pid)
            .options(
                selectinload(Product.brand),
                selectinload(Product.tags),
                selectinload(Product.aliases),
            )
        ).first()
        if not product:
            continue
        job = _collect_and_enqueue_propagation_job(session, product)
        jobs.append(serialize_sync_job(job))

    return BatchPropagateResponse(
        jobs=jobs,
        skipped_active_product_ids=skipped_active,
    )


@router.post("/{product_id}/propagate-firefly", status_code=202, response_model=FireflySyncJobResponse)
async def propagate_product_to_firefly(
    product_id: int,
    session: Session = Depends(get_session),
):
    """
    Enqueues a background job to rewrite all linked Firefly III splits (and any
    unsynced pushed receipt transactions) for `product_id`.
    """
    product = _load_product_or_404(session, product_id)
    job = _collect_and_enqueue_propagation_job(session, product)
    return serialize_sync_job(job)


@router.delete("/{product_id}", status_code=204)
def delete_product(product_id: int, session: Session = Depends(get_session)):
    """
    Deletes a catalog item when no companion ReceiptItem rows depend on it.
    Blocks deletion if a Firefly sync job is currently active for the item.
    Unlinks cached FireflySyncedSplit rows back to the unassociated backlog and
    cleans up tag links, Firefly aliases, sync job history, and PriceRecords.
    """
    product = session.get(Product, product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    active_job = session.exec(
        select(FireflySyncJob).where(
            FireflySyncJob.product_id == product_id,
            FireflySyncJob.status.in_(["queued", "running"]),
        )
    ).first()
    if active_job:
        raise HTTPException(
            status_code=409,
            detail=f"Cannot delete '{product.name}' while Firefly sync job #{active_job.id} is running.",
        )

    receipt_items = session.exec(
        select(ReceiptItem.id).where(ReceiptItem.product_id == product_id)
    ).all()
    if receipt_items:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Cannot delete '{product.name}' because it is referenced by "
                f"{len(receipt_items)} saved receipt item(s)."
            ),
        )

    linked_splits = session.exec(
        select(FireflySyncedSplit).where(
            FireflySyncedSplit.linked_product_id == product_id
        )
    ).all()
    for split in linked_splits:
        split.linked_product_id = None
        session.add(split)

    for job in session.exec(
        select(FireflySyncJob).where(FireflySyncJob.product_id == product_id)
    ).all():
        session.delete(job)

    for link in session.exec(
        select(ProductTagLink).where(ProductTagLink.product_id == product_id)
    ).all():
        session.delete(link)

    for alias in session.exec(
        select(ItemFireflyAlias).where(ItemFireflyAlias.product_id == product_id)
    ).all():
        session.delete(alias)

    for price in session.exec(
        select(PriceRecord).where(PriceRecord.product_id == product_id)
    ).all():
        session.delete(price)

    session.delete(product)
    session.commit()
    return Response(status_code=204)

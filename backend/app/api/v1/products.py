from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import or_
from sqlalchemy.orm import selectinload
from sqlmodel import Session, select

from app.api.v1.firefly_sync import (
    RewriteResultResponse,
    rewrite_firefly_splits_for_product,
)
from app.core.database import get_session
from app.models.brand import Brand, BrandCreate, BrandRead
from app.models.firefly_cache import FireflySyncedSplit
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
)

router = APIRouter(prefix="/products", tags=["Products & Brands"])


def _compute_affected_firefly_counts(
    session: Session, product_ids: list[int]
) -> dict[int, int]:
    """Counts distinct linked Firefly transaction IDs per product across cache & pushed receipts."""
    if not product_ids:
        return {}

    tx_sets: dict[int, set[int]] = {pid: set() for pid in product_ids}

    synced_rows = session.exec(
        select(
            FireflySyncedSplit.linked_product_id,
            FireflySyncedSplit.firefly_transaction_id,
        ).where(FireflySyncedSplit.linked_product_id.in_(product_ids))
    ).all()
    for pid, tx_id in synced_rows:
        if pid is not None and tx_id is not None:
            tx_sets[pid].add(tx_id)

    receipt_rows = session.exec(
        select(
            ReceiptItem.product_id,
            Receipt.firefly_transaction_id,
            Receipt.firefly_voucher_transaction_id,
        )
        .join(Receipt, Receipt.id == ReceiptItem.receipt_id)
        .where(ReceiptItem.product_id.in_(product_ids))
    ).all()
    for pid, tx_id, v_tx_id in receipt_rows:
        if pid in tx_sets:
            if tx_id is not None:
                tx_sets[pid].add(tx_id)
            if v_tx_id is not None:
                tx_sets[pid].add(v_tx_id)

    return {pid: len(tids) for pid, tids in tx_sets.items()}


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


@router.post("/", response_model=ProductRead)
def create_product(product_in: ProductCreate, session: Session = Depends(get_session)):
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
    session.commit()
    session.refresh(product)

    for tid in dict.fromkeys(product_in.tag_ids):
        tag = session.get(Tag, tid)
        if tag:
            session.add(ProductTagLink(product_id=product.id, tag_id=tag.id))
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
        existing_links = session.exec(
            select(ProductTagLink).where(ProductTagLink.product_id == product.id)
        ).all()
        for link in existing_links:
            session.delete(link)
        session.flush()
        for tid in dict.fromkeys(tag_ids):
            tag = session.get(Tag, tid)
            if tag:
                session.add(ProductTagLink(product_id=product.id, tag_id=tag.id))

    session.commit()
    loaded = _load_product_or_404(session, product.id)
    return serialize_products(session, [loaded])[0]


@router.post("/{product_id}/propagate-firefly", response_model=RewriteResultResponse)
async def propagate_product_to_firefly(
    product_id: int,
    session: Session = Depends(get_session),
):
    """
    Explicitly rewrites all linked Firefly III splits for `product_id` so their
    description, category, and expanded tags match the item's current card.
    """
    product = _load_product_or_404(session, product_id)
    linked_splits = session.exec(
        select(FireflySyncedSplit).where(
            FireflySyncedSplit.linked_product_id == product.id
        )
    ).all()
    updated_txs, updated_splits, failures, succeeded = (
        await rewrite_firefly_splits_for_product(session, product, linked_splits)
    )
    return RewriteResultResponse(
        linked_splits=len(succeeded),
        updated_transactions=updated_txs,
        updated_splits=updated_splits,
        failed_transactions=failures,
    )


@router.delete("/{product_id}", status_code=204)
def delete_product(product_id: int, session: Session = Depends(get_session)):
    """
    Deletes a catalog item when no companion ReceiptItem rows depend on it.
    Unlinks cached FireflySyncedSplit rows back to the unassociated backlog and
    cleans up tag links, Firefly aliases, and synced/manual PriceRecords.
    """
    product = session.get(Product, product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

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

import hashlib
import os
from io import BytesIO
from pathlib import Path
from typing import List, Optional

import filetype
import httpx
import pillow_heif
from fastapi import APIRouter, Body, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from PIL import Image, ImageOps
from sqlalchemy.orm import selectinload
from sqlmodel import Session, select

from app.core.config import settings
from app.core.database import get_session
from app.models.asset_account import AssetAccountMetadata, AssetAccountType
from app.models.price import PriceRecord
from app.models.product import Product, format_firefly_description
from app.models.receipt import (
    Receipt,
    ReceiptAttachment,
    ReceiptCreate,
    ReceiptItem,
    ReceiptPushRequest,
    ReceiptRead,
)
from app.models.tag import Tag
from app.services.firefly import firefly_client
from app.services.pricing import normalize_unit_price
from app.services.taxonomy import expand_tags_ordered, get_implication_map
from app.services.vouchers import compute_voucher_balance_status, to_cents

pillow_heif.register_heif_opener()

router = APIRouter(prefix="/receipts", tags=["Receipts Workbench & Vault"])

MAX_UPLOAD_BYTES = 15 * 1024 * 1024  # 15 MB
ALLOWED_MIME_TO_EXT = {
    "image/heic": "heic",
    "image/heif": "heif",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "application/pdf": "pdf",
}


def _receipt_loader_options():
    return [
        selectinload(Receipt.items)
        .selectinload(ReceiptItem.product)
        .selectinload(Product.brand),
        selectinload(Receipt.items)
        .selectinload(ReceiptItem.product)
        .selectinload(Product.tags),
        selectinload(Receipt.attachments),
    ]


def _get_receipt_or_404(session: Session, receipt_id: int) -> Receipt:
    statement = (
        select(Receipt)
        .where(Receipt.id == receipt_id)
        .options(*_receipt_loader_options())
    )
    receipt = session.exec(statement).first()
    if not receipt:
        raise HTTPException(status_code=404, detail="Receipt not found")
    return receipt


async def _hydrate_receipt_store_names(
    receipts: List[Receipt],
) -> List[ReceiptRead]:
    if not receipts:
        return []
    account_ids = {r.firefly_account_id for r in receipts if r.firefly_account_id}
    resolved_names = await firefly_client.resolve_expense_account_names(account_ids)
    results: List[ReceiptRead] = []
    for r in receipts:
        data = r.model_dump()
        data["items"] = r.items
        data["attachments"] = r.attachments
        data["store_name"] = resolved_names.get(
            r.firefly_account_id, f"Account #{r.firefly_account_id}"
        )
        results.append(ReceiptRead(**data))
    return results


async def _get_receipt_read_or_404(
    session: Session, receipt_id: int
) -> ReceiptRead:
    receipt = _get_receipt_or_404(session, receipt_id)
    hydrated = await _hydrate_receipt_store_names([receipt])
    return hydrated[0]


def _allocate_weighted_cents(weights: List[int], target_cents: int) -> List[int]:
    """
    Allocates `target_cents` across entries with a 1-cent floor per entry
    using exact integer-quotient Largest Remainder Method so the sum equals `target_cents`.
    """
    count = len(weights)
    if count == 0:
        raise HTTPException(
            status_code=422, detail="Receipt has no positive billable items to push"
        )
    if target_cents < count:
        raise HTTPException(
            status_code=422,
            detail=(
                f"Receipt total ({target_cents / 100:.2f}) is too small to allocate "
                f"at least €0.01 to each of {count} billable items"
            ),
        )

    distributable = target_cents - count
    safe_weights = [max(1, w) for w in weights]
    total_weight = sum(safe_weights)

    quotients = [(distributable * w) // total_weight for w in safe_weights]
    remainders = [(distributable * w) % total_weight for w in safe_weights]
    shortfall = distributable - sum(quotients)

    order = sorted(range(count), key=lambda i: (-remainders[i], -safe_weights[i], i))
    for idx in order[:shortfall]:
        quotients[idx] += 1

    return [1 + q for q in quotients]


def _allocate_receipt_cents(
    billable_items: List[ReceiptItem], target_cents: int
) -> List[int]:
    """Allocates `target_cents` across ReceiptItem entries using Largest Remainder Method."""
    weights = [max(1, round(item.line_total * 100)) for item in billable_items]
    return _allocate_weighted_cents(weights, target_cents)


def _expand_billable_split_units(
    billable_items: List[ReceiptItem],
) -> list[tuple[ReceiptItem, int, str]]:
    """
    Expands each packaged ReceiptItem with quantity N into N individual split units
    (so 5 packs produce 5 identical Firefly splits), and keeps loose_weight items as 1 split.
    """
    units: list[tuple[ReceiptItem, int, str]] = []
    for item in billable_items:
        total_cents = max(1, round(item.line_total * 100))
        sale_mode = item.product.sale_mode if item.product else "packaged"
        if sale_mode == "loose_weight":
            units.append((item, total_cents, f"{item.quantity:g} {item.unit}"))
            continue

        pack_qty = max(1, int(round(item.quantity)))
        base_cents, remainder = divmod(total_cents, pack_qty)
        for idx in range(pack_qty):
            unit_weight = base_cents + (1 if idx < remainder else 0)
            units.append((item, max(1, unit_weight), ""))
    return units


def _partition_voucher_and_card_splits(
    billable_items: List[ReceiptItem],
    allocated_cents: List[int],
    voucher_cents: int,
) -> tuple[list[tuple[ReceiptItem, int, str]], list[tuple[ReceiptItem, int, str]]]:
    """
    Sequential Boundary Partitioning:
    Allocates prorated items sequentially to Transaction 1 (Vouchers) until reaching
    `voucher_cents`. Only splits a crossover item if cumulative cents exceed `voucher_cents`.
    """
    voucher_splits: list[tuple[ReceiptItem, int, str]] = []
    card_splits: list[tuple[ReceiptItem, int, str]] = []
    cumulative = 0
    crossed = False

    for item, item_cents in zip(billable_items, allocated_cents):
        if crossed:
            card_splits.append((item, item_cents, ""))
            continue

        if cumulative + item_cents < voucher_cents:
            voucher_splits.append((item, item_cents, ""))
            cumulative += item_cents
        elif cumulative + item_cents == voucher_cents:
            voucher_splits.append((item, item_cents, ""))
            cumulative += item_cents
            crossed = True
        else:
            split_a = voucher_cents - cumulative
            split_b = item_cents - split_a
            voucher_splits.append((item, split_a, " [Voucher]"))
            card_splits.append((item, split_b, " [Card Remainder]"))
            cumulative = voucher_cents
            crossed = True

    return voucher_splits, card_splits


def _partition_split_units_for_vouchers(
    split_units: list[tuple[ReceiptItem, int, str]],
    allocated_cents: List[int],
    voucher_cents: int,
) -> tuple[list[tuple[ReceiptItem, int, str]], list[tuple[ReceiptItem, int, str]]]:
    """Partitions expanded split units between voucher and card remainder transactions."""
    voucher_splits: list[tuple[ReceiptItem, int, str]] = []
    card_splits: list[tuple[ReceiptItem, int, str]] = []
    cumulative = 0
    crossed = False

    for (item, _, note_ctx), unit_cents in zip(split_units, allocated_cents):
        base_suffix = f" ({note_ctx})" if note_ctx else ""
        if crossed:
            card_splits.append((item, unit_cents, base_suffix))
            continue

        if cumulative + unit_cents < voucher_cents:
            voucher_splits.append((item, unit_cents, base_suffix))
            cumulative += unit_cents
        elif cumulative + unit_cents == voucher_cents:
            voucher_splits.append((item, unit_cents, base_suffix))
            cumulative += unit_cents
            crossed = True
        else:
            split_a = voucher_cents - cumulative
            split_b = unit_cents - split_a
            voucher_splits.append((item, split_a, f"{base_suffix} [Voucher]"))
            card_splits.append((item, split_b, f"{base_suffix} [Card Remainder]"))
            cumulative = voucher_cents
            crossed = True

    return voucher_splits, card_splits


def _build_firefly_tx_payload(
    receipt: Receipt,
    splits: list[tuple[ReceiptItem, int, str]],
    source_account_id: int,
    account_name: str,
    all_tags_by_id: dict[int, Tag] | None = None,
    implications: dict[int, set[int]] | None = None,
) -> dict:
    tx_splits = []
    formatted_time = (
        receipt.purchase_time.strftime("%H:%M:%S")
        if receipt.purchase_time
        else "12:00:00"
    )
    tags_map = all_tags_by_id or {}
    imp_map = implications or {}

    for item, amount_cents, suffix in splits:
        product = item.product
        product_name = (
            format_firefly_description(product)
            if product
            else f"Product #{item.product_id}"
        )
        base_notes = receipt.notes or ""
        split_notes = (
            f"{base_notes}{suffix}".lstrip() if suffix else base_notes
        )

        split_payload: dict = {
            "type": "withdrawal",
            "date": f"{receipt.purchase_date}T{formatted_time}",
            "amount": f"{amount_cents / 100:.2f}",
            "description": product_name,
            "source_id": str(source_account_id),
            "destination_id": str(receipt.firefly_account_id),
            "notes": split_notes,
        }
        if product and product.firefly_category_name:
            split_payload["category_name"] = product.firefly_category_name
        if product and product.tags:
            expanded = expand_tags_ordered(product.tags, tags_map, imp_map)
            split_payload["tags"] = [t.name for t in expanded]

        tx_splits.append(split_payload)

    return {
        "error_if_duplicate_hash": False,
        "apply_rules": True,
        "group_title": f"{account_name} - {receipt.purchase_date}",
        "transactions": tx_splits,
    }


def _convert_heif_to_jpeg(raw_bytes: bytes) -> bytes:
    try:
        with Image.open(BytesIO(raw_bytes)) as img:
            transposed = ImageOps.exif_transpose(img)
            rgb_img = transposed.convert("RGB")
            out_buf = BytesIO()
            rgb_img.save(out_buf, format="JPEG", quality=90)
            return out_buf.getvalue()
    except Exception as exc:
        raise HTTPException(
            status_code=415, detail=f"Failed to decode HEIC/HEIF image: {exc}"
        ) from exc


def _resolve_and_validate_voucher_terms(
    session: Session,
    payment_mode: str,
    total_amount: float,
    voucher_account_id: Optional[int],
    voucher_count: int,
    voucher_unit_value: float,
    apply_account_config: bool = True,
) -> tuple[float, int, int, Optional[AssetAccountMetadata]]:
    """
    Validates whole-voucher limits against receipt total. When `apply_account_config`
    is True (on receipt creation), enforces the unit value configured on a flagged
    meal_voucher account; during push/recovery, preserves the receipt's stored snapshot.
    Returns (effective_unit_value, voucher_cents, card_remainder_cents, meal_voucher_meta).
    """
    total_cents = to_cents(total_amount)
    if payment_mode != "split_vouchers":
        return voucher_unit_value, 0, total_cents, None

    if voucher_count < 0:
        raise HTTPException(
            status_code=422, detail="voucher_count cannot be negative"
        )

    meta = (
        session.get(AssetAccountMetadata, voucher_account_id)
        if voucher_account_id is not None
        else None
    )
    is_meal_voucher = (
        meta is not None
        and meta.asset_type == AssetAccountType.MEAL_VOUCHER
        and meta.voucher_unit_value is not None
        and to_cents(meta.voucher_unit_value) > 0
    )
    effective_unit_value = (
        float(meta.voucher_unit_value)
        if apply_account_config and is_meal_voucher and meta
        else voucher_unit_value
    )
    unit_cents = to_cents(effective_unit_value)
    if voucher_count > 0 and unit_cents <= 0:
        raise HTTPException(
            status_code=422, detail="Voucher unit value must be greater than 0"
        )

    voucher_cents = voucher_count * unit_cents
    if voucher_cents > total_cents:
        raise HTTPException(
            status_code=422,
            detail=(
                f"Voucher total (€{voucher_cents / 100:.2f}) exceeds receipt total "
                f"(€{total_cents / 100:.2f}); vouchers must be consumed in whole units"
            ),
        )

    return (
        effective_unit_value,
        voucher_cents,
        total_cents - voucher_cents,
        meta if is_meal_voucher else None,
    )


@router.post("/", response_model=ReceiptRead)
async def create_receipt(
    receipt_in: ReceiptCreate, session: Session = Depends(get_session)
):
    # 1. Validate destination Firefly expense account exists and is active
    try:
        account_data = await firefly_client.get_expense_account(
            receipt_in.firefly_account_id
        )
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Unable to reach Firefly III to validate expense account: {exc}",
        ) from exc

    if not account_data:
        raise HTTPException(
            status_code=404,
            detail=f"Firefly expense account #{receipt_in.firefly_account_id} not found in Firefly III",
        )
    if not account_data.get("attributes", {}).get("active", True):
        raise HTTPException(
            status_code=400,
            detail=f"Firefly expense account #{receipt_in.firefly_account_id} is inactive",
        )

    # 2. Validate products exist and fetch canonical metadata
    product_ids = {item.product_id for item in receipt_in.items}
    existing_products = session.exec(
        select(Product).where(Product.id.in_(product_ids))
    ).all()
    products_map = {p.id: p for p in existing_products if p.id is not None}
    for pid in product_ids:
        if pid not in products_map:
            raise HTTPException(
                status_code=404, detail=f"Product {pid} not found"
            )

    # 3. Resolve item quantities/units/prices against canonical Product definitions
    resolved_items = []
    for item in receipt_in.items:
        product = products_map[item.product_id]
        if product.sale_mode == "packaged" and not float(item.quantity).is_integer():
            raise HTTPException(
                status_code=422,
                detail=(
                    f"Packaged item '{product.name}' requires an integer pack quantity "
                    f"(got {item.quantity})"
                ),
            )
        effective_unit = item.unit or product.default_unit
        effective_pkg_size = (
            item.package_size if item.package_size is not None else product.package_size
        )
        if item.total_price is not None:
            line_total = round(item.total_price, 2)
            effective_paid_price = round(item.total_price / item.quantity, 4)
        else:
            assert item.paid_price is not None
            effective_paid_price = float(item.paid_price)
            line_total = round(item.quantity * effective_paid_price, 2)
        resolved_items.append(
            (item, effective_unit, effective_pkg_size, effective_paid_price, line_total)
        )

    # 4. Compute receipt total & validate whole-voucher rules
    computed_total = round(
        sum(entry[4] for entry in resolved_items) - receipt_in.basket_discount, 2
    )
    if computed_total <= 0:
        raise HTTPException(
            status_code=422,
            detail=(
                f"Computed receipt total (€{computed_total:.2f}) must be greater than €0.00"
            ),
        )

    effective_unit_value, _, _, _ = _resolve_and_validate_voucher_terms(
        session=session,
        payment_mode=receipt_in.payment_mode,
        total_amount=computed_total,
        voucher_account_id=receipt_in.voucher_account_id,
        voucher_count=receipt_in.voucher_count,
        voucher_unit_value=receipt_in.voucher_unit_value,
    )

    # 5. Persist receipt and price observations
    receipt = Receipt(
        firefly_account_id=receipt_in.firefly_account_id,
        purchase_date=receipt_in.purchase_date,
        purchase_time=receipt_in.purchase_time,
        total_amount=computed_total,
        basket_discount=round(receipt_in.basket_discount, 2),
        source_account_id=receipt_in.source_account_id,
        payment_mode=receipt_in.payment_mode,
        voucher_account_id=receipt_in.voucher_account_id,
        voucher_count=receipt_in.voucher_count,
        voucher_unit_value=effective_unit_value,
        notes=receipt_in.notes,
    )
    session.add(receipt)
    session.flush()

    for item, eff_unit, eff_pkg_size, eff_paid_price, line_total in resolved_items:
        effective_regular = (
            item.regular_price
            if item.regular_price is not None
            else eff_paid_price
        )
        is_discount = item.is_discount or (eff_paid_price < effective_regular)
        norm_paid = normalize_unit_price(
            price=eff_paid_price,
            quantity=1.0,
            unit=eff_unit,
            package_size=eff_pkg_size,
        )
        norm_reg = normalize_unit_price(
            price=effective_regular,
            quantity=1.0,
            unit=eff_unit,
            package_size=eff_pkg_size,
        )

        receipt_item = ReceiptItem(
            receipt_id=receipt.id,
            product_id=item.product_id,
            quantity=item.quantity,
            unit=eff_unit,
            package_size=eff_pkg_size,
            paid_price=eff_paid_price,
            regular_price=effective_regular,
            is_discount=is_discount,
            line_total=line_total,
        )
        session.add(receipt_item)

        price_record = PriceRecord(
            product_id=item.product_id,
            firefly_account_id=receipt.firefly_account_id,
            recorded_date=receipt.purchase_date,
            regular_price=effective_regular,
            paid_price=eff_paid_price,
            is_discount=is_discount,
            quantity=item.quantity,
            unit=eff_unit,
            package_size=eff_pkg_size,
            normalized_unit_price=norm_paid,
            normalized_regular_price=norm_reg,
            source_type="receipt",
            notes=receipt.notes,
        )
        session.add(price_record)

    session.commit()
    return await _get_receipt_read_or_404(session, receipt.id)


@router.get("/", response_model=List[ReceiptRead])
async def list_receipts(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    session: Session = Depends(get_session),
):
    statement = (
        select(Receipt)
        .options(*_receipt_loader_options())
        .order_by(Receipt.purchase_date.desc(), Receipt.id.desc())
        .offset(offset)
        .limit(limit)
    )
    receipts = session.exec(statement).all()
    return await _hydrate_receipt_store_names(receipts)


@router.get("/{receipt_id}", response_model=ReceiptRead)
async def get_receipt(
    receipt_id: int, session: Session = Depends(get_session)
):
    return await _get_receipt_read_or_404(session, receipt_id)


@router.post("/{receipt_id}/attachments", response_model=ReceiptAttachment)
async def upload_receipt_attachment(
    receipt_id: int,
    file: UploadFile = File(...),
    session: Session = Depends(get_session),
):
    receipt = session.get(Receipt, receipt_id)
    if not receipt:
        raise HTTPException(status_code=404, detail="Receipt not found")

    raw_bytes = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(raw_bytes) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail="Attachment exceeds the 15 MB maximum file size",
        )
    if not raw_bytes:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    kind = filetype.guess(raw_bytes[:8192])
    if kind is None or kind.mime not in ALLOWED_MIME_TO_EXT:
        detected = kind.mime if kind else "unknown"
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported attachment MIME type: {detected}",
        )

    if kind.mime in ("image/heic", "image/heif"):
        payload_bytes = _convert_heif_to_jpeg(raw_bytes)
        final_mime = "image/jpeg"
        ext = "jpg"
    else:
        payload_bytes = raw_bytes
        final_mime = kind.mime
        ext = ALLOWED_MIME_TO_EXT[kind.mime]

    sha256_hash = hashlib.sha256(payload_bytes).hexdigest()
    file_size_bytes = len(payload_bytes)
    stored_path = f"{sha256_hash[:2]}/{sha256_hash}.{ext}"

    storage_root = Path(settings.STORAGE_DIR).resolve()
    dest_path = (storage_root / stored_path).resolve()
    if storage_root not in dest_path.parents:
        raise HTTPException(status_code=400, detail="Invalid attachment storage path")

    dest_path.parent.mkdir(parents=True, exist_ok=True)
    dest_path.write_bytes(payload_bytes)
    os.chmod(dest_path, 0o644)

    safe_filename = Path(file.filename or f"receipt.{ext}").name
    attachment = ReceiptAttachment(
        receipt_id=receipt_id,
        filename=safe_filename,
        stored_path=stored_path,
        file_type=final_mime,
        file_size_bytes=file_size_bytes,
        sha256_hash=sha256_hash,
    )
    session.add(attachment)
    session.commit()
    session.refresh(attachment)
    return attachment


@router.get("/{receipt_id}/attachments/{attachment_id}")
def get_receipt_attachment(
    receipt_id: int,
    attachment_id: int,
    session: Session = Depends(get_session),
):
    attachment = session.get(ReceiptAttachment, attachment_id)
    if not attachment or attachment.receipt_id != receipt_id:
        raise HTTPException(status_code=404, detail="Attachment not found")

    storage_root = Path(settings.STORAGE_DIR).resolve()
    file_path = (storage_root / attachment.stored_path).resolve()
    if storage_root not in file_path.parents or not file_path.exists():
        raise HTTPException(status_code=404, detail="Attachment file missing on disk")

    return FileResponse(
        path=str(file_path),
        media_type=attachment.file_type,
        filename=attachment.filename,
        content_disposition_type="inline",
    )


async def _validate_firefly_accounts(
    receipt: Receipt,
    card_remainder_cents: int,
    voucher_meta: Optional[AssetAccountMetadata] = None,
    partial_voucher_only: bool = False,
) -> str:
    """Validates expense and asset accounts against Firefly III and returns account name."""
    if not receipt.firefly_account_id:
        raise HTTPException(
            status_code=400,
            detail="Receipt must be assigned to a Firefly III expense account",
        )
    requires_source_account = (
        receipt.payment_mode == "single" or card_remainder_cents > 0
    )
    if requires_source_account and receipt.source_account_id is None:
        raise HTTPException(
            status_code=400,
            detail="Primary source asset account must be specified before pushing",
        )
    if receipt.payment_mode == "split_vouchers" and (
        receipt.voucher_account_id is None or receipt.voucher_count <= 0
    ):
        raise HTTPException(
            status_code=400,
            detail="Voucher asset account and positive voucher count are required for split_vouchers",
        )

    # 1. Validate destination expense account
    try:
        expense_acc = await firefly_client.get_expense_account(
            receipt.firefly_account_id
        )
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Unable to reach Firefly III to validate expense account: {exc}",
        ) from exc

    if not expense_acc:
        raise HTTPException(
            status_code=400,
            detail=f"Destination expense account #{receipt.firefly_account_id} does not exist in Firefly III",
        )
    if not expense_acc.get("attributes", {}).get("active", True):
        raise HTTPException(
            status_code=400,
            detail=f"Destination expense account #{receipt.firefly_account_id} is inactive in Firefly III",
        )
    account_name = expense_acc.get("attributes", {}).get(
        "name", f"Account #{receipt.firefly_account_id}"
    )

    # 2. Validate asset accounts
    try:
        asset_accounts = await firefly_client.get_all_asset_accounts()
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Unable to reach Firefly III to validate asset accounts: {exc}",
        ) from exc

    asset_map = {int(acc["id"]): acc for acc in asset_accounts if "id" in acc}
    if requires_source_account and receipt.source_account_id not in asset_map:
        raise HTTPException(
            status_code=400,
            detail=f"Source asset account #{receipt.source_account_id} does not exist in Firefly III",
        )
    if receipt.payment_mode == "split_vouchers":
        if receipt.voucher_account_id not in asset_map:
            raise HTTPException(
                status_code=400,
                detail=f"Voucher asset account #{receipt.voucher_account_id} does not exist in Firefly III",
            )
        if voucher_meta is not None and not partial_voucher_only:
            live_balance = (
                asset_map[receipt.voucher_account_id]
                .get("attributes", {})
                .get("current_balance", "0")
            )
            status = compute_voucher_balance_status(
                live_balance, receipt.voucher_unit_value
            )
            if receipt.voucher_count > status.usable_vouchers:
                raise HTTPException(
                    status_code=422,
                    detail=(
                        f"Insufficient meal vouchers on account #{receipt.voucher_account_id}: "
                        f"requested {receipt.voucher_count}, available {status.usable_vouchers}"
                    ),
                )

    return account_name


@router.post("/{receipt_id}/push-to-firefly", response_model=ReceiptRead)
async def push_receipt_to_firefly(
    receipt_id: int,
    req: ReceiptPushRequest = Body(default_factory=ReceiptPushRequest),
    session: Session = Depends(get_session),
):
    receipt = _get_receipt_or_404(session, receipt_id)

    _, voucher_cents, card_remainder_cents, voucher_meta = (
        _resolve_and_validate_voucher_terms(
            session=session,
            payment_mode=receipt.payment_mode,
            total_amount=receipt.total_amount,
            voucher_account_id=receipt.voucher_account_id,
            voucher_count=receipt.voucher_count,
            voucher_unit_value=receipt.voucher_unit_value,
            apply_account_config=False,
        )
    )

    partial_voucher_only = (
        receipt.firefly_voucher_transaction_id is not None
        and receipt.firefly_transaction_id is None
        and receipt.payment_mode == "split_vouchers"
        and card_remainder_cents > 0
    )

    if not req.force and (
        receipt.firefly_transaction_id is not None
        or receipt.firefly_voucher_transaction_id is not None
    ):
        raise HTTPException(
            status_code=409,
            detail="Receipt already has Firefly III transaction ID(s). Pass force=true to resume or resync.",
        )

    account_name = await _validate_firefly_accounts(
        receipt,
        card_remainder_cents=card_remainder_cents,
        voucher_meta=voucher_meta,
        partial_voucher_only=partial_voucher_only,
    )

    if req.force and not partial_voucher_only:
        for old_tx_id in (
            receipt.firefly_transaction_id,
            receipt.firefly_voucher_transaction_id,
        ):
            if old_tx_id is not None:
                try:
                    await firefly_client.delete_transaction(old_tx_id)
                except httpx.HTTPError:
                    pass
        receipt.firefly_transaction_id = None
        receipt.firefly_voucher_transaction_id = None
        session.add(receipt)
        session.commit()

    billable_items = [item for item in receipt.items if item.line_total > 0]
    split_units = _expand_billable_split_units(billable_items)
    target_cents = round(receipt.total_amount * 100)
    allocated_cents = _allocate_weighted_cents(
        [weight for _, weight, _ in split_units], target_cents
    )

    all_tags = session.exec(select(Tag)).all()
    all_tags_by_id = {t.id: t for t in all_tags if t.id is not None}
    implications = get_implication_map(session)

    if receipt.payment_mode == "single":
        assert receipt.source_account_id is not None
        splits = [
            (item, cents, f" ({note_ctx})" if note_ctx else "")
            for (item, _, note_ctx), cents in zip(split_units, allocated_cents)
        ]
        payload = _build_firefly_tx_payload(
            receipt,
            splits,
            receipt.source_account_id,
            account_name,
            all_tags_by_id=all_tags_by_id,
            implications=implications,
        )
        try:
            resp = await firefly_client.create_transaction(payload)
        except httpx.HTTPError as exc:
            raise HTTPException(
                status_code=502,
                detail=f"Failed to push transaction to Firefly III: {exc}",
            ) from exc
        receipt.firefly_transaction_id = int(resp["data"]["id"])
        session.add(receipt)
        session.commit()
        return await _get_receipt_read_or_404(session, receipt.id)

    # split_vouchers mode
    assert receipt.voucher_account_id is not None
    if card_remainder_cents <= 0:
        splits = [
            (item, cents, f" ({note_ctx})" if note_ctx else "")
            for (item, _, note_ctx), cents in zip(split_units, allocated_cents)
        ]
        payload = _build_firefly_tx_payload(
            receipt,
            splits,
            receipt.voucher_account_id,
            account_name,
            all_tags_by_id=all_tags_by_id,
            implications=implications,
        )
        try:
            resp = await firefly_client.create_transaction(payload)
        except httpx.HTTPError as exc:
            raise HTTPException(
                status_code=502,
                detail=f"Failed to push voucher transaction to Firefly III: {exc}",
            ) from exc
        receipt.firefly_voucher_transaction_id = int(resp["data"]["id"])
        session.add(receipt)
        session.commit()
        return await _get_receipt_read_or_404(session, receipt.id)

    assert receipt.source_account_id is not None
    voucher_splits, card_splits = _partition_split_units_for_vouchers(
        split_units, allocated_cents, voucher_cents
    )

    created_voucher_in_this_call = False
    if not partial_voucher_only:
        voucher_payload = _build_firefly_tx_payload(
            receipt,
            voucher_splits,
            receipt.voucher_account_id,
            account_name,
            all_tags_by_id=all_tags_by_id,
            implications=implications,
        )
        try:
            tx1 = await firefly_client.create_transaction(voucher_payload)
        except httpx.HTTPError as exc:
            raise HTTPException(
                status_code=502,
                detail=f"Failed to push voucher transaction to Firefly III: {exc}",
            ) from exc
        voucher_tx_id = int(tx1["data"]["id"])
        receipt.firefly_voucher_transaction_id = voucher_tx_id
        session.add(receipt)
        session.commit()
        created_voucher_in_this_call = True
    else:
        assert receipt.firefly_voucher_transaction_id is not None
        voucher_tx_id = receipt.firefly_voucher_transaction_id

    card_payload = _build_firefly_tx_payload(
        receipt,
        card_splits,
        receipt.source_account_id,
        account_name,
        all_tags_by_id=all_tags_by_id,
        implications=implications,
    )
    try:
        tx2 = await firefly_client.create_transaction(card_payload)
    except httpx.HTTPError as exc:
        if created_voucher_in_this_call:
            try:
                await firefly_client.delete_transaction(voucher_tx_id)
                receipt.firefly_voucher_transaction_id = None
                session.add(receipt)
                session.commit()
            except httpx.HTTPError:
                pass
        raise HTTPException(
            status_code=502,
            detail=f"Failed to push card remainder transaction to Firefly III: {exc}",
        ) from exc

    receipt.firefly_transaction_id = int(tx2["data"]["id"])
    session.add(receipt)
    session.commit()
    return await _get_receipt_read_or_404(session, receipt.id)

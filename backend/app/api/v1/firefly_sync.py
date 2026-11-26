import asyncio
import json
import logging
from datetime import date, datetime, timedelta, timezone
from typing import Any, List, Literal, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import or_
from sqlalchemy.orm import selectinload
from sqlmodel import Session, select

from app.core.database import get_session
from app.models.firefly_cache import FireflySyncJob, FireflySyncState, FireflySyncedSplit
from app.models.price import PriceRecord
from app.models.product import ItemFireflyAlias, Product, format_firefly_description
from app.models.receipt import Receipt, ReceiptItem
from app.models.tag import Tag
from app.services.firefly import firefly_client
from app.services.pricing import normalize_unit_price
from app.services.taxonomy import expand_tags_ordered, get_implication_map

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/firefly-sync", tags=["Firefly Backlog & Sync"])

INCREMENTAL_COOLDOWN_SECONDS = 60
INCREMENTAL_LOOKBACK_DAYS = 7
FIREFLY_REWRITE_CONCURRENCY = 4
SSE_HEARTBEAT_SECONDS = 15.0
MAX_STORED_JOB_ERRORS = 50

_job_subscribers: set[tuple[asyncio.AbstractEventLoop, asyncio.Queue[str]]] = set()
_active_job_tasks: set[asyncio.Task] = set()


class SyncStatusResponse(BaseModel):
    last_full_sync_at: Optional[datetime] = None
    last_incremental_sync_at: Optional[datetime] = None
    high_watermark_date: Optional[date] = None
    total_cached_splits: int = 0
    unassociated_count: int = 0
    ignored_count: int = 0


class SyncTransactionsResponse(BaseModel):
    status: Literal["synced", "skipped_cooldown", "requires_full_sync"]
    mode: Literal["incremental", "full"]
    splits_upserted: int = 0
    last_full_sync_at: Optional[datetime] = None
    last_incremental_sync_at: Optional[datetime] = None
    high_watermark_date: Optional[date] = None


class CategoryBacklogCount(BaseModel):
    category_name: Optional[str] = None
    count: int


class BacklogGroup(BaseModel):
    normalized_description: str
    sample_description: str
    category_name: Optional[str] = None
    occurrence_count: int
    total_amount: float
    latest_date: date
    sample_stores: List[str] = []
    sample_tags: List[str] = []
    journal_ids: List[int] = []
    suggested_product_id: Optional[int] = None
    suggested_product_name: Optional[str] = None
    linked_product_id: Optional[int] = None
    linked_product_name: Optional[str] = None


class BacklogResponse(BaseModel):
    total_unassociated: int
    linked_count: int = 0
    ignored_count: int
    category_counts: List[CategoryBacklogCount]
    groups: List[BacklogGroup]


class BacklogLinkRequest(BaseModel):
    product_id: int
    transaction_journal_ids: List[int] = Field(min_length=1)


class BacklogIgnoreRequest(BaseModel):
    transaction_journal_ids: List[int] = Field(min_length=1)
    ignored: bool = True


class BacklogUnlinkRequest(BaseModel):
    transaction_journal_ids: List[int] = Field(min_length=1)


class FailedTransactionRewrite(BaseModel):
    firefly_transaction_id: int
    error: str


class RewriteResultResponse(BaseModel):
    linked_splits: int = 0
    updated_transactions: int = 0
    updated_splits: int = 0
    failed_transactions: List[FailedTransactionRewrite] = []


class FireflySyncJobResponse(BaseModel):
    id: int
    job_type: Literal["backlog_link", "product_propagate"]
    product_id: int
    product_name: str
    status: Literal["queued", "running", "completed", "completed_with_errors", "failed"]
    total_transactions: int = 0
    processed_transactions: int = 0
    updated_transactions: int = 0
    total_splits: int = 0
    linked_splits: int = 0
    updated_splits: int = 0
    failed_count: int = 0
    failed_transactions: List[FailedTransactionRewrite] = []
    target_journal_ids: List[int] = []
    error_message: Optional[str] = None
    dismissed_at: Optional[datetime] = None
    created_at: datetime
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None


def _parse_tx_date(raw_date: object) -> date:
    text = str(raw_date or "").strip()
    if len(text) >= 10:
        try:
            return date.fromisoformat(text[:10])
        except ValueError:
            pass
    return date.today()


def _parse_amount_cents(raw_amount: object) -> int:
    try:
        return round(float(str(raw_amount or "0")) * 100)
    except (TypeError, ValueError):
        return 0


def _ensure_aware_utc(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def _format_httpx_error(exc: httpx.HTTPError) -> str:
    if isinstance(exc, httpx.HTTPStatusError):
        status_code = exc.response.status_code
        body_text = exc.response.text.strip()
        detail = body_text
        try:
            payload = exc.response.json()
            if isinstance(payload, dict):
                msg = str(payload.get("message") or "").strip()
                errs = payload.get("errors")
                if isinstance(errs, dict) and errs:
                    err_parts = []
                    for field, msgs in list(errs.items())[:3]:
                        if isinstance(msgs, list) and msgs:
                            err_parts.append(f"{field}: {msgs[0]}")
                        else:
                            err_parts.append(f"{field}: {msgs}")
                    joined = "; ".join(err_parts)
                    detail = f"{msg} ({joined})" if msg else joined
                elif msg:
                    detail = msg
        except Exception:
            pass
        if len(detail) > 300:
            detail = detail[:300] + "..."
        return f"HTTP {status_code}: {detail or str(exc)}"
    return f"{type(exc).__name__}: {exc}"


def _serialize_job(job: FireflySyncJob) -> FireflySyncJobResponse:
    try:
        raw_errors = json.loads(job.failed_transactions_json or "[]")
    except Exception:
        raw_errors = []
    try:
        raw_jids = json.loads(job.target_journal_ids_json or "[]")
    except Exception:
        raw_jids = []

    return FireflySyncJobResponse(
        id=job.id or 0,
        job_type=job.job_type,  # type: ignore[arg-type]
        product_id=job.product_id,
        product_name=job.product_name,
        status=job.status,  # type: ignore[arg-type]
        total_transactions=job.total_transactions,
        processed_transactions=job.processed_transactions,
        updated_transactions=job.updated_transactions,
        total_splits=job.total_splits,
        linked_splits=job.linked_splits,
        updated_splits=job.updated_splits,
        failed_count=job.failed_count,
        failed_transactions=[
            FailedTransactionRewrite(**e) for e in raw_errors if isinstance(e, dict)
        ],
        target_journal_ids=[int(j) for j in raw_jids],
        error_message=job.error_message,
        dismissed_at=_ensure_aware_utc(job.dismissed_at),
        created_at=_ensure_aware_utc(job.created_at) or datetime.now(timezone.utc),
        started_at=_ensure_aware_utc(job.started_at),
        finished_at=_ensure_aware_utc(job.finished_at),
    )


def _list_visible_jobs(
    session: Session, include_dismissed: bool = False, limit: int = 20
) -> List[FireflySyncJobResponse]:
    stmt = select(FireflySyncJob)
    if not include_dismissed:
        stmt = stmt.where(
            or_(
                FireflySyncJob.dismissed_at.is_(None),
                FireflySyncJob.status.in_(["queued", "running"]),
            )
        )
    stmt = stmt.order_by(FireflySyncJob.created_at.desc(), FireflySyncJob.id.desc()).limit(limit)
    rows = session.exec(stmt).all()
    return [_serialize_job(r) for r in rows]


def _jobs_snapshot_json(session: Session) -> str:
    jobs = _list_visible_jobs(session, include_dismissed=False, limit=20)
    return json.dumps([j.model_dump(mode="json") for j in jobs])


def _broadcast_jobs_snapshot(session: Session) -> None:
    if not _job_subscribers:
        return
    snapshot_json = _jobs_snapshot_json(session)
    try:
        current_loop = asyncio.get_running_loop()
    except RuntimeError:
        current_loop = None

    for sub in list(_job_subscribers):
        loop, queue = sub
        if loop.is_closed():
            _job_subscribers.discard(sub)
            continue
        try:
            if current_loop is loop:
                queue.put_nowait(snapshot_json)
            else:
                loop.call_soon_threadsafe(queue.put_nowait, snapshot_json)
        except Exception:
            _job_subscribers.discard(sub)


def mark_interrupted_sync_jobs_failed(target_engine) -> int:
    """Marks any stale queued/running jobs from a prior server process as failed."""
    now = datetime.now(timezone.utc)
    with Session(target_engine) as session:
        stale = session.exec(
            select(FireflySyncJob).where(
                FireflySyncJob.status.in_(["queued", "running"])
            )
        ).all()
        for job in stale:
            job.status = "failed"
            job.error_message = "Interrupted by server restart"
            job.finished_at = now
            session.add(job)
        if stale:
            session.commit()
        return len(stale)


async def _rewrite_single_firefly_transaction(
    ff_tx_id: int,
    target_jids: set[int],
    ff_description: str,
    category_name: Optional[str],
    expanded_tag_names: List[str],
) -> tuple[List[int], Optional[FailedTransactionRewrite]]:
    """
    Safely rewrites matching splits inside one Firefly III transaction group via
    GET -> PUT while preserving every sibling split and original group_title.
    Holds no database session across network I/O.
    """
    try:
        tx_data = await firefly_client.get_transaction_by_id(ff_tx_id)
        if not tx_data:
            return [], FailedTransactionRewrite(
                firefly_transaction_id=ff_tx_id,
                error="Transaction not found in Firefly III (404)",
            )

        tx_attrs = tx_data.get("attributes") or {}
        current_splits = tx_attrs.get("transactions", [])
        put_splits: List[dict] = []
        matched_jids: List[int] = []

        for raw_split in current_splits:
            try:
                jid = int(raw_split.get("transaction_journal_id"))
            except (TypeError, ValueError):
                continue
            if jid in target_jids:
                matched_jids.append(jid)
                split_payload: dict[str, Any] = {
                    "transaction_journal_id": jid,
                    "description": ff_description,
                    "tags": expanded_tag_names,
                }
                if category_name:
                    split_payload["category_name"] = category_name
                put_splits.append(split_payload)
            else:
                put_splits.append({"transaction_journal_id": jid})

        if not matched_jids:
            return [], FailedTransactionRewrite(
                firefly_transaction_id=ff_tx_id,
                error="Target split journal IDs not present in Firefly transaction",
            )

        put_body: dict[str, Any] = {
            "apply_rules": False,
            "fire_webhooks": False,
            "transactions": put_splits,
        }
        group_title = str(tx_attrs.get("group_title") or "").strip()
        if not group_title and len(put_splits) > 1:
            first_split = current_splits[0] if current_splits else {}
            dest_or_src = str(
                first_split.get("destination_name")
                or first_split.get("source_name")
                or ""
            ).strip()
            tx_date_str = str(first_split.get("date") or "")[:10]
            if dest_or_src and tx_date_str:
                group_title = f"{dest_or_src} - {tx_date_str}"
            else:
                group_title = (
                    str(first_split.get("description") or "").strip()
                    or f"Transaction #{ff_tx_id}"
                )
        if group_title:
            put_body["group_title"] = group_title

        await firefly_client.update_transaction(ff_tx_id, put_body)
        return matched_jids, None
    except httpx.HTTPError as exc:
        err_msg = _format_httpx_error(exc)
        logger.warning(
            "Failed rewriting Firefly transaction %s: %s",
            ff_tx_id,
            err_msg,
        )
        return [], FailedTransactionRewrite(
            firefly_transaction_id=ff_tx_id,
            error=err_msg,
        )


async def _run_firefly_sync_job(
    job_id: int,
    bind: Any,
    job_type: str,
    product_id: int,
    ff_description: str,
    category_name: Optional[str],
    default_unit: str,
    package_size: Optional[float],
    expanded_tag_names: List[str],
    grouped_tx_jids: dict[int, List[int]],
) -> None:
    sem = asyncio.Semaphore(FIREFLY_REWRITE_CONCURRENCY)
    db_lock = asyncio.Lock()
    norm_product_name = ff_description.strip().lower()

    async with db_lock:
        with Session(bind) as db_session:
            job = db_session.get(FireflySyncJob, job_id)
            if not job:
                return
            job.status = "running"
            job.started_at = datetime.now(timezone.utc)
            db_session.add(job)
            db_session.commit()
            _broadcast_jobs_snapshot(db_session)

    async def _process_one(ff_tx_id: int, target_jids: List[int]) -> None:
        async with sem:
            matched_jids, failure = await _rewrite_single_firefly_transaction(
                ff_tx_id=ff_tx_id,
                target_jids=set(target_jids),
                ff_description=ff_description,
                category_name=category_name,
                expanded_tag_names=expanded_tag_names,
            )

        async with db_lock:
            with Session(bind) as db_session:
                job = db_session.get(FireflySyncJob, job_id)
                if not job:
                    return
                job.processed_transactions += 1
                if failure is not None:
                    job.failed_count += 1
                    try:
                        errs = json.loads(job.failed_transactions_json or "[]")
                    except Exception:
                        errs = []
                    if len(errs) < MAX_STORED_JOB_ERRORS:
                        errs.append(failure.model_dump())
                        job.failed_transactions_json = json.dumps(errs)
                else:
                    job.updated_transactions += 1
                    job.updated_splits += len(matched_jids)
                    job.linked_splits += len(matched_jids)
                    split_rows = db_session.exec(
                        select(FireflySyncedSplit).where(
                            FireflySyncedSplit.transaction_journal_id.in_(matched_jids)
                        )
                    ).all()
                    tags_serialized = json.dumps(expanded_tag_names)
                    for split_row in split_rows:
                        split_row.description = ff_description
                        split_row.normalized_description = norm_product_name
                        if category_name:
                            split_row.firefly_category_name = category_name
                        split_row.tags_json = tags_serialized
                        split_row.linked_product_id = product_id
                        split_row.is_ignored = False
                        db_session.add(split_row)
                        if job_type == "backlog_link":
                            _upsert_price_record_for_split_values(
                                db_session,
                                product_id=product_id,
                                default_unit=default_unit,
                                package_size=package_size,
                                split=split_row,
                            )

                db_session.add(job)
                db_session.commit()
                _broadcast_jobs_snapshot(db_session)

    try:
        await asyncio.gather(
            *(
                _process_one(ff_tx_id, jids)
                for ff_tx_id, jids in grouped_tx_jids.items()
            )
        )
        async with db_lock:
            with Session(bind) as db_session:
                job = db_session.get(FireflySyncJob, job_id)
                if not job:
                    return
                if job.failed_count > 0 and job.updated_transactions == 0:
                    job.status = "failed"
                elif job.failed_count > 0:
                    job.status = "completed_with_errors"
                else:
                    job.status = "completed"
                job.finished_at = datetime.now(timezone.utc)
                db_session.add(job)
                db_session.commit()
                _broadcast_jobs_snapshot(db_session)
    except Exception as exc:
        logger.exception("Unexpected failure in FireflySyncJob #%s", job_id)
        async with db_lock:
            with Session(bind) as db_session:
                job = db_session.get(FireflySyncJob, job_id)
                if job:
                    job.status = "failed"
                    job.error_message = str(exc)[:300]
                    job.finished_at = datetime.now(timezone.utc)
                    db_session.add(job)
                    db_session.commit()
                    _broadcast_jobs_snapshot(db_session)


def enqueue_firefly_rewrite_job(
    session: Session,
    product: Product,
    splits: List[FireflySyncedSplit],
    job_type: Literal["backlog_link", "product_propagate"],
) -> FireflySyncJob:
    """
    Creates a persistent FireflySyncJob and schedules its background asyncio worker.
    Raises HTTP 409 if an active job for `product.id` is already queued/running.
    """
    if product.id is None:
        raise HTTPException(status_code=400, detail="Product must be persisted first")

    active = session.exec(
        select(FireflySyncJob).where(
            FireflySyncJob.product_id == product.id,
            FireflySyncJob.status.in_(["queued", "running"]),
        )
    ).first()
    if active:
        raise HTTPException(
            status_code=409,
            detail=f"A Firefly sync job (#{active.id}) is already running for '{product.name}'.",
        )

    all_tags = session.exec(select(Tag)).all()
    all_tags_by_id = {t.id: t for t in all_tags if t.id is not None}
    implications = get_implication_map(session)
    expanded_tag_names = [
        t.name for t in expand_tags_ordered(product.tags, all_tags_by_id, implications)
    ]
    ff_description = format_firefly_description(product)

    grouped_tx_jids: dict[int, List[int]] = {}
    target_jids: List[int] = []
    for s in splits:
        target_jids.append(s.transaction_journal_id)
        grouped_tx_jids.setdefault(s.firefly_transaction_id, []).append(
            s.transaction_journal_id
        )

    now = datetime.now(timezone.utc)
    job = FireflySyncJob(
        job_type=job_type,
        product_id=product.id,
        product_name=product.name,
        status="queued" if grouped_tx_jids else "completed",
        total_transactions=len(grouped_tx_jids),
        total_splits=len(splits),
        target_journal_ids_json=json.dumps(target_jids),
        created_at=now,
        finished_at=now if not grouped_tx_jids else None,
    )
    session.add(job)
    session.commit()
    session.refresh(job)
    _broadcast_jobs_snapshot(session)

    if grouped_tx_jids:
        bind = session.get_bind()
        task = asyncio.create_task(
            _run_firefly_sync_job(
                job_id=job.id,  # type: ignore[arg-type]
                bind=bind,
                job_type=job_type,
                product_id=product.id,
                ff_description=ff_description,
                category_name=product.firefly_category_name,
                default_unit=product.default_unit,
                package_size=product.package_size,
                expanded_tag_names=expanded_tag_names,
                grouped_tx_jids=grouped_tx_jids,
            )
        )
        _active_job_tasks.add(task)
        task.add_done_callback(_active_job_tasks.discard)

    return job


def _upsert_price_record_for_split_values(
    session: Session,
    *,
    product_id: int,
    default_unit: str,
    package_size: Optional[float],
    split: FireflySyncedSplit,
) -> None:
    if not split.firefly_expense_account_id:
        return
    paid_price = round(split.amount_cents / 100.0, 2)
    norm_price = normalize_unit_price(
        price=paid_price,
        quantity=1.0,
        unit=default_unit,
        package_size=package_size,
    )
    existing = session.exec(
        select(PriceRecord).where(
            PriceRecord.transaction_journal_id == split.transaction_journal_id
        )
    ).first()
    if existing:
        existing.product_id = product_id
        existing.firefly_account_id = split.firefly_expense_account_id
        existing.recorded_date = split.tx_date
        existing.paid_price = paid_price
        existing.regular_price = paid_price
        existing.unit = default_unit
        existing.package_size = package_size
        existing.normalized_unit_price = norm_price
        existing.normalized_regular_price = norm_price
        existing.firefly_transaction_id = split.firefly_transaction_id
        session.add(existing)
    else:
        session.add(
            PriceRecord(
                product_id=product_id,
                firefly_account_id=split.firefly_expense_account_id,
                recorded_date=split.tx_date,
                regular_price=paid_price,
                paid_price=paid_price,
                is_discount=False,
                quantity=1.0,
                unit=default_unit,
                package_size=package_size,
                normalized_unit_price=norm_price,
                normalized_regular_price=norm_price,
                firefly_transaction_id=split.firefly_transaction_id,
                transaction_journal_id=split.transaction_journal_id,
                source_type="firefly_sync",
            )
        )


@router.get("/status", response_model=SyncStatusResponse)
def get_sync_status(session: Session = Depends(get_session)):
    state = session.get(FireflySyncState, 1)
    all_splits = session.exec(select(FireflySyncedSplit)).all()
    unassociated = sum(
        1 for s in all_splits if s.linked_product_id is None and not s.is_ignored
    )
    ignored = sum(1 for s in all_splits if s.is_ignored)
    return SyncStatusResponse(
        last_full_sync_at=state.last_full_sync_at if state else None,
        last_incremental_sync_at=state.last_incremental_sync_at if state else None,
        high_watermark_date=state.high_watermark_date if state else None,
        total_cached_splits=len(all_splits),
        unassociated_count=unassociated,
        ignored_count=ignored,
    )


@router.post("/transactions", response_model=SyncTransactionsResponse)
async def sync_firefly_transactions(
    mode: Literal["incremental", "full"] = Query("incremental"),
    session: Session = Depends(get_session),
):
    state = session.get(FireflySyncState, 1)
    if state is None:
        state = FireflySyncState(id=1)
        session.add(state)
        session.commit()
        session.refresh(state)

    now = datetime.now(timezone.utc)

    if mode == "incremental":
        if state.last_full_sync_at is None:
            return SyncTransactionsResponse(
                status="requires_full_sync",
                mode=mode,
                last_full_sync_at=state.last_full_sync_at,
                last_incremental_sync_at=state.last_incremental_sync_at,
                high_watermark_date=state.high_watermark_date,
            )
        last_sync = _ensure_aware_utc(
            state.last_incremental_sync_at or state.last_full_sync_at
        )
        if last_sync and (now - last_sync).total_seconds() < INCREMENTAL_COOLDOWN_SECONDS:
            return SyncTransactionsResponse(
                status="skipped_cooldown",
                mode=mode,
                last_full_sync_at=state.last_full_sync_at,
                last_incremental_sync_at=state.last_incremental_sync_at,
                high_watermark_date=state.high_watermark_date,
            )

    start_param: Optional[str] = None
    if mode == "incremental" and state.high_watermark_date is not None:
        start_param = (
            state.high_watermark_date - timedelta(days=INCREMENTAL_LOOKBACK_DAYS)
        ).isoformat()

    try:
        raw_txs = await firefly_client.get_all_transactions(
            tx_type="withdrawal",
            start=start_param,
        )
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Unable to reach Firefly III to sync transactions: {exc}",
        ) from exc

    # Map pushed companion receipts -> {ff_tx_id: {product_name_lower: product_id}}
    pushed_receipts = session.exec(
        select(Receipt)
        .where(
            (Receipt.firefly_transaction_id.is_not(None))
            | (Receipt.firefly_voucher_transaction_id.is_not(None))
        )
        .options(
            selectinload(Receipt.items)
            .selectinload(ReceiptItem.product)
            .selectinload(Product.brand)
        )
    ).all()
    receipt_tx_product_map: dict[int, dict[str, int]] = {}
    for rec in pushed_receipts:
        name_map: dict[str, int] = {}
        for ri in rec.items:
            if ri.product and ri.product.name:
                name_map[ri.product.name.strip().lower()] = ri.product_id
                name_map[format_firefly_description(ri.product).lower()] = ri.product_id
        if rec.firefly_transaction_id:
            receipt_tx_product_map[rec.firefly_transaction_id] = name_map
        if rec.firefly_voucher_transaction_id:
            receipt_tx_product_map[rec.firefly_voucher_transaction_id] = name_map

    existing_splits = session.exec(select(FireflySyncedSplit)).all()
    existing_by_jid = {s.transaction_journal_id: s for s in existing_splits}

    upserted = 0
    max_date = state.high_watermark_date

    for tx in raw_txs:
        try:
            ff_tx_id = int(tx.get("id"))
        except (TypeError, ValueError):
            continue
        splits = tx.get("attributes", {}).get("transactions", [])
        for raw_split in splits:
            try:
                jid = int(raw_split.get("transaction_journal_id"))
            except (TypeError, ValueError):
                continue

            desc = str(raw_split.get("description") or "").strip()
            if not desc:
                continue
            norm_desc = desc.lower()
            tx_date = _parse_tx_date(raw_split.get("date"))
            if max_date is None or tx_date > max_date:
                max_date = tx_date

            amount_cents = _parse_amount_cents(raw_split.get("amount"))
            raw_cat = raw_split.get("category_name")
            cat_name = str(raw_cat).strip() if raw_cat else None
            if cat_name == "":
                cat_name = None

            dest_id_raw = raw_split.get("destination_id")
            try:
                dest_id = int(dest_id_raw) if dest_id_raw is not None else None
            except (TypeError, ValueError):
                dest_id = None
            dest_name = (
                str(raw_split.get("destination_name")).strip()
                if raw_split.get("destination_name")
                else None
            )
            tags_list = [
                str(t).strip() for t in (raw_split.get("tags") or []) if str(t).strip()
            ]
            auto_receipt_product_id = receipt_tx_product_map.get(ff_tx_id, {}).get(
                norm_desc
            )

            existing = existing_by_jid.get(jid)
            if existing:
                existing.firefly_transaction_id = ff_tx_id
                existing.tx_type = str(raw_split.get("type") or "withdrawal")
                existing.tx_date = tx_date
                existing.amount_cents = amount_cents
                existing.description = desc
                existing.normalized_description = norm_desc
                existing.firefly_expense_account_id = dest_id
                existing.firefly_expense_account_name = dest_name
                existing.firefly_category_name = cat_name
                existing.tags_json = json.dumps(tags_list)
                if existing.linked_product_id is None and auto_receipt_product_id:
                    existing.linked_product_id = auto_receipt_product_id
                existing.synced_at = now
                session.add(existing)
            else:
                row = FireflySyncedSplit(
                    transaction_journal_id=jid,
                    firefly_transaction_id=ff_tx_id,
                    tx_type=str(raw_split.get("type") or "withdrawal"),
                    tx_date=tx_date,
                    amount_cents=amount_cents,
                    description=desc,
                    normalized_description=norm_desc,
                    firefly_expense_account_id=dest_id,
                    firefly_expense_account_name=dest_name,
                    firefly_category_name=cat_name,
                    tags_json=json.dumps(tags_list),
                    linked_product_id=auto_receipt_product_id,
                    is_ignored=False,
                    synced_at=now,
                )
                session.add(row)
                existing_by_jid[jid] = row
            upserted += 1

    state.high_watermark_date = max_date
    if mode == "full":
        state.last_full_sync_at = now
    state.last_incremental_sync_at = now
    session.add(state)
    session.commit()

    return SyncTransactionsResponse(
        status="synced",
        mode=mode,
        splits_upserted=upserted,
        last_full_sync_at=state.last_full_sync_at,
        last_incremental_sync_at=state.last_incremental_sync_at,
        high_watermark_date=state.high_watermark_date,
    )


@router.get("/backlog", response_model=BacklogResponse)
def get_firefly_backlog(
    status: Literal["unassociated", "linked", "ignored"] = Query("unassociated"),
    category: Optional[str] = Query(
        None,
        description="Filter by Firefly category name, or '__uncategorized__' for null category",
    ),
    search: Optional[str] = Query(None),
    session: Session = Depends(get_session),
):
    all_splits = session.exec(select(FireflySyncedSplit)).all()
    ignored_splits = [s for s in all_splits if s.is_ignored]
    linked_splits = [
        s for s in all_splits if s.linked_product_id is not None and not s.is_ignored
    ]
    unassociated = [
        s for s in all_splits if s.linked_product_id is None and not s.is_ignored
    ]

    if status == "linked":
        target_pool = linked_splits
    elif status == "ignored":
        target_pool = ignored_splits
    else:
        target_pool = unassociated

    cat_counter: dict[Optional[str], int] = {}
    for s in target_pool:
        cat_counter[s.firefly_category_name] = cat_counter.get(s.firefly_category_name, 0) + 1

    category_counts = [
        CategoryBacklogCount(category_name=cat, count=cnt)
        for cat, cnt in sorted(
            cat_counter.items(),
            key=lambda kv: (-kv[1], (kv[0] or "").lower()),
        )
    ]

    filtered = target_pool
    if category == "__uncategorized__":
        filtered = [s for s in filtered if not s.firefly_category_name]
    elif category is not None and category != "":
        filtered = [s for s in filtered if s.firefly_category_name == category]

    if search and search.strip():
        needle = search.strip().lower()
        filtered = [s for s in filtered if needle in s.normalized_description]

    # Lookup hints from aliases and canonical product names
    aliases = session.exec(
        select(ItemFireflyAlias).options(selectinload(ItemFireflyAlias.product))
    ).all()
    hint_map: dict[str, tuple[int, str]] = {
        a.normalized_description: (a.product_id, a.product.name)
        for a in aliases
        if a.product is not None
    }
    products = session.exec(select(Product).options(selectinload(Product.brand))).all()
    product_name_by_id: dict[int, str] = {}
    for p in products:
        if p.id is not None:
            product_name_by_id[p.id] = p.name
            hint_map.setdefault(format_firefly_description(p).lower(), (p.id, p.name))
            hint_map.setdefault(p.name.strip().lower(), (p.id, p.name))

    grouped: dict[tuple[str, Optional[str], Optional[int]], list[FireflySyncedSplit]] = {}
    for s in filtered:
        key = (
            s.normalized_description,
            s.firefly_category_name,
            s.linked_product_id if status == "linked" else None,
        )
        grouped.setdefault(key, []).append(s)

    groups: List[BacklogGroup] = []
    for (norm_desc, cat_name, linked_pid), rows in grouped.items():
        rows_sorted = sorted(rows, key=lambda r: (r.tx_date, r.id or 0), reverse=True)
        stores = sorted(
            {
                r.firefly_expense_account_name
                for r in rows_sorted
                if r.firefly_expense_account_name
            }
        )[:3]
        tag_map: dict[str, str] = {}
        for r in rows_sorted:
            try:
                parsed_tags = json.loads(r.tags_json or "[]")
            except Exception:
                parsed_tags = []
            if isinstance(parsed_tags, list):
                for raw_t in parsed_tags:
                    clean_t = str(raw_t).strip()
                    if clean_t and clean_t.lower() not in tag_map:
                        tag_map[clean_t.lower()] = clean_t
        sample_tags = sorted(tag_map.values(), key=lambda s: s.lower())

        hint = hint_map.get(norm_desc) if status == "unassociated" else None
        groups.append(
            BacklogGroup(
                normalized_description=norm_desc,
                sample_description=rows_sorted[0].description,
                category_name=cat_name,
                occurrence_count=len(rows_sorted),
                total_amount=round(sum(r.amount_cents for r in rows_sorted) / 100.0, 2),
                latest_date=rows_sorted[0].tx_date,
                sample_stores=stores,
                sample_tags=sample_tags,
                journal_ids=[r.transaction_journal_id for r in rows_sorted],
                suggested_product_id=hint[0] if hint else None,
                suggested_product_name=hint[1] if hint else None,
                linked_product_id=linked_pid,
                linked_product_name=(
                    product_name_by_id.get(linked_pid) if linked_pid is not None else None
                ),
            )
        )

    groups.sort(key=lambda g: (-g.occurrence_count, -g.latest_date.toordinal(), g.normalized_description))

    return BacklogResponse(
        total_unassociated=len(unassociated),
        linked_count=len(linked_splits),
        ignored_count=len(ignored_splits),
        category_counts=category_counts,
        groups=groups,
    )


@router.post("/backlog/ignore")
def ignore_backlog_splits(
    req: BacklogIgnoreRequest,
    session: Session = Depends(get_session),
):
    splits = session.exec(
        select(FireflySyncedSplit).where(
            FireflySyncedSplit.transaction_journal_id.in_(req.transaction_journal_ids)
        )
    ).all()
    for s in splits:
        s.is_ignored = req.ignored
        session.add(s)
    session.commit()
    return {"updated_count": len(splits), "ignored": req.ignored}


@router.post("/backlog/unlink")
def unlink_backlog_splits(
    req: BacklogUnlinkRequest,
    session: Session = Depends(get_session),
):
    """Unlinks cached Firefly splits back to the unassociated backlog locally without touching Firefly III."""
    splits = session.exec(
        select(FireflySyncedSplit).where(
            FireflySyncedSplit.transaction_journal_id.in_(req.transaction_journal_ids)
        )
    ).all()
    for s in splits:
        s.linked_product_id = None
        s.is_ignored = False
        session.add(s)

    synced_prices = session.exec(
        select(PriceRecord).where(
            PriceRecord.transaction_journal_id.in_(req.transaction_journal_ids),
            PriceRecord.source_type == "firefly_sync",
        )
    ).all()
    for pr in synced_prices:
        session.delete(pr)

    session.commit()
    return {"updated_count": len(splits)}


@router.get("/jobs", response_model=List[FireflySyncJobResponse])
def list_sync_jobs(
    include_dismissed: bool = Query(False),
    limit: int = Query(20, ge=1, le=100),
    session: Session = Depends(get_session),
):
    return _list_visible_jobs(session, include_dismissed=include_dismissed, limit=limit)


@router.get("/jobs/stream")
async def stream_sync_jobs(
    request: Request,
    session: Session = Depends(get_session),
):
    """
    Server-Sent Events stream emitting `snapshot` immediately and `jobs` updates
    whenever background Firefly rewrite jobs progress or finish.
    Closes once no queued/running jobs remain.
    """
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue[str] = asyncio.Queue()
    subscriber = (loop, queue)
    _job_subscribers.add(subscriber)
    bind = session.get_bind()
    initial_jobs = _list_visible_jobs(session, include_dismissed=False, limit=20)
    initial_json = json.dumps([j.model_dump(mode="json") for j in initial_jobs])
    has_active_initially = any(j.status in {"queued", "running"} for j in initial_jobs)

    async def event_generator():
        try:
            yield f"event: snapshot\ndata: {initial_json}\n\n"
            if not has_active_initially:
                return
            while True:
                if await request.is_disconnected():
                    break
                try:
                    payload_json = await asyncio.wait_for(
                        queue.get(), timeout=SSE_HEARTBEAT_SECONDS
                    )
                except asyncio.TimeoutError:
                    with Session(bind) as db_session:
                        refreshed_json = _jobs_snapshot_json(db_session)
                        parsed = json.loads(refreshed_json)
                        if not any(
                            j.get("status") in {"queued", "running"}
                            for j in parsed
                            if isinstance(j, dict)
                        ):
                            yield f"event: jobs\ndata: {refreshed_json}\n\n"
                            break
                    yield ": keepalive\n\n"
                    continue
                yield f"event: jobs\ndata: {payload_json}\n\n"
                try:
                    parsed = json.loads(payload_json)
                    if not any(
                        j.get("status") in {"queued", "running"}
                        for j in parsed
                        if isinstance(j, dict)
                    ):
                        break
                except Exception:
                    pass
        finally:
            _job_subscribers.discard(subscriber)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/jobs/{job_id}", response_model=FireflySyncJobResponse)
def get_sync_job(job_id: int, session: Session = Depends(get_session)):
    job = session.get(FireflySyncJob, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Sync job not found")
    return _serialize_job(job)


@router.post("/jobs/{job_id}/dismiss", response_model=FireflySyncJobResponse)
def dismiss_sync_job(job_id: int, session: Session = Depends(get_session)):
    job = session.get(FireflySyncJob, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Sync job not found")
    if job.status in {"queued", "running"}:
        raise HTTPException(
            status_code=409, detail="Cannot dismiss an active sync job"
        )
    job.dismissed_at = datetime.now(timezone.utc)
    session.add(job)
    session.commit()
    session.refresh(job)
    _broadcast_jobs_snapshot(session)
    return _serialize_job(job)


@router.post("/backlog/link", status_code=202, response_model=FireflySyncJobResponse)
async def link_backlog_splits_to_product(
    req: BacklogLinkRequest,
    session: Session = Depends(get_session),
):
    product = session.exec(
        select(Product)
        .where(Product.id == req.product_id)
        .options(selectinload(Product.brand), selectinload(Product.tags))
    ).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    splits = session.exec(
        select(FireflySyncedSplit).where(
            FireflySyncedSplit.transaction_journal_id.in_(req.transaction_journal_ids)
        )
    ).all()
    if not splits:
        raise HTTPException(
            status_code=404, detail="No matching cached Firefly splits found"
        )

    # Record distinct normalized descriptions as ItemFireflyAlias before rewriting
    seen_aliases: dict[str, str] = {}
    for s in splits:
        if s.normalized_description not in seen_aliases:
            seen_aliases[s.normalized_description] = s.description

    for norm_desc, raw_desc in seen_aliases.items():
        existing_alias = session.exec(
            select(ItemFireflyAlias).where(
                ItemFireflyAlias.normalized_description == norm_desc
            )
        ).first()
        if existing_alias:
            if existing_alias.product_id != product.id:
                existing_alias.product_id = product.id
                existing_alias.raw_description = raw_desc
                session.add(existing_alias)
        else:
            session.add(
                ItemFireflyAlias(
                    product_id=product.id,
                    raw_description=raw_desc,
                    normalized_description=norm_desc,
                )
            )
    session.commit()

    job = enqueue_firefly_rewrite_job(
        session, product, splits, job_type="backlog_link"
    )
    return _serialize_job(job)

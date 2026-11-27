import asyncio
import json
import logging
from datetime import date, datetime, timedelta, timezone
from typing import List, Literal, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import case, func
from sqlalchemy.orm import selectinload
from sqlmodel import Session, select

from app.core.database import get_session
from app.models.firefly_cache import FireflySyncJob, FireflySyncState, FireflySyncedSplit
from app.models.price import PriceRecord
from app.models.product import ItemFireflyAlias, Product, format_firefly_description
from app.models.receipt import Receipt, ReceiptItem
from app.services.firefly import firefly_client
from app.services.firefly_sync_jobs import (
    FireflySyncJobResponse,
    SSE_HEARTBEAT_SECONDS,
    broadcast_jobs_snapshot,
    dismiss_all_finished_sync_jobs,
    enqueue_firefly_rewrite_job,
    ensure_aware_utc,
    ensure_no_active_sync_job,
    jobs_snapshot_json,
    list_visible_sync_jobs,
    serialize_sync_job,
    subscribe_to_job_stream,
    unsubscribe_from_job_stream,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/firefly-sync", tags=["Firefly Backlog & Sync"])

INCREMENTAL_COOLDOWN_SECONDS = 60
INCREMENTAL_LOOKBACK_DAYS = 7

_sync_transactions_lock = asyncio.Lock()


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


@router.get("/status", response_model=SyncStatusResponse)
def get_sync_status(session: Session = Depends(get_session)):
    state = session.get(FireflySyncState, 1)
    counts = session.exec(
        select(
            func.count(FireflySyncedSplit.id),
            func.coalesce(
                func.sum(
                    case(
                        (
                            FireflySyncedSplit.linked_product_id.is_(None)
                            & FireflySyncedSplit.is_ignored.is_(False),
                            1,
                        ),
                        else_=0,
                    )
                ),
                0,
            ),
            func.coalesce(
                func.sum(case((FireflySyncedSplit.is_ignored.is_(True), 1), else_=0)),
                0,
            ),
        )
    ).one()
    total_cached, unassociated, ignored = (int(counts[0] or 0), int(counts[1] or 0), int(counts[2] or 0))
    return SyncStatusResponse(
        last_full_sync_at=state.last_full_sync_at if state else None,
        last_incremental_sync_at=state.last_incremental_sync_at if state else None,
        high_watermark_date=state.high_watermark_date if state else None,
        total_cached_splits=total_cached,
        unassociated_count=unassociated,
        ignored_count=ignored,
    )


@router.post("/transactions", response_model=SyncTransactionsResponse)
async def sync_firefly_transactions(
    mode: Literal["incremental", "full"] = Query("incremental"),
    session: Session = Depends(get_session),
):
    async with _sync_transactions_lock:
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
            last_sync = ensure_aware_utc(
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

        incoming_jids: set[int] = set()
        for tx in raw_txs:
            for raw_split in tx.get("attributes", {}).get("transactions", []):
                try:
                    incoming_jids.add(int(raw_split.get("transaction_journal_id")))
                except (TypeError, ValueError):
                    continue

        existing_by_jid: dict[int, FireflySyncedSplit] = {}
        jid_list = list(incoming_jids)
        for offset in range(0, len(jid_list), 500):
            chunk = jid_list[offset : offset + 500]
            for row in session.exec(
                select(FireflySyncedSplit).where(
                    FireflySyncedSplit.transaction_journal_id.in_(chunk)
                )
            ).all():
                existing_by_jid[row.transaction_journal_id] = row

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
        if req.ignored:
            s.linked_product_id = None
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
    return list_visible_sync_jobs(session, include_dismissed=include_dismissed, limit=limit)


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
    subscriber, queue = subscribe_to_job_stream(loop)
    bind = session.get_bind()
    initial_jobs = list_visible_sync_jobs(session, include_dismissed=False, limit=20)
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
                        refreshed_json = jobs_snapshot_json(db_session)
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
            unsubscribe_from_job_stream(subscriber)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


class DismissAllSyncJobsResponse(BaseModel):
    dismissed_count: int


@router.post("/jobs/dismiss-all", response_model=DismissAllSyncJobsResponse)
def dismiss_all_sync_jobs(session: Session = Depends(get_session)):
    dismissed_count = dismiss_all_finished_sync_jobs(session)
    return DismissAllSyncJobsResponse(dismissed_count=dismissed_count)


@router.get("/jobs/{job_id}", response_model=FireflySyncJobResponse)
def get_sync_job(job_id: int, session: Session = Depends(get_session)):
    job = session.get(FireflySyncJob, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Sync job not found")
    return serialize_sync_job(job)


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
    broadcast_jobs_snapshot(session)
    return serialize_sync_job(job)


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

    assert product.id is not None
    ensure_no_active_sync_job(session, product.id)

    splits = session.exec(
        select(FireflySyncedSplit).where(
            FireflySyncedSplit.transaction_journal_id.in_(req.transaction_journal_ids)
        )
    ).all()
    if not splits:
        raise HTTPException(
            status_code=404, detail="No matching cached Firefly splits found"
        )

    # Record distinct normalized descriptions as ItemFireflyAlias atomically with job creation
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

    job = enqueue_firefly_rewrite_job(
        session, product, splits, job_type="backlog_link"
    )
    return serialize_sync_job(job)

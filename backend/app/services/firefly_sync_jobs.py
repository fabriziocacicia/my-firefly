import asyncio
import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, List, Literal, Optional

import httpx
from fastapi import HTTPException
from pydantic import BaseModel
from sqlalchemy import or_
from sqlmodel import Session, select

from app.models.firefly_cache import FireflySyncJob, FireflySyncedSplit
from app.models.price import PriceRecord
from app.models.product import Product, format_firefly_description
from app.models.tag import Tag
from app.services.firefly import firefly_client
from app.services.pricing import normalize_unit_price
from app.services.taxonomy import expand_tags_ordered, get_implication_map

logger = logging.getLogger(__name__)

FIREFLY_REWRITE_CONCURRENCY = 4
SSE_HEARTBEAT_SECONDS = 15.0
MAX_STORED_JOB_ERRORS = 50
SSE_QUEUE_MAXSIZE = 8
COMPLETED_BANNER_TTL_SECONDS = 300
ACTIVE_JOB_STATUSES = ("queued", "running")

_job_subscribers: set[tuple[asyncio.AbstractEventLoop, asyncio.Queue[str]]] = set()
_active_job_tasks: set[asyncio.Task] = set()


class FailedTransactionRewrite(BaseModel):
    firefly_transaction_id: int
    error: str
    split_count: int = 1


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
    processed_splits: int = 0
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


def ensure_aware_utc(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def serialize_sync_job(job: FireflySyncJob) -> FireflySyncJobResponse:
    try:
        raw_errors = json.loads(job.failed_transactions_json or "[]")
    except Exception:
        raw_errors = []
    try:
        raw_jids = json.loads(job.target_journal_ids_json or "[]")
    except Exception:
        raw_jids = []

    parsed_errors = [
        FailedTransactionRewrite(**e) for e in raw_errors if isinstance(e, dict)
    ]
    failed_splits_sum = sum(max(1, e.split_count) for e in parsed_errors)
    if job.status in {"completed", "completed_with_errors", "failed"} and (
        job.failed_count > len(parsed_errors) or job.total_transactions == 0
    ):
        processed_splits = job.total_splits
    else:
        processed_splits = min(job.total_splits, job.updated_splits + failed_splits_sum)

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
        processed_splits=processed_splits,
        linked_splits=job.linked_splits,
        updated_splits=job.updated_splits,
        failed_count=job.failed_count,
        failed_transactions=parsed_errors,
        target_journal_ids=[int(j) for j in raw_jids],
        error_message=job.error_message,
        dismissed_at=ensure_aware_utc(job.dismissed_at),
        created_at=ensure_aware_utc(job.created_at) or datetime.now(timezone.utc),
        started_at=ensure_aware_utc(job.started_at),
        finished_at=ensure_aware_utc(job.finished_at),
    )


def is_sync_job_banner_visible(
    job: FireflySyncJob, now: Optional[datetime] = None
) -> bool:
    """Returns whether a sync job should still render as an inline banner."""
    if job.status in ACTIVE_JOB_STATUSES:
        return True
    if job.dismissed_at is not None:
        return False
    if job.status == "completed":
        current_now = now or datetime.now(timezone.utc)
        ref_dt = ensure_aware_utc(job.finished_at) or ensure_aware_utc(job.created_at)
        if ref_dt is None:
            return False
        return (current_now - ref_dt) <= timedelta(seconds=COMPLETED_BANNER_TTL_SECONDS)
    return True


def list_visible_sync_jobs(
    session: Session, include_dismissed: bool = False, limit: int = 20
) -> List[FireflySyncJobResponse]:
    stmt = select(FireflySyncJob).order_by(
        FireflySyncJob.created_at.desc(), FireflySyncJob.id.desc()
    )
    if include_dismissed:
        rows = session.exec(stmt.limit(limit)).all()
        return [serialize_sync_job(r) for r in rows]

    candidates = session.exec(
        stmt.where(
            or_(
                FireflySyncJob.dismissed_at.is_(None),
                FireflySyncJob.status.in_(list(ACTIVE_JOB_STATUSES)),
            )
        )
    ).all()
    now = datetime.now(timezone.utc)
    visible = [r for r in candidates if is_sync_job_banner_visible(r, now)][:limit]
    return [serialize_sync_job(r) for r in visible]


def dismiss_all_finished_sync_jobs(session: Session) -> int:
    """Marks all non-dismissed finished jobs as dismissed without touching active jobs."""
    now = datetime.now(timezone.utc)
    rows = session.exec(
        select(FireflySyncJob).where(
            FireflySyncJob.dismissed_at.is_(None),
            FireflySyncJob.status.notin_(list(ACTIVE_JOB_STATUSES)),
        )
    ).all()
    if not rows:
        return 0
    for job in rows:
        job.dismissed_at = now
        session.add(job)
    session.commit()
    broadcast_jobs_snapshot(session)
    return len(rows)


def jobs_snapshot_json(session: Session) -> str:
    jobs = list_visible_sync_jobs(session, include_dismissed=False, limit=20)
    return json.dumps([j.model_dump(mode="json") for j in jobs])


def _push_bounded_snapshot(queue: asyncio.Queue[str], snapshot_json: str) -> None:
    if queue.full():
        try:
            queue.get_nowait()
        except asyncio.QueueEmpty:
            pass
    try:
        queue.put_nowait(snapshot_json)
    except asyncio.QueueFull:
        pass


def broadcast_jobs_snapshot(session: Session) -> None:
    if not _job_subscribers:
        return
    snapshot_json = jobs_snapshot_json(session)
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
                _push_bounded_snapshot(queue, snapshot_json)
            else:
                loop.call_soon_threadsafe(_push_bounded_snapshot, queue, snapshot_json)
        except Exception:
            _job_subscribers.discard(sub)


def subscribe_to_job_stream(loop: asyncio.AbstractEventLoop) -> tuple[tuple[asyncio.AbstractEventLoop, asyncio.Queue[str]], asyncio.Queue[str]]:
    queue: asyncio.Queue[str] = asyncio.Queue(maxsize=SSE_QUEUE_MAXSIZE)
    sub = (loop, queue)
    _job_subscribers.add(sub)
    return sub, queue


def unsubscribe_from_job_stream(sub: tuple[asyncio.AbstractEventLoop, asyncio.Queue[str]]) -> None:
    _job_subscribers.discard(sub)


def mark_interrupted_sync_jobs_failed(target_engine: Any) -> int:
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


async def shutdown_firefly_sync_jobs(target_engine: Any) -> None:
    """Cancels and awaits active background sync tasks cleanly before HTTP client close."""
    tasks = list(_active_job_tasks)
    for task in tasks:
        task.cancel()
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)
    mark_interrupted_sync_jobs_failed(target_engine)


def ensure_no_active_sync_job(session: Session, product_id: int) -> None:
    active = session.exec(
        select(FireflySyncJob).where(
            FireflySyncJob.product_id == product_id,
            FireflySyncJob.status.in_(["queued", "running"]),
        )
    ).first()
    if active:
        raise HTTPException(
            status_code=409,
            detail=f"A Firefly sync job (#{active.id}) is already running for product #{product_id}.",
        )


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


def _upsert_price_record_for_split_values(
    session: Session,
    *,
    product_id: int,
    default_unit: str,
    package_size: Optional[float],
    split: FireflySyncedSplit,
    sale_mode: str = "packaged",
) -> None:
    if not split.firefly_expense_account_id:
        return
    paid_price = round(split.amount_cents / 100.0, 2)
    is_loose = sale_mode == "loose_weight"
    eff_pkg_size = package_size if package_size and package_size > 0 else 1.0

    existing = session.exec(
        select(PriceRecord).where(
            PriceRecord.transaction_journal_id == split.transaction_journal_id
        )
    ).first()
    if existing:
        existing.firefly_account_id = split.firefly_expense_account_id
        existing.recorded_date = split.tx_date
        existing.paid_price = paid_price
        existing.firefly_transaction_id = split.firefly_transaction_id

        if existing.product_id == product_id:
            if not existing.is_discount:
                existing.regular_price = paid_price
            if existing.quantity is not None and existing.quantity > 0:
                pkg = (
                    existing.package_size
                    if existing.package_size is not None and existing.package_size > 0
                    else eff_pkg_size
                )
                existing.normalized_unit_price = normalize_unit_price(
                    price=paid_price,
                    quantity=existing.quantity,
                    unit=existing.unit or default_unit,
                    package_size=pkg,
                )
                existing.normalized_regular_price = normalize_unit_price(
                    price=existing.regular_price,
                    quantity=existing.quantity,
                    unit=existing.unit or default_unit,
                    package_size=pkg,
                )
            else:
                existing.normalized_unit_price = None
                existing.normalized_regular_price = None
        else:
            existing.product_id = product_id
            existing.regular_price = paid_price
            existing.is_discount = False
            existing.unit = default_unit
            existing.package_size = package_size
            if is_loose:
                existing.quantity = None
                existing.normalized_unit_price = None
                existing.normalized_regular_price = None
                existing.verification_status = "missing"
            else:
                norm_price = normalize_unit_price(
                    price=paid_price,
                    quantity=1.0,
                    unit=default_unit,
                    package_size=eff_pkg_size,
                )
                existing.quantity = 1.0
                existing.normalized_unit_price = norm_price
                existing.normalized_regular_price = norm_price
                existing.verification_status = "verified"
        session.add(existing)
    else:
        if is_loose:
            qty: Optional[float] = None
            norm_price = None
            ver_status = "missing"
        else:
            qty = 1.0
            norm_price = normalize_unit_price(
                price=paid_price,
                quantity=1.0,
                unit=default_unit,
                package_size=eff_pkg_size,
            )
            ver_status = "verified"

        session.add(
            PriceRecord(
                product_id=product_id,
                firefly_account_id=split.firefly_expense_account_id,
                recorded_date=split.tx_date,
                regular_price=paid_price,
                paid_price=paid_price,
                is_discount=False,
                quantity=qty,
                unit=default_unit,
                package_size=package_size,
                normalized_unit_price=norm_price,
                normalized_regular_price=norm_price,
                firefly_transaction_id=split.firefly_transaction_id,
                transaction_journal_id=split.transaction_journal_id,
                source_type="firefly_sync",
                verification_status=ver_status,
            )
        )


async def _rewrite_single_firefly_transaction(
    ff_tx_id: int,
    target_jids: set[int],
    ff_description: str,
    category_name: Optional[str],
    expanded_tag_names: List[str],
    match_descriptions_lower: Optional[set[str]] = None,
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
                split_count=max(1, len(target_jids)),
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
            raw_desc_lower = str(raw_split.get("description") or "").strip().lower()
            is_target = jid in target_jids or (
                not target_jids
                and match_descriptions_lower is not None
                and raw_desc_lower in match_descriptions_lower
            )
            if is_target:
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
                split_count=max(1, len(target_jids)),
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
            split_count=max(1, len(target_jids)),
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
    match_descriptions_lower: Optional[set[str]] = None,
    sale_mode: str = "packaged",
) -> None:
    sem = asyncio.Semaphore(FIREFLY_REWRITE_CONCURRENCY)
    norm_product_name = ff_description.strip().lower()

    with Session(bind) as db_session:
        job = db_session.get(FireflySyncJob, job_id)
        if not job:
            return
        job.status = "running"
        job.started_at = datetime.now(timezone.utc)
        db_session.add(job)
        db_session.commit()
        broadcast_jobs_snapshot(db_session)

    async def _process_one(ff_tx_id: int, target_jids: List[int]) -> None:
        async with sem:
            matched_jids, failure = await _rewrite_single_firefly_transaction(
                ff_tx_id=ff_tx_id,
                target_jids=set(target_jids),
                ff_description=ff_description,
                category_name=category_name,
                expanded_tag_names=expanded_tag_names,
                match_descriptions_lower=match_descriptions_lower,
            )

        with Session(bind) as db_session:
            job = db_session.get(FireflySyncJob, job_id)
            if not job:
                return
            job.processed_transactions += 1
            if failure is not None:
                failure.split_count = max(1, len(target_jids))
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
                            sale_mode=sale_mode,
                        )

            db_session.add(job)
            db_session.commit()
            broadcast_jobs_snapshot(db_session)

    try:
        await asyncio.gather(
            *(
                _process_one(ff_tx_id, jids)
                for ff_tx_id, jids in grouped_tx_jids.items()
            )
        )
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
            broadcast_jobs_snapshot(db_session)
    except asyncio.CancelledError:
        logger.info("FireflySyncJob #%s cancelled during shutdown", job_id)
        raise
    except Exception as exc:
        logger.exception("Unexpected failure in FireflySyncJob #%s", job_id)
        with Session(bind) as db_session:
            job = db_session.get(FireflySyncJob, job_id)
            if job:
                job.status = "failed"
                job.error_message = f"Unexpected error ({type(exc).__name__}); see server logs"
                job.finished_at = datetime.now(timezone.utc)
                db_session.add(job)
                db_session.commit()
                broadcast_jobs_snapshot(db_session)


def enqueue_firefly_rewrite_job(
    session: Session,
    product: Product,
    splits: List[FireflySyncedSplit],
    job_type: Literal["backlog_link", "product_propagate"],
    extra_tx_ids: Optional[set[int]] = None,
    match_descriptions_lower: Optional[set[str]] = None,
    commit: bool = True,
) -> FireflySyncJob:
    """
    Creates a persistent FireflySyncJob and schedules its background asyncio worker.
    Raises HTTP 409 if an active job for `product.id` is already queued/running.
    """
    if product.id is None:
        raise HTTPException(status_code=400, detail="Product must be persisted first")

    ensure_no_active_sync_job(session, product.id)

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
    for tx_id in sorted(extra_tx_ids or set()):
        grouped_tx_jids.setdefault(tx_id, [])

    now = datetime.now(timezone.utc)
    total_splits = len(splits) + len((extra_tx_ids or set()) - {s.firefly_transaction_id for s in splits})
    job = FireflySyncJob(
        job_type=job_type,
        product_id=product.id,
        product_name=product.name,
        status="queued" if grouped_tx_jids else "completed",
        total_transactions=len(grouped_tx_jids),
        total_splits=total_splits,
        target_journal_ids_json=json.dumps(target_jids),
        created_at=now,
        finished_at=now if not grouped_tx_jids else None,
    )
    session.add(job)
    if commit:
        session.commit()
    else:
        session.commit()
    session.refresh(job)
    broadcast_jobs_snapshot(session)

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
                match_descriptions_lower=match_descriptions_lower,
                sale_mode=product.sale_mode,
            )
        )
        _active_job_tasks.add(task)
        task.add_done_callback(_active_job_tasks.discard)

    return job

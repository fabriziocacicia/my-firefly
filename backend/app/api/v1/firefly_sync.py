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
from app.models.company import AccountMetadata, CompanyAccountLink
from app.models.firefly_cache import FireflySyncJob, FireflySyncState, FireflySyncedSplit
from app.models.price import PriceRecord
from app.models.product import (
    ItemFireflyAlias,
    Product,
    build_alias_scope_key,
    format_firefly_description,
)
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
    needs_attention_count: int = 0


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


class ChainFilterOption(BaseModel):
    id: int
    name: str
    count: int


class StoreFilterOption(BaseModel):
    account_id: int
    name: str
    company_id: Optional[int] = None
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
    suggested_scope: Optional[str] = None
    linked_product_id: Optional[int] = None
    linked_product_name: Optional[str] = None
    chain_count: int = 0
    store_count: int = 0


class BacklogResponse(BaseModel):
    total_unassociated: int
    linked_count: int = 0
    ignored_count: int
    needs_attention_count: int = 0
    category_counts: List[CategoryBacklogCount]
    available_chains: List[ChainFilterOption] = []
    available_stores: List[StoreFilterOption] = []
    groups: List[BacklogGroup]


class AttentionSplitItem(BaseModel):
    price_record_id: int
    product_id: int
    product_name: str
    brand_name: Optional[str] = None
    sale_mode: str
    default_unit: str
    transaction_journal_id: Optional[int] = None
    firefly_transaction_id: Optional[int] = None
    split_description: Optional[str] = None
    category_name: Optional[str] = None
    firefly_account_id: int
    store_name: str
    company_id: Optional[int] = None
    company_name: Optional[str] = None
    recorded_date: date
    paid_price: float
    regular_price: float
    is_discount: bool
    quantity: Optional[float] = None
    unit: str
    package_size: Optional[float] = None
    normalized_unit_price: Optional[float] = None
    normalized_regular_price: Optional[float] = None
    verification_status: str
    notes: Optional[str] = None


class AttentionQueueResponse(BaseModel):
    missing_count: int
    needs_review_count: int
    available_chains: List[ChainFilterOption] = []
    available_stores: List[StoreFilterOption] = []
    items: List[AttentionSplitItem]


class BacklogLinkRequest(BaseModel):
    product_id: int
    transaction_journal_ids: List[int] = Field(min_length=1)
    alias_scope: Literal["auto", "global", "chain", "store", "none"] = "auto"


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


def _load_account_chain_map(session: Session) -> dict[int, tuple[int, str]]:
    """Maps firefly_account_id -> (company_id, company_name) using AccountMetadata and CompanyAccountLink."""
    mapping: dict[int, tuple[int, str]] = {}
    links = session.exec(
        select(CompanyAccountLink).options(selectinload(CompanyAccountLink.company))
    ).all()
    for link in links:
        if link.company is not None and link.company.id is not None:
            mapping[link.firefly_account_id] = (link.company.id, link.company.name)

    metas = session.exec(
        select(AccountMetadata)
        .where(AccountMetadata.company_id.is_not(None))
        .options(selectinload(AccountMetadata.company))
    ).all()
    for meta in metas:
        if meta.company is not None and meta.company.id is not None:
            mapping[meta.firefly_account_id] = (meta.company.id, meta.company.name)
    return mapping


def _build_alias_lookup(
    session: Session,
) -> tuple[
    dict[tuple[str, str], tuple[int, str]],
    dict[str, tuple[int, str]],
    dict[int, str],
]:
    aliases = session.exec(
        select(ItemFireflyAlias).options(selectinload(ItemFireflyAlias.product))
    ).all()
    scoped_hints: dict[tuple[str, str], tuple[int, str]] = {}
    for a in aliases:
        if a.product is not None and a.product.id is not None:
            scoped_hints[(a.normalized_description, a.scope_key or "global")] = (
                a.product_id,
                a.product.name,
            )

    products = session.exec(select(Product).options(selectinload(Product.brand))).all()
    fallback_hints: dict[str, tuple[int, str]] = {}
    product_name_by_id: dict[int, str] = {}
    for p in products:
        if p.id is not None:
            product_name_by_id[p.id] = p.name
            fallback_hints.setdefault(format_firefly_description(p).lower(), (p.id, p.name))
            fallback_hints.setdefault(p.name.strip().lower(), (p.id, p.name))
    return scoped_hints, fallback_hints, product_name_by_id


def _resolve_hint(
    norm_desc: str,
    *,
    account_id: Optional[int],
    company_id: Optional[int],
    scoped_hints: dict[tuple[str, str], tuple[int, str]],
    fallback_hints: dict[str, tuple[int, str]],
) -> tuple[Optional[int], Optional[str], Optional[str]]:
    if account_id is not None:
        hit = scoped_hints.get((norm_desc, f"store:{account_id}"))
        if hit:
            return hit[0], hit[1], "store"
    if company_id is not None:
        hit = scoped_hints.get((norm_desc, f"chain:{company_id}"))
        if hit:
            return hit[0], hit[1], "chain"
    hit = scoped_hints.get((norm_desc, "global"))
    if hit:
        return hit[0], hit[1], "global"
    fb = fallback_hints.get(norm_desc)
    if fb:
        return fb[0], fb[1], "canonical"
    return None, None, None


def _resolve_group_hint(
    norm_desc: str,
    rows: List[FireflySyncedSplit],
    *,
    account_to_chain: dict[int, tuple[int, str]],
    filter_company_id: Optional[int],
    filter_account_id: Optional[int],
    scoped_hints: dict[tuple[str, str], tuple[int, str]],
    fallback_hints: dict[str, tuple[int, str]],
) -> tuple[Optional[int], Optional[str], Optional[str]]:
    if filter_account_id is not None:
        cid = account_to_chain.get(filter_account_id, (None, None))[0]
        return _resolve_hint(
            norm_desc,
            account_id=filter_account_id,
            company_id=cid,
            scoped_hints=scoped_hints,
            fallback_hints=fallback_hints,
        )

    distinct_accounts = {
        r.firefly_expense_account_id
        for r in rows
        if r.firefly_expense_account_id is not None
    }
    if len(distinct_accounts) == 1:
        only_aid = next(iter(distinct_accounts))
        cid = account_to_chain.get(only_aid, (None, None))[0]
        return _resolve_hint(
            norm_desc,
            account_id=only_aid,
            company_id=cid,
            scoped_hints=scoped_hints,
            fallback_hints=fallback_hints,
        )

    if filter_company_id is not None:
        return _resolve_hint(
            norm_desc,
            account_id=None,
            company_id=filter_company_id,
            scoped_hints=scoped_hints,
            fallback_hints=fallback_hints,
        )

    distinct_chains = {
        account_to_chain[aid][0]
        for aid in distinct_accounts
        if aid in account_to_chain
    }
    has_unchained = any(aid not in account_to_chain for aid in distinct_accounts)
    if len(distinct_chains) == 1 and not has_unchained:
        return _resolve_hint(
            norm_desc,
            account_id=None,
            company_id=next(iter(distinct_chains)),
            scoped_hints=scoped_hints,
            fallback_hints=fallback_hints,
        )

    return _resolve_hint(
        norm_desc,
        account_id=None,
        company_id=None,
        scoped_hints=scoped_hints,
        fallback_hints=fallback_hints,
    )


def _build_filter_options(
    records: List[tuple[Optional[int], Optional[str]]],
    account_to_chain: dict[int, tuple[int, str]],
) -> tuple[List[ChainFilterOption], List[StoreFilterOption]]:
    chain_counts: dict[int, tuple[str, int]] = {}
    store_counts: dict[int, tuple[str, Optional[int], int]] = {}
    for aid, name in records:
        if aid is None:
            continue
        clean_name = (name or f"Account #{aid}").strip()
        chain_info = account_to_chain.get(aid)
        cid = chain_info[0] if chain_info else None
        if chain_info:
            cname = chain_info[1]
            prev_name, prev_cnt = chain_counts.get(cid, (cname, 0))
            chain_counts[cid] = (prev_name, prev_cnt + 1)
        prev_sname, prev_cid, prev_scnt = store_counts.get(aid, (clean_name, cid, 0))
        store_counts[aid] = (prev_sname, prev_cid, prev_scnt + 1)

    chains = [
        ChainFilterOption(id=cid, name=cname, count=cnt)
        for cid, (cname, cnt) in sorted(
            chain_counts.items(), key=lambda kv: (-kv[1][1], kv[1][0].lower())
        )
    ]
    stores = [
        StoreFilterOption(account_id=aid, name=sname, company_id=cid, count=cnt)
        for aid, (sname, cid, cnt) in sorted(
            store_counts.items(), key=lambda kv: (-kv[1][2], kv[1][0].lower())
        )
    ]
    return chains, stores


def _count_needs_attention(session: Session) -> int:
    ignored_jids = {
        jid
        for jid in session.exec(
            select(FireflySyncedSplit.transaction_journal_id).where(
                FireflySyncedSplit.is_ignored.is_(True)
            )
        ).all()
    }
    rows = session.exec(
        select(PriceRecord.id, PriceRecord.transaction_journal_id).where(
            PriceRecord.verification_status.in_(["missing", "needs_review"])
        )
    ).all()
    return sum(1 for _, jid in rows if jid is None or jid not in ignored_jids)


def _upsert_scoped_alias(
    session: Session,
    *,
    product_id: int,
    raw_desc: str,
    norm_desc: str,
    company_id: Optional[int],
    firefly_account_id: Optional[int],
) -> None:
    scope_key = build_alias_scope_key(
        company_id=company_id, firefly_account_id=firefly_account_id
    )
    existing_alias = session.exec(
        select(ItemFireflyAlias).where(
            ItemFireflyAlias.normalized_description == norm_desc,
            ItemFireflyAlias.scope_key == scope_key,
        )
    ).first()
    if existing_alias:
        existing_alias.product_id = product_id
        existing_alias.raw_description = raw_desc
        existing_alias.company_id = company_id
        existing_alias.firefly_account_id = firefly_account_id
        session.add(existing_alias)
    else:
        session.add(
            ItemFireflyAlias(
                product_id=product_id,
                raw_description=raw_desc,
                normalized_description=norm_desc,
                company_id=company_id,
                firefly_account_id=firefly_account_id,
                scope_key=scope_key,
            )
        )


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
        needs_attention_count=_count_needs_attention(session),
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
    company_id: Optional[int] = Query(None),
    account_id: Optional[int] = Query(None),
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

    account_to_chain = _load_account_chain_map(session)
    available_chains, available_stores = _build_filter_options(
        [(s.firefly_expense_account_id, s.firefly_expense_account_name) for s in target_pool],
        account_to_chain,
    )

    scoped_pool = target_pool
    if company_id is not None:
        scoped_pool = [
            s
            for s in scoped_pool
            if s.firefly_expense_account_id is not None
            and account_to_chain.get(s.firefly_expense_account_id, (None, None))[0] == company_id
        ]
    if account_id is not None:
        scoped_pool = [s for s in scoped_pool if s.firefly_expense_account_id == account_id]

    cat_counter: dict[Optional[str], int] = {}
    for s in scoped_pool:
        cat_counter[s.firefly_category_name] = cat_counter.get(s.firefly_category_name, 0) + 1

    category_counts = [
        CategoryBacklogCount(category_name=cat, count=cnt)
        for cat, cnt in sorted(
            cat_counter.items(),
            key=lambda kv: (-kv[1], (kv[0] or "").lower()),
        )
    ]

    filtered = scoped_pool
    if category == "__uncategorized__":
        filtered = [s for s in filtered if not s.firefly_category_name]
    elif category is not None and category != "":
        filtered = [s for s in filtered if s.firefly_category_name == category]

    if search and search.strip():
        needle = search.strip().lower()
        filtered = [s for s in filtered if needle in s.normalized_description]

    scoped_hints, fallback_hints, product_name_by_id = _build_alias_lookup(session)

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
        distinct_aids = {
            r.firefly_expense_account_id
            for r in rows_sorted
            if r.firefly_expense_account_id is not None
        }
        distinct_cids = {
            account_to_chain[aid][0]
            for aid in distinct_aids
            if aid in account_to_chain
        }
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

        sug_pid, sug_pname, sug_scope = (
            _resolve_group_hint(
                norm_desc,
                rows_sorted,
                account_to_chain=account_to_chain,
                filter_company_id=company_id,
                filter_account_id=account_id,
                scoped_hints=scoped_hints,
                fallback_hints=fallback_hints,
            )
            if status == "unassociated"
            else (None, None, None)
        )
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
                suggested_product_id=sug_pid,
                suggested_product_name=sug_pname,
                suggested_scope=sug_scope,
                linked_product_id=linked_pid,
                linked_product_name=(
                    product_name_by_id.get(linked_pid) if linked_pid is not None else None
                ),
                chain_count=len(distinct_cids),
                store_count=len(distinct_aids),
            )
        )

    groups.sort(key=lambda g: (-g.occurrence_count, -g.latest_date.toordinal(), g.normalized_description))

    return BacklogResponse(
        total_unassociated=len(unassociated),
        linked_count=len(linked_splits),
        ignored_count=len(ignored_splits),
        needs_attention_count=_count_needs_attention(session),
        category_counts=category_counts,
        available_chains=available_chains,
        available_stores=available_stores,
        groups=groups,
    )


@router.get("/backlog/attention", response_model=AttentionQueueResponse)
async def get_backlog_attention_queue(
    company_id: Optional[int] = Query(None),
    account_id: Optional[int] = Query(None),
    category: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    verification_status: Optional[Literal["missing", "needs_review"]] = Query(None),
    session: Session = Depends(get_session),
):
    records = session.exec(
        select(PriceRecord)
        .where(PriceRecord.verification_status.in_(["missing", "needs_review"]))
        .options(selectinload(PriceRecord.product).selectinload(Product.brand))
    ).all()

    jids = [r.transaction_journal_id for r in records if r.transaction_journal_id is not None]
    splits_by_jid: dict[int, FireflySyncedSplit] = {}
    if jids:
        for sp in session.exec(
            select(FireflySyncedSplit).where(
                FireflySyncedSplit.transaction_journal_id.in_(jids)
            )
        ).all():
            splits_by_jid[sp.transaction_journal_id] = sp

    active_records = [
        r
        for r in records
        if not (
            r.transaction_journal_id is not None
            and r.transaction_journal_id in splits_by_jid
            and splits_by_jid[r.transaction_journal_id].is_ignored
        )
    ]

    account_to_chain = _load_account_chain_map(session)
    unresolved_account_ids: set[int] = set()
    for r in active_records:
        sp = splits_by_jid.get(r.transaction_journal_id) if r.transaction_journal_id else None
        if not (sp and sp.firefly_expense_account_name):
            unresolved_account_ids.add(r.firefly_account_id)
    resolved_names = (
        await firefly_client.resolve_expense_account_names(unresolved_account_ids)
        if unresolved_account_ids
        else {}
    )

    filter_source: list[tuple[Optional[int], Optional[str]]] = []
    missing_count = 0
    needs_review_count = 0
    for r in active_records:
        if r.verification_status == "missing":
            missing_count += 1
        elif r.verification_status == "needs_review":
            needs_review_count += 1
        sp = splits_by_jid.get(r.transaction_journal_id) if r.transaction_journal_id else None
        sname = (
            sp.firefly_expense_account_name
            if sp and sp.firefly_expense_account_name
            else resolved_names.get(r.firefly_account_id, f"Account #{r.firefly_account_id}")
        )
        filter_source.append((r.firefly_account_id, sname))

    available_chains, available_stores = _build_filter_options(filter_source, account_to_chain)

    items: List[AttentionSplitItem] = []
    needle = search.strip().lower() if search and search.strip() else None
    for r in active_records:
        if r.id is None or r.product is None:
            continue
        if verification_status is not None and r.verification_status != verification_status:
            continue
        chain_info = account_to_chain.get(r.firefly_account_id)
        cid = chain_info[0] if chain_info else None
        cname = chain_info[1] if chain_info else None
        if company_id is not None and cid != company_id:
            continue
        if account_id is not None and r.firefly_account_id != account_id:
            continue

        sp = splits_by_jid.get(r.transaction_journal_id) if r.transaction_journal_id else None
        cat_name = (
            sp.firefly_category_name
            if sp and sp.firefly_category_name is not None
            else r.product.firefly_category_name
        )
        if category == "__uncategorized__":
            if cat_name:
                continue
        elif category is not None and category != "" and cat_name != category:
            continue

        split_desc = sp.description if sp else None
        if needle:
            haystack = " ".join(
                part
                for part in (
                    r.product.name,
                    r.product.brand.name if r.product.brand else "",
                    split_desc or "",
                )
                if part
            ).lower()
            if needle not in haystack:
                continue

        sname = (
            sp.firefly_expense_account_name
            if sp and sp.firefly_expense_account_name
            else resolved_names.get(r.firefly_account_id, f"Account #{r.firefly_account_id}")
        )
        items.append(
            AttentionSplitItem(
                price_record_id=r.id,
                product_id=r.product_id,
                product_name=r.product.name,
                brand_name=r.product.brand.name if r.product.brand else None,
                sale_mode=r.product.sale_mode,
                default_unit=r.product.default_unit,
                transaction_journal_id=r.transaction_journal_id,
                firefly_transaction_id=r.firefly_transaction_id,
                split_description=split_desc,
                category_name=cat_name,
                firefly_account_id=r.firefly_account_id,
                store_name=sname,
                company_id=cid,
                company_name=cname,
                recorded_date=r.recorded_date,
                paid_price=r.paid_price,
                regular_price=r.regular_price,
                is_discount=r.is_discount,
                quantity=r.quantity,
                unit=r.unit,
                package_size=r.package_size,
                normalized_unit_price=r.normalized_unit_price,
                normalized_regular_price=r.normalized_regular_price,
                verification_status=r.verification_status,
                notes=r.notes,
            )
        )

    items.sort(
        key=lambda item: (
            0 if item.verification_status == "missing" else 1,
            -item.recorded_date.toordinal(),
            -item.price_record_id,
        )
    )

    return AttentionQueueResponse(
        missing_count=missing_count,
        needs_review_count=needs_review_count,
        available_chains=available_chains,
        available_stores=available_stores,
        items=items,
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

    # Record scoped ItemFireflyAlias entries atomically with job creation
    if req.alias_scope != "none":
        account_to_chain = _load_account_chain_map(session)
        splits_by_desc: dict[str, list[FireflySyncedSplit]] = {}
        for s in splits:
            splits_by_desc.setdefault(s.normalized_description, []).append(s)

        for norm_desc, desc_splits in splits_by_desc.items():
            raw_desc = desc_splits[0].description
            distinct_aids = {
                s.firefly_expense_account_id
                for s in desc_splits
                if s.firefly_expense_account_id is not None
            }
            distinct_cids = {
                account_to_chain[aid][0]
                for aid in distinct_aids
                if aid in account_to_chain
            }
            unchained_aids = {aid for aid in distinct_aids if aid not in account_to_chain}

            if req.alias_scope == "store":
                if distinct_aids:
                    for aid in distinct_aids:
                        cid = account_to_chain.get(aid, (None, None))[0]
                        _upsert_scoped_alias(
                            session,
                            product_id=product.id,
                            raw_desc=raw_desc,
                            norm_desc=norm_desc,
                            company_id=cid,
                            firefly_account_id=aid,
                        )
                else:
                    _upsert_scoped_alias(
                        session,
                        product_id=product.id,
                        raw_desc=raw_desc,
                        norm_desc=norm_desc,
                        company_id=None,
                        firefly_account_id=None,
                    )
            elif req.alias_scope == "chain":
                for cid in distinct_cids:
                    _upsert_scoped_alias(
                        session,
                        product_id=product.id,
                        raw_desc=raw_desc,
                        norm_desc=norm_desc,
                        company_id=cid,
                        firefly_account_id=None,
                    )
                for aid in unchained_aids:
                    _upsert_scoped_alias(
                        session,
                        product_id=product.id,
                        raw_desc=raw_desc,
                        norm_desc=norm_desc,
                        company_id=None,
                        firefly_account_id=aid,
                    )
                if not distinct_cids and not unchained_aids:
                    _upsert_scoped_alias(
                        session,
                        product_id=product.id,
                        raw_desc=raw_desc,
                        norm_desc=norm_desc,
                        company_id=None,
                        firefly_account_id=None,
                    )
            elif req.alias_scope == "global":
                _upsert_scoped_alias(
                    session,
                    product_id=product.id,
                    raw_desc=raw_desc,
                    norm_desc=norm_desc,
                    company_id=None,
                    firefly_account_id=None,
                )
            else:  # "auto"
                if len(distinct_cids) == 1 and not unchained_aids:
                    _upsert_scoped_alias(
                        session,
                        product_id=product.id,
                        raw_desc=raw_desc,
                        norm_desc=norm_desc,
                        company_id=next(iter(distinct_cids)),
                        firefly_account_id=None,
                    )
                elif len(distinct_aids) == 1 and not distinct_cids:
                    _upsert_scoped_alias(
                        session,
                        product_id=product.id,
                        raw_desc=raw_desc,
                        norm_desc=norm_desc,
                        company_id=None,
                        firefly_account_id=next(iter(distinct_aids)),
                    )
                else:
                    _upsert_scoped_alias(
                        session,
                        product_id=product.id,
                        raw_desc=raw_desc,
                        norm_desc=norm_desc,
                        company_id=None,
                        firefly_account_id=None,
                    )

    job = enqueue_firefly_rewrite_job(
        session, product, splits, job_type="backlog_link"
    )
    return serialize_sync_job(job)

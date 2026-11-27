import json
from typing import List, Literal, Optional, Sequence, TypeVar

from sqlalchemy import func
from sqlalchemy.orm import selectinload
from sqlmodel import Session, select

from app.models.company import AccountMetadata, CompanyAccountLink
from app.models.firefly_backlog_schemas import (
    AttentionQueueResponse,
    AttentionSplitItem,
    BacklogChainBucket,
    BacklogGroup,
    BacklogIgnoreRequest,
    BacklogLinkRequest,
    BacklogResponse,
    BacklogSplitDetail,
    BacklogSplitsResponse,
    BacklogStoreBucket,
    BacklogUnlinkRequest,
    CategoryBacklogCount,
    ChainFilterOption,
    SplitPriceSummary,
    StoreFilterOption,
)
from app.models.firefly_cache import FireflySyncedSplit
from app.models.price import PriceRecord
from app.models.product import (
    ItemFireflyAlias,
    Product,
    build_alias_scope_key,
    format_firefly_description,
)
from app.services.firefly import firefly_client

T = TypeVar("T")
SQLITE_IN_CHUNK_SIZE = 500


def chunked(items: Sequence[T], size: int = SQLITE_IN_CHUNK_SIZE) -> List[Sequence[T]]:
    return [items[i : i + size] for i in range(0, len(items), size)]


def fetch_splits_by_journal_ids(
    session: Session, journal_ids: Sequence[int]
) -> List[FireflySyncedSplit]:
    rows: List[FireflySyncedSplit] = []
    for batch in chunked(list(journal_ids)):
        rows.extend(
            session.exec(
                select(FireflySyncedSplit).where(
                    FireflySyncedSplit.transaction_journal_id.in_(batch)
                )
            ).all()
        )
    return rows


def fetch_prices_by_journal_ids(
    session: Session,
    journal_ids: Sequence[int],
    *,
    source_type: Optional[str] = None,
) -> List[PriceRecord]:
    rows: List[PriceRecord] = []
    for batch in chunked(list(journal_ids)):
        stmt = select(PriceRecord).where(PriceRecord.transaction_journal_id.in_(batch))
        if source_type is not None:
            stmt = stmt.where(PriceRecord.source_type == source_type)
        rows.extend(session.exec(stmt).all())
    return rows


def parse_split_tags(tags_json: Optional[str]) -> List[str]:
    try:
        parsed = json.loads(tags_json or "[]")
    except Exception:
        return []
    if not isinstance(parsed, list):
        return []
    return [str(t).strip() for t in parsed if str(t).strip()]


def matches_category_filter(
    actual_category: Optional[str], requested_category: Optional[str]
) -> bool:
    if requested_category == "__uncategorized__":
        return not actual_category
    if requested_category is not None and requested_category != "":
        return actual_category == requested_category
    return True


def load_account_chain_map(session: Session) -> dict[int, tuple[int, str]]:
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


def build_alias_lookup(
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


def resolve_hint(
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


def resolve_group_hint(
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
        return resolve_hint(
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
        return resolve_hint(
            norm_desc,
            account_id=only_aid,
            company_id=cid,
            scoped_hints=scoped_hints,
            fallback_hints=fallback_hints,
        )

    if filter_company_id is not None:
        return resolve_hint(
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
        return resolve_hint(
            norm_desc,
            account_id=None,
            company_id=next(iter(distinct_chains)),
            scoped_hints=scoped_hints,
            fallback_hints=fallback_hints,
        )

    return resolve_hint(
        norm_desc,
        account_id=None,
        company_id=None,
        scoped_hints=scoped_hints,
        fallback_hints=fallback_hints,
    )


def build_filter_options(
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


def count_needs_attention(session: Session) -> int:
    stmt = (
        select(func.count(PriceRecord.id))
        .outerjoin(
            FireflySyncedSplit,
            FireflySyncedSplit.transaction_journal_id == PriceRecord.transaction_journal_id,
        )
        .where(PriceRecord.verification_status.in_(["missing", "needs_review"]))
        .where(
            FireflySyncedSplit.id.is_(None)
            | FireflySyncedSplit.is_ignored.is_(False)
        )
    )
    return int(session.exec(stmt).one() or 0)


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


def _resolve_alias_targets(
    alias_scope: Literal["auto", "global", "chain", "store"],
    *,
    distinct_aids: set[int],
    distinct_cids: set[int],
    unchained_aids: set[int],
    account_to_chain: dict[int, tuple[int, str]],
) -> List[tuple[Optional[int], Optional[int]]]:
    if alias_scope == "global":
        return [(None, None)]
    if alias_scope == "store":
        if not distinct_aids:
            return [(None, None)]
        return [(account_to_chain.get(aid, (None, None))[0], aid) for aid in distinct_aids]
    if alias_scope == "chain":
        targets: List[tuple[Optional[int], Optional[int]]] = [(cid, None) for cid in distinct_cids]
        targets.extend((None, aid) for aid in unchained_aids)
        return targets or [(None, None)]
    # "auto": prefer single chain, then single unchained store, else global
    if len(distinct_cids) == 1 and not unchained_aids:
        return [(next(iter(distinct_cids)), None)]
    if len(distinct_aids) == 1 and not distinct_cids:
        return [(None, next(iter(distinct_aids)))]
    return [(None, None)]


def record_scoped_aliases_for_link(
    session: Session,
    *,
    product_id: int,
    splits: List[FireflySyncedSplit],
    alias_scope: Literal["auto", "global", "chain", "store", "none"],
) -> None:
    if alias_scope == "none":
        return

    account_to_chain = load_account_chain_map(session)
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

        targets = _resolve_alias_targets(
            alias_scope,
            distinct_aids=distinct_aids,
            distinct_cids=distinct_cids,
            unchained_aids=unchained_aids,
            account_to_chain=account_to_chain,
        )
        for cid, aid in targets:
            _upsert_scoped_alias(
                session,
                product_id=product_id,
                raw_desc=raw_desc,
                norm_desc=norm_desc,
                company_id=cid,
                firefly_account_id=aid,
            )


def query_backlog(
    session: Session,
    *,
    status: Literal["unassociated", "linked", "ignored"],
    category: Optional[str],
    search: Optional[str],
    company_id: Optional[int],
    account_id: Optional[int],
) -> BacklogResponse:
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

    account_to_chain = load_account_chain_map(session)
    available_chains, available_stores = build_filter_options(
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

    filtered = [
        s for s in scoped_pool if matches_category_filter(s.firefly_category_name, category)
    ]

    if search and search.strip():
        needle = search.strip().lower()
        filtered = [s for s in filtered if needle in s.normalized_description]

    scoped_hints, fallback_hints, product_name_by_id = build_alias_lookup(session)

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
            for clean_t in parse_split_tags(r.tags_json):
                tag_map.setdefault(clean_t.lower(), clean_t)
        sample_tags = sorted(tag_map.values(), key=lambda s: s.lower())

        sug_pid, sug_pname, sug_scope = (
            resolve_group_hint(
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

    groups.sort(
        key=lambda g: (-g.occurrence_count, -g.latest_date.toordinal(), g.normalized_description)
    )

    return BacklogResponse(
        total_unassociated=len(unassociated),
        linked_count=len(linked_splits),
        ignored_count=len(ignored_splits),
        needs_attention_count=count_needs_attention(session),
        category_counts=category_counts,
        available_chains=available_chains,
        available_stores=available_stores,
        groups=groups,
    )


async def query_attention_queue(
    session: Session,
    *,
    company_id: Optional[int],
    account_id: Optional[int],
    category: Optional[str],
    search: Optional[str],
    verification_status: Optional[Literal["missing", "needs_review"]],
) -> AttentionQueueResponse:
    records = session.exec(
        select(PriceRecord)
        .where(PriceRecord.verification_status.in_(["missing", "needs_review"]))
        .options(selectinload(PriceRecord.product).selectinload(Product.brand))
    ).all()

    jids = [r.transaction_journal_id for r in records if r.transaction_journal_id is not None]
    splits_by_jid = {
        sp.transaction_journal_id: sp for sp in fetch_splits_by_journal_ids(session, jids)
    }

    active_records = [
        r
        for r in records
        if not (
            r.transaction_journal_id is not None
            and r.transaction_journal_id in splits_by_jid
            and splits_by_jid[r.transaction_journal_id].is_ignored
        )
    ]

    account_to_chain = load_account_chain_map(session)
    unresolved_account_ids = {
        r.firefly_account_id
        for r in active_records
        if not (
            (sp := splits_by_jid.get(r.transaction_journal_id) if r.transaction_journal_id else None)
            and sp.firefly_expense_account_name
        )
    }
    resolved_names = (
        await firefly_client.resolve_expense_account_names(unresolved_account_ids)
        if unresolved_account_ids
        else {}
    )

    def _resolve_store_name(rec: PriceRecord, sp: Optional[FireflySyncedSplit]) -> str:
        if sp and sp.firefly_expense_account_name:
            return sp.firefly_expense_account_name
        return resolved_names.get(rec.firefly_account_id, f"Account #{rec.firefly_account_id}")

    filter_source = [
        (
            r.firefly_account_id,
            _resolve_store_name(
                r, splits_by_jid.get(r.transaction_journal_id) if r.transaction_journal_id else None
            ),
        )
        for r in active_records
    ]
    available_chains, available_stores = build_filter_options(filter_source, account_to_chain)

    scoped_items: List[AttentionSplitItem] = []
    needle = search.strip().lower() if search and search.strip() else None
    for r in active_records:
        if r.id is None or r.product is None:
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
        if not matches_category_filter(cat_name, category):
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

        scoped_items.append(
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
                store_name=_resolve_store_name(r, sp),
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

    missing_count = sum(1 for item in scoped_items if item.verification_status == "missing")
    needs_review_count = sum(
        1 for item in scoped_items if item.verification_status == "needs_review"
    )

    items = (
        [item for item in scoped_items if item.verification_status == verification_status]
        if verification_status is not None
        else scoped_items
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


def _build_store_bucket(
    *,
    account_id: Optional[int],
    store_name: str,
    company_id: Optional[int],
    rows: List[FireflySyncedSplit],
    norm_desc: str,
    status: str,
    scoped_hints: dict[tuple[str, str], tuple[int, str]],
    fallback_hints: dict[str, tuple[int, str]],
    product_name_by_id: dict[int, str],
    price_by_jid: dict[int, PriceRecord],
) -> BacklogStoreBucket:
    rows_sorted = sorted(rows, key=lambda r: (r.tx_date, r.id or 0), reverse=True)
    sug_pid, sug_pname, sug_scope = (
        resolve_hint(
            norm_desc,
            account_id=account_id,
            company_id=company_id,
            scoped_hints=scoped_hints,
            fallback_hints=fallback_hints,
        )
        if status == "unassociated"
        else (None, None, None)
    )
    split_details: List[BacklogSplitDetail] = []
    for r in rows_sorted:
        pr = price_by_jid.get(r.transaction_journal_id)
        split_details.append(
            BacklogSplitDetail(
                transaction_journal_id=r.transaction_journal_id,
                firefly_transaction_id=r.firefly_transaction_id,
                tx_date=r.tx_date,
                amount=round(r.amount_cents / 100.0, 2),
                description=r.description,
                tags=parse_split_tags(r.tags_json),
                linked_product_id=r.linked_product_id,
                linked_product_name=(
                    product_name_by_id.get(r.linked_product_id)
                    if r.linked_product_id is not None
                    else None
                ),
                is_ignored=r.is_ignored,
                price_record=(
                    SplitPriceSummary(
                        id=pr.id,
                        quantity=pr.quantity,
                        unit=pr.unit,
                        package_size=pr.package_size,
                        regular_price=pr.regular_price,
                        paid_price=pr.paid_price,
                        is_discount=pr.is_discount,
                        normalized_unit_price=pr.normalized_unit_price,
                        normalized_regular_price=pr.normalized_regular_price,
                        verification_status=pr.verification_status,
                        notes=pr.notes,
                    )
                    if pr is not None and pr.id is not None
                    else None
                ),
            )
        )

    return BacklogStoreBucket(
        firefly_account_id=account_id,
        store_name=store_name,
        company_id=company_id,
        occurrence_count=len(rows_sorted),
        total_amount=round(sum(r.amount_cents for r in rows_sorted) / 100.0, 2),
        journal_ids=[r.transaction_journal_id for r in rows_sorted],
        suggested_product_id=sug_pid,
        suggested_product_name=sug_pname,
        suggested_scope=sug_scope,
        splits=split_details,
    )


def query_backlog_group_splits(
    session: Session,
    *,
    normalized_description: str,
    category_name: Optional[str],
    status: Literal["unassociated", "linked", "ignored"],
    linked_product_id: Optional[int],
    company_id: Optional[int],
    account_id: Optional[int],
) -> BacklogSplitsResponse:
    norm_desc = normalized_description.strip().lower()
    stmt = select(FireflySyncedSplit).where(
        FireflySyncedSplit.normalized_description == norm_desc
    )
    if status == "ignored":
        stmt = stmt.where(FireflySyncedSplit.is_ignored.is_(True))
    elif status == "linked":
        stmt = stmt.where(
            FireflySyncedSplit.is_ignored.is_(False),
            FireflySyncedSplit.linked_product_id.is_not(None),
        )
        if linked_product_id is not None:
            stmt = stmt.where(FireflySyncedSplit.linked_product_id == linked_product_id)
    else:
        stmt = stmt.where(
            FireflySyncedSplit.is_ignored.is_(False),
            FireflySyncedSplit.linked_product_id.is_(None),
        )

    if category_name in (None, "", "__uncategorized__"):
        stmt = stmt.where(FireflySyncedSplit.firefly_category_name.is_(None))
        effective_category = None
    else:
        stmt = stmt.where(FireflySyncedSplit.firefly_category_name == category_name)
        effective_category = category_name

    rows = session.exec(stmt).all()
    account_to_chain = load_account_chain_map(session)
    if company_id is not None:
        rows = [
            r
            for r in rows
            if r.firefly_expense_account_id is not None
            and account_to_chain.get(r.firefly_expense_account_id, (None, None))[0] == company_id
        ]
    if account_id is not None:
        rows = [r for r in rows if r.firefly_expense_account_id == account_id]

    scoped_hints, fallback_hints, product_name_by_id = build_alias_lookup(session)

    jids = [r.transaction_journal_id for r in rows]
    price_by_jid = {
        pr.transaction_journal_id: pr
        for pr in fetch_prices_by_journal_ids(session, jids)
        if pr.transaction_journal_id is not None
    }

    # Bucket rows by (company_id, firefly_account_id) so account renames do not split buckets
    by_chain_store: dict[Optional[int], dict[Optional[int], list[FireflySyncedSplit]]] = {}
    for r in rows:
        aid = r.firefly_expense_account_id
        cid = account_to_chain[aid][0] if aid is not None and aid in account_to_chain else None
        by_chain_store.setdefault(cid, {}).setdefault(aid, []).append(r)

    chains: List[BacklogChainBucket] = []
    unchained_stores: List[BacklogStoreBucket] = []

    for cid, store_map in by_chain_store.items():
        store_buckets: List[BacklogStoreBucket] = []
        for aid, st_rows in store_map.items():
            latest_row = max(st_rows, key=lambda r: (r.tx_date, r.id or 0))
            sname = (
                latest_row.firefly_expense_account_name
                or next(
                    (r.firefly_expense_account_name for r in st_rows if r.firefly_expense_account_name),
                    None,
                )
                or (f"Account #{aid}" if aid is not None else "Unknown Store")
            )
            store_buckets.append(
                _build_store_bucket(
                    account_id=aid,
                    store_name=sname,
                    company_id=cid,
                    rows=st_rows,
                    norm_desc=norm_desc,
                    status=status,
                    scoped_hints=scoped_hints,
                    fallback_hints=fallback_hints,
                    product_name_by_id=product_name_by_id,
                    price_by_jid=price_by_jid,
                )
            )
        store_buckets.sort(key=lambda sb: (-sb.occurrence_count, sb.store_name.lower()))

        if cid is None:
            unchained_stores.extend(store_buckets)
        else:
            cname = next(
                (
                    account_to_chain[sb.firefly_account_id][1]
                    for sb in store_buckets
                    if sb.firefly_account_id is not None
                    and sb.firefly_account_id in account_to_chain
                ),
                f"Chain #{cid}",
            )
            chain_jids = [jid for sb in store_buckets for jid in sb.journal_ids]
            chain_total = round(sum(sb.total_amount for sb in store_buckets), 2)
            chain_occ = sum(sb.occurrence_count for sb in store_buckets)
            sug_pid, sug_pname, sug_scope = (
                resolve_hint(
                    norm_desc,
                    account_id=None,
                    company_id=cid,
                    scoped_hints=scoped_hints,
                    fallback_hints=fallback_hints,
                )
                if status == "unassociated"
                else (None, None, None)
            )
            chains.append(
                BacklogChainBucket(
                    company_id=cid,
                    company_name=cname,
                    occurrence_count=chain_occ,
                    total_amount=chain_total,
                    journal_ids=chain_jids,
                    suggested_product_id=sug_pid,
                    suggested_product_name=sug_pname,
                    suggested_scope=sug_scope,
                    stores=store_buckets,
                )
            )

    chains.sort(key=lambda ch: (-ch.occurrence_count, ch.company_name.lower()))
    unchained_stores.sort(key=lambda sb: (-sb.occurrence_count, sb.store_name.lower()))

    return BacklogSplitsResponse(
        normalized_description=norm_desc,
        category_name=effective_category,
        status=status,
        occurrence_count=len(rows),
        total_amount=round(sum(r.amount_cents for r in rows) / 100.0, 2),
        chains=chains,
        unchained_stores=unchained_stores,
    )

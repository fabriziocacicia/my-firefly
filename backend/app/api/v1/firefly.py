from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import selectinload
from sqlmodel import Session, select
from app.core.database import get_session
from app.services.firefly import firefly_client
from app.services.classification import (
    ResolvedAccountClassification,
    resolve_account_classification,
)
from app.models.company import CompanyAccountLink
from app.models.account_metadata import AccountMetadata, AccountRole
from app.models.asset_account import AssetAccountMetadata, AssetAccountType
from app.services.vouchers import compute_voucher_balance_status, to_cents

router = APIRouter(prefix="/firefly", tags=["Firefly Sync"])


class FireflyExpenseAccountBrief(BaseModel):
    id: int
    name: str


class FireflyExpenseAccount(BaseModel):
    id: int
    name: str
    active: bool = True
    role: AccountRole = AccountRole.UNCLASSIFIED
    category: Optional[str] = None
    is_inherited_category: bool = False
    business_types: List[str] = []
    inherited_business_types: List[str] = []
    effective_business_types: List[str] = []
    company_id: Optional[int] = None
    company_name: Optional[str] = None


@router.get("/status")
async def get_firefly_status():
    try:
        about = await firefly_client.get_about()
        version = (
            about.get("data", {})
            .get("attributes", {})
            .get("version", "unknown")
        )
        return {
            "connected": True,
            "version": version,
            "url": firefly_client.base_url,
        }
    except Exception as e:
        return {"connected": False, "error": str(e), "url": firefly_client.base_url}


@router.get(
    "/expense-accounts/search",
    response_model=List[FireflyExpenseAccountBrief],
)
async def search_expense_accounts(
    query: str = Query("", description="Search query string"),
    limit: int = Query(20, ge=1, le=50),
):
    """Dedicated type-ahead search endpoint returning brief expense account objects."""
    clean_query = query.strip()
    if not clean_query:
        return []

    try:
        raw_results = await firefly_client.search_expense_accounts(
            query=clean_query, limit=limit
        )
        results: List[FireflyExpenseAccountBrief] = []
        for item in raw_results:
            try:
                attr = item.get("attributes", {})
                if not bool(attr.get("active", True)):
                    continue
                acc_id = int(item.get("id"))
                name = attr.get("name", f"Account #{acc_id}")
                results.append(FireflyExpenseAccountBrief(id=acc_id, name=name))
            except (ValueError, TypeError):
                continue
        results.sort(key=lambda x: x.name.lower())
        return results
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Firefly search error: {str(e)}")


def _build_expense_account(
    acc_id: int,
    attr: dict,
    resolved: ResolvedAccountClassification,
) -> FireflyExpenseAccount:
    return FireflyExpenseAccount(
        id=acc_id,
        name=attr.get("name", f"Account #{acc_id}"),
        active=bool(attr.get("active", True)),
        role=resolved.role,
        category=resolved.category,
        is_inherited_category=resolved.is_inherited_category,
        business_types=resolved.business_types,
        inherited_business_types=resolved.inherited_business_types,
        effective_business_types=resolved.effective_business_types,
        company_id=resolved.company_id,
        company_name=resolved.company_name,
    )


@router.get(
    "/expense-accounts",
    response_model=List[FireflyExpenseAccount],
)
async def list_expense_accounts(session: Session = Depends(get_session)):
    """Unpaginated directory listing of all Firefly expense accounts with metadata & company links."""
    try:
        accounts = await firefly_client.get_all_expense_accounts()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Firefly API error: {str(e)}")

    metas = session.exec(
        select(AccountMetadata).options(
            selectinload(AccountMetadata.company)
        )
    ).all()
    meta_map = {m.firefly_account_id: m for m in metas}

    links = session.exec(
        select(CompanyAccountLink).options(
            selectinload(CompanyAccountLink.company)
        )
    ).all()
    link_map = {link.firefly_account_id: link for link in links}

    results: List[FireflyExpenseAccount] = []
    for acc in accounts:
        try:
            acc_id = int(acc.get("id"))
            attr = acc.get("attributes", {})
            resolved = resolve_account_classification(
                meta_map.get(acc_id),
                link_map.get(acc_id),
            )
            results.append(_build_expense_account(acc_id, attr, resolved))
        except (ValueError, TypeError):
            continue
    return results


@router.get(
    "/expense-accounts/{account_id}",
    response_model=FireflyExpenseAccount,
)
async def get_expense_account(
    account_id: int, session: Session = Depends(get_session)
):
    """Fetch single expense account by ID with optional metadata & company link."""
    try:
        acc = await firefly_client.get_expense_account(account_id)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Firefly API error: {str(e)}")

    if not acc:
        raise HTTPException(
            status_code=404,
            detail=f"Firefly expense account #{account_id} not found",
        )

    attr = acc.get("attributes", {})
    meta = session.exec(
        select(AccountMetadata)
        .where(AccountMetadata.firefly_account_id == account_id)
        .options(selectinload(AccountMetadata.company))
    ).first()

    link = session.exec(
        select(CompanyAccountLink)
        .where(CompanyAccountLink.firefly_account_id == account_id)
        .options(selectinload(CompanyAccountLink.company))
    ).first()

    resolved = resolve_account_classification(meta, link)
    return _build_expense_account(account_id, attr, resolved)


class FireflyAssetAccount(BaseModel):
    id: int
    name: str
    current_balance: str
    active: bool = True
    currency_code: Optional[str] = None
    asset_type: AssetAccountType = AssetAccountType.STANDARD
    voucher_unit_value: Optional[float] = None
    default_revenue_account_id: Optional[int] = None
    default_revenue_account_name: Optional[str] = None
    default_recharge_description: Optional[str] = None
    notes: Optional[str] = None
    usable_vouchers: Optional[int] = None
    is_exact_multiple: bool = True
    balance_discrepancy: float = 0.0


class FireflyRevenueAccountBrief(BaseModel):
    id: int
    name: str


@router.get("/asset-accounts", response_model=List[FireflyAssetAccount])
async def list_asset_accounts(session: Session = Depends(get_session)):
    try:
        accounts = await firefly_client.get_all_asset_accounts()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Firefly API error: {str(e)}")

    metas = session.exec(select(AssetAccountMetadata)).all()
    meta_map = {m.firefly_account_id: m for m in metas}

    rev_name_map: dict[int, str] = {}
    if any(m.default_revenue_account_id for m in metas):
        try:
            rev_accounts = await firefly_client.get_all_revenue_accounts()
            for rev in rev_accounts:
                try:
                    rid = int(rev.get("id"))
                    rev_name_map[rid] = rev.get("attributes", {}).get(
                        "name", f"Revenue #{rid}"
                    )
                except (ValueError, TypeError):
                    continue
        except Exception:
            pass

    results: List[FireflyAssetAccount] = []
    for acc in accounts:
        try:
            acc_id = int(acc.get("id"))
        except (ValueError, TypeError):
            continue
        attr = acc.get("attributes", {})
        balance_str = str(attr.get("current_balance") or "0")
        meta = meta_map.get(acc_id)

        asset_type = meta.asset_type if meta else AssetAccountType.STANDARD
        unit_val = meta.voucher_unit_value if meta else None
        usable_vouchers: Optional[int] = None
        is_exact_multiple = True
        balance_discrepancy = 0.0

        if (
            asset_type == AssetAccountType.MEAL_VOUCHER
            and unit_val is not None
            and to_cents(unit_val) > 0
        ):
            status = compute_voucher_balance_status(balance_str, unit_val)
            usable_vouchers = status.usable_vouchers
            is_exact_multiple = status.is_exact_multiple
            balance_discrepancy = status.balance_discrepancy

        rev_id = meta.default_revenue_account_id if meta else None
        results.append(
            FireflyAssetAccount(
                id=acc_id,
                name=attr.get("name") or f"Asset #{acc_id}",
                current_balance=balance_str,
                active=bool(attr.get("active", True)),
                currency_code=attr.get("currency_code"),
                asset_type=asset_type,
                voucher_unit_value=unit_val,
                default_revenue_account_id=rev_id,
                default_revenue_account_name=rev_name_map.get(rev_id) if rev_id else None,
                default_recharge_description=(
                    meta.default_recharge_description if meta else None
                ),
                notes=meta.notes if meta else None,
                usable_vouchers=usable_vouchers,
                is_exact_multiple=is_exact_multiple,
                balance_discrepancy=balance_discrepancy,
            )
        )
    return results


@router.get("/revenue-accounts", response_model=List[FireflyRevenueAccountBrief])
async def list_revenue_accounts():
    try:
        accounts = await firefly_client.get_all_revenue_accounts()
        results: List[FireflyRevenueAccountBrief] = []
        for acc in accounts:
            try:
                attr = acc.get("attributes", {})
                if not bool(attr.get("active", True)):
                    continue
                acc_id = int(acc.get("id"))
                results.append(
                    FireflyRevenueAccountBrief(
                        id=acc_id,
                        name=attr.get("name") or f"Revenue #{acc_id}",
                    )
                )
            except (ValueError, TypeError):
                continue
        results.sort(key=lambda x: x.name.lower())
        return results
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Firefly API error: {str(e)}")

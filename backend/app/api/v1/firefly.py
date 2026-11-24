from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import selectinload
from sqlmodel import Session, select
from app.core.database import get_session
from app.services.firefly import firefly_client
from app.models.company import CompanyAccountLink
from app.models.account_metadata import AccountMetadata, AccountRole

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
            meta = meta_map.get(acc_id)
            link = link_map.get(acc_id)

            role = AccountRole.UNCLASSIFIED
            category = None
            is_inherited = False
            company_id = None
            company_name = None
            inherited_business_types: List[str] = []
            local_business_types: List[str] = meta.business_types or [] if meta else []
            effective_business_types: List[str] = []

            if meta:
                role = meta.role
                if meta.role == AccountRole.CHAIN and meta.company:
                    company_id = meta.company_id
                    company_name = meta.company.name
                    category = None  # Chains use business_types, not category tags
                    is_inherited = False
                    inherited_business_types = meta.company.business_types or []
                    if not inherited_business_types and meta.company.default_category:
                        inherited_business_types = [meta.company.default_category]
                    inherited_lower = {t.strip().lower() for t in inherited_business_types}
                    local_business_types = [
                        t.strip()
                        for t in local_business_types
                        if t.strip() and t.strip().lower() not in inherited_lower
                    ]
                    effective_business_types = inherited_business_types + local_business_types
                elif meta.role in (
                    AccountRole.LOCAL_BUSINESS,
                    AccountRole.PHYSICAL_STORE,
                    AccountRole.INDEPENDENT,
                ):
                    category = meta.category
                    is_inherited = False
                    effective_business_types = local_business_types
                elif meta.role in (AccountRole.ECOMMERCE, AccountRole.SERVICE):
                    category = meta.category
                    is_inherited = False
                    local_business_types = []
                    effective_business_types = []
                else:
                    category = None
                    is_inherited = False
                    local_business_types = []
                    effective_business_types = []
            elif link:
                role = AccountRole.CHAIN
                company_id = link.company_id
                company_name = link.company.name if link.company else None
                category = None
                is_inherited = False
                if link.company:
                    inherited_business_types = link.company.business_types or []
                    if not inherited_business_types and link.company.default_category:
                        inherited_business_types = [link.company.default_category]
                effective_business_types = inherited_business_types

            results.append(
                FireflyExpenseAccount(
                    id=acc_id,
                    name=attr.get("name", f"Account #{acc_id}"),
                    active=bool(attr.get("active", True)),
                    role=role,
                    category=category,
                    is_inherited_category=is_inherited,
                    business_types=local_business_types,
                    inherited_business_types=inherited_business_types,
                    effective_business_types=effective_business_types,
                    company_id=company_id,
                    company_name=company_name,
                )
            )
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

    role = AccountRole.UNCLASSIFIED
    category = None
    is_inherited = False
    company_id = None
    company_name = None
    inherited_business_types: List[str] = []
    local_business_types: List[str] = meta.business_types or [] if meta else []
    effective_business_types: List[str] = []

    if meta:
        role = meta.role
        if meta.role == AccountRole.CHAIN and meta.company:
            company_id = meta.company_id
            company_name = meta.company.name
            category = None
            is_inherited = False
            inherited_business_types = meta.company.business_types or []
            if not inherited_business_types and meta.company.default_category:
                inherited_business_types = [meta.company.default_category]
            inherited_lower = {t.strip().lower() for t in inherited_business_types}
            local_business_types = [
                t.strip()
                for t in local_business_types
                if t.strip() and t.strip().lower() not in inherited_lower
            ]
            effective_business_types = inherited_business_types + local_business_types
        elif meta.role in (
            AccountRole.LOCAL_BUSINESS,
            AccountRole.PHYSICAL_STORE,
            AccountRole.INDEPENDENT,
        ):
            category = meta.category
            is_inherited = False
            effective_business_types = local_business_types
        elif meta.role in (AccountRole.ECOMMERCE, AccountRole.SERVICE):
            category = meta.category
            is_inherited = False
            local_business_types = []
            effective_business_types = []
        else:
            category = None
            is_inherited = False
            local_business_types = []
            effective_business_types = []
    elif link:
        role = AccountRole.CHAIN
        company_id = link.company_id
        company_name = link.company.name if link.company else None
        category = None
        is_inherited = False
        if link.company:
            inherited_business_types = link.company.business_types or []
            if not inherited_business_types and link.company.default_category:
                inherited_business_types = [link.company.default_category]
        effective_business_types = inherited_business_types

    return FireflyExpenseAccount(
        id=account_id,
        name=attr.get("name", f"Account #{account_id}"),
        active=bool(attr.get("active", True)),
        role=role,
        category=category,
        is_inherited_category=is_inherited,
        business_types=local_business_types,
        inherited_business_types=inherited_business_types,
        effective_business_types=effective_business_types,
        company_id=company_id,
        company_name=company_name,
    )


@router.get("/asset-accounts")
async def list_asset_accounts():
    try:
        accounts = await firefly_client.get_all_asset_accounts()
        results = []
        for acc in accounts:
            acc_id = int(acc.get("id"))
            attr = acc.get("attributes", {})
            results.append({
                "id": acc_id,
                "name": attr.get("name"),
                "current_balance": attr.get("current_balance"),
            })
        return results
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Firefly API error: {str(e)}")

from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import selectinload
from sqlmodel import Session, select
from app.core.database import get_session
from app.services.firefly import firefly_client
from app.models.company import CompanyAccountLink

router = APIRouter(prefix="/firefly", tags=["Firefly Sync"])


class FireflyExpenseAccountBrief(BaseModel):
    id: int
    name: str


class FireflyExpenseAccount(BaseModel):
    id: int
    name: str
    active: bool = True
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
    query: str = Query(..., min_length=1, description="Search query string"),
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
                acc_id = int(item.get("id"))
                name = item.get("attributes", {}).get("name", f"Account #{acc_id}")
                results.append(FireflyExpenseAccountBrief(id=acc_id, name=name))
            except (ValueError, TypeError):
                continue
        return results
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Firefly search error: {str(e)}")


@router.get(
    "/expense-accounts",
    response_model=List[FireflyExpenseAccount],
)
async def list_expense_accounts(session: Session = Depends(get_session)):
    """Unpaginated directory listing of all Firefly expense accounts with company links."""
    try:
        accounts = await firefly_client.get_all_expense_accounts()

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
                link = link_map.get(acc_id)
                results.append(
                    FireflyExpenseAccount(
                        id=acc_id,
                        name=attr.get("name", f"Account #{acc_id}"),
                        active=bool(attr.get("active", True)),
                        company_id=link.company_id if link else None,
                        company_name=link.company.name if (link and link.company) else None,
                    )
                )
            except (ValueError, TypeError):
                continue
        return results
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Firefly API error: {str(e)}")


@router.get(
    "/expense-accounts/{account_id}",
    response_model=FireflyExpenseAccount,
)
async def get_expense_account(
    account_id: int, session: Session = Depends(get_session)
):
    """Fetch single expense account by ID with optional company link."""
    try:
        acc = await firefly_client.get_expense_account(account_id)
        if not acc:
            raise HTTPException(
                status_code=404,
                detail=f"Firefly expense account #{account_id} not found",
            )

        attr = acc.get("attributes", {})
        link = session.exec(
            select(CompanyAccountLink)
            .where(CompanyAccountLink.firefly_account_id == account_id)
            .options(selectinload(CompanyAccountLink.company))
        ).first()

        return FireflyExpenseAccount(
            id=account_id,
            name=attr.get("name", f"Account #{account_id}"),
            active=bool(attr.get("active", True)),
            company_id=link.company_id if link else None,
            company_name=link.company.name if (link and link.company) else None,
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Firefly API error: {str(e)}")


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

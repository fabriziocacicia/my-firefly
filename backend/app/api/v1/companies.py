from datetime import datetime, timezone
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Response, status
import httpx
from sqlalchemy import func
from sqlmodel import Session, select
from app.core.database import get_session
from app.models.company import (
    Company,
    CompanyCreate,
    CompanyRead,
    CompanyUpdate,
    CompanyWithCountRead,
    CompanyAccountLink,
    CompanyAccountLinkRead,
    AccountCompanyAssign,
)
from app.models.account_metadata import AccountMetadata, AccountRole
from app.services.firefly import firefly_client

router = APIRouter(prefix="/companies", tags=["Companies"])


@router.get("/", response_model=List[CompanyWithCountRead])
def get_companies(session: Session = Depends(get_session)):
    """List all companies with active linked account counts."""
    subq_meta = (
        select(AccountMetadata.firefly_account_id, AccountMetadata.company_id)
        .where(AccountMetadata.role == AccountRole.CHAIN)
    )
    subq_link = (
        select(CompanyAccountLink.firefly_account_id, CompanyAccountLink.company_id)
    )
    combined = subq_meta.union(subq_link).subquery()

    statement = (
        select(
            Company,
            func.count(combined.c.firefly_account_id).label("store_count"),
        )
        .outerjoin(combined, combined.c.company_id == Company.id)
        .group_by(Company.id)
        .order_by(Company.name)
    )
    rows = session.exec(statement).all()
    return [
        CompanyWithCountRead(
            id=company.id,
            name=company.name,
            default_category=company.default_category,
            business_types=company.business_types if company.business_types else ([company.default_category] if company.default_category else []),
            notes=company.notes,
            created_at=company.created_at,
            store_count=count,
        )
        for company, count in rows
    ]


@router.post("/", response_model=CompanyRead, status_code=status.HTTP_201_CREATED)
def create_company(
    company_in: CompanyCreate, session: Session = Depends(get_session)
):
    """Create a new company with trimmed case-insensitive uniqueness check."""
    clean_name = company_in.name.strip()
    if not clean_name:
        raise HTTPException(status_code=400, detail="Company name cannot be blank")

    existing = session.exec(
        select(Company).where(
            func.lower(func.trim(Company.name)) == clean_name.lower()
        )
    ).first()
    if existing:
        raise HTTPException(
            status_code=400, detail=f"Company '{clean_name}' already exists"
        )

    company = Company(
        name=clean_name,
        default_category=(
            company_in.default_category.strip()
            if company_in.default_category
            else None
        ),
        business_types=company_in.business_types or [],
        notes=company_in.notes.strip() if company_in.notes else None,
    )
    session.add(company)
    session.commit()
    session.refresh(company)
    return company


@router.patch("/{company_id}", response_model=CompanyRead)
def update_company(
    company_id: int,
    company_update: CompanyUpdate,
    session: Session = Depends(get_session),
):
    """Update company details with trimmed case-insensitive uniqueness check."""
    company = session.get(Company, company_id)
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")

    if company_update.name is not None:
        clean_name = company_update.name.strip()
        if not clean_name:
            raise HTTPException(
                status_code=400, detail="Company name cannot be blank"
            )

        existing = session.exec(
            select(Company).where(
                func.lower(func.trim(Company.name)) == clean_name.lower(),
                Company.id != company_id,
            )
        ).first()
        if existing:
            raise HTTPException(
                status_code=400,
                detail=f"Company '{clean_name}' already exists",
            )
        company.name = clean_name

    if company_update.default_category is not None:
        company.default_category = (
            company_update.default_category.strip()
            if company_update.default_category
            else None
        )

    if company_update.business_types is not None:
        company.business_types = company_update.business_types

    if company_update.notes is not None:
        company.notes = (
            company_update.notes.strip() if company_update.notes else None
        )

    session.add(company)
    session.commit()
    session.refresh(company)
    return company


@router.delete("/{company_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_company(company_id: int, session: Session = Depends(get_session)):
    """Delete company and its associated account links in the same transaction."""
    company = session.get(Company, company_id)
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")

    # Explicitly remove linked account associations
    links = session.exec(
        select(CompanyAccountLink).where(
            CompanyAccountLink.company_id == company_id
        )
    ).all()
    for link in links:
        session.delete(link)

    metas = session.exec(
        select(AccountMetadata).where(AccountMetadata.company_id == company_id)
    ).all()
    now = datetime.now(timezone.utc)
    for m in metas:
        m.role = AccountRole.UNCLASSIFIED
        m.company_id = None
        m.updated_at = now
        session.add(m)

    session.delete(company)
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put(
    "/accounts/{firefly_account_id}/company",
    response_model=Optional[CompanyAccountLinkRead],
)
@router.put(
    "/accounts/{firefly_account_id}",
    response_model=Optional[CompanyAccountLinkRead],
    include_in_schema=False,
)
async def assign_or_clear_account_company(
    firefly_account_id: int,
    assign_in: AccountCompanyAssign,
    session: Session = Depends(get_session),
):
    """
    Assign an expense account to a company (by company_id or company_name)
    or unlink the account if both are None.
    Validates account existence and active status in Firefly III.
    """
    # 1. Validate mutual exclusion and non-empty name
    if assign_in.company_id is not None and assign_in.company_name is not None:
        raise HTTPException(
            status_code=422,
            detail="Cannot specify both company_id and company_name",
        )
    if assign_in.company_name is not None and not assign_in.company_name.strip():
        raise HTTPException(
            status_code=422,
            detail="company_name cannot be whitespace only",
        )

    # 2. Check if this is an unlink request before making Firefly network calls
    clean_company_name = (
        assign_in.company_name.strip() if assign_in.company_name else None
    )
    if assign_in.company_id is None and not clean_company_name:
        existing_link = session.get(CompanyAccountLink, firefly_account_id)
        if existing_link:
            session.delete(existing_link)
        meta = session.get(AccountMetadata, firefly_account_id)
        if meta and meta.role == AccountRole.CHAIN:
            meta.role = AccountRole.UNCLASSIFIED
            meta.company_id = None
            meta.updated_at = datetime.now(timezone.utc)
            session.add(meta)
        session.commit()
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    # 3. Verify account exists & is active in Firefly III
    try:
        acc = await firefly_client.get_expense_account(firefly_account_id)
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Unable to reach Firefly III to validate expense account: {exc}",
        ) from exc

    if not acc:
        raise HTTPException(
            status_code=404,
            detail=f"Firefly expense account #{firefly_account_id} not found in Firefly III",
        )
    if not acc.get("attributes", {}).get("active", True):
        raise HTTPException(
            status_code=400,
            detail=f"Firefly expense account #{firefly_account_id} is inactive",
        )

    # 4. Resolve target Company
    company: Optional[Company] = None
    if assign_in.company_id is not None:
        company = session.get(Company, assign_in.company_id)
        if not company:
            raise HTTPException(
                status_code=404,
                detail=f"Company #{assign_in.company_id} not found",
            )
    elif clean_company_name:
        company = session.exec(
            select(Company).where(
                func.lower(func.trim(Company.name))
                == clean_company_name.lower()
            )
        ).first()
        if not company:
            company = Company(name=clean_company_name)
            session.add(company)
            session.commit()
            session.refresh(company)

    if not company or not company.id:
        raise HTTPException(
            status_code=400,
            detail="Unable to resolve company for assignment",
        )

    # 5. Upsert CompanyAccountLink and sync AccountMetadata
    link = session.get(CompanyAccountLink, firefly_account_id)
    if link:
        link.company_id = company.id
    else:
        link = CompanyAccountLink(
            firefly_account_id=firefly_account_id, company_id=company.id
        )
    session.add(link)

    meta = session.get(AccountMetadata, firefly_account_id)
    now = datetime.now(timezone.utc)
    if meta:
        meta.role = AccountRole.CHAIN
        meta.company_id = company.id
        meta.category = None
        meta.updated_at = now
        session.add(meta)
    else:
        meta = AccountMetadata(
            firefly_account_id=firefly_account_id,
            role=AccountRole.CHAIN,
            company_id=company.id,
            created_at=now,
            updated_at=now,
        )
        session.add(meta)

    session.commit()
    session.refresh(link)

    return CompanyAccountLinkRead(
        firefly_account_id=link.firefly_account_id,
        company_id=link.company_id,
        created_at=link.created_at,
    )

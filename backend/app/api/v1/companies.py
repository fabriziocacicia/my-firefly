from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Response, status
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
from app.services.firefly import firefly_client

router = APIRouter(prefix="/companies", tags=["Companies"])


@router.get("/", response_model=List[CompanyWithCountRead])
def get_companies(session: Session = Depends(get_session)):
    """List all companies with active linked account counts."""
    statement = (
        select(
            Company,
            func.count(CompanyAccountLink.firefly_account_id).label("store_count"),
        )
        .outerjoin(CompanyAccountLink, CompanyAccountLink.company_id == Company.id)
        .group_by(Company.id)
        .order_by(Company.name)
    )
    rows = session.exec(statement).all()
    return [
        CompanyWithCountRead(
            id=company.id,
            name=company.name,
            default_category=company.default_category,
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

    session.delete(company)
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put(
    "/accounts/{firefly_account_id}/company",
    response_model=Optional[CompanyAccountLinkRead],
)
async def assign_or_clear_account_company(
    firefly_account_id: int,
    assign_in: AccountCompanyAssign,
    session: Session = Depends(get_session),
):
    """
    Assign an expense account to a company (by company_id or company_name)
    or unlink the account if both are None.
    Validates account existence in Firefly III.
    """
    # 1. Verify account exists in Firefly III
    acc = await firefly_client.get_expense_account(firefly_account_id)
    if not acc:
        raise HTTPException(
            status_code=404,
            detail=f"Firefly expense account #{firefly_account_id} not found in Firefly III",
        )

    # 2. Check if this is an unlink request
    clean_company_name = (
        assign_in.company_name.strip() if assign_in.company_name else None
    )
    if assign_in.company_id is None and not clean_company_name:
        existing_link = session.get(CompanyAccountLink, firefly_account_id)
        if existing_link:
            session.delete(existing_link)
            session.commit()
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    # 3. Resolve target Company
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

    # 4. Upsert CompanyAccountLink
    link = session.get(CompanyAccountLink, firefly_account_id)
    if link:
        link.company_id = company.id
    else:
        link = CompanyAccountLink(
            firefly_account_id=firefly_account_id, company_id=company.id
        )
    session.add(link)
    session.commit()
    session.refresh(link)

    return CompanyAccountLinkRead(
        firefly_account_id=link.firefly_account_id,
        company_id=link.company_id,
        created_at=link.created_at,
    )

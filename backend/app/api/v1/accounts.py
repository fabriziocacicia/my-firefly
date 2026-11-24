from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session

from app.core.database import get_session
from app.models.account_metadata import (
    AccountRole,
    AccountMetadata,
    AccountMetadataUpdate,
)
from app.models.company import Company

router = APIRouter(prefix="/accounts", tags=["Account Metadata"])


class AccountMetadataResponse(BaseModel):
    firefly_account_id: int
    role: AccountRole
    category: Optional[str] = None
    is_inherited_category: bool = False
    company_id: Optional[int] = None
    company_name: Optional[str] = None
    notes: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


@router.get("/{account_id}/metadata", response_model=AccountMetadataResponse)
def get_account_metadata(
    account_id: int,
    session: Session = Depends(get_session),
):
    """Fetch metadata for a single Firefly account, falling back to unclassified."""
    meta = session.get(AccountMetadata, account_id)
    if not meta:
        return AccountMetadataResponse(
            firefly_account_id=account_id,
            role=AccountRole.UNCLASSIFIED,
            category=None,
            is_inherited_category=False,
            company_id=None,
            company_name=None,
        )

    company = session.get(Company, meta.company_id) if meta.company_id else None
    effective_category = (
        company.default_category
        if (meta.role == AccountRole.CHAIN and company)
        else meta.category
    )
    is_inherited = bool(
        meta.role == AccountRole.CHAIN and company and company.default_category
    )

    return AccountMetadataResponse(
        firefly_account_id=meta.firefly_account_id,
        role=meta.role,
        category=effective_category,
        is_inherited_category=is_inherited,
        company_id=meta.company_id if meta.role == AccountRole.CHAIN else None,
        company_name=company.name if (meta.role == AccountRole.CHAIN and company) else None,
        notes=meta.notes,
        created_at=meta.created_at,
        updated_at=meta.updated_at,
    )


@router.put("/{account_id}/metadata", response_model=AccountMetadataResponse)
def update_account_metadata(
    account_id: int,
    payload: AccountMetadataUpdate,
    session: Session = Depends(get_session),
):
    """
    Update or create local metadata for an account.
    Validation rules:
    - CHAIN: requires company_id to exist; direct category is cleared (inherited from company).
    - INDEPENDENT: company_id is cleared; category is an optional trimmed string.
    - PERSON: category and company_id are cleared.
    - UNCLASSIFIED: category and company_id are cleared.
    """
    role = payload.role
    company_id: Optional[int] = None
    category: Optional[str] = None
    company: Optional[Company] = None

    if role == AccountRole.CHAIN:
        if not payload.company_id:
            raise HTTPException(
                status_code=400,
                detail="A parent company_id is required when role is 'chain'",
            )
        company = session.get(Company, payload.company_id)
        if not company:
            raise HTTPException(
                status_code=404,
                detail=f"Company #{payload.company_id} not found",
            )
        company_id = company.id
        category = None  # inherited from company
    elif role in (
        AccountRole.PHYSICAL_STORE,
        AccountRole.ECOMMERCE,
        AccountRole.SERVICE,
        AccountRole.INDEPENDENT,
    ):
        category = (
            payload.category.strip()
            if payload.category and payload.category.strip()
            else None
        )
        company_id = None
    elif role in (AccountRole.PERSON, AccountRole.UNCLASSIFIED):
        category = None
        company_id = None

    meta = session.get(AccountMetadata, account_id)
    now = datetime.now(timezone.utc)
    if not meta:
        meta = AccountMetadata(
            firefly_account_id=account_id,
            role=role,
            category=category,
            company_id=company_id,
            notes=payload.notes.strip() if payload.notes else None,
            created_at=now,
            updated_at=now,
        )
        session.add(meta)
    else:
        meta.role = role
        meta.category = category
        meta.company_id = company_id
        if payload.notes is not None:
            meta.notes = payload.notes.strip() if payload.notes else None
        meta.updated_at = now
        session.add(meta)

    session.commit()
    session.refresh(meta)

    effective_category = (
        company.default_category
        if (role == AccountRole.CHAIN and company)
        else meta.category
    )
    is_inherited = bool(
        role == AccountRole.CHAIN and company and company.default_category
    )

    return AccountMetadataResponse(
        firefly_account_id=meta.firefly_account_id,
        role=meta.role,
        category=effective_category,
        is_inherited_category=is_inherited,
        company_id=meta.company_id if meta.role == AccountRole.CHAIN else None,
        company_name=company.name if (meta.role == AccountRole.CHAIN and company) else None,
        notes=meta.notes,
        created_at=meta.created_at,
        updated_at=meta.updated_at,
    )

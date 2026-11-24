from datetime import datetime, timezone
from typing import Optional, List
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
from app.services.classification import (
    LOCAL_BUSINESS_ROLES,
    ResolvedAccountClassification,
    get_company_business_types,
    normalize_business_types,
    resolve_account_classification,
)

router = APIRouter(prefix="/accounts", tags=["Account Metadata"])


class AccountMetadataResponse(BaseModel):
    firefly_account_id: int
    role: AccountRole
    category: Optional[str] = None
    is_inherited_category: bool = False
    business_types: List[str] = []
    inherited_business_types: List[str] = []
    effective_business_types: List[str] = []
    company_id: Optional[int] = None
    company_name: Optional[str] = None
    notes: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


def _build_metadata_response(
    account_id: int,
    meta: Optional[AccountMetadata],
    resolved: ResolvedAccountClassification,
) -> AccountMetadataResponse:
    return AccountMetadataResponse(
        firefly_account_id=meta.firefly_account_id if meta else account_id,
        role=resolved.role,
        category=resolved.category,
        is_inherited_category=resolved.is_inherited_category,
        business_types=resolved.business_types,
        inherited_business_types=resolved.inherited_business_types,
        effective_business_types=resolved.effective_business_types,
        company_id=resolved.company_id,
        company_name=resolved.company_name,
        notes=meta.notes if meta else None,
        created_at=meta.created_at if meta else None,
        updated_at=meta.updated_at if meta else None,
    )


@router.get("/{account_id}/metadata", response_model=AccountMetadataResponse)
def get_account_metadata(
    account_id: int,
    session: Session = Depends(get_session),
):
    """Fetch metadata for a single Firefly account, falling back to unclassified."""
    meta = session.get(AccountMetadata, account_id)
    company = session.get(Company, meta.company_id) if (meta and meta.company_id) else None
    resolved = resolve_account_classification(meta, company_override=company)
    return _build_metadata_response(account_id, meta, resolved)


@router.put("/{account_id}/metadata", response_model=AccountMetadataResponse)
def update_account_metadata(
    account_id: int,
    payload: AccountMetadataUpdate,
    session: Session = Depends(get_session),
):
    """
    Update or create local metadata for an account.
    Validation rules:
    - CHAIN: requires company_id to exist; category is cleared; business_types allow branch-specific additions.
    - LOCAL_BUSINESS / PHYSICAL_STORE / INDEPENDENT: company_id is cleared; category and business_types are supported.
    - ECOMMERCE / SERVICE: category is supported; business_types are cleared.
    - PERSON / UNCLASSIFIED: category, business_types, and company_id are cleared.
    """
    role = payload.role
    company_id: Optional[int] = None
    category: Optional[str] = None
    business_types: List[str] = []
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
        category = None
        inherited = get_company_business_types(company)
        business_types = normalize_business_types(payload.business_types, exclude=inherited)
    elif role in LOCAL_BUSINESS_ROLES:
        category = (
            payload.category.strip()
            if payload.category and payload.category.strip()
            else None
        )
        business_types = normalize_business_types(payload.business_types)
        company_id = None
    elif role in (AccountRole.ECOMMERCE, AccountRole.SERVICE):
        category = (
            payload.category.strip()
            if payload.category and payload.category.strip()
            else None
        )
        business_types = []
        company_id = None
    elif role in (AccountRole.PERSON, AccountRole.UNCLASSIFIED):
        category = None
        business_types = []
        company_id = None

    meta = session.get(AccountMetadata, account_id)
    now = datetime.now(timezone.utc)
    if not meta:
        meta = AccountMetadata(
            firefly_account_id=account_id,
            role=role,
            category=category,
            business_types=business_types,
            company_id=company_id,
            notes=payload.notes.strip() if payload.notes else None,
            created_at=now,
            updated_at=now,
        )
        session.add(meta)
    else:
        meta.role = role
        meta.category = category
        meta.business_types = business_types
        meta.company_id = company_id
        if payload.notes is not None:
            meta.notes = payload.notes.strip() if payload.notes else None
        meta.updated_at = now
        session.add(meta)

    session.commit()
    session.refresh(meta)

    resolved = resolve_account_classification(meta, company_override=company)
    return _build_metadata_response(account_id, meta, resolved)

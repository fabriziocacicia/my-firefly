from typing import List
from fastapi import APIRouter, Depends
from sqlmodel import Session, select
from app.core.database import get_session
from app.models.company import Company
from app.models.account_metadata import AccountMetadata

router = APIRouter(prefix="/categories", tags=["Categories"])


@router.get("", response_model=List[str])
@router.get("/", response_model=List[str], include_in_schema=False)
def list_categories(session: Session = Depends(get_session)) -> List[str]:
    """Returns sorted, distinct, non-empty category names from companies and accounts."""
    company_cats = session.exec(
        select(Company.default_category).where(Company.default_category.is_not(None))
    ).all()
    account_cats = session.exec(
        select(AccountMetadata.category).where(AccountMetadata.category.is_not(None))
    ).all()

    seen = set()
    categories = []
    for cat in list(company_cats) + list(account_cats):
        if cat and cat.strip():
            clean = cat.strip()
            lower = clean.lower()
            if lower not in seen:
                seen.add(lower)
                categories.append(clean)

    categories.sort(key=lambda s: s.lower())
    return categories

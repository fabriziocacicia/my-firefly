from dataclasses import dataclass
from typing import Iterable, List, Optional

from app.models.account_metadata import AccountMetadata, AccountRole
from app.models.company import Company, CompanyAccountLink

LOCAL_BUSINESS_ROLES = (
    AccountRole.LOCAL_BUSINESS,
    AccountRole.PHYSICAL_STORE,
    AccountRole.INDEPENDENT,
)


@dataclass(frozen=True)
class ResolvedAccountClassification:
    """Canonical classification state resolved from AccountMetadata, CompanyAccountLink, and Company."""

    role: AccountRole
    category: Optional[str]
    is_inherited_category: bool
    business_types: List[str]
    inherited_business_types: List[str]
    effective_business_types: List[str]
    company_id: Optional[int]
    company_name: Optional[str]


def normalize_business_types(
    types: Optional[Iterable[str]],
    exclude: Optional[Iterable[str]] = None,
) -> List[str]:
    """Trim, drop blanks, and deduplicate business types case-insensitively."""
    excluded_lower = {
        item.strip().lower()
        for item in (exclude or ())
        if item and item.strip()
    }
    seen_lower = set()
    normalized: List[str] = []
    for raw in types or ():
        if not raw:
            continue
        clean = raw.strip()
        if not clean:
            continue
        lower = clean.lower()
        if lower in excluded_lower or lower in seen_lower:
            continue
        seen_lower.add(lower)
        normalized.append(clean)
    return normalized


def get_company_business_types(company: Optional[Company]) -> List[str]:
    """Return normalized business types for a parent retail chain, falling back to legacy default_category."""
    if not company:
        return []
    raw = company.business_types or (
        [company.default_category] if company.default_category else []
    )
    return normalize_business_types(raw)


def resolve_account_classification(
    meta: Optional[AccountMetadata],
    link: Optional[CompanyAccountLink] = None,
    company_override: Optional[Company] = None,
) -> ResolvedAccountClassification:
    """Resolve effective role, category, company link, and deduplicated business types for an expense account."""
    if meta:
        role = meta.role
        company = company_override or meta.company

        if role == AccountRole.CHAIN and company:
            inherited = get_company_business_types(company)
            local = normalize_business_types(meta.business_types, exclude=inherited)
            return ResolvedAccountClassification(
                role=role,
                category=None,  # Chains use business_types, not category tags
                is_inherited_category=False,
                business_types=local,
                inherited_business_types=inherited,
                effective_business_types=inherited + local,
                company_id=company.id,
                company_name=company.name,
            )

        if role in LOCAL_BUSINESS_ROLES:
            local = normalize_business_types(meta.business_types)
            return ResolvedAccountClassification(
                role=role,
                category=meta.category,
                is_inherited_category=False,
                business_types=local,
                inherited_business_types=[],
                effective_business_types=local,
                company_id=None,
                company_name=None,
            )

        if role in (AccountRole.ECOMMERCE, AccountRole.SERVICE):
            return ResolvedAccountClassification(
                role=role,
                category=meta.category,
                is_inherited_category=False,
                business_types=[],
                inherited_business_types=[],
                effective_business_types=[],
                company_id=None,
                company_name=None,
            )

        return ResolvedAccountClassification(
            role=role,
            category=None,
            is_inherited_category=False,
            business_types=[],
            inherited_business_types=[],
            effective_business_types=[],
            company_id=None,
            company_name=None,
        )

    if link:
        company = company_override or link.company
        inherited = get_company_business_types(company)
        return ResolvedAccountClassification(
            role=AccountRole.CHAIN,
            category=None,
            is_inherited_category=False,
            business_types=[],
            inherited_business_types=inherited,
            effective_business_types=inherited,
            company_id=link.company_id,
            company_name=company.name if company else None,
        )

    return ResolvedAccountClassification(
        role=AccountRole.UNCLASSIFIED,
        category=None,
        is_inherited_category=False,
        business_types=[],
        inherited_business_types=[],
        effective_business_types=[],
        company_id=None,
        company_name=None,
    )

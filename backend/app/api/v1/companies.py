from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select
from app.core.database import get_session
from app.models.company import (
    Company, CompanyCreate, CompanyRead,
    Store, StoreCreate, StoreRead
)

router = APIRouter(prefix="/companies", tags=["Companies & Stores"])

@router.get("/", response_model=list[CompanyRead])
def get_companies(session: Session = Depends(get_session)):
    companies = session.exec(select(Company)).all()
    return companies

@router.post("/", response_model=CompanyRead)
def create_company(company_in: CompanyCreate, session: Session = Depends(get_session)):
    existing = session.exec(select(Company).where(Company.name == company_in.name)).first()
    if existing:
        raise HTTPException(status_code=400, detail="Company already exists")
    company = Company.from_orm(company_in)
    session.add(company)
    session.commit()
    session.refresh(company)
    return company

@router.get("/stores", response_model=list[StoreRead])
def get_stores(company_id: int | None = None, session: Session = Depends(get_session)):
    query = select(Store)
    if company_id:
        query = query.where(Store.company_id == company_id)
    stores = session.exec(query).all()
    return stores

@router.post("/stores", response_model=StoreRead)
def create_store(store_in: StoreCreate, session: Session = Depends(get_session)):
    company = session.get(Company, store_in.company_id)
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")
    store = Store.from_orm(store_in)
    session.add(store)
    session.commit()
    session.refresh(store)
    return store

@router.post("/quick-map")
def quick_map_firefly_account(
    company_name: str,
    store_name: str,
    firefly_account_id: int,
    firefly_account_name: str,
    session: Session = Depends(get_session)
):
    """1-click helper: find or create Company, then map Store to Firefly Account."""
    company = session.exec(select(Company).where(Company.name == company_name)).first()
    if not company:
        company = Company(name=company_name)
        session.add(company)
        session.commit()
        session.refresh(company)

    existing_store = session.exec(select(Store).where(Store.firefly_account_id == firefly_account_id)).first()
    if existing_store:
        existing_store.name = store_name
        existing_store.company_id = company.id
        existing_store.firefly_account_name = firefly_account_name
        session.add(existing_store)
        session.commit()
        session.refresh(existing_store)
        return existing_store

    store = Store(
        name=store_name,
        company_id=company.id,
        firefly_account_id=firefly_account_id,
        firefly_account_name=firefly_account_name
    )
    session.add(store)
    session.commit()
    session.refresh(store)
    return store

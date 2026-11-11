from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select
from app.core.database import get_session
from app.models.brand import Brand, BrandCreate, BrandRead
from app.models.product import Product, ProductCreate, ProductRead, ProductTagLink
from app.models.tag import Tag

router = APIRouter(prefix="/products", tags=["Products & Brands"])

# Brands
@router.get("/brands", response_model=list[BrandRead])
def list_brands(session: Session = Depends(get_session)):
    return session.exec(select(Brand)).all()

@router.post("/brands", response_model=BrandRead)
def create_brand(brand_in: BrandCreate, session: Session = Depends(get_session)):
    existing = session.exec(select(Brand).where(Brand.name == brand_in.name)).first()
    if existing:
        return existing
    brand = Brand.from_orm(brand_in)
    session.add(brand)
    session.commit()
    session.refresh(brand)
    return brand

# Products
@router.get("/", response_model=list[ProductRead])
def list_products(
    search: str | None = None,
    brand_id: int | None = None,
    tag_id: int | None = None,
    session: Session = Depends(get_session)
):
    query = select(Product)
    if search:
        query = query.where(Product.name.ilike(f"%{search}%"))
    if brand_id:
        query = query.where(Product.brand_id == brand_id)
    if tag_id:
        query = query.join(ProductTagLink).where(ProductTagLink.tag_id == tag_id)
    
    products = session.exec(query).all()
    return products

@router.post("/", response_model=ProductRead)
def create_product(product_in: ProductCreate, session: Session = Depends(get_session)):
    product = Product(
        name=product_in.name,
        brand_id=product_in.brand_id,
        barcode=product_in.barcode,
        default_unit=product_in.default_unit,
        package_size=product_in.package_size,
        notes=product_in.notes
    )
    session.add(product)
    session.commit()
    session.refresh(product)

    # Link tags
    for tag_id in product_in.tag_ids:
        tag = session.get(Tag, tag_id)
        if tag:
            link = ProductTagLink(product_id=product.id, tag_id=tag.id)
            session.add(link)
    session.commit()
    session.refresh(product)
    return product

from fastapi import APIRouter
from app.api.v1 import firefly, companies, products, prices, tags, workflows, receipts

api_router = APIRouter()

api_router.include_router(firefly.router)
api_router.include_router(companies.router)
api_router.include_router(products.router)
api_router.include_router(prices.router)
api_router.include_router(tags.router)
api_router.include_router(workflows.router)
api_router.include_router(receipts.router)

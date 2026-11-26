from fastapi import APIRouter
from app.api.v1 import (
    analytics,
    firefly,
    firefly_sync,
    companies,
    products,
    prices,
    tags,
    workflows,
    receipts,
    accounts,
    asset_accounts,
    categories,
)

api_router = APIRouter()

api_router.include_router(analytics.router)
api_router.include_router(firefly.router)
api_router.include_router(firefly_sync.router)
api_router.include_router(companies.router)
api_router.include_router(products.router)
api_router.include_router(prices.router)
api_router.include_router(tags.router)
api_router.include_router(workflows.router)
api_router.include_router(receipts.router)
api_router.include_router(accounts.router)
api_router.include_router(asset_accounts.router)
api_router.include_router(categories.router)

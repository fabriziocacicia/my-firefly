from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select
from app.core.database import get_session
from app.services.firefly import firefly_client
from app.models.company import Store, Company

router = APIRouter(prefix="/firefly", tags=["Firefly Sync"])

@router.get("/status")
async def get_firefly_status():
    try:
        about = await firefly_client.get_about()
        version = about.get("data", {}).get("attributes", {}).get("version", "unknown")
        return {"connected": True, "version": version, "url": firefly_client.base_url}
    except Exception as e:
        return {"connected": False, "error": str(e), "url": firefly_client.base_url}

@router.get("/expense-accounts")
async def list_expense_accounts(session: Session = Depends(get_session)):
    try:
        accounts = await firefly_client.get_all_expense_accounts()
        # Find which accounts are already mapped
        mapped_stores = session.exec(select(Store).where(Store.firefly_account_id != None)).all()
        mapped_map = {s.firefly_account_id: s for s in mapped_stores}

        results = []
        for acc in accounts:
            acc_id = int(acc.get("id"))
            attr = acc.get("attributes", {})
            store = mapped_map.get(acc_id)
            results.append({
                "id": acc_id,
                "name": attr.get("name"),
                "is_mapped": store is not None,
                "mapped_store_id": store.id if store else None,
                "mapped_store_name": store.name if store else None,
                "mapped_company_name": store.company.name if (store and store.company) else None
            })
        return results
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Firefly API error: {str(e)}")

@router.get("/asset-accounts")
async def list_asset_accounts():
    try:
        accounts = await firefly_client.get_all_asset_accounts()
        results = []
        for acc in accounts:
            acc_id = int(acc.get("id"))
            attr = acc.get("attributes", {})
            results.append({
                "id": acc_id,
                "name": attr.get("name"),
                "current_balance": attr.get("current_balance")
            })
        return results
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Firefly API error: {str(e)}")

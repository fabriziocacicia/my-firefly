from datetime import date
from typing import Optional
from pydantic import BaseModel
from fastapi import APIRouter, HTTPException
from app.services.firefly import firefly_client

router = APIRouter(prefix="/workflows", tags=["Quick Workflows & Shortcuts"])

class MealVoucherRequest(BaseModel):
    purchase_date: str = str(date.today())
    destination_account_id: int
    destination_account_name: str
    ticket_account_id: int
    ticket_count: int = 1
    ticket_unit_value: float = 5.16
    card_account_id: int
    total_amount: float
    description: Optional[str] = "Supermarket Shopping"

@router.post("/meal-voucher-split")
async def execute_meal_voucher_split(req: MealVoucherRequest):
    ticket_amount = round(req.ticket_count * req.ticket_unit_value, 2)
    if ticket_amount > req.total_amount:
        ticket_amount = req.total_amount

    try:
        result = await firefly_client.create_meal_voucher_split_transactions(
            date_str=req.purchase_date,
            destination_account_id=req.destination_account_id,
            destination_account_name=req.destination_account_name,
            ticket_account_id=req.ticket_account_id,
            ticket_amount=ticket_amount,
            card_account_id=req.card_account_id,
            total_amount=req.total_amount,
            description=req.description or "Supermarket Shopping"
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to post transactions to Firefly: {str(e)}")

class FamilyPlanRequest(BaseModel):
    purchase_date: str = str(date.today())
    service_name: str # e.g. "Spotify Family" or "iCloud 2TB"
    month_label: str # e.g. "November 2026"
    source_account_id: int
    expense_account_id: int
    total_amount: float
    notes: Optional[str] = None

@router.post("/family-plan-entry")
async def execute_family_plan_entry(req: FamilyPlanRequest):
    description = f"{req.service_name} - {req.month_label}"
    payload = {
        "error_if_duplicate_hash": False,
        "apply_rules": True,
        "transactions": [
            {
                "type": "withdrawal",
                "date": f"{req.purchase_date}T12:00:00+00:00",
                "amount": f"{req.total_amount:.2f}",
                "description": description,
                "source_id": str(req.source_account_id),
                "destination_id": str(req.expense_account_id),
                "notes": req.notes or f"Generated recurring subscription for {req.month_label}"
            }
        ]
    }
    try:
        res = await firefly_client.create_transaction(payload)
        return {"status": "success", "description": description, "data": res}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create family plan transaction: {str(e)}")

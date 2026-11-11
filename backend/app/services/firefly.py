import httpx
from typing import Optional, Any
from app.core.config import settings

class FireflyClient:
    def __init__(self, base_url: Optional[str] = None, token: Optional[str] = None):
        self.base_url = (base_url or settings.FIREFLY_URL).rstrip("/")
        self.token = token or settings.FIREFLY_TOKEN

    @property
    def headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.token}",
            "Accept": "application/vnd.api+json",
            "Content-Type": "application/json",
            "User-Agent": "FireflyCompanion/1.0"
        }

    async def get_about(self) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(f"{self.base_url}/api/v1/about", headers=self.headers)
            resp.raise_for_status()
            return resp.json()

    async def get_accounts(self, account_type: str = "expense", page: int = 1, limit: int = 50) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=15.0) as client:
            params = {"type": account_type, "page": page, "limit": limit}
            resp = await client.get(f"{self.base_url}/api/v1/accounts", headers=self.headers, params=params)
            resp.raise_for_status()
            return resp.json()

    async def _get_all_accounts_by_type(self, account_type: str) -> list[dict[str, Any]]:
        """Fetches all accounts of a given type across paginated Firefly III responses."""
        accounts = []
        page = 1
        while True:
            data = await self.get_accounts(account_type=account_type, page=page, limit=100)
            items = data.get("data", [])
            if not items:
                break
            accounts.extend(items)
            pagination = data.get("meta", {}).get("pagination", {})
            total_pages = pagination.get("total_pages", 1)
            if page >= total_pages:
                break
            page += 1
        return accounts

    async def get_all_expense_accounts(self) -> list[dict[str, Any]]:
        """Fetches all expense accounts across pages."""
        return await self._get_all_accounts_by_type("expense")

    async def get_all_asset_accounts(self) -> list[dict[str, Any]]:
        """Fetches all asset accounts across pages (checking, cash, meal vouchers)."""
        return await self._get_all_accounts_by_type("asset")

    async def create_transaction(self, transaction_data: dict[str, Any]) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                f"{self.base_url}/api/v1/transactions",
                headers=self.headers,
                json=transaction_data
            )
            resp.raise_for_status()
            return resp.json()

    async def delete_transaction(self, transaction_id: int) -> None:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.delete(
                f"{self.base_url}/api/v1/transactions/{transaction_id}",
                headers=self.headers
            )
            resp.raise_for_status()

    async def create_meal_voucher_split_transactions(
        self,
        date_str: str,
        destination_account_id: int,
        destination_account_name: str,
        ticket_account_id: int,
        ticket_amount: float,
        card_account_id: int,
        total_amount: float,
        description: str = "Supermarket Shopping (Ticket + Card Split)"
    ) -> dict[str, Any]:
        """
        Creates two linked transactions in Firefly III:
        1. From Ticket Account (Buoni Pasto) for `ticket_amount`
        2. From Card/Cash Account for `remainder` (total - ticket_amount)
        """
        remainder = round(total_amount - ticket_amount, 2)
        created_transactions = []

        # 1. Ticket transaction
        if ticket_amount > 0:
            tx1_payload = {
                "error_if_duplicate_hash": False,
                "apply_rules": True,
                "transactions": [
                    {
                        "type": "withdrawal",
                        "date": f"{date_str}T12:00:00+00:00",
                        "amount": f"{ticket_amount:.2f}",
                        "description": f"{description} [Voucher Portion]",
                        "source_id": str(ticket_account_id),
                        "destination_id": str(destination_account_id),
                        "notes": "Paid with Meal Vouchers / Buoni Pasto"
                    }
                ]
            }
            tx1 = await self.create_transaction(tx1_payload)
            created_transactions.append(tx1)

        # 2. Card / Cash remainder transaction
        if remainder > 0:
            tx2_payload = {
                "error_if_duplicate_hash": False,
                "apply_rules": True,
                "transactions": [
                    {
                        "type": "withdrawal",
                        "date": f"{date_str}T12:00:00+00:00",
                        "amount": f"{remainder:.2f}",
                        "description": f"{description} [Card Remainder]",
                        "source_id": str(card_account_id),
                        "destination_id": str(destination_account_id),
                        "notes": "Paid with Card/Cash Remainder"
                    }
                ]
            }
            tx2 = await self.create_transaction(tx2_payload)
            created_transactions.append(tx2)

        return {
            "status": "success",
            "ticket_amount": ticket_amount,
            "card_remainder": remainder,
            "total": total_amount,
            "transactions_created": len(created_transactions),
            "details": created_transactions
        }

firefly_client = FireflyClient()

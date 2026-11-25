import asyncio
import time
from datetime import date, time as dt_time
from typing import Optional, Any
import httpx
from app.core.config import settings


class FireflyClient:
    def __init__(
        self,
        base_url: Optional[str] = None,
        token: Optional[str] = None,
        client: Optional[httpx.AsyncClient] = None,
    ):
        self.base_url = (base_url or settings.FIREFLY_URL).rstrip("/")
        self.token = token or settings.FIREFLY_TOKEN
        self._client: Optional[httpx.AsyncClient] = client
        self._name_cache: dict[int, tuple[str, float]] = {}  # account_id -> (name, expires_at)
        self._cache_lock = asyncio.Lock()
        self._cache_ttl: float = 60.0

    @property
    def headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.token}",
            "Accept": "application/vnd.api+json",
            "Content-Type": "application/json",
            "User-Agent": "FireflyCompanion/1.0",
        }

    def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or getattr(self._client, "is_closed", False):
            self._client = httpx.AsyncClient(timeout=15.0)
        return self._client

    async def aclose(self) -> None:
        if self._client and not getattr(self._client, "is_closed", False):
            await self._client.aclose()
            self._client = None

    async def get_about(self) -> dict[str, Any]:
        client = self._get_client()
        resp = await client.get(f"{self.base_url}/api/v1/about", headers=self.headers)
        resp.raise_for_status()
        return resp.json()

    async def get_accounts(
        self, account_type: str = "expense", page: int = 1, limit: int = 50
    ) -> dict[str, Any]:
        client = self._get_client()
        params = {"type": account_type, "page": page, "limit": limit}
        resp = await client.get(
            f"{self.base_url}/api/v1/accounts", headers=self.headers, params=params
        )
        resp.raise_for_status()
        return resp.json()

    async def _get_all_accounts_by_type(self, account_type: str) -> list[dict[str, Any]]:
        """Fetches all accounts of a given type across paginated Firefly III responses."""
        accounts = []
        page = 1
        max_pages = 100
        while page <= max_pages:
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

    async def get_all_revenue_accounts(self) -> list[dict[str, Any]]:
        """Fetches all revenue accounts across pages (employers, income sources)."""
        return await self._get_all_accounts_by_type("revenue")

    async def search_expense_accounts(
        self, query: str, limit: int = 20
    ) -> list[dict[str, Any]]:
        """
        Searches expense accounts by name via Firefly III GET /api/v1/search/accounts.
        Returns raw list of JSON:API account data objects.
        """
        client = self._get_client()
        params = {"type": "expense", "field": "name", "query": query, "limit": limit}
        resp = await client.get(
            f"{self.base_url}/api/v1/search/accounts",
            headers=self.headers,
            params=params,
        )
        resp.raise_for_status()
        return resp.json().get("data", [])

    async def get_account_by_id(
        self, account_id: int, expected_type: Optional[str] = None
    ) -> Optional[dict[str, Any]]:
        """
        Fetches single account by ID via Firefly III GET /api/v1/accounts/{account_id}.
        If `expected_type` is provided, returns None when the account has a different type.
        """
        client = self._get_client()
        resp = await client.get(
            f"{self.base_url}/api/v1/accounts/{account_id}",
            headers=self.headers,
        )
        if resp.status_code == 404:
            return None
        resp.raise_for_status()
        data = resp.json().get("data")
        if not data:
            return None
        if expected_type and data.get("attributes", {}).get("type") != expected_type:
            return None
        return data

    async def get_expense_account(self, account_id: int) -> Optional[dict[str, Any]]:
        """
        Fetches single expense account by ID via Firefly III GET /api/v1/accounts/{account_id}.
        Returns account data dict if type is 'expense', or None if 404 or different type.
        """
        return await self.get_account_by_id(account_id, expected_type="expense")

    async def resolve_expense_account_names(
        self, account_ids: set[int]
    ) -> dict[int, str]:
        """
        Resolves expense account IDs to their Firefly account names.
        Backed by a process-local 60-second TTL in-memory cache map.
        Uses asyncio.Lock to serialize cache misses.
        Concurrently fetches up to 5 individual missing accounts; performs a
        paginated sweep across all expense accounts when missing count > 5.
        Fallback to 'Deleted Firefly Account #<id>' on 404.
        """
        if not account_ids:
            return {}

        now = time.monotonic()
        resolved: dict[int, str] = {}
        missing: set[int] = set()

        for aid in account_ids:
            entry = self._name_cache.get(aid)
            if entry and entry[1] > now:
                resolved[aid] = entry[0]
            else:
                missing.add(aid)

        if not missing:
            return resolved

        async with self._cache_lock:
            now = time.monotonic()
            still_missing: set[int] = set()
            for aid in missing:
                entry = self._name_cache.get(aid)
                if entry and entry[1] > now:
                    resolved[aid] = entry[0]
                else:
                    still_missing.add(aid)

            if not still_missing:
                return resolved

            if len(still_missing) <= 5:
                async def _fetch_one(aid: int) -> tuple[int, str]:
                    try:
                        acc = await self.get_expense_account(aid)
                        if acc:
                            name = acc.get("attributes", {}).get("name", f"Account #{aid}")
                        else:
                            name = f"Deleted Firefly Account #{aid}"
                        self._name_cache[aid] = (name, now + self._cache_ttl)
                    except Exception:
                        name = f"Account #{aid}"
                    return aid, name

                results = await asyncio.gather(*(_fetch_one(aid) for aid in still_missing))
                for aid, name in results:
                    resolved[aid] = name
            else:
                try:
                    all_accounts = await self.get_all_expense_accounts()
                    found_in_sweep: set[int] = set()
                    for acc in all_accounts:
                        try:
                            aid = int(acc.get("id"))
                            name = acc.get("attributes", {}).get("name", f"Account #{aid}")
                            self._name_cache[aid] = (name, now + self._cache_ttl)
                            if aid in account_ids:
                                resolved[aid] = name
                                found_in_sweep.add(aid)
                        except (ValueError, TypeError):
                            continue

                    for aid in still_missing - found_in_sweep:
                        name = f"Deleted Firefly Account #{aid}"
                        self._name_cache[aid] = (name, now + self._cache_ttl)
                        resolved[aid] = name
                except Exception:
                    for aid in still_missing:
                        resolved[aid] = f"Account #{aid}"

        return resolved

    async def create_transaction(self, transaction_data: dict[str, Any]) -> dict[str, Any]:
        client = self._get_client()
        resp = await client.post(
            f"{self.base_url}/api/v1/transactions",
            headers=self.headers,
            json=transaction_data,
        )
        resp.raise_for_status()
        return resp.json()

    async def delete_transaction(self, transaction_id: int) -> None:
        client = self._get_client()
        resp = await client.delete(
            f"{self.base_url}/api/v1/transactions/{transaction_id}",
            headers=self.headers,
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
        description: str = "Supermarket Shopping (Ticket + Card Split)",
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
                        "notes": "Paid with Meal Vouchers / Buoni Pasto",
                    }
                ],
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
                        "notes": "Paid with Card/Cash Remainder",
                    }
                ],
            }
            tx2 = await self.create_transaction(tx2_payload)
            created_transactions.append(tx2)

        return {
            "status": "success",
            "ticket_amount": ticket_amount,
            "card_remainder": remainder,
            "total": total_amount,
            "transactions_created": len(created_transactions),
            "details": created_transactions,
        }

    async def create_voucher_recharge_deposit(
        self,
        voucher_account_id: int,
        revenue_account_id: int,
        amount: float,
        recharge_date: date,
        recharge_time: dt_time,
        description: str,
        notes: Optional[str] = None,
    ) -> dict[str, Any]:
        """
        Creates a Firefly III deposit transaction from an employer revenue account
        to a meal voucher asset account using a naive ISO-8601 timestamp so Firefly
        evaluates it in the server's configured timezone.
        """
        payload = {
            "error_if_duplicate_hash": False,
            "apply_rules": True,
            "transactions": [
                {
                    "type": "deposit",
                    "date": f"{recharge_date.isoformat()}T{recharge_time.strftime('%H:%M:%S')}",
                    "amount": f"{amount:.2f}",
                    "description": description,
                    "source_id": str(revenue_account_id),
                    "destination_id": str(voucher_account_id),
                    "notes": notes or "",
                }
            ],
        }
        return await self.create_transaction(payload)


firefly_client = FireflyClient()

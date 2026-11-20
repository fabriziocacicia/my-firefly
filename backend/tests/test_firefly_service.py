import asyncio
import unittest
from unittest.mock import AsyncMock, MagicMock, patch
import httpx
from app.services.firefly import FireflyClient


class FireflyServiceTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.client = FireflyClient(base_url="http://mock-firefly", token="mock-token")

    async def asyncTearDown(self):
        await self.client.aclose()

    async def test_search_expense_accounts_calls_search_endpoint(self):
        mock_response = MagicMock(spec=httpx.Response)
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "data": [
                {"id": "10", "attributes": {"name": "Lidl North"}},
                {"id": "11", "attributes": {"name": "Lidl South"}},
            ]
        }

        mock_http = AsyncMock()
        mock_http.get.return_value = mock_response
        self.client._client = mock_http

        results = await self.client.search_expense_accounts(query="Lidl", limit=10)

        self.assertEqual(len(results), 2)
        self.assertEqual(results[0]["id"], "10")
        mock_http.get.assert_awaited_once_with(
            "http://mock-firefly/api/v1/search/accounts",
            headers=self.client.headers,
            params={"type": "expense", "field": "name", "query": "Lidl", "limit": 10},
        )

    async def test_get_expense_account_found_and_not_found(self):
        mock_http = AsyncMock()
        self.client._client = mock_http

        # 1. Found account
        found_resp = MagicMock(spec=httpx.Response)
        found_resp.status_code = 200
        found_resp.json.return_value = {
            "data": {"id": "15", "attributes": {"name": "Conad", "active": True}}
        }
        mock_http.get.return_value = found_resp

        account = await self.client.get_expense_account(15)
        self.assertIsNotNone(account)
        self.assertEqual(account["attributes"]["name"], "Conad")

        # 2. 404 Not Found returns None
        not_found_resp = MagicMock(spec=httpx.Response)
        not_found_resp.status_code = 404
        mock_http.get.return_value = not_found_resp

        missing = await self.client.get_expense_account(999)
        self.assertIsNone(missing)

    async def test_resolve_expense_account_names_caching(self):
        mock_http = AsyncMock()
        self.client._client = mock_http

        mock_resp = MagicMock(spec=httpx.Response)
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "data": {"id": "20", "attributes": {"name": "Coop"}}
        }
        mock_http.get.return_value = mock_resp

        # First resolution calls HTTP
        names1 = await self.client.resolve_expense_account_names({20})
        self.assertEqual(names1, {20: "Coop"})
        self.assertEqual(mock_http.get.await_count, 1)

        # Immediate second resolution uses in-memory TTL cache (no HTTP call)
        names2 = await self.client.resolve_expense_account_names({20})
        self.assertEqual(names2, {20: "Coop"})
        self.assertEqual(mock_http.get.await_count, 1)

    async def test_resolve_expense_account_names_deleted_fallback(self):
        mock_http = AsyncMock()
        self.client._client = mock_http

        mock_resp = MagicMock(spec=httpx.Response)
        mock_resp.status_code = 404
        mock_http.get.return_value = mock_resp

        names = await self.client.resolve_expense_account_names({88})
        self.assertEqual(names, {88: "Deleted Firefly Account #88"})

    async def test_resolve_expense_account_names_sweep_for_large_sets(self):
        mock_http = AsyncMock()
        self.client._client = mock_http

        # Return paginated directory for > 5 accounts
        sweep_data = {
            "data": [
                {"id": str(i), "attributes": {"name": f"Store {i}"}}
                for i in range(1, 10)
            ],
            "meta": {"pagination": {"total_pages": 1}},
        }
        sweep_resp = MagicMock(spec=httpx.Response)
        sweep_resp.status_code = 200
        sweep_resp.json.return_value = sweep_data
        mock_http.get.return_value = sweep_resp

        # Request 7 accounts (> 5 threshold)
        requested_ids = {1, 2, 3, 4, 5, 6, 7}
        resolved = await self.client.resolve_expense_account_names(requested_ids)

        self.assertEqual(len(resolved), 7)
        self.assertEqual(resolved[1], "Store 1")
        self.assertEqual(resolved[7], "Store 7")
        # Should have called get_accounts (directory sweep) rather than 7 single GETs
        mock_http.get.assert_awaited_once()


if __name__ == "__main__":
    unittest.main()

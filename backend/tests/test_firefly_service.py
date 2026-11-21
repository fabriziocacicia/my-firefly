import unittest
import httpx
from app.services.firefly import FireflyClient


class FireflyServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_search_expense_accounts_calls_search_endpoint(self):
        called = {}

        def handler(request: httpx.Request) -> httpx.Response:
            called["url"] = str(request.url)
            called["params"] = dict(request.url.params)
            return httpx.Response(
                200,
                json={
                    "data": [
                        {"id": "10", "attributes": {"name": "Lidl North"}},
                        {"id": "11", "attributes": {"name": "Lidl South"}},
                    ]
                },
            )

        client = FireflyClient(
            base_url="http://mock-firefly",
            token="mock-token",
            client=httpx.AsyncClient(transport=httpx.MockTransport(handler)),
        )
        try:
            results = await client.search_expense_accounts(query="Lidl", limit=10)
            self.assertEqual(len(results), 2)
            self.assertEqual(results[0]["id"], "10")
            self.assertEqual(called["params"]["query"], "Lidl")
            self.assertEqual(called["params"]["type"], "expense")
            self.assertEqual(called["params"]["field"], "name")
            self.assertEqual(called["params"]["limit"], "10")
        finally:
            await client.aclose()

    async def test_get_expense_account_found_and_not_found(self):
        def handler(request: httpx.Request) -> httpx.Response:
            if "/api/v1/accounts/15" in str(request.url):
                return httpx.Response(
                    200,
                    json={
                        "data": {
                            "id": "15",
                            "attributes": {
                                "name": "Conad",
                                "active": True,
                                "type": "expense",
                            },
                        }
                    },
                )
            return httpx.Response(404, json={"message": "Not found"})

        client = FireflyClient(
            base_url="http://mock-firefly",
            token="mock-token",
            client=httpx.AsyncClient(transport=httpx.MockTransport(handler)),
        )
        try:
            account = await client.get_expense_account(15)
            self.assertIsNotNone(account)
            self.assertEqual(account["attributes"]["name"], "Conad")

            missing = await client.get_expense_account(999)
            self.assertIsNone(missing)
        finally:
            await client.aclose()

    async def test_get_expense_account_rejects_non_expense_type(self):
        def handler(request: httpx.Request) -> httpx.Response:
            if "/api/v1/accounts/99" in str(request.url):
                return httpx.Response(
                    200,
                    json={
                        "data": {
                            "id": "99",
                            "attributes": {
                                "name": "Checking Account",
                                "active": True,
                                "type": "asset",
                            },
                        }
                    },
                )
            return httpx.Response(404)

        client = FireflyClient(
            base_url="http://mock-firefly",
            token="mock-token",
            client=httpx.AsyncClient(transport=httpx.MockTransport(handler)),
        )
        try:
            non_expense = await client.get_expense_account(99)
            self.assertIsNone(non_expense)
        finally:
            await client.aclose()

    async def test_resolve_expense_account_names_caching(self):
        call_count = 0

        def handler(request: httpx.Request) -> httpx.Response:
            nonlocal call_count
            call_count += 1
            if "/api/v1/accounts/20" in str(request.url):
                return httpx.Response(
                    200,
                    json={
                        "data": {
                            "id": "20",
                            "attributes": {
                                "name": "Coop",
                                "type": "expense",
                            },
                        }
                    },
                )
            return httpx.Response(404)

        client = FireflyClient(
            base_url="http://mock-firefly",
            token="mock-token",
            client=httpx.AsyncClient(transport=httpx.MockTransport(handler)),
        )
        try:
            names1 = await client.resolve_expense_account_names({20})
            self.assertEqual(names1, {20: "Coop"})
            self.assertEqual(call_count, 1)

            # Cached: no second HTTP call
            names2 = await client.resolve_expense_account_names({20})
            self.assertEqual(names2, {20: "Coop"})
            self.assertEqual(call_count, 1)
        finally:
            await client.aclose()

    async def test_resolve_expense_account_names_transient_error_not_cached(self):
        attempts = 0

        def handler(request: httpx.Request) -> httpx.Response:
            nonlocal attempts
            attempts += 1
            if attempts == 1:
                raise httpx.ConnectError("Network dropped")
            return httpx.Response(
                200,
                json={
                    "data": {
                        "id": "30",
                        "attributes": {"name": "Lidl", "type": "expense"},
                    }
                },
            )

        client = FireflyClient(
            base_url="http://mock-firefly",
            token="mock-token",
            client=httpx.AsyncClient(transport=httpx.MockTransport(handler)),
        )
        try:
            # First attempt fails with network error: returns fallback but does not cache
            names1 = await client.resolve_expense_account_names({30})
            self.assertEqual(names1, {30: "Account #30"})
            self.assertNotIn(30, client._name_cache)

            # Second attempt succeeds and resolves properly
            names2 = await client.resolve_expense_account_names({30})
            self.assertEqual(names2, {30: "Lidl"})
            self.assertIn(30, client._name_cache)
        finally:
            await client.aclose()

    async def test_resolve_expense_account_names_deleted_fallback(self):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(404, json={"message": "Not found"})

        client = FireflyClient(
            base_url="http://mock-firefly",
            token="mock-token",
            client=httpx.AsyncClient(transport=httpx.MockTransport(handler)),
        )
        try:
            names = await client.resolve_expense_account_names({88})
            self.assertEqual(names, {88: "Deleted Firefly Account #88"})
        finally:
            await client.aclose()

    async def test_resolve_expense_account_names_sweep_for_large_sets(self):
        sweep_called = False

        def handler(request: httpx.Request) -> httpx.Response:
            nonlocal sweep_called
            if "/api/v1/accounts" in str(request.url) and "type=expense" in str(request.url):
                sweep_called = True
                return httpx.Response(
                    200,
                    json={
                        "data": [
                            {"id": str(i), "attributes": {"name": f"Store {i}"}}
                            for i in range(1, 10)
                        ],
                        "meta": {"pagination": {"total_pages": 1}},
                    },
                )
            return httpx.Response(404)

        client = FireflyClient(
            base_url="http://mock-firefly",
            token="mock-token",
            client=httpx.AsyncClient(transport=httpx.MockTransport(handler)),
        )
        try:
            requested_ids = {1, 2, 3, 4, 5, 6, 7}
            resolved = await client.resolve_expense_account_names(requested_ids)

            self.assertEqual(len(resolved), 7)
            self.assertEqual(resolved[1], "Store 1")
            self.assertEqual(resolved[7], "Store 7")
            self.assertTrue(sweep_called)
        finally:
            await client.aclose()


if __name__ == "__main__":
    unittest.main()

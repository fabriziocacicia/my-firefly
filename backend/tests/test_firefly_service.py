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

    async def test_get_all_revenue_accounts_and_account_by_type(self):
        def handler(request: httpx.Request) -> httpx.Response:
            if "/api/v1/accounts?" in str(request.url) and "type=revenue" in str(request.url):
                return httpx.Response(
                    200,
                    json={
                        "data": [{"id": "40", "attributes": {"name": "Employer Corp", "type": "revenue"}}],
                        "meta": {"pagination": {"total_pages": 1}},
                    },
                )
            if "/api/v1/accounts/40" in str(request.url):
                return httpx.Response(
                    200,
                    json={"data": {"id": "40", "attributes": {"name": "Employer Corp", "type": "revenue", "active": True}}},
                )
            return httpx.Response(404)

        client = FireflyClient(
            base_url="http://mock-firefly",
            token="mock-token",
            client=httpx.AsyncClient(transport=httpx.MockTransport(handler)),
        )
        try:
            revenues = await client.get_all_revenue_accounts()
            self.assertEqual(len(revenues), 1)
            self.assertEqual(revenues[0]["attributes"]["name"], "Employer Corp")

            rev = await client.get_account_by_id(40, expected_type="revenue")
            self.assertIsNotNone(rev)
            wrong_type = await client.get_account_by_id(40, expected_type="asset")
            self.assertIsNone(wrong_type)
        finally:
            await client.aclose()

    async def test_create_voucher_recharge_deposit_uses_naive_timestamp(self):
        import json as json_mod
        from datetime import date, time

        captured = {}

        def handler(request: httpx.Request) -> httpx.Response:
            captured["url"] = str(request.url)
            captured["body"] = json_mod.loads(request.content.decode("utf-8"))
            return httpx.Response(200, json={"data": {"id": "777"}})

        client = FireflyClient(
            base_url="http://mock-firefly",
            token="mock-token",
            client=httpx.AsyncClient(transport=httpx.MockTransport(handler)),
        )
        try:
            resp = await client.create_voucher_recharge_deposit(
                voucher_account_id=10,
                revenue_account_id=40,
                amount=103.20,
                recharge_date=date(2026, 11, 25),
                recharge_time=time(9, 30, 0),
                description="Monthly Buoni Pasto",
                notes="20 vouchers",
            )
            self.assertEqual(resp["data"]["id"], "777")
            tx = captured["body"]["transactions"][0]
            self.assertEqual(tx["type"], "deposit")
            self.assertEqual(tx["date"], "2026-11-25T09:30:00")
            self.assertEqual(tx["amount"], "103.20")
            self.assertEqual(tx["source_id"], "40")
            self.assertEqual(tx["destination_id"], "10")
            self.assertEqual(tx["description"], "Monthly Buoni Pasto")
            self.assertEqual(tx["category_name"], "Income: Benefits")
            self.assertEqual(tx["tags"], ["Meal Voucher"])
        finally:
            await client.aclose()

    async def test_get_all_categories_and_tags_paginated_and_create_tag(self):
        import json as json_mod

        captured = {}

        def handler(request: httpx.Request) -> httpx.Response:
            url = str(request.url)
            if "/api/v1/categories" in url:
                page = request.url.params.get("page", "1")
                if page == "1":
                    return httpx.Response(
                        200,
                        json={
                            "data": [{"id": "1", "attributes": {"name": "Groceries"}}],
                            "meta": {"pagination": {"total_pages": 2}},
                        },
                    )
                return httpx.Response(
                    200,
                    json={
                        "data": [{"id": "2", "attributes": {"name": "Utilities"}}],
                        "meta": {"pagination": {"total_pages": 2}},
                    },
                )
            if request.method == "GET" and "/api/v1/tags" in url:
                return httpx.Response(
                    200,
                    json={
                        "data": [{"id": "11", "attributes": {"tag": "Mele"}}],
                        "meta": {"pagination": {"total_pages": 1}},
                    },
                )
            if request.method == "POST" and "/api/v1/tags" in url:
                captured["tag_body"] = json_mod.loads(request.content.decode("utf-8"))
                return httpx.Response(
                    200,
                    json={"data": {"id": "12", "attributes": {"tag": "Bio"}}},
                )
            return httpx.Response(404)

        client = FireflyClient(
            base_url="http://mock-firefly",
            token="mock-token",
            client=httpx.AsyncClient(transport=httpx.MockTransport(handler)),
        )
        try:
            cats = await client.get_all_categories()
            self.assertEqual([c["attributes"]["name"] for c in cats], ["Groceries", "Utilities"])

            tags = await client.get_all_tags()
            self.assertEqual([t["attributes"]["tag"] for t in tags], ["Mele"])

            created = await client.create_tag("Bio")
            self.assertEqual(created["data"]["id"], "12")
            self.assertEqual(captured["tag_body"], {"tag": "Bio"})
        finally:
            await client.aclose()

    async def test_get_and_update_transactions(self):
        import json as json_mod

        captured = {}

        def handler(request: httpx.Request) -> httpx.Response:
            url = str(request.url)
            if request.method == "GET" and "/api/v1/transactions/55" in url:
                return httpx.Response(
                    200,
                    json={
                        "data": {
                            "id": "55",
                            "attributes": {
                                "transactions": [
                                    {"transaction_journal_id": "551", "description": "mele rosse bioo 600g"},
                                    {"transaction_journal_id": "552", "description": "Latte"},
                                ]
                            },
                        }
                    },
                )
            if request.method == "PUT" and "/api/v1/transactions/55" in url:
                captured["put_body"] = json_mod.loads(request.content.decode("utf-8"))
                return httpx.Response(200, json={"data": {"id": "55"}})
            if request.method == "GET" and "/api/v1/transactions" in url:
                captured["tx_params"] = dict(request.url.params)
                return httpx.Response(
                    200,
                    json={
                        "data": [{"id": "55", "attributes": {"transactions": []}}],
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
            txs = await client.get_all_transactions(tx_type="withdrawal", start="2026-11-01")
            self.assertEqual(len(txs), 1)
            self.assertEqual(captured["tx_params"]["type"], "withdrawal")
            self.assertEqual(captured["tx_params"]["start"], "2026-11-01")

            single = await client.get_transaction_by_id(55)
            self.assertIsNotNone(single)
            self.assertEqual(len(single["attributes"]["transactions"]), 2)

            await client.update_transaction(55, {"apply_rules": False, "transactions": []})
            self.assertEqual(captured["put_body"]["apply_rules"], False)
        finally:
            await client.aclose()


if __name__ == "__main__":
    unittest.main()

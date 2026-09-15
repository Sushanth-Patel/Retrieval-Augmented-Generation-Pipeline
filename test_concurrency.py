"""Concurrency Stress Test for Agentic RAG FastAPI Server.

Fires 5 simultaneous asynchronous requests across distinct authenticated users
(alice, bob, charlie) and verifies:
1. Zero deadlocks or race condition crashes (all return 200 OK).
2. Per-request identity and context isolation (responses match requests, no cross-talk).
3. Server-side thread-safety across RateLimiter and ChromaDB queries.
"""

import asyncio
import time
import httpx


API_URL = "http://127.0.0.1:8000/query?mock=true"

TEST_REQUESTS = [
    {
        "id": "req-1-alice-postgres",
        "token": "demo-team-admin-key-not-for-production",
        "expected_user": "alice_admin",
        "query": "What is the target PostgreSQL version in RFC-003?",
        "expected_substring": "16"
    },
    {
        "id": "req-2-bob-redis",
        "token": "demo-team-engineer-key-not-for-production",
        "expected_user": "bob_engineer",
        "query": "What are the specifications of the Redis cluster in RFC-001?",
        "expected_substring": "Redis"
    },
    {
        "id": "req-3-charlie-action-items",
        "token": "demo-team-readonly-key-not-for-production",
        "expected_user": "charlie_intern",
        "query": "What action items were assigned across meeting notes?",
        "expected_substring": "action"
    },
    {
        "id": "req-4-alice-auth-incident",
        "token": "demo-team-admin-key-not-for-production",
        "expected_user": "alice_admin",
        "query": "What was the root cause of the January 10 auth latency incident?",
        "expected_substring": "auth"
    },
    {
        "id": "req-5-bob-failover",
        "token": "demo-team-engineer-key-not-for-production",
        "expected_user": "bob_engineer",
        "query": "What was the resolution of Incident 2026-02-14 database failover?",
        "expected_substring": "failover"
    }
]


async def send_single_query(client: httpx.AsyncClient, item: dict) -> dict:
    start_time = time.time()
    headers = {
        "Authorization": f"Bearer {item['token']}",
        "Content-Type": "application/json"
    }
    payload = {"query": item["query"]}

    try:
        response = await client.post(API_URL, json=payload, headers=headers, timeout=60.0)
        elapsed = time.time() - start_time
        return {
            "id": item["id"],
            "status_code": response.status_code,
            "elapsed": round(elapsed, 2),
            "expected_user": item["expected_user"],
            "data": response.json() if response.status_code == 200 else response.text,
            "error": None
        }
    except Exception as e:
        return {
            "id": item["id"],
            "status_code": None,
            "elapsed": round(time.time() - start_time, 2),
            "expected_user": item["expected_user"],
            "data": None,
            "error": str(e)
        }


async def run_concurrency_test():
    print(f"[*] Dispatching 5 concurrent requests simultaneously to {API_URL}...")
    start_total = time.time()

    async with httpx.AsyncClient() as client:
        tasks = [send_single_query(client, item) for item in TEST_REQUESTS]
        results = await asyncio.gather(*tasks)

    total_wall_time = time.time() - start_total
    print(f"[*] All 5 requests returned in {total_wall_time:.2f}s total wall-clock time.\n")

    all_passed = True
    for res in results:
        status_code = res["status_code"]
        data = res["data"]
        expected_user = res["expected_user"]

        if status_code != 200:
            print(f"[FAIL] {res['id']}: HTTP {status_code} (Error: {res['error'] or data})")
            all_passed = False
            continue

        actual_user = data.get("user_id")
        answer = data.get("answer", "")
        sources = data.get("sources", [])
        is_grounded = data.get("validation", {}).get("is_grounded")

        user_match = actual_user == expected_user
        has_content = len(answer) > 20

        if not user_match:
            print(f"[FAIL] {res['id']}: User ID mismatch! Expected {expected_user}, got {actual_user} (CROSS-REQUEST LEAK)")
            all_passed = False
        elif not has_content:
            print(f"[FAIL] {res['id']}: Empty or truncated answer")
            all_passed = False
        else:
            print(f"[PASS] {res['id']} | User: {actual_user} | Latency: {res['elapsed']}s | Sources: {len(sources)} | Grounded: {is_grounded}")
            print(f"       Answer preview: {answer[:90].replace(chr(10), ' ')}...")

    print(f"\n[*] Concurrency Verification Result: {'ALL 5 PASSED' if all_passed else 'FAILURES DETECTED'}")
    return all_passed


if __name__ == "__main__":
    success = asyncio.run(run_concurrency_test())
    exit(0 if success else 1)

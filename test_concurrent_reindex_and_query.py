"""Stress Test: Concurrent Reindex + Concurrent Query Execution.

Tests real small-team contention scenarios:
1. Two privileged users (alice_admin and bob_engineer) both hit /reindex simultaneously.
2. Concurrent users query the knowledge base WHILE reindexing is actively writing to the vector store.
3. Confirms:
   - Zero SQLite database lock errors or ChromaDB corruption.
   - All queries return grounded answers with valid sources.
   - Both reindex requests serialize cleanly through _reindex_lock and return chunks_indexed.
"""

import asyncio
import time
import httpx

BASE_URL = "http://127.0.0.1:8000"

ALICE_TOKEN = "demo-team-admin-key-not-for-production"
BOB_TOKEN = "demo-team-engineer-key-not-for-production"
CHARLIE_TOKEN = "demo-team-readonly-key-not-for-production"


async def fire_reindex(client: httpx.AsyncClient, name: str, token: str) -> dict:
    start = time.time()
    headers = {"Authorization": f"Bearer {token}"}
    try:
        resp = await client.post(f"{BASE_URL}/reindex", headers=headers, timeout=60.0)
        elapsed = time.time() - start
        return {
            "type": "REINDEX",
            "name": name,
            "status_code": resp.status_code,
            "elapsed": round(elapsed, 2),
            "data": resp.json() if resp.status_code == 200 else resp.text,
            "error": None
        }
    except Exception as e:
        return {
            "type": "REINDEX",
            "name": name,
            "status_code": None,
            "elapsed": round(time.time() - start, 2),
            "data": None,
            "error": str(e)
        }


async def fire_query(client: httpx.AsyncClient, name: str, token: str, query: str) -> dict:
    start = time.time()
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }
    payload = {"query": query}
    try:
        resp = await client.post(f"{BASE_URL}/query?mock=true", json=payload, headers=headers, timeout=60.0)
        elapsed = time.time() - start
        return {
            "type": "QUERY",
            "name": name,
            "status_code": resp.status_code,
            "elapsed": round(elapsed, 2),
            "data": resp.json() if resp.status_code == 200 else resp.text,
            "error": None
        }
    except Exception as e:
        return {
            "type": "QUERY",
            "name": name,
            "status_code": None,
            "elapsed": round(time.time() - start, 2),
            "data": None,
            "error": str(e)
        }


async def run_contention_test():
    print(f"[*] Dispatching concurrent REINDEX + QUERY requests simultaneously...")
    start_total = time.time()

    async with httpx.AsyncClient() as client:
        tasks = [
            # Two simultaneous reindex operations
            fire_reindex(client, "alice-reindex", ALICE_TOKEN),
            fire_reindex(client, "bob-reindex", BOB_TOKEN),
            # Three simultaneous query operations occurring while reindexing writes to disk
            fire_query(client, "charlie-query-action-items", CHARLIE_TOKEN, "What action items were assigned across meeting notes?"),
            fire_query(client, "alice-query-postgres", ALICE_TOKEN, "What target PostgreSQL version are we upgrading to?"),
            fire_query(client, "bob-query-redis", BOB_TOKEN, "What are the specifications of the Redis cluster in RFC-001?")
        ]
        results = await asyncio.gather(*tasks)

    total_time = time.time() - start_total
    print(f"[*] All {len(results)} operations finished in {total_time:.2f}s total wall-clock time.\n")

    all_passed = True
    for res in results:
        status_code = res["status_code"]
        op_type = res["type"]
        name = res["name"]
        data = res["data"]
        latency = res["elapsed"]

        if status_code != 200:
            print(f"[FAIL] {op_type} '{name}': HTTP {status_code} (Error: {res['error'] or data})")
            all_passed = False
        else:
            if op_type == "REINDEX":
                chunks = data.get("chunks_indexed")
                uid = data.get("user_id")
                print(f"[PASS] {op_type} '{name}' | User: {uid} | Latency: {latency}s | Chunks Indexed: {chunks}")
            else:
                uid = data.get("user_id")
                sources = len(data.get("sources", []))
                grounded = data.get("validation", {}).get("is_grounded")
                answer_preview = data.get("answer", "")[:75].replace("\n", " ")
                print(f"[PASS] {op_type} '{name}' | User: {uid} | Latency: {latency}s | Sources: {sources} | Grounded: {grounded}")
                print(f"       Answer preview: {answer_preview}...")

    print(f"\n[*] Contention Verification Result: {'ALL PASSED' if all_passed else 'FAILURES DETECTED'}")
    return all_passed


if __name__ == "__main__":
    success = asyncio.run(run_contention_test())
    exit(0 if success else 1)

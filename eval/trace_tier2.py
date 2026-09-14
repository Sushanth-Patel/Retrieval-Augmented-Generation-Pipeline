import sys
sys.path.insert(0, ".")
import json
from phase1_agent_loop import ManualAgent

agent = ManualAgent(force_mock=True)
with open("eval/test_cases.json", encoding="utf-8") as f:
    tests = {tc["id"]: tc for tc in json.load(f)}

for fid in ["TC-06", "TC-12", "TC-31"]:
    tc = tests[fid]
    res = agent.run(tc["query"])
    print("=" * 60)
    print(f"CASE: {fid} | Query: {tc['query']}")
    print("Expected Keywords:", tc["expected_keywords"])
    
    # Check in evidence
    all_evidence = "\n".join(c["content"] for c in res["evidence"])
    found_in_ev = [kw for kw in tc["expected_keywords"] if kw.lower() in all_evidence.lower()]
    found_in_ans = [kw for kw in tc["expected_keywords"] if kw.lower() in res["answer"].lower()]
    print(f"Keywords in Retrieved Evidence: {len(found_in_ev)}/{len(tc['expected_keywords'])} -> {found_in_ev}")
    print(f"Keywords in Final Answer:       {len(found_in_ans)}/{len(tc['expected_keywords'])} -> {found_in_ans}")
    
    print("\n[Produced Answer Excerpt]")
    for line in res["answer"].splitlines()[:6]:
        print("  >", line)

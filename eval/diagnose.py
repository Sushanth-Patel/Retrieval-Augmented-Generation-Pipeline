import sys
import os
sys.path.insert(0, ".")
import json
from phase1_agent_loop import ManualAgent

agent = ManualAgent(force_mock=True)
with open("eval/test_cases.json", encoding="utf-8") as f:
    tests = {tc["id"]: tc for tc in json.load(f)}

failed_ids = ["TC-02", "TC-03", "TC-04", "TC-06", "TC-09", "TC-11", "TC-12", "TC-31"]

print("="*70)
print(f"{'ID':<7} | {'Expected Keywords':<32} | {'Retrieved?':<12} | {'Root Cause'}")
print("="*70)

for fid in failed_ids:
    tc = tests[fid]
    res = agent.run(tc["query"])
    evidence_text = "\n".join(c["content"] for c in res["evidence"])
    
    in_retrieval = [kw for kw in tc["expected_keywords"] if kw.lower() in evidence_text.lower()]
    in_answer = [kw for kw in tc["expected_keywords"] if kw.lower() in res["answer"].lower()]
    
    retrieval_ok = len(in_retrieval) >= len(tc["expected_keywords"]) * 0.5
    
    if len(in_retrieval) < len(tc["expected_keywords"]) * 0.5:
        cause = "RETRIEVAL (Chunks missed)"
    elif len(in_answer) < len(tc["expected_keywords"]) * 0.5:
        cause = "SYNTHESIS (Found in chunks, lost in answer)"
    else:
        cause = "SCORER MISMATCH"
        
    print(f"{fid:<7} | In Ret: {len(in_retrieval)}/{len(tc['expected_keywords'])} | In Ans: {len(in_answer)}/{len(tc['expected_keywords'])} | {cause}")

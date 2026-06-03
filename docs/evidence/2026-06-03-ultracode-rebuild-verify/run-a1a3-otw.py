"""A1/A2/A3 over-the-wire 實測 runner — 對 running governance-service :49102。
誠實原則:只記錄真實回應;identity diff 誠實標 0 change;失敗即記錄非假裝 pass。
輸出 evidence JSON 到本目錄。"""
import urllib.request, json, time, os, sys

BASE = "http://127.0.0.1:49102"
HERE = os.path.dirname(os.path.abspath(__file__))
FIXT = r"C:\Repos\active\iot\AI-BIM-governance\storage\fixture-bytes.ifc"
EVID = {}

def call(method, path, body=None, timeout=300):
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read().decode()
        try:
            return r.status, json.loads(raw)
        except Exception:
            return r.status, raw

def poll_run(run_id, tries=120):
    for _ in range(tries):
        st, j = call("GET", f"/api/rule-runs/{run_id}")
        if j.get("status") in ("succeeded", "failed", "error", "completed", "done"):
            return j
        time.sleep(2)
    return j

print("=== A1: rule-run on real fixture-bytes.ifc ===")
t0 = time.time()
st, run = call("POST", "/api/rule-runs",
               {"ifc_source_path": FIXT, "model_version_id": "otw-2026-06-03-a1"})
print("POST /api/rule-runs ->", st, json.dumps(run, ensure_ascii=False)[:200])
run_id = run.get("rule_run_id") or run.get("id")
final = poll_run(run_id)
elapsed = round(time.time() - t0, 1)
print(f"A1 final status={final.get('status')} score={final.get('score')} elapsed={elapsed}s")
st, failed = call("GET", f"/api/rule-runs/{run_id}/results?status=failed")
failed_items = failed.get("results", failed if isinstance(failed, list) else [])
nfail = len(failed_items) if isinstance(failed_items, list) else failed.get("count", "?")
sample = failed_items[:5] if isinstance(failed_items, list) else failed_items
EVID["A1"] = {"run_id": run_id, "status": final.get("status"), "score": final.get("score"),
              "summary": final.get("summary"), "elapsed_s": elapsed,
              "failed_count": nfail, "failed_sample": sample}
print(f"A1 failed_count={nfail}; sample guids:", [
    (it.get("ifc_guid"), it.get("rule_id") or it.get("message", "")[:40])
    for it in (sample if isinstance(sample, list) else [])])

# A1 excel export (just confirm bytes)
try:
    st, _ = 0, None
    url = f"{BASE}/api/rule-runs/{run_id}/export?fmt=excel"
    with urllib.request.urlopen(url, timeout=120) as r:
        b = r.read()
    EVID["A1"]["excel_bytes"] = len(b)
    EVID["A1"]["excel_sig"] = b[:2].hex()  # PK = 504b
    print(f"A1 excel export bytes={len(b)} sig={b[:2].hex()} (PK=504b)")
except Exception as e:
    EVID["A1"]["excel_error"] = str(e)
    print("A1 excel export ERROR:", e)

with open(os.path.join(HERE, "a1-otw-evidence.json"), "w", encoding="utf-8") as f:
    json.dump(EVID, f, ensure_ascii=False, indent=2)
print("WROTE a1-otw-evidence.json")

"""governance CPU 語意 E2E（over-the-wire，對 final main code @ :49152）。

證明對抗驗證 + 全部修復 merge 後，A1 rule-run 對真實 IFC 仍誠實運作、headline 99.0 不回歸。
不用 curl（被 deny）；用 urllib。"""
import json
import os
import time
import urllib.request

BASE = "http://127.0.0.1:49152"
STORAGE = r"C:\Repos\active\iot\AI-BIM-governance\storage"


def _post(path, payload):
    data = json.dumps(payload).encode()
    req = urllib.request.Request(BASE + path, data=data, headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.status, json.loads(r.read())


def _get(path):
    with urllib.request.urlopen(BASE + path, timeout=60) as r:
        return r.status, json.loads(r.read())


def run_rule_run(ifc_path, label):
    st, body = _post("/api/rule-runs", {"ifc_source_path": ifc_path, "rule_set": "default-governance"})
    run_id = body["rule_run_id"]
    # poll
    summary = None
    for _ in range(120):
        time.sleep(1)
        st2, row = _get(f"/api/rule-runs/{run_id}")
        if row["status"] in ("succeeded", "failed"):
            summary = row
            break
    st3, results = _get(f"/api/rule-runs/{run_id}/results?status=failed")
    failed = results["results"]
    return {
        "label": label,
        "ifc": os.path.basename(ifc_path),
        "run_id": run_id,
        "status": summary["status"] if summary else "timeout",
        "score": summary.get("score") if summary else None,
        "summary": summary.get("summary") if summary else None,
        "failed_count": len(failed),
        "failed_sample": failed[:3],
    }


def main():
    out = {"base": BASE, "results": []}
    for ifc, label in [
        (os.path.join(STORAGE, "fixture-bytes.ifc"), "committed-fixture (IFC4X3, 預期 7126/99.0/0 errored)"),
        (os.path.join(STORAGE, "270_0dac5239-a2aa-4257-9946-c2b6da6bd24d_model.ifc"), "real-model-270"),
    ]:
        if not os.path.exists(ifc):
            out["results"].append({"label": label, "ifc": os.path.basename(ifc), "status": "MISSING"})
            continue
        out["results"].append(run_rule_run(ifc, label))
    print(json.dumps(out, ensure_ascii=False, indent=2))
    with open(os.path.join(os.path.dirname(__file__), "a1-final-otw-evidence.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()

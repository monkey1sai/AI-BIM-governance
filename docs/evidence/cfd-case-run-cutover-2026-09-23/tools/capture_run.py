"""Capture one finished CFD run from the coordinator into an evidence folder, redacting the public host.

Writes <out>/status.json (coordinator GET /api/cfd/runs/{id}), <out>/result.json (GET .../result),
<out>/exclusions.json and <out>/run_record.json (fetched through the coordinator-published URLs),
each with the canonical host replaced by <canonical-host>. Numbers and sha256 values are kept.
"""
import json
import os
import re
import subprocess
import sys
from pathlib import Path

BASE = os.environ["CFD_COORDINATOR_BASE"].rstrip("/")  # coordinator origin, e.g. http://<canonical-host>:8004
run_id, out = sys.argv[1], Path(sys.argv[2])
out.mkdir(parents=True, exist_ok=True)


def get(url: str) -> str:
    return subprocess.run(["curl.exe", "-s", "-m", "60", url], capture_output=True, text=True, timeout=90).stdout


def redact(text: str) -> str:
    return re.sub(r"https?://[0-9A-Za-z.\-]+:(\d+)", r"http://<canonical-host>:\1", text)


status = get(f"{BASE}/api/cfd/runs/{run_id}")
result_raw = get(f"{BASE}/api/cfd/runs/{run_id}/result")
result = json.loads(result_raw)
(out / "status.json").write_text(redact(json.dumps(json.loads(status), ensure_ascii=False, indent=2)) + "\n", encoding="utf-8")
(out / "result.json").write_text(redact(json.dumps(result, ensure_ascii=False, indent=2)) + "\n", encoding="utf-8")
for key in ("run_record", "exclusions"):
    ref = result.get(key) or {}
    if not ref.get("url"):
        continue
    doc = get(ref["url"])
    if key == "exclusions":
        # Public repository: keep counts and the served document's sha256, never the per-element IFC GlobalIds.
        full = json.loads(doc)
        items = full.get("items") or []
        doc = json.dumps({
            "note": "reduced for the public repository: the per-element items (IFC GlobalIds) are omitted; counts and the sha256 of the served document are kept",
            "schema": full.get("schema"), "profile": full.get("profile"), "source_model_usdc_sha256": full.get("source_model_usdc_sha256"),
            "outlier_rule": full.get("outlier_rule"), "counts": full.get("counts"), "item_count": len(items),
            "ifc_types_excluded": sorted({item.get("ifc_type") for item in items if item.get("ifc_type")}),
            "served_document_sha256_per_result_json": ref.get("sha256"),
        }, ensure_ascii=False, indent=2)
    (out / f"{key}.json").write_text(redact(doc if doc.endswith("\n") else doc + "\n"), encoding="utf-8")
print(json.dumps({"run_id": run_id, "status": result.get("status"), "directions": [d.get("status") for d in result.get("directions", [])]}))

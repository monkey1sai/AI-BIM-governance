"""產生 A1 governance rule-run 的真實 IFC evidence（CPU-only，無 GPU）。

讀 main workspace storage 的真實 IFC，跑 default 規則集，輸出 capped summary JSON
+ 失敗構件 Excel。usd_prim_path 留 null（未 join 真實多元素 mapping，誠實標示）。

用法： python scripts/run_governance_evidence.py [ifc_path] [out_dir]
"""
from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from rule_engine import load_rule_set, open_model, run_rules, workbook_bytes  # noqa: E402

DEFAULT_IFC = r"C:\Repos\active\iot\AI-BIM-governance\storage\fixture-bytes.ifc"
SERVICE_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
RULES = os.path.join(SERVICE_ROOT, "rules", "default-governance.yaml")
DEFAULT_OUT = os.path.abspath(
    os.path.join(SERVICE_ROOT, "..", "docs", "evidence", "governance-rule-run-pass", "2026-06-02")
)


def main() -> int:
    ifc = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_IFC
    out = os.path.abspath(sys.argv[2]) if len(sys.argv) > 2 else DEFAULT_OUT
    if not os.path.exists(ifc):
        print(f"BLOCKER: IFC not found: {ifc}")
        return 2
    os.makedirs(out, exist_ok=True)

    model = open_model(ifc)
    run = run_rules(model, load_rule_set(RULES))

    summary = run.summary_dict()
    summary["schema"] = model.schema
    summary["ifc_source_filename"] = os.path.basename(ifc)

    sample = [r.to_dict() for r in run.failed_results()[:20]]
    payload = {
        "summary": summary,
        "sample_failed": sample,
        "honesty_notes": [
            "usd_prim_path 為 null：未 join 真實 element_mapping（真模型多元素 mapping 待真實轉檔產出，p1）。",
            "ifctester 未安裝、未使用；規則為純 ifcopenshell predicate。",
            "本 evidence 為 CPU-only，未依賴 GPU / Kit / WebRTC。",
        ],
    }
    with open(os.path.join(out, "real-ifc-run-summary.json"), "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)
    with open(os.path.join(out, "sample-failed.xlsx"), "wb") as fh:
        fh.write(workbook_bytes(run))

    print(
        f"schema={model.schema} total={run.total} passed={run.passed} "
        f"failed={run.failed} errored={run.errored} score={run.score}"
    )
    print(f"warnings={run.warnings}")
    print(f"evidence -> {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

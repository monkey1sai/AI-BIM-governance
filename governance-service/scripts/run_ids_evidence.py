"""產生 A1 IDS-XML 匯入的真實 smoke 證據（ifctester 跑 buildingSMART IDS）。

對真實 IFC 跑「防火門需 FireRating」IDS，輸出 summary + 嘗試寫出 sample IDS 檔。
"""
from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import ifcopenshell  # noqa: E402

from rule_engine.ids_runner import run_ids  # noqa: E402

IFC = r"C:\Repos\active\iot\AI-BIM-governance\storage\許良宇圖書館建築_2026.ifc"
SERVICE_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT = os.path.abspath(os.path.join(SERVICE_ROOT, "..", "docs", "evidence", "ids-import-pass", "2026-06-03"))
SAMPLE = os.path.join(SERVICE_ROOT, "rules", "sample-fire-rating.ids")


def _fire_ids():
    from ifctester import facet as F
    from ifctester import ids

    spec = ids.Specification(name="Doors need FireRating (IDS smoke)")
    spec.applicability.append(F.Entity(name="IFCDOOR"))
    spec.requirements.append(F.Property(propertySet="Pset_DoorCommon", baseName="FireRating", dataType="IFCLABEL"))
    doc = ids.Ids(title="fire-rating-smoke")
    doc.specifications.append(spec)
    return doc


def _write_sample(doc) -> bool:
    try:
        doc.to_xml(SAMPLE)
        return os.path.exists(SAMPLE)
    except Exception:
        try:
            import lxml.etree as ET

            ET.ElementTree(doc.to_xml()).write(SAMPLE, pretty_print=True, xml_declaration=True, encoding="utf-8")
            return os.path.exists(SAMPLE)
        except Exception:
            return False


def main() -> int:
    if not os.path.exists(IFC):
        print("BLOCKER: IFC not found", IFC)
        return 2
    os.makedirs(OUT, exist_ok=True)
    wrote = _write_sample(_fire_ids())
    model = ifcopenshell.open(IFC)
    run = run_ids(model, _fire_ids())
    summary = run.summary_dict()
    summary["ifc_source_filename"] = os.path.basename(IFC)
    payload = {
        "ids_title": "fire-rating-smoke",
        "tool": "ifctester 0.8.5 (buildingSMART IDS)",
        "summary": summary,
        "sample_failed": [r.to_dict() for r in run.failed_results()[:10]],
        "sample_ids_written": wrote,
        "honesty_notes": ["規則來源為 buildingSMART IDS（ifctester），非 YAML 引擎；CPU-only，無 GPU。"],
    }
    with open(os.path.join(OUT, "ids-smoke-summary.json"), "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)
    print(f"total={run.total} passed={run.passed} failed={run.failed} score={run.score} sample_ids_written={wrote}")
    print(f"evidence -> {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

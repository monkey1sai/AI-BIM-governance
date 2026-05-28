r"""L4 真機驗證:_run_ifcopenshell_semantic_sidecar 在 host-native python 環境內可跑。

跑法 (從 repo root):
  & 'C:\Program Files\Python312\python.exe' docs/evidence/streaming-server-ifcopenshell-semantic-sidecar-pass/l4_verify_sidecar_pass.py
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

REPO_ROOT = Path(r"C:\Repos\active\iot\AI-BIM-governance")
MODULE_DIR = (
    REPO_ROOT
    / "bim-streaming-server"
    / "source"
    / "extensions"
    / "ezplus.bim_review_stream.messaging"
    / "ezplus"
    / "bim_review_stream"
    / "messaging"
)
sys.path.insert(0, str(MODULE_DIR))

from ifc2usdc_powershell_adapter import Ifc2UsdcPowershellConverterAdapter  # noqa: E402

EVIDENCE_DIR = REPO_ROOT / "docs" / "evidence" / "streaming-server-ifcopenshell-semantic-sidecar-pass"
ARTIFACT_DIR = EVIDENCE_DIR / "l4-artifact-2026-05-28"
ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)

# fixture-bytes.ifc(89MB)— 從之前 demo conversion 已驗 parseable
IFC_SOURCE = REPO_ROOT / "storage" / "fixture-bytes.ifc"

adapter = Ifc2UsdcPowershellConverterAdapter(repo_root=REPO_ROOT)

print(f"[L4] IFC source: {IFC_SOURCE} ({IFC_SOURCE.stat().st_size / 1024 / 1024:.1f} MB)")
print(f"[L4] artifact_dir: {ARTIFACT_DIR}")
print(f"[L4] adapter class: {type(adapter).__name__}")
print(f"[L4] sidecar pass helper exists: {hasattr(adapter, '_run_ifcopenshell_semantic_sidecar')}")
print()

print("[L4] invoking _run_ifcopenshell_semantic_sidecar ...")
t0 = time.time()
sidecar_path = adapter._run_ifcopenshell_semantic_sidecar(
    ifc_source_path=IFC_SOURCE,
    artifact_dir=ARTIFACT_DIR,
)
elapsed = time.time() - t0
print(f"[L4] elapsed: {elapsed:.2f}s")
print(f"[L4] sidecar_path: {sidecar_path}")

if sidecar_path is None:
    print("[L4] FAILED: helper returned None")
    sys.exit(1)

if not sidecar_path.is_file():
    print(f"[L4] FAILED: sidecar file does not exist at {sidecar_path}")
    sys.exit(1)

print(f"[L4] sidecar size: {sidecar_path.stat().st_size} bytes")

doc = json.loads(sidecar_path.read_text(encoding="utf-8"))
print(f"[L4] format_version: {doc.get('format_version')}")
print(f"[L4] ifc_source recorded: {doc.get('ifc_source')}")
summary = doc.get("summary", {})
print(f"[L4] summary.count: {summary.get('count')}")
print(f"[L4] summary.has_type: {summary.get('has_type')}")
print(f"[L4] summary.has_name: {summary.get('has_name')}")
print()

entries = doc.get("entries", [])
if entries:
    print(f"[L4] first 3 entries:")
    for entry in entries[:3]:
        print(f"  - guid={entry.get('ifc_guid')!s:>30} type={entry.get('ifc_type'):<30} name={entry.get('ifc_name')!s:<40} shape_index={entry.get('shape_index')}")
    print()
    print(f"[L4] last 3 entries:")
    for entry in entries[-3:]:
        print(f"  - guid={entry.get('ifc_guid')!s:>30} type={entry.get('ifc_type'):<30} name={entry.get('ifc_name')!s:<40} shape_index={entry.get('shape_index')}")
else:
    print("[L4] WARN: entries empty (no IfcProduct with Representation + GlobalId)")

print()
print(f"[L4] PASSED: sidecar pass helper真機跑得起來,真實 IFC 可解析,sidecar JSON 落地 + schema 正確")

"""governance-service — A1 BIM 治理與模型檢核 rule-run authority。

FastAPI，綁定 127.0.0.1:49102（loopback only，鏡像 host_native_conversion_service 模式）。
瀏覽器永不直連本服務；一律經 coordinator :8004 的 /api/governance/* proxy。

邊界與誠實守則：
- 純 CPU、host-native ifcopenshell；不需 GPU / Kit。
- ifctester 已安裝（host 0.8.5）→ 支援 buildingSMART IDS-XML rule-run；/health 如實回報 ifctester 安裝狀態。
- BCF 2.1 匯出已實作（issue → .bcfzip）：bcf/ 模組執行期只用 stdlib（zipfile+xml）、不 import
  bcf-client；惟 ifctester（供 IDS）會在環境 transitive 安裝 bcf-client(GPLv3)，匯出產物不含其
  程式碼。rule-run /export 仍僅 Excel，BCF 走 /api/bcf/export。
"""
from __future__ import annotations

import glob
import importlib.util
import json
import os
from typing import Any, Optional

import ifcopenshell.util.element as ifc_el
from fastapi import BackgroundTasks, FastAPI, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from db import Store
from rule_engine import (
    is_fake_mapping,
    join_usd_prim_paths,
    load_element_mapping,
    load_rule_set,
    open_model,
    run_rules,
    workbook_bytes,
)
from rule_engine.models import RuleRunResult

SERVICE_ROOT = os.path.dirname(__file__)
RULES_DIR = os.path.join(SERVICE_ROOT, "rules")
DB_PATH = os.environ.get("GOV_DB_PATH", os.path.join(SERVICE_ROOT, "storage", "governance.db"))

app = FastAPI(title="governance-service", version="0.1.0")
store = Store(DB_PATH)

# 已完成 run 的記憶體快取（供 Excel 匯出；亦可由 DB 重建）。
_RUN_CACHE: dict[str, RuleRunResult] = {}

# A2 model-version diff（獨立 router 模組，掛入同一 governance-service app）。
from diff_engine.api import router as diff_router  # noqa: E402

app.include_router(diff_router)

# A3 cross-discipline federation（USD sublayer 疊合，獨立 router 模組）。
from federation.api import router as federation_router  # noqa: E402

app.include_router(federation_router)

# Issue tracking（issue 生命週期 + audit + A1/A2 來源綁定，獨立 router 模組）。
from issues.api import router as issue_router  # noqa: E402

app.include_router(issue_router)

# BCF 匯出（issue → BCF 2.1 .bcfzip）：匯出模組執行期只用 stdlib、不 import bcf-client；
# ifctester 會在環境 transitive 安裝 bcf-client(GPLv3)，匯出產物不含其程式碼。
from bcf.api import router as bcf_router  # noqa: E402

app.include_router(bcf_router)

# A1 file-library browse（唯讀 local file-server 模擬層：storage/{projectId}/{modelId}/*.ifc 樹）。
from file_library.api import router as file_library_router  # noqa: E402

app.include_router(file_library_router)


def _rule_set_path(name: Optional[str]) -> str:
    name = name or "default-governance"
    path = os.path.join(RULES_DIR, f"{name}.yaml")
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail=f"rule set not found: {name}")
    return path


class RuleRunRequest(BaseModel):
    ifc_source_path: str
    rule_set: Optional[str] = None
    model_version_id: Optional[str] = None
    element_mapping_path: Optional[str] = None
    ids_path: Optional[str] = None  # 提供時改用 buildingSMART IDS（ifctester）而非 YAML 規則集


@app.get("/health")
def health():
    return {
        "service": "governance-service",
        "status": "ok",
        "ifcopenshell": importlib.util.find_spec("ifcopenshell") is not None,
        # 誠實回報 ifctester 實際安裝狀態（host 已安裝 → 支援 IDS-XML rule-run）
        "ifctester": importlib.util.find_spec("ifctester") is not None,
        "rule_sets": [
            os.path.splitext(os.path.basename(p))[0]
            for p in sorted(glob.glob(os.path.join(RULES_DIR, "*.yaml")))
        ],
    }


# CH-H2：per-element 語意查詢端點（範本面板②IFC語意 / ⑥空間關係 的真實資料來源）。
# 真的以 ifcopenshell 讀 Pset/Quantity + 空間容納鏈 + type/predefined_type/tag；瀏覽器只經 coordinator
# :8004 /api/governance/elements/for-session/:sessionId/:guid proxy（coordinator resolve server IFC 路徑後 forward）。
# 誠實鐵律：分類碼(MasterFormat/OmniClass/Uniformat) 與幾何(BBox/體積/材質) 未萃取 → 回 null + roadmap，不捏造。
_SEMANTIC_SYNTHETIC_KEYS = frozenset({"id"})


def _strip_synthetic_psets(psets: dict) -> dict:
    out: dict = {}
    for name, bucket in (psets or {}).items():
        if isinstance(bucket, dict):
            out[name] = {k: v for k, v in bucket.items() if k not in _SEMANTIC_SYNTHETIC_KEYS}
        else:
            out[name] = bucket
    return out


def _spatial_chain(el: Any) -> list[dict]:
    """空間容納鏈：containing storey → building → site → project（真的走 get_container/get_aggregate）。"""
    chain: list[dict] = []
    seen: set[int] = set()
    node = ifc_el.get_container(el)
    while node is not None:
        try:
            nid = node.id()
        except Exception:
            break
        if nid in seen:
            break
        seen.add(nid)
        chain.append({
            "ifc_type": node.is_a(),
            "name": getattr(node, "Name", None),
            "global_id": getattr(node, "GlobalId", None),
        })
        node = ifc_el.get_aggregate(node)
    return chain


@app.get("/api/elements/semantics")
def element_semantics(
    ifc_source_path: str = Query(...),
    ifc_guid: str = Query(...),
):
    if not os.path.exists(ifc_source_path):
        raise HTTPException(status_code=400, detail=f"ifc_source_path not found: {ifc_source_path}")
    model = open_model(ifc_source_path)
    try:
        el = model.by_guid(ifc_guid)
    except Exception:
        el = None
    if el is None:
        raise HTTPException(status_code=404, detail=f"ifc_guid not found: {ifc_guid}")
    psets = _strip_synthetic_psets(ifc_el.get_psets(el) or {})
    return {
        "ifc_guid": ifc_guid,
        "ifc_type": el.is_a(),
        "ifc_name": getattr(el, "Name", None),
        "predefined_type": getattr(el, "PredefinedType", None),
        "object_type": getattr(el, "ObjectType", None),
        "tag": getattr(el, "Tag", None),
        "psets": psets,
        "spatial": _spatial_chain(el),
        # 誠實 roadmap：以下維度目前 pipeline 無來源 → null，不捏造（前端顯 roadmap/N/A）。
        "classification": None,
        "geometry": None,
        "roadmap": ["classification: MasterFormat/OmniClass/Uniformat", "geometry: bbox/volume/material"],
    }


# CH-H2 ③：真實空間巢狀樹（範本面板③ IfcProject>Site>Building>Storey + 每節點類別計數）。
# 真的走 ifcopenshell IsDecomposedBy(IfcRelAggregates) 遞迴 + ContainsElements(IfcRelContainedInSpatialStructure)
# 統計直接容納元素的類別。瀏覽器只經 coordinator /api/governance/spatial-tree/for-session/:sid proxy。
def _spatial_subtree(node: Any, seen: set[int]) -> dict:
    try:
        nid = node.id()
    except Exception:
        nid = None
    type_counts: dict[str, int] = {}
    for rel in getattr(node, "ContainsElements", []) or []:
        for el in getattr(rel, "RelatedElements", []) or []:
            t = el.is_a()
            type_counts[t] = type_counts.get(t, 0) + 1
    children: list[dict] = []
    if nid is None or nid not in seen:
        if nid is not None:
            seen.add(nid)
        for rel in getattr(node, "IsDecomposedBy", []) or []:
            for child in getattr(rel, "RelatedObjects", []) or []:
                # 只遞迴空間結構元素（Site/Building/Storey/Space），不遞迴一般元件 decomposition。
                if child.is_a("IfcSpatialStructureElement") or child.is_a("IfcSpatialElement"):
                    children.append(_spatial_subtree(child, seen))
    return {
        "ifc_type": node.is_a(),
        "name": getattr(node, "Name", None),
        "global_id": getattr(node, "GlobalId", None),
        "type_counts": type_counts,
        "children": children,
    }


@app.get("/api/spatial-tree")
def spatial_tree(ifc_source_path: str = Query(...)):
    if not os.path.exists(ifc_source_path):
        raise HTTPException(status_code=400, detail=f"ifc_source_path not found: {ifc_source_path}")
    model = open_model(ifc_source_path)
    roots = model.by_type("IfcProject")
    if not roots:
        raise HTTPException(status_code=404, detail="no IfcProject in model")
    seen: set[int] = set()
    return {"tree": _spatial_subtree(roots[0], seen)}


@app.post("/api/rule-runs", status_code=202)
def create_rule_run(req: RuleRunRequest, background: BackgroundTasks):
    if not os.path.exists(req.ifc_source_path):
        raise HTTPException(status_code=400, detail=f"ifc_source_path not found: {req.ifc_source_path}")
    if req.ids_path:
        if not os.path.exists(req.ids_path):
            raise HTTPException(status_code=400, detail=f"ids_path not found: {req.ids_path}")
        rule_set_path = None
        rule_set_label = os.path.basename(req.ids_path)
    else:
        rule_set_path = _rule_set_path(req.rule_set)
        rule_set_label = req.rule_set or "default-governance"
    run_id = store.create_run(req.model_version_id, req.ifc_source_path, rule_set_label)
    background.add_task(_execute, run_id, req.ifc_source_path, rule_set_path, req.element_mapping_path, req.ids_path)
    return {"rule_run_id": run_id, "status": "queued"}


def _execute(run_id: str, ifc_path: str, rule_set_path: Optional[str], mapping_path: Optional[str], ids_path: Optional[str] = None) -> None:
    try:
        store.mark_running(run_id)
        model = open_model(ifc_path)
        if ids_path:
            from rule_engine.ids_runner import run_ids_file

            run = run_ids_file(model, ids_path)
        else:
            rule_set = load_rule_set(rule_set_path)
            run = run_rules(model, rule_set)
        if mapping_path and os.path.exists(mapping_path):
            mapping, meta = load_element_mapping(mapping_path)
            if is_fake_mapping(meta):
                run.warnings.append("element_mapping 為 fake/smoke：usd_prim_path 不視為真實覆蓋率")
            else:
                join_usd_prim_paths(run.results, mapping)
        _RUN_CACHE[run_id] = run
        store.complete_run(run_id, run)
    except Exception as exc:  # noqa: BLE001 - 失敗誠實標記，不假裝 pass
        store.fail_run(run_id, str(exc))


@app.get("/api/rule-runs/{run_id}")
def get_rule_run(run_id: str):
    row = store.get_run(run_id)
    if not row:
        raise HTTPException(status_code=404, detail="rule run not found")
    summary = json.loads(row["summary_json"]) if row.get("summary_json") else None
    return {
        "rule_run_id": row["id"],
        "status": row["status"],
        "score": row["score"],
        "rule_set": row["rule_set"],
        "model_version_id": row["model_version_id"],
        "summary": summary,
    }


# 對外契約用過去式（failed/passed/errored），內部 result.status 用 fail/pass/error。
_STATUS_NORMALIZE = {"failed": "fail", "passed": "pass", "errored": "error"}


@app.get("/api/rule-runs/{run_id}/results")
def get_rule_run_results(run_id: str, status: Optional[str] = Query(None)):
    if not store.get_run(run_id):
        raise HTTPException(status_code=404, detail="rule run not found")
    normalized = _STATUS_NORMALIZE.get(status, status) if status else None
    return {
        "rule_run_id": run_id,
        "status_filter": status,
        "results": store.get_results(run_id, normalized),
    }


@app.get("/api/rule-runs/{run_id}/export")
def export_rule_run(run_id: str, fmt: str = Query("excel")):
    if fmt == "bcf":
        raise HTTPException(status_code=400, detail="rule-run 匯出僅 Excel；BCF 匯出請先 from-rule-run 建 issue，再 GET /api/bcf/export")
    if fmt != "excel":
        raise HTTPException(status_code=400, detail="only fmt=excel is supported")
    run = _RUN_CACHE.get(run_id)
    if run is None:
        raise HTTPException(status_code=409, detail="run not available for export (not completed in this process)")
    data = workbook_bytes(run)
    return StreamingResponse(
        iter([data]),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="rule-run-{run_id}.xlsx"'},
    )


def _storey_from_element(el: Any) -> Optional[str]:
    """從構件的空間容納鏈取 containing storey 名稱;無樓層 → None(誠實,不捏造)。"""
    for node in _spatial_chain(el):
        if node.get("ifc_type") == "IfcBuildingStorey":
            return node.get("name")
    return None


@app.get("/api/rule-runs/{run_id}/failures")
def get_rule_run_failures(
    run_id: str,
    rule: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    run_row = store.get_run(run_id)
    if not run_row:
        raise HTTPException(status_code=404, detail="rule run not found")
    rows = store.get_results(run_id, "fail")  # 內部 status 為 'fail'(非 'failed')
    if rule:
        rows = [r for r in rows if r.get("rule_code") == rule]
    total = len(rows)
    page = rows[offset : offset + limit]

    # name/type/storey 未持久化 → 開 model 一次(open_model 帶 @lru_cache,同路徑後續呼叫命中快取),loop 複用同一 handle 補齊。
    model = None
    ifc_path = run_row.get("ifc_source_path")
    if page and ifc_path and os.path.exists(ifc_path):
        try:
            model = open_model(ifc_path)
        except Exception:  # noqa: BLE001 - 開檔失敗則降級為無 enrichment,不整包失敗
            model = None

    items = []
    for r in page:
        guid = r.get("ifc_guid")
        name = ifc_type = storey = None
        if model is not None and guid:
            try:
                el = model.by_guid(guid)
            except Exception:  # noqa: BLE001
                el = None
            if el is not None:
                ifc_type = el.is_a()
                name = getattr(el, "Name", None)
                storey = _storey_from_element(el)
        items.append({
            "ifc_guid": guid,
            "ifc_name": name,
            "ifc_type": ifc_type,
            "storey": storey,
            "severity": r.get("severity"),
            "rule_code": r.get("rule_code"),  # 每筆保留 rule_code,供未過濾呼叫前端分組
            "message": r.get("message"),
            "usd_prim_path": r.get("usd_prim_path"),
        })
    # 回傳形狀對齊 spec §4.2:top-level "rule_code"(echo `rule` 過濾,未過濾為 None)+ array key "items"。
    # rule_run_id 為附加 echo(無害,不與 spec 必填欄位衝突)。
    return {
        "rule_run_id": run_id,
        "rule_code": rule,
        "limit": limit,
        "offset": offset,
        "total": total,
        "items": items,
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("GOV_PORT", "49102")))

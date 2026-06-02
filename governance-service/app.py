"""governance-service — A1 BIM 治理與模型檢核 rule-run authority。

FastAPI，綁定 127.0.0.1:49102（loopback only，鏡像 host_native_conversion_service 模式）。
瀏覽器永不直連本服務；一律經 coordinator :8004 的 /api/governance/* proxy。

邊界與誠實守則：
- 純 CPU、host-native ifcopenshell；不需 GPU / Kit。
- ifctester / IDS-XML 匯入未安裝 → /health 誠實回報 ifctester=false；IDS 為 p1 後續。
- BCF 匯出（issue -> .bcfzip）為 p15（bcf 模組未安裝 + LGPL 閘門），本切片只提供 Excel。
"""
from __future__ import annotations

import glob
import importlib.util
import json
import os
from typing import Optional

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


@app.get("/health")
def health():
    return {
        "service": "governance-service",
        "status": "ok",
        "ifcopenshell": importlib.util.find_spec("ifcopenshell") is not None,
        # 誠實回報：ifctester 未安裝；IDS-XML 匯入為 p1 後續
        "ifctester": importlib.util.find_spec("ifctester") is not None,
        "rule_sets": [
            os.path.splitext(os.path.basename(p))[0]
            for p in sorted(glob.glob(os.path.join(RULES_DIR, "*.yaml")))
        ],
    }


@app.post("/api/rule-runs", status_code=202)
def create_rule_run(req: RuleRunRequest, background: BackgroundTasks):
    rule_set_path = _rule_set_path(req.rule_set)
    if not os.path.exists(req.ifc_source_path):
        raise HTTPException(status_code=400, detail=f"ifc_source_path not found: {req.ifc_source_path}")
    run_id = store.create_run(req.model_version_id, req.ifc_source_path, req.rule_set or "default-governance")
    background.add_task(_execute, run_id, req.ifc_source_path, rule_set_path, req.element_mapping_path)
    return {"rule_run_id": run_id, "status": "queued"}


def _execute(run_id: str, ifc_path: str, rule_set_path: str, mapping_path: Optional[str]) -> None:
    try:
        store.mark_running(run_id)
        model = open_model(ifc_path)
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
        raise HTTPException(status_code=501, detail="BCF export 為 p15（bcf 模組未安裝 + LGPL 閘門）")
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


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("GOV_PORT", "49102")))

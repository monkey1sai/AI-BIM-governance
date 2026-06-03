"""A3 cross-discipline federation REST（APIRouter，掛入 governance-service app）。"""
from __future__ import annotations

import os
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .builder import build_federated_usda, open_federated_prim_paths
from .coords import validate_coords

_SERVICE_ROOT = os.path.dirname(os.path.dirname(__file__))
_DB_PATH = os.environ.get("GOV_DB_PATH", os.path.join(_SERVICE_ROOT, "storage", "governance.db"))
_FED_OUT = os.environ.get("GOV_FED_OUT", os.path.join(_SERVICE_ROOT, "storage", "federated"))

router = APIRouter()
_store = None


def _consistent_coords(report: dict) -> tuple[str, Optional[float]]:
    """從一致的 validate_coords 報告抽出唯一的 (up_axis, meters_per_unit)。

    只在 report["consistent"] is True 時呼叫；此時所有 member 的 up_axis / meters_per_unit
    皆相同，取任一筆即代表全體。無法解析時退回 ("Z", None) 由 builder 自行處理。
    """
    members = report.get("members") or {}
    for entry in members.values():
        if not isinstance(entry, dict) or "error" in entry:
            continue
        up = str(entry.get("up_axis") or "Z")
        up_axis = "Z" if up.upper().endswith("Z") else "Y"
        mpu = entry.get("meters_per_unit")
        return up_axis, (float(mpu) if mpu is not None else None)
    return "Z", None


def _get_store():
    global _store
    path = os.environ.get("GOV_DB_PATH", _DB_PATH)
    if _store is None or _store.db_path != path:
        from .store import FederationStore

        _store = FederationStore(path)
    return _store


class SetRequest(BaseModel):
    name: str
    project_id: Optional[str] = None


class MemberRequest(BaseModel):
    model_version_id: str
    discipline: str
    usd_path: str
    layer_order: int = 0
    visibility_default: bool = True
    root_prim: Optional[str] = None
    transform_json: Optional[str] = None


@router.post("/api/federated-sets", status_code=201)
def create_set(req: SetRequest):
    return {"set_id": _get_store().create_set(req.name, req.project_id), "status": "draft"}


@router.post("/api/federated-sets/{set_id}/members", status_code=201)
def add_member(set_id: str, req: MemberRequest):
    store = _get_store()
    if not store.get_set(set_id):
        raise HTTPException(status_code=404, detail="federation set not found")
    if not os.path.exists(req.usd_path):
        raise HTTPException(status_code=400, detail=f"member usd_path not found: {req.usd_path}")
    member_id = store.add_member(
        set_id, req.model_version_id, req.discipline, req.usd_path, req.layer_order,
        req.visibility_default, req.root_prim, req.transform_json,
    )
    return {"member_id": member_id}


@router.get("/api/federated-sets/{set_id}")
def get_set(set_id: str):
    store = _get_store()
    row = store.get_set(set_id)
    if not row:
        raise HTTPException(status_code=404, detail="federation set not found")
    return {"set": row, "members": store.get_members(set_id)}


@router.post("/api/federated-sets/{set_id}/validate-coords")
def validate_set_coords(set_id: str):
    store = _get_store()
    if not store.get_set(set_id):
        raise HTTPException(status_code=404, detail="federation set not found")
    members = store.get_members(set_id)
    if not members:
        raise HTTPException(status_code=400, detail="no members to validate")
    return validate_coords(members)


@router.get("/api/federated-sets/{set_id}/review-room")
def review_room(set_id: str):
    """產出 Review Room handoff descriptor：把已 build 的 federated stage 以 viewer 消費的
    stage_composition（primary + secondary_layers）形式交給 host-native Kit review session。

    誠實邊界：governance-service 為 CPU loopback，不啟動 GPU 串流；本端點只給「要載入什麼」，
    實際 WebRTC 串流由 host-native Kit + coordinator session 負責。
    """
    store = _get_store()
    row = store.get_set(set_id)
    if not row:
        raise HTTPException(status_code=404, detail="federation set not found")
    usda = row.get("build_usda_path")
    ready = bool(usda) and os.path.exists(usda)
    if not ready:
        return {
            "set_id": set_id,
            "ready": False,
            "stage_url": None,
            "stage_composition": None,
            "note": "尚未 build；請先 POST …/build 產出 federated_review.usda 再開 Review Room。",
        }
    stage_url = os.path.abspath(usda).replace("\\", "/")
    members = store.get_members(set_id)
    return {
        "set_id": set_id,
        "ready": True,
        "stage_url": stage_url,
        # 與 viewer streamConfig.stage_composition 同形：primary 即 federated_review.usda
        # （已 sublayer 疊合所有 member），故 secondary_layers 留空。
        "stage_composition": {
            "primary": {"url": stage_url, "name": "federated_review", "discipline": "FED"},
            "secondary_layers": [],
        },
        "members": [
            {"discipline": m["discipline"], "usd_path": m["usd_path"], "layer_order": m["layer_order"]}
            for m in members
        ],
        "note": (
            "把此 stage_composition 交給 host-native Kit review session 載入 federated_review.usda"
            "（已疊合所有 member）。governance-service 為 CPU loopback，不啟動 GPU 串流。"
        ),
    }


@router.post("/api/federated-sets/{set_id}/build")
def build_set(set_id: str):
    store = _get_store()
    if not store.get_set(set_id):
        raise HTTPException(status_code=404, detail="federation set not found")
    members = store.get_members(set_id)
    if len(members) < 2:
        raise HTTPException(status_code=400, detail="federation 需至少 2 個 member")
    for m in members:
        if not os.path.exists(m["usd_path"]):
            raise HTTPException(status_code=400, detail=f"member usd missing: {m['usd_path']}")
    # build 前先驗證共享坐標系；upAxis / metersPerUnit 不一致時拒絕（A3-4 / A3-3），
    # 不得靜默把 Y-up member 宣告成 Z-up，也不得硬編 upAxis=Z 或讓單位回退 0.01。
    coord_report = validate_coords(members)
    if not coord_report["consistent"]:
        raise HTTPException(
            status_code=409,
            detail={
                "error": "coordinate systems inconsistent; federate aborted",
                "issues": coord_report["issues"],
                "members": coord_report["members"],
            },
        )
    up_axis, meters_per_unit = _consistent_coords(coord_report)
    fed_out = os.environ.get("GOV_FED_OUT", _FED_OUT)
    out_path = os.path.join(fed_out, set_id, "federated_review.usda")
    # 把驗證後一致的 upAxis / metersPerUnit 傳給 builder，不硬編 Z（A3-4），
    # 並顯式保留 member 的 metersPerUnit，避免回退 0.01（A3-3）。
    result = build_federated_usda(
        members, out_path, up_axis=up_axis, meters_per_unit=meters_per_unit
    )
    store.set_build_result(set_id, result["usda_path"])
    result["prim_sample"] = open_federated_prim_paths(result["usda_path"], limit=30)
    return result

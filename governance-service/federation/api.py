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
    fed_out = os.environ.get("GOV_FED_OUT", _FED_OUT)
    out_path = os.path.join(fed_out, set_id, "federated_review.usda")
    result = build_federated_usda(members, out_path)
    store.set_build_result(set_id, result["usda_path"])
    result["prim_sample"] = open_federated_prim_paths(result["usda_path"], limit=30)
    return result

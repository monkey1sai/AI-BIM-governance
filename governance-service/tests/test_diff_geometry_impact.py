"""A2 followup — geometry_changed signature（真實幾何）+ issue-impact 交叉比對。"""
from __future__ import annotations

import importlib
import os

import ifcopenshell
import ifcopenshell.guid
import pytest
from fastapi.testclient import TestClient

from diff_engine.geometry import geometry_hash, geometry_signature

REAL_IFC = r"C:\Repos\active\iot\AI-BIM-governance\storage\許良宇圖書館建築_2026.ifc"


@pytest.mark.skipif(not os.path.exists(REAL_IFC), reason="real IFC absent")
def test_geometry_signature_real_geometry():
    m = ifcopenshell.open(REAL_IFC)
    walls = [w for w in m.by_type("IfcWall") if getattr(w, "Representation", None)][:6]
    sigs = [geometry_signature(w) for w in walls]
    sigs = [s for s in sigs if s]
    assert len(sigs) >= 2, "real walls should yield geometry signatures"
    # 每個 signature 有真實 bbox + vertex_count
    assert all("bbox_min" in s and s["vertex_count"] > 0 for s in sigs)
    # 決定性：同一構件兩次 hash 相同
    w0 = walls[0]
    assert geometry_hash(w0) == geometry_hash(w0)
    # 區分性：不同幾何的構件至少有兩個不同 hash
    hashes = {geometry_hash(w) for w in walls if geometry_hash(w)}
    assert len(hashes) >= 2


def test_geometry_no_representation_returns_none():
    f = ifcopenshell.file(schema="IFC4")
    wall = f.create_entity("IfcWall", GlobalId=ifcopenshell.guid.new(), Name="no-geom")
    assert geometry_signature(wall) is None
    assert geometry_hash(wall) is None


# ---- issue-impact ----

@pytest.fixture()
def client_and_db(tmp_path, monkeypatch):
    db_path = str(tmp_path / "gov.db")
    monkeypatch.setenv("GOV_DB_PATH", db_path)
    import app as app_module

    importlib.reload(app_module)
    return TestClient(app_module.app), db_path


def test_diff_issue_impact_classification(client_and_db):
    client, db_path = client_and_db
    from diff_engine.models import DiffItem, DiffResult
    from diff_engine.store import DiffStore
    from issues.store import IssueStore

    # 兩個 base-mv 的 issue：G1（之後在 diff 中變更）、G2（未變更）
    iss = IssueStore(db_path)
    iss.create_issue(title="i1", ifc_guid="G1", model_version_id="mvA", source_type="rule_result")
    iss.create_issue(title="i2", ifc_guid="G2", model_version_id="mvA", source_type="rule_result")

    # diff（base mvA）：G1 moved、G3 added
    ds = DiffStore(db_path)
    did = ds.create_diff("mvA", "mvB", "b.ifc", "t.ifc")
    items = [
        DiffItem(change_type="moved", ifc_guid="G1", ifc_type="IfcWall", ifc_name="W1", change_summary="moved"),
        DiffItem(change_type="added", ifc_guid="G3", ifc_type="IfcWall", ifc_name="W3", change_summary="added"),
    ]
    ds.complete_diff(did, DiffResult(base_count=2, target_count=3, matched=2, counts={"moved": 1, "added": 1}, items=items))

    resp = client.get(f"/api/diffs/{did}/issue-impact")
    assert resp.status_code == 200
    body = resp.json()
    assert body["possibly_addressed"]["count"] == 1  # G1 的 issue（其構件 moved）
    assert body["still_open"]["count"] == 1  # G2 的 issue（未變更）
    assert body["new"]["count"] == 1  # G3 added 且無既有 issue
    assert "啟發式" in body["note"]  # 誠實標示 heuristic

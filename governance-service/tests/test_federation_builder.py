"""A3 federation 驗證 — 合成 USD member（pxr）→ sublayer 疊合 + 座標驗證。

證明：subLayer 順序正確、member usdc byte 不變（immutable）、federated stage 疊進
member 內容、可見度 override 非破壞性、座標系不一致可偵測。
"""
from __future__ import annotations

import hashlib
import os

from pxr import Usd, UsdGeom

from federation import build_federated_usda, open_federated_prim_paths, validate_coords


def _fwd(p) -> str:
    return str(p).replace("\\", "/")


def _member(path: str, disc: str, up: str = "Z", mpu: float = 0.001) -> str:
    path = _fwd(path)
    stage = Usd.Stage.CreateNew(path)
    UsdGeom.SetStageUpAxis(stage, UsdGeom.Tokens.z if up == "Z" else UsdGeom.Tokens.y)
    UsdGeom.SetStageMetersPerUnit(stage, mpu)
    world = stage.DefinePrim("/World", "Xform")
    stage.SetDefaultPrim(world)
    UsdGeom.Xform.Define(stage, f"/World/{disc}")
    UsdGeom.Cube.Define(stage, f"/World/{disc}/Box")
    stage.GetRootLayer().Save()
    return path


def _sha(p: str) -> str:
    with open(p, "rb") as fh:
        return hashlib.sha1(fh.read()).hexdigest()


def test_sublayer_order_and_member_immutability(tmp_path):
    arc = _member(_fwd(tmp_path / "arc.usda"), "ARC")
    strr = _member(_fwd(tmp_path / "str.usda"), "STR")
    before = {arc: _sha(arc), strr: _sha(strr)}
    members = [
        {"usd_path": strr, "discipline": "STR", "layer_order": 2, "root_prim": "/World/STR", "visibility_default": True},
        {"usd_path": arc, "discipline": "ARC", "layer_order": 1, "root_prim": "/World/ARC", "visibility_default": True},
    ]
    res = build_federated_usda(members, _fwd(tmp_path / "federated_review.usda"))
    assert os.path.exists(res["usda_path"])
    # layer_order 1 (ARC) 為最強 → subLayerPaths[0]
    assert res["sublayer_order"][0].endswith("arc.usda")
    assert res["sublayer_order"][1].endswith("str.usda")
    assert res["member_count"] == 2
    # member usdc immutable
    assert _sha(arc) == before[arc] and _sha(strr) == before[strr]
    # federated stage 疊進兩 member 內容
    paths = open_federated_prim_paths(res["usda_path"])
    assert "/World/ARC" in paths and "/World/STR" in paths


def test_visibility_override_is_non_destructive(tmp_path):
    arc = _member(_fwd(tmp_path / "arc.usda"), "ARC")
    strr = _member(_fwd(tmp_path / "str.usda"), "STR")
    before = _sha(strr)
    members = [
        {"usd_path": arc, "discipline": "ARC", "layer_order": 1, "root_prim": "/World/ARC", "visibility_default": True},
        {"usd_path": strr, "discipline": "STR", "layer_order": 2, "root_prim": "/World/STR", "visibility_default": False},
    ]
    res = build_federated_usda(members, _fwd(tmp_path / "fed.usda"))
    assert "/World/STR" in res["hidden"]
    assert _sha(strr) == before  # member 未被改
    stage = Usd.Stage.Open(res["usda_path"])
    vis = UsdGeom.Imageable(stage.GetPrimAtPath("/World/STR")).ComputeVisibility()
    assert vis == UsdGeom.Tokens.invisible


def test_coord_validation_detects_mismatch(tmp_path):
    arc = _member(_fwd(tmp_path / "arc.usda"), "ARC", up="Z", mpu=0.001)
    strr = _member(_fwd(tmp_path / "str.usda"), "STR", up="Y", mpu=0.01)
    report = validate_coords([
        {"usd_path": arc, "discipline": "ARC"},
        {"usd_path": strr, "discipline": "STR"},
    ])
    assert report["consistent"] is False
    assert any("up_axis" in i for i in report["issues"])


def test_coord_validation_consistent(tmp_path):
    arc = _member(_fwd(tmp_path / "a.usda"), "ARC")
    strr = _member(_fwd(tmp_path / "b.usda"), "STR")
    report = validate_coords([
        {"usd_path": arc, "discipline": "ARC"},
        {"usd_path": strr, "discipline": "STR"},
    ])
    assert report["consistent"] is True

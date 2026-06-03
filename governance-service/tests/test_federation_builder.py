"""A3 federation 驗證 — 合成 USD member（pxr）→ sublayer 疊合 + 座標驗證。

證明：subLayer 順序正確、member usdc byte 不變（immutable）、federated stage 疊進
member 內容、可見度 override 非破壞性、座標系不一致可偵測。
"""
from __future__ import annotations

import hashlib
import json
import os

from pxr import Gf, Usd, UsdGeom

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


# ---- F5: per-member transform（root layer over，member immutable）----

def _member_with_local_translate(path: str, disc: str, local_xyz) -> str:
    """member root prim 自帶 local transform，用來證明 federation transform 不會 clobber 它。"""
    path = _fwd(path)
    stage = Usd.Stage.CreateNew(path)
    UsdGeom.SetStageUpAxis(stage, UsdGeom.Tokens.z)
    UsdGeom.SetStageMetersPerUnit(stage, 0.001)
    world = stage.DefinePrim("/World", "Xform")
    stage.SetDefaultPrim(world)
    arc = UsdGeom.Xform.Define(stage, f"/World/{disc}")
    arc.AddTranslateOp().Set(Gf.Vec3d(*local_xyz))
    UsdGeom.Cube.Define(stage, f"/World/{disc}/Box")
    stage.GetRootLayer().Save()
    return path


def test_per_member_transform_composes_without_clobbering_member(tmp_path):
    # ARC member root 自帶 local transform (10,0,0)；federation 再套 (0,0,5)。
    arc = _member_with_local_translate(_fwd(tmp_path / "arc.usda"), "ARC", (10, 0, 0))
    strr = _member(_fwd(tmp_path / "str.usda"), "STR")
    before = _sha(arc)
    members = [
        {"usd_path": arc, "discipline": "ARC", "layer_order": 1, "root_prim": "/World/ARC",
         "visibility_default": True, "transform_json": json.dumps({"translate": [0, 0, 5]})},
        {"usd_path": strr, "discipline": "STR", "layer_order": 2, "root_prim": "/World/STR",
         "visibility_default": True},
    ]
    res = build_federated_usda(members, _fwd(tmp_path / "fed.usda"))
    # 回傳標示哪個 member 套了哪些 op
    assert any(t["root_prim"] == "/World/ARC" and "translate" in t["ops"] for t in res["transformed"])
    # member usdc immutable（federation 只寫 root layer）
    assert _sha(arc) == before
    # 合成 stage 上 /World/ARC 的 resolved local translation = member(10,0,0) ∘ fed(0,0,5)
    stage = Usd.Stage.Open(res["usda_path"])
    xf = UsdGeom.Xformable(stage.GetPrimAtPath("/World/ARC"))
    t = xf.GetLocalTransformation().ExtractTranslation()
    assert (round(t[0], 3), round(t[1], 3), round(t[2], 3)) == (10.0, 0.0, 5.0)
    # xformOpOrder 同時含 member 自身 op 與 federation :fed op（證明未 clobber）
    order = list(xf.GetXformOpOrderAttr().Get())
    assert "xformOp:translate" in order
    assert any(str(n).endswith(":fed") for n in order)


def test_per_member_transform_rotate_and_scale(tmp_path):
    arc = _member(_fwd(tmp_path / "arc.usda"), "ARC")
    strr = _member(_fwd(tmp_path / "str.usda"), "STR")
    members = [
        {"usd_path": arc, "discipline": "ARC", "layer_order": 1, "root_prim": "/World/ARC",
         "visibility_default": True,
         "transform_json": json.dumps({"translate": [1, 2, 3], "rotateXYZ": [0, 0, 90], "scale": [2, 2, 2]})},
        {"usd_path": strr, "discipline": "STR", "layer_order": 2, "root_prim": "/World/STR",
         "visibility_default": True},
    ]
    res = build_federated_usda(members, _fwd(tmp_path / "fed.usda"))
    applied = next(t["ops"] for t in res["transformed"] if t["root_prim"] == "/World/ARC")
    # translate 必在最後（outermost，標準 TRS）
    assert applied == ["scale", "rotateXYZ", "translate"]
    stage = Usd.Stage.Open(res["usda_path"])
    order = list(UsdGeom.Xformable(stage.GetPrimAtPath("/World/ARC")).GetXformOpOrderAttr().Get())
    assert order[-1].endswith("translate:fed")  # translate 為最外層 op


def test_member_without_transform_has_no_fed_ops(tmp_path):
    arc = _member(_fwd(tmp_path / "arc.usda"), "ARC")
    strr = _member(_fwd(tmp_path / "str.usda"), "STR")
    members = [
        {"usd_path": arc, "discipline": "ARC", "layer_order": 1, "root_prim": "/World/ARC", "visibility_default": True},
        {"usd_path": strr, "discipline": "STR", "layer_order": 2, "root_prim": "/World/STR", "visibility_default": True},
    ]
    res = build_federated_usda(members, _fwd(tmp_path / "fed.usda"))
    assert res["transformed"] == []

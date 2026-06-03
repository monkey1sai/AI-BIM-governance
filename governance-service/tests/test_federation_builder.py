"""A3 federation 驗證 — 合成 USD member（pxr）→ sublayer 疊合 + 座標驗證。

證明：subLayer 順序正確、member usdc byte 不變（immutable）、federated stage 疊進
member 內容、可見度 override 非破壞性、座標系不一致可偵測。
"""
from __future__ import annotations

import hashlib
import json
import os

import pytest
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
    # A3-2：以「真實 pxr 計算的世界座標」驗 TRS 正確性，不只斷言 op 字面順序。
    # rotateXYZ Z=90° 把 +X 轉到 +Y；scale=2 縮放；translate=(1,2,3) 平移。
    # 標準 world=T·R·S：local p → R·S·p 後再 +T（translate 不被 scale/rotate 連帶作用）。
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
    # 加入順序 = translate→rotateXYZ→scale（xformOpOrder 由左至右 least→most local）。
    assert applied == ["translate", "rotateXYZ", "scale"]
    stage = Usd.Stage.Open(res["usda_path"])
    xf = UsdGeom.Xformable(stage.GetPrimAtPath("/World/ARC"))
    m = xf.GetLocalTransformation()
    # local 原點 → 世界 = T（scale/rotate 不影響原點）= (1,2,3)。
    o = m.Transform(Gf.Vec3d(0, 0, 0))
    assert (round(o[0], 3), round(o[1], 3), round(o[2], 3)) == (1.0, 2.0, 3.0)
    # local (1,0,0)：S→(2,0,0)，R(z=90°)→(0,2,0)，T→(1,4,3)。
    p = m.Transform(Gf.Vec3d(1, 0, 0))
    assert (round(p[0], 3), round(p[1], 3), round(p[2], 3)) == (1.0, 4.0, 3.0)
    # xformOpOrder：translate 最外層（list[0]）、scale 最內層（list[-1]）。
    order = [str(n) for n in xf.GetXformOpOrderAttr().Get()]
    assert order[0].endswith("translate:fed")
    assert order[-1].endswith("scale:fed")


def test_per_member_transform_world_coords_scale_then_translate(tmp_path):
    """A3-2 核心：scale=2 + translate=(100,0,0) 下，用真實 pxr 世界座標驗標準 TRS。

    錯誤實作（scale 最外層、translate 最內層）會把 translate 連帶 scale，local 原點落到
    (200,0,0)；正確 world=T·S 應落在 (100,0,0)、local(1,0,0) 落在 (102,0,0)。
    """
    arc = _member(_fwd(tmp_path / "arc.usda"), "ARC")
    strr = _member(_fwd(tmp_path / "str.usda"), "STR")
    members = [
        {"usd_path": arc, "discipline": "ARC", "layer_order": 1, "root_prim": "/World/ARC",
         "visibility_default": True,
         "transform_json": json.dumps({"scale": [2, 2, 2], "translate": [100, 0, 0]})},
        {"usd_path": strr, "discipline": "STR", "layer_order": 2, "root_prim": "/World/STR",
         "visibility_default": True},
    ]
    res = build_federated_usda(members, _fwd(tmp_path / "fed.usda"))
    stage = Usd.Stage.Open(res["usda_path"])
    m = UsdGeom.Xformable(stage.GetPrimAtPath("/World/ARC")).GetLocalTransformation()
    o = m.Transform(Gf.Vec3d(0, 0, 0))
    p = m.Transform(Gf.Vec3d(1, 0, 0))
    # 標準 TRS：translate 不被 scale 放大。
    assert (round(o[0], 3), round(o[1], 3), round(o[2], 3)) == (100.0, 0.0, 0.0)
    assert (round(p[0], 3), round(p[1], 3), round(p[2], 3)) == (102.0, 0.0, 0.0)


def _member_with_local_scale(path: str, disc: str, scale_xyz) -> str:
    """member root prim 自帶 local scale（模擬 IFC→USD 常見的單位 scale），
    xformOpOrder=['xformOp:scale']（無 :fed suffix），用來重現 Codex P1。
    """
    path = _fwd(path)
    stage = Usd.Stage.CreateNew(path)
    UsdGeom.SetStageUpAxis(stage, UsdGeom.Tokens.z)
    UsdGeom.SetStageMetersPerUnit(stage, 0.001)
    world = stage.DefinePrim("/World", "Xform")
    stage.SetDefaultPrim(world)
    arc = UsdGeom.Xform.Define(stage, f"/World/{disc}")
    arc.AddScaleOp().Set(Gf.Vec3f(*scale_xyz))  # member 既有 scale op
    UsdGeom.Cube.Define(stage, f"/World/{disc}/Box")
    stage.GetRootLayer().Save()
    return path


def test_federation_transform_outermost_when_member_has_existing_ops(tmp_path):
    """Codex P1 回歸：member 自帶 xformOp:scale=2 時，federation translate=(100,0,0)
    SHALL 為最外層（不被 member scale 連帶放大）。

    錯誤實作（federation op append 到 member 既有 op 之後 = 最內層）會讓 member scale 連帶
    放大 federation translate，local 原點落 (200,0,0)；正確（federation 最外層）應落 (100,0,0)，
    且 member scale 仍作用在幾何上，故 local (1,0,0) 落 (102,0,0)。
    """
    arc = _member_with_local_scale(_fwd(tmp_path / "arc.usda"), "ARC", (2, 2, 2))
    strr = _member(_fwd(tmp_path / "str.usda"), "STR")
    before = _sha(arc)
    members = [
        {"usd_path": arc, "discipline": "ARC", "layer_order": 1, "root_prim": "/World/ARC",
         "visibility_default": True,
         "transform_json": json.dumps({"translate": [100, 0, 0]})},
        {"usd_path": strr, "discipline": "STR", "layer_order": 2, "root_prim": "/World/STR",
         "visibility_default": True},
    ]
    res = build_federated_usda(members, _fwd(tmp_path / "fed.usda"), meters_per_unit=0.001)
    # member usdc immutable（federation 只寫 root layer，從不開 member 檔寫入）
    assert _sha(arc) == before
    stage = Usd.Stage.Open(res["usda_path"])
    xf = UsdGeom.Xformable(stage.GetPrimAtPath("/World/ARC"))
    order = [str(n) for n in xf.GetXformOpOrderAttr().Get()]
    # federation translate:fed 在最外層（list[0]），member 既有 scale 在最內層（list[-1]）。
    assert order[0].endswith("translate:fed")
    assert order[-1] == "xformOp:scale"  # member 既有 op 仍保留（未 clobber）
    m = xf.GetLocalTransformation()
    o = m.Transform(Gf.Vec3d(0, 0, 0))
    p = m.Transform(Gf.Vec3d(1, 0, 0))
    # federation translate 不被 member scale 放大：原點落 (100,0,0)，而非 (200,0,0)。
    assert (round(o[0], 3), round(o[1], 3), round(o[2], 3)) == (100.0, 0.0, 0.0)
    # member scale=2 仍作用在幾何：local(1,0,0)→(2,0,0)，再 federation +100 →(102,0,0)。
    assert (round(p[0], 3), round(p[1], 3), round(p[2], 3)) == (102.0, 0.0, 0.0)


def test_federation_transform_full_trs_with_member_existing_scale(tmp_path):
    """Codex P1 延伸：member 自帶 scale=2 + federation 完整 TRS（translate/rotateXYZ/scale）。

    federation 三 op 仍維持自身標準 TRS（translate 最外、scale 最內），整組 federation 變換
    為最外層、member 既有 scale 為最內層。驗世界座標與 op 排序。
    """
    arc = _member_with_local_scale(_fwd(tmp_path / "arc.usda"), "ARC", (2, 2, 2))
    strr = _member(_fwd(tmp_path / "str.usda"), "STR")
    members = [
        {"usd_path": arc, "discipline": "ARC", "layer_order": 1, "root_prim": "/World/ARC",
         "visibility_default": True,
         "transform_json": json.dumps({"translate": [1, 2, 3], "rotateXYZ": [0, 0, 90], "scale": [1, 1, 1]})},
        {"usd_path": strr, "discipline": "STR", "layer_order": 2, "root_prim": "/World/STR",
         "visibility_default": True},
    ]
    res = build_federated_usda(members, _fwd(tmp_path / "fed.usda"), meters_per_unit=0.001)
    stage = Usd.Stage.Open(res["usda_path"])
    xf = UsdGeom.Xformable(stage.GetPrimAtPath("/World/ARC"))
    order = [str(n) for n in xf.GetXformOpOrderAttr().Get()]
    # federation 三 :fed op 在前（translate 最外、scale 最內），member 既有 scale 在最末（最內層）。
    assert order[0].endswith("translate:fed")
    assert order[1].endswith("rotateXYZ:fed")
    assert order[2].endswith("scale:fed")
    assert order[-1] == "xformOp:scale"  # member 既有 op 保留在最內層
    m = xf.GetLocalTransformation()
    # local 原點 → 世界 = federation T = (1,2,3)（不被 member scale 連帶）。
    o = m.Transform(Gf.Vec3d(0, 0, 0))
    assert (round(o[0], 3), round(o[1], 3), round(o[2], 3)) == (1.0, 2.0, 3.0)
    # local (1,0,0)：member scale=2 →(2,0,0)，fed R(z90)→(0,2,0)，fed T→(1,4,3)。
    p = m.Transform(Gf.Vec3d(1, 0, 0))
    assert (round(p[0], 3), round(p[1], 3), round(p[2], 3)) == (1.0, 4.0, 3.0)


def _member_with_reset_and_scale(path: str, disc: str, scale_xyz) -> str:
    """member root prim 帶 `!resetXformStack!` + scale op，xformOpOrder=
    ['!resetXformStack!', 'xformOp:scale']，用來重現 Codex P1 二次（reset token）。

    `!resetXformStack!` 合法且常見（重置繼承自父層的變換）。SetResetXformStack(True) 會把該
    token 放到 xformOpOrder 的 index 0。
    """
    path = _fwd(path)
    stage = Usd.Stage.CreateNew(path)
    UsdGeom.SetStageUpAxis(stage, UsdGeom.Tokens.z)
    UsdGeom.SetStageMetersPerUnit(stage, 0.001)
    world = stage.DefinePrim("/World", "Xform")
    stage.SetDefaultPrim(world)
    arc = UsdGeom.Xform.Define(stage, f"/World/{disc}")
    arc.AddScaleOp().Set(Gf.Vec3f(*scale_xyz))  # member 既有 scale op
    arc.SetResetXformStack(True)  # 於 index 0 放入 !resetXformStack!
    UsdGeom.Cube.Define(stage, f"/World/{disc}/Box")
    stage.GetRootLayer().Save()
    return path


def test_federation_transform_applies_when_member_has_reset_xform_stack(tmp_path):
    """Codex P1 二次回歸：member 既有 xformOpOrder 以 `!resetXformStack!` 開頭時，federation
    translate=(100,0,0) SHALL 仍然套用。

    `!resetXformStack!` 是 USD 特殊 token，**只在 index 0 才生效**（重置繼承自父層的變換）。
    錯誤實作（把 fed ops 一律塞到最前）會變成 ['xformOp:translate:fed', '!resetXformStack!',
    'xformOp:scale'] → reset 不在第一位 → USD 忽略它前面的 fed ops → federation translate 完全
    沒套用（真 pxr 重現：原點停留 (0,0,0)）。正確修法：保留 leading reset 在 index 0、fed ops
    插在 reset 之後，使原點落 (100,0,0)；member scale=2 仍作用，故 local(1,0,0) 落 (102,0,0)。
    """
    arc = _member_with_reset_and_scale(_fwd(tmp_path / "arc.usda"), "ARC", (2, 2, 2))
    strr = _member(_fwd(tmp_path / "str.usda"), "STR")
    before = _sha(arc)
    members = [
        {"usd_path": arc, "discipline": "ARC", "layer_order": 1, "root_prim": "/World/ARC",
         "visibility_default": True,
         "transform_json": json.dumps({"translate": [100, 0, 0]})},
        {"usd_path": strr, "discipline": "STR", "layer_order": 2, "root_prim": "/World/STR",
         "visibility_default": True},
    ]
    res = build_federated_usda(members, _fwd(tmp_path / "fed.usda"), meters_per_unit=0.001)
    # member usdc immutable（federation 只寫 root layer，從不開 member 檔寫入）
    assert _sha(arc) == before
    stage = Usd.Stage.Open(res["usda_path"])
    xf = UsdGeom.Xformable(stage.GetPrimAtPath("/World/ARC"))
    order = [str(n) for n in xf.GetXformOpOrderAttr().Get()]
    # !resetXformStack! 保留在 index 0；fed translate 緊接其後；member 既有 scale 在最內層。
    assert order[0] == "!resetXformStack!"
    assert order[1].endswith("translate:fed")
    assert order[-1] == "xformOp:scale"  # member 既有 op 仍保留（未 clobber）
    # reset 語意保留（仍重置繼承自父層的變換）。
    assert xf.GetResetXformStack() is True
    m = xf.GetLocalTransformation()
    o = m.Transform(Gf.Vec3d(0, 0, 0))
    p = m.Transform(Gf.Vec3d(1, 0, 0))
    # federation translate 真的套用（非錯誤實作的 (0,0,0)）：原點落 (100,0,0)。
    assert (round(o[0], 3), round(o[1], 3), round(o[2], 3)) == (100.0, 0.0, 0.0)
    # member scale=2 仍作用在幾何：local(1,0,0)→(2,0,0)，再 federation +100 →(102,0,0)。
    assert (round(p[0], 3), round(p[1], 3), round(p[2], 3)) == (102.0, 0.0, 0.0)


def test_build_preserves_member_meters_per_unit(tmp_path):
    """A3-3：member metersPerUnit=0.001 時 federated stage SHALL 保留 0.001，不回退 0.01。"""
    arc = _member(_fwd(tmp_path / "arc.usda"), "ARC", mpu=0.001)
    strr = _member(_fwd(tmp_path / "str.usda"), "STR", mpu=0.001)
    members = [
        {"usd_path": arc, "discipline": "ARC", "layer_order": 1, "root_prim": "/World/ARC", "visibility_default": True},
        {"usd_path": strr, "discipline": "STR", "layer_order": 2, "root_prim": "/World/STR", "visibility_default": True},
    ]
    res = build_federated_usda(members, _fwd(tmp_path / "fed.usda"), meters_per_unit=0.001)
    assert res["meters_per_unit"] == pytest.approx(0.001)
    stage = Usd.Stage.Open(res["usda_path"])
    assert UsdGeom.GetStageMetersPerUnit(stage) == pytest.approx(0.001)
    # 對照：不傳 meters_per_unit 會回退 pxr 預設 0.01（差 10 倍），證明傳遞確實有效。
    res2 = build_federated_usda(members, _fwd(tmp_path / "fed2.usda"))
    assert res2["meters_per_unit"] == pytest.approx(0.01)


def test_member_without_transform_has_no_fed_ops(tmp_path):
    arc = _member(_fwd(tmp_path / "arc.usda"), "ARC")
    strr = _member(_fwd(tmp_path / "str.usda"), "STR")
    members = [
        {"usd_path": arc, "discipline": "ARC", "layer_order": 1, "root_prim": "/World/ARC", "visibility_default": True},
        {"usd_path": strr, "discipline": "STR", "layer_order": 2, "root_prim": "/World/STR", "visibility_default": True},
    ]
    res = build_federated_usda(members, _fwd(tmp_path / "fed.usda"))
    assert res["transformed"] == []

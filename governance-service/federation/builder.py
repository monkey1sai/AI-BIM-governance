"""A3 跨專業 Federation — 用 OpenUSD sublayer 把多個 discipline 模型疊在同一 stage。

對齊來源（誠實）：
- NVIDIA Kit 官方 USD 指南：`root_layer.subLayerPaths.append(...)` 疊合多個 USD 檔。
- pxr 26.5 本體 API（ground-truth introspection 驗證）：Sdf.Layer.CreateNew /
  subLayerPaths / Usd.Stage.Open / UsdGeom.SetStageUpAxis / SetDefaultPrim / MakeInvisible。
- USD composition（已對齊 OpenUSD glossary）：sublayer 是 whole-layer 非破壞疊合；其 opinion
  在 LIVERPS 的 **Local（最強）** 步驟解析——subLayerPaths[0] 最強（見下方排序註解）。sublayer
  本身**不是** LIVERPS 七弧（Local/Inherits/VariantSets/Relocates/References/Payload/Specializes）
  之一，也不做 reference/payload 的 namespace 隔離。sessionLayer 為暫態（不持久化），故 federation
  用具名 root layer + N subLayers，不用 sessionLayer 作持久層。member 的 model.usdc
  **永不被開啟寫入（immutable）**。
"""
from __future__ import annotations

import json
import os
from typing import Any, Optional

from pxr import Gf, Usd, UsdGeom


def _usd_ref(path: str) -> str:
    # USD subLayerPaths 用正斜線（跨平台）。
    return os.path.abspath(path).replace("\\", "/")


def _parse_transform(transform_json: Any) -> Optional[dict]:
    """解析 member 的 transform（translate / rotateXYZ / scale，皆 3 元素，皆可選）。"""
    if not transform_json:
        return None
    try:
        data = json.loads(transform_json) if isinstance(transform_json, str) else transform_json
    except (ValueError, TypeError):
        return None
    if not isinstance(data, dict):
        return None
    out: dict = {}
    for key in ("translate", "rotateXYZ", "scale"):
        v = data.get(key)
        if isinstance(v, (list, tuple)) and len(v) == 3:
            try:
                out[key] = [float(x) for x in v]
            except (ValueError, TypeError):
                continue
    return out or None


def _apply_member_transform(stage: Usd.Stage, root_prim: str, ops: dict) -> list[str]:
    """在 root(最強) layer 上對 member root_prim author over + xformOp（member 檔不動）。

    pxr 的 Add*Op 會讀現有（composed）xformOpOrder 再 append，故 member 自身 transform
    完整保留（值仍從 member 弱層解析），federation op 落在 outermost（最後套用）= world 置放。
    依 scale→rotateXYZ→translate 加，使 translate 最外層（標準 TRS）。op 加 `:fed` 命名空間。
    """
    over = stage.OverridePrim(root_prim)
    xf = UsdGeom.Xformable(over)
    applied: list[str] = []
    if "scale" in ops:
        xf.AddScaleOp(opSuffix="fed").Set(Gf.Vec3f(*ops["scale"]))
        applied.append("scale")
    if "rotateXYZ" in ops:
        xf.AddRotateXYZOp(opSuffix="fed").Set(Gf.Vec3f(*ops["rotateXYZ"]))
        applied.append("rotateXYZ")
    if "translate" in ops:
        xf.AddTranslateOp(opSuffix="fed").Set(Gf.Vec3d(*ops["translate"]))
        applied.append("translate")
    return applied


def build_federated_usda(
    members: list[dict[str, Any]],
    out_path: str,
    default_prim: str = "/World",
    up_axis: str = "Z",
) -> dict[str, Any]:
    """以 subLayer 疊合 members 產出 federated_review.usda。

    members: [{usd_path, discipline, layer_order, visibility_default, root_prim?}]
    回傳 subLayer 順序、隱藏清單、defaultPrim / upAxis。members 檔案不被修改。
    """
    ordered = sorted(members, key=lambda m: m.get("layer_order", 0))
    out_path = os.path.abspath(out_path)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    if os.path.exists(out_path):
        os.remove(out_path)

    from pxr import Sdf

    root = Sdf.Layer.CreateNew(out_path)
    # subLayerPaths[0] 為最強（疊在最上）；以 layer_order 升冪排列（值小者較強/在上）。
    for m in ordered:
        root.subLayerPaths.append(_usd_ref(m["usd_path"]))

    stage = Usd.Stage.Open(root)
    UsdGeom.SetStageUpAxis(stage, UsdGeom.Tokens.z if up_axis.upper() == "Z" else UsdGeom.Tokens.y)
    world = stage.OverridePrim(default_prim)  # 非破壞性 over，作 defaultPrim
    stage.SetDefaultPrim(world)

    hidden: list[str] = []
    transformed: list[dict] = []
    for m in ordered:
        root_prim = m.get("root_prim")
        if not root_prim:
            continue
        if not m.get("visibility_default", True):
            # 在 root layer 上 author over visibility=invisible（不動 member 檔）。
            UsdGeom.Imageable(stage.OverridePrim(root_prim)).MakeInvisible()
            hidden.append(root_prim)
        ops = _parse_transform(m.get("transform_json"))
        if ops:
            applied = _apply_member_transform(stage, root_prim, ops)
            if applied:
                transformed.append({"root_prim": root_prim, "ops": applied})

    root.Save()
    return {
        "usda_path": out_path,
        "sublayer_order": [str(p) for p in root.subLayerPaths],
        "member_count": len(ordered),
        "hidden": hidden,
        "transformed": transformed,
        "default_prim": default_prim,
        "up_axis": up_axis,
    }


def open_federated_prim_paths(usda_path: str, limit: int = 50) -> list[str]:
    """開啟 federated stage，回傳前 N 個 prim path（驗證 member 內容有疊進來）。"""
    stage = Usd.Stage.Open(usda_path)
    out: list[str] = []
    for prim in stage.Traverse():
        out.append(str(prim.GetPath()))
        if len(out) >= limit:
            break
    return out

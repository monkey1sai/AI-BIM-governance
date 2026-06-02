"""A3 跨專業 Federation — 用 OpenUSD sublayer 把多個 discipline 模型疊在同一 stage。

對齊來源（誠實）：
- NVIDIA Kit 官方 USD 指南：`root_layer.subLayerPaths.append(...)` 疊合多個 USD 檔。
- pxr 26.5 本體 API（ground-truth introspection 驗證）：Sdf.Layer.CreateNew /
  subLayerPaths / Usd.Stage.Open / UsdGeom.SetStageUpAxis / SetDefaultPrim / MakeInvisible。
- LIVERPS caveat：sublayer 是最弱的 composition arc（適合「不破壞 member 內部 opinion」的
  whole-layer 疊合）；sessionLayer 為暫態（不持久化），故 federation 用具名 root layer + N
  subLayers，不用 sessionLayer 作持久層。member 的 model.usdc **永不被開啟寫入（immutable）**。
"""
from __future__ import annotations

import os
from typing import Any

from pxr import Usd, UsdGeom


def _usd_ref(path: str) -> str:
    # USD subLayerPaths 用正斜線（跨平台）。
    return os.path.abspath(path).replace("\\", "/")


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
    for m in ordered:
        if not m.get("visibility_default", True):
            root_prim = m.get("root_prim")
            if root_prim:
                # 在 root layer 上 author over visibility=invisible（不動 member 檔）。
                UsdGeom.Imageable(stage.OverridePrim(root_prim)).MakeInvisible()
                hidden.append(root_prim)

    root.Save()
    return {
        "usda_path": out_path,
        "sublayer_order": [str(p) for p in root.subLayerPaths],
        "member_count": len(ordered),
        "hidden": hidden,
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

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

    pxr 的 Add*Op 會讀現有（composed）xformOpOrder 再 **append**，故 member 自身 transform
    完整保留（值仍從 member 弱層解析）。但 append 把 federation op 放在 xformOpOrder **末端
    （最內層/most-local）**——當 member 自帶 op（如 IFC→USD 常見的單位 scale / up-axis rotate）
    時，member 既有 op 會排在前面（最外層/least-local），federation 的 translate 反而被 member
    既有 scale/rotate **連帶縮放/旋轉**，置放錯誤（真 pxr 重現：member scale=2 + fed
    translate=(100,0,0) → 原點落 (200,0,0)，應為 (100,0,0)）。這正是 A3-1 要消除的失效模式。

    修法（A3-1 / Codex P1）：append 完成後**顯式重排** xformOpOrder，使 federation `:fed`
    ops 在 **最前（最外層/least-local）**、member 既有 op 在 **後（最內層/most-local）**。

    xformOp 求值語義（pxr ground-truth）：xformOpOrder 由左至右是 least-local→most-local，
    對點求值時**由右至左**套用（list 最後一個 op 最內層/most-local、最先作用到點；list 第一個
    op 最外層/least-local、最後作用）。federation transform 是「把整個 member（含其自身座標系）
    放到 world 的某位置」，故 federation 變換 SHALL 為最外層（最後套用），member 既有 op 為內層。
    federation 三 op 之間維持 translate→rotateXYZ→scale（translate 較外、scale 較內），符合
    federation 自身的標準 TRS world=T·R·S。op 加 `:fed` 命名空間以與 member 自身 op 區隔
    （不 clobber）。member 既有 op 仍保留在 xformOpOrder 內，幾何仍受其作用。

    `!resetXformStack!` 特例（A3-4 / Codex P1 二次）：USD 的 `!resetXformStack!` 是 xformOpOrder
    的特殊 token，**只在出現於 index 0 時才生效**（語意：重置/忽略繼承自父層的變換，自此 prim 起
    重新累積）。pxr ground-truth：reset token 不在第一位時 USD 會**忽略它前面的所有 op**。若把
    federation `:fed` ops 一律塞到最前，當 member 既有 xformOpOrder 以 `!resetXformStack!` 開頭時
    會變成 `['xformOp:translate:fed', '!resetXformStack!', ...]` → fed ops 被整段忽略、federation
    translate 完全沒套用（真 pxr 重現：原點停留 (0,0,0)）。故重排 SHALL 保留 leading
    `!resetXformStack!` 在 index 0；fed ops 插在 reset **之後**（仍在 member 幾何 ops 之前 → fed
    仍為「reset 之後的最外層」，世界置放語意不變、reset 語意也保留）。
    目標順序：`['!resetXformStack!', <fed ops>, <member 既有非-reset ops>]`。
    """
    over = stage.OverridePrim(root_prim)
    xf = UsdGeom.Xformable(over)
    applied: list[str] = []
    # 先 append federation :fed ops（pxr Add*Op 會讀現有 xformOpOrder 再加到末端）。
    # federation 三 op 之間：translate→rotateXYZ→scale（translate 較外、scale 較內）。
    if "translate" in ops:
        xf.AddTranslateOp(opSuffix="fed").Set(Gf.Vec3d(*ops["translate"]))
        applied.append("translate")
    if "rotateXYZ" in ops:
        xf.AddRotateXYZOp(opSuffix="fed").Set(Gf.Vec3f(*ops["rotateXYZ"]))
        applied.append("rotateXYZ")
    if "scale" in ops:
        xf.AddScaleOp(opSuffix="fed").Set(Gf.Vec3f(*ops["scale"]))
        applied.append("scale")
    if applied:
        # 顯式重排：federation :fed ops 移到 xformOpOrder 最前（最外層），member 既有 op
        # 保留在後（最內層）。避免 federation translate 被 member 既有 scale/rotate 連帶作用。
        # 特例：若 member 既有 xformOpOrder 以 `!resetXformStack!` 開頭，該 token MUST 留在
        # index 0（否則 USD 會忽略它前面的 fed ops，federation translate 失效）；fed ops 插在
        # reset 之後、member 幾何 ops 之前。
        order_attr = xf.GetXformOpOrderAttr()
        current = [str(n) for n in (order_attr.Get() or [])]
        reset_token = "!resetXformStack!"
        leading_reset = current[:1] if current and current[0] == reset_token else []
        rest = current[len(leading_reset):]
        fed_ops = [n for n in rest if n.endswith(":fed")]
        member_ops = [n for n in rest if not n.endswith(":fed")]
        order_attr.Set(leading_reset + fed_ops + member_ops)
    return applied


def build_federated_usda(
    members: list[dict[str, Any]],
    out_path: str,
    default_prim: str = "/World",
    up_axis: str = "Z",
    meters_per_unit: Optional[float] = None,
) -> dict[str, Any]:
    """以 subLayer 疊合 members 產出 federated_review.usda。

    members: [{usd_path, discipline, layer_order, visibility_default, root_prim?}]
    up_axis / meters_per_unit：federated stage 的座標系宣告。呼叫端（api.build_set）SHALL 先
    跑 validate_coords 確認各 member 一致，再把該一致值傳入；不得硬編。`meters_per_unit` 留空時
    退回 pxr stage 預設（0.01），但這會與 metersPerUnit=0.001 的 member 差 10 倍，故呼叫端應
    顯式傳入 member 的一致值（A3-3）。
    回傳 subLayer 順序、隱藏清單、defaultPrim / upAxis / meters_per_unit。members 檔案不被修改。
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
    # 顯式宣告 federated stage 的 metersPerUnit，避免靜默回退 0.01（A3-3）。
    if meters_per_unit is not None:
        UsdGeom.SetStageMetersPerUnit(stage, float(meters_per_unit))
    effective_mpu = float(UsdGeom.GetStageMetersPerUnit(stage))
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
        "meters_per_unit": effective_mpu,
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

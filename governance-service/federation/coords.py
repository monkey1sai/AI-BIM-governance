"""A3 共享坐標系驗證 — federation #1 風險（discipline 間 origin/unit/upAxis 差異）。

讀每個 member 的 upAxis / metersPerUnit / defaultPrim，報告是否一致。
"""
from __future__ import annotations

from typing import Any

from pxr import Usd, UsdGeom


def validate_coords(members: list[dict[str, Any]]) -> dict[str, Any]:
    info: dict[str, Any] = {}
    up_axes: set[str] = set()
    units: set[float] = set()
    issues: list[str] = []

    for m in members:
        try:
            stage = Usd.Stage.Open(m["usd_path"])
        except Exception as exc:  # noqa: BLE001
            key = m.get("discipline") or m.get("usd_path")
            info[key] = {"error": str(exc)}
            issues.append(f"{key}: 無法開啟 ({exc})")
            continue
        up = str(UsdGeom.GetStageUpAxis(stage))
        unit = float(UsdGeom.GetStageMetersPerUnit(stage))
        default_prim = stage.GetDefaultPrim()
        key = m.get("discipline") or m["usd_path"]
        info[key] = {
            "up_axis": up,
            "meters_per_unit": unit,
            "default_prim": default_prim.GetName() if default_prim else None,
        }
        up_axes.add(up)
        units.add(round(unit, 9))

    if len(up_axes) > 1:
        issues.append(f"up_axis 不一致: {sorted(up_axes)}")
    if len(units) > 1:
        issues.append(f"metersPerUnit 不一致: {sorted(units)}")

    return {"consistent": len(issues) == 0, "members": info, "issues": issues}

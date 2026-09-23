"""Distribution statistics of CFD overlay layers (USDC): pedestrian-plane |U| and building-surface p.

Usage: field_stats.py <out_json> <label>=<layer.usdc> [<label>=<layer.usdc> ...]
Writes numbers only. `p` is OpenFOAM's kinematic pressure (m^2/s^2) for the incompressible solver, not Pa.
The building surface carries one value per face (`uniform` interpolation), so its `n` counts faces.
"""
import json
import sys

import numpy as np
from pxr import Usd, UsdGeom

PRIMS = {"PedestrianWind_1p5m": "U_magnitude", "BuildingSurfacePressure": "p"}


def load(path: str) -> dict:
    stage = Usd.Stage.Open(path)
    out = {}
    for prim in stage.Traverse():
        field = PRIMS.get(prim.GetName())
        if field is None:
            continue
        mesh = UsdGeom.Mesh(prim)
        primvar = UsdGeom.PrimvarsAPI(prim).GetPrimvar(field)
        if not (primvar and primvar.HasValue()):
            continue
        values = np.asarray(primvar.Get(), dtype=float)
        out[prim.GetName()] = {
            "field": field,
            "interpolation": str(primvar.GetInterpolation()),
            "points": int(len(mesh.GetPointsAttr().Get() or [])),
            "faces": int(len(mesh.GetFaceVertexCountsAttr().Get() or [])),
            "n": int(values.size), "min": float(values.min()), "p05": float(np.percentile(values, 5)), "mean": float(values.mean()),
            "p50": float(np.percentile(values, 50)), "p95": float(np.percentile(values, 95)), "max": float(values.max()),
        }
    return out


out_path = sys.argv[1]
layers = dict(arg.split("=", 1) for arg in sys.argv[2:])
report = {"units": {"U_magnitude": "m/s", "p": "m^2/s^2 (kinematic)"}, "layers": {label: load(path) for label, path in layers.items()}}
with open(out_path, "w", encoding="utf-8") as fh:
    json.dump(report, fh, indent=2)
    fh.write("\n")
print(json.dumps({label: {prim: {k: v for k, v in stats.items() if k in ("n", "faces", "points", "min", "p50", "max")} for prim, stats in data.items()}
                  for label, data in report["layers"].items()}, indent=1))

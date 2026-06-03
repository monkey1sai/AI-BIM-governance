"""A2 geometry_changed 訊號 — 用 ifcopenshell.geom 算幾何 signature（bbox + vertex count + bbox volume）。

注意：tessellation 較重，故為 run_diff 的 opt-in（include_geometry=True）。無 representation 或
無法 tessellate 的構件回 None（誠實，不視為變更）。
"""
from __future__ import annotations

import hashlib
import json
from typing import Any, Optional

_SETTINGS = None


def _settings():
    global _SETTINGS
    if _SETTINGS is None:
        import ifcopenshell.geom as geom

        _SETTINGS = geom.settings()
    return _SETTINGS


def geometry_signature(el: Any) -> Optional[dict]:
    try:
        if not getattr(el, "Representation", None):
            return None
        import ifcopenshell.geom as geom
        import numpy as np

        shape = geom.create_shape(_settings(), el)
        verts = np.array(shape.geometry.verts, dtype=float).reshape(-1, 3)
        if not len(verts):
            return None
        mn = verts.min(0)
        mx = verts.max(0)
        dims = mx - mn
        return {
            "bbox_min": [round(float(x), 2) for x in mn],
            "bbox_max": [round(float(x), 2) for x in mx],
            "vertex_count": int(len(verts)),
            "bbox_volume": round(float(dims[0] * dims[1] * dims[2]), 2),
        }
    except Exception:
        return None


def geometry_hash(el: Any) -> Optional[str]:
    sig = geometry_signature(el)
    if sig is None:
        return None
    return hashlib.sha1(json.dumps(sig, sort_keys=True).encode("utf-8")).hexdigest()

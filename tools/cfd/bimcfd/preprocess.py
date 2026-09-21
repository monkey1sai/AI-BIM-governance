"""P1.1 geometry pre-processing: class filter, outlier removal, voxel wrap, STL.

Every element that does not reach the solver is listed in ``exclusions.json``
with its GlobalId, IFC class and a machine-readable reason so the selection is
auditable and reproducible.
"""

from __future__ import annotations

import hashlib
import json
import time
from dataclasses import asdict
from pathlib import Path

import numpy as np

from .profiles import PreprocessProfile, get_profile
from .stl import write_binary_stl
from .usd_geometry import ElementGeometry, load_elements
from .voxel_shell import wrap_shell

REASON_CLASS_EXCLUDED = "class_excluded"
REASON_CLASS_UNLISTED = "class_unlisted"
REASON_NO_GEOMETRY = "no_geometry"
REASON_OUTLIER = "outlier"


def classify_elements(
    elements: list[ElementGeometry], profile: PreprocessProfile
) -> tuple[list[ElementGeometry], list[dict]]:
    kept: list[ElementGeometry] = []
    excluded: list[dict] = []
    for element in elements:
        if element.ifc_type in profile.exclude_classes:
            excluded.append(_exclusion(element, REASON_CLASS_EXCLUDED))
        elif element.ifc_type not in profile.include_classes:
            excluded.append(_exclusion(element, REASON_CLASS_UNLISTED))
        elif element.triangle_count == 0:
            excluded.append(_exclusion(element, REASON_NO_GEOMETRY))
        else:
            kept.append(element)
    return kept, excluded


def detect_outliers(
    elements: list[ElementGeometry], *, core_percentile: float, margin_heights: float
) -> tuple[list[ElementGeometry], list[dict], dict]:
    """Drop elements whose bbox misses the robust core box.

    The core box spans the ``core_percentile``..``100-core_percentile``
    percentiles of element centres per axis; it is expanded horizontally and
    vertically by ``margin_heights`` times the core height.
    """
    if not elements:
        return [], [], {"rule": "bbox_outside_expanded_core", "core_box": None}
    bboxes = [element.bbox for element in elements]
    mins = np.array([b[0] for b in bboxes])
    maxs = np.array([b[1] for b in bboxes])
    centres = (mins + maxs) / 2.0
    lo = np.percentile(centres, core_percentile, axis=0)
    hi = np.percentile(centres, 100.0 - core_percentile, axis=0)
    in_core = ((centres >= lo) & (centres <= hi)).all(axis=1)
    if not in_core.any():
        in_core[:] = True
    core_height = float(max(maxs[in_core, 2].max() - mins[in_core, 2].min(), 1.0))
    margin = margin_heights * core_height
    expanded_lo = lo - margin
    expanded_hi = hi + margin
    intersects = (maxs >= expanded_lo).all(axis=1) & (mins <= expanded_hi).all(axis=1)
    kept = [element for element, ok in zip(elements, intersects) if ok]
    excluded = [
        _exclusion(
            element,
            REASON_OUTLIER,
            detail={"distance_to_core_m": float(_box_distance(mins[i], maxs[i], lo, hi))},
        )
        for i, (element, ok) in enumerate(zip(elements, intersects))
        if not ok
    ]
    rule = {
        "rule": "bbox_outside_expanded_core",
        "core_percentile": core_percentile,
        "margin_heights": margin_heights,
        "core_height_m": core_height,
        "core_box": {"min": [float(v) for v in lo], "max": [float(v) for v in hi]},
        "expanded_box": {"min": [float(v) for v in expanded_lo], "max": [float(v) for v in expanded_hi]},
    }
    return kept, excluded, rule


def _box_distance(amin, amax, bmin, bmax) -> float:
    gap = np.maximum(0.0, np.maximum(bmin - amax, amin - bmax))
    return float(np.linalg.norm(gap))


def _exclusion(element: ElementGeometry, reason: str, *, detail: dict | None = None) -> dict:
    item = {
        "ifc_guid": element.ifc_guid,
        "ifc_type": element.ifc_type,
        "usd_prim_path": element.prim_path,
        "reason": reason,
    }
    if detail:
        item["detail"] = detail
    return item


def run_preprocess(
    *,
    model_usdc: Path,
    out_dir: Path,
    profile_id: str = "exterior-wind/v1",
    voxel_pitch_m: float | None = None,
    closing_radius_voxels: int | None = None,
) -> dict:
    """Produce ``shell.stl``, ``exclusions.json`` and ``preprocess_stats.json``."""
    profile = get_profile(profile_id)
    pitch = voxel_pitch_m if voxel_pitch_m is not None else profile.voxel_pitch_m
    closing = closing_radius_voxels if closing_radius_voxels is not None else profile.closing_radius_voxels
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    started = time.time()

    elements = load_elements(Path(model_usdc))
    by_class, excluded = classify_elements(elements, profile)
    kept, outliers, outlier_rule = detect_outliers(
        by_class,
        core_percentile=profile.outlier_core_percentile,
        margin_heights=profile.outlier_margin_heights,
    )
    excluded.extend(outliers)
    if not kept:
        raise ValueError("no elements left after class filter and outlier removal")

    triangles = np.concatenate([element.triangles for element in kept])
    wrap = wrap_shell(triangles, pitch=pitch, closing_radius_voxels=closing, keep_largest_only=profile.keep_largest_shell_only)

    shell_path = out_dir / "shell.stl"
    write_binary_stl(shell_path, wrap["vertices"], wrap["faces"], solid_name="building_shell")

    exclusions_doc = {
        "schema": "cfd-exclusion-list/v1",
        "profile": profile.profile_id,
        "source_model_usdc_sha256": _sha256(model_usdc),
        "outlier_rule": outlier_rule,
        "counts": _count_reasons(excluded),
        "items": sorted(excluded, key=lambda item: (item["reason"], item["ifc_type"], item["ifc_guid"])),
    }
    exclusions_path = out_dir / "exclusions.json"
    exclusions_path.write_text(json.dumps(exclusions_doc, ensure_ascii=False, indent=2), encoding="utf-8")

    flat = triangles.reshape(-1, 3)
    shell_vertices = wrap["vertices"]
    stats = {
        "schema": "cfd-preprocess-stats/v1",
        "profile": asdict(profile) | {"include_classes": sorted(profile.include_classes), "exclude_classes": sorted(profile.exclude_classes), "notes": list(profile.notes)},
        "effective": {"voxel_pitch_m": pitch, "closing_radius_voxels": closing},
        "source_model_usdc": str(model_usdc),
        "source_model_usdc_sha256": exclusions_doc["source_model_usdc_sha256"],
        "element_count_total": len(elements),
        "element_count_kept": len(kept),
        "element_count_excluded": len(excluded),
        "excluded_by_reason": exclusions_doc["counts"],
        "kept_by_class": _count_classes(kept),
        "input_triangle_count": int(triangles.shape[0]),
        "input_bbox_m": {"min": [float(v) for v in flat.min(axis=0)], "max": [float(v) for v in flat.max(axis=0)]},
        "shell_bbox_m": {
            "min": [float(v) for v in shell_vertices.min(axis=0)],
            "max": [float(v) for v in shell_vertices.max(axis=0)],
        },
        "shell": wrap["stats"],
        "outputs": {
            "shell_stl": {"path": shell_path.name, "sha256": _sha256(shell_path)},
            "exclusions_json": {"path": exclusions_path.name, "sha256": _sha256(exclusions_path)},
        },
        "elapsed_seconds": round(time.time() - started, 2),
    }
    (out_dir / "preprocess_stats.json").write_text(json.dumps(stats, ensure_ascii=False, indent=2), encoding="utf-8")
    return stats


def _count_reasons(excluded: list[dict]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for item in excluded:
        counts[item["reason"]] = counts.get(item["reason"], 0) + 1
    return dict(sorted(counts.items()))


def _count_classes(elements: list[ElementGeometry]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for element in elements:
        counts[element.ifc_type] = counts.get(element.ifc_type, 0) + 1
    return dict(sorted(counts.items(), key=lambda kv: -kv[1]))


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()

"""CFD run options: bounds, presets and panel metadata (building-energy-cfd-p2-contract.md S8, settings phase A).

Two sources, one per kind of truth:

* The CFD Settings Catalog (``docs/architecture/cfd-settings-catalog-adr.md``): every setting's bounds,
  whether a preset controls it and its panel metadata are declared once, as ``x-cfd-setting`` in
  ``tests/contracts/cfd-run-request-v1.schema.json``, and arrive here through the generated
  ``cfd_settings_catalog.py``. ``cfd_job_service.validate_run_request`` enforces the bounds and the
  options document reports them, so the browser form and the server can never disagree.
* ``cfd_options.json`` (next to this module, versioned) holds the presets and the estimate calibration.
  The ``standard`` preset *is* the service default: the validator fills omitted fields from it. It may
  never widen a contract bound.

The compute hard cap (``CFD_MAX_CELLS_PER_DIRECTION``) is host configuration and lives in
``CfdServiceConfig``; it is reported here, not decided here.
"""

from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping

try:
    from .cfd_settings_catalog import PANEL_FIELDS, PRESET_KEYS, REQUEST_FIELD_BOUNDS, SECTIONS
except ImportError:
    from cfd_settings_catalog import PANEL_FIELDS, PRESET_KEYS, REQUEST_FIELD_BOUNDS, SECTIONS

__all__ = [
    "CONFIG_PATH", "CONFIG_SCHEMA", "MESH_FIELDS", "MESH_LAYOUT_FIELDS", "OPTIONS_SCHEMA", "PANEL_FIELDS", "PRESET_KEYS",
    "REQUEST_FIELD_BOUNDS", "SECTIONS", "STANDARD_PRESET_ID", "CfdOptions", "CfdOptionsConfigError",
    "build_options_document", "custom_settings_limitation", "load_options_config", "parse_options_config",
    "request_value", "settings_profile",
]

OPTIONS_SCHEMA = "cfd-options/v1"
CONFIG_SCHEMA = "cfd-options-config/v1"
CONFIG_PATH = Path(__file__).with_name("cfd_options.json")
STANDARD_PRESET_ID = "standard"
# Same pattern as tests/contracts/cfd-options-v1.schema.json $defs.preset.preset_id.
_PRESET_ID = re.compile(r"^[a-z][a-z0-9_]{0,40}$")

# The mesh block of cfd-run-request/v1, in contract order.
MESH_FIELDS = tuple(key.split(".", 1)[1] for key in REQUEST_FIELD_BOUNDS if key.startswith("mesh."))
# The mesh fields settings phase B added (docs/plans/building-energy-cfd-b-engine-params.md §4). Requests queued,
# runs recorded and cases written before them carry none; readers take a missing one as the CaseParams default.
MESH_LAYOUT_FIELDS = tuple(name for name in MESH_FIELDS if name not in ("background_cell_m", "surface_refinement_level", "region_refinement_level"))

_ESTIMATE_KEYS = {
    "refine_factor_default": (1.0, 50.0),
    "seconds_per_cell_default": (1e-7, 1.0),
    "seconds_per_cell_default_n_procs": (1, 64),
    "typical_iterations_default": (1, 100000),
    "preprocess_seconds_default": (0, 86400),
    "confirm_cells_per_direction": (1000, 1e9),
    "confirm_total_hours": (0.01, 1000.0),
}


class CfdOptionsConfigError(ValueError):
    """The versioned options file is missing or inconsistent with the contract bounds."""


@dataclass(frozen=True)
class CfdOptions:
    config_version: str
    presets: tuple[dict[str, Any], ...]
    estimate: dict[str, Any]

    @property
    def standard(self) -> dict[str, Any]:
        return next(p for p in self.presets if p["preset_id"] == STANDARD_PRESET_ID)

    def default(self, key: str) -> Any:
        """Service default of a preset-controlled field (the standard preset value)."""
        return self.standard["values"][key]


def _within_bounds(key: str, value: Any) -> bool:
    bounds = REQUEST_FIELD_BOUNDS[key]
    if value is None:
        return bool(bounds.get("nullable"))
    kind = bounds["type"]
    if kind == "enum":
        return value in bounds["enum"]
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(float(value)):
        return False
    if kind == "integer" and (not isinstance(value, int) and not float(value).is_integer()):
        return False
    number = float(value)
    if "minimum" in bounds and number < bounds["minimum"]:
        return False
    if "exclusive_minimum" in bounds and number <= bounds["exclusive_minimum"]:
        return False
    if "maximum" in bounds and number > bounds["maximum"]:
        return False
    return True


def _text(value: Any, where: str) -> dict[str, str]:
    if not isinstance(value, dict) or not all(isinstance(value.get(lang), str) and value[lang] for lang in ("zh", "en")):
        raise CfdOptionsConfigError(f"{where} must be an object with non-empty zh and en strings")
    return {"zh": value["zh"], "en": value["en"]}


def parse_options_config(doc: Any) -> CfdOptions:
    """Strict validation of ``cfd_options.json``; raises ``CfdOptionsConfigError``."""
    if not isinstance(doc, dict) or doc.get("schema") != CONFIG_SCHEMA:
        raise CfdOptionsConfigError(f"schema must be {CONFIG_SCHEMA}")
    version = doc.get("config_version")
    if not isinstance(version, str) or not version:
        raise CfdOptionsConfigError("config_version must be a non-empty string")
    if "panel_fields" in doc:
        # Settings phase bullet 1 moved the panel into the CFD Settings Catalog; a stale file would otherwise be
        # read as if its panel still counted.
        raise CfdOptionsConfigError("panel_fields moved to the CFD Settings Catalog (x-cfd-setting in cfd-run-request-v1.schema.json)")

    presets_raw = doc.get("presets")
    if not isinstance(presets_raw, list) or not presets_raw:
        raise CfdOptionsConfigError("presets must be a non-empty array")
    presets: list[dict[str, Any]] = []
    seen: set[str] = set()
    for index, preset in enumerate(presets_raw):
        where = f"presets[{index}]"
        if not isinstance(preset, dict):
            raise CfdOptionsConfigError(f"{where} must be an object")
        preset_id = preset.get("preset_id")
        if not isinstance(preset_id, str) or not _PRESET_ID.fullmatch(preset_id) or preset_id in seen:
            raise CfdOptionsConfigError(f"{where}.preset_id must be unique and match {_PRESET_ID.pattern}")
        seen.add(preset_id)
        values = preset.get("values")
        if not isinstance(values, dict) or set(values) != set(PRESET_KEYS):
            raise CfdOptionsConfigError(f"{where}.values must set exactly {list(PRESET_KEYS)}")
        for key, value in values.items():
            if not _within_bounds(key, value):
                raise CfdOptionsConfigError(f"{where}.values.{key}={value!r} is outside the contract bounds")
        if values["wind.true_north_source"] == "manual" and values["wind.true_north_degrees_manual"] is None:
            raise CfdOptionsConfigError(f"{where}: a manual true north needs wind.true_north_degrees_manual")
        presets.append({
            "preset_id": preset_id,
            "verified": bool(preset.get("verified")),
            "label": _text(preset.get("label"), f"{where}.label"),
            "description": _text(preset.get("description"), f"{where}.description"),
            "values": dict(values),
        })
    if STANDARD_PRESET_ID not in seen:
        raise CfdOptionsConfigError("presets must include the standard preset")
    if not next(p for p in presets if p["preset_id"] == STANDARD_PRESET_ID)["verified"]:
        raise CfdOptionsConfigError("the standard preset reproduces the service defaults and must be verified")

    estimate_raw = doc.get("estimate")
    if not isinstance(estimate_raw, dict):
        raise CfdOptionsConfigError("estimate must be an object")
    estimate: dict[str, Any] = {}
    for key, (lo, hi) in _ESTIMATE_KEYS.items():
        value = estimate_raw.get(key)
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not (lo <= float(value) <= hi):
            raise CfdOptionsConfigError(f"estimate.{key} must be a number in [{lo}, {hi}]")
        estimate[key] = value
    for key in ("refine_factor_default_basis", "seconds_per_cell_default_basis", "preprocess_seconds_default_basis"):
        if not isinstance(estimate_raw.get(key), str) or not estimate_raw[key]:
            raise CfdOptionsConfigError(f"estimate.{key} must document where the default comes from")
        estimate[key] = estimate_raw[key]

    return CfdOptions(config_version=version, presets=tuple(presets), estimate=estimate)


def load_options_config(path: Path | None = None) -> CfdOptions:
    target = Path(path) if path is not None else CONFIG_PATH
    try:
        doc = json.loads(target.read_text(encoding="utf-8"))
    except OSError as exc:
        # The message reaches the browser through the coordinator: name the file, never the host path.
        raise CfdOptionsConfigError(f"cannot read {target.name} ({type(exc).__name__})") from exc
    except json.JSONDecodeError as exc:
        raise CfdOptionsConfigError(f"{target.name} is not valid JSON (line {exc.lineno}, column {exc.colno})") from exc
    return parse_options_config(doc)


def request_value(request: Mapping[str, Any], key: str) -> Any:
    """Read ``section.field`` from a validated ``cfd-run-request/v1``."""
    section, field = key.split(".", 1)
    return (request.get(section) or {}).get(field)


def settings_profile(request: Mapping[str, Any], options: CfdOptions) -> dict[str, Any]:
    """Which preset-controlled fields differ from the verified standard preset (after defaults are applied)."""
    custom = []
    for key in PRESET_KEYS:
        expected = options.default(key)
        actual = request_value(request, key)
        if key == "wind.true_north_degrees_manual" and request_value(request, "wind.true_north_source") != "manual":
            actual = None  # ignored by the runner unless the source is manual
        if not _same(expected, actual):
            custom.append(key)
    return {
        "options_config_version": options.config_version,
        "preset_match": STANDARD_PRESET_ID if not custom else None,
        "custom_fields": custom,
    }


def _same(left: Any, right: Any) -> bool:
    if left is None or right is None:
        return left is right
    if isinstance(left, (int, float)) and isinstance(right, (int, float)) and not isinstance(left, bool) and not isinstance(right, bool):
        return math.isclose(float(left), float(right), rel_tol=0.0, abs_tol=1e-9)
    return left == right


def custom_settings_limitation(profile: Mapping[str, Any] | None) -> str | None:
    """Honest-labelling line for results whose settings are not the verified standard preset (S8 requirement 6)."""
    if not profile or not profile.get("custom_fields"):
        return None
    fields = ", ".join(str(key) for key in profile["custom_fields"])
    return (
        f"Settings differ from the verified standard preset ({fields}); "
        "the run is not directly comparable with standard-preset runs and remains a screening result."
    )


def build_options_document(options: CfdOptions, *, enabled: bool, max_directions: int, n_procs_max: int, max_cells_per_direction: int) -> dict[str, Any]:
    fields = []
    for panel in PANEL_FIELDS:
        key = panel["key"]
        bounds = REQUEST_FIELD_BOUNDS[key]
        field = {k: v for k, v in bounds.items()}
        field.update({k: v for k, v in panel.items() if k != "ui_default"})
        field["default"] = options.default(key) if key in PRESET_KEYS else panel.get("ui_default")
        fields.append(field)
    return {
        "schema": OPTIONS_SCHEMA,
        "enabled": bool(enabled),
        "config_version": options.config_version,
        "limits": {
            "max_directions": int(max_directions),
            "n_procs": int(n_procs_max),
            "max_cells_per_direction": int(max_cells_per_direction),
        },
        "fields": fields,
        "presets": [dict(p) for p in options.presets],
        "confirm": {
            "cells_per_direction": options.estimate["confirm_cells_per_direction"],
            "total_hours": options.estimate["confirm_total_hours"],
        },
    }

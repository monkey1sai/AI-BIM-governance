"""Read IFC georeferencing facts into the ``geo_reference.json`` sidecar.

The extractor records only what the IFC file states:

* ``IfcMapConversion`` + ``IfcProjectedCRS`` make the model georeferenced
  (``available: true``) and give the model-to-map transform.
* ``IfcGeometricRepresentationContext.TrueNorth`` gives the true-north angle.
* ``IfcSite.RefLatitude/RefLongitude/RefElevation`` give the site position.

Nothing is inferred. When a value is absent the field stays ``null`` and a
warning names what is missing, so downstream consumers (for example the CFD
wind-direction setup) can refuse to run instead of guessing.

Angle conventions follow ``ifcopenshell.util.geolocation``: anticlockwise is
positive; ``true_north_degrees`` is "how do I rotate project north to reach
true north", ``grid_north_degrees`` is the same question for map grid north.
"""

from __future__ import annotations

import math
from typing import Any

GEO_REFERENCE_FORMAT_VERSION = 2

_TRUE_NORTH_SOURCE_CONTEXT = "IfcGeometricRepresentationContext.TrueNorth"
_DEFAULT_TRUE_NORTH_EPSILON = 1e-9


def extract_geo_reference(
    ifc_model: Any,
    *,
    length_unit_scale_to_metres: float | None,
    pset_reader: Any | None = None,
) -> dict[str, Any]:
    """Build the ``geo_reference.json`` document for ``ifc_model``.

    ``length_unit_scale_to_metres`` is the project length unit expressed in
    metres (``0.001`` for millimetres). ``None`` means the caller could not
    determine it; raw values are then kept unscaled and a warning is added.
    ``pset_reader(entity, pset_name) -> dict`` is only used for IFC2X3 and
    defaults to ``ifcopenshell.util.element.get_pset``.
    """
    warnings: list[str] = []
    unit_scale = _finite_or_none(length_unit_scale_to_metres)
    if unit_scale is None:
        warnings.append("length_unit_scale_unknown")

    lookup_failed = False

    def by_type(name: str) -> list[Any]:
        nonlocal lookup_failed
        try:
            return list(ifc_model.by_type(name) or [])
        except Exception:  # noqa: BLE001
            lookup_failed = True
            return []

    schema = str(getattr(ifc_model, "schema", "") or "").upper()
    if schema.startswith("IFC2X3"):
        # IFC2X3 has no IfcMapConversion entity; the buildingSMART convention
        # stores the same parameters as ePSet_MapConversion / ePSet_ProjectedCRS
        # on IfcProject. Querying the IFC4 entity would raise on this schema.
        map_conversion, crs = _read_ifc2x3_map_conversion(by_type("IfcProject"), warnings, pset_reader)
    else:
        map_conversion, crs = _read_map_conversion(by_type("IfcMapConversion"), warnings)
    true_north_degrees, true_north_source = _read_true_north(
        by_type("IfcGeometricRepresentationContext"), warnings
    )
    site = _read_site(by_type("IfcSite"), unit_scale, warnings)

    if lookup_failed:
        warnings.append("geo_lookup_failed")

    available = map_conversion is not None
    if not available:
        warnings.insert(0, "geo_reference_missing")

    grid_north_degrees = None
    local_origin = None
    model_to_world_matrix = None
    if map_conversion is not None:
        grid_north_degrees = _xaxis_to_angle(map_conversion["x_axis_abscissa"], map_conversion["x_axis_ordinate"])
        local_origin = {
            "eastings": map_conversion["eastings"],
            "northings": map_conversion["northings"],
            "orthogonal_height": map_conversion["orthogonal_height"],
        }
        model_to_world_matrix = _model_to_world_matrix(map_conversion)

    return {
        "format_version": GEO_REFERENCE_FORMAT_VERSION,
        "available": available,
        "crs": crs,
        "map_conversion": map_conversion,
        "local_origin": local_origin,
        "model_to_world_matrix": model_to_world_matrix,
        # The matrix maps project-frame coordinates *in project length units*
        # (not the metre-based USDC) to map coordinates, and does not include
        # the context WorldCoordinateSystem (identity in IfcOpenShell output).
        "model_to_world_matrix_input_units": "project_length_units" if model_to_world_matrix else None,
        "true_north_degrees": true_north_degrees,
        "true_north_source": true_north_source,
        "grid_north_degrees": grid_north_degrees,
        "site": site,
        "length_unit_scale_to_metres": unit_scale,
        "warnings": _dedupe(warnings),
    }


def _read_map_conversion(conversions: list[Any], warnings: list[str]) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    if not conversions:
        return None, None
    if len(conversions) > 1:
        warnings.append("map_conversion_multiple")
    conversion = conversions[0]

    eastings = _finite_or_none(_attr(conversion, "Eastings"))
    northings = _finite_or_none(_attr(conversion, "Northings"))
    if eastings is None or northings is None:
        warnings.append("map_conversion_incomplete")
        return None, None
    height = _finite_or_none(_attr(conversion, "OrthogonalHeight"))
    if height is None:
        height = 0.0
        warnings.append("map_conversion_height_missing")

    xaa = _finite_or_none(_attr(conversion, "XAxisAbscissa"))
    xao = _finite_or_none(_attr(conversion, "XAxisOrdinate"))
    if not xaa and not xao:
        # IFC allows both to be omitted; an all-zero axis carries no rotation.
        xaa, xao = 1.0, 0.0
        warnings.append("map_conversion_x_axis_degenerate")
    else:
        xaa = xaa or 0.0
        xao = xao or 0.0

    map_conversion = _map_conversion_doc(
        eastings=eastings,
        northings=northings,
        height=height,
        xaa=xaa,
        xao=xao,
        scale_raw=_finite_or_none(_attr(conversion, "Scale")),
        warnings=warnings,
    )

    crs_entity = _attr(conversion, "TargetCRS")
    if crs_entity is None:
        warnings.append("target_crs_missing")
        return map_conversion, None

    map_unit = _unit_name(_attr(crs_entity, "MapUnit"))
    if map_unit is None:
        warnings.append("map_unit_missing")
    crs = {
        "name": _text_or_none(_attr(crs_entity, "Name")),
        "description": _text_or_none(_attr(crs_entity, "Description")),
        "geodetic_datum": _text_or_none(_attr(crs_entity, "GeodeticDatum")),
        "vertical_datum": _text_or_none(_attr(crs_entity, "VerticalDatum")),
        "map_projection": _text_or_none(_attr(crs_entity, "MapProjection")),
        "map_zone": _text_or_none(_attr(crs_entity, "MapZone")),
        "map_unit": map_unit,
    }
    return map_conversion, crs


def _map_conversion_doc(*, eastings, northings, height, xaa, xao, scale_raw, warnings: list[str]) -> dict[str, Any]:
    scale_declared = scale_raw is not None and scale_raw > 0
    if scale_raw is not None and scale_raw <= 0:
        warnings.append("map_conversion_scale_invalid")
    return {
        "eastings": eastings,
        "northings": northings,
        "orthogonal_height": height,
        "x_axis_abscissa": xaa,
        "x_axis_ordinate": xao,
        "scale": scale_raw if scale_declared else 1.0,
        "scale_declared": scale_declared,
    }


def _read_ifc2x3_map_conversion(projects: list[Any], warnings: list[str], pset_reader: Any | None) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    """IFC2X3: ``ePSet_MapConversion`` / ``ePSet_ProjectedCRS`` on IfcProject."""
    if not projects:
        warnings.append("ifc2x3_project_missing")
        return None, None
    get_pset = pset_reader
    if get_pset is None:
        try:
            from ifcopenshell.util import element as element_util  # type: ignore[import-not-found]

            get_pset = element_util.get_pset
        except Exception:  # noqa: BLE001
            warnings.append("ifc2x3_pset_reader_unavailable")
            return None, None
    project = projects[0]
    try:
        conversion = get_pset(project, "ePSet_MapConversion") or {}
        crs_pset = get_pset(project, "ePSet_ProjectedCRS") or {}
    except Exception:  # noqa: BLE001
        warnings.append("geo_lookup_failed")
        return None, None
    if not conversion:
        warnings.append("ifc2x3_epset_map_conversion_missing")
        return None, None

    eastings = _finite_or_none(conversion.get("Eastings"))
    northings = _finite_or_none(conversion.get("Northings"))
    if eastings is None or northings is None:
        warnings.append("map_conversion_incomplete")
        return None, None
    height = _finite_or_none(conversion.get("OrthogonalHeight"))
    if height is None:
        height = 0.0
        warnings.append("map_conversion_height_missing")
    xaa = _finite_or_none(conversion.get("XAxisAbscissa"))
    xao = _finite_or_none(conversion.get("XAxisOrdinate"))
    if not xaa and not xao:
        xaa, xao = 1.0, 0.0
        warnings.append("map_conversion_x_axis_degenerate")
    else:
        xaa = xaa or 0.0
        xao = xao or 0.0
    map_conversion = _map_conversion_doc(
        eastings=eastings,
        northings=northings,
        height=height,
        xaa=xaa,
        xao=xao,
        scale_raw=_finite_or_none(conversion.get("Scale")),
        warnings=warnings,
    )
    map_conversion["source"] = "ePSet_MapConversion"
    if not crs_pset:
        warnings.append("target_crs_missing")
        return map_conversion, None
    map_unit = _text_or_none(crs_pset.get("MapUnit"))
    if map_unit is None:
        warnings.append("map_unit_missing")
    crs = {
        "name": _text_or_none(crs_pset.get("Name")),
        "description": _text_or_none(crs_pset.get("Description")),
        "geodetic_datum": _text_or_none(crs_pset.get("GeodeticDatum")),
        "vertical_datum": _text_or_none(crs_pset.get("VerticalDatum")),
        "map_projection": _text_or_none(crs_pset.get("MapProjection")),
        "map_zone": _text_or_none(crs_pset.get("MapZone")),
        "map_unit": map_unit,
    }
    return map_conversion, crs


def _read_true_north(contexts: list[Any], warnings: list[str]) -> tuple[float | None, str | None]:
    # Only top-level contexts carry TrueNorth; sub-contexts inherit it.
    candidates = []
    for context in contexts:
        try:
            if callable(getattr(context, "is_a", None)) and context.is_a() != "IfcGeometricRepresentationContext":
                continue
        except Exception:  # noqa: BLE001
            continue
        candidates.append(context)
    # Prefer the 3D "Model" context; fall back to any context that states a direction.
    candidates.sort(key=lambda ctx: 0 if _text_or_none(_attr(ctx, "ContextType")) == "Model" else 1)

    for context in candidates:
        direction = _attr(context, "TrueNorth")
        if direction is None:
            continue
        ratios = _attr(direction, "DirectionRatios")
        try:
            x = float(ratios[0])
            y = float(ratios[1])
        except (TypeError, IndexError, ValueError):
            continue
        if not (math.isfinite(x) and math.isfinite(y)) or (x == 0.0 and y == 0.0):
            continue
        if abs(x) <= _DEFAULT_TRUE_NORTH_EPSILON and y > 0:
            warnings.append("true_north_default_direction")
        return _yaxis_to_angle(x, y), _TRUE_NORTH_SOURCE_CONTEXT

    warnings.append("true_north_missing")
    return None, None


def _read_site(sites: list[Any], unit_scale: float | None, warnings: list[str]) -> dict[str, Any] | None:
    located = []
    for site in sites:
        latitude = _dms_to_degrees(_attr(site, "RefLatitude"))
        longitude = _dms_to_degrees(_attr(site, "RefLongitude"))
        if latitude is None or longitude is None:
            continue
        located.append((site, latitude, longitude))

    if not located:
        warnings.append("site_geolocation_missing")
        return None
    if len(located) > 1:
        warnings.append("site_geolocation_multiple")

    site, latitude, longitude = located[0]
    elevation_raw = _finite_or_none(_attr(site, "RefElevation"))
    elevation_metres = None
    if elevation_raw is not None and unit_scale is not None:
        elevation_metres = elevation_raw * unit_scale
    return {
        "ifc_guid": _text_or_none(_attr(site, "GlobalId")),
        "ref_latitude_degrees": latitude,
        "ref_longitude_degrees": longitude,
        "ref_elevation_raw": elevation_raw,
        "ref_elevation_metres": elevation_metres,
    }


def _model_to_world_matrix(map_conversion: dict[str, Any]) -> list[list[float]]:
    theta = math.atan2(map_conversion["x_axis_ordinate"], map_conversion["x_axis_abscissa"])
    scale = map_conversion["scale"]
    cos_t = math.cos(theta)
    sin_t = math.sin(theta)
    return [
        [scale * cos_t, -scale * sin_t, 0.0, map_conversion["eastings"]],
        [scale * sin_t, scale * cos_t, 0.0, map_conversion["northings"]],
        [0.0, 0.0, scale, map_conversion["orthogonal_height"]],
        [0.0, 0.0, 0.0, 1.0],
    ]


def _xaxis_to_angle(x: float, y: float) -> float:
    """Rotation (anticlockwise, degrees) from project north to grid north."""
    return math.degrees(math.atan2(y, x)) * -1.0


def _yaxis_to_angle(x: float, y: float) -> float:
    """Rotation (anticlockwise, degrees) from project north to true north."""
    angle = math.degrees(math.atan2(y, x)) - 90.0
    if angle < -180.0:
        angle += 360.0
    elif angle > 180.0:
        angle -= 360.0
    return angle


def _dms_to_degrees(value: Any) -> float | None:
    """IfcCompoundPlaneAngleMeasure (deg, min, sec[, millionth-sec]) to decimal degrees."""
    if value is None:
        return None
    try:
        parts = [int(part) for part in list(value)[:4]]
    except (TypeError, ValueError):
        return None
    if len(parts) < 3:
        return None
    while len(parts) < 4:
        parts.append(0)
    degrees, minutes, seconds, millionths = parts
    result = abs(degrees) + abs(minutes) / 60.0 + abs(seconds) / 3600.0 + abs(millionths) / 3_600_000_000.0
    negative = any(part < 0 for part in parts)
    return -result if negative else result


def _unit_name(unit: Any) -> str | None:
    if unit is None:
        return None
    name = _text_or_none(_attr(unit, "Name"))
    if name is None:
        return None
    prefix = _text_or_none(_attr(unit, "Prefix"))
    return f"{prefix}{name}" if prefix else name


def _attr(entity: Any, name: str) -> Any:
    try:
        return getattr(entity, name, None)
    except Exception:  # noqa: BLE001
        return None


def _finite_or_none(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        number = float(getattr(value, "wrappedValue", value))
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _text_or_none(value: Any) -> str | None:
    if value is None:
        return None
    text = str(getattr(value, "wrappedValue", value)).strip()
    return text or None


def _dedupe(items: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for item in items:
        if item not in seen:
            seen.add(item)
            result.append(item)
    return result

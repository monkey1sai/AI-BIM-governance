"""Unit tests for IFC georeference extraction (CFD plan P0.1).

The extractor only records what the IFC file states. Missing data stays
missing: no defaults are invented, ``available`` is only true when an
``IfcMapConversion`` is present.
"""

from __future__ import annotations

import math
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

MODULE_DIR = (
    Path(__file__).resolve().parents[1]
    / "source"
    / "extensions"
    / "ezplus.bim_review_stream.messaging"
    / "ezplus"
    / "bim_review_stream"
    / "messaging"
)
sys.path.insert(0, str(MODULE_DIR))

from ifc_geo_reference import (  # noqa: E402
    GEO_REFERENCE_FORMAT_VERSION,
    extract_geo_reference,
)


class _Entity(SimpleNamespace):
    def __init__(self, ifc_type: str, **fields):
        super().__init__(**fields)
        self._ifc_type = ifc_type

    def is_a(self, name: str | None = None):
        if name is None:
            return self._ifc_type
        return name == self._ifc_type


class _Model:
    def __init__(self, entities: list[_Entity], schema: str = "IFC4"):
        self._entities = entities
        self.schema = schema

    def by_type(self, name: str, include_subtypes: bool = True):
        return [entity for entity in self._entities if entity.is_a(name)]


class _RaisingModel:
    schema = "IFC4"

    def by_type(self, name: str, include_subtypes: bool = True):
        raise RuntimeError("schema lookup exploded")


def _context(true_north, context_type="Model", identifier=None):
    direction = None if true_north is None else _Entity("IfcDirection", DirectionRatios=tuple(true_north))
    return _Entity(
        "IfcGeometricRepresentationContext",
        ContextType=context_type,
        ContextIdentifier=identifier,
        TrueNorth=direction,
        HasCoordinateOperation=(),
    )


def _map_conversion(*, eastings, northings, height, xaa, xao, scale=None, crs=None):
    return _Entity(
        "IfcMapConversion",
        Eastings=eastings,
        Northings=northings,
        OrthogonalHeight=height,
        XAxisAbscissa=xaa,
        XAxisOrdinate=xao,
        Scale=scale,
        TargetCRS=crs,
    )


def _crs(*, name="EPSG:3826", map_unit_name="METRE", **extra):
    map_unit = None if map_unit_name is None else _Entity("IfcSIUnit", Name=map_unit_name, Prefix=None)
    return _Entity(
        "IfcProjectedCRS",
        Name=name,
        Description=extra.get("description"),
        GeodeticDatum=extra.get("geodetic_datum"),
        VerticalDatum=extra.get("vertical_datum"),
        MapProjection=extra.get("map_projection"),
        MapZone=extra.get("map_zone"),
        MapUnit=map_unit,
    )


def _site(*, latitude, longitude, elevation, guid="SITE_GUID"):
    return _Entity(
        "IfcSite",
        GlobalId=guid,
        RefLatitude=latitude,
        RefLongitude=longitude,
        RefElevation=elevation,
    )


def test_no_geo_data_stays_unavailable_and_reports_what_is_missing():
    doc = extract_geo_reference(_Model([_context(None)]), length_unit_scale_to_metres=0.001)

    assert doc["format_version"] == GEO_REFERENCE_FORMAT_VERSION == 2
    assert doc["available"] is False
    assert doc["crs"] is None
    assert doc["map_conversion"] is None
    assert doc["local_origin"] is None
    assert doc["model_to_world_matrix"] is None
    assert doc["true_north_degrees"] is None
    assert doc["true_north_source"] is None
    assert doc["grid_north_degrees"] is None
    assert doc["site"] is None
    assert doc["length_unit_scale_to_metres"] == 0.001
    assert doc["warnings"][0] == "geo_reference_missing"
    assert "true_north_missing" in doc["warnings"]
    assert "site_geolocation_missing" in doc["warnings"]


def test_map_conversion_makes_geo_reference_available():
    theta = math.radians(30.0)
    model = _Model(
        [
            _context((0.0, 1.0)),
            _map_conversion(
                eastings=1000.0,
                northings=2000.0,
                height=10.0,
                xaa=math.cos(theta),
                xao=math.sin(theta),
                scale=None,
                crs=_crs(name="EPSG:3826", map_zone="TWD97 / TM2 zone 121"),
            ),
        ]
    )

    doc = extract_geo_reference(model, length_unit_scale_to_metres=1.0)

    assert doc["available"] is True
    assert "geo_reference_missing" not in doc["warnings"]
    assert doc["crs"]["name"] == "EPSG:3826"
    assert doc["crs"]["map_zone"] == "TWD97 / TM2 zone 121"
    assert doc["crs"]["map_unit"] == "METRE"
    assert doc["map_conversion"] == {
        "eastings": 1000.0,
        "northings": 2000.0,
        "orthogonal_height": 10.0,
        "x_axis_abscissa": pytest.approx(math.cos(theta)),
        "x_axis_ordinate": pytest.approx(math.sin(theta)),
        "scale": 1.0,
        "scale_declared": False,
    }
    assert doc["local_origin"] == {"eastings": 1000.0, "northings": 2000.0, "orthogonal_height": 10.0}
    # Rotating project north anticlockwise by -30 degrees reaches grid north.
    assert doc["grid_north_degrees"] == pytest.approx(-30.0)

    matrix = doc["model_to_world_matrix"]
    assert len(matrix) == 4 and all(len(row) == 4 for row in matrix)
    assert matrix[0][0] == pytest.approx(math.cos(theta))
    assert matrix[1][0] == pytest.approx(math.sin(theta))
    assert matrix[0][1] == pytest.approx(-math.sin(theta))
    assert matrix[1][1] == pytest.approx(math.cos(theta))
    assert [matrix[0][3], matrix[1][3], matrix[2][3]] == [1000.0, 2000.0, 10.0]
    assert matrix[3] == [0.0, 0.0, 0.0, 1.0]


def test_map_conversion_without_map_unit_is_recorded_with_warning():
    model = _Model(
        [
            _map_conversion(eastings=1.0, northings=2.0, height=0.0, xaa=1.0, xao=0.0, crs=_crs(map_unit_name=None)),
        ]
    )

    doc = extract_geo_reference(model, length_unit_scale_to_metres=1.0)

    assert doc["available"] is True
    assert doc["crs"]["map_unit"] is None
    assert "map_unit_missing" in doc["warnings"]


def test_map_conversion_with_degenerate_axis_falls_back_to_identity_rotation():
    model = _Model([_map_conversion(eastings=5.0, northings=6.0, height=7.0, xaa=0.0, xao=0.0)])

    doc = extract_geo_reference(model, length_unit_scale_to_metres=1.0)

    assert doc["available"] is True
    assert doc["crs"] is None
    assert doc["grid_north_degrees"] == pytest.approx(0.0)
    assert doc["map_conversion"]["x_axis_abscissa"] == 1.0
    assert doc["map_conversion"]["x_axis_ordinate"] == 0.0
    assert "map_conversion_x_axis_degenerate" in doc["warnings"]
    assert "target_crs_missing" in doc["warnings"]


def test_true_north_is_read_from_the_model_context():
    # (-1, 1) points north-west: project north rotated 45 degrees anticlockwise.
    model = _Model([_context((-1.0, 1.0), context_type="Plan"), _context((-1.0, 1.0), context_type="Model")])

    doc = extract_geo_reference(model, length_unit_scale_to_metres=1.0)

    assert doc["true_north_degrees"] == pytest.approx(45.0)
    assert doc["true_north_source"] == "IfcGeometricRepresentationContext.TrueNorth"
    assert "true_north_default_direction" not in doc["warnings"]
    assert "true_north_missing" not in doc["warnings"]


def test_default_true_north_direction_is_kept_but_flagged():
    doc = extract_geo_reference(_Model([_context((0.0, 1.0))]), length_unit_scale_to_metres=1.0)

    assert doc["true_north_degrees"] == 0.0
    assert doc["true_north_source"] == "IfcGeometricRepresentationContext.TrueNorth"
    assert "true_north_default_direction" in doc["warnings"]


def test_model_context_wins_over_plan_context_for_true_north():
    model = _Model([_context((1.0, 1.0), context_type="Plan"), _context((0.0, 1.0), context_type="Model")])

    doc = extract_geo_reference(model, length_unit_scale_to_metres=1.0)

    assert doc["true_north_degrees"] == 0.0


def test_site_geolocation_is_converted_from_dms_and_elevation_scaled_to_metres():
    site = _site(latitude=(24, 10, 30, 500000), longitude=(120, 40, 0), elevation=250.0)

    doc = extract_geo_reference(_Model([site]), length_unit_scale_to_metres=0.01)

    expected_lat = 24 + 10 / 60 + 30 / 3600 + 500000 / 3_600_000_000
    expected_lon = 120 + 40 / 60
    assert doc["site"]["ifc_guid"] == "SITE_GUID"
    assert doc["site"]["ref_latitude_degrees"] == pytest.approx(expected_lat)
    assert doc["site"]["ref_longitude_degrees"] == pytest.approx(expected_lon)
    assert doc["site"]["ref_elevation_metres"] == pytest.approx(2.5)
    assert doc["site"]["ref_elevation_raw"] == 250.0
    assert "site_geolocation_missing" not in doc["warnings"]
    # Site coordinates alone do not make the model georeferenced.
    assert doc["available"] is False
    assert "geo_reference_missing" in doc["warnings"]


def test_negative_dms_components_convert_to_negative_degrees():
    site = _site(latitude=(-33, -52, -10), longitude=(151, 12, 0), elevation=None)

    doc = extract_geo_reference(_Model([site]), length_unit_scale_to_metres=1.0)

    assert doc["site"]["ref_latitude_degrees"] == pytest.approx(-(33 + 52 / 60 + 10 / 3600))
    assert doc["site"]["ref_elevation_metres"] is None
    assert doc["site"]["ref_elevation_raw"] is None


def test_first_site_with_coordinates_is_used_and_multiple_sites_are_flagged():
    sites = [
        _site(latitude=None, longitude=None, elevation=None, guid="SITE_EMPTY"),
        _site(latitude=(24, 0, 0), longitude=(120, 0, 0), elevation=0.0, guid="SITE_A"),
        _site(latitude=(25, 0, 0), longitude=(121, 0, 0), elevation=0.0, guid="SITE_B"),
    ]

    doc = extract_geo_reference(_Model(sites), length_unit_scale_to_metres=1.0)

    assert doc["site"]["ifc_guid"] == "SITE_A"
    assert doc["site"]["ref_latitude_degrees"] == 24.0
    assert "site_geolocation_multiple" in doc["warnings"]


def test_unknown_unit_scale_keeps_raw_elevation_and_warns():
    site = _site(latitude=(24, 0, 0), longitude=(120, 0, 0), elevation=250.0)

    doc = extract_geo_reference(_Model([site]), length_unit_scale_to_metres=None)

    assert doc["length_unit_scale_to_metres"] is None
    assert doc["site"]["ref_elevation_raw"] == 250.0
    assert doc["site"]["ref_elevation_metres"] is None
    assert "length_unit_scale_unknown" in doc["warnings"]


def test_multiple_map_conversions_use_first_and_flag():
    model = _Model(
        [
            _map_conversion(eastings=1.0, northings=1.0, height=0.0, xaa=1.0, xao=0.0),
            _map_conversion(eastings=9.0, northings=9.0, height=0.0, xaa=1.0, xao=0.0),
        ]
    )

    doc = extract_geo_reference(model, length_unit_scale_to_metres=1.0)

    assert doc["map_conversion"]["eastings"] == 1.0
    assert "map_conversion_multiple" in doc["warnings"]


def test_lookup_failures_degrade_to_unavailable_without_raising():
    doc = extract_geo_reference(_RaisingModel(), length_unit_scale_to_metres=1.0)

    assert doc["available"] is False
    assert doc["warnings"][0] == "geo_reference_missing"
    assert "geo_lookup_failed" in doc["warnings"]


class _Ifc2x3Model(_Model):
    """IFC2X3 schema: IfcMapConversion does not exist and by_type raises for it."""

    def __init__(self, entities):
        super().__init__(entities, schema="IFC2X3")

    def by_type(self, name: str, include_subtypes: bool = True):
        if name in ("IfcMapConversion", "IfcProjectedCRS"):
            raise RuntimeError(f"Entity {name} not found in schema IFC2X3")
        return super().by_type(name, include_subtypes)


def test_ifc2x3_without_epset_is_missing_not_lookup_failed():
    model = _Ifc2x3Model([_Entity("IfcProject", GlobalId="PRJ"), _context(None)])

    doc = extract_geo_reference(model, length_unit_scale_to_metres=0.001, pset_reader=lambda entity, name: {})

    assert doc["available"] is False
    assert "geo_lookup_failed" not in doc["warnings"]
    assert "ifc2x3_epset_map_conversion_missing" in doc["warnings"]


def test_ifc2x3_epset_map_conversion_is_read():
    psets = {
        "ePSet_MapConversion": {"Eastings": 250000.0, "Northings": 2650000.0, "OrthogonalHeight": 5.0, "XAxisAbscissa": 1.0, "XAxisOrdinate": 0.0, "Scale": 1.0},
        "ePSet_ProjectedCRS": {"Name": "EPSG:3826", "MapUnit": "METRE"},
    }
    model = _Ifc2x3Model([_Entity("IfcProject", GlobalId="PRJ")])

    doc = extract_geo_reference(model, length_unit_scale_to_metres=0.001, pset_reader=lambda entity, name: psets.get(name, {}))

    assert doc["available"] is True
    assert doc["map_conversion"]["eastings"] == 250000.0
    assert doc["map_conversion"]["source"] == "ePSet_MapConversion"
    assert doc["crs"] == {"name": "EPSG:3826", "description": None, "geodetic_datum": None, "vertical_datum": None, "map_projection": None, "map_zone": None, "map_unit": "METRE"}
    assert doc["grid_north_degrees"] == 0.0
    assert doc["model_to_world_matrix_input_units"] == "project_length_units"
    assert "geo_reference_missing" not in doc["warnings"]


def test_non_positive_scale_is_flagged_not_silently_defaulted():
    model = _Model([_map_conversion(eastings=1.0, northings=2.0, height=0.0, xaa=1.0, xao=0.0, scale=0.0)])

    doc = extract_geo_reference(model, length_unit_scale_to_metres=1.0)

    assert doc["map_conversion"]["scale"] == 1.0
    assert doc["map_conversion"]["scale_declared"] is False
    assert "map_conversion_scale_invalid" in doc["warnings"]


def test_output_is_json_serialisable_plain_types():
    import json

    theta = math.radians(10.0)
    model = _Model(
        [
            _context((0.0, 1.0)),
            _map_conversion(eastings=1.0, northings=2.0, height=3.0, xaa=math.cos(theta), xao=math.sin(theta), scale=0.9996, crs=_crs()),
            _site(latitude=(24, 0, 0), longitude=(120, 0, 0), elevation=1.0),
        ]
    )

    doc = extract_geo_reference(model, length_unit_scale_to_metres=1.0)

    json.dumps(doc)
    assert doc["map_conversion"]["scale"] == 0.9996
    assert doc["map_conversion"]["scale_declared"] is True

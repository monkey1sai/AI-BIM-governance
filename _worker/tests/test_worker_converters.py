"""Unit tests for worker conversion adapters."""
import json
import sys
import types
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.converters import ConversionAdapterError, IfcOpenShellUsdConverter


class _FakeProduct:
    def __init__(self, guid: str, ifc_class: str, name: str):
        self.GlobalId = guid
        self.Name = name
        self._ifc_class = ifc_class

    def is_a(self) -> str:
        return self._ifc_class


class _FakeEntity:
    def __init__(self, ifc_class: str, name: str = "", entity_id: int = 0):
        self.Name = name
        self._ifc_class = ifc_class
        self._id = entity_id

    def is_a(self) -> str:
        return self._ifc_class


class _FakeModel:
    schema = "IFC4"

    def __iter__(self):
        return iter(
            [
                _FakeProduct("guid-project", "IfcProject", "Demo project"),
                _FakeProduct("guid-site", "IfcSite", "Demo site"),
                _FakeProduct("guid-building", "IfcBuilding", "Demo building"),
                _FakeProduct("guid-1", "IfcWall", "Mapped wall"),
                _FakeProduct("guid-2", "IfcDoor", "Metadata door"),
                _FakeProduct("guid-pset", "IfcPropertySet", "Wall Pset"),
                _FakeProduct("guid-type", "IfcWallType", "Wall type"),
                _FakeEntity("IfcRelDefinesByProperties", "Wall properties", 42),
            ]
        )

    def by_type(self, name: str):
        if name != "IfcProduct":
            return []
        return [
            _FakeProduct("guid-1", "IfcWall", "Mapped wall"),
            _FakeProduct("guid-2", "IfcDoor", "Unmapped door"),
        ]


class _FakeGeometry:
    verts = [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0]
    faces = [0, 1, 2]


class _FakeDegenerateGeometry:
    verts = [0.0, 0.0, 0.0]
    faces = [0]


class _FakeShape:
    def __init__(self, guid: str, ifc_class: str = "IfcWall", geometry=None):
        self.guid = guid
        self.type = ifc_class
        self.geometry = geometry or _FakeGeometry()


class _FakeIterator:
    def __init__(self, shapes=None):
        self._index = 0
        self._shapes = shapes or [
            _FakeShape("guid-1"),
            _FakeShape(""),
            _FakeShape("unknown-guid"),
        ]

    def initialize(self) -> bool:
        return True

    def get(self):
        return self._shapes[self._index]

    def next(self) -> bool:
        self._index += 1
        return self._index < len(self._shapes)


class _FakeSettings:
    USE_WORLD_COORDS = "USE_WORLD_COORDS"

    def set(self, _key, _value) -> None:
        return None


class _FakeAttribute:
    def Set(self, _value) -> None:
        return None


class _FakePrim:
    def CreateAttribute(self, _name, _value_type):
        return _FakeAttribute()


class _FakeLayer:
    def __init__(self, path: str):
        self._path = Path(path)

    def Save(self) -> None:
        self._path.write_bytes(b"PXR-USDC-test\n")


class _FakeStage:
    def __init__(self, path: str):
        self._path = path

    def SetDefaultPrim(self, _prim) -> None:
        return None

    def GetRootLayer(self):
        return _FakeLayer(self._path)


class _FakeOpenedStage:
    def Traverse(self):
        return iter([object(), object(), object(), object()])


class _FakeXform:
    def GetPrim(self):
        return _FakePrim()


class _FakeMesh:
    def CreatePointsAttr(self, _points) -> None:
        return None

    def CreateFaceVertexCountsAttr(self, _counts) -> None:
        return None

    def CreateFaceVertexIndicesAttr(self, _indices) -> None:
        return None

    def GetPrim(self):
        return _FakePrim()


def _install_fake_converter_modules(monkeypatch, *, shapes=None) -> None:
    fake_ifcopenshell = types.ModuleType("ifcopenshell")
    fake_geom = types.ModuleType("ifcopenshell.geom")
    fake_geom.settings = _FakeSettings
    fake_geom.iterator = lambda _settings, _model, _workers: _FakeIterator(shapes)
    fake_ifcopenshell.geom = fake_geom
    fake_ifcopenshell.open = lambda _path: _FakeModel()

    fake_sdf = types.SimpleNamespace(ValueTypeNames=types.SimpleNamespace(String="String"))
    fake_usd = types.SimpleNamespace(
        Stage=types.SimpleNamespace(
            CreateNew=lambda path: _FakeStage(path),
            Open=lambda _path: _FakeOpenedStage(),
        )
    )
    fake_usd_geom = types.SimpleNamespace(
        Tokens=types.SimpleNamespace(z="z"),
        SetStageUpAxis=lambda _stage, _axis: None,
        Xform=types.SimpleNamespace(Define=lambda _stage, _path: _FakeXform()),
        Mesh=types.SimpleNamespace(Define=lambda _stage, _path: _FakeMesh()),
    )
    fake_pxr = types.ModuleType("pxr")
    fake_pxr.Sdf = fake_sdf
    fake_pxr.Usd = fake_usd
    fake_pxr.UsdGeom = fake_usd_geom

    monkeypatch.setitem(sys.modules, "ifcopenshell", fake_ifcopenshell)
    monkeypatch.setitem(sys.modules, "ifcopenshell.geom", fake_geom)
    monkeypatch.setitem(sys.modules, "pxr", fake_pxr)
    monkeypatch.setitem(sys.modules, "pxr.Sdf", fake_sdf)
    monkeypatch.setitem(sys.modules, "pxr.Usd", fake_usd)
    monkeypatch.setitem(sys.modules, "pxr.UsdGeom", fake_usd_geom)


def test_ifcopenshell_converter_does_not_count_missing_or_unknown_guids_as_mapping(monkeypatch, tmp_path: Path):
    _install_fake_converter_modules(monkeypatch)
    source_path = tmp_path / "source.ifc"
    source_path.write_text("ISO-10303-21;\nEND-ISO-10303-21;\n", encoding="utf-8")

    result = IfcOpenShellUsdConverter().convert(
        source_path=source_path,
        output_dir=tmp_path / "derived",
        job={"source_artifact_id": "source_test"},
        generate_mapping=True,
    )

    mapping = json.loads(result.mapping_path.read_text(encoding="utf-8"))
    usd_index = json.loads(result.usd_index_path.read_text(encoding="utf-8"))

    mapped_guids = [item.get("ifc_guid") for item in mapping["items"] if item.get("ifc_guid")]
    assert "guid-1" in mapped_guids
    assert "guid-2" in mapped_guids
    assert "guid-project" in mapped_guids
    assert "unknown-guid" not in mapped_guids
    assert mapping["unmapped_ifc_guids"] == []
    assert mapping["summary"]["source_ifc_entity_count"] == 8
    assert mapping["summary"]["mapped_count"] == 8
    assert mapping["summary"]["unmapped_ifc_count"] == 0
    assert mapping["summary"]["unmapped_usd_count"] == 2
    assert mapping["summary"]["coverage_ratio"] == 1.0
    assert mapping["summary"]["minimum_coverage_ratio"] == 1.0
    assert mapping["summary"]["coverage_denominator"] == "source_ifc_entity_count"
    assert {item["reason"] for item in mapping["unmapped_usd_prims"]} == {
        "missing_source_guid",
        "unknown_source_guid",
    }
    assert all(not str(item.get("ifc_guid") or "").startswith("shape_") for item in mapping["items"])
    non_renderable = [item for item in usd_index["prims"] if item.get("renderable") is False]
    assert {item["ifc_class"] for item in non_renderable} == {
        "IfcProject",
        "IfcSite",
        "IfcBuilding",
        "IfcDoor",
        "IfcPropertySet",
        "IfcWallType",
        "IfcRelDefinesByProperties",
    }
    assert usd_index["summary"]["unmapped_usd_count"] == 2
    assert result.quality_metrics["source_ifc_entity_count"] == 8
    assert result.quality_metrics["mapped_count"] == 8
    assert result.quality_metrics["unmapped_count"] == 0
    assert result.quality_metrics["unmapped_usd_count"] == 2
    assert result.quality_metrics["coverage_ratio"] == 1.0
    phase_timings = result.quality_metrics["phase_timings"]
    assert phase_timings["ifc_open"]["status"] == "completed"
    assert phase_timings["source_entity_enumeration"]["status"] == "completed"
    assert phase_timings["geometry_iteration"]["status"] == "completed"
    assert phase_timings["mesh_authoring"]["status"] == "completed"
    assert phase_timings["non_renderable_entity_materialization"]["status"] == "completed"
    assert phase_timings["stage_save"]["status"] == "completed"
    assert phase_timings["stage_reopen"]["status"] == "completed"
    assert phase_timings["conversion_total"]["duration_seconds"] >= 0


def test_ifcopenshell_converter_rejects_metadata_only_usd(monkeypatch, tmp_path: Path):
    _install_fake_converter_modules(monkeypatch, shapes=[_FakeShape("guid-1", geometry=_FakeDegenerateGeometry())])
    source_path = tmp_path / "source.ifc"
    source_path.write_text("ISO-10303-21;\nEND-ISO-10303-21;\n", encoding="utf-8")

    with pytest.raises(ConversionAdapterError, match="no renderable mesh prims"):
        IfcOpenShellUsdConverter().convert(
            source_path=source_path,
            output_dir=tmp_path / "derived",
            job={"source_artifact_id": "source_test"},
            generate_mapping=True,
        )

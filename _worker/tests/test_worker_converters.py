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
    entity_index = json.loads(result.entity_index_path.read_text(encoding="utf-8"))

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
    assert mapping["summary"]["materialization_strategy"] == "sidecar"
    assert mapping["summary"]["sidecar_carrier_count"] == 7
    assert {item["reason"] for item in mapping["unmapped_usd_prims"]} == {
        "missing_source_guid",
        "unknown_source_guid",
    }
    assert all(not str(item.get("ifc_guid") or "").startswith("shape_") for item in mapping["items"])
    # Under the sidecar carrier strategy, non-renderable IFC entities are NOT authored as USD prims —
    # they live in entity_index.json with stable IFC traceability fields.
    non_renderable_usd_prims = [item for item in usd_index["prims"] if item.get("renderable") is False]
    assert non_renderable_usd_prims == []
    sidecar_classes = {entry["ifc_class"] for entry in entity_index["entities"]}
    assert sidecar_classes == {
        "IfcProject",
        "IfcSite",
        "IfcBuilding",
        "IfcDoor",
        "IfcPropertySet",
        "IfcWallType",
        "IfcRelDefinesByProperties",
    }
    assert entity_index["materialization_strategy"] == "sidecar"
    assert entity_index["summary"]["sidecar_entity_count"] == 7
    assert all(entry.get("renderable") is False for entry in entity_index["entities"])
    # mapping items for sidecar-carried entities have usd_prim_path=None (viewer filter at Window.tsx
    # drops them from the highlight list; they remain present in the mapping document for coverage).
    sidecar_mapping_items = [item for item in mapping["items"] if item.get("usd_prim_path") is None]
    assert len(sidecar_mapping_items) == 7
    assert all(item.get("carrier") == "sidecar" for item in sidecar_mapping_items)
    assert usd_index["summary"]["unmapped_usd_count"] == 2
    assert result.quality_metrics["source_ifc_entity_count"] == 8
    assert result.quality_metrics["mapped_count"] == 8
    assert result.quality_metrics["unmapped_count"] == 0
    assert result.quality_metrics["unmapped_usd_count"] == 2
    assert result.quality_metrics["coverage_ratio"] == 1.0
    assert result.quality_metrics["materialization_strategy"] == "sidecar"
    assert result.quality_metrics["sidecar_carrier_count"] == 7
    phase_timings = result.quality_metrics["phase_timings"]
    assert phase_timings["ifc_open"]["status"] == "completed"
    assert phase_timings["source_entity_enumeration"]["status"] == "completed"
    assert phase_timings["geometry_iteration"]["status"] == "completed"
    assert phase_timings["mesh_authoring"]["status"] == "completed"
    assert phase_timings["non_renderable_entity_materialization"]["status"] == "completed"
    assert phase_timings["stage_save"]["status"] == "completed"
    assert phase_timings["stage_reopen"]["status"] == "completed"
    assert phase_timings["conversion_total"]["duration_seconds"] >= 0


def test_ifcopenshell_converter_records_source_enumeration_diagnostics(monkeypatch, tmp_path: Path):
    _install_fake_converter_modules(monkeypatch)
    source_path = tmp_path / "source.ifc"
    source_path.write_text("ISO-10303-21;\nEND-ISO-10303-21;\n", encoding="utf-8")
    progress_path = tmp_path / "phase.json"

    result = IfcOpenShellUsdConverter().convert(
        source_path=source_path,
        output_dir=tmp_path / "derived",
        job={"source_artifact_id": "source_test", "phase_progress_path": str(progress_path)},
        generate_mapping=True,
    )

    source_timing = result.quality_metrics["phase_timings"]["source_entity_enumeration"]
    assert source_timing["status"] == "completed"
    assert source_timing["details"]["enumerated_entity_count"] == 8
    assert source_timing["details"]["fallback_used"] is False
    assert source_timing["details"]["last_operation"] == "append_row"
    assert source_timing["details"]["last_ifc_class"] == "IfcRelDefinesByProperties"
    assert source_timing["details"]["elapsed_seconds"] >= 0

    progress = json.loads(progress_path.read_text(encoding="utf-8"))
    assert progress["phase_timings"]["source_entity_enumeration"]["details"]["enumerated_entity_count"] == 8


def test_ifcopenshell_converter_records_fine_grained_source_profile_when_enabled(monkeypatch, tmp_path: Path):
    _install_fake_converter_modules(monkeypatch)
    source_path = tmp_path / "source.ifc"
    source_path.write_text("ISO-10303-21;\nEND-ISO-10303-21;\n", encoding="utf-8")

    result = IfcOpenShellUsdConverter().convert(
        source_path=source_path,
        output_dir=tmp_path / "derived",
        job={"source_artifact_id": "source_test", "profile_source_entity_enumeration": True},
        generate_mapping=True,
    )

    details = result.quality_metrics["phase_timings"]["source_entity_enumeration"]["details"]
    profile = details["profile"]
    assert profile["iteration_seconds"] >= 0
    assert profile["id_extraction_seconds"] >= 0
    assert profile["class_extraction_seconds"] >= 0
    assert profile["guid_extraction_seconds"] >= 0
    assert profile["name_extraction_seconds"] >= 0
    assert profile["row_append_seconds"] >= 0


def test_ifcopenshell_converter_rejects_product_only_source_entity_fallback():
    class ProductOnlyFallbackModel:
        schema = "IFC4"

        def __iter__(self):
            raise TypeError("all-entity iteration unavailable")

        def by_type(self, name: str):
            if name == "IfcProduct":
                return [_FakeProduct("guid-1", "IfcWall", "Product-only wall")]
            return []

    with pytest.raises(ConversionAdapterError, match="all-entity iteration"):
        IfcOpenShellUsdConverter()._source_entities(ProductOnlyFallbackModel())


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


def test_sidecar_carrier_covers_every_source_entity_without_synthetic_guid(monkeypatch, tmp_path: Path):
    """§5.1 + §5.2: sidecar must not drop non-product / non-GUID entities or synthesize GUIDs."""
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
    entity_index = json.loads(result.entity_index_path.read_text(encoding="utf-8"))

    # source count == 8 (7 IfcProducts + IfcRelDefinesByProperties)
    assert mapping["summary"]["source_ifc_entity_count"] == 8
    # mapped_count + unmapped_count == source_ifc_entity_count (§5.1 hard invariant)
    assert mapping["summary"]["mapped_count"] + mapping["summary"]["unmapped_ifc_count"] == 8
    # 1 renderable mapped + 7 sidecar = 8 mapped
    assert mapping["summary"]["mapped_count"] == 8
    # Sidecar carrier holds non-renderable IFC entities including IfcRelDefinesByProperties
    # (non-product) and IfcPropertySet (non-product). None of these are dropped.
    sidecar_classes = {entry["ifc_class"] for entry in entity_index["entities"]}
    assert "IfcRelDefinesByProperties" in sidecar_classes
    assert "IfcPropertySet" in sidecar_classes
    # §5.2: no synthetic IDs masquerading as real GUIDs in either artifact.
    for entry in entity_index["entities"]:
        guid = entry.get("ifc_guid")
        if guid is not None:
            assert not str(guid).startswith("shape_")
            assert not str(guid).startswith("synthetic_")
    for item in mapping["items"]:
        guid = item.get("ifc_guid")
        if guid is not None:
            assert not str(guid).startswith("shape_")
    # §5.2: sidecar entries with no real GUID keep ifc_guid as None / falsy (no fabrication)
    fake_entity = next(entry for entry in entity_index["entities"] if entry["ifc_class"] == "IfcRelDefinesByProperties")
    assert fake_entity.get("ifc_guid") in (None, "")
    # §5.2: sidecar-only entities are NOT counted twice in mapped_count.
    assert mapping["summary"]["mapped_count"] == 8
    assert mapping["summary"]["coverage_ratio"] == 1.0


def test_materialization_diagnostics_are_additive(monkeypatch, tmp_path: Path):
    """§5.3: new diagnostics must be additive — existing payload keys still present."""
    _install_fake_converter_modules(monkeypatch)
    source_path = tmp_path / "source.ifc"
    source_path.write_text("ISO-10303-21;\nEND-ISO-10303-21;\n", encoding="utf-8")

    result = IfcOpenShellUsdConverter().convert(
        source_path=source_path,
        output_dir=tmp_path / "derived",
        job={"source_artifact_id": "source_test"},
        generate_mapping=True,
    )

    quality = result.quality_metrics
    # New additive fields exist
    assert quality["materialization_strategy"] == "sidecar"
    assert quality["sidecar_carrier_count"] == 7
    # Pre-existing payload keys still present and unchanged in semantics
    for key in (
        "source_ifc_entity_count",
        "usd_prim_count",
        "mapped_entity_count",
        "unmapped_entity_count",
        "mapped_count",
        "unmapped_count",
        "coverage_ratio",
        "coverage_denominator",
        "minimum_coverage_baseline_locked",
        "minimum_coverage_ratio",
        "coverage_status",
        "phase_timings",
        "hard_quality_gates",
    ):
        assert key in quality, f"missing existing payload key {key!r}"
    # materialization phase timing has the new diagnostic block as nested optional details.
    materialization_timing = quality["phase_timings"]["non_renderable_entity_materialization"]
    assert materialization_timing["status"] == "completed"
    details = materialization_timing.get("details")
    if details is not None:
        assert details["materialization_strategy"] == "sidecar"
        assert details["materialized_entity_count"] == 7
        assert details["fallback_used"] is False


def test_materialization_progress_writes_current_position(monkeypatch, tmp_path: Path):
    """§5.4: long-running materialization must publish progress with current operation + count."""
    _install_fake_converter_modules(monkeypatch)
    source_path = tmp_path / "source.ifc"
    source_path.write_text("ISO-10303-21;\nEND-ISO-10303-21;\n", encoding="utf-8")
    progress_path = tmp_path / "phase.json"

    result = IfcOpenShellUsdConverter().convert(
        source_path=source_path,
        output_dir=tmp_path / "derived",
        job={"source_artifact_id": "source_test", "phase_progress_path": str(progress_path)},
        generate_mapping=True,
    )

    progress = json.loads(progress_path.read_text(encoding="utf-8"))
    materialization = progress["phase_timings"]["non_renderable_entity_materialization"]
    # The final progress write reports completion of the sidecar carrier path.
    assert materialization["status"] in {"running", "completed"}
    if "details" in materialization:
        details = materialization["details"]
        assert "materialized_entity_count" in details
        assert "elapsed_seconds" in details
        assert details["materialization_strategy"] == "sidecar"
        assert details["last_operation"] in {"sidecar_append", "append_row", "completed"}
    assert result.quality_metrics["materialization_strategy"] == "sidecar"


def test_sidecar_carrier_contains_all_non_renderable_identities(monkeypatch, tmp_path: Path):
    """§5.5: entity_index.json must contain every non-renderable IFC entity identity."""
    _install_fake_converter_modules(monkeypatch)
    source_path = tmp_path / "source.ifc"
    source_path.write_text("ISO-10303-21;\nEND-ISO-10303-21;\n", encoding="utf-8")

    result = IfcOpenShellUsdConverter().convert(
        source_path=source_path,
        output_dir=tmp_path / "derived",
        job={"source_artifact_id": "source_test"},
        generate_mapping=True,
    )

    assert result.entity_index_path is not None
    assert result.entity_index_path.is_file()
    entity_index = json.loads(result.entity_index_path.read_text(encoding="utf-8"))
    assert entity_index["source_artifact_id"] == "source_test"
    assert entity_index["mapping_method"] == "ifc_entity_to_sidecar_index"
    assert entity_index["materialization_strategy"] == "sidecar"
    # Required stable IFC traceability fields per spec.
    for entry in entity_index["entities"]:
        for required in ("ifc_entity_key", "ifc_entity_id", "ifc_class", "name"):
            assert required in entry, f"sidecar entry missing required field {required!r}"
        # GUID is optional but the key must be present (None allowed when entity has no GlobalId)
        assert "ifc_guid" in entry
        assert entry["renderable"] is False
    # All seven non-renderable classes that previously became Xform prims are now in the sidecar.
    classes = {entry["ifc_class"] for entry in entity_index["entities"]}
    assert classes == {
        "IfcProject",
        "IfcSite",
        "IfcBuilding",
        "IfcDoor",
        "IfcPropertySet",
        "IfcWallType",
        "IfcRelDefinesByProperties",
    }


def test_usd_prim_strategy_preserves_legacy_xform_authoring(monkeypatch, tmp_path: Path):
    """Regression: explicitly opting into materialization_strategy=usd_prim retains the legacy path."""
    _install_fake_converter_modules(monkeypatch)
    source_path = tmp_path / "source.ifc"
    source_path.write_text("ISO-10303-21;\nEND-ISO-10303-21;\n", encoding="utf-8")

    result = IfcOpenShellUsdConverter().convert(
        source_path=source_path,
        output_dir=tmp_path / "derived",
        job={"source_artifact_id": "source_test", "materialization_strategy": "usd_prim"},
        generate_mapping=True,
    )

    # In usd_prim mode no sidecar artifact is written.
    assert result.entity_index_path is None
    assert result.quality_metrics["materialization_strategy"] == "usd_prim"
    assert result.quality_metrics["sidecar_carrier_count"] == 0
    usd_index = json.loads(result.usd_index_path.read_text(encoding="utf-8"))
    non_renderable_classes = {
        item["ifc_class"]
        for item in usd_index["prims"]
        if item.get("renderable") is False
    }
    assert "IfcProject" in non_renderable_classes


def test_sidecar_carrier_picks_up_no_guid_geometry_shape_entities(monkeypatch, tmp_path: Path):
    """Carrier rule MUST cover source IFC entities lacking ifc_guid (geometry-shape entries
    without GlobalId). They land in entity_index.json with ifc_guid=None and still count
    toward mapped_count under the all-entity coverage denominator.
    """
    _install_fake_converter_modules(monkeypatch)
    source_path = tmp_path / "source.ifc"
    source_path.write_text("ISO-10303-21;\nEND-ISO-10303-21;\n", encoding="utf-8")

    result = IfcOpenShellUsdConverter().convert(
        source_path=source_path,
        output_dir=tmp_path / "derived",
        job={"source_artifact_id": "source_test"},
        generate_mapping=True,
    )

    entity_index = json.loads(result.entity_index_path.read_text(encoding="utf-8"))
    no_guid_entries = [entry for entry in entity_index["entities"] if entry.get("ifc_guid") in (None, "")]
    assert no_guid_entries, "expected at least one no-GUID source entity in the sidecar carrier"
    for entry in no_guid_entries:
        assert entry["ifc_entity_key"]
        assert entry["ifc_entity_id"] is not None
        assert entry["ifc_class"]
        assert entry["renderable"] is False


def test_quality_metrics_record_no_guid_entity_count(monkeypatch, tmp_path: Path):
    """quality_metrics MUST expose the additive no_guid_entity_count diagnostic that counts
    every source IFC entity lacking ifc_guid (independent of which carrier picked it up).
    """
    _install_fake_converter_modules(monkeypatch)
    source_path = tmp_path / "source.ifc"
    source_path.write_text("ISO-10303-21;\nEND-ISO-10303-21;\n", encoding="utf-8")

    result = IfcOpenShellUsdConverter().convert(
        source_path=source_path,
        output_dir=tmp_path / "derived",
        job={"source_artifact_id": "source_test"},
        generate_mapping=True,
    )

    quality = result.quality_metrics
    # _FakeModel emits exactly one entity without GlobalId (IfcRelDefinesByProperties via _FakeEntity).
    assert quality["no_guid_entity_count"] == 1
    mapping = json.loads(result.mapping_path.read_text(encoding="utf-8"))
    assert mapping["summary"]["no_guid_entity_count"] == 1


def test_clean_fixture_locks_baseline_and_reports_coverage_pass(monkeypatch, tmp_path: Path):
    """When every source IFC entity resolves to at least one carrier, the per-fixture
    coverage baseline MUST lock with coverage_status=pass — the precondition for the
    batch-level minimum_coverage_locked gate.
    """
    _install_fake_converter_modules(monkeypatch)
    source_path = tmp_path / "source.ifc"
    source_path.write_text("ISO-10303-21;\nEND-ISO-10303-21;\n", encoding="utf-8")

    result = IfcOpenShellUsdConverter().convert(
        source_path=source_path,
        output_dir=tmp_path / "derived",
        job={"source_artifact_id": "source_test"},
        generate_mapping=True,
    )

    quality = result.quality_metrics
    assert quality["unmapped_count"] == 0
    assert quality["minimum_coverage_baseline_locked"] is True
    assert quality["coverage_status"] == "pass"
    assert quality["threshold_status"] == "locked"
    assert quality["issue_to_real_prim_readiness"] is True
    mapping = json.loads(result.mapping_path.read_text(encoding="utf-8"))
    assert mapping["summary"]["minimum_coverage_baseline_locked"] is True
    assert mapping["summary"]["coverage_status"] == "pass"
    assert mapping["coverage_policy"]["minimum_coverage_baseline_locked"] is True


def test_mapped_renderable_and_sidecar_counts_do_not_overlap(monkeypatch, tmp_path: Path):
    """The renderable USD prim carrier and the sidecar carrier partition mapped_count
    without overlap: mapped_renderable_count + sidecar_carrier_count = mapped_count.
    """
    _install_fake_converter_modules(monkeypatch)
    source_path = tmp_path / "source.ifc"
    source_path.write_text("ISO-10303-21;\nEND-ISO-10303-21;\n", encoding="utf-8")

    result = IfcOpenShellUsdConverter().convert(
        source_path=source_path,
        output_dir=tmp_path / "derived",
        job={"source_artifact_id": "source_test"},
        generate_mapping=True,
    )

    quality = result.quality_metrics
    assert quality["mapped_renderable_count"] == 1  # only guid-1 in the _FakeModel produces a mesh
    assert quality["sidecar_carrier_count"] == 7
    assert quality["mapped_count"] == quality["mapped_renderable_count"] + quality["sidecar_carrier_count"]
    assert quality["mapped_count"] + quality["unmapped_count"] == quality["source_ifc_entity_count"]

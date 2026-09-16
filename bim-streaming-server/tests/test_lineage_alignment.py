"""schedule.csv ↔ IFC ↔ USDC lineage alignment report.

Every generated report is checked against the repo's executable contract
(`tests/contracts/lineage_alignment_report.json`) and its semantic validators,
the same rules the coordinator applies when it reads the report back.
"""

import csv
import importlib.util
import io
import json
import sys
import uuid
from pathlib import Path

import jsonschema
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

from lineage_alignment import (  # noqa: E402
    CSV_COLUMNS,
    AlignmentReportError,
    ReportIdentity,
    ScheduleCsvError,
    ScheduleRow,
    annotate_mapping,
    build_alignment_report,
    ifc_guid_compress,
    ifc_guid_expand,
    read_schedule_csv,
    render_alignment_csv,
    write_alignment_report,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
CONTRACT = json.loads(
    (REPO_ROOT / "tests" / "contracts" / "lineage_alignment_report.json").read_text(encoding="utf-8")
)
_SEMANTIC_SPEC = importlib.util.spec_from_file_location(
    "lineage_semantic_validators",
    REPO_ROOT / "tests" / "contracts" / "lineage" / "semantic_validators.py",
)
semantic = importlib.util.module_from_spec(_SEMANTIC_SPEC)
_SEMANTIC_SPEC.loader.exec_module(semantic)
SCHEMA = jsonschema.Draft202012Validator(CONTRACT, format_checker=jsonschema.FormatChecker())

IDENTITY = ReportIdentity(
    source_bundle_id="mw_0123456789abcdef",
    pipeline_job_id="ifcready_1789383057661_c095b1eb",
    attempt_id="stream_conv_20260916120000_abcd1234",
    result_id="stream_conv_20260916120000_abcd1234",
)
GENERATED_AT = "2026-09-16T12:00:00.000000Z"


def guid(n: int) -> tuple[str, str]:
    """(UUID36 upper-case as Revit writes it, IFC GlobalId22) for a test identity."""
    value = uuid.UUID(int=(n << 64) | (0x4000 << 48) | n)
    return str(value).upper(), semantic.ifc_guid_compress(str(value))


def root(ifc_class: str, global_id: str) -> str:
    return semantic.usd_element_root_path(ifc_class, global_id)


def assert_contract_valid(document: dict) -> None:
    errors = sorted(SCHEMA.iter_errors(document), key=lambda error: list(error.path))
    assert errors == [], [f"{list(error.path)}: {error.message}" for error in errors]
    assert semantic.validate_alignment_report(document) == []


# ── GUID codec ───────────────────────────────────────────────────────────────


def test_guid_codec_matches_contract_validators_and_round_trips():
    for n in (0, 1, 7, 12345):
        raw, global_id = guid(n)
        assert ifc_guid_compress(raw) == global_id
        assert ifc_guid_expand(global_id) == raw.lower()
    assert ifc_guid_compress("ffffffff-ffff-ffff-ffff-ffffffffffff") == "3" + "$" * 21
    with pytest.raises(ValueError):
        ifc_guid_compress("not-a-guid")
    with pytest.raises(ValueError):
        ifc_guid_expand("4" + "0" * 21)


# ── schedule.csv reading ─────────────────────────────────────────────────────


def test_read_schedule_csv_keeps_raw_strings_and_numbers_data_rows(tmp_path: Path):
    path = tmp_path / "schedule.csv"
    path.write_bytes("﻿ID,Name,IfcGUID\r\n007,Wall,ABC\r\n,Door,\r\n".encode("utf-8"))
    rows = read_schedule_csv(path)
    assert rows == [
        ScheduleRow(row_number=1, rvt_element_id="007", ifc_guid="ABC"),
        ScheduleRow(row_number=2, rvt_element_id="", ifc_guid=""),
    ]


def test_read_schedule_csv_requires_id_and_ifcguid_columns(tmp_path: Path):
    path = tmp_path / "schedule.csv"
    path.write_text("ElementId,IfcGUID\n1,x\n", encoding="utf-8")
    with pytest.raises(ScheduleCsvError):
        read_schedule_csv(path)


# ── alignment ────────────────────────────────────────────────────────────────


def test_complete_alignment_reports_full_lineage_for_every_row():
    products = {}
    rows = []
    mapping = {}
    for n in range(3):
        raw, global_id = guid(n + 1)
        products[global_id] = "IfcWall"
        mapping[global_id] = [root("IfcWall", global_id)]
        rows.append(ScheduleRow(row_number=n + 1, rvt_element_id=f"10{n}", ifc_guid=raw))

    outcome = build_alignment_report(
        identity=IDENTITY,
        schedule_rows=rows,
        eligible_products=products,
        mapping_paths=mapping,
        prim_exists=lambda path: True,
        generated_at=GENERATED_AT,
    )

    document = outcome.document
    assert_contract_valid(document)
    body = document["body"]
    assert body["counts"]["full_lineage_matched_count"] == 3
    assert body["counts"]["ifc_only_count"] == 0
    for name in ("ifc_usdc_coverage_ratio", "rvt_ifc_alignment_ratio", "rvt_ifc_usdc_lineage_ratio"):
        assert body["metrics"][name]["ratio"] == 1
        assert body["metrics"][name]["status"] == "complete"
    assert body["warning_codes"] == []
    assert [item["rvt_element_id"] for item in body["difference_sets"]["full_lineage_matched"]] == ["100", "101", "102"]


def mixed_scenario():
    walls = {n: guid(n) for n in range(1, 7)}
    unknown = {n: guid(n) for n in range(50, 55)}
    products = {walls[n][1]: "IfcWall" for n in range(1, 7)}
    products[walls[2][1]] = "IfcDoor"
    mapping = {
        walls[1][1]: [root("IfcWall", walls[1][1])],
        walls[2][1]: [root("IfcDoor", walls[2][1])],
        walls[3][1]: [root("IfcWall", walls[3][1]) + "/Body_000"],
        walls[5][1]: ["/World/Elements/IfcWall/G_" + walls[6][1]],
        walls[6][1]: [root("IfcWall", walls[6][1])],
    }
    rows = [
        ScheduleRow(1, "0001", walls[1][0]),
        ScheduleRow(2, "0002", walls[2][0].lower()),
        ScheduleRow(3, "0003", walls[3][0]),
        ScheduleRow(4, "0004", unknown[50][0]),
        ScheduleRow(5, "0005", unknown[51][0]),
        ScheduleRow(6, "0005", unknown[52][0]),
        ScheduleRow(7, "0007", walls[6][0]),
        ScheduleRow(8, "0008", walls[6][0].lower()),
        ScheduleRow(9, "  ", unknown[53][0]),
        ScheduleRow(10, "0010", ""),
        ScheduleRow(11, "0011", "not-a-guid"),
        ScheduleRow(12, "0012", walls[4][1]),
    ]
    return walls, unknown, products, mapping, rows


def test_mixed_alignment_counts_every_difference_class():
    walls, unknown, products, mapping, rows = mixed_scenario()

    outcome = build_alignment_report(
        identity=IDENTITY,
        schedule_rows=rows,
        eligible_products=products,
        mapping_paths=mapping,
        prim_exists=lambda path: True,
        generated_at=GENERATED_AT,
    )

    document = outcome.document
    assert_contract_valid(document)
    body = document["body"]
    assert body["counts"] == {
        "csv_total_count": 12,
        "csv_valid_count": 4,
        "eligible_ifc_product_count": 6,
        "duplicate_rvt_id_count": 1,
        "duplicate_ifc_guid_count": 1,
        "invalid_row_count": 8,
        "csv_only_count": 1,
        "ifc_only_count": 3,
        "ifc_usdc_unmapped_count": 3,
        "full_lineage_matched_count": 2,
    }
    metrics = body["metrics"]
    assert (metrics["ifc_usdc_coverage_ratio"]["numerator"], metrics["ifc_usdc_coverage_ratio"]["ratio"]) == (3, 0.5)
    assert (metrics["rvt_ifc_alignment_ratio"]["numerator"], metrics["rvt_ifc_alignment_ratio"]["ratio"]) == (3, 0.75)
    assert (metrics["rvt_ifc_usdc_lineage_ratio"]["numerator"], metrics["rvt_ifc_usdc_lineage_ratio"]["ratio"]) == (2, 0.5)

    sets = body["difference_sets"]
    assert sets["csv_only"] == [{
        "rvt_element_id": "0004",
        "ifc_uuid36_raw": unknown[50][0],
        "ifc_uuid36": unknown[50][0].lower(),
        "ifc_global_id22": unknown[50][1],
        "reason_code": "ifc_product_not_found",
    }]
    unmapped = {item["ifc_global_id22"]: item for item in sets["ifc_usdc_unmapped"]}
    assert unmapped[walls[3][1]]["reason_code"] == "unstable_child_prim_target"
    assert unmapped[walls[3][1]]["observed_prim_path"] == root("IfcWall", walls[3][1]) + "/Body_000"
    assert unmapped[walls[4][1]]["reason_code"] == "prim_not_found"
    assert unmapped[walls[5][1]]["reason_code"] == "prim_token_mismatch"
    assert {item["ifc_global_id22"] for item in sets["ifc_only"]} == {walls[4][1], walls[5][1], walls[6][1]}
    assert sets["duplicate_rvt_ids"] == [{"rvt_element_id": "0005", "occurrence_count": 2}]
    assert sets["duplicate_ifc_guids"] == [{"ifc_uuid36": walls[6][0].lower(), "occurrence_count": 2}]
    reasons = {item["row_number"]: item["reason_code"] for item in sets["invalid_rows"]}
    assert reasons == {
        5: "duplicate_id", 6: "duplicate_id", 7: "duplicate_guid", 8: "duplicate_guid",
        9: "missing_id", 10: "missing_guid", 11: "invalid_guid_format", 12: "invalid_guid_format",
    }
    assert body["warning_codes"] == sorted([
        "IFC_PRODUCTS_WITHOUT_SCHEDULE_ROW",
        "IFC_USDC_UNMAPPED",
        "RVT_IFC_UNMATCHED_ROWS",
        "SCHEDULE_DUPLICATE_IFC_GUIDS",
        "SCHEDULE_DUPLICATE_RVT_IDS",
        "SCHEDULE_IFCGUID_GLOBALID22_FORMAT",
        "SCHEDULE_ROWS_INVALID",
        "UNSTABLE_CHILD_PRIM_TARGET",
    ])


def test_missing_prim_in_usd_counts_as_unmapped():
    raw, global_id = guid(9)
    path = root("IfcWall", global_id)
    outcome = build_alignment_report(
        identity=IDENTITY,
        schedule_rows=[ScheduleRow(1, "9", raw)],
        eligible_products={global_id: "IfcWall"},
        mapping_paths={global_id: [path]},
        prim_exists=lambda candidate: candidate != path,
        generated_at=GENERATED_AT,
    )
    assert_contract_valid(outcome.document)
    body = outcome.document["body"]
    assert body["difference_sets"]["ifc_usdc_unmapped"][0]["reason_code"] == "prim_not_found"
    assert body["counts"]["full_lineage_matched_count"] == 0


def test_missing_schedule_leaves_rvt_metrics_not_evaluable():
    _raw, global_id = guid(3)
    outcome = build_alignment_report(
        identity=IDENTITY,
        schedule_rows=None,
        eligible_products={global_id: "IfcSlab"},
        mapping_paths={global_id: [root("IfcSlab", global_id)]},
        prim_exists=lambda path: True,
        generated_at=GENERATED_AT,
        warning_codes=["SCHEDULE_CSV_MISSING"],
    )
    assert_contract_valid(outcome.document)
    metrics = outcome.document["body"]["metrics"]
    assert metrics["rvt_ifc_alignment_ratio"] == {
        "numerator": 0, "denominator": 0, "ratio": None, "status": "not_evaluable",
        "denominator_scope": "csv_valid_count",
    }
    assert metrics["rvt_ifc_usdc_lineage_ratio"]["status"] == "not_evaluable"
    assert metrics["ifc_usdc_coverage_ratio"]["status"] == "complete"
    assert "SCHEDULE_CSV_MISSING" in outcome.document["body"]["warning_codes"]


def test_no_eligible_products_leaves_coverage_not_evaluable():
    raw, _global_id = guid(4)
    outcome = build_alignment_report(
        identity=IDENTITY,
        schedule_rows=[ScheduleRow(1, "4", raw)],
        eligible_products={},
        mapping_paths={},
        prim_exists=lambda path: True,
        generated_at=GENERATED_AT,
    )
    assert_contract_valid(outcome.document)
    metrics = outcome.document["body"]["metrics"]
    assert metrics["ifc_usdc_coverage_ratio"]["status"] == "not_evaluable"
    assert metrics["rvt_ifc_alignment_ratio"]["ratio"] == 0
    assert metrics["rvt_ifc_alignment_ratio"]["status"] == "partial"


def test_ratio_is_truncated_not_rounded():
    products, rows, mapping = {}, [], {}
    for n in range(3):
        raw, global_id = guid(n + 20)
        products[global_id] = "IfcWall"
        mapping[global_id] = [root("IfcWall", global_id)]
        if n < 2:
            rows.append(ScheduleRow(n + 1, str(n), raw))
    outcome = build_alignment_report(
        identity=IDENTITY,
        schedule_rows=rows,
        eligible_products=products,
        mapping_paths={key: value for key, value in mapping.items() if key != next(iter(mapping))},
        prim_exists=lambda path: True,
        generated_at=GENERATED_AT,
    )
    assert_contract_valid(outcome.document)
    assert outcome.document["body"]["metrics"]["ifc_usdc_coverage_ratio"]["ratio"] == 0.6666666666


# ── CSV and mapping annotations ──────────────────────────────────────────────


def test_csv_lists_every_schedule_row_and_ifc_difference():
    walls, _unknown, products, mapping, rows = mixed_scenario()
    outcome = build_alignment_report(
        identity=IDENTITY,
        schedule_rows=rows,
        eligible_products=products,
        mapping_paths=mapping,
        prim_exists=lambda path: True,
        generated_at=GENERATED_AT,
    )
    text = render_alignment_csv(outcome)
    assert "\r" not in text
    parsed = list(csv.DictReader(io.StringIO(text)))
    assert tuple(parsed[0].keys()) == CSV_COLUMNS == tuple(semantic.CSV_REPORT_COLUMNS)
    by_row = {line["row_number"]: line for line in parsed if line["row_number"]}
    assert sorted(by_row, key=int) == [str(n) for n in range(1, 13)]
    assert by_row["1"]["alignment_class"] == "full_lineage_matched"
    assert by_row["3"]["alignment_class"] == "ifc_usdc_unmapped"
    assert by_row["3"]["reason_code"] == "unstable_child_prim_target"
    assert by_row["4"]["alignment_class"] == "csv_only"
    assert by_row["9"]["alignment_class"] == "invalid_row"
    assert by_row["9"]["rvt_element_id"] == ""
    classes = [line["alignment_class"] for line in parsed if not line["row_number"]]
    assert classes.count("ifc_only") == 3
    assert classes.count("ifc_usdc_unmapped") == 2
    assert classes.count("duplicate_rvt_id") == 1
    assert classes.count("duplicate_ifc_guid") == 1


def test_mapping_annotations_are_additive():
    walls, _unknown, products, mapping, rows = mixed_scenario()
    outcome = build_alignment_report(
        identity=IDENTITY,
        schedule_rows=rows,
        eligible_products=products,
        mapping_paths=mapping,
        prim_exists=lambda path: True,
        generated_at=GENERATED_AT,
    )
    document = {
        "mapping_provenance": "converter_verified",
        "items": [
            {"ifc_guid": walls[1][1], "usd_prim_path": mapping[walls[1][1]][0], "entity_id": "a"},
            {"ifc_guid": walls[3][1], "usd_prim_path": mapping[walls[3][1]][0], "entity_id": "b"},
            {"ifc_guid": walls[6][1], "usd_prim_path": mapping[walls[6][1]][0], "entity_id": "c"},
            {"ifc_guid": "not-eligible", "usd_prim_path": "/World/Other", "entity_id": "d"},
        ],
    }
    annotated = annotate_mapping(document, outcome)
    items = annotated["items"]
    assert items[0] == {
        "ifc_guid": walls[1][1], "usd_prim_path": mapping[walls[1][1]][0], "entity_id": "a",
        "rvt_element_id": "0001", "ifc_uuid36": walls[1][0].lower(),
        "mapping_status": "full_lineage_matched", "diagnostics": [],
    }
    assert items[1]["rvt_element_id"] == "0003"
    assert items[1]["mapping_status"] == "unstable_child_prim_target"
    assert items[1]["diagnostics"] == ["unstable_child_prim_target"]
    assert items[2]["rvt_element_id"] is None
    assert items[2]["mapping_status"] == "no_schedule_row"
    assert items[3]["mapping_status"] == "not_eligible_ifc_product"
    assert items[3]["ifc_uuid36"] is None
    assert document["items"][0].keys() == {"ifc_guid", "usd_prim_path", "entity_id"}


# ── end to end with real IFC and USD files ───────────────────────────────────


def _write_ifc(path: Path, products: list[tuple[str, str, bool]]) -> None:
    import ifcopenshell

    model = ifcopenshell.file(schema="IFC4")
    for global_id, ifc_class, has_geometry in products:
        entity = model.create_entity(ifc_class, GlobalId=global_id, Name=global_id)
        if has_geometry:
            context = model.create_entity("IfcGeometricRepresentationContext", ContextType="Model")
            shape = model.create_entity(
                "IfcShapeRepresentation", ContextOfItems=context, RepresentationIdentifier="Body",
                RepresentationType="Brep", Items=[],
            )
            entity.Representation = model.create_entity("IfcProductDefinitionShape", Representations=[shape])
    model.write(str(path))


def _write_usd(path: Path, prim_paths: list[str]) -> None:
    from pxr import Usd, UsdGeom

    stage = Usd.Stage.CreateNew(str(path))
    for prim_path in prim_paths:
        UsdGeom.Xform.Define(stage, prim_path)
        UsdGeom.Mesh.Define(stage, f"{prim_path}/Body_000")
    stage.GetRootLayer().Save()


def test_write_alignment_report_uses_real_files_and_annotates_mapping(tmp_path: Path):
    raw_a, gid_a = guid(31)
    raw_b, gid_b = guid(32)
    _raw_c, gid_c = guid(33)
    ifc_path = tmp_path / "model.ifc"
    _write_ifc(ifc_path, [(gid_a, "IfcWall", True), (gid_b, "IfcDoor", True), (gid_c, "IfcBuildingStorey", False)])
    model_path = tmp_path / "model.usdc"
    _write_usd(model_path, [root("IfcWall", gid_a)])
    mapping_path = tmp_path / "element_mapping.json"
    mapping_path.write_text(json.dumps({
        "mapping_provenance": "converter_verified",
        "mock": False,
        "allow_fake_mapping": False,
        "summary": {"mapped_count": 2, "fake_mapping_count": 0},
        "items": [
            {"ifc_guid": gid_a, "usd_prim_path": root("IfcWall", gid_a)},
            {"ifc_guid": gid_b, "usd_prim_path": root("IfcDoor", gid_b)},
        ],
    }), encoding="utf-8")
    schedule_path = tmp_path / "schedule.csv"
    schedule_path.write_text(f"ID,IfcGUID\n501,{raw_a}\n502,{raw_b}\n", encoding="utf-8")
    output_dir = tmp_path / "out"

    result = write_alignment_report(
        identity=IDENTITY,
        ifc_path=ifc_path,
        model_path=model_path,
        mapping_path=mapping_path,
        schedule_path=schedule_path,
        output_dir=output_dir,
        generated_at=GENERATED_AT,
    )

    report = json.loads(Path(result["alignment_report_json_path"]).read_text(encoding="utf-8"))
    assert_contract_valid(report)
    body = report["body"]
    assert body["counts"]["eligible_ifc_product_count"] == 2
    assert body["counts"]["full_lineage_matched_count"] == 1
    assert body["difference_sets"]["ifc_usdc_unmapped"][0]["ifc_global_id22"] == gid_b
    assert body["difference_sets"]["ifc_usdc_unmapped"][0]["reason_code"] == "prim_not_found"
    assert result["lineage_alignment"]["status"] == "generated"
    assert result["lineage_alignment"]["metrics"] == body["metrics"]
    assert result["lineage_alignment"]["counts"] == body["counts"]
    assert result["lineage_alignment"]["schedule_csv"] == {"present": True, "filename": "schedule.csv"}
    csv_text = Path(result["alignment_report_csv_path"]).read_text(encoding="utf-8")
    assert csv_text.splitlines()[0] == ",".join(CSV_COLUMNS)
    mapping = json.loads(mapping_path.read_text(encoding="utf-8"))
    assert [item["mapping_status"] for item in mapping["items"]] == ["full_lineage_matched", "prim_not_found"]
    assert mapping["items"][1]["rvt_element_id"] == "502"


def test_write_alignment_report_without_schedule_still_generates(tmp_path: Path):
    _raw, gid = guid(41)
    ifc_path = tmp_path / "model.ifc"
    _write_ifc(ifc_path, [(gid, "IfcWall", True)])
    model_path = tmp_path / "model.usdc"
    _write_usd(model_path, [root("IfcWall", gid)])
    mapping_path = tmp_path / "element_mapping.json"
    mapping_path.write_text(json.dumps({"items": [{"ifc_guid": gid, "usd_prim_path": root("IfcWall", gid)}]}),
                            encoding="utf-8")

    result = write_alignment_report(
        identity=IDENTITY,
        ifc_path=ifc_path,
        model_path=model_path,
        mapping_path=mapping_path,
        schedule_path=None,
        output_dir=tmp_path / "out",
        generated_at=GENERATED_AT,
    )

    report = json.loads(Path(result["alignment_report_json_path"]).read_text(encoding="utf-8"))
    assert_contract_valid(report)
    assert report["body"]["warning_codes"] == ["IFC_PRODUCTS_WITHOUT_SCHEDULE_ROW", "SCHEDULE_CSV_MISSING"]
    assert result["lineage_alignment"]["schedule_csv"] == {"present": False, "filename": None}


@pytest.mark.parametrize(
    "schedule_bytes",
    [b"Name\nWall\n", "ID,IfcGUID\n1,\u724611\n".encode("big5")],
    ids=["missing-columns", "not-utf8"],
)
def test_write_alignment_report_treats_unreadable_schedule_as_warning(tmp_path: Path, schedule_bytes: bytes):
    _raw, gid = guid(42)
    ifc_path = tmp_path / "model.ifc"
    _write_ifc(ifc_path, [(gid, "IfcWall", True)])
    model_path = tmp_path / "model.usdc"
    _write_usd(model_path, [root("IfcWall", gid)])
    mapping_path = tmp_path / "element_mapping.json"
    mapping_path.write_text(
        json.dumps({"items": [{"ifc_guid": gid, "usd_prim_path": root("IfcWall", gid)}]}), encoding="utf-8"
    )
    schedule_path = tmp_path / "schedule.csv"
    schedule_path.write_bytes(schedule_bytes)

    result = write_alignment_report(
        identity=IDENTITY,
        ifc_path=ifc_path,
        model_path=model_path,
        mapping_path=mapping_path,
        schedule_path=schedule_path,
        output_dir=tmp_path / "out",
        generated_at=GENERATED_AT,
    )

    report = json.loads(Path(result["alignment_report_json_path"]).read_text(encoding="utf-8"))
    assert_contract_valid(report)
    assert "SCHEDULE_CSV_UNREADABLE" in report["body"]["warning_codes"]
    assert report["body"]["counts"]["csv_total_count"] == 0
    # Unreadable means unavailable: the summary and the items must not claim a schedule.
    assert result["lineage_alignment"]["schedule_csv"] == {"present": False, "filename": "schedule.csv"}
    item = json.loads(mapping_path.read_text(encoding="utf-8"))["items"][0]
    assert item["mapping_status"] == "no_schedule_row"
    assert item["diagnostics"] == ["no_schedule_row", "schedule_csv_missing"]


def test_write_alignment_report_rejects_usd_with_external_layers(tmp_path: Path):
    from pxr import Sdf

    _raw, gid = guid(44)
    ifc_path = tmp_path / "model.ifc"
    _write_ifc(ifc_path, [(gid, "IfcWall", True)])
    _write_usd(tmp_path / "other.usda", [root("IfcWall", gid)])
    model_path = tmp_path / "model.usda"
    layer = Sdf.Layer.CreateNew(str(model_path))
    layer.subLayerPaths.append("./other.usda")
    layer.Save()
    mapping_path = tmp_path / "element_mapping.json"
    mapping_path.write_text(json.dumps({"items": []}), encoding="utf-8")

    with pytest.raises(AlignmentReportError) as raised:
        write_alignment_report(
            identity=IDENTITY,
            ifc_path=ifc_path,
            model_path=model_path,
            mapping_path=mapping_path,
            schedule_path=None,
            output_dir=tmp_path / "out",
            generated_at=GENERATED_AT,
        )
    assert raised.value.code == "alignment_usd_unreadable"
    assert json.loads(mapping_path.read_text(encoding="utf-8")) == {"items": []}


def test_csv_neutralizes_spreadsheet_formulas():
    _raw, gid = guid(45)
    ids = ['=HYPERLINK("http://x","y")', "@SUM(1)", "+1", "-cmd", "\tcmd", "-2"]
    rows = [ScheduleRow(row_number=n + 1, rvt_element_id=value, ifc_guid="") for n, value in enumerate(ids)]
    outcome = build_alignment_report(
        identity=IDENTITY,
        schedule_rows=rows,
        eligible_products={gid: "IfcWall"},
        mapping_paths={gid: root("IfcWall", gid)},
        prim_exists=lambda path: True,
        generated_at=GENERATED_AT,
    )
    parsed = list(csv.DictReader(io.StringIO(render_alignment_csv(outcome))))
    written = [line["rvt_element_id"] for line in parsed if line["row_number"]]
    # Formula-looking IDs get a leading apostrophe; plain negative numbers stay numeric.
    assert written == ["'" + value for value in ids[:-1]] + ["-2"]



def test_write_alignment_report_uses_supplied_schedule_warning(tmp_path: Path):
    _raw, gid = guid(43)
    ifc_path = tmp_path / "model.ifc"
    _write_ifc(ifc_path, [(gid, "IfcWall", True)])
    model_path = tmp_path / "model.usdc"
    _write_usd(model_path, [root("IfcWall", gid)])
    mapping_path = tmp_path / "element_mapping.json"
    mapping_path.write_text(json.dumps({"items": []}), encoding="utf-8")

    result = write_alignment_report(
        identity=IDENTITY,
        ifc_path=ifc_path,
        model_path=model_path,
        mapping_path=mapping_path,
        schedule_path=None,
        schedule_warning="SCHEDULE_CSV_CHECKSUM_MISMATCH",
        output_dir=tmp_path / "out",
        generated_at=GENERATED_AT,
    )

    codes = result["lineage_alignment"]["warning_codes"]
    assert "SCHEDULE_CSV_CHECKSUM_MISMATCH" in codes
    assert "SCHEDULE_CSV_MISSING" not in codes

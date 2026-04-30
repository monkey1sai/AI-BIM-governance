import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.ifc_indexer import build_ifc_index


def test_regex_fallback_indexes_rooted_ifc_entities(tmp_path: Path):
    ifc_path = tmp_path / "source.ifc"
    ifc_path.write_text(
        "\n".join(
            [
                "ISO-10303-21;",
                "DATA;",
                "#42=IFCWALL('0BTBFw6f90Nfh9rP1dlXr7',#1,'Exterior Wall',$,$,$,$,'551956',$);",
                "ENDSEC;",
                "END-ISO-10303-21;",
            ]
        ),
        encoding="utf-8",
    )

    index = build_ifc_index(
        ifc_path,
        project_id="project_demo_001",
        model_version_id="version_demo_001",
        source_artifact_id="artifact_ifc_demo_001",
        prefer_ifcopenshell=False,
    )

    assert index["summary"]["element_count"] == 1
    assert index["elements"][0]["ifc_entity_id"] == "#42"
    assert index["elements"][0]["ifc_guid"] == "0BTBFw6f90Nfh9rP1dlXr7"
    assert index["elements"][0]["ifc_class"] == "IfcWall"
    assert index["elements"][0]["name"] == "Exterior Wall"
    assert index["elements"][0]["revit_element_id"] == "551956"
    assert "raw_line" in index["elements"][0]


def test_regex_fallback_ignores_non_global_id_string_args(tmp_path: Path):
    ifc_path = tmp_path / "source.ifc"
    ifc_path.write_text(
        "\n".join(
            [
                "ISO-10303-21;",
                "DATA;",
                "#100=IFCSHAPEREPRESENTATION(#1,'Axis','Curve2D',(#2));",
                "#101=IFCSHAPEREPRESENTATION(#1,'Body','SweptSolid',(#3));",
                "#102=IFCMATERIALCONSTITUENT('Body',$,#4,$);",
                "#103=IFCWALL('0BTBFw6f90Nfh9rP1dlXr7',#1,'Exterior Wall',$,$,$,$,'551956',$);",
                "ENDSEC;",
                "END-ISO-10303-21;",
            ]
        ),
        encoding="utf-8",
    )

    index = build_ifc_index(
        ifc_path,
        project_id="project_demo_001",
        model_version_id="version_demo_001",
        source_artifact_id="artifact_ifc_demo_001",
        prefer_ifcopenshell=False,
    )

    assert [item["ifc_guid"] for item in index["elements"]] == ["0BTBFw6f90Nfh9rP1dlXr7"]
    assert index["summary"]["element_count"] == 1

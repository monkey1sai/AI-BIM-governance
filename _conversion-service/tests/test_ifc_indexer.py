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
                "#42=IFCWALL('2VJ3sK9L000fake001',#1,'Exterior Wall',$,$,$,$,$,$);",
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
    assert index["elements"][0]["ifc_guid"] == "2VJ3sK9L000fake001"
    assert index["elements"][0]["ifc_class"] == "IfcWall"
    assert index["elements"][0]["name"] == "Exterior Wall"
    assert "raw_line" in index["elements"][0]

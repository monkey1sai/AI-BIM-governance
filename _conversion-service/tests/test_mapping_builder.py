import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.mapping_builder import build_element_mapping


def test_guid_candidate_match_uses_metadata_guid_method():
    ifc_index = {
        "elements": [
            {
                "ifc_guid": "2VJ3sK9L000fake001",
                "ifc_class": "IfcWall",
                "name": "Exterior Wall",
            }
        ]
    }
    usd_index = {
        "prims": [
            {
                "path": "/World/Wall_001",
                "type": "Mesh",
                "name": "Wall_001",
                "guid_candidates": ["2VJ3sK9L000fake001"],
            }
        ]
    }

    mapping = build_element_mapping(
        ifc_index,
        usd_index,
        project_id="project_demo_001",
        model_version_id="version_demo_001",
        source_artifact_id="artifact_ifc_demo_001",
        allow_fake_mapping=False,
    )

    assert mapping["items"][0]["mapping_method"] == "metadata_guid"
    assert mapping["items"][0]["mapping_confidence"] == 0.95
    assert mapping["items"][0]["usd_prim_path"] == "/World/Wall_001"
    assert mapping["unmapped_ifc_guids"] == []
    assert mapping["unmapped_usd_prims"] == []


def test_no_match_records_unmapped_entries_without_fake_mapping():
    ifc_index = {
        "elements": [
            {
                "ifc_guid": "2VJ3sK9L000fake001",
                "ifc_class": "IfcWall",
                "name": "Exterior Wall",
            }
        ]
    }
    usd_index = {"prims": [{"path": "/World/Unrelated", "type": "Mesh", "guid_candidates": []}]}

    mapping = build_element_mapping(
        ifc_index,
        usd_index,
        project_id="project_demo_001",
        model_version_id="version_demo_001",
        source_artifact_id="artifact_ifc_demo_001",
        allow_fake_mapping=False,
    )

    assert mapping["items"] == []
    assert mapping["unmapped_ifc_guids"] == ["2VJ3sK9L000fake001"]
    assert mapping["unmapped_usd_prims"] == ["/World/Unrelated"]
    assert all(item["mapping_method"] != "fake_for_smoke_test" for item in mapping["items"])


def test_fake_mapping_is_explicit_smoke_only():
    ifc_index = {
        "elements": [
            {
                "ifc_guid": "2VJ3sK9L000fake001",
                "ifc_class": "IfcWall",
                "name": "Exterior Wall",
            }
        ]
    }
    usd_index = {"prims": [{"path": "/World/Unrelated", "type": "Mesh", "guid_candidates": []}]}

    mapping = build_element_mapping(
        ifc_index,
        usd_index,
        project_id="project_demo_001",
        model_version_id="version_demo_001",
        source_artifact_id="artifact_ifc_demo_001",
        allow_fake_mapping=True,
    )

    assert mapping["items"][0]["mapping_method"] == "fake_for_smoke_test"
    assert mapping["items"][0]["mapping_confidence"] == 0.01
    assert mapping["summary"]["fake_mapping_count"] == 1

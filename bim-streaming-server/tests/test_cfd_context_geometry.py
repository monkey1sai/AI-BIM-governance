"""CP9b first cut: exact massing geometry and read-only common-domain estimates, no solver."""
from __future__ import annotations

import copy
import hashlib
import json
import sys
from pathlib import Path

import numpy as np
import pytest
from jsonschema import Draft202012Validator

MODULE = Path(__file__).resolve().parents[1] / "source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging"
sys.path.insert(0, str(MODULE))

from cfd_context import validate_context
from cfd_pipeline.context_geometry import context_geometry, ContextGeometryError
from test_cfd_options_estimate import service_factory, _estimate_body, _write_box_stl, _schema
from cfd_job_service import validate_estimate_request

FIXTURE = Path(__file__).resolve().parents[2] / "tests/contracts/fixtures/cfd-context-v1.json"


def draft(**changes):
    doc = json.loads(FIXTURE.read_text(encoding="utf-8"))
    doc.update(changes)
    return validate_context(doc, require_hash=False)


def stage(path, axis="Z", scale=1.0):
    from pxr import Usd, UsdGeom
    value = Usd.Stage.CreateInMemory()
    UsdGeom.SetStageUpAxis(value, axis)
    UsdGeom.SetStageMetersPerUnit(value, scale)
    value.GetRootLayer().Export(str(path))


def test_rotated_box_is_closed_outward_and_dimensioned(tmp_path):
    model = tmp_path / "model.usdc"
    stage(model)
    result = context_geometry(draft(), model)
    assert result["source_frame"] == {"up_axis": "Z", "meters_per_unit": 1.0}
    assert result["mass_count"] == 1
    assert result["bbox_m"] == {"min": [8.5, -9.0, 0.0], "max": [16.5, 1.0, 15.0]}
    mass = result["masses"][0]
    vertices = np.array(mass["vertices_m"])
    faces = np.array(mass["faces"])
    assert vertices.shape == (8, 3) and faces.shape == (12, 3)
    triangles = vertices[faces]
    normal = np.cross(triangles[:, 1] - triangles[:, 0], triangles[:, 2] - triangles[:, 0])
    assert np.all(np.einsum("ij,ij->i", normal, triangles.mean(axis=1) - vertices.mean(axis=0)) > 0)
    edges = np.sort(np.concatenate([faces[:, [0, 1]], faces[:, [1, 2]], faces[:, [2, 0]]]), axis=1)
    _, counts = np.unique(edges, axis=0, return_counts=True)
    assert np.all(counts == 2)
    volume = np.einsum("ij,ij->i", triangles[:, 0], np.cross(triangles[:, 1], triangles[:, 2])).sum() / 6
    assert volume == pytest.approx(10 * 8 * 15)


@pytest.mark.parametrize("angle", [0, 30, 45, 90, 180, 270, 359.5])
def test_rotation_vertices_match_independent_formula(tmp_path, angle):
    model = tmp_path / "model.usdc"
    stage(model)
    doc = json.loads(FIXTURE.read_text(encoding="utf-8"))
    doc["masses"][0]["rotation_degrees"] = angle
    result = context_geometry(validate_context(doc, require_hash=False), model)
    vertices = np.array(result["masses"][0]["vertices_m"])
    a = np.radians(angle)
    expected = np.array([[12.5 + x*np.cos(a) - y*np.sin(a), -4 + x*np.sin(a) + y*np.cos(a), z]
                         for x in (-5, 5) for y in (-4, 4) for z in (0, 15)])
    np.testing.assert_allclose(vertices, expected.astype(np.float32), atol=1e-6)


def test_geometry_identity_is_sorted_and_provenance_independent(tmp_path):
    model = tmp_path / "model.usdc"
    stage(model)
    doc = draft()
    doc["masses"].append({**copy.deepcopy(doc["masses"][0]), "id": "a_other"})
    doc.pop("canonical_sha256")
    a = context_geometry(validate_context(doc, require_hash=False), model)
    doc["masses"].reverse()
    doc["masses"][0]["provenance"]["note"] = "changed source note"
    b = context_geometry(validate_context(doc, require_hash=False), model)
    assert a["geometry_sha256"] == b["geometry_sha256"]
    assert a["canonical_sha256"] != b["canonical_sha256"]
    assert [m["id"] for m in a["masses"]] == ["a_other", "neighbor_01"]


@pytest.mark.parametrize("actual,declared,code", [("Z", "Y", "context_frame_mismatch"), ("Y", "Y", "context_frame_not_supported")])
def test_actual_stage_frame_is_authority(tmp_path, actual, declared, code):
    model = tmp_path / "model.usdc"
    stage(model, actual)
    doc = draft(frame={"space": "model", "units": "m", "up_axis": declared, "north_reference": "project_north"})
    with pytest.raises(ContextGeometryError) as err:
        context_geometry(doc, model)
    assert err.value.code == code


def test_metres_inputs_are_not_scaled_twice_and_unrepresentable_boxes_fail(tmp_path):
    model = tmp_path / "model.usdc"
    stage(model, scale=0.01)
    assert context_geometry(draft(), model)["bbox_m"]["max"] == [16.5, 1.0, 15.0]
    doc = json.loads(FIXTURE.read_text(encoding="utf-8"))
    doc["masses"][0].update(position_m=[1e9, 0, 0], dimensions_m=[0.001, 0.001, 1], rotation_degrees=0)
    with pytest.raises(ContextGeometryError, match="represent"):
        context_geometry(validate_context(doc, require_hash=False), model)


def setup_estimate(service_factory, **kwargs):
    client, service, conv, _ = service_factory(**kwargs)
    stage(conv / "model.usdc")
    sha = hashlib.sha256((conv / "model.usdc").read_bytes()).hexdigest()
    context = draft(source={"conversion_job_id": conv.name, "model_usdc_sha256": sha})
    (conv / "bbox_index.json").write_text(json.dumps({"items": [{"usd_prim_path": "/World/Elements/IfcWall/G_a", "bbox_world": [0, 0, 0, 20, 10, 10]}]}), encoding="utf-8")
    return client, service, conv, context


def test_common_domain_height_cells_and_read_only_limit_flags(service_factory):
    client, service, conv, context = setup_estimate(service_factory, enabled=False, env_extra={"CFD_MAX_CELLS_PER_DIRECTION": "100000"})
    body = _estimate_body(conv.name, mesh={"background_cell_m": 1.5})
    baseline = client.post("/api/cfd-estimates", json=body).json()
    context.pop("canonical_sha256")
    context["masses"][0].update(position_m=[500, 0, 0], dimensions_m=[50, 30, 80])
    context = validate_context(context, require_hash=False)
    response = client.post("/api/cfd-estimates", json={**body, "context": context})
    assert response.status_code == 200, response.text
    result = response.json()
    Draft202012Validator(_schema("cfd-estimate-v1")).validate(result)
    assert result["building_height_m"] == 80 and result["building_height_m"] > baseline["building_height_m"]
    assert result["directions"][0]["estimated_cells"] > baseline["directions"][0]["estimated_cells"]
    assert result["limits"]["max_cells_per_direction"] == 100000 and result["limits"]["exceeds_hard_cap"]
    assert result["context_geometry"]["mass_count"] == 1
    assert result["context_geometry"]["solver_submission_enabled"] is False
    assert result["geometry_source"] == "bbox_index_profile_filter_with_context"
    assert result["directions"][0]["blockage_ratio"] <= 0.03 + 1e-12
    assert service.store.list() == [] and service._queue.empty()


@pytest.mark.parametrize("change,code", [("source", "source_mismatch"), ("frame", "context_frame_mismatch"), ("hash", "invalid_request")])
def test_context_estimate_rejects_invalid_binding(service_factory, change, code):
    client, service, conv, context = setup_estimate(service_factory)
    if change == "source":
        context.pop("canonical_sha256")
        context["source"]["model_usdc_sha256"] = "a" * 64
        context = validate_context(context, require_hash=False)
    elif change == "frame":
        context.pop("canonical_sha256")
        context["frame"]["up_axis"] = "Y"
        context = validate_context(context, require_hash=False)
    else:
        context["canonical_sha256"] = "b" * 64
    response = client.post("/api/cfd-estimates", json={**_estimate_body(conv.name), "context": context})
    assert response.status_code in (400, 409)
    assert response.json()["error_code"] == code
    assert service.store.list() == [] and service._queue.empty()


def test_previous_context_shell_is_never_reused_as_main_only(service_factory):
    client, service, conv, context = setup_estimate(service_factory)
    request = validate_estimate_request({**_estimate_body(conv.name), "context": context}, max_directions=16, n_procs_max=8)
    stored = service.store.create(request)
    _write_box_stl(service.store.run_dir(stored["run_id"]) / "shell.stl", (0, 0, 0), (200, 200, 200))
    result = client.post("/api/cfd-estimates", json=_estimate_body(conv.name)).json()
    assert result["geometry_source"] == "bbox_index_profile_filter" and result["building_height_m"] == 10
    result = client.post("/api/cfd-estimates", json={**_estimate_body(conv.name), "context": context}).json()
    assert result["geometry_source"] == "bbox_index_profile_filter_with_context" and result["building_height_m"] == 15


def test_empty_context_and_unsupported_source_never_claim_geometry(service_factory):
    client, service, conv, context = setup_estimate(service_factory)
    context = draft(source=context["source"], masses=[])
    result = client.post("/api/cfd-estimates", json={**_estimate_body(conv.name), "context": context}).json()
    assert result["context_geometry"]["bbox_m"] is None and result["context_geometry"]["mass_count"] == 0
    assert result["building_height_m"] == 10
    (conv / "model.usdc").write_bytes(b"not a stage")
    context = draft(source={"conversion_job_id": conv.name, "model_usdc_sha256": hashlib.sha256(b"not a stage").hexdigest()})
    response = client.post("/api/cfd-estimates", json={**_estimate_body(conv.name), "context": context})
    assert response.status_code == 409 and response.json()["error_code"] == "context_frame_unavailable"

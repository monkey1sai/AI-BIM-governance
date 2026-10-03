"""Native metadata provenance must never authorize a solver or physical ground."""
import copy
import hashlib
import json
from pathlib import Path
import sys
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

MODULE = Path(__file__).resolve().parents[1] / "source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging"
sys.path.insert(0, str(MODULE))
from cfd_pipeline.ground_service_assessment import GroundMetadataError, read_ground_run_metadata, revalidate_ground_run_metadata, strict_json
from ground_selection_service import GroundSelectionError, register_ground_selection_routes
from test_ground_selection_service import service, draft

RUN = "cfd_test000001"
BODY = {"source_run_id": RUN, "wind_from_degrees": 0}


def native_chain(root, source):
    folder = root / RUN
    (folder / "case_w000").mkdir(parents=True)
    def put(name, doc):
        raw = json.dumps(doc, allow_nan=False).encode()
        (folder / name).write_bytes(raw)
        return hashlib.sha256(raw).hexdigest()
    case = {"schema": "cfd-case/v1", "params": {"wind_from_degrees": 0, "ground_z_m": 0, "uref_m_s": 5, "zref_m": 10, "z0_m": .5},
            "domain": {"zmin": 0}, "pedestrian_plane_height_m": 1.5, "pedestrian_plane_z_m": 1.5,
            "wind": {"wind_vector_model_xy": [0, -1], "solver_rotation_alpha_rad": 1.5707963267948966}}
    case_sha = put("case_w000/case_meta.json", case)
    record = {"schema": "cfd-run-record/v1", "run_id": RUN, "source": source, "directions": [
        {"wind_from_degrees": 0, "status": "ready", "outputs": {"case_case_meta.json": {"sha256": case_sha, "path": "/never/read/this"}}}]}
    record_sha = put("run_record.json", record)
    exclusion_sha = put("exclusions.json", {"schema": "cfd-exclusion-list/v1", "source_model_usdc_sha256": source["model_usdc_sha256"], "items": []})
    result = {"schema": "cfd-run-result/v1", "status": "ready", "run_id": RUN, "source": source,
              "directions": [{"wind_from_degrees": 0, "status": "ready", "overlay_layer": {"artifact_id": f"cfd:{RUN}:w000"}}],
              "run_record": {"filename": "run_record.json", "sha256": record_sha},
              "exclusions": {"filename": "exclusions.json", "sha256": exclusion_sha}}
    put("result.json", result)
    put("run.json", {"run_id": RUN, "status": "ready", "request": {"source": source, "wind": {"wind_from_degrees": [0]}}})
    return folder, put, result, record


@pytest.fixture
def chain(tmp_path):
    source = {"conversion_job_id": "stream_conv_test", "model_usdc_sha256": "a" * 64}
    folder, put, result, record = native_chain(tmp_path, source)
    return tmp_path, folder, put, source, result, record


def test_complete_chain_is_read_only_and_ignores_record_paths(chain, monkeypatch):
    root, folder, _, source, _, _ = chain
    before = {str(p): p.read_bytes() for p in folder.rglob("*") if p.is_file()}
    import subprocess
    monkeypatch.setattr(subprocess, "run", lambda *a, **k: pytest.fail("process started"))
    original = Path.open
    allowed = {"run.json", "result.json", "run_record.json", "exclusions.json", "case_meta.json"}
    def opened(path, *a, **k):
        assert path.name in allowed, "mesh/field/boundary read"
        return original(path, *a, **k)
    monkeypatch.setattr(Path, "open", opened)
    result = read_ground_run_metadata(root, RUN, 0, source)
    assert set(result["links"].values()) == {"verified"}
    assert result["hashes"]["case_metadata"] == hashlib.sha256(before[str(folder / "case_w000/case_meta.json")]).hexdigest()
    assert all(p.read_bytes() == raw for name, raw in before.items() for p in [Path(name)])


@pytest.mark.parametrize("file", ["case_w000/case_meta.json", "run_record.json", "exclusions.json"])
def test_declared_hash_rejects_replaced_bytes(chain, file):
    root, folder, _, source, _, _ = chain
    with (folder / file).open("ab") as handle: handle.write(b" ")
    with pytest.raises(GroundMetadataError, match="hash_mismatch"):
        read_ground_run_metadata(root, RUN, 0, source)


@pytest.mark.parametrize("mode", ["source", "run", "duplicate", "failed", "tag", "collision", "path"])
def test_wrong_source_direction_or_reference_is_rejected(chain, mode):
    root, _, put, source, result, _ = chain
    result = copy.deepcopy(result)
    if mode == "source": result["source"]["model_usdc_sha256"] = "b" * 64
    if mode == "run": result["run_id"] += "_other"
    if mode == "duplicate": result["directions"] *= 2
    if mode == "failed": result["directions"][0]["status"] = "failed"
    if mode == "tag": result["directions"][0]["overlay_layer"]["artifact_id"] += "bad"
    if mode == "collision": result["directions"].append({"wind_from_degrees": .1, "status": "ready"})
    if mode == "path": result["run_record"]["filename"] = "../run_record.json"
    put("result.json", result)
    with pytest.raises(GroundMetadataError): read_ground_run_metadata(root, RUN, 0, source)


def test_legacy_missing_chain_stays_unknown_without_reading_unbound_files(chain):
    root, folder, put, source, result, _ = chain
    result.pop("run_record"); result["exclusions"].pop("sha256")
    put("result.json", result)
    (folder / "case_w000/case_meta.json").write_text("invalid unbound metadata")
    data = read_ground_run_metadata(root, RUN, 0, source)
    assert set(data["links"].values()) == {"unknown"}
    assert data["case"] is None and data["exclusions"] is None


@pytest.mark.parametrize("raw", [b'{"a":1,"a":2}', b'{"a":NaN}', b'{"a":Infinity}', b'{"a":1e999}', b'[]', b'\xff', b'{"a":' + b'[' * 1100 + b'0' + b']' * 1100 + b'}'])
def test_invalid_json_is_static_error(raw):
    with pytest.raises(GroundMetadataError, match="invalid_json"): strict_json(raw)


def test_metadata_budget_and_status_change(chain, monkeypatch):
    root, folder, _, source, _, _ = chain
    original = Path.open
    counter = 0
    def opened(path, *a, **k):
        nonlocal counter
        if path.name == "run.json":
            counter += 1
            if counter == 2:
                with original(path, "ab") as handle: handle.write(b" ")
        return original(path, *a, **k)
    monkeypatch.setattr(Path, "open", opened)
    with pytest.raises(GroundMetadataError, match="run_changed"): read_ground_run_metadata(root, RUN, 0, source)
    (folder / "result.json").write_bytes(b" " * (2 * 1024 * 1024 + 1))
    with pytest.raises(GroundMetadataError, match="too_large") as raised: read_ground_run_metadata(root, RUN, 0, source)
    assert raised.value.status == 413


def test_fresh_source_service_report_never_claims_physical_verification(service, tmp_path):
    manifest = service.prepare("stream_conv_test", draft(service))
    source = {key: manifest[key] for key in ("conversion_job_id", "model_usdc_sha256")}
    root = tmp_path / "runs"
    native_chain(root, source)
    cfd = SimpleNamespace(ground_metadata=lambda run, deg, src: read_ground_run_metadata(root, run, deg, src),
                          revalidate_ground_metadata=lambda run, native: revalidate_ground_run_metadata(root, run, native))
    report = service.engineering_assessment("stream_conv_test", manifest["selection_id"], BODY, cfd)
    assert report["status"] == "HELD" and report["checks"]["fresh_source_verified"]
    assert not report["checks"]["selection_ledger_verified"]
    assert "selection_ledger_not_checked" in report["reasons"]
    assert all(report[key] is False for key in ("actual_ground_verified", "inlet_boundary_files_checked", "fluid_region_verified", "velocity_sampled", "solver_started"))
    assert report["relative_target_z_range_m"] == pytest.approx([2.43, 2.43])


def test_busy_invalid_missing_service_and_lock_release(service, monkeypatch):
    manifest = service.prepare("stream_conv_test", draft(service))
    with service.assessment_lock:
        with pytest.raises(GroundSelectionError) as raised: service.engineering_assessment("stream_conv_test", manifest["selection_id"], BODY, None)
        assert raised.value.status == 429
    with pytest.raises(GroundSelectionError) as raised: service.engineering_assessment("stream_conv_test", manifest["selection_id"], BODY, None)
    assert raised.value.status == 503 and not service.assessment_lock.locked()
    monkeypatch.setattr(service, "source", lambda *_: pytest.fail("source read"))
    for body in ({**BODY, "path": "/etc"}, {**BODY, "wind_from_degrees": True}, {**BODY, "wind_from_degrees": float("inf")}):
        with pytest.raises(GroundSelectionError) as raised: service.engineering_assessment("stream_conv_test", manifest["selection_id"], body, None)
        assert raised.value.status == 400


def test_internal_auth_and_chunked_budget_precede_source_io(service, monkeypatch):
    app = FastAPI(); register_ground_selection_routes(app, service.conversions)
    monkeypatch.setattr(app.state.ground_selection_service, "source", lambda *_: pytest.fail("source read"))
    client = TestClient(app)
    url = "/api/conversions/stream_conv_test/ground-surfaces/selections/ground_" + "0" * 64 + "/engineering-assessment"
    assert client.post(url, json=BODY).status_code == 403
    assert client.post(url, json=BODY, headers={"X-Internal-Conversion-Token": "wrong"}).status_code == 403
    headers = {"X-Internal-Conversion-Token": "test-only-token"}
    assert client.post(url, content=iter([b" " * 4096, b" " * 4097]), headers=headers).status_code == 413
    assert client.post(url, content=b'{"source_run_id":"cfd_test000001","wind_from_degrees":0,"wind_from_degrees":1}', headers=headers).status_code == 400
    service.conversions.settings.internal_conversion_token = ""
    assert client.post(url, json=BODY, headers=headers).status_code == 503


def test_internal_api_complete_chain_and_legacy_held(service, tmp_path):
    app = FastAPI(); register_ground_selection_routes(app, service.conversions)
    ground = app.state.ground_selection_service
    manifest = ground.prepare("stream_conv_test", draft(ground))
    source = {key: manifest[key] for key in ("conversion_job_id", "model_usdc_sha256")}
    root = tmp_path / "runs"
    _, put, result, _ = native_chain(root, source)
    app.state.cfd_service = SimpleNamespace(ground_metadata=lambda run, deg, src: read_ground_run_metadata(root, run, deg, src),
                                          revalidate_ground_metadata=lambda run, native: revalidate_ground_run_metadata(root, run, native))
    client = TestClient(app); headers = {"X-Internal-Conversion-Token": "test-only-token"}
    url = f"/api/conversions/stream_conv_test/ground-surfaces/selections/{manifest['selection_id']}/engineering-assessment"
    response = client.post(url, json=BODY, headers=headers)
    assert response.status_code == 200
    assert response.json()["status"] == "HELD"
    result.pop("run_record"); result.pop("exclusions"); put("result.json", result)
    response = client.post(url, json=BODY, headers=headers)
    assert response.status_code == 200
    assert "case_metadata_link_unknown" in response.json()["reasons"]
    assert response.json()["case_declared"]["ground_z_m"] is None


def test_source_bytes_change_during_metadata_read_is_rejected(service, tmp_path):
    manifest = service.prepare("stream_conv_test", draft(service))
    source = {key: manifest[key] for key in ("conversion_job_id", "model_usdc_sha256")}
    root = tmp_path / "runs"; native_chain(root, source)
    def changed(run, deg, src):
        result = read_ground_run_metadata(root, run, deg, src)
        path, _ = service.source("stream_conv_test")
        with path.open("ab") as handle: handle.write(b" ")
        return result
    with pytest.raises(GroundSelectionError):
        service.engineering_assessment("stream_conv_test", manifest["selection_id"], BODY, SimpleNamespace(ground_metadata=changed))
    assert not service.assessment_lock.locked()


def test_metadata_symlink_escape_is_rejected(chain, tmp_path):
    root, folder, _, source, _, _ = chain
    original = folder / "case_w000/case_meta.json"
    outside = tmp_path / "outside.json"; outside.write_bytes(original.read_bytes()); original.unlink()
    try:
        original.symlink_to(outside)
    except OSError as error:
        pytest.skip(f"platform symlink unavailable: {error.winerror}")
    with pytest.raises(GroundMetadataError, match="path_violation"): read_ground_run_metadata(root, RUN, 0, source)


@pytest.mark.parametrize("file", ["result.json", "run_record.json", "case_w000/case_meta.json", "exclusions.json"])
def test_all_captured_files_are_revalidated(chain, monkeypatch, file):
    root, folder, _, source, _, _ = chain
    original = Path.open; captured = 0
    def opened(path, *args, **kwargs):
        nonlocal captured
        if path == folder / file:
            captured += 1
            if captured == 2:
                with original(path, "ab") as handle: handle.write(b" ")
        return original(path, *args, **kwargs)
    monkeypatch.setattr(Path, "open", opened)
    with pytest.raises(GroundMetadataError, match="run_changed"): read_ground_run_metadata(root, RUN, 0, source)


def test_metadata_change_during_second_model_check_is_rejected(service, tmp_path, monkeypatch):
    manifest = service.prepare("stream_conv_test", draft(service))
    source = {key: manifest[key] for key in ("conversion_job_id", "model_usdc_sha256")}
    root = tmp_path / "runs"; folder, _, _, _ = native_chain(root, source)
    original = service._checked_faces; count = 0
    def checked(*args):
        nonlocal count
        result = original(*args); count += 1
        if count == 2:
            with (folder / "result.json").open("ab") as handle: handle.write(b" ")
        return result
    monkeypatch.setattr(service, "_checked_faces", checked)
    cfd = SimpleNamespace(ground_metadata=lambda run, deg, src: read_ground_run_metadata(root, run, deg, src),
                          revalidate_ground_metadata=lambda run, native: revalidate_ground_run_metadata(root, run, native))
    with pytest.raises(GroundSelectionError, match="run_changed"): service.engineering_assessment("stream_conv_test", manifest["selection_id"], BODY, cfd)
    assert not service.assessment_lock.locked()

"""OpenFoamCfdRunner composed with CFD Case Run (cfd-case-run-adr.md §5, tracer bullet 2).

Everything is real except the container: preprocessing voxelises a small USD model, the case
is written by ``build_case``, the sampled VTK and logs are parsed, the USD overlay layer and
the run record are produced by the pipeline. Only ``run_case_fn`` (Docker) is a fake that
leaves behind what the solver and its function objects would, and ``docker kill`` is recorded
instead of executed.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

# Import order matters: test_cfd_job_service puts the messaging extension on sys.path (there is no
# conftest.py), which is what makes the two service imports below resolvable.
from test_cfd_job_service import REPO_ROOT, FakeConverter, _request, _schema

import cfd_pipeline.openfoam_case as openfoam_case
from cfd_job_service import _OUTCOME_FAILURE_CODES, OpenFoamCfdRunner, SERVICE_STOP_ON
from cfd_pipeline.case_run import OUTCOME_KINDS
from host_native_conversion_service import build_app, load_config

# A run that converged at iteration 267: the solver log says so and solverInfo's last row is 267.
CONVERGED_LOG = "Time = 267\nSIMPLE solution converged in 267 iterations\nEnd\n"
UNCONVERGED_LOG = "Time = 599\n...\nTime = 600\nEnd\n"
CHECK_MESH_LOG = (
    "Mesh stats\n    points:           1234\n    faces:            5000\n    cells:            2000\n"
    "    Max non-orthogonality = 61.2 average: 8.1\n    Max skewness = 3.1 OK.\n\nMesh OK.\n"
)
SOLVER_INFO_DAT = (
    "# Solver information\n"
    "# Time  p_solver p_initial p_final p_iters p_converged\n"
    "1 GAMG 1 0.01 5 false\n"
    "267 GAMG 0.0009 0.00001 3 true\n"
)
PLANE_VTK = """# vtk DataFile Version 2.0
sampleSurface
ASCII
DATASET POLYDATA
POINTS 4 float
0 0 1.5
1 0 1.5
1 1 1.5
0 1 1.5
POLYGONS 2 8
3 0 1 2
3 0 2 3
POINT_DATA 4
FIELD attributes 2
U 3 4 float
1 0 0
2 0 0
3 0 0
4 0 0
p 1 4 float
0.1 0.2 0.3 0.4
"""
BUILDING_VTK = """# vtk DataFile Version 5.1
building
ASCII
DATASET POLYDATA
POINTS 4 float
0 0 0 1 0 0 1 1 0 0 1 0
POLYGONS 2 4
OFFSETS vtktypeint64
0 4
CONNECTIVITY vtktypeint64
0 1 2 3
CELL_DATA 1
SCALARS p float 1
LOOKUP_TABLE default
-2.5
"""
KILLED_EXIT_CODE = 137  # what `docker run --rm` reports after `docker kill`


def _box_triangles(lo, hi):
    import numpy as np

    x0, y0, z0 = lo
    x1, y1, z1 = hi
    v = np.array([[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], dtype=float)
    faces = [(0, 2, 1), (0, 3, 2), (4, 5, 6), (4, 6, 7), (0, 1, 5), (0, 5, 4), (1, 2, 6), (1, 6, 5), (2, 3, 7), (2, 7, 6), (3, 0, 4), (3, 4, 7)]
    return np.array([[v[a], v[b], v[c]] for a, b, c in faces])


def _small_model(path: Path) -> None:
    """Identity-style stage (same shape as tools/cfd/tests/test_preprocess.py): walls, slabs, a door, a lamp, a far beam."""
    from pxr import Gf, Usd, UsdGeom

    stage = Usd.Stage.CreateNew(str(path))
    UsdGeom.SetStageUpAxis(stage, UsdGeom.Tokens.z)
    UsdGeom.SetStageMetersPerUnit(stage, 1.0)
    world = UsdGeom.Xform.Define(stage, "/World")
    stage.SetDefaultPrim(world.GetPrim())
    for scope in ("Elements", "Overlays"):
        UsdGeom.Xform.Define(stage, f"/World/{scope}")

    def add(ifc_type, guid, lo, hi, translate=(0, 0, 0)):
        root = UsdGeom.Xform.Define(stage, f"/World/Elements/{ifc_type}/G_{guid}")
        root.GetPrim().SetCustomDataByKey("bim", {"ifc_guid": guid, "ifc_type": ifc_type})
        mesh = UsdGeom.Mesh.Define(stage, f"{root.GetPath()}/Body_000")
        tris = _box_triangles(lo, hi)
        pts = tris.reshape(-1, 3)
        mesh.CreatePointsAttr([Gf.Vec3f(*map(float, p)) for p in pts])
        mesh.CreateFaceVertexCountsAttr([3] * tris.shape[0])
        mesh.CreateFaceVertexIndicesAttr(list(range(pts.shape[0])))
        xf = Gf.Matrix4d(1.0)
        xf.SetTranslateOnly(Gf.Vec3d(*translate))
        mesh.AddTransformOp().Set(xf)

    add("IfcWall", "WALL_A", (0, 0, 0), (4, 0.3, 6))
    add("IfcWall", "WALL_A2", (5, 0, 0), (10, 0.3, 6))
    add("IfcWall", "WALL_B", (0, 0, 0), (10, 0.3, 6), translate=(0, 7.7, 0))
    add("IfcSlab", "SLAB", (0, 0, 5.7), (10, 8, 6))
    add("IfcSlab", "FLOOR", (0, 0, -0.3), (10, 8, 0))
    add("IfcWall", "WALL_C", (0, 0, 0), (0.3, 8, 6))
    add("IfcWall", "WALL_D", (9.7, 0, 0), (10, 8, 6))
    add("IfcDoor", "DOOR", (4, 0, 0), (5, 0.3, 2.2))
    add("IfcLightFixture", "LAMP", (5, 4, 5), (5.3, 4.3, 5.6))
    add("IfcBeam", "FAR_BEAM", (0, 0, 0), (3, 0.3, 0.3), translate=(200, 0, 0))
    stage.GetRootLayer().Save()


def _write_samples(case: Path) -> None:
    sample_dir = case / "postProcessing" / "samples" / "267"
    sample_dir.mkdir(parents=True, exist_ok=True)
    (sample_dir / "pedestrian_1p5m.vtk").write_text(PLANE_VTK, encoding="utf-8")
    (sample_dir / "building.vtk").write_text(BUILDING_VTK, encoding="utf-8")
    (sample_dir / "near_wall_speed.vtk").write_text(PLANE_VTK, encoding="utf-8")
    info_dir = case / "postProcessing" / "solverInfo" / "0"
    info_dir.mkdir(parents=True, exist_ok=True)
    (info_dir / "solverInfo.dat").write_text(SOLVER_INFO_DAT, encoding="utf-8")


def _fake_docker(calls: list, *, fail_wind: float | None = None, mesh_fail_wind: float | None = None, raises: BaseException | None = None,
                 samples: bool = True, unconverged_first: bool = False, on_run=None):
    """The runner port: leaves behind what Allrun / Allcontinue and the sampling function objects would.

    ``fail_wind``: the solver dies for that direction (exit 1, log present). ``mesh_fail_wind``: meshing dies
    (exit 1, no solver log). ``unconverged_first``: Allrun ends unconverged so the one-time extension runs
    Allcontinue, which converges. ``on_run(case)``: called while "the container runs"; when it returns True
    the container is treated as killed by the supervisor (non-zero exit, ``cancelled`` not set by docker).
    """

    def run(*, case_dir, script="Allrun", **kwargs):
        case = Path(case_dir)
        calls.append({"script": script, "case_dir": case, **kwargs})
        if raises is not None:
            raise raises
        meta = json.loads((case / "case_meta.json").read_text(encoding="utf-8"))
        wind = meta["wind"]["wind_from_degrees"]
        (case / "log.checkMesh").write_text(CHECK_MESH_LOG, encoding="utf-8")
        if mesh_fail_wind is not None and wind == mesh_fail_wind:
            code = 1
        elif fail_wind is not None and wind == fail_wind:
            (case / "log.simpleFoam").write_text(UNCONVERGED_LOG, encoding="utf-8")
            code = 1
        elif script == openfoam_case.CONTINUE_SCRIPT:
            (case / "log.simpleFoam.continue").write_text(CONVERGED_LOG, encoding="utf-8")
            code = 0
        else:
            (case / "log.simpleFoam").write_text(UNCONVERGED_LOG if unconverged_first else CONVERGED_LOG, encoding="utf-8")
            code = 0
        killed = bool(on_run is not None and on_run(case))
        if killed:
            code = KILLED_EXIT_CODE
        final_pass = script == openfoam_case.CONTINUE_SCRIPT or not unconverged_first
        if samples and code == 0 and final_pass:
            _write_samples(case)
        return {
            "image": kwargs.get("image"), "image_digest": "sha256:" + "ab" * 32, "exit_code": code, "elapsed_seconds": 2.0,
            "cancelled": False, "timed_out": False, "script": script, "log": str(case / "docker_run.log"),
        }

    return run


@pytest.fixture
def killed(monkeypatch):
    """Record ``docker kill`` targets instead of running docker."""
    names: list[str] = []
    monkeypatch.setattr(openfoam_case, "kill_container", lambda name: names.append(name) or True)
    return names


@pytest.fixture
def real_harness(tmp_path, killed):
    """The service with the production runner over a fake container, and a real small model to convert."""

    def make(*, run_case_fn, run_background: bool = False):
        env = {
            "STREAMING_CONVERSION_SERVICE_ROOT": str(tmp_path / "svc"),
            "STREAMING_CONVERSION_ARTIFACTS_ROOT": str(tmp_path / "svc" / "artifacts"),
            "STREAMING_CONVERSION_JOBS_DIR": str(tmp_path / "svc" / "jobs"),
            "STREAMING_CONVERSION_REPO_ROOT": str(REPO_ROOT / "bim-streaming-server"),
            "CFD_ENABLED": "true",
        }
        config = load_config(env)
        runner = OpenFoamCfdRunner(config.cfd, run_case_fn=run_case_fn, preflight_fn=lambda: None)
        app = build_app(config, converter=FakeConverter(), run_background=run_background, cfd_runner=runner)
        conv_dir = Path(config.artifacts_root) / "stream_conv_test_0001"
        conv_dir.mkdir(parents=True, exist_ok=True)
        _small_model(conv_dir / "model.usdc")
        (conv_dir / "geo_reference.json").write_text(
            json.dumps({"available": True, "true_north_degrees": 0.0, "true_north_source": "ifc", "warnings": ["true_north_default_direction"]}),
            encoding="utf-8",
        )
        sha = hashlib.sha256((conv_dir / "model.usdc").read_bytes()).hexdigest()
        service = app.state.cfd_service
        service.conversion_lookup = lambda job_id: {"conversion_job_id": job_id} if job_id == "stream_conv_test_0001" else None
        return TestClient(app), service, sha, config

    return make


def _no_host_paths(text: str, config) -> bool:
    """True when neither the native, the POSIX nor the JSON-escaped spelling of the artifacts root appears."""
    root = Path(config.artifacts_root)
    spellings = {str(root), root.as_posix(), json.dumps(str(root))[1:-1]}
    return not any(spelling in text for spelling in spellings)


def test_every_outcome_kind_is_either_handled_per_direction_or_aborts_the_run():
    handled_per_direction = {"ready", "mesh_failed", "solver_failed", "cancelled"}
    assert SERVICE_STOP_ON == frozenset(_OUTCOME_FAILURE_CODES)
    assert handled_per_direction.isdisjoint(SERVICE_STOP_ON)
    assert handled_per_direction | SERVICE_STOP_ON == set(OUTCOME_KINDS)


def test_runner_reaches_ready_through_the_real_pipeline_and_matches_the_contract(real_harness, killed):
    calls: list[dict] = []
    client, service, sha, config = real_harness(run_case_fn=_fake_docker(calls))
    resp = client.post("/api/cfd-runs", json=_request(sha))
    assert resp.status_code == 202, resp.text
    run_id = resp.json()["run_id"]

    status = client.get(f"/api/cfd-runs/{run_id}").json()
    assert status["status"] == "ready", status
    assert status["progress"] == {"directions_total": 2, "directions_done": 2}
    assert status["converged_count"] == 2 and status["sealing_suspect"] is False
    assert "current_container" not in status and killed == []

    # The container port saw exactly what the old inline sequence passed to docker.
    assert [c["container_name"] for c in calls] == [f"{run_id}_w000", f"{run_id}_w090"]
    assert all(c["image"] == config.cfd.image and c["cpus"] == 8.0 and callable(c["should_stop"]) for c in calls)

    body = client.get(f"/api/cfd-runs/{run_id}/result").json()
    _schema("cfd-run-result-v1").validate(body)
    assert [d["status"] for d in body["directions"]] == ["ready", "ready"]
    assert all(d["converged_by_residual_control"] is True and d["iterations"] == 267 and d["mesh_cells"] == 2000 for d in body["directions"])
    assert all(d["end_time_extended_to"] is None for d in body["directions"])
    assert body["preprocess"]["sealing_suspect"] is False and body["exclusions"]["counts"] == {"class_excluded": 2, "outlier": 1}
    assert "true_north_default_direction" in body["assumptions"]

    run_dir = service.store.run_dir(run_id)
    for direction in body["directions"]:
        layer = direction["overlay_layer"]
        assert direction["presentation"]["version"] == 2
        assert direction["presentation"]["sections"] == []
        assert direction["presentation"]["near_wall"]["reference"] == "computation_shell"
        assert any(p["role"] == "near_wall_speed" and not p["default_visible"] for p in direction["presentation"]["prims"])
        assert 3 <= len(direction["presentation"]["building_footprint_xy"]) <= 64
        case_meta = json.loads((run_dir / f"case_{layer['artifact_id'].split(':')[-1]}" / "case_meta.json").read_text())
        assert case_meta["params"]["presentation_version"] == 2
        assert (run_dir / layer["filename"]).is_file() and layer["artifact_id"].startswith(f"cfd:{run_id}:")
        assert client.get(f"/cfd-artifacts/{run_id}/{layer['filename']}").status_code == 200
    served = client.get(f"/cfd-artifacts/{run_id}/run_record.json")
    assert served.status_code == 200 and _no_host_paths(served.text, config), "run records must not carry host paths"
    record = served.json()
    assert [d["status"] for d in record["directions"]] == ["ready", "ready"]
    assert all({"case", "mesh", "solver", "outputs", "wind_from_degrees"} <= set(d) for d in record["directions"])
    assert record["preprocess"]["shell"]["watertight"] is True and record["source"]["model_usdc_sha256"] == sha


def test_result_carries_field_statistics_and_the_legend_and_the_exceedance_query_answers(real_harness):
    """Pedestrian Wind Field (bullet 1): the result gains U_mean/U_p95/U_min and the authored legend, and the
    exceedance query returns cfd-exceedance/v1 zones attributed to the small model's elements, cached per threshold."""
    calls: list[dict] = []
    client, service, sha, _config = real_harness(run_case_fn=_fake_docker(calls))
    request = _request(sha)
    request["wind"]["wind_from_degrees"] = [0.0]
    resp = client.post("/api/cfd-runs", json=request)
    assert resp.status_code == 202, resp.text
    run_id = resp.json()["run_id"]
    assert client.get(f"/api/cfd-runs/{run_id}").json()["status"] == "ready"
    body = client.get(f"/api/cfd-runs/{run_id}/result").json()
    _schema("cfd-run-result-v1").validate(body)
    direction = body["directions"][0]
    # PLANE_VTK: |U| = 1..4 at the four corners, two triangles -> area-weighted mean 2.33, min 1, max 4.
    assert direction["pedestrian_1p5m"]["U_magnitude_max"] == 4.0 and direction["pedestrian_1p5m"]["U_min"] == 1.0
    assert direction["pedestrian_1p5m"]["U_mean"] == pytest.approx((2.0 * 0.5 + (8.0 / 3.0) * 0.5) / 1.0)
    assert direction["legend"]["U"] == {"min": 0.0, "max": 5.0, "unit": "m/s", "prims": ["PedestrianWind_1p5m", "Streamlines", "FlowParticles", "PedestrianWindVectors", "NearWallWindSpeed"]}
    assert {p["role"] for p in direction["presentation"]["prims"]} >= {"vectors", "wind_arrow"}
    assert direction["legend"]["p"]["unit"] == "m^2/s^2" and direction["legend"]["p"]["available"] is True

    # Threshold 1.5: both triangles exceed it -> one zone of 1 m² attributed to the elements touching the square.
    answer = client.get(f"/api/cfd-runs/{run_id}/directions/w000/exceedance", params={"threshold_u_m_s": 1.5})
    assert answer.status_code == 200, answer.text
    doc = answer.json()
    _schema("cfd-exceedance-v1").validate(doc)
    assert doc["run_id"] == run_id and doc["tag"] == "w000" and doc["wind_from_degrees"] == 0.0
    assert doc["stats"]["U_max"] == 4.0 and doc["stats"]["U_min"] == 1.0 and doc["stats"]["weighting"] == "area"
    assert doc["frame"]["directions_relative_to"] == "project_north"  # the fixture model has no true north
    assert len(doc["zones"]) == 1 and doc["zones"][0]["area_m2"] == pytest.approx(1.0) and doc["zones"][0]["u_max"] == 4.0
    zone = doc["zones"][0]
    assert 1 <= len(zone["elements"]) <= 3
    assert [item["distance_m"] for item in zone["elements"]] == sorted(item["distance_m"] for item in zone["elements"])
    assert all(item["distance_m"] <= 2.0 and item["usd_prim_path"].startswith("/World/Elements/") for item in zone["elements"])
    # A threshold above every vertex leaves no zone; the first answer is served from the cache afterwards.
    assert client.get(f"/api/cfd-runs/{run_id}/directions/w000/exceedance", params={"threshold_u_m_s": 4.5}).json()["zones"] == []
    assert (run_id, "w000", 1.5) in service._exceedance_cache
    assert client.get(f"/api/cfd-runs/{run_id}/directions/w000/exceedance", params={"threshold_u_m_s": 1.5}).json() == doc
    # Refusals: threshold outside the finding bound, an unknown direction, an unknown run.
    assert client.get(f"/api/cfd-runs/{run_id}/directions/w000/exceedance", params={"threshold_u_m_s": 0.1}).status_code == 400
    assert client.get(f"/api/cfd-runs/{run_id}/directions/w000/exceedance").status_code == 400
    assert client.get(f"/api/cfd-runs/{run_id}/directions/w090/exceedance", params={"threshold_u_m_s": 2.0}).json()["error_code"] == "direction_not_found"
    assert client.get("/api/cfd-runs/cfd_20990101T000000Z_nope00/directions/w000/exceedance", params={"threshold_u_m_s": 2.0}).status_code == 404


def test_runner_hands_every_catalog_setting_to_the_engine(real_harness):
    """CFD Settings Catalog: each ENGINE_FIELDS entry reaches case_meta.params with the request's value, so a setting
    that is validated and recorded can never run with the engine default unnoticed."""
    from cfd_settings_catalog import ENGINE_FIELDS

    calls: list[dict] = []
    client, service, sha, _config = real_harness(run_case_fn=_fake_docker(calls))
    request = _request(sha)
    request["wind"] = {**request["wind"], "uref_m_s": 7.5, "zref_m": 12.0, "z0_m": 0.3}
    request["mesh"] = {
        "background_cell_m": 4.0, "surface_refinement_level": 3, "region_refinement_level": 2,
        "domain_upstream_h": 6.0, "domain_downstream_h": 16.0, "domain_lateral_h": 6.0, "domain_top_h": 6.0,
        "max_blockage_ratio": 0.04, "refinement_box_scale": 1.2, "outer_coarsening_levels": 1, "coarsening_shell_h": 1.5,
        "ground_band_height_h": None,
    }
    request["solver"] = {"end_time": 700, "n_procs": 2}
    resp = client.post("/api/cfd-runs", json=request)
    assert resp.status_code == 202, resp.text
    run_id = resp.json()["run_id"]
    assert client.get(f"/api/cfd-runs/{run_id}").json()["status"] == "ready"
    run_dir = service.store.run_dir(run_id)
    params = json.loads((run_dir / "case_w000" / "case_meta.json").read_text(encoding="utf-8"))["params"]
    for key, field in ENGINE_FIELDS.items():
        section, name = key.split(".", 1)
        assert params[field] == request[section][name], key


def test_runner_hands_the_requested_layout_to_the_engine(real_harness):
    """Settings phase B §4: the engine must run with the requested layout, not the defaults the record would imply."""
    calls: list[dict] = []
    client, service, sha, _config = real_harness(run_case_fn=_fake_docker(calls))
    layout = {"domain_upstream_h": 6.0, "refinement_box_scale": 1.5, "outer_coarsening_levels": 1}
    request = _request(sha)
    request["mesh"] = {**request["mesh"], **layout}
    resp = client.post("/api/cfd-runs", json=request)
    assert resp.status_code == 202, resp.text
    run_id = resp.json()["run_id"]
    assert client.get(f"/api/cfd-runs/{run_id}").json()["status"] == "ready"

    run_dir = service.store.run_dir(run_id)
    for tag in ("w000", "w090"):
        params = json.loads((run_dir / f"case_{tag}" / "case_meta.json").read_text(encoding="utf-8"))["params"]
        assert {name: params[name] for name in layout} == layout, tag
        assert params["ground_band_height_h"] is None and params["coarsening_shell_h"] == 1.0
    body = client.get(f"/api/cfd-runs/{run_id}/result").json()
    _schema("cfd-run-result-v1").validate(body)
    assert any("outer coarsening 1 level" in item for item in body["limitations"])
    record = client.get(f"/cfd-artifacts/{run_id}/run_record.json").json()
    refinement = record["directions"][0]["case"]["refinement"]
    assert refinement["outer_coarsening_levels"] == 1 and refinement["box_scale"] == 1.5
    assert [r["name"] for r in refinement["regions"]] == ["refinementBox", "coarseningShell1"]


def test_runner_reports_the_cost732_shortfall_of_ready_and_failed_directions(real_harness):
    """The effective-domain limitation travels from each case_meta into the result and the run record."""
    client, service, sha, _config = real_harness(run_case_fn=_fake_docker([], mesh_fail_wind=90.0))
    request = _request(sha)
    request["mesh"] = {**request["mesh"], "domain_top_h": 3}  # 3H top margin: below the COST 732 5H
    resp = client.post("/api/cfd-runs", json=request)
    assert resp.status_code == 202, resp.text
    run_id = resp.json()["run_id"]
    assert client.get(f"/api/cfd-runs/{run_id}").json()["status"] == "ready"

    expected = "Effective computational domain is below the COST 732 recommendations: top margin below 5H (wind directions 0°, 90°)."
    body = client.get(f"/api/cfd-runs/{run_id}/result").json()
    assert [d["status"] for d in body["directions"]] == ["ready", "failed"]
    assert expected in body["limitations"]  # the failed 90° direction is still named: its case was written
    record = client.get(f"/cfd-artifacts/{run_id}/run_record.json").json()
    assert expected in record["limitations"]
    assert record["directions"][0]["case"]["cost732_deviations"] == ["top_below_5H"]


def test_a_request_queued_before_the_layout_fields_runs_with_the_engine_defaults():
    """A run queued before the deploy is replayed by reconcile_on_start with its old three-key mesh block."""
    from cfd_job_service import MESH_LAYOUT_FIELDS, _layout_params

    old_mesh = {"background_cell_m": None, "surface_refinement_level": 2, "region_refinement_level": 1}
    assert _layout_params(old_mesh) == {name: getattr(openfoam_case.CaseParams, name) for name in MESH_LAYOUT_FIELDS}
    assert _layout_params({**old_mesh, "outer_coarsening_levels": 2})["outer_coarsening_levels"] == 2


def test_runner_runs_the_one_time_extension_and_reports_it(real_harness):
    calls: list[dict] = []
    client, service, sha, _config = real_harness(run_case_fn=_fake_docker(calls, unconverged_first=True))
    body = _request(sha)
    body["wind"]["wind_from_degrees"] = [0]
    run_id = client.post("/api/cfd-runs", json=body).json()["run_id"]
    assert client.get(f"/api/cfd-runs/{run_id}").json()["status"] == "ready"
    assert [(c["script"], c["container_name"]) for c in calls] == [("Allrun", f"{run_id}_w000"), (openfoam_case.CONTINUE_SCRIPT, f"{run_id}_w000_x")]
    result = client.get(f"/api/cfd-runs/{run_id}/result").json()
    _schema("cfd-run-result-v1").validate(result)
    assert result["directions"][0]["end_time_extended_to"] == 1200 and result["directions"][0]["converged_by_residual_control"] is True
    record = json.loads((service.store.run_dir(run_id) / "run_record.json").read_text(encoding="utf-8"))
    assert record["directions"][0]["solver"]["end_time_effective"] == 1200 and record["directions"][0]["solver"]["extended_once"] is True


def test_runner_passes_the_request_limit_through_and_trusts_the_preprocess_verdict(real_harness, monkeypatch):
    """cfd-case-run-adr.md §3: the sealing verdict comes from preprocess_stats.json (judged at the request's limit); the
    service reads it back and never recomputes it from the numbers."""
    from cfd_pipeline import preprocess as preprocess_module

    seen: dict = {}
    real_run_preprocess = preprocess_module.run_preprocess

    def wrapped(**kwargs):
        seen["leak_fraction_limit"] = kwargs.get("leak_fraction_limit")
        stats = real_run_preprocess(**kwargs)
        # A verdict the numbers alone would not give: the service must read it back, not recompute it.
        stats["shell"]["sealing_suspect"] = True
        (Path(kwargs["out_dir"]) / "preprocess_stats.json").write_text(json.dumps(stats), encoding="utf-8")
        return stats

    monkeypatch.setattr(preprocess_module, "run_preprocess", wrapped)
    client, service, sha, _config = real_harness(run_case_fn=_fake_docker([]))
    body = _request(sha)
    body["preprocess"]["leak_fraction_limit"] = 0.3
    resp = client.post("/api/cfd-runs", json=body)
    assert resp.status_code == 202, resp.text
    run_id = resp.json()["run_id"]
    assert seen["leak_fraction_limit"] == 0.3

    status = client.get(f"/api/cfd-runs/{run_id}").json()
    assert status["status"] == "ready" and status["sealing_suspect"] is True
    result = client.get(f"/api/cfd-runs/{run_id}/result").json()
    _schema("cfd-run-result-v1").validate(result)
    stats = json.loads((service.store.run_dir(run_id) / "pre" / "preprocess_stats.json").read_text(encoding="utf-8"))
    assert result["preprocess"]["leak_fraction_limit"] == stats["shell"]["leak_fraction_limit"] == 0.3
    assert result["preprocess"]["sealing_suspect"] is stats["shell"]["sealing_suspect"] is True
    assert result["preprocess"]["leak_fraction"] == stats["shell"]["leak_fraction"] < 0.3  # the numbers alone would say 'not suspect'
    assert "sealing_suspect_accepted" in result["assumptions"]


def test_runner_treats_a_stats_document_without_the_verdict_as_a_preprocess_failure(real_harness, monkeypatch):
    from cfd_pipeline import preprocess as preprocess_module

    real_run_preprocess = preprocess_module.run_preprocess

    def without_verdict(**kwargs):
        stats = real_run_preprocess(**kwargs)
        del stats["shell"]["sealing_suspect"]
        return stats

    monkeypatch.setattr(preprocess_module, "run_preprocess", without_verdict)
    client, _service, sha, _config = real_harness(run_case_fn=_fake_docker([]))
    run_id = client.post("/api/cfd-runs", json=_request(sha)).json()["run_id"]
    status = client.get(f"/api/cfd-runs/{run_id}").json()
    assert status["status"] == "failed" and status["failure_code"] == "preprocess_failed"


def test_runner_keeps_a_failed_direction_and_continues(real_harness):
    calls: list[dict] = []
    client, service, sha, _config = real_harness(run_case_fn=_fake_docker(calls, fail_wind=90.0))
    run_id = client.post("/api/cfd-runs", json=_request(sha)).json()["run_id"]
    status = client.get(f"/api/cfd-runs/{run_id}").json()
    # Unchanged service rule: once ready, directions_done counts the ready directions (process_run recomputes it).
    assert status["status"] == "ready" and status["progress"]["directions_done"] == 1 and status["converged_count"] == 1
    body = client.get(f"/api/cfd-runs/{run_id}/result").json()
    _schema("cfd-run-result-v1").validate(body)
    assert [d["status"] for d in body["directions"]] == ["ready", "failed"]
    assert body["directions"][1]["overlay_layer"] is None
    record = json.loads((service.store.run_dir(run_id) / "run_record.json").read_text(encoding="utf-8"))
    assert record["directions"][1] == {"wind_from_degrees": 90.0, "status": "failed", "failure_code": "solver_failed", "docker_exit_code": 1}
    assert len(calls) == 2


def test_runner_records_a_meshing_failure_by_the_missing_solver_log(real_harness):
    client, service, sha, _config = real_harness(run_case_fn=_fake_docker([], mesh_fail_wind=0.0))
    run_id = client.post("/api/cfd-runs", json=_request(sha)).json()["run_id"]
    assert client.get(f"/api/cfd-runs/{run_id}").json()["status"] == "ready"
    record = json.loads((service.store.run_dir(run_id) / "run_record.json").read_text(encoding="utf-8"))
    assert record["directions"][0] == {"wind_from_degrees": 0.0, "status": "failed", "failure_code": "mesh_failed", "docker_exit_code": 1}


def test_runner_maps_a_case_write_failure_to_mesh_failed_and_aborts(real_harness, monkeypatch, killed):
    import cfd_pipeline.case_run as case_run

    def boom(**kwargs):
        raise RuntimeError(f"cannot write {kwargs['out_dir']}")

    monkeypatch.setattr(case_run, "build_case", boom)
    calls: list[dict] = []
    client, _service, sha, config = real_harness(run_case_fn=_fake_docker(calls))
    run_id = client.post("/api/cfd-runs", json=_request(sha)).json()["run_id"]
    status = client.get(f"/api/cfd-runs/{run_id}").json()
    assert status["status"] == "failed" and status["failure_code"] == "mesh_failed"
    assert status["error"].startswith("RuntimeError: cannot write") and _no_host_paths(status["error"], config)
    assert calls == [] and status["progress"]["directions_done"] == 0 and killed == []


def test_runner_maps_a_runner_exception_to_solver_failed_and_kills_the_container(real_harness, killed):
    client, service, sha, config = real_harness(run_case_fn=_fake_docker([], raises=FileNotFoundError("docker not found at C:\\tools\\docker.exe")))
    run_id = client.post("/api/cfd-runs", json=_request(sha)).json()["run_id"]
    status = client.get(f"/api/cfd-runs/{run_id}").json()
    assert status["status"] == "failed" and status["failure_code"] == "solver_failed"
    assert status["error"].startswith("FileNotFoundError:") and "C:\\" not in status["error"] and _no_host_paths(status["error"], config)
    # The container name was still recorded when the runner port raised, so the service killed it and cleared it.
    assert killed == [f"{run_id}_w000"]
    assert service.store.load(run_id)["current_container"] is None
    assert client.get(f"/api/cfd-runs/{run_id}/result").status_code == 409


def test_runner_reports_postprocess_failed_when_nothing_was_sampled(real_harness):
    client, _service, sha, config = real_harness(run_case_fn=_fake_docker([], samples=False))
    run_id = client.post("/api/cfd-runs", json=_request(sha)).json()["run_id"]
    status = client.get(f"/api/cfd-runs/{run_id}").json()
    assert status["status"] == "failed" and status["failure_code"] == "postprocess_failed"
    assert "no sampled surfaces" in status["error"] and _no_host_paths(status["error"], config)


def test_runner_rejects_missing_near_wall_sample_instead_of_publishing_partial_result(real_harness):
    fake = _fake_docker([])

    def omit_near_wall(**kwargs):
        outcome = fake(**kwargs)
        (Path(kwargs["case_dir"]) / "postProcessing" / "samples" / "267" / "near_wall_speed.vtk").unlink()
        return outcome

    client, _service, sha, config = real_harness(run_case_fn=omit_near_wall)
    run_id = client.post("/api/cfd-runs", json=_request(sha)).json()["run_id"]
    status = client.get(f"/api/cfd-runs/{run_id}").json()
    assert status["status"] == "failed" and status["failure_code"] == "postprocess_failed"
    assert "near-wall velocity sampling output is missing" in status["error"]
    assert _no_host_paths(status["error"], config)
    assert client.get(f"/api/cfd-runs/{run_id}/result").status_code == 409


def test_runner_cancels_through_the_supervisor_flag_when_the_container_is_killed_mid_run(real_harness, killed):
    """/cancel flags the run and kills the container; docker then reports a non-zero exit, not ``cancelled``."""
    holder: dict = {}

    def on_run(case: Path) -> bool:
        service = holder["service"]
        run_id = case.parent.name
        assert service.store.load(run_id)["current_container"] == f"{run_id}_w000"
        service.cancel_run(run_id)  # the real /cancel path: flag + docker kill
        return True

    calls: list[dict] = []
    client, service, sha, _config = real_harness(run_case_fn=_fake_docker(calls, on_run=on_run))
    holder["service"] = service
    run_id = client.post("/api/cfd-runs", json=_request(sha)).json()["run_id"]
    status = client.get(f"/api/cfd-runs/{run_id}").json()
    assert status["status"] == "cancelled" and status["failure_code"] == "cancelled"
    assert killed == [f"{run_id}_w000"] and len(calls) == 1
    assert service.store.load(run_id)["current_container"] is None
    assert client.get(f"/api/cfd-runs/{run_id}/result").status_code == 409

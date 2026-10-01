import importlib.util
import json
from pathlib import Path

import pytest
from bimcfd.transient_results import sha256
from test_foam_parsers import LEGACY_POLY, LEGACY_CELL_SCALARS

spec = importlib.util.spec_from_file_location("publish_transient",Path(__file__).parents[1]/"probes/publish_transient.py")
publisher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)


@pytest.fixture
def pilot(tmp_path):
    root=tmp_path/"artifacts"
    source_id="cfd_source_test"
    source_dir=root/source_id
    case=source_dir/"w000/case"
    case.mkdir(parents=True)
    meta={"params":{"ground_z_m":0},"wind":{"wind_from_degrees":0,"solver_rotation_alpha_rad":0},
          "building_bbox_solver_frame":{"min":[0,0,0],"max":[4,4,4]},"building_footprint_xy":[[0,0],[4,0],[0,4]],
          "near_wall":{"distance_m":1.,"surface_cell_m":.5,"reference":"computation_shell","interpolation":"cellPoint"}}
    (case/"case_meta.json").write_text(json.dumps(meta))
    hashes={}
    for name in ["constant/polyMesh/points","constant/polyMesh/faces","483/U","483/p"]:
        path=case/name
        path.parent.mkdir(parents=True,exist_ok=True)
        path.write_text("immutable source fixture")
        hashes[name]=sha256(path)
    result=json.loads((Path(__file__).parents[3]/"tests/contracts/cfd-run-result-v1.schema.json").read_text())["examples"][0]
    result["run_id"]=source_id
    for key in ("run_record","exclusions"):
        path=source_dir/result[key]["filename"]
        path.write_text(json.dumps({"schema":"cfd-run-record/v1","limitations":[]}))
        result[key]["sha256"]=sha256(path)
    (source_dir/"result.json").write_text(json.dumps(result))
    (source_dir/"run.json").write_text(json.dumps({"schema":"cfd-run-status/v1","run_id":source_id,"status":"ready",
        "source":result["source"],"request":{"idempotency_key":"original-key"}}))
    directory=tmp_path/"pilot"
    directory.mkdir()
    manifest={"schema":"cfd-transient-pilot/v1","solver":"pimpleFoam","source_case":str(case),"source_iteration":"483",
        "source_case_meta":meta,"source_input_sha256":hashes,"duration_s":10,"output_interval_s":.5,"physical_time_origin_s":0}
    (directory/"pilot_manifest.json").write_text(json.dumps(manifest))
    frames=[]
    for t in [.5,1,1.5]:
        fields={}
        for surface in ["building","pedestrian_1p5m","near_wall_speed"]:
            relative=f"postProcessing/samples/{t}/{surface}.vtk"
            path=directory/relative
            path.parent.mkdir(parents=True,exist_ok=True)
            path.write_text(LEGACY_CELL_SCALARS.replace("-2.5",str(t-2.5)) if surface=="building" else LEGACY_POLY)
            fields[surface]={"path":relative,"sha256":sha256(path)}
        frames.append({"time_s":t,"fields":fields})
    (directory/"pilot_report.json").write_text(json.dumps({"frames":frames,"incomplete_frames":[],"solve":{"exit_code":137}}))
    return directory,root,source_id,result["source"]


def test_validation_only_and_unique_publication_preserve_all_original_files(pilot):
    directory,root,source_id,source=pilot
    before={str(p):sha256(p) for p in directory.rglob("*") if p.is_file()}
    original={str(p):sha256(p) for p in (root/source_id).rglob("*") if p.is_file()}
    assert publisher.publish(*pilot,run_id="cfd_new_result")["published"] is False
    assert not (root/"cfd_new_result").exists()
    published=publisher.publish(*pilot,run_id="cfd_new_result",execute=True)
    assert published["published"] is True and published["samples"]==3
    result=json.loads((root/"cfd_new_result/result.json").read_text())
    assert result["directions"][0]["iterations"] is None
    assert result["directions"][0]["presentation"]["temporal"]["complete_requested_duration"] is False
    status=json.loads((root/"cfd_new_result/run.json").read_text())
    assert status["converged_count"]==0 and status["request"]["idempotency_key"] != "original-key"
    from pxr import Usd
    stage=Usd.Stage.Open(str(root/"cfd_new_result"/result["directions"][0]["overlay_layer"]["filename"]))
    for prim in result["directions"][0]["presentation"]["prims"]:
        assert stage.GetPrimAtPath("/World/Overlays/Cfd/cfd_new_result_w000/"+prim["name"])
    assert before=={str(p):sha256(p) for p in directory.rglob("*") if p.is_file()}
    assert original=={str(p):sha256(p) for p in (root/source_id).rglob("*") if p.is_file()}
    with pytest.raises(ValueError,match="unique"):
        publisher.publish(*pilot,run_id="cfd_new_result",execute=True)


@pytest.mark.parametrize("corruption",["model","source","sample","time","missing","path","footprint","near_wall"])
def test_invalid_provenance_never_creates_ready_or_output_directory(pilot,corruption):
    directory,root,source_id,source=pilot
    if corruption=="model": source={**source,"model_usdc_sha256":"b"*64}
    if corruption=="source": (root/source_id/"w000/case/483/U").write_text("changed")
    if corruption=="sample": (directory/"postProcessing/samples/0.5/building.vtk").write_text("changed")
    if corruption in ("time","missing","path"):
        report=json.loads((directory/"pilot_report.json").read_text())
        if corruption=="time": report["frames"][1]["time_s"]=.5
        if corruption=="missing": del report["frames"][1]["fields"]["building"]
        if corruption=="path": report["frames"][1]["fields"]["building"]["path"]="../../outside.vtk"
        (directory/"pilot_report.json").write_text(json.dumps(report))
    if corruption in ("footprint","near_wall"):
        manifest=json.loads((directory/"pilot_manifest.json").read_text())
        meta=manifest["source_case_meta"]
        if corruption=="footprint": meta["building_footprint_xy"]=[[0,0],[1,1]]
        if corruption=="near_wall": meta["near_wall"]["distance_m"]=0
        (root/source_id/"w000/case/case_meta.json").write_text(json.dumps(meta))
        (directory/"pilot_manifest.json").write_text(json.dumps(manifest))
    with pytest.raises(ValueError):
        publisher.publish(directory,root,source_id,source,run_id="cfd_new_result",execute=True)
    assert not (root/"cfd_new_result").exists()

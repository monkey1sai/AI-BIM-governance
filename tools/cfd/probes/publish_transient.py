"""Import an existing bounded pilot into a new ready result. Never invokes a solver."""
from __future__ import annotations

import argparse
import copy
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import sys
import uuid

import jsonschema
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from bimcfd.transient_results import load_paired_samples, no_links, sha256, validate_metadata, write_transient_layer

MAX_ARTIFACT_BYTES = 128*1024**2
RUN = re.compile(r"cfd_[A-Za-z0-9_]{6,120}")


def _json(path):
    path = no_links(path)
    if not path.is_file() or path.stat().st_size > 16*1024**2:
        raise ValueError("bounded regular JSON input required")
    return json.loads(path.read_text(encoding="utf-8"))


def publish(pilot, artifacts_root, source_run_id, expected_source, *, execute=False, run_id=None):
    pilot, root = no_links(pilot), no_links(artifacts_root)
    if not RUN.fullmatch(source_run_id) or not root.is_dir():
        raise ValueError("existing source run and artifacts root required")
    manifest = _json(pilot/"pilot_manifest.json")
    report = _json(pilot/"pilot_report.json")
    if manifest.get("schema") != "cfd-transient-pilot/v1" or manifest.get("solver") != "pimpleFoam":
        raise ValueError("bounded pimpleFoam pilot required")
    duration, interval = manifest.get("duration_s"), manifest.get("output_interval_s")
    if (not isinstance(duration,(int,float)) or isinstance(duration,bool) or not np.isfinite(duration) or not 0 < duration <= 3600
            or not isinstance(interval,(int,float)) or isinstance(interval,bool) or not np.isfinite(interval) or not 0 < interval <= 60
            or manifest.get("physical_time_origin_s") != 0):
        raise ValueError("invalid physical time bounds")
    source_dir = no_links(root/source_run_id)
    source_case = no_links(Path(manifest["source_case"]))
    source_case.resolve().relative_to(source_dir.resolve())
    status, result = _json(source_dir/"run.json"), _json(source_dir/"result.json")
    if (status.get("status") != "ready" or status.get("run_id") != source_run_id
            or result.get("status") != "ready" or result.get("run_id") != source_run_id
            or result.get("source") != expected_source or status.get("source") != expected_source):
        raise ValueError("ready source must match the explicit conversion and model hash")
    meta = _json(source_case/"case_meta.json")
    if meta != manifest.get("source_case_meta"):
        raise ValueError("source metadata changed after pilot preparation")
    hashes = manifest.get("source_input_sha256", {})
    iteration = manifest.get("source_iteration", "")
    if not re.fullmatch(r"\d+", str(iteration)) or not isinstance(hashes,dict):
        raise ValueError("invalid source input inventory")
    required = {"constant/polyMesh/points","constant/polyMesh/faces",f"{iteration}/U",f"{iteration}/p"}
    if not required <= set(hashes):
        raise ValueError("mesh and initial U/p hashes required")
    total = 0
    for relative, expected in hashes.items():
        if not re.fullmatch(r"(?:constant/polyMesh/[A-Za-z]+|constant/triSurface/building\.stl|constant/(?:turbulenceProperties|transportProperties)|system/decomposeParDict|"+str(iteration)+r"/(?:U|p|k|omega|nut|phi))",relative):
            raise ValueError("invalid source input path")
        path = no_links(source_case/relative)
        if not path.is_file(): raise ValueError("source input missing")
        total += path.stat().st_size
        if total > 4*1024**3 or sha256(path) != expected:
            raise ValueError("source input changed or exceeds cap")
    times, samples, provenance_inputs = load_paired_samples(pilot,report,interval)
    if not np.isclose(times[0],interval,rtol=0,atol=1e-8) or times[-1] > duration:
        raise ValueError("samples must stay inside the requested physical interval")
    source_direction = next((d for d in result["directions"] if d["status"] == "ready"
                             and d["wind_from_degrees"] == meta["wind"]["wind_from_degrees"]),None)
    if source_direction is None:
        raise ValueError("pilot wind does not match a ready source direction")
    evidence = {}
    for key in ("run_record","exclusions"):
        ref = result[key]
        if not re.fullmatch(r"[A-Za-z0-9._-]{1,200}",ref["filename"]): raise ValueError("invalid source evidence filename")
        source_path = no_links(source_dir/ref["filename"])
        if sha256(source_path) != ref["sha256"]: raise ValueError("source evidence hash mismatch")
        evidence[key] = _json(source_path)
    bbox = meta["building_bbox_solver_frame"]
    ground = meta["params"]["ground_z_m"]
    height = bbox["max"][2]-ground
    if not np.isfinite(height) or height <= 0 or not isinstance(meta.get("near_wall"),dict):
        raise ValueError("positive building height and near-wall provenance required")
    validate_metadata(times=times,interval_s=interval,rotation_alpha_rad=meta["wind"]["solver_rotation_alpha_rad"],
        footprint=meta["building_footprint_xy"],ground_z=ground,building_height=height,near_wall=meta["near_wall"])
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    run_id = run_id or f"cfd_{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}_{uuid.uuid4().hex[:6]}"
    if not RUN.fullmatch(run_id) or run_id == source_run_id or (root/run_id).exists():
        raise ValueError("unique new result required")
    details = {"run_id":run_id,"source_run_id":source_run_id,"samples":len(times),"first_time_s":times[0],"last_time_s":times[-1]}
    if not execute:
        return {**details,"published":False}
    # All inputs and source hashes were validated before any output directory is created.
    destination = root/run_id
    destination.mkdir(exist_ok=False)
    layer_name = run_id+"_w000.usdc"
    provenance = {"source_run_id":source_run_id,"manifest_sha256":sha256(pilot/"pilot_manifest.json"),
                  "requested_duration_s":manifest["duration_s"],"complete_requested_duration":times[-1] >= manifest["duration_s"]}
    authored = write_transient_layer(out_path=destination/layer_name,run_id=run_id,times=times,samples=samples,
        rotation_alpha_rad=meta["wind"]["solver_rotation_alpha_rad"],interval_s=manifest["output_interval_s"],
        footprint=meta["building_footprint_xy"],ground_z=ground,building_height=height,
        near_wall=meta["near_wall"],provenance=provenance)
    artifact_bytes = (destination/layer_name).stat().st_size
    if artifact_bytes > MAX_ARTIFACT_BYTES:
        raise ValueError("artifact exceeds 128 MiB cap; partial output preserved, not ready")
    limitations = ["Existing bounded URANS pilot; solve stopped at its original wall cap. No new solve was started.",
                  "Fixed geometry, no fluid-structure interaction; statistical stability and engineering accuracy unverified.",
                  "Paired sample-hold surfaces and pedestrian vectors only; transient 3D streamlines/pathlines are unavailable.",
                  "Velocity scale is fixed at 0–5 m/s; values above 5 saturate. Pressure scale spans all available times."]
    direction = copy.deepcopy(source_direction)
    direction.update(converged_by_residual_control=None,iterations=None,end_time_extended_to=None,
        overlay_layer={"filename":layer_name,"sha256":sha256(destination/layer_name),"artifact_id":f"cfd:{run_id}:w000"},
        pedestrian_1p5m={"polygons":len(samples[0]["pedestrian_1p5m"].polygons),
                        "U_magnitude_max":float(max(np.linalg.norm(row["pedestrian_1p5m"].point_data["U"],axis=1).max() for row in samples))},
        building_pressure={"p_min":authored["legend"]["p"]["min"],"p_max":authored["legend"]["p"]["max"]},**authored)
    new_result = copy.deepcopy(result)
    new_result.update(run_id=run_id,directions=[direction],validation_level="screening",limitations=result["limitations"]+limitations)
    def write(name,data):
        with (destination/name).open("x",encoding="utf-8") as stream:
            json.dump(data,stream,ensure_ascii=False,indent=2,allow_nan=False)
    for key in ("run_record","exclusions"):
        ref = result[key]
        data = copy.deepcopy(evidence[key])
        if key == "run_record":
            data.update(run_id=run_id,created_at_utc=now,operator="bounded-transient-import",validation_level="screening",
                        directions=[{"wind_from_degrees":direction["wind_from_degrees"],"temporal":authored["presentation"]["temporal"],
                                     "samples":provenance_inputs,"solve":report.get("solve"),"converged_by_residual_control":None}],
                        limitations=new_result["limitations"])
        name = key+".json"
        write(name,data)
        new_result[key] = {k:v for k,v in ref.items() if k not in ("filename","sha256","url")}
        new_result[key].update(filename=name,sha256=sha256(destination/name))
    contract = Path(__file__).resolve().parents[3]/"tests/contracts/cfd-run-result-v1.schema.json"
    jsonschema.Draft202012Validator(_json(contract)).validate(new_result)
    write("result.json",new_result)
    new_status = copy.deepcopy(status)
    new_status.update(run_id=run_id,status="ready",failure_code=None,error=None,progress={"directions_total":1,"directions_done":1},
        converged_count=0,cancel_requested=False,current_container=None,created_at=now,started_at=now,finished_at=now,updated_at=now,
        result_filename="result.json")
    if isinstance(new_status.get("request"),dict):
        new_status["request"]["idempotency_key"] = "transient-import:"+run_id
    # The service cannot discover the result until all artifacts/contracts are complete.
    write("run.json.tmp",new_status)
    (destination/"run.json.tmp").replace(destination/"run.json")
    return {**details,"published":True,"artifact_bytes":artifact_bytes,"artifact_sha256":direction["overlay_layer"]["sha256"]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pilot",type=Path,required=True)
    parser.add_argument("--artifacts-root",type=Path,required=True)
    parser.add_argument("--source-run-id",required=True)
    parser.add_argument("--conversion-job-id",required=True)
    parser.add_argument("--model-sha256",required=True)
    parser.add_argument("--publish",action="store_true",help="Publish a unique new ready result; default validates only")
    args = parser.parse_args()
    source = {"conversion_job_id":args.conversion_job_id,"model_usdc_sha256":args.model_sha256}
    print(json.dumps(publish(args.pilot,args.artifacts_root,args.source_run_id,source,execute=args.publish),indent=2))


if __name__ == "__main__": main()

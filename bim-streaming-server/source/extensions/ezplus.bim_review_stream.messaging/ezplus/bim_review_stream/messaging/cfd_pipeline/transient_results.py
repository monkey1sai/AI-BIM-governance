"""Immutable paired URANS snapshots. Discrete visibility avoids invented interpolation."""
from __future__ import annotations

from pathlib import Path
import hashlib
import math
import re

import numpy as np

from .foam_vtk import VtkSurface, parse_legacy_vtk
from .usd_results import OVERLAY_ROOT, colormap, _set_mesh_topology, _set_primvar, safe_prim_name, clip_surface_to_xy_box
from .vector_presentation import write_surface_vectors
from .wind import rotate_z

SURFACES = {"pedestrian_1p5m": ("PedestrianWind_1p5m", "plane", "U"),
            "building": ("BuildingSurfacePressure", "surface_pressure", "p"),
            "near_wall_speed": ("NearWallWindSpeed", "near_wall_speed", "U")}
NOTE = "真實非穩態快照（URANS）；固定幾何；未驗證統計穩定或工程精度"
MAX_SAMPLES = 64
MAX_INPUT_BYTES = 1024**3


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def no_links(path: Path) -> Path:
    path = Path(path).absolute()
    for ancestor in (path, *path.parents):
        if ancestor.is_symlink() or (hasattr(ancestor, "is_junction") and ancestor.is_junction()):
            raise ValueError("linked input paths are not permitted")
    return path


def load_paired_samples(pilot: Path, report: dict, interval_s: float):
    """Only manifest-listed, hash-verified regular files under the fixed samples subtree."""
    pilot = no_links(pilot)
    frames = report.get("frames", [])
    if report.get("incomplete_frames") or not 2 <= len(frames) <= MAX_SAMPLES:
        raise ValueError("complete paired sample series required")
    if not isinstance(interval_s, (int, float)) or not math.isfinite(interval_s) or interval_s <= 0:
        raise ValueError("invalid sample interval")
    times = [frame.get("time_s") for frame in frames]
    if any(isinstance(t, bool) or not isinstance(t, (int, float)) or not math.isfinite(t) or t < 0 for t in times):
        raise ValueError("invalid physical times")
    if any(not math.isclose(b-a, interval_s, rel_tol=0, abs_tol=1e-8) for a,b in zip(times, times[1:])):
        raise ValueError("nonmonotonic or missing physical step")
    samples, inputs, total_bytes = [], [], 0
    for frame in frames:
        if set(frame.get("fields", {})) != set(SURFACES):
            raise ValueError("all three fields must belong to the same physical step")
        row = {}
        for key in SURFACES:
            item = frame["fields"][key]
            relative = item.get("path", "")
            if not isinstance(relative, str) or not re.fullmatch(r"postProcessing/samples/\d+(?:\.\d+)?/"+key+r"\.vtk", relative):
                raise ValueError("invalid fixed sample path")
            if not math.isclose(float(Path(relative).parent.name), frame["time_s"], rel_tol=0, abs_tol=1e-8):
                raise ValueError("sample path has a different physical time")
            path = no_links(pilot / relative)
            if not path.is_file():
                raise ValueError("sample is not a regular file")
            total_bytes += path.stat().st_size
            if total_bytes > MAX_INPUT_BYTES:
                raise ValueError("sample input exceeds 1 GiB cap")
            digest = sha256(path)
            if digest != item.get("sha256"):
                raise ValueError("sample hash mismatch")
            row[key] = parse_legacy_vtk(path)
            inputs.append({"time_s": frame["time_s"], "surface": key, "sha256": digest})
        samples.append(row)
    validate_series(times, samples)
    return times, samples, inputs


def validate_series(times, samples):
    if not 2 <= len(times) == len(samples) <= MAX_SAMPLES or not np.isfinite(times).all() or np.any(np.diff(times) <= 0):
        raise ValueError("invalid temporal series")
    for key, (_, _, quantity) in SURFACES.items():
        initial = samples[0][key]
        for row in samples:
            surface = row[key]
            if (not surface.polygons or np.ndim(surface.points) != 2 or surface.points.shape[1] != 3
                    or not len(surface.points) or not np.isfinite(surface.points).all()
                    or any(np.ndim(poly) != 1 or len(poly) < 3 or not np.issubdtype(np.asarray(poly).dtype,np.integer)
                           or np.any(np.asarray(poly) < 0) or np.any(np.asarray(poly) >= len(surface.points)) for poly in surface.polygons)
                    or not np.array_equal(initial.points, surface.points)
                    or len(initial.polygons) != len(surface.polygons)
                    or any(not np.array_equal(a,b) for a,b in zip(initial.polygons, surface.polygons))):
                raise ValueError("fixed geometry/topology must match every time step")
            values = surface.cell_data.get("p") if quantity == "p" else surface.point_data.get("U")
            expected = (len(surface.polygons),) if quantity == "p" else surface.points.shape
            if values is None or np.shape(values) != expected or not np.isfinite(values).all():
                raise ValueError("missing finite paired field")


def validate_metadata(*, times, interval_s, rotation_alpha_rad, footprint, ground_z, building_height, near_wall):
    def finite(value):
        return isinstance(value,(int,float)) and not isinstance(value,bool) and math.isfinite(value)
    xy = np.asarray(footprint,dtype=float)
    if (not finite(rotation_alpha_rad) or not finite(interval_s) or not 0 < interval_s <= 60
            or not finite(ground_z) or abs(ground_z) > 1e9 or not finite(building_height) or not 0 < building_height <= 1e9
            or xy.ndim != 2 or xy.shape[1] != 2 or not 3 <= len(xy) <= 64
            or not np.isfinite(xy).all() or np.any(np.abs(xy) > 1e9)
            or not isinstance(near_wall,dict) or near_wall.get("reference") != "computation_shell"
            or near_wall.get("interpolation") != "cellPoint"
            or not all(finite(near_wall.get(key)) and near_wall[key] > 0 for key in ("distance_m","surface_cell_m"))):
        raise ValueError("invalid temporal coordinate or sampling metadata")
    if (any(not finite(t) or not 0 <= t <= 3600 for t in times)
            or any(not math.isclose(b-a,interval_s,rel_tol=0,abs_tol=1e-8) for a,b in zip(times,times[1:]))
            or not 2 <= int(round((times[-1]-times[0]+interval_s)*24))+1 <= 24000):
        raise ValueError("invalid bounded physical timeline")


def write_transient_layer(*, out_path: Path, run_id: str, times, samples, rotation_alpha_rad: float,
                          interval_s: float, footprint, ground_z: float, building_height: float, near_wall: dict,
                          provenance: dict):
    from pxr import Gf, Sdf, Usd, UsdGeom, UsdShade, Vt

    validate_series(times, samples)
    validate_metadata(times=times,interval_s=interval_s,rotation_alpha_rad=rotation_alpha_rad,
                      footprint=footprint,ground_z=ground_z,building_height=building_height,near_wall=near_wall)
    if not isinstance(run_id,str) or not re.fullmatch(r"cfd_[A-Za-z0-9_]{6,120}",run_id):
        raise ValueError("invalid result identity")
    out_path = no_links(out_path)
    if out_path.exists():
        raise ValueError("new artifact path required")
    stage = Usd.Stage.CreateNew(str(out_path))
    UsdGeom.SetStageUpAxis(stage, UsdGeom.Tokens.z)
    UsdGeom.SetStageMetersPerUnit(stage, 1.)
    fps = 24
    codes = (np.asarray(times)-times[0])*fps
    frames = int(round((times[-1]-times[0]+interval_s)*fps))+1
    stage.SetTimeCodesPerSecond(fps)
    stage.SetFramesPerSecond(fps)
    stage.SetStartTimeCode(0.)
    stage.SetEndTimeCode(frames-1)
    world = UsdGeom.Xform.Define(stage, "/World")
    stage.SetDefaultPrim(world.GetPrim())
    run_path = f"{OVERLAY_ROOT}/{safe_prim_name(run_id+'_w000')}"
    run = UsdGeom.Xform.Define(stage, run_path).GetPrim()
    run.SetCustomDataByKey("cfd:run_id", run_id)
    run.SetCustomDataByKey("cfd:purpose", "design_comparison_only")
    geometry = UsdGeom.Xform.Define(stage, run_path+"/_Geometry")
    geometry.CreateVisibilityAttr().Set(UsdGeom.Tokens.invisible)
    pressure = np.concatenate([row["building"].cell_data["p"] for row in samples])
    p_range = (float(pressure.min()), float(pressure.max()))
    if p_range[1] <= p_range[0]:
        p_range = (p_range[0],p_range[0]+1.)
    prims = []
    for key, (name, role, quantity) in SURFACES.items():
        initial = samples[0][key]
        base = UsdGeom.Mesh.Define(stage, run_path+"/_Geometry/"+name)
        _set_mesh_topology(base, rotate_z(initial.points,-rotation_alpha_rad), initial.polygons, Vt, Gf)
        base.CreateSubdivisionSchemeAttr("none")
        base.CreateDoubleSidedAttr(True)
        parent = UsdGeom.Xform.Define(stage, run_path+"/"+name)
        parent.CreateVisibilityAttr().Set(UsdGeom.Tokens.inherited)
        # Kit RTX needs a material opacity, not only a displayOpacity primvar.
        opacity = .35 if key != "pedestrian_1p5m" else .6
        material = UsdShade.Material.Define(stage,run_path+"/Looks/"+name)
        reader = UsdShade.Shader.Define(stage,str(material.GetPath())+"/DisplayColor")
        reader.CreateIdAttr("UsdPrimvarReader_float3")
        reader.CreateInput("varname",Sdf.ValueTypeNames.String).Set("displayColor")
        color_out = reader.CreateOutput("result",Sdf.ValueTypeNames.Float3)
        shader = UsdShade.Shader.Define(stage,str(material.GetPath())+"/Surface")
        shader.CreateIdAttr("UsdPreviewSurface")
        shader.CreateInput("diffuseColor",Sdf.ValueTypeNames.Color3f).ConnectToSource(color_out)
        for attribute,value in (("roughness",0.),("specular",0.),("ior",1.),("opacity",opacity),("opacityThreshold",0.)):
            shader.CreateInput(attribute,Sdf.ValueTypeNames.Float).Set(value)
        material.CreateSurfaceOutput().ConnectToSource(shader.ConnectableAPI(),"surface")
        prims.append({"name":name,"role":role,"quantity":quantity,"default_visible":True})
        for index, row in enumerate(samples):
            mesh = UsdGeom.Mesh.Define(stage, f"{run_path}/{name}/{name}_Frame_{index:03d}")
            mesh.GetPrim().GetReferences().AddInternalReference(base.GetPath())
            UsdShade.MaterialBindingAPI.Apply(mesh.GetPrim()).Bind(material)
            visibility = mesh.CreateVisibilityAttr()
            visibility.Set(UsdGeom.Tokens.inherited if index == 0 else UsdGeom.Tokens.invisible)
            for step, code in enumerate(codes):
                visibility.Set(UsdGeom.Tokens.inherited if step == index else UsdGeom.Tokens.invisible, float(code))
            values = row[key].cell_data["p"] if quantity == "p" else row[key].point_data["U"]
            magnitude = values if quantity == "p" else np.linalg.norm(values,axis=1)
            interpolation = "uniform" if quantity == "p" else "vertex"
            if quantity == "U":
                _set_primvar(mesh,"U",rotate_z(values,-rotation_alpha_rad),interpolation,Sdf,Vt,Gf,vector=True)
                _set_primvar(mesh,"U_magnitude",magnitude,interpolation,Sdf,Vt,Gf)
            else:
                _set_primvar(mesh,"p",values,interpolation,Sdf,Vt,Gf)
            colors = colormap(magnitude,*(p_range if quantity == "p" else (0.,5.)))
            mesh.CreateDisplayColorPrimvar(interpolation).Set(Vt.Vec3fArray.FromNumpy(colors.astype(np.float32)))
            mesh.CreateDisplayOpacityPrimvar("constant").Set([opacity])
            mesh.GetPrim().SetCustomDataByKey("cfd:physical_time_s",float(times[index]))
    vectors = UsdGeom.Xform.Define(stage,run_path+"/PedestrianWindVectors")
    vectors.CreateVisibilityAttr().Set(UsdGeom.Tokens.inherited)
    prims.append({"name":"PedestrianWindVectors","role":"vectors","quantity":"U","default_visible":True})
    xy = np.asarray(footprint,dtype=float)
    for index,row in enumerate(samples):
        surface = row["pedestrian_1p5m"]
        model = VtkSurface(rotate_z(surface.points,-rotation_alpha_rad),surface.polygons,
                           point_data={"U":rotate_z(surface.point_data["U"],-rotation_alpha_rad)})
        if xy.ndim == 2 and xy.shape[1] == 2 and len(xy) >= 3:
            lo,hi = xy.min(axis=0)-building_height,xy.max(axis=0)+building_height
            model = clip_surface_to_xy_box(model,lo[0],hi[0],lo[1],hi[1])
        path = f"{run_path}/PedestrianWindVectors/Frame_{index:03d}"
        write_surface_vectors(stage,path,model,colormap,(0.,5.),allow_empty=True)
        prim = stage.GetPrimAtPath(path)
        visibility = UsdGeom.Imageable(prim).CreateVisibilityAttr()
        visibility.Set(UsdGeom.Tokens.inherited if index == 0 else UsdGeom.Tokens.invisible)
        for step,code in enumerate(codes):
            visibility.Set(UsdGeom.Tokens.inherited if step == index else UsdGeom.Tokens.invisible,float(code))
        prim.SetCustomDataByKey("cfd:physical_time_s",float(times[index]))
    temporal = {"mode":"urans_sampled","solver":"pimpleFoam","fixed_geometry":True,"interpolation":"sample_hold",
                "sample_times_s":list(map(float,times)),"output_interval_s":float(interval_s),**provenance}
    animation = {"mode":"urans_sampled","fps":fps,"frames":frames,"note":NOTE}
    stage.GetRootLayer().customLayerData = {"cfd:animation":{**animation,"loop":True,
        "temporal":{"mode":"urans_sampled","run_id":run_id,"sample_times_s":Vt.DoubleArray(times),
                    "sample_time_codes":Vt.DoubleArray(codes)}}}
    legend = {"U":{"min":0.,"max":5.,"unit":"m/s","prims":["PedestrianWind_1p5m","NearWallWindSpeed","PedestrianWindVectors"]},
              "p":{"min":p_range[0],"max":p_range[1],"available":True,"unit":"m^2/s^2",
                   "quantity":"kinematic_pressure","prims":["BuildingSurfacePressure"]}}
    run.SetCustomDataByKey("cfd:legend",legend)
    stage.GetRootLayer().Save()
    return {"legend":legend,"presentation":{"version":2,"prims":prims,"animation":animation,
        "sections":[],"building_footprint_xy":footprint,"ground_z_m":float(ground_z),
        "building_height_m":float(building_height),"near_wall":near_wall,"temporal":temporal}}

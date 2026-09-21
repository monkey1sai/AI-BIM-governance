"""Kit ``--exec`` script: open a stage, wait for assets, capture the viewport, quit.

Runs inside Kit's Python (not the repo .venv). Produces ``kit_evidence.json``
plus PNG captures in ``--out-dir`` so the CFD run record can point at real
Kit load evidence (first frame, Stage composition, overlay prims).

Launch (from bim-streaming-server/_build/windows-x86_64/release):

    kit\\kit.exe apps/ezplus.bim_review_stream.kit --no-window --ext-folder <repo>/bim-streaming-server/source/extensions
        --portable-root <dir> --/app/fastShutdown=1
        --exec "<this file> --usd-path <stage> --out-dir <dir>"
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path

import carb
import omni.kit.app
import omni.usd


def _parse() -> argparse.Namespace:
    parser = argparse.ArgumentParser("Open USD stage, capture viewport and quit")
    parser.add_argument("--usd-path", required=True)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--overlay-root", default="/World/Overlays/Cfd")
    parser.add_argument("--settle-frames", type=int, default=120)
    parser.add_argument("--timeout-s", type=float, default=900.0)
    # S3.1: capture the CFD overlay at these stage time codes (comma separated) with the
    # timeline paused there, e.g. "0,80,160"; empty = single capture at the current time.
    parser.add_argument("--capture-times", default="")
    return parser.parse_known_args()[0]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _ensure_default_lighting(stage) -> bool:
    from pxr import Gf, Sdf, Usd, UsdGeom, UsdLux

    light_types = (UsdLux.DomeLight, UsdLux.DistantLight, UsdLux.RectLight, UsdLux.SphereLight, UsdLux.DiskLight, UsdLux.CylinderLight)
    for prim in stage.Traverse():
        if any(prim.IsA(light_type) for light_type in light_types):
            return False
    root = "/CfdEvidenceFallbackLights"
    with Usd.EditContext(stage, stage.GetSessionLayer()):
        UsdGeom.Scope.Define(stage, Sdf.Path(root))
        dome = UsdLux.DomeLight.Define(stage, Sdf.Path(f"{root}/Dome"))
        dome.CreateIntensityAttr(1500.0)
        dome.CreateColorAttr(Gf.Vec3f(1.0, 1.0, 1.0))
        sun = UsdLux.DistantLight.Define(stage, Sdf.Path(f"{root}/Sun"))
        sun.CreateIntensityAttr(3000.0)
        sun.CreateAngleAttr(0.53)
        UsdGeom.Xformable(sun.GetPrim()).AddRotateXYZOp().Set(Gf.Vec3f(-45.0, 30.0, 0.0))
    return True


def _pixel_diff(a_path: Path, b_path: Path) -> dict:
    """Changed-pixel fraction between two captures (PIL ships with Kit); proves the particles moved."""
    try:
        import numpy as np
        from PIL import Image

        a = np.asarray(Image.open(a_path).convert("RGB"), dtype=np.int16)
        b = np.asarray(Image.open(b_path).convert("RGB"), dtype=np.int16)
        if a.shape != b.shape:
            return {"error": f"shape mismatch {a.shape} vs {b.shape}"}
        diff = np.abs(a - b).sum(axis=2)
        return {"mean_abs_diff": float(diff.mean()), "changed_pixel_fraction": float((diff > 24).mean())}
    except Exception as exc:  # noqa: BLE001
        return {"error": f"{type(exc).__name__}: {exc}"}


async def _wait_frames(app, count: int) -> None:
    for _ in range(max(0, count)):
        await app.next_update_async()


async def _run(args: argparse.Namespace) -> None:
    app = omni.kit.app.get_app()
    out = Path(args.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    evidence: dict = {
        "schema": "cfd-kit-load-evidence/v1",
        "usd_path": args.usd_path,
        "started_utc": _now(),
        "kit_version": app.get_kit_version(),
        "app_name": carb.settings.get_settings().get("/app/name"),
        "renderer": carb.settings.get_settings().get("/renderer/active"),
        "no_window": bool(carb.settings.get_settings().get("/app/window/enabled") is False),
        "captures": [],
    }
    exit_code = 1
    try:
        from pxr import Usd, UsdGeom

        ctx = omni.usd.get_context()
        t0 = time.time()
        carb.log_warn(f"[cfd-capture] opening stage {args.usd_path}")
        ok, error = await ctx.open_stage_async(args.usd_path)
        carb.log_warn(f"[cfd-capture] open_stage ok={ok} error={error} after {time.time() - t0:.1f}s")
        evidence["open_stage"] = {"ok": bool(ok), "error": str(error) if error else None, "seconds": round(time.time() - t0, 2)}
        if not ok:
            raise RuntimeError(f"open_stage failed: {error}")

        deadline = time.time() + args.timeout_s
        status = None
        while time.time() < deadline:
            status = ctx.get_stage_loading_status()
            _, loading, total = status[0], int(status[1]), int(status[2])
            if loading == 0 and total == 0:
                break
            await app.next_update_async()
        evidence["assets_loaded"] = {"seconds_since_open": round(time.time() - t0, 2), "final_status": [str(v) for v in status] if status else None}
        carb.log_warn(f"[cfd-capture] assets settled after {time.time() - t0:.1f}s status={status}")

        stage = ctx.get_stage()
        root = stage.GetRootLayer()
        default_prim = stage.GetDefaultPrim()
        elements = stage.GetPrimAtPath("/World/Elements")
        evidence["stage"] = {
            "root_layer": root.identifier,
            "sublayers": list(root.subLayerPaths),
            "layer_stack": [layer.identifier for layer in stage.GetLayerStack(includeSessionLayers=False)],
            "default_prim": str(default_prim.GetPath()) if default_prim else None,
            "up_axis": str(UsdGeom.GetStageUpAxis(stage)),
            "meters_per_unit": float(UsdGeom.GetStageMetersPerUnit(stage)),
            "prim_count": sum(1 for _ in stage.Traverse()),
            "element_class_count": len(elements.GetChildren()) if elements.IsValid() else 0,
            "mesh_count": sum(1 for prim in stage.Traverse() if prim.IsA(UsdGeom.Mesh)),
        }

        overlay = stage.GetPrimAtPath(args.overlay_root)
        runs = []
        run_paths = []
        if overlay.IsValid():
            for run in overlay.GetChildren():
                run_paths.append(str(run.GetPath()))
                children = []
                for child in run.GetChildren():
                    entry = {"path": str(child.GetPath()), "type": child.GetTypeName()}
                    if child.IsA(UsdGeom.PointBased):
                        points = UsdGeom.PointBased(child).GetPointsAttr().Get()
                        entry["points"] = len(points) if points else 0
                        primvars = UsdGeom.PrimvarsAPI(child).GetPrimvars()
                        entry["primvars"] = sorted(p.GetPrimvarName() for p in primvars)
                    children.append(entry)
                runs.append({"path": str(run.GetPath()), "custom_data": {k: str(v) for k, v in run.GetCustomData().items()}, "children": children})
        evidence["overlay"] = {"root": args.overlay_root, "valid": overlay.IsValid(), "runs": runs}

        # IFC-derived stages carry no lights; mirror the product's fallback
        # (stage_loading._ensure_default_lighting) in the session layer so the
        # capture is not black and nothing is persisted to disk.
        evidence["fallback_lighting_added"] = _ensure_default_lighting(stage)

        await _wait_frames(app, args.settle_frames)

        from omni.kit.viewport.utility import capture_viewport_to_file, frame_viewport_prims, get_active_viewport

        viewport = get_active_viewport()
        if viewport is None:
            raise RuntimeError("no active viewport")
        evidence["viewport"] = {
            "resolution": [int(v) for v in viewport.resolution],
            "camera_path": str(viewport.camera_path),
            "frame_info_keys": sorted(str(k) for k in (viewport.frame_info or {}).keys()),
        }

        async def capture(name: str, prims: list[str] | None) -> None:
            if prims:
                framed = frame_viewport_prims(viewport, prims=prims)
                evidence.setdefault("framing", []).append({"prims": prims, "ok": bool(framed)})
                await _wait_frames(app, 60)
            path = out / f"{name}.png"
            carb.log_warn(f"[cfd-capture] capturing {name}")
            handle = capture_viewport_to_file(viewport, str(path))
            result = await handle.wait_for_result(completion_frames=30)
            carb.log_warn(f"[cfd-capture] captured {name}: {result}")
            evidence["captures"].append({"name": name, "path": str(path), "result": str(result), "exists": path.exists(), "bytes": path.stat().st_size if path.exists() else 0, "frame_number": int(viewport.frame_info.get("frame_number", -1)) if viewport.frame_info else None})

        await capture("kit_first_frame_model", ["/World/Elements"] if elements.IsValid() else None)
        if run_paths:
            await capture("kit_cfd_overlay", run_paths)
            times = [float(v) for v in args.capture_times.split(",") if v.strip()]
            if times:
                import importlib

                # importlib: a local ``import omni.timeline`` would shadow the module-level ``omni`` name.
                timeline = importlib.import_module("omni.timeline").get_timeline_interface()
                tcps = float(stage.GetTimeCodesPerSecond() or 24.0)
                evidence["timeline"] = {"time_codes_per_second": tcps, "start": stage.GetStartTimeCode(), "end": stage.GetEndTimeCode(), "captures": []}
                # Frame the CFD building shell (or the model elements), not the whole overlay, so the flow is seen around it.
                shells = [str(prim.GetPath()) for prim in stage.Traverse() if prim.GetName() == "BuildingSurfacePressure" and str(prim.GetPath()).startswith(args.overlay_root)]
                frame_target = shells or (["/World/Elements"] if elements.IsValid() else [])
                if frame_target:
                    framed = frame_viewport_prims(viewport, prims=frame_target)
                    evidence["timeline"]["framing"] = {"prims": frame_target, "ok": bool(framed)}
                    await _wait_frames(app, 30)
                first_capture = None
                for code in times:
                    timeline.set_current_time(code / tcps)
                    await _wait_frames(app, 30)
                    name = f"kit_cfd_overlay_t{int(code):04d}"
                    await capture(name, None)
                    entry = {"time_code": code, "seconds": code / tcps}
                    path = out / f"{name}.png"
                    if first_capture is None:
                        first_capture = path
                    else:
                        entry["diff_vs_first"] = _pixel_diff(first_capture, path)
                    evidence["timeline"]["captures"].append(entry)
        exit_code = 0
    except Exception:  # noqa: BLE001
        evidence["error"] = traceback.format_exc()
        carb.log_error(evidence["error"])
    finally:
        evidence["finished_utc"] = _now()
        evidence["exit_code"] = exit_code
        (out / "kit_evidence.json").write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
        app.post_quit(exit_code)


def main() -> None:
    args = _parse()
    asyncio.ensure_future(_run(args))


main()

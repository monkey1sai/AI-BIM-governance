"""Kit ``--exec`` probe: can this Kit render a UsdVol Volume backed by an OpenVDB asset?

Runs inside Kit's Python (Kit bundles ``openvdb``/``nanovdb`` bindings through
``omni.volume``). Writes a small Gaussian density grid to ``probe.vdb``,
authors a stage with ``UsdVol.Volume`` + ``UsdVol.OpenVDBAsset`` next to a
reference cube, captures the viewport with the volume visible and with it
hidden, and records everything in ``usdvol_probe.json`` together with the
visible/hidden pixel difference, so the verdict rests on rendered pixels, not
on an extension being loaded.

Launch (from bim-streaming-server/_build/windows-x86_64/release):

    kit\\kit.exe apps/ezplus.bim_review_stream.kit --no-window --portable-root <dir>
        --/app/fastShutdown=1 --exec "<this file> --out-dir <dir>"
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
    parser = argparse.ArgumentParser("UsdVol + OpenVDB render probe")
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--size", type=int, default=64)
    parser.add_argument("--extent-m", type=float, default=30.0)
    parser.add_argument("--density-scale", type=float, default=6.0)
    parser.add_argument("--settle-frames", type=int, default=120)
    return parser.parse_known_args()[0]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _write_vdb(path: Path, size: int, evidence: dict, *, extent_m: float = 30.0, density_scale: float = 6.0) -> None:
    """Gaussian blob density grid via the bundled openvdb bindings (pyopenvdb API)."""
    import numpy as np
    import openvdb  # provided by omni.volume

    evidence["openvdb_module"] = {"file": getattr(openvdb, "__file__", None), "version": getattr(openvdb, "LIBRARY_VERSION_STRING", None) or getattr(openvdb, "__version__", None)}
    axis = np.linspace(-1.0, 1.0, size, dtype=np.float32)
    x, y, z = np.meshgrid(axis, axis, axis, indexing="ij")
    density = (density_scale * np.exp(-3.0 * (x * x + y * y + z * z))).astype(np.float32)
    density[density < 0.02 * density_scale] = 0.0
    grid = openvdb.FloatGrid()
    grid.copyFromArray(density)
    grid.name = "density"
    grid.gridClass = openvdb.GridClass.FOG_VOLUME
    grid.transform = openvdb.createLinearTransform(voxelSize=extent_m / size)
    openvdb.write(str(path), grids=[grid])
    evidence["vdb"] = {"path": str(path), "bytes": path.stat().st_size, "voxels": int((density > 0).sum()), "size": size, "extent_m": extent_m, "density_scale": density_scale, "max_density": float(density.max())}


def _author_stage(stage_path: Path, vdb_path: Path) -> None:
    from pxr import Gf, Sdf, Usd, UsdGeom, UsdLux, UsdVol

    stage = Usd.Stage.CreateNew(str(stage_path))
    UsdGeom.SetStageUpAxis(stage, UsdGeom.Tokens.z)
    UsdGeom.SetStageMetersPerUnit(stage, 1.0)
    world = UsdGeom.Xform.Define(stage, "/World")
    stage.SetDefaultPrim(world.GetPrim())
    cube = UsdGeom.Cube.Define(stage, "/World/ReferenceCube")
    cube.CreateSizeAttr(4.0)
    UsdGeom.Xformable(cube.GetPrim()).AddTranslateOp().Set(Gf.Vec3d(-22.0, 0.0, 2.0))
    cube.CreateDisplayColorPrimvar().Set([Gf.Vec3f(0.2, 0.4, 0.9)])
    volume = UsdVol.Volume.Define(stage, "/World/Volume")
    UsdGeom.Xformable(volume.GetPrim()).AddTranslateOp().Set(Gf.Vec3d(0.0, 0.0, 0.0))
    field = UsdVol.OpenVDBAsset.Define(stage, "/World/Volume/density")
    field.CreateFilePathAttr(Sdf.AssetPath(vdb_path.name))
    field.CreateFieldNameAttr("density")
    volume.CreateFieldRelationship("density", field.GetPath())
    dome = UsdLux.DomeLight.Define(stage, "/World/Dome")
    dome.CreateIntensityAttr(1200.0)
    sun = UsdLux.DistantLight.Define(stage, "/World/Sun")
    sun.CreateIntensityAttr(3000.0)
    UsdGeom.Xformable(sun.GetPrim()).AddRotateXYZOp().Set(Gf.Vec3f(-45.0, 30.0, 0.0))
    stage.GetRootLayer().Save()


def _pixel_diff(visible: Path, hidden: Path) -> dict:
    """Mean absolute difference and changed-pixel fraction between the two captures (PIL inside Kit)."""
    try:
        import numpy as np
        from PIL import Image

        a = np.asarray(Image.open(visible).convert("RGB"), dtype=np.int16)
        b = np.asarray(Image.open(hidden).convert("RGB"), dtype=np.int16)
        if a.shape != b.shape:
            return {"error": f"shape mismatch {a.shape} vs {b.shape}"}
        diff = np.abs(a - b).sum(axis=2)
        return {
            "mean_abs_diff": float(diff.mean()),
            "changed_pixel_fraction": float((diff > 24).mean()),
            "shape": list(a.shape),
            "verdict": "volume_rendered" if (diff > 24).mean() > 0.0005 else "no_visible_difference",
        }
    except Exception as exc:  # noqa: BLE001
        return {"error": f"{type(exc).__name__}: {exc}"}


async def _wait_frames(app, count: int) -> None:
    for _ in range(max(0, count)):
        await app.next_update_async()


async def _run(args: argparse.Namespace) -> None:
    app = omni.kit.app.get_app()
    out = Path(args.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    settings = carb.settings.get_settings()
    evidence: dict = {
        "schema": "cfd-usdvol-probe/v1",
        "started_utc": _now(),
        "kit_version": app.get_kit_version(),
        "renderer": settings.get("/renderer/active"),
        "extensions": {},
        "captures": [],
    }
    exit_code = 1
    try:
        manager = app.get_extension_manager()
        for ext_id in ("omni.volume", "omni.hydra.rtx", "omni.usd.schema.vol", "omni.volume_nodes"):
            enabled = manager.is_extension_enabled(ext_id)
            evidence["extensions"][ext_id] = {"enabled": bool(enabled)}
        if not manager.is_extension_enabled("omni.volume"):
            manager.set_extension_enabled_immediate("omni.volume", True)
            evidence["extensions"]["omni.volume"]["enabled_by_probe"] = True

        vdb_path = out / "probe.vdb"
        _write_vdb(vdb_path, args.size, evidence, extent_m=args.extent_m, density_scale=args.density_scale)
        stage_path = out / "usdvol_probe.usda"
        _author_stage(stage_path, vdb_path)

        ctx = omni.usd.get_context()
        t0 = time.time()
        ok, error = await ctx.open_stage_async(str(stage_path))
        evidence["open_stage"] = {"ok": bool(ok), "error": str(error) if error else None, "seconds": round(time.time() - t0, 2)}
        if not ok:
            raise RuntimeError(f"open_stage failed: {error}")
        deadline = time.time() + 300.0
        while time.time() < deadline:
            status = ctx.get_stage_loading_status()
            if int(status[1]) == 0 and int(status[2]) == 0:
                break
            await app.next_update_async()
        stage = ctx.get_stage()
        from pxr import UsdGeom

        volume_prim = stage.GetPrimAtPath("/World/Volume")
        evidence["volume_prim"] = {"valid": volume_prim.IsValid(), "type": volume_prim.GetTypeName(), "field_type": stage.GetPrimAtPath("/World/Volume/density").GetTypeName()}

        from omni.kit.viewport.utility import capture_viewport_to_file, frame_viewport_prims, get_active_viewport

        viewport = get_active_viewport()
        if viewport is None:
            raise RuntimeError("no active viewport")
        frame_viewport_prims(viewport, prims=["/World/Volume"])
        await _wait_frames(app, args.settle_frames)

        async def capture(name: str) -> None:
            path = out / f"{name}.png"
            handle = capture_viewport_to_file(viewport, str(path))
            result = await handle.wait_for_result(completion_frames=30)
            evidence["captures"].append({"name": name, "path": str(path), "result": str(result), "bytes": path.stat().st_size if path.exists() else 0})

        await capture("usdvol_visible")
        UsdGeom.Imageable(volume_prim).MakeInvisible()
        await _wait_frames(app, 60)
        await capture("usdvol_hidden")
        UsdGeom.Imageable(volume_prim).MakeVisible()
        evidence["pixel_diff"] = _pixel_diff(out / "usdvol_visible.png", out / "usdvol_hidden.png")
        exit_code = 0
    except Exception:  # noqa: BLE001
        evidence["error"] = traceback.format_exc()
        carb.log_error(evidence["error"])
    finally:
        evidence["finished_utc"] = _now()
        evidence["exit_code"] = exit_code
        (out / "usdvol_probe.json").write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
        app.post_quit(exit_code)


def main() -> None:
    args = _parse()
    asyncio.ensure_future(_run(args))


main()

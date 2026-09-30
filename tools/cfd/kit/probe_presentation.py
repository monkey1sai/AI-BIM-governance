"""Kit ``--exec`` runner for the CP1 presentation probes (docs/plans/cfd-presentation-parity-contract.md §6).

Runs inside Kit's Python. Every probe opens a directory written by
``make_presentation_probe_stage.py`` the way the product composes a CFD run:
``model.usdc`` is the root layer and ``overlay.usdc`` is appended to the session
layer's sublayers, then the timeline is configured like
``stage_loading._sync_cfd_animation_playback`` (without playing). Captures use
fixed session-layer cameras so pixel differences between stages are meaningful.

Helpers (fallback lights, pixel diff, redaction, overlay-style controller) are
loaded from ``open_stage_capture_and_quit.py`` without running its ``main()`` so
that harness stays byte-for-byte unchanged for its callers.

Probes (``--probe``), each writing ``probe_<name>.json`` and PNGs to ``--out-dir``:

* ``growth``   P1: capture one stage at ``--times``; diff vs the first capture and the previous one.
* ``stages``   P2/P3/P5: open each ``--stage label=dir`` in turn; timings, colour stats, optional
               ``--mask-prim`` (hide it in the session layer and diff) and ``--pairs a:b`` diffs.
* ``sections`` P4: toggle ``Section_*`` one at a time through session-layer visibility, then two
               overlapping sections opaque and translucent (OverlayStyleController).
* ``timeline`` P7: measure the overlay frame actually resolved per wall second for playback-rate
               candidates, plus loop, pause, resume and restart.

Launch (from bim-streaming-server/_build/windows-x86_64/release):

    kit\\kit.exe apps/ezplus.bim_review_stream.kit --no-window --ext-folder <repo>/bim-streaming-server/source/extensions
        --portable-root <dir> --/app/fastShutdown=1
        --exec "<this file> --probe growth --stage p1a=<probe dir> --out-dir <dir>"
"""

from __future__ import annotations

import argparse
import asyncio
import importlib
import json
import math
import time
import traceback
import types
from datetime import datetime, timezone
from pathlib import Path

import carb
import omni.kit.app
import omni.usd

CAMERA_ROOT = "/CfdProbeCams"
CLOCK_ATTR = "probe:frame"
# Fixed cameras fitted to the generator's default 40 x 25 x 30 m building and its ±3H pedestrian plane.
VIEWS = {
    "iso": ((-125.0, -162.0, 125.0), (10.0, 0.0, 5.0), (0.0, 0.0, 1.0)),
    "near": ((-70.0, -95.0, 70.0), (5.0, 0.0, 10.0), (0.0, 0.0, 1.0)),
    "top": ((0.0, 0.0, 340.0), (0.0, 0.0, 0.0), (0.0, 1.0, 0.0)),  # north (+Y) up
}


def _load_harness() -> types.ModuleType:
    path = Path(__file__).with_name("open_stage_capture_and_quit.py")
    source = path.read_text(encoding="utf-8").replace("\r\n", "\n")
    tail = "\n\nmain()\n"
    if not source.endswith(tail):
        raise RuntimeError("open_stage_capture_and_quit.py no longer ends with main(); update the probe loader")
    module = types.ModuleType("cfd_capture_harness")
    module.__file__ = str(path)
    exec(compile(source[: -len("main()\n")], str(path), "exec"), module.__dict__)  # noqa: S102 - repo file, helpers only
    return module


H = _load_harness()


def _parse() -> argparse.Namespace:
    parser = argparse.ArgumentParser("CFD presentation probes (CP1)")
    parser.add_argument("--probe", required=True, choices=("growth", "stages", "sections", "timeline"))
    parser.add_argument("--stage", action="append", default=[], help="<label>=<probe dir>; repeat for the stages probe")
    parser.add_argument("--warmup", default="", help="probe dir opened and captured first, excluded from timings")
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--views", default="iso", help="comma list of " + ",".join(VIEWS))
    parser.add_argument("--times", default="0,24,48,72,96,120,144,200,0")
    parser.add_argument("--mask-prim", default="", help="stages: run-prim child to hide for a pixel mask")
    parser.add_argument("--pairs", default="", help="stages: label:label[/view] diffs, comma separated")
    parser.add_argument("--settle-frames", type=int, default=60)
    parser.add_argument("--timeout-s", type=float, default=600.0)
    parser.add_argument("--redact", action="append", default=[], help="<path-prefix>=<label>")
    return parser.parse_known_args()[0]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


async def _frames(app, count: int) -> None:
    for _ in range(max(0, count)):
        await app.next_update_async()


def _timeline():
    # importlib: a local ``import omni.timeline`` would shadow the module-level ``omni`` name.
    return importlib.import_module("omni.timeline").get_timeline_interface()


def _commit(timeline) -> None:
    if hasattr(timeline, "commit"):
        timeline.commit()


def _image(path: Path):
    import numpy as np
    from PIL import Image

    return np.asarray(Image.open(path).convert("RGB"), dtype=np.int16)


def _colour_stats(path: Path) -> dict:
    """Share of saturated pixels and how many of 12 hue bins hold >1% of them (per-arrow colour evidence)."""
    import numpy as np
    from PIL import Image

    hsv = np.asarray(Image.open(path).convert("RGB").convert("HSV"))
    saturated = (hsv[..., 1] > 120) & (hsv[..., 2] > 60)
    hues = hsv[..., 0][saturated].astype(int)
    hist = np.bincount(hues * 12 // 256, minlength=12)
    total = max(int(saturated.sum()), 1)
    return {"saturated_fraction": round(float(saturated.mean()), 5), "hue_bins_over_1pct": int((hist > 0.01 * total).sum()),
            "hue_hist": [int(v) for v in hist]}


def _mask(a_path: Path, b_path: Path, threshold: int = 24, strong: int = 120) -> dict:
    """Pixels that differ between two captures (with / without a prim).

    ``strong`` keeps only large differences (the prim itself, not its soft shadow or denoiser noise). On those
    pixels: centroid bearing from the image centre and, from the principal axis, the direction of the wider
    end (an arrow head). Bearings are image-up = 0 deg, clockwise; in the ``top`` view image-up is model +Y.
    """
    import numpy as np

    a, b = _image(a_path), _image(b_path)
    diff = np.abs(a - b).sum(axis=2)
    changed = diff > threshold
    out = {"pixels": int(changed.sum()), "fraction": round(float(changed.mean()), 5)}
    ys, xs = np.nonzero(diff > strong)
    out["strong_pixels"] = int(xs.size)
    if xs.size < 10:
        return out
    h, w = diff.shape
    cx, cy = float(xs.mean()), float(ys.mean())
    pts = np.stack([xs - cx, -(ys - cy)], axis=1).astype(np.float64)  # x right, y up
    axis = np.linalg.eigh(pts.T @ pts / len(pts))[1][:, 1]
    along, across = pts @ axis, pts @ np.array([-axis[1], axis[0]])
    head_positive = np.abs(across[along > 0]).max(initial=0.0) > np.abs(across[along < 0]).max(initial=0.0)
    tip = axis if head_positive else -axis
    out.update({"centroid_px": [round(cx, 1), round(cy, 1)],
                "bearing_from_centre_deg": round(math.degrees(math.atan2(cx - w / 2, -(cy - h / 2))) % 360.0, 1),
                "pointing_deg": round(math.degrees(math.atan2(tip[0], tip[1])) % 360.0, 1)})
    return out


def _set_camera(stage, viewport, view: str) -> str:
    from pxr import Gf, Sdf, Usd, UsdGeom

    eye, target, up = VIEWS[view]
    path = f"{CAMERA_ROOT}/{view}"
    with Usd.EditContext(stage, stage.GetSessionLayer()):
        UsdGeom.Scope.Define(stage, Sdf.Path(CAMERA_ROOT))
        camera = UsdGeom.Camera.Define(stage, Sdf.Path(path))
        camera.CreateFocalLengthAttr(18.147562)
        camera.CreateHorizontalApertureAttr(20.955)
        camera.CreateVerticalApertureAttr(15.2908)
        camera.CreateClippingRangeAttr(Gf.Vec2f(1.0, 100000.0))
        xform = UsdGeom.Xformable(camera)
        xform.ClearXformOpOrder()
        matrix = Gf.Matrix4d().SetLookAt(Gf.Vec3d(*eye), Gf.Vec3d(*target), Gf.Vec3d(*up)).GetInverse()
        xform.AddTransformOp().Set(matrix)
    viewport.camera_path = path
    return path


def _camera_readback(viewport) -> dict:
    """What Kit actually renders with: camera path, eye position and projection diagonal."""
    out: dict = {"camera_path": str(viewport.camera_path)}
    try:
        transform = viewport.transform
        out["eye"] = [round(float(transform[3][i]), 2) for i in range(3)]
        projection = viewport.projection
        out["projection_diag"] = [round(float(projection[i][i]), 4) for i in range(4)]
    except Exception as exc:  # noqa: BLE001
        out["error"] = f"{type(exc).__name__}: {exc}"
    return out


def _set_visibility(stage, prim_path: str, token: str | None) -> None:
    """Session-layer visibility opinion; ``None`` removes it (the artifact value shows again)."""
    from pxr import Usd, UsdGeom

    session = stage.GetSessionLayer()
    if token is None:
        spec = session.GetPrimAtPath(prim_path)
        if spec is not None and spec.properties.get("visibility") is not None:
            spec.RemoveProperty(spec.properties["visibility"])
        return
    with Usd.EditContext(stage, session):
        UsdGeom.Imageable(stage.GetPrimAtPath(prim_path)).GetVisibilityAttr().Set(token)


class Probe:
    def __init__(self, args: argparse.Namespace):
        self.args = args
        self.app = omni.kit.app.get_app()
        self.ctx = omni.usd.get_context()
        self.out = Path(args.out_dir)
        self.out.mkdir(parents=True, exist_ok=True)
        self.viewport = None
        self.evidence: dict = {
            "schema": "cfd-presentation-probe/v1",
            "probe": args.probe,
            "started_utc": _now(),
            "kit_version": self.app.get_kit_version(),
            "renderer": carb.settings.get_settings().get("/renderer/active"),
        }

    # ── stage handling ────────────────────────────────────────────────────────
    async def open_probe(self, probe_dir: str) -> tuple[object, dict, dict]:
        """Product composition: root = model.usdc, overlay appended to the session sublayers."""
        from pxr import Sdf

        probe_dir_path = Path(probe_dir)
        manifest = json.loads((probe_dir_path / "manifest.json").read_text(encoding="utf-8"))
        timings: dict = {}
        t0 = time.perf_counter()
        ok, error = await self.ctx.open_stage_async(str(probe_dir_path / "model.usdc"))
        if not ok:
            raise RuntimeError(f"open_stage failed: {error}")
        timings["open_model_s"] = round(time.perf_counter() - t0, 3)
        stage = self.ctx.get_stage()
        t1 = time.perf_counter()
        overlay = Sdf.Layer.FindOrOpen(str(probe_dir_path / "overlay.usdc"))
        stage.GetSessionLayer().subLayerPaths.append(overlay.identifier)
        timings["compose_overlay_s"] = round(time.perf_counter() - t1, 3)
        deadline = time.time() + self.args.timeout_s
        while time.time() < deadline:
            _, loading, total = self.ctx.get_stage_loading_status()
            if int(loading) == 0 and int(total) == 0:
                break
            await self.app.next_update_async()
        timings["overlay_loaded_s"] = round(time.perf_counter() - t1, 3)
        H._ensure_default_lighting(stage)
        anim = dict(overlay.customLayerData or {}).get("cfd:animation")
        if anim:
            timeline = _timeline()
            fps, frames = float(anim["fps"]), int(anim["frames"])
            timeline.set_time_codes_per_second(fps)
            timeline.set_start_time(0.0)
            timeline.set_end_time((frames - 1) / fps)
            timeline.set_looping(bool(anim.get("loop", True)))
            timeline.set_current_time(0.0)
            _commit(timeline)
        if self.viewport is None:
            from omni.kit.viewport.utility import get_active_viewport

            self.viewport = get_active_viewport()
            self.evidence["viewport"] = {"resolution": [int(v) for v in self.viewport.resolution]}
        return stage, manifest, {"t0": t0, "t1": t1, **timings}

    async def capture(self, name: str) -> Path:
        from omni.kit.viewport.utility import capture_viewport_to_file

        path = self.out / f"{name}.png"
        if path.exists():
            path.unlink()
        handle = capture_viewport_to_file(self.viewport, str(path))
        await handle.wait_for_result(completion_frames=30)
        # The PNG is written asynchronously after the capture completes; wait until it is there and stable.
        size = -1
        for _ in range(600):
            if path.exists() and path.stat().st_size == size and size > 0:
                return path
            size = path.stat().st_size if path.exists() else -1
            await self.app.next_update_async()
        raise RuntimeError(f"capture {name} produced no file")

    def run_path(self, manifest: dict) -> str:
        return manifest["run_prim"]

    def _on_view(self, name: str) -> bool:
        readback = _camera_readback(self.viewport)
        eye = VIEWS[name][0]
        return readback.get("camera_path") == f"{CAMERA_ROOT}/{name}" and all(
            abs(a - b) < 0.5 for a, b in zip(readback.get("eye", []), eye)) and len(readback.get("eye", [])) == 3

    async def view(self, stage, name: str) -> dict:
        """Select a fixed camera. The app frames the active camera by itself after a stage opens or an overlay
        is composed (asynchronously, sometimes after the settle frames), so re-set until the readback matches."""
        for attempt in range(1, 6):
            _set_camera(stage, self.viewport, name)
            await _frames(self.app, 30)
            if self._on_view(name):
                break
        readback = {**_camera_readback(self.viewport), "attempts": attempt}
        self.evidence.setdefault("cameras", {})[name] = readback
        return readback

    async def shot(self, stage, name: str, view: str) -> Path:
        """Capture on a fixed camera; recapture if the app moved the camera during the capture."""
        for attempt in range(1, 4):
            await self.view(stage, view)
            path = await self.capture(name)
            if self._on_view(view):
                if attempt > 1:
                    self.evidence.setdefault("recaptures", []).append({"name": name, "attempts": attempt})
                return path
        raise RuntimeError(f"camera {view} kept moving during capture {name}")

    # ── P1 ────────────────────────────────────────────────────────────────────
    async def growth(self) -> None:
        from pxr import Usd, UsdGeom

        label, probe_dir = self.args.stage[0].split("=", 1)
        stage, manifest, _ = await self.open_probe(probe_dir)
        view = self.args.views.split(",")[0]
        _set_camera(stage, self.viewport, view)
        await _frames(self.app, self.args.settle_frames)
        await self.view(stage, view)
        timeline = _timeline()
        run = self.run_path(manifest)
        group = stage.GetPrimAtPath(f"{run}/StreamlineGrowth")
        segs = [p for p in Usd.PrimRange(group) if p.IsA(UsdGeom.BasisCurves)]
        tcps = float(stage.GetTimeCodesPerSecond() or 24.0)
        captures, first, previous = [], None, None
        for index, code in enumerate(float(v) for v in self.args.times.split(",") if v.strip()):
            timeline.set_current_time(code / tcps)
            _commit(timeline)
            await _frames(self.app, 30)
            path = await self.shot(stage, f"{label}_{view}_{index:02d}_t{int(code):04d}", view)
            visible = sum(1 for s in segs if UsdGeom.Imageable(s).ComputeVisibility(Usd.TimeCode(code)) != UsdGeom.Tokens.invisible)
            widths = None
            if group.IsA(UsdGeom.BasisCurves):
                values = UsdGeom.BasisCurves(group).GetWidthsAttr().Get(Usd.TimeCode(code))
                widths = {"nonzero": int(sum(1 for w in values if w > 0)), "total": len(values)} if values else None
            entry = {"index": index, "time_code": code, "timeline_time_code": round(timeline.get_current_time() * tcps, 3),
                     "segments_visible_usd": visible, "segments_total": len(segs), "widths_usd": widths, "png": path.name}
            if first is not None:
                entry["diff_vs_first"] = H._pixel_diff(first, path)
                entry["diff_vs_previous"] = H._pixel_diff(previous, path)
            first = first or path
            previous = path
            captures.append(entry)
        self.evidence["growth"] = {"stage": label, "manifest_prims": manifest["prims"], "view": view, "captures": captures}

    # ── P2 / P3 / P5 ──────────────────────────────────────────────────────────
    async def stages(self) -> None:
        views = [v for v in self.args.views.split(",") if v]
        if self.args.warmup:
            stage, _, _ = await self.open_probe(self.args.warmup)
            _set_camera(stage, self.viewport, views[0])
            await _frames(self.app, self.args.settle_frames)
            await self.shot(stage, "warmup", views[0])
            self.evidence["warmup"] = True
        results = []
        for item in self.args.stage:
            label, probe_dir = item.split("=", 1)
            stage, manifest, timings = await self.open_probe(probe_dir)
            _set_camera(stage, self.viewport, views[0])
            await _frames(self.app, self.args.settle_frames)
            first = await self.shot(stage, f"{label}_{views[0]}", views[0])
            timings["open_to_first_capture_s"] = round(time.perf_counter() - timings.pop("t0"), 3)
            timings["compose_to_first_capture_s"] = round(time.perf_counter() - timings.pop("t1"), 3)
            entry = {"label": label, "overlay_bytes": manifest["overlay_bytes"], "prims": manifest["prims"], "timings": timings,
                     "captures": {views[0]: {"png": first.name, **_colour_stats(first)}}}
            for view in views[1:]:
                path = await self.shot(stage, f"{label}_{view}", view)
                entry["captures"][view] = {"png": path.name, **_colour_stats(path)}
            if self.args.mask_prim:
                prim_path = f"{self.run_path(manifest)}/{self.args.mask_prim}"
                entry["mask"] = {}
                for view in views:
                    _set_visibility(stage, prim_path, "invisible")
                    hidden = await self.shot(stage, f"{label}_{view}_without_{self.args.mask_prim}", view)
                    _set_visibility(stage, prim_path, None)
                    await _frames(self.app, 30)
                    entry["mask"][view] = _mask(self.out / entry["captures"][view]["png"], hidden)
            results.append(entry)
        by_label = {r["label"]: r for r in results}
        pairs = []
        for pair in (p for p in self.args.pairs.split(",") if p):
            spec, _, view = pair.partition("/")
            a, b = spec.split(":")
            view = view or views[0]
            pairs.append({"a": a, "b": b, "view": view,
                          **H._pixel_diff(self.out / by_label[a]["captures"][view]["png"], self.out / by_label[b]["captures"][view]["png"])})
        self.evidence["stages"] = results
        self.evidence["pairs"] = pairs

    # ── P4 ────────────────────────────────────────────────────────────────────
    async def sections(self) -> None:
        from pxr import UsdGeom

        label, probe_dir = self.args.stage[0].split("=", 1)
        stage, manifest, _ = await self.open_probe(probe_dir)
        view = self.args.views.split(",")[0]
        _set_camera(stage, self.viewport, view)
        await _frames(self.app, self.args.settle_frames)
        await self.view(stage, view)
        run = self.run_path(manifest)
        names = sorted(manifest["prims"]["sections"]["prims"], key=lambda n: ["Z1", "Z2", "Z3", "X1", "Y1"].index(n.split("_")[1]))
        artifact_layers = [layer for layer in stage.GetLayerStack(includeSessionLayers=True) if layer != stage.GetSessionLayer()]
        dirty_before = {layer.identifier: layer.dirty for layer in artifact_layers}
        result: dict = {"stage": label, "view": view, "sections": names, "toggles": []}
        result["default_visibility"] = {n: str(UsdGeom.Imageable(stage.GetPrimAtPath(f"{run}/{n}")).ComputeVisibility()) for n in names}
        with_plane = await self.shot(stage, f"{label}_{view}_base_with_plane", view)
        _set_visibility(stage, f"{run}/PedestrianWind_1p5m", "invisible")
        await _frames(self.app, 30)
        base = await self.shot(stage, f"{label}_{view}_base", view)
        result["plane_hidden_diff"] = H._pixel_diff(with_plane, base)
        for name in names:
            path = f"{run}/{name}"
            _set_visibility(stage, path, "inherited")
            await _frames(self.app, 30)
            shot = await self.shot(stage, f"{label}_{view}_{name}", view)
            readback = str(UsdGeom.Imageable(stage.GetPrimAtPath(path)).ComputeVisibility())
            others = [n for n in names if n != name and UsdGeom.Imageable(stage.GetPrimAtPath(f"{run}/{n}")).ComputeVisibility() != UsdGeom.Tokens.invisible]
            _set_visibility(stage, path, None)
            result["toggles"].append({"section": name, "readback": readback, "others_visible": others, "png": shot.name,
                                      "diff_vs_base": H._pixel_diff(base, shot)})
        await _frames(self.app, 30)
        restored = await self.shot(stage, f"{label}_{view}_restored", view)
        result["restored_diff_vs_base"] = H._pixel_diff(base, restored)
        result["pairwise_toggle_diffs"] = [
            {"a": a["section"], "b": b["section"], **H._pixel_diff(self.out / a["png"], self.out / b["png"])}
            for i, a in enumerate(result["toggles"]) for b in result["toggles"][i + 1:]]
        pair = [n for n in names if n.endswith(("Z2", "X1"))]
        for name in pair:
            _set_visibility(stage, f"{run}/{name}", "inherited")
        await _frames(self.app, 30)
        opaque = await self.shot(stage, f"{label}_{view}_overlap_opaque", view)
        controller = H._overlay_style_controller(lambda: stage)
        applied = [controller.apply(f"{run}/{name}", 0.5) for name in pair]
        await _frames(self.app, 60)
        translucent = await self.shot(stage, f"{label}_{view}_overlap_translucent", view)
        result["overlap"] = {"sections": pair, "applied": applied, "diff_opaque_vs_translucent": H._pixel_diff(opaque, translucent),
                             "diff_translucent_vs_base": H._pixel_diff(base, translucent)}
        result["artifact_layers_dirtied"] = [layer.identifier for layer in artifact_layers
                                             if layer.dirty and not dirty_before.get(layer.identifier, False)]
        self.evidence["sections"] = result

    # ── P7 ────────────────────────────────────────────────────────────────────
    async def _measure(self, stage, clock, seconds: float, frames: int, tag: str) -> dict:
        from pxr import Usd

        timeline = _timeline()
        code_of = getattr(timeline, "time_to_time_code", None)
        samples = []
        end = time.perf_counter() + seconds
        while time.perf_counter() < end:
            await self.app.next_update_async()
            t = float(timeline.get_current_time())
            code = float(code_of(t)) if code_of else t * float(timeline.get_time_codes_per_seconds())
            samples.append((time.perf_counter(), t, code, float(clock.Get(Usd.TimeCode(code)))))
        advanced, wraps = 0.0, 0
        for (_, _, _, f0), (_, _, _, f1) in zip(samples, samples[1:]):
            step = f1 - f0
            if step < -frames / 2:
                step += frames
                wraps += 1
            advanced += step
        wall = samples[-1][0] - samples[0][0] if len(samples) > 1 else 0.0
        return {"tag": tag, "wall_s": round(wall, 3), "updates": len(samples), "overlay_frames_advanced": round(advanced, 2),
                "overlay_fps": round(advanced / wall, 2) if wall else None, "wraps": wraps,
                "timeline_seconds": [round(samples[0][1], 3), round(samples[-1][1], 3)],
                "time_codes": [round(samples[0][2], 2), round(samples[-1][2], 2)],
                "overlay_frames": [round(samples[0][3], 2), round(samples[-1][3], 2)],
                "is_playing": bool(timeline.is_playing())}

    async def timeline_rate(self) -> None:
        from pxr import Sdf

        label, probe_dir = self.args.stage[0].split("=", 1)
        stage, manifest, _ = await self.open_probe(probe_dir)
        timeline = _timeline()
        run = stage.GetPrimAtPath(self.run_path(manifest))
        clock = run.GetAttribute(CLOCK_ATTR)
        anim = manifest["spec"]
        fps, frames = float(anim["fps"]), int(anim["frames"])
        session = stage.GetSessionLayer()
        root = stage.GetRootLayer()
        overlay_id = session.subLayerPaths[-1]
        overlay_layer = Sdf.Layer.Find(overlay_id)
        result: dict = {"stage": label, "fps": fps, "frames": frames,
                        "timeline_api": sorted(n for n in dir(timeline) if not n.startswith("_")), "runs": []}

        def layer_state(tag: str) -> dict:
            return {"tag": tag, "stage_tcps": stage.GetTimeCodesPerSecond(),
                    "root_tcps_authored": root.HasTimeCodesPerSecond(), "root_tcps": root.timeCodesPerSecond,
                    "session_tcps_authored": session.HasTimeCodesPerSecond(),
                    "timeline_tcps": float(timeline.get_time_codes_per_seconds()) if hasattr(timeline, "get_time_codes_per_seconds") else None,
                    "timeline_end_s": float(timeline.get_end_time()), "looping": bool(timeline.is_looping()),
                    "root_dirty": root.dirty, "overlay_dirty": overlay_layer.dirty if overlay_layer else None,
                    "session_offsets": [(o.offset, o.scale) for o in session.subLayerOffsets]}

        result["states"] = [layer_state("configured")]
        timeline.play()
        _commit(timeline)
        await _frames(self.app, 10)
        result["runs"].append(await self._measure(stage, clock, 2.5, frames, "baseline_1x"))

        # Candidate A: timeline time-codes-per-second (what stage_loading already calls at compose time).
        for rate in (0.25, 4.0, 1.0):
            timeline.set_time_codes_per_second(fps * rate)
            _commit(timeline)
            await _frames(self.app, 5)
            result["states"].append(layer_state(f"A_tcps_{rate:g}x"))
            result["runs"].append(await self._measure(stage, clock, 4.0 if rate > 1 else 3.0, frames, f"A_tcps_{rate:g}x"))

        # Candidate B: session-sublayer offset scale on the overlay layer + timeline end time in the scaled range.
        timeline.set_time_codes_per_second(fps)
        _commit(timeline)
        index = list(session.subLayerPaths).index(overlay_id)
        scale_now = 1.0
        for rate in (0.25, 4.0, 1.0):
            scale = 1.0 / rate
            current = float(timeline.get_current_time())
            session.subLayerOffsets[index] = Sdf.LayerOffset(0.0, scale)
            timeline.set_end_time((frames - 1) * scale / fps)
            timeline.set_current_time(current * scale / scale_now)  # keep the displayed overlay frame
            _commit(timeline)
            scale_now = scale
            await _frames(self.app, 5)
            result["states"].append(layer_state(f"B_offset_{rate:g}x"))
            result["runs"].append(await self._measure(stage, clock, 4.0 if rate > 1 else 3.0, frames, f"B_offset_{rate:g}x"))

        # Pause / resume / restart at 4x through B (loop already exercised above).
        session.subLayerOffsets[index] = Sdf.LayerOffset(0.0, 0.25)
        timeline.set_end_time((frames - 1) * 0.25 / fps)
        _commit(timeline)
        await _frames(self.app, 5)
        timeline.pause()
        _commit(timeline)
        await _frames(self.app, 2)
        paused = await self._measure(stage, clock, 1.0, frames, "paused_4x")
        timeline.play()
        _commit(timeline)
        resumed = await self._measure(stage, clock, 1.0, frames, "resumed_4x")
        resumed["resume_gap_frames"] = round(resumed["overlay_frames"][0] - paused["overlay_frames"][1], 2)
        timeline.set_current_time(0.0)
        _commit(timeline)
        restarted = await self._measure(stage, clock, 0.5, frames, "restart_4x")
        result["runs"] += [paused, resumed, restarted]
        result["states"].append(layer_state("end"))
        timeline.stop()
        self.evidence["timeline"] = result

    async def run(self) -> None:
        exit_code = 1
        try:
            handler = {"growth": self.growth, "stages": self.stages, "sections": self.sections, "timeline": self.timeline_rate}[self.args.probe]
            await handler()
            exit_code = 0
        except Exception:  # noqa: BLE001
            self.evidence["error"] = traceback.format_exc()
            carb.log_error(self.evidence["error"])
        finally:
            self.evidence["finished_utc"] = _now()
            self.evidence["exit_code"] = exit_code
            rules = [tuple(rule.split("=", 1)) for rule in self.args.redact if "=" in rule]
            (self.out / f"probe_{self.args.probe}.json").write_text(json.dumps(H._redact(self.evidence, rules), ensure_ascii=False, indent=2), encoding="utf-8")
            self.app.post_quit(exit_code)


asyncio.ensure_future(Probe(_parse()).run())

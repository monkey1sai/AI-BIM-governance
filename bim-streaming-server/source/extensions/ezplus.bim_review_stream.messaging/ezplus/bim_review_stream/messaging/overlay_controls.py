"""CFD visibility and playback controls; only session opinions may change."""
import math
from bisect import bisect_right
import re

try:
    from .overlay_style import OVERLAY_ROOT, parse_prim_path
    from .kit_command_vocabulary import OVERLAY_PLAYBACK_ACTIONS, OVERLAY_PLAYBACK_RATE_MINIMUM, OVERLAY_PLAYBACK_RATE_MAXIMUM
except ImportError:  # pragma: no cover - direct test imports
    from overlay_style import OVERLAY_ROOT, parse_prim_path
    from kit_command_vocabulary import OVERLAY_PLAYBACK_ACTIONS, OVERLAY_PLAYBACK_RATE_MINIMUM, OVERLAY_PLAYBACK_RATE_MAXIMUM


def clear_overlay_visibility_overrides(stage):
    """Remove session visibility opinions before recomposing overlay artifacts."""
    root = stage.GetSessionLayer().GetPrimAtPath(OVERLAY_ROOT)
    if root is None:
        return 0
    touched = 0
    pending = [root]
    while pending:
        spec = pending.pop()
        pending.extend(spec.nameChildren.values())
        if spec.properties.get("visibility") is not None:
            del spec.properties["visibility"]
            touched += 1
    return touched


class OverlayControlsController:
    def __init__(self, stage_provider, timeline_provider):
        self._stage_provider = stage_provider
        self._timeline_provider = timeline_provider

    def visibility(self, items):
        if not isinstance(items, list) or not 1 <= len(items) <= 32:
            raise ValueError("Invalid overlay visibility items.")
        parsed = []
        for item in items:
            if not isinstance(item, dict) or "prim_path" not in item or set(item) - {"prim_path", "visible"} or ("visible" in item and not isinstance(item["visible"], bool)):
                raise ValueError("Invalid overlay visibility item.")
            parsed.append((parse_prim_path(item["prim_path"]), item.get("visible")))
        if len({path for path, _ in parsed}) != len(parsed):
            raise ValueError("Duplicate overlay prim path.")
        stage = self._stage_provider()
        if stage is None:
            raise ValueError("No stage is open.")
        from pxr import Usd, UsdGeom

        targets = [(path, visible, UsdGeom.Imageable(stage.GetPrimAtPath(path))) for path, visible in parsed]
        with Usd.EditContext(stage, stage.GetSessionLayer()):
            for _path, visible, target in targets:
                if target and visible is not None:
                    target.CreateVisibilityAttr().Set(UsdGeom.Tokens.inherited if visible else UsdGeom.Tokens.invisible)
        return [{"prim_path": path, "present": bool(target),
                 "visible": bool(target) and target.ComputeVisibility() != UsdGeom.Tokens.invisible}
                for path, _visible, target in targets]

    def playback(self, action, rate=None, sample_index=None):
        if action not in OVERLAY_PLAYBACK_ACTIONS:
            raise ValueError("Invalid overlay playback action.")
        if action == "set_rate":
            if (isinstance(rate, bool) or not isinstance(rate, (int, float)) or not math.isfinite(rate)
                    or not OVERLAY_PLAYBACK_RATE_MINIMUM <= rate <= OVERLAY_PLAYBACK_RATE_MAXIMUM):
                raise ValueError("Invalid overlay playback rate.")
        elif rate is not None:
            raise ValueError("Rate is only valid for set_rate.")
        if action == "seek":
            if isinstance(sample_index, bool) or not isinstance(sample_index, int) or not 0 <= sample_index < 64:
                raise ValueError("Invalid physical sample index.")
        elif sample_index is not None:
            raise ValueError("Sample index is only valid for seek.")
        stage = self._stage_provider()
        if stage is None:
            raise ValueError("No stage is open.")
        from pxr import Sdf

        session = stage.GetSessionLayer()
        animated = None
        for index, identifier in enumerate(session.subLayerPaths):
            layer = Sdf.Layer.Find(identifier)
            data = dict(layer.customLayerData or {}).get("cfd:animation") if layer else None
            if data:
                if animated is not None:
                    raise ValueError("Playback requires exactly one animated CFD overlay.")
                animated = (index, data)
        if animated is None:
            raise ValueError("No animated CFD overlay is loaded.")
        index, animation = animated
        fps, frames = float(animation.get("fps", 24)), int(animation.get("frames", 0))
        old_scale = session.subLayerOffsets[index].scale
        if not math.isfinite(fps) or fps <= 0 or frames < 2 or not math.isfinite(old_scale) or old_scale <= 0:
            raise ValueError("Invalid overlay animation metadata.")
        temporal = animation.get("temporal")
        times = codes = None
        if temporal is not None:
            times, codes = list(temporal.get("sample_times_s", [])), list(temporal.get("sample_time_codes", []))
            if (temporal.get("mode") != "urans_sampled" or not re.fullmatch(r"cfd_[A-Za-z0-9_]{6,120}",temporal.get("run_id", ""))
                    or not 2 <= len(times) == len(codes) <= 64 or not codes or codes[0] != 0
                    or not all(isinstance(t,(int,float)) and not isinstance(t,bool) and math.isfinite(t) and t >= 0 for t in times+codes)
                    or any(b <= a for a,b in zip(times,times[1:])) or any(b <= a for a,b in zip(codes,codes[1:]))
                    or codes[-1] > frames-1
                    or any(not math.isclose(code,(time-times[0])*fps,rel_tol=0,abs_tol=1e-8) for time,code in zip(times,codes))):
                raise ValueError("Invalid paired physical timeline metadata.")
        if action == "seek" and (times is None or sample_index >= len(times)):
            raise ValueError("Physical sample is unavailable.")
        timeline = self._timeline_provider()
        if action == "set_rate":
            scale = 1 / float(rate)
            current = timeline.get_current_time()
            session.subLayerOffsets[index] = Sdf.LayerOffset(0, scale)
            timeline.set_end_time((frames - 1) * scale / fps)
            timeline.set_current_time(current * scale / old_scale)
        elif action == "pause":
            timeline.pause()
        elif action == "seek":
            timeline.pause()
            timeline.set_current_time(codes[sample_index] * old_scale / fps)
        elif action in ("play", "restart"):
            if action == "restart":
                timeline.set_current_time(0.0)
            timeline.play()
        if action != "query" and hasattr(timeline, "commit"):
            timeline.commit()
        scale = session.subLayerOffsets[index].scale
        current = float(timeline.get_current_time())
        reply = {"playing": bool(timeline.is_playing()), "rate": 1 / scale, "time_seconds": current}
        if temporal is not None:
            sample = max(0,min(len(codes)-1,bisect_right(codes,current*fps/scale)-1))
            reply.update(run_id=temporal["run_id"], sample_index=sample, physical_time_seconds=times[sample])
        return reply

"""CFD visibility and playback controls; only session opinions may change."""
import math

try:
    from .overlay_style import OVERLAY_ROOT, parse_prim_path
except ImportError:  # pragma: no cover - direct test imports
    from overlay_style import OVERLAY_ROOT, parse_prim_path


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
            if not isinstance(item, dict) or set(item) != {"prim_path", "visible"} or not isinstance(item["visible"], bool):
                raise ValueError("Invalid overlay visibility item.")
            parsed.append((parse_prim_path(item["prim_path"]), item["visible"]))
        if len({path for path, _ in parsed}) != len(parsed):
            raise ValueError("Duplicate overlay prim path.")
        stage = self._stage_provider()
        if stage is None:
            raise ValueError("No stage is open.")
        from pxr import Usd, UsdGeom

        targets = [(path, visible, UsdGeom.Imageable(stage.GetPrimAtPath(path))) for path, visible in parsed]
        with Usd.EditContext(stage, stage.GetSessionLayer()):
            for _path, visible, target in targets:
                if target:
                    target.CreateVisibilityAttr().Set(UsdGeom.Tokens.inherited if visible else UsdGeom.Tokens.invisible)
        return [{"prim_path": path, "present": bool(target),
                 "visible": bool(target) and target.ComputeVisibility() != UsdGeom.Tokens.invisible}
                for path, _visible, target in targets]

    def playback(self, action, rate=None):
        if action not in ("play", "pause", "restart", "set_rate"):
            raise ValueError("Invalid overlay playback action.")
        if action == "set_rate":
            if isinstance(rate, bool) or not isinstance(rate, (int, float)) or not math.isfinite(rate) or not 0.25 <= rate <= 4:
                raise ValueError("Invalid overlay playback rate.")
        elif rate is not None:
            raise ValueError("Rate is only valid for set_rate.")
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
                animated = (index, data)
                break
        if animated is None:
            raise ValueError("No animated CFD overlay is loaded.")
        index, animation = animated
        fps, frames = float(animation.get("fps", 24)), int(animation.get("frames", 0))
        old_scale = session.subLayerOffsets[index].scale
        if not math.isfinite(fps) or fps <= 0 or frames < 2 or not math.isfinite(old_scale) or old_scale <= 0:
            raise ValueError("Invalid overlay animation metadata.")
        timeline = self._timeline_provider()
        if action == "set_rate":
            scale = 1 / float(rate)
            current = timeline.get_current_time()
            session.subLayerOffsets[index] = Sdf.LayerOffset(0, scale)
            timeline.set_end_time((frames - 1) * scale / fps)
            timeline.set_current_time(current * scale / old_scale)
        elif action == "pause":
            timeline.pause()
        else:
            if action == "restart":
                timeline.set_current_time(0.0)
            timeline.play()
        if hasattr(timeline, "commit"):
            timeline.commit()
        return {"playing": bool(timeline.is_playing()), "rate": 1 / session.subLayerOffsets[index].scale,
                "time_seconds": float(timeline.get_current_time())}

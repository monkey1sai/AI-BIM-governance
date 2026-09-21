"""Session-layer opacity override for CFD overlay prims (S5 opacity slider).

The CFD result layer is composed as a session sublayer (stage_loading
``_compose_secondary_artifact_bindings``); opinions authored directly on the
session layer are stronger than that sublayer, so nothing here touches the
artifact on disk and everything disappears with the stage.

Kit 110.1 RTX ignores ``primvars:displayOpacity`` for shading (measured: a 0.6→0.15
change moved 0.2% of pixels), so the override also binds a UsdPreviewSurface whose
``diffuseColor`` reads the prim's own ``displayColor`` ramp and whose ``opacity`` is
the requested value with ``ior 1``: RTX renders PreviewSurface opacity as
transmission, and with ior 1 that is a plain see-through blend (same trick as
focus_overlay). Opacity 1 removes the override so the authored look returns.
Only prims under ``/World/Overlays/Cfd`` may be styled; readback is the evidence.
"""
import math
import re

try:
    from .kit_command_vocabulary import OVERLAY_DISPLAY_OPACITY_MAXIMUM, OVERLAY_DISPLAY_OPACITY_MINIMUM
except ImportError:  # pragma: no cover - test modules import this file directly.
    from kit_command_vocabulary import OVERLAY_DISPLAY_OPACITY_MAXIMUM, OVERLAY_DISPLAY_OPACITY_MINIMUM

OVERLAY_ROOT = "/World/Overlays/Cfd"
# Same shape as the contract schema pattern: run prim plus optional descendants, USD identifiers only.
_PRIM_PATH = re.compile(r"^/World/Overlays/Cfd/[A-Za-z_][A-Za-z0-9_]*(/[A-Za-z_][A-Za-z0-9_]*)*$")
PRIM_PATH_MAX_LENGTH = 400
STYLE_SCOPE = "OverlayStyle"  # <run>/OverlayStyle/<prim name> materials, session layer only
GENERIC_ERROR = "Overlay style could not be applied."


def _finite(value):
    return not isinstance(value, bool) and isinstance(value, (int, float)) and math.isfinite(value)


def parse_prim_path(value):
    if not isinstance(value, str) or len(value) > PRIM_PATH_MAX_LENGTH or not _PRIM_PATH.match(value):
        raise ValueError("Invalid overlay prim path.")
    return value


def parse_display_opacity(value):
    if not _finite(value) or not OVERLAY_DISPLAY_OPACITY_MINIMUM <= value <= OVERLAY_DISPLAY_OPACITY_MAXIMUM:
        raise ValueError("Invalid display opacity.")
    return float(value)


def _run_path(prim_path):
    parts = prim_path.split("/")
    return "/".join(parts[:5])  # /World/Overlays/Cfd/<run>


def material_path_for(prim_path):
    return f"{_run_path(prim_path)}/{STYLE_SCOPE}/{prim_path.rsplit('/', 1)[-1]}"


class OverlayStyleController:
    """``stage_provider`` returns the current ``Usd.Stage`` (or ``None``); injected for tests."""

    def __init__(self, stage_provider):
        self._stage_provider = stage_provider

    @staticmethod
    def _gprims(root_prim, Usd, UsdGeom):
        if root_prim.IsA(UsdGeom.Gprim):
            return [root_prim]
        return [prim for prim in Usd.PrimRange(root_prim) if prim != root_prim and prim.IsA(UsdGeom.Gprim)]

    @staticmethod
    def _bind_material(stage, target, opacity, Sdf, UsdGeom, UsdShade, Vt):
        path = material_path_for(str(target.GetPath()))
        UsdGeom.Scope.Define(stage, Sdf.Path(path).GetParentPath())
        material = UsdShade.Material.Define(stage, path)
        reader = UsdShade.Shader.Define(stage, f"{path}/DisplayColor")
        reader.CreateIdAttr("UsdPrimvarReader_float3")
        reader.CreateInput("varname", Sdf.ValueTypeNames.String).Set("displayColor")
        reader.CreateInput("fallback", Sdf.ValueTypeNames.Float3).Set((0.5, 0.5, 0.5))
        color_out = reader.CreateOutput("result", Sdf.ValueTypeNames.Float3)
        shader = UsdShade.Shader.Define(stage, f"{path}/Surface")
        shader.CreateIdAttr("UsdPreviewSurface")
        shader.CreateInput("diffuseColor", Sdf.ValueTypeNames.Color3f).ConnectToSource(color_out)
        shader.CreateInput("roughness", Sdf.ValueTypeNames.Float).Set(0.0)
        shader.CreateInput("specular", Sdf.ValueTypeNames.Float).Set(0.0)
        # Transmission with ior 1 is a straight blend: no refraction, no blur, colour ramp preserved.
        shader.CreateInput("ior", Sdf.ValueTypeNames.Float).Set(1.0)
        shader.CreateInput("opacity", Sdf.ValueTypeNames.Float).Set(float(opacity))
        shader.CreateInput("opacityThreshold", Sdf.ValueTypeNames.Float).Set(0.0)
        material.CreateSurfaceOutput().ConnectToSource(shader.ConnectableAPI(), "surface")
        binding = UsdShade.MaterialBindingAPI.Apply(target)
        binding.Bind(material, UsdShade.Tokens.strongerThanDescendants)
        UsdGeom.Gprim(target).CreateDisplayOpacityPrimvar(UsdGeom.Tokens.constant).Set(Vt.FloatArray([float(opacity)]))
        return path

    @staticmethod
    def _remove_if_empty_over(stage, session, path, Sdf):
        # Only drop a session-layer "over" that carries nothing else; other controllers' opinions stay.
        spec = session.GetPrimAtPath(path)
        if spec is not None and spec.specifier == Sdf.SpecifierOver and not spec.properties and not spec.nameChildren:
            stage.RemovePrim(Sdf.Path(path))

    @classmethod
    def _clear_override(cls, stage, target, Sdf, UsdShade):
        session = stage.GetSessionLayer()
        target_path = str(target.GetPath())
        spec = session.GetPrimAtPath(target_path)
        if spec is not None:
            for name in ("material:binding", "primvars:displayOpacity", "primvars:displayOpacity:indices"):
                if spec.properties.get(name) is not None:
                    del spec.properties[name]
            cls._remove_if_empty_over(stage, session, target_path, Sdf)
        material_path = material_path_for(target_path)
        if session.GetPrimAtPath(material_path) is not None:
            stage.RemovePrim(Sdf.Path(material_path))
        scope_path = str(Sdf.Path(material_path).GetParentPath())
        scope = session.GetPrimAtPath(scope_path)
        if scope is not None and not scope.nameChildren:
            stage.RemovePrim(Sdf.Path(scope_path))
            cls._remove_if_empty_over(stage, session, str(Sdf.Path(scope_path).GetParentPath()), Sdf)

    @staticmethod
    def _readback(target, opacity, UsdGeom, UsdShade):
        bound, _rel = UsdShade.MaterialBindingAPI(target).ComputeBoundMaterial()
        expected_path = material_path_for(str(target.GetPath()))
        if opacity >= 1.0:
            if bound and str(bound.GetPath()) == expected_path:
                raise ValueError("Overlay style override not removed.")
            return
        if not bound or str(bound.GetPath()) != expected_path:
            raise ValueError("Overlay style material not bound.")
        shader = UsdShade.Shader(bound.GetPrim().GetStage().GetPrimAtPath(f"{expected_path}/Surface"))
        actual = shader.GetInput("opacity").Get()
        if actual is None or not math.isclose(float(actual), opacity, abs_tol=1e-6):
            raise ValueError("Overlay opacity readback mismatch.")
        values = UsdGeom.Gprim(target).GetDisplayOpacityPrimvar().Get()
        if not values or len(values) != 1 or not math.isclose(float(values[0]), opacity, abs_tol=1e-6):
            raise ValueError("Display opacity readback mismatch.")

    def apply(self, prim_path, display_opacity):
        path = parse_prim_path(prim_path)
        opacity = parse_display_opacity(display_opacity)
        stage = self._stage_provider()
        if stage is None:
            raise ValueError("No stage is open.")
        from pxr import Sdf, Usd, UsdGeom, UsdShade, Vt

        prim = stage.GetPrimAtPath(path)
        if not prim or not prim.IsValid():
            raise ValueError("Overlay prim not found.")
        targets = self._gprims(prim, Usd, UsdGeom)
        if not targets:
            raise ValueError("Overlay prim has no drawable geometry.")
        materials = []
        with Usd.EditContext(stage, Usd.EditTarget(stage.GetSessionLayer())):
            for target in targets:
                self._clear_override(stage, target, Sdf, UsdShade)
                if opacity < 1.0:
                    materials.append(self._bind_material(stage, target, opacity, Sdf, UsdGeom, UsdShade, Vt))
        for target in targets:
            self._readback(target, opacity, UsdGeom, UsdShade)
        return {"prim_path": path, "display_opacity": opacity, "prims": len(targets), "materials": materials}

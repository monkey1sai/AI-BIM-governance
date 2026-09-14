"""Persistent IFC surface appearance, independent of review session overlays."""

from __future__ import annotations

import hashlib
import math


# Display defaults only: these do not represent review results or physical data.
_DEFAULT_COLORS = {
    "IfcWall": (0.72, 0.68, 0.60),
    "IfcWallStandardCase": (0.72, 0.68, 0.60),
    "IfcSlab": (0.60, 0.62, 0.65),
    "IfcBeam": (0.48, 0.55, 0.64),
    "IfcColumn": (0.48, 0.55, 0.64),
    "IfcDoor": (0.55, 0.36, 0.20),
    "IfcWindow": (0.55, 0.72, 0.80),
}


def _unit(value, default):
    try:
        value = float(value)
        return value if math.isfinite(value) and 0 <= value <= 1 else default
    except (TypeError, ValueError):
        return default


class IfcSurfaceMaterials:
    """Reuse surface materials across meshes; preserve face-level assignments."""

    def __init__(self, stage):
        self.stage = stage
        self.materials = {}

    def _material(self, style, ifc_type):
        from pxr import Gf, Sdf, UsdShade

        color = _DEFAULT_COLORS.get(ifc_type, (0.65, 0.65, 0.65))
        opacity = 1.0
        source = "display_default"
        if style is not None:
            # Current IfcOpenShell exposes get_color(); older versions expose
            # diffuse as an RGB sequence. Keep valid black and zero opacity.
            raw = style.get_color() if hasattr(style, "get_color") else getattr(style, "diffuse", None)
            if raw is not None:
                try:
                    rgb = tuple(getattr(raw, c)() for c in "rgb") if hasattr(raw, "r") else tuple(raw)
                    if len(rgb) == 3:
                        parsed = tuple(_unit(v, None) for v in rgb)
                        if all(v is not None for v in parsed):
                            color, source = parsed, "ifc_geometry_style"
                except (TypeError, ValueError):
                    pass
            opacity = 1.0 - _unit(getattr(style, "transparency", None), 0.0)

        key = (color, opacity, source)
        if key not in self.materials:
            token = hashlib.sha256(repr(key).encode("ascii")).hexdigest()[:24]
            path = f"/World/Looks/IfcSurface_{token}"
            material = UsdShade.Material.Define(self.stage, path)
            material.GetPrim().SetCustomDataByKey("bim:appearance_source", source)
            shader = UsdShade.Shader.Define(self.stage, path + "/Shader")
            shader.CreateIdAttr("UsdPreviewSurface")
            shader.CreateInput("diffuseColor", Sdf.ValueTypeNames.Color3f).Set(Gf.Vec3f(*color))
            shader.CreateInput("opacity", Sdf.ValueTypeNames.Float).Set(opacity)
            shader.CreateInput("roughness", Sdf.ValueTypeNames.Float).Set(0.5)
            shader.CreateInput("metallic", Sdf.ValueTypeNames.Float).Set(0.0)
            material.CreateSurfaceOutput().ConnectToSource(shader.ConnectableAPI(), "surface")
            self.materials[key] = material
        return self.materials[key]

    def bind(self, mesh, geometry, ifc_type):
        from pxr import UsdGeom, UsdShade

        styles = tuple(getattr(geometry, "materials", ()) or ())
        ids = tuple(getattr(geometry, "material_ids", ()) or ())
        faces = tuple(getattr(geometry, "faces", ()) or ())
        vertex_count = len(mesh.GetPointsAttr().Get())
        groups = {}
        resolved = {}
        # The geometry authors discard malformed triangles. Carry the original
        # triangle index through that same filtering, avoiding shifted colors.
        face_index = 0
        for offset in range(0, len(faces), 3):
            try:
                triangle = tuple(int(faces[offset + i]) for i in range(3))
            except (IndexError, TypeError, ValueError):
                continue
            if not all(0 <= i < vertex_count for i in triangle):
                continue
            material_id = ids[offset // 3] if offset // 3 < len(ids) else -1
            if not isinstance(material_id, int) or not 0 <= material_id < len(styles):
                material_id = -1
            if material_id not in resolved:
                style = styles[material_id] if material_id >= 0 else None
                resolved[material_id] = self._material(style, ifc_type)
            material = resolved[material_id]
            groups.setdefault(str(material.GetPath()), (material, []))[1].append(face_index)
            face_index += 1

        binding = UsdShade.MaterialBindingAPI.Apply(mesh.GetPrim())
        binding.Bind(next(iter(groups.values()))[0] if len(groups) == 1 else self._material(None, ifc_type))
        if len(groups) > 1:
            for index, (material, indices) in enumerate(groups.values()):
                subset = binding.CreateMaterialBindSubset(f"Surface_{index}", indices, UsdGeom.Tokens.face)
                UsdShade.MaterialBindingAPI.Apply(subset.GetPrim()).Bind(material)
            binding.SetMaterialBindSubsetsFamilyType(UsdGeom.Tokens.partition)

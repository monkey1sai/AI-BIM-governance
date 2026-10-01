"""CFD flow glyphs are data, not physical shadow casters. Opinions stay in the session."""
import re

ROOT = "/World/Overlays/Cfd"
ATTRIBUTE = "primvars:doNotCastShadows"
FLOW_LAYERS = frozenset(("Streamlines", "StreamlineGrowth", "FlowParticles", "PedestrianWindVectors", "WindDirectionArrow"))


def _flow_path(path) -> bool:
    parts = str(path).removeprefix(ROOT + "/").split("/")
    return str(path).startswith(ROOT + "/") and len(parts) >= 2 and (parts[1] in FLOW_LAYERS
        or re.fullmatch(r"Section_[A-Za-z_][A-Za-z0-9_]*_Vectors", parts[1]) is not None)


def suppress_flow_shadows(stage) -> int:
    from pxr import Sdf, Usd, UsdGeom
    root = stage.GetPrimAtPath(ROOT)
    if not root:
        return 0
    count = 0
    with Usd.EditContext(stage, stage.GetSessionLayer()):
        for prim in Usd.PrimRange(root):
            if not _flow_path(prim.GetPath()) or not prim.IsA(UsdGeom.Gprim):
                continue
            prim.CreateAttribute(ATTRIBUTE, Sdf.ValueTypeNames.Bool, custom=True).Set(True)
            count += 1
    return count


def clear_flow_shadow_overrides(stage) -> int:
    from pxr import Sdf
    session = stage.GetSessionLayer()
    paths = []
    session.Traverse(Sdf.Path(ROOT), lambda path: paths.append(path)
                     if path.IsPropertyPath() and path.name == ATTRIBUTE and _flow_path(path.GetPrimPath()) else None)
    for path in paths:
        spec = session.GetAttributeAtPath(path)
        if spec:
            spec.owner.RemoveProperty(spec)
    return len(paths)

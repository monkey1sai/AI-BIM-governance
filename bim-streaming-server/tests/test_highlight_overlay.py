"""Real USD composition regressions isolated from other tests' pxr stubs."""
import subprocess
import sys

def test_nested_geometry_severity_and_replacement_rollback_observe_final_composition():
    run_usd(r'''
from pxr import Usd, UsdGeom, UsdShade, Gf, Sdf
from highlight_overlay import HighlightOverlay
s = Usd.Stage.CreateInMemory()
UsdGeom.Mesh.Define(s, "/Outer")
UsdGeom.Mesh.Define(s, "/Outer/Inner")
before = s.GetRootLayer().ExportToString()
other = Sdf.Layer.CreateAnonymous("other")
s.GetSessionLayer().subLayerPaths.append(other.identifier)
session_before = s.GetSessionLayer().ExportToString()
o = HighlightOverlay()
def color(path):
    mat = UsdShade.MaterialBindingAPI(s.GetPrimAtPath(path)).ComputeBoundMaterial()[0]
    return UsdShade.Shader(s.GetPrimAtPath(mat.GetPath().AppendChild("Shader"))).GetInput("diffuseColor").Get()
items = [{"prim_path":"/Outer", "severity":"low", "color":[0,0,1,1]},
         {"prim_path":"/Outer/Inner", "severity":"critical", "color":[1,0,0,1]}]
for rows in (items, list(reversed(items))):
    result = o.replace(s, rows)
    assert len(result["applied_paths"]) == 2 and not result["unsupported_paths"], result
    assert color("/Outer") == Gf.Vec3f(0,0,1)
    assert color("/Outer/Inner") == Gf.Vec3f(1,0,0)
o.replace(s, [items[0]])
o.replace(s, [items[1]])
assert color("/Outer/Inner") == Gf.Vec3f(1,0,0)
o.replace(s, [items[0]])
assert color("/Outer/Inner") == Gf.Vec3f(0,0,1)
saved = s.GetSessionLayer().ExportToString()
def failure(*args): raise RuntimeError("verification failure")
o._unbound_groups = failure
try: o.replace(s, [items[1]])
except RuntimeError: pass
else: raise AssertionError("missing rollback failure")
assert s.GetSessionLayer().ExportToString() == saved
assert color("/Outer/Inner") == Gf.Vec3f(0,0,1)
o.clear()
assert s.GetSessionLayer().ExportToString() == session_before
assert s.GetRootLayer().ExportToString() == before
''')


def test_prototype_and_stronger_session_binding_are_not_claimed_applied():
    run_usd(r'''
from pxr import Usd, UsdGeom, UsdShade
from highlight_overlay import HighlightOverlay
s = Usd.Stage.CreateInMemory()
UsdGeom.Cube.Define(s, "/Model/Shape")
instance = s.DefinePrim("/A")
instance.GetReferences().AddInternalReference("/Model")
instance.SetInstanceable(True)
prototype = instance.GetPrototype()
mat = UsdShade.Material.Define(s, "/Looks/Source")
with Usd.EditContext(s, s.GetSessionLayer()):
    UsdShade.MaterialBindingAPI.Apply(instance).Bind(mat, UsdShade.Tokens.strongerThanDescendants)
before = s.GetSessionLayer().ExportToString()
o = HighlightOverlay()
r = o.replace(s, [{"prim_path":str(prototype.GetPath())},
                  {"prim_path":str(prototype.GetPath())+"/Shape"}, {"prim_path":"/A"}])
assert not r["applied_paths"]
assert len(r["unsupported_paths"]) == 3
o.clear()
assert s.GetSessionLayer().ExportToString() == before
''')

from pathlib import Path

MODULE = Path(__file__).resolve().parents[1] / "source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging"


def run_usd(code):
    prefix = "import sys; sys.path.insert(0, " + repr(str(MODULE)) + ")\n"
    result = subprocess.run([sys.executable, "-c", prefix + code], capture_output=True, text=True, timeout=45)
    assert result.returncode == 0, result.stdout + result.stderr


def test_owned_overlay_colors_restore_and_reject_invalid_batches():
    code = r'''
from pxr import Usd, Sdf, UsdGeom, UsdShade, Gf
from highlight_overlay import HighlightOverlay
s = Usd.Stage.CreateInMemory()
for path in ["/World/A", "/World/B"]:
    UsdGeom.Cube.Define(s, path)
original = UsdShade.Material.Define(s, "/Looks/Original")
UsdShade.MaterialBindingAPI.Apply(s.GetPrimAtPath("/World/A")).Bind(original)
other = Sdf.Layer.CreateAnonymous("other")
s.GetSessionLayer().subLayerPaths.append(other.identifier)
root_before = s.GetRootLayer().ExportToString()
session_before = s.GetSessionLayer().ExportToString()
o = HighlightOverlay()
r = o.replace(s, [{"prim_path":"/World/A","color":[1,0,0,1]},
                  {"prim_path":"/World/B","color":[0,0.75,1]}])
assert r == {"applied_paths":["/World/A","/World/B"],"missing_paths":[],"unsupported_paths":[]}
def bound(path, purpose=""):
    return UsdShade.MaterialBindingAPI(s.GetPrimAtPath(path)).ComputeBoundMaterial(purpose)[0]
a = bound("/World/A")
b = bound("/World/B")
assert a and b and a.GetPath() != b.GetPath()
assert UsdShade.Shader(s.GetPrimAtPath(a.GetPath().AppendChild("Shader"))).GetInput("diffuseColor").Get() == Gf.Vec3f(1,0,0)
assert UsdShade.Shader(s.GetPrimAtPath(b.GetPath().AppendChild("Shader"))).GetInput("diffuseColor").Get() == Gf.Vec3f(0,0.75,1)
for bad in [
    [{"prim_path":"/World/A","color":[float("nan"),0,0,1]}],
    [{"prim_path":"/World/A","color":[2,0,0,1]}],
    [{"prim_path":"relative","color":[1,0,0,1]}],
    [{"prim_path":"/World/A","severity":False}],
]:
    before = s.GetSessionLayer().ExportToString()
    try: o.replace(s, bad)
    except ValueError: pass
    else: raise AssertionError("invalid batch accepted")
    assert s.GetSessionLayer().ExportToString() == before
    assert bound("/World/A").GetPath() == a.GetPath()
r = o.replace(s,[{"prim_path":"/World/B","color":[0,1,0,1]},{"prim_path":"/Absent"}])
assert r["missing_paths"] == ["/Absent"] and r["applied_paths"] == ["/World/B"]
assert bound("/World/A").GetPath() == original.GetPath()
assert s.GetRootLayer().ExportToString() == root_before
o.clear()
o.clear()
assert s.GetSessionLayer().ExportToString() == session_before
assert s.GetRootLayer().ExportToString() == root_before
assert bound("/World/A").GetPath() == original.GetPath()
assert not bound("/World/B")
o.replace(s,[{"prim_path":"/World/A"}])
o.replace(s,[])
assert s.GetSessionLayer().ExportToString() == session_before
s2 = Usd.Stage.CreateInMemory()
UsdGeom.Cube.Define(s2,"/New")
o.replace(s,[{"prim_path":"/World/A"}])
o.replace(s2,[{"prim_path":"/New"}])
assert s.GetSessionLayer().ExportToString() == session_before
o.clear()
assert list(s2.GetSessionLayer().subLayerPaths) == []
'''
    result = subprocess.run([sys.executable, "-c", "import sys; sys.path.insert(0, " + repr(str(MODULE)) + ")\n" + code], capture_output=True, text=True, timeout=45)
    assert result.returncode == 0, result.stdout + result.stderr


def test_binding_purposes_subset_collection_and_failed_candidate_rollback():
    run_usd(r'''
from pxr import Usd, Sdf, UsdGeom, UsdShade
from highlight_overlay import HighlightOverlay
s = Usd.Stage.CreateInMemory()
mesh = UsdGeom.Mesh.Define(s, "/World/Mesh")
subset = UsdGeom.Subset.Define(s, "/World/Mesh/Faces")
original = UsdShade.Material.Define(s, "/Looks/Source")
for prim in [mesh.GetPrim(), subset.GetPrim()]:
    api = UsdShade.MaterialBindingAPI.Apply(prim)
    for purpose in ("", "full", "preview"):
        api.Bind(original, UsdShade.Tokens.weakerThanDescendants, purpose)
collection = Usd.CollectionAPI.Apply(mesh.GetPrim(), "all")
collection.CreateIncludesRel().SetTargets([mesh.GetPath()])
UsdShade.MaterialBindingAPI.Apply(mesh.GetPrim()).Bind(collection, original, "collection")
before = s.GetRootLayer().ExportToString()
o = HighlightOverlay()
r = o.replace(s, [{"prim_path":"/World/Mesh", "color":[1,0,0,1]}])
assert r["applied_paths"] == ["/World/Mesh"], r
for path in ("/World/Mesh", "/World/Mesh/Faces"):
    for purpose in ("", "full", "preview"):
        actual = UsdShade.MaterialBindingAPI(s.GetPrimAtPath(path)).ComputeBoundMaterial(purpose)[0]
        assert actual.GetPath() != original.GetPath()
snapshot = s.GetSessionLayer().ExportToString()
def fail(*args): raise RuntimeError("injected observation failure")
o._unbound_groups = fail
try: o.replace(s, [{"prim_path":"/World/Mesh", "color":[0,1,0,1]}])
except RuntimeError: pass
else: raise AssertionError("exception swallowed")
assert s.GetSessionLayer().ExportToString() == snapshot
assert s.GetRootLayer().ExportToString() == before
o.clear()
assert s.GetRootLayer().ExportToString() == before
''')


def test_overlapping_same_color_groups_both_observed_and_limits_preserve_effect():
    run_usd(r'''
from pxr import Usd, UsdGeom
from highlight_overlay import HighlightOverlay
s = Usd.Stage.CreateInMemory()
UsdGeom.Cube.Define(s, "/World/Group/A")
o = HighlightOverlay()
r = o.replace(s, [{"prim_path":"/World/Group"}, {"prim_path":"/World/Group/A"}])
assert r["applied_paths"] == ["/World/Group", "/World/Group/A"], r
before = s.GetSessionLayer().ExportToString()
try: o.replace(s, [{"prim_path":"/World/Group/A"}] * 4097)
except ValueError: pass
else: raise AssertionError("unbounded request accepted")
assert s.GetSessionLayer().ExportToString() == before
o.clear()
''')


def test_instance_supported_but_stronger_ancestor_not_claimed_applied():
    run_usd(r'''
from pxr import Usd, UsdGeom, UsdShade
from highlight_overlay import HighlightOverlay
s = Usd.Stage.CreateInMemory()
UsdGeom.Cube.Define(s, "/World/A")
mat = UsdShade.Material.Define(s, "/Looks/Strong")
UsdShade.MaterialBindingAPI.Apply(s.GetPrimAtPath("/World")).Bind(mat, UsdShade.Tokens.strongerThanDescendants)
model = s.DefinePrim("/Model", "Xform")
UsdGeom.Cube.Define(s, "/Model/Shape")
instance = s.DefinePrim("/Instance")
instance.GetReferences().AddInternalReference("/Model")
instance.SetInstanceable(True)
before = s.GetRootLayer().ExportToString()
o = HighlightOverlay()
r = o.replace(s, [{"prim_path":"/World/A"}, {"prim_path":"/Instance"}, {"prim_path":"/Absent"}])
assert r["applied_paths"] == ["/Instance"], r
assert set(r["unsupported_paths"]) == {"/World/A"}, r
assert r["missing_paths"] == ["/Absent"]
assert s.GetRootLayer().ExportToString() == before
o.clear()
    ''')


def test_instance_colors_preserve_prototypes_siblings_and_exact_restore():
    run_usd(r'''
from pxr import Usd, UsdGeom, UsdShade
from highlight_overlay import HighlightOverlay
s = Usd.Stage.CreateInMemory()
UsdGeom.Cube.Define(s, "/Model/Shape")
for name in ("A", "B", "C"):
    root = s.DefinePrim("/"+name)
    root.GetReferences().AddInternalReference("/Model")
    root.SetInstanceable(True)
before = s.GetRootLayer().ExportToString()
session = s.GetSessionLayer().ExportToString()
def bound(path):
    return UsdShade.MaterialBindingAPI(s.GetPrimAtPath(path)).ComputeBoundMaterial()[0]
o = HighlightOverlay()
for colors in ([1,0,0,1], [0,1,0,1]):
    r = o.replace(s, [{"prim_path":"/A","color":colors}, {"prim_path":"/B","color":[0,0,1,1]}])
    assert r["applied_paths"] == ["/A", "/B"], r
    assert bound("/A/Shape") and bound("/B/Shape")
    assert bound("/A/Shape").GetPath() != bound("/B/Shape").GetPath()
    assert not bound("/C/Shape") and not bound("/Model/Shape")
    assert s.GetPrimAtPath("/A").IsInstance()
    assert s.GetPrimAtPath("/A/Shape").IsInstanceProxy()
    assert s.GetRootLayer().ExportToString() == before
snapshot = s.GetSessionLayer().ExportToString()
def fail(*args):
    raise RuntimeError("injected instance binding failure")
verify = o._unbound_groups
o._unbound_groups = fail
try:
    o.replace(s, [{"prim_path":"/B","color":[1,1,0,1]}])
except RuntimeError:
    pass
else:
    raise AssertionError("failure swallowed")
assert s.GetSessionLayer().ExportToString() == snapshot
o._unbound_groups = verify
o.clear()
assert s.GetSessionLayer().ExportToString() == session
assert not bound("/A/Shape")
assert s.GetRootLayer().ExportToString() == before
UsdGeom.PointInstancer.Define(s, "/Particles")
r = o.replace(s, [{"prim_path":"/A/Shape"}, {"prim_path":"/Particles"}])
assert r["applied_paths"] == []
assert set(r["unsupported_paths"]) == {"/A/Shape", "/Particles"}
o.clear()
''')


def test_highest_severity_wins_shared_geometry_regardless_of_order_and_filter_downgrades():
    run_usd(r'''
from pxr import Usd, UsdGeom, UsdShade, Gf
from highlight_overlay import HighlightOverlay
s = Usd.Stage.CreateInMemory()
UsdGeom.Cube.Define(s, "/World/Group/A")
items = [{"prim_path":"/World", "color":[0,0,1,1], "severity":"info"},
         {"prim_path":"/World/Group", "color":[1,0,0,1], "severity":"critical"},
         {"prim_path":"/World/Group/A", "color":[0,1,0,1], "severity":"warning"}]
o = HighlightOverlay()
for rows in (items, list(reversed(items))):
    r = o.replace(s, rows)
    assert set(r["applied_paths"]) == {"/World", "/World/Group", "/World/Group/A"}, r
    assert r["unsupported_paths"] == [], r
    material = UsdShade.MaterialBindingAPI(s.GetPrimAtPath("/World/Group/A")).ComputeBoundMaterial()[0]
    assert UsdShade.Shader(s.GetPrimAtPath(material.GetPath().AppendChild("Shader"))).GetInput("diffuseColor").Get() == Gf.Vec3f(1,0,0)
o.replace(s, [items[0], items[2]])
material = UsdShade.MaterialBindingAPI(s.GetPrimAtPath("/World/Group/A")).ComputeBoundMaterial()[0]
assert UsdShade.Shader(s.GetPrimAtPath(material.GetPath().AppendChild("Shader"))).GetInput("diffuseColor").Get() == Gf.Vec3f(0,1,0)
o.clear()
''')


def test_unique_render_target_boundary_preserves_previous_overlay():
    run_usd(r'''
from pxr import Usd, UsdGeom, Sdf
from highlight_overlay import HighlightOverlay
s = Usd.Stage.CreateInMemory()
UsdGeom.Cube.Define(s, "/Previous")
o = HighlightOverlay()
r = o.replace(s, [{"prim_path":"/Previous"}, {"prim_path":"/Previous"}])
assert r["applied_paths"] == ["/Previous"], r
before = s.GetSessionLayer().ExportToString()
UsdGeom.Xform.Define(s, "/Group")
with Sdf.ChangeBlock():
    for i in range(10000):
        prim = Sdf.CreatePrimInLayer(s.GetRootLayer(), "/Group/M" + str(i))
        prim.specifier = Sdf.SpecifierDef
        prim.typeName = "Cube"
    for i in range(10001):
        prim = Sdf.CreatePrimInLayer(s.GetRootLayer(), "/Group/Organization" + str(i))
        prim.specifier = Sdf.SpecifierDef
        prim.typeName = "Xform"
groups, missing, unsupported = o._targets(s, {"/Group":(1,0,0,1), "/Group/M0":(1,0,0,1)})
assert len(groups["/Group"][1]) == 10000 and not missing and not unsupported
UsdGeom.Cube.Define(s, "/Group/Overflow")
try: o.replace(s, [{"prim_path":"/Group"}])
except ValueError: pass
else: raise AssertionError("render target limit not enforced")
assert s.GetSessionLayer().ExportToString() == before
o.clear()
''')


def test_overlapping_groups_work_budget_rejects_before_authoring():
    run_usd(r'''
from pxr import Usd, UsdGeom, Sdf
from highlight_overlay import HighlightOverlay
s = Usd.Stage.CreateInMemory()
UsdGeom.Cube.Define(s, "/Previous")
o = HighlightOverlay()
o.replace(s, [{"prim_path":"/Previous"}])
before = s.GetSessionLayer().ExportToString()
paths = ["/Root" + "/Group" * i for i in range(101)]
with Sdf.ChangeBlock():
    for path in paths:
        prim = Sdf.CreatePrimInLayer(s.GetRootLayer(), path)
        prim.specifier = Sdf.SpecifierDef
        prim.typeName = "Xform"
    for i in range(1001):
        prim = Sdf.CreatePrimInLayer(s.GetRootLayer(), paths[-1] + "/Cube" + str(i))
        prim.specifier = Sdf.SpecifierDef
        prim.typeName = "Cube"
def no_authoring(*args): raise AssertionError("work budget must reject before authoring")
o._build_layer = no_authoring
try: o.replace(s, [{"prim_path":path} for path in paths])
except ValueError as error: assert "work limit" in str(error)
else: raise AssertionError("overlap work budget not enforced")
assert s.GetSessionLayer().ExportToString() == before
o.clear()
''')

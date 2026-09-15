"""Real USD focus/context composition, independent of Kit stubs."""
from test_highlight_overlay import run_usd


def test_focus_context_is_translucent_and_restores_existing_issue_materials():
    run_usd(r'''
from pxr import Usd, UsdGeom, UsdShade, Sdf, Gf
from focus_overlay import FocusOverlay
from highlight_overlay import HighlightOverlay
s = Usd.Stage.CreateInMemory()
UsdGeom.Cube.Define(s, '/World/Elements/Door/Body')
UsdGeom.Cube.Define(s, '/World/Elements/Wall/Body')
root = s.GetRootLayer().ExportToString()
issue = HighlightOverlay()
issue.replace(s, [{'prim_path':'/World/Elements/Wall', 'color':[1,0,0,1]}])
before = s.GetSessionLayer().ExportToString()
def shader(path):
    m = UsdShade.MaterialBindingAPI(s.GetPrimAtPath(path)).ComputeBoundMaterial()[0]
    return UsdShade.Shader(s.GetPrimAtPath(m.GetPath().AppendChild('Shader')))
o = FocusOverlay()
r = o.replace(s, '/World/Elements/Door')
assert r['focus_emphasis'] is True and r['context_opacity'] == 0.25
assert shader('/World/Elements/Door/Body').GetInput('opacity').Get() == 1
assert abs(shader('/World/Elements/Wall/Body').GetInput('opacity').Get() - .25) < 1e-6
assert shader('/World/Elements/Wall/Body').GetInput('ior').Get() == 1
assert shader('/World/Elements/Wall/Body').GetInput('diffuseColor').Get() == Gf.Vec3f(.04, .12, .22)
assert shader('/World/Elements/Wall/Body').GetInput('roughness').Get() == 0
assert shader('/World/Elements/Wall/Body').GetInput('emissiveColor').Get() == Gf.Vec3f(0)
mat = UsdShade.MaterialBindingAPI(s.GetPrimAtPath('/World/Elements/Wall/Body')).ComputeBoundMaterial()[0]
mdl = UsdShade.Shader(s.GetPrimAtPath(mat.GetPath().AppendChild('ContextMDL')))
assert mdl.GetSourceAsset('mdl').path == 'OmniPBR.mdl'
assert mdl.GetSourceAssetSubIdentifier('mdl') == 'OmniPBR'
assert mdl.GetInput('enable_opacity').Get() is True
assert mdl.GetInput('opacity_constant').Get() == .25
assert mdl.GetInput('opacity_threshold').Get() == 0
assert mat.GetSurfaceOutput('mdl').HasConnectedSource()
assert o.active
o.clear()
assert not o.active
assert shader('/World/Elements/Wall/Body').GetInput('diffuseColor').Get() == Gf.Vec3f(1,0,0)
assert s.GetSessionLayer().ExportToString() == before
assert s.GetRootLayer().ExportToString() == root
''')


def test_invalid_or_unsupported_target_keeps_previous_focus():
    run_usd(r'''
from pxr import Usd, UsdGeom
from focus_overlay import FocusOverlay
s = Usd.Stage.CreateInMemory()
UsdGeom.Cube.Define(s, '/World/Elements/Door/Body')
s.DefinePrim('/World/Empty')
o = FocusOverlay(); o.replace(s, '/World/Elements/Door')
before = s.GetSessionLayer().ExportToString()
for bad in ('/World/Empty', '/Missing', '/World', '/', '/World/Elements'):
    try: o.replace(s, bad)
    except ValueError: pass
    else: raise AssertionError(bad)
    assert s.GetSessionLayer().ExportToString() == before
o.clear()
''')


def test_switching_focus_and_pulse_never_mutate_original_layers():
    run_usd(r'''
import asyncio
from pxr import Usd, UsdGeom, UsdShade
from focus_overlay import FocusOverlay
async def check():
    s = Usd.Stage.CreateInMemory()
    for name in ('A','B'): UsdGeom.Cube.Define(s, '/World/Elements/'+name+'/Body')
    original = s.GetRootLayer().ExportToString()
    o = FocusOverlay(); o.replace(s, '/World/Elements/A')
    o.start_pulse(); task = o._pulse_task
    await asyncio.sleep(0)
    o.replace(s, '/World/Elements/B')
    await asyncio.sleep(0)
    assert task.done()
    assert len(s.GetSessionLayer().subLayerPaths) == 1
    o.start_pulse(); task = o._pulse_task
    o.clear(); await asyncio.sleep(0)
    assert task.done() and not s.GetSessionLayer().subLayerPaths
    assert s.GetRootLayer().ExportToString() == original
asyncio.run(check())
''')


def test_focus_preserves_face_subset_and_rolls_back_blocked_bindings():
    run_usd(r'''
from pxr import Usd, UsdGeom, UsdShade
from focus_overlay import FocusOverlay
s = Usd.Stage.CreateInMemory()
mesh = UsdGeom.Mesh.Define(s, '/World/Elements/Door/Body')
subset = UsdGeom.Subset.Define(s, '/World/Elements/Door/Body/Faces')
subset.CreateFamilyNameAttr('materialBind')
UsdGeom.Cube.Define(s, '/World/Elements/Wall/Body')
o = FocusOverlay(); o.replace(s, '/World/Elements/Door')
binding = UsdShade.MaterialBindingAPI(subset.GetPrim()).ComputeBoundMaterial()[0]
assert binding
o.clear()
with Usd.EditContext(s, s.GetSessionLayer()):
    m = UsdShade.Material.Define(s, '/Looks/Locked')
    UsdShade.MaterialBindingAPI.Apply(mesh.GetPrim()).Bind(m)
before = s.GetSessionLayer().ExportToString()
try: o.replace(s, '/World/Elements/Door')
except ValueError: pass
else: raise AssertionError('overridden material was claimed applied')
assert s.GetSessionLayer().ExportToString() == before and not o.active
''')


def test_fractional_opacity_is_owned_restored_and_fail_closed():
    run_usd(r'''
from pxr import Usd, UsdGeom
from focus_overlay import FocusOverlay
s = Usd.Stage.CreateInMemory()
for name in ('A', 'B'): UsdGeom.Cube.Define(s, '/World/Elements/'+name+'/Body')
key = '/rtx/raytracing/fractionalCutoutOpacity'
class Settings:
    def __init__(self, initial=False):
        self.values = {'/rtx/rendermode':'RaytracedLighting', key:initial}
        self.reject = False
    def get(self, k): return self.values.get(k)
    def set_bool(self, k, v):
        if not self.reject: self.values[k] = v
settings = Settings()
o = FocusOverlay(settings)
o.replace(s, '/World/Elements/A')
assert settings.get(key) is True
o.replace(s, '/World/Elements/B')
o.clear()
assert settings.get(key) is False and not s.GetSessionLayer().subLayerPaths
settings.values[key] = True
o.replace(s, '/World/Elements/A'); o.clear()
assert settings.get(key) is True
settings.values[key] = False; settings.reject = True
try: o.replace(s, '/World/Elements/A')
except ValueError: pass
else: raise AssertionError('unconfirmed setting accepted')
assert not o.active and not s.GetSessionLayer().subLayerPaths
settings.reject = False
o.replace(s, '/World/Elements/A')
settings.values[key] = False
try: o.replace(s, '/World/Elements/B')
except ValueError: pass
else: raise AssertionError('external setting change overwritten')
o.clear()
assert settings.get(key) is False
''')

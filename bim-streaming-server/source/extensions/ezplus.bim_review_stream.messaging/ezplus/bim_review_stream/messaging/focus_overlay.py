"""Temporary focus/context material layer; never changes source or visibility."""
try:
    from .highlight_overlay import HighlightOverlay
except ImportError:
    from highlight_overlay import HighlightOverlay


class FocusOverlay(HighlightOverlay):
    CONTEXT_OPACITY = 0.25
    TARGET_COLOR = (1.0, 0.55, 0.06, 1.0)

    def __init__(self, settings=None):
        super().__init__()
        self._settings = settings
        self._fractional_original = None

    @property
    def active(self):
        return bool(self._owner and self._layer)

    def clear(self):
        super().clear()
        self._restore_fractional()

    def _restore_fractional(self):
        if self._fractional_original is None:
            return
        key, original = self._fractional_original
        # Do not overwrite a setting another controller changed after us.
        if self._settings.get(key) is True:
            self._settings.set_bool(key, original)
            if self._settings.get(key) is not original:
                raise ValueError('Focus transparency restore unconfirmed.')
        self._fractional_original = None

    def _enable_fractional(self):
        if self._settings is None:  # Offline USD composition tests have no Kit.
            return
        mode = self._settings.get('/rtx/rendermode')
        if mode not in ('RaytracedLighting', 'PathTracing', 'RealTimePathTracing'):
            raise ValueError('Focus renderer unavailable.')
        key = ('/rtx/raytracing/fractionalCutoutOpacity' if mode == 'RaytracedLighting'
               else '/rtx/pathtracing/fractionalCutoutOpacity')
        current = self._settings.get(key)
        if type(current) is not bool:
            raise ValueError('Focus fractional opacity unavailable.')
        if self._fractional_original is not None:
            if self._fractional_original[0] != key or current is not True:
                raise ValueError('Focus transparency settings changed externally.')
            return
        self._fractional_original = (key, current)
        try:
            self._settings.set_bool(key, True)
            if self._settings.get(key) is not True:
                raise ValueError('Focus fractional opacity unconfirmed.')
        except Exception:
            self._restore_fractional()
            raise

    @staticmethod
    def _build_layer(stage, groups):
        from pxr import Usd, UsdShade, Sdf, Gf
        layer, materials = HighlightOverlay._build_layer(stage, groups)
        scratch = Usd.Stage.Open(layer)
        for _path, (rgba, targets) in groups.items():
            if rgba[3] >= 1:
                continue
            # RTX treats PreviewSurface opacity as transmission. Rough glass
            # refracts/blurs away the subject; context needs no refraction,
            # reflection or emission, not the luminous issue-mark material.
            for material_path in {materials[target] for target in targets}:
                shader = UsdShade.Shader(scratch.GetPrimAtPath(material_path + '/Shader'))
                shader.CreateInput('ior', Sdf.ValueTypeNames.Float).Set(1.0)
                shader.GetInput('roughness').Set(0.0)
                shader.GetInput('emissiveColor').Set(Gf.Vec3f(0))
                # RTX context uses coverage/alpha, not glass transmission.
                # OmniPBR is bundled with Kit; the portable Preview fallback remains.
                material = UsdShade.Material(scratch.GetPrimAtPath(material_path))
                mdl = UsdShade.Shader.Define(scratch, material_path + '/ContextMDL')
                mdl.SetSourceAsset(Sdf.AssetPath('OmniPBR.mdl'), 'mdl')
                mdl.SetSourceAssetSubIdentifier('OmniPBR', 'mdl')
                mdl.CreateInput('diffuse_color_constant', Sdf.ValueTypeNames.Color3f).Set(Gf.Vec3f(*rgba[:3]))
                mdl.CreateInput('reflection_roughness_constant', Sdf.ValueTypeNames.Float).Set(1.0)
                mdl.CreateInput('specular_level', Sdf.ValueTypeNames.Float).Set(0.0)
                mdl.CreateInput('enable_opacity', Sdf.ValueTypeNames.Bool).Set(True)
                mdl.CreateInput('opacity_constant', Sdf.ValueTypeNames.Float).Set(rgba[3])
                mdl.CreateInput('opacity_threshold', Sdf.ValueTypeNames.Float).Set(0.0)
                mdl.CreateOutput('out', Sdf.ValueTypeNames.Token)
                material.CreateSurfaceOutput('mdl').ConnectToSource(mdl.ConnectableAPI(), 'out')
        return layer, materials

    def replace(self, stage, prim_path):
        from pxr import Sdf
        path = Sdf.Path(prim_path)
        # A component, not a stage/category container. Other clients retain
        # ordinary framing by omitting focus emphasis.
        root = Sdf.Path('/World/Elements')
        if not path.HasPrefix(root) or path == root:
            raise ValueError('Focus emphasis requires an IFC component.')
        requested = self._validated([{'prim_path': prim_path, 'color': self.TARGET_COLOR}])
        target, missing, unsupported = self._targets(stage, requested)
        if missing or unsupported:
            raise ValueError('Focus component geometry unavailable.')
        context, missing, unsupported = self._targets(stage, {'/World': (0.04, 0.12, 0.22, self.CONTEXT_OPACITY)})
        if missing or unsupported:
            raise ValueError('Focus context geometry unavailable.')
        selected = set(target[prim_path][1])
        rgba, background = context['/World']
        groups = {**target, '/World': (rgba, [p for p in background if p not in selected])}
        owner = stage.GetSessionLayer()
        previous = self._layer
        previous_index = (list(owner.subLayerPaths).index(previous.identifier)
                          if previous and self._owner == owner and previous.identifier in owner.subLayerPaths else None)
        candidate = None
        had_fractional = self._fractional_original is not None
        try:
            if previous_index is not None:
                owner.subLayerPaths.remove(previous.identifier)
            candidate, materials = self._build_layer(stage, groups)
            owner.subLayerPaths.insert(0, candidate.identifier)
            if self._unbound_groups(stage, groups, materials):
                raise ValueError('Focus material binding unavailable.')
            self._enable_fractional()
            super().clear()
            self._owner, self._layer = owner, candidate
        except Exception:
            if candidate and candidate.identifier in owner.subLayerPaths:
                owner.subLayerPaths.remove(candidate.identifier)
            if previous_index is not None and previous.identifier not in owner.subLayerPaths:
                owner.subLayerPaths.insert(previous_index, previous.identifier)
            if not had_fractional:
                self._restore_fractional()
            raise
        return {'focus_emphasis': True, 'context_opacity': self.CONTEXT_OPACITY}

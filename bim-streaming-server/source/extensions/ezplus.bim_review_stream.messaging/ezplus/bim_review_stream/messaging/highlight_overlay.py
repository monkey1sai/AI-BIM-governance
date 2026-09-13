"""Reversible review materials owned by one runtime, never saved to source USD."""
import math
import uuid


class HighlightOverlay:
    def __init__(self):
        self._owner = None
        self._layer = None

    def clear(self):
        if self._owner is not None and self._layer is not None:
            identifier = self._layer.identifier
            paths = list(self._owner.subLayerPaths)
            self._owner.subLayerPaths = [path for path in paths if path != identifier]
        self._layer = None
        self._owner = None

    @staticmethod
    def _validated(items):
        from pxr import Sdf
        if not isinstance(items, list) or len(items) > 4096:
            raise ValueError("Invalid highlight items.")
        unique = {}
        for item in items:
            if not isinstance(item, dict):
                raise ValueError("Invalid highlight item.")
            path = item.get("prim_path") or item.get("usd_prim_path")
            if not isinstance(path, str) or not path.startswith("/") or len(path) > 4096:
                raise ValueError("Invalid highlight path.")
            parsed = Sdf.Path(path)
            if not parsed.IsAbsolutePath() or not parsed.IsPrimPath() or path == "/":
                raise ValueError("Invalid highlight path.")
            rgba = item.get("color", [1, 0, 0, 1])
            if not isinstance(rgba, (list, tuple)) or len(rgba) not in (3, 4):
                raise ValueError("Invalid highlight color.")
            if any(isinstance(v, bool) or not isinstance(v, (int, float))
                   or not math.isfinite(v) or not 0 <= v <= 1 for v in rgba):
                raise ValueError("Invalid highlight color.")
            color = tuple(float(v) for v in rgba) + ((1.0,) if len(rgba) == 3 else ())
            severity = item.get("severity", "info")
            if not isinstance(severity, str):
                raise ValueError("Invalid highlight severity.")
            rank = {"critical": 5, "high": 4, "error": 3, "medium": 2,
                    "warning": 2, "low": 1, "info": 0}.get(severity.lower(), 0)
            # Stable ties and descending severity make both duplicate paths and
            # overlapping geometry independent of request/authoring order.
            priority = (-rank, path, color)
            if path not in unique or priority < unique[path][0]:
                unique[path] = (priority, color)
        return {path: value[1] for path, value in sorted(unique.items(), key=lambda pair: pair[1][0])}

    @staticmethod
    def _targets(stage, requested):
        from pxr import Usd, UsdGeom
        groups, missing, unsupported = {}, [], []
        render_targets = set()
        work = 0
        for path, color in requested.items():
            root = stage.GetPrimAtPath(path)
            if not root:
                missing.append(path)
                continue
            if (not root.IsActive() or root.IsInstanceProxy()
                    or root.IsPrototype() or root.IsInPrototype()):
                unsupported.append(path)
                continue
            targets = []
            rejected = False
            for prim in Usd.PrimRange(root, Usd.TraverseInstanceProxies()):
                work += 1
                if work > 100000:
                    raise ValueError("Highlight work limit exceeded.")
                if prim.IsA(UsdGeom.PointInstancer):
                    rejected = True
                    break
                if prim.IsA(UsdGeom.Gprim):
                    material_targets = [str(prim.GetPath())]
                    material_targets.extend(str(subset.GetPath()) for subset in prim.GetChildren()
                                            if subset.IsA(UsdGeom.Subset))
                    work += len(material_targets)
                    if work > 100000:
                        raise ValueError("Highlight work limit exceeded.")
                    if prim.IsInstanceProxy():
                        # Author only at the unique instance root, never its
                        # shared prototype or read-only proxy descendants.
                        binding_root = prim
                        while binding_root.IsInstanceProxy():
                            binding_root = binding_root.GetParent()
                        target = str(binding_root.GetPath())
                        if target not in targets:
                            targets.append(target)
                    else:
                        targets.extend(material_targets)
                    render_targets.update(material_targets)
                    if len(render_targets) > 10000:
                        raise ValueError("Highlight target limit exceeded.")
            if rejected or not targets:
                unsupported.append(path)
            else:
                groups[path] = (color, targets)
        return groups, missing, unsupported

    @staticmethod
    def _build_layer(stage, groups):
        from pxr import Sdf, Usd, UsdShade, Gf
        layer = Sdf.Layer.CreateAnonymous("bim-review-highlight")
        scratch = Usd.Stage.Open(layer)
        namespace = "/BimReviewHighlight_" + uuid.uuid4().hex
        if stage.GetPrimAtPath(namespace):
            raise ValueError("Highlight namespace unavailable.")
        material_paths = {}
        palette = {}
        for index, (requested, (rgba, targets)) in enumerate(groups.items()):
            path = palette.setdefault(rgba, namespace + "/Color" + str(index))
            material = UsdShade.Material.Define(scratch, path)
            shader = UsdShade.Shader.Define(scratch, path + "/Shader")
            shader.CreateIdAttr("UsdPreviewSurface")
            shader.CreateInput("diffuseColor", Sdf.ValueTypeNames.Color3f).Set(Gf.Vec3f(*rgba[:3]))
            shader.CreateInput("opacity", Sdf.ValueTypeNames.Float).Set(rgba[3])
            shader.CreateInput("roughness", Sdf.ValueTypeNames.Float).Set(0.5)
            material.CreateSurfaceOutput().ConnectToSource(shader.ConnectableAPI(), "surface")
            for target in targets:
                if target in material_paths:
                    continue
                material_paths[target] = path
                prim = scratch.OverridePrim(target)
                # Collection bindings otherwise outrank direct binding at the same
                # prim. Block only their targets in our disposable layer.
                for relationship in stage.GetPrimAtPath(target).GetRelationships():
                    if relationship.GetName().startswith("material:binding:collection:"):
                        prim.CreateRelationship(relationship.GetName()).SetTargets([])
                binding = UsdShade.MaterialBindingAPI.Apply(prim)
                for purpose in ("", "full", "preview"):
                    strength = (UsdShade.Tokens.strongerThanDescendants if stage.GetPrimAtPath(target).IsInstance()
                                else UsdShade.Tokens.weakerThanDescendants)
                    binding.Bind(material, strength, purpose)
        return layer, material_paths

    @staticmethod
    def _unbound_groups(stage, groups, materials):
        from pxr import Usd, UsdGeom, UsdShade
        failed = []
        work = 0
        for requested, (_color, targets) in groups.items():
            for target in targets:
                root = stage.GetPrimAtPath(target)
                probes = Usd.PrimRange(root, Usd.TraverseInstanceProxies()) if root.IsInstance() else [root]
                mismatch = False
                for prim in probes:
                    work += 1
                    if work > 100000:
                        raise ValueError("Highlight verification work limit exceeded.")
                    if root.IsInstance() and not (prim.IsA(UsdGeom.Gprim) or prim.IsA(UsdGeom.Subset)):
                        continue
                    binding = UsdShade.MaterialBindingAPI(prim)
                    if any(str(binding.ComputeBoundMaterial(purpose)[0].GetPath()) != materials[target]
                           for purpose in ("", "full", "preview")):
                        mismatch = True
                        break
                if mismatch:
                    failed.append(requested)
                    break
        return failed

    def replace(self, stage, items):
        requested = self._validated(items)
        if not stage or not stage.GetSessionLayer():
            raise ValueError("No stage session layer.")
        if not requested:
            self.clear()
            return {"applied_paths": [], "missing_paths": [], "unsupported_paths": []}
        groups, missing, unsupported = self._targets(stage, requested)
        owner = stage.GetSessionLayer()
        candidate = None
        previous = self._layer
        previous_index = (list(owner.subLayerPaths).index(previous.identifier)
                          if previous is not None and self._owner == owner
                          and previous.identifier in owner.subLayerPaths else None)
        try:
            # Observe the final replacement composition. The old overlay must not
            # defeat a candidate at a descendant, but remains owned for rollback.
            if previous_index is not None:
                owner.subLayerPaths.remove(previous.identifier)
            # Validate the composed winner, not merely a successful USD write.
            for attempt in range(2):
                candidate, materials = self._build_layer(stage, groups)
                owner.subLayerPaths.insert(0, candidate.identifier)
                failed = self._unbound_groups(stage, groups, materials)
                if not failed:
                    break
                owner.subLayerPaths.remove(candidate.identifier)
                candidate = None
                if attempt:
                    raise ValueError("Highlight material binding unavailable.")
                for path in failed:
                    unsupported.append(path)
                    del groups[path]
            self.clear()
            self._owner, self._layer = owner, candidate
        except Exception:
            if candidate is not None and candidate.identifier in owner.subLayerPaths:
                owner.subLayerPaths.remove(candidate.identifier)
            if previous_index is not None and previous.identifier not in owner.subLayerPaths:
                owner.subLayerPaths.insert(previous_index, previous.identifier)
            raise
        return {"applied_paths": list(groups), "missing_paths": missing,
                "unsupported_paths": unsupported}

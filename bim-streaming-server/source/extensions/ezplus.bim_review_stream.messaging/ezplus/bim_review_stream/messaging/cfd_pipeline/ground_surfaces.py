"""Read explicitly selected authored USD triangles without guessing walkable ground.

This source primitive supplies selection previews, never CFD run submission or sampling.
Source identity covers a private snapshot of a self-contained, static Z-up file.
"""

from __future__ import annotations

from contextlib import contextmanager
from dataclasses import asdict, dataclass
import hashlib
import math
from pathlib import Path
import re
import struct
from tempfile import TemporaryDirectory
from typing import Sequence

import numpy as np

from .usd_geometry import matrix_to_numpy, transform_points


@dataclass(frozen=True)
class GroundFaceSelection:
    ifc_guid: str
    mesh_prim_path: str
    polygon_face_index: int


@dataclass(frozen=True)
class GroundSurfaceFace:
    model_usdc_sha256: str
    ifc_guid: str
    ifc_type: str
    mesh_prim_path: str
    polygon_face_index: int
    point_indices: tuple[int, int, int]
    vertices_m: tuple[tuple[float, float, float], ...]
    normal: tuple[float, float, float]
    area_m2: float
    geometry_sha256: str
    face_id: str
    subdivision_scheme: str
    geometry_representation: str = "authored_triangle"
    actual_ground_verified: bool = False


def _canonical_float(value: float) -> float:
    return 0.0 if value == 0.0 else float(value)


def _face_identity(source_sha, selection, vertices_m, normal):
    """One versioned identity algorithm for fresh reads and downstream checks."""
    geometry_sha = hashlib.sha256(b"cfd-ground-authored-triangle/v1\0" +
        struct.pack(">12d", *[_canonical_float(v) for p in vertices_m for v in p],
                    *[_canonical_float(v) for v in normal])).hexdigest()
    face_id = hashlib.sha256(
        f"cfd-ground-face/v1\0{source_sha}\0{selection.ifc_guid}\0{selection.mesh_prim_path}\0{selection.polygon_face_index}\0{geometry_sha}".encode("utf-8")
    ).hexdigest()
    return geometry_sha, face_id


def _reject_composition(layer) -> None:
    from pxr import Sdf

    unsupported = bool(layer.subLayerPaths)
    def visit(path):
        nonlocal unsupported
        prim = layer.GetPrimAtPath(path)
        if prim and any(prim.HasInfo(key) for key in ("references", "payload", "clips")):
            unsupported = True
    layer.Traverse(Sdf.Path.absoluteRootPath, visit)
    if unsupported:
        raise ValueError("unsupported_composition")


def _snapshot(path: Path, expected_sha256: str, destination: Path) -> None:
    digest = hashlib.sha256()
    copied = 0
    with path.open("rb") as source, destination.open("xb") as target:
        while chunk := source.read(1024 * 1024):
            copied += len(chunk)
            if copied > 512 * 1024 * 1024:
                raise ValueError("source_byte_budget_exceeded")
            digest.update(chunk)
            target.write(chunk)
    if digest.hexdigest() != expected_sha256:
        raise ValueError("source_sha_mismatch")


@contextmanager
def _source_stage(usdc_path, expected_sha256):
    from pxr import Sdf, Usd, UsdGeom
    if not isinstance(expected_sha256, str) or not re.fullmatch(r"[0-9a-f]{64}", expected_sha256):
        raise ValueError("invalid_source_sha")
    with TemporaryDirectory(prefix="cfd-ground-source-") as directory:
        snapshot = Path(directory) / "source.usdc"
        _snapshot(Path(usdc_path), expected_sha256, snapshot)
        layer = Sdf.Layer.OpenAsAnonymous(str(snapshot))
        if layer is None:
            raise ValueError("invalid_source_layer")
        _reject_composition(layer)
        stage = Usd.Stage.Open(layer, load=Usd.Stage.LoadNone)
        if stage is None:
            raise ValueError("invalid_source_stage")
        if not stage.HasAuthoredMetadata("upAxis") or not stage.HasAuthoredMetadata("metersPerUnit"):
            raise ValueError("unknown_coordinate_frame")
        if UsdGeom.GetStageUpAxis(stage) != "Z":
            raise ValueError("unsupported_up_axis")
        units = float(UsdGeom.GetStageMetersPerUnit(stage))
        if not math.isfinite(units) or units <= 0:
            raise ValueError("invalid_units")
        yield stage, units, UsdGeom.XformCache(Usd.TimeCode.Default())


def read_ground_selection(
    usdc_path: Path,
    expected_sha256: str,
    selections: Sequence[GroundFaceSelection],
) -> tuple[list[GroundSurfaceFace], float]:
    """Return all selected upward triangles, or reject the selection atomically.

    ``upward`` is geometric orientation only, not a walkability or fluid proof.
    Polygon faces, holes, animation, instancing and composition are unsupported
    in this first source slice. No old ground/result/solver state is modified.
    """
    from pxr import Sdf, Usd, UsdGeom

    if not isinstance(expected_sha256, str) or not re.fullmatch(r"[0-9a-f]{64}", expected_sha256):
        raise ValueError("invalid_source_sha")
    try:
        selections = tuple(selections)
    except TypeError as error:
        raise ValueError("invalid_selection") from error
    if not selections:
        raise ValueError("empty_selection")
    seen = set()
    for selection in selections:
        if (
            not isinstance(selection, GroundFaceSelection)
            or not isinstance(selection.ifc_guid, str)
            or not re.fullmatch(r"[0-3][0-9A-Za-z_$]{21}", selection.ifc_guid)
            or not isinstance(selection.mesh_prim_path, str)
            or not selection.mesh_prim_path.startswith("/World/Elements/")
            or type(selection.polygon_face_index) is not int
            or selection.polygon_face_index < 0
        ):
            raise ValueError("invalid_selection")
        usd_path = Sdf.Path(selection.mesh_prim_path)
        if not usd_path.IsPrimPath() or usd_path.ContainsPrimVariantSelection():
            raise ValueError("invalid_selection")
        key = (selection.mesh_prim_path, selection.polygon_face_index)
        if key in seen:
            raise ValueError("duplicate_face")
        seen.add(key)

    with _source_stage(usdc_path, expected_sha256) as (stage, units, xcache):
        meshes = {}
        budget = [0, 0, 0]
        faces = []
        for selection in selections:
            key = (selection.ifc_guid, selection.mesh_prim_path)
            if key not in meshes:
                meshes[key] = _prepare_mesh(stage, selection, units, xcache, budget)
            faces.append(_read_face(selection, expected_sha256, meshes[key]))
        return faces, units


def read_selected_ground_faces(usdc_path, expected_sha256, selections) -> list[GroundSurfaceFace]:
    return read_ground_selection(usdc_path, expected_sha256, selections)[0]


def _prepare_mesh(stage, selection, units, xcache, budget=None):
    from pxr import Sdf, UsdGeom

    prim = stage.GetPrimAtPath(selection.mesh_prim_path)
    if not prim or not prim.IsA(UsdGeom.Mesh):
        raise ValueError("missing_mesh")
    if prim.IsInstance() or prim.IsInstanceProxy():
        raise ValueError("unsupported_instance")
    parts = selection.mesh_prim_path.split("/")
    if len(parts) < 6:
        raise ValueError("invalid_selection")
    element = stage.GetPrimAtPath("/".join(parts[:5]))
    identity = element.GetCustomDataByKey("bim") or {}
    if not isinstance(identity, dict) or not identity.get("ifc_guid") or not isinstance(identity.get("ifc_type"), str):
        raise ValueError("missing_identity")
    if identity["ifc_guid"] != selection.ifc_guid:
        raise ValueError("identity_mismatch")
    mesh = UsdGeom.Mesh(prim)
    attributes = [mesh.GetPointsAttr(), mesh.GetFaceVertexCountsAttr(), mesh.GetFaceVertexIndicesAttr(),
                  mesh.GetHoleIndicesAttr(), mesh.GetOrientationAttr(), mesh.GetSubdivisionSchemeAttr()]
    expected_types = [Sdf.ValueTypeNames.Point3fArray, Sdf.ValueTypeNames.IntArray,
                      Sdf.ValueTypeNames.IntArray, Sdf.ValueTypeNames.IntArray,
                      Sdf.ValueTypeNames.Token, Sdf.ValueTypeNames.Token]
    # GetTypeName alone returns the Mesh schema fallback even when an authored
    # Sdf spec declares a conflicting type. Check the actual property stack too.
    if any(attribute.GetTypeName() != expected or any(
        spec.typeName != expected for spec in attribute.GetPropertyStack()
    ) for attribute, expected in zip(attributes, expected_types)):
        raise ValueError("invalid_attribute_type")
    if any(attribute.GetNumTimeSamples() for attribute in attributes):
        raise ValueError("animated_geometry")
    parent = prim
    while parent:
        if parent.IsA(UsdGeom.Xformable):
            xform = UsdGeom.Xformable(parent)
            if xform.GetXformOpOrderAttr().GetNumTimeSamples() or any(
                op.GetAttr().GetNumTimeSamples() for op in xform.GetOrderedXformOps()
            ):
                raise ValueError("animated_geometry")
        parent = parent.GetParent()
    raw_points = mesh.GetPointsAttr().Get() or []
    raw_counts = mesh.GetFaceVertexCountsAttr().Get() or []
    raw_indices = mesh.GetFaceVertexIndicesAttr().Get() or []
    raw_holes = mesh.GetHoleIndicesAttr().Get() or []
    if len(raw_holes) > len(raw_counts):
        raise ValueError("hole_budget_exceeded")
    lengths = [len(raw_points), len(raw_counts), len(raw_indices)]
    if any(size > maximum for size, maximum in zip(lengths, (200000, 200000, 600000))):
        raise ValueError("mesh_budget_exceeded")
    if budget is not None:
        for index, size in enumerate(lengths):
            budget[index] += size
        if any(size > maximum for size, maximum in zip(budget, (1000000, 1000000, 3000000))):
            raise ValueError("scope_budget_exceeded")
    points = np.array(raw_points, dtype=np.float64).reshape(-1, 3)
    counts = list(raw_counts)
    indices = list(raw_indices)
    holes = list(raw_holes)
    if (any(count < 3 for count in counts) or sum(counts) != len(indices)
        or any(index < 0 or index >= len(points) for index in indices)
        or any(index < 0 or index >= len(counts) for index in holes)
        or len(set(holes)) != len(holes)):
        raise ValueError("invalid_topology")
    matrix = matrix_to_numpy(xcache.GetLocalToWorldTransform(prim))
    if not np.isfinite(matrix).all() or np.any(matrix[:3, 3] != 0) or matrix[3, 3] != 1:
        raise ValueError("invalid_transform")
    determinant = float(np.linalg.det(matrix[:3, :3]))
    if not math.isfinite(determinant) or determinant == 0:
        raise ValueError("invalid_transform")
    orientation = mesh.GetOrientationAttr().Get()
    if orientation not in ("leftHanded", "rightHanded"):
        raise ValueError("unsupported_orientation")
    sign = (-1 if orientation == "leftHanded" else 1) * (-1 if determinant < 0 else 1)
    offsets = np.concatenate(([0], np.cumsum(counts)))
    return (counts, indices, set(holes), offsets, transform_points(points, matrix) * units,
            sign, identity["ifc_type"], str(mesh.GetSubdivisionSchemeAttr().Get()))


def _read_face(selection, source_sha, prepared):
    counts, indices, holes, offsets, points, sign, ifc_type, subdivision = prepared
    face_index = selection.polygon_face_index
    if face_index >= len(counts):
        raise ValueError("missing_face")
    if face_index in holes:
        raise ValueError("hole_face")
    if counts[face_index] != 3:
        raise ValueError("unsupported_polygon")
    offset = int(offsets[face_index])
    point_indices = tuple(indices[offset:offset + 3])
    vertices = points[list(point_indices)]
    if not np.isfinite(vertices).all():
        raise ValueError("nonfinite_geometry")
    cross = np.cross(vertices[1] - vertices[0], vertices[2] - vertices[0])
    length = float(np.linalg.norm(cross))
    if not math.isfinite(length):
        raise ValueError("nonfinite_geometry")
    if length <= 1e-12:
        raise ValueError("degenerate_face")
    normal = cross * sign / length
    if normal[2] <= 1e-12:
        raise ValueError("not_upward")
    xyz = tuple(tuple(_canonical_float(value) for value in vertex) for vertex in vertices)
    normal_tuple = tuple(_canonical_float(value) for value in normal)
    # Versioned big-endian binary64, preserved vertex order, canonical positive 0.
    geometry_sha, face_id = _face_identity(source_sha, selection, xyz, normal_tuple)
    return GroundSurfaceFace(
        source_sha, selection.ifc_guid, ifc_type, selection.mesh_prim_path,
        face_index, point_indices, xyz, normal_tuple, length / 2, geometry_sha, face_id,
        subdivision,
    )


def catalog_ground_faces(usdc_path: Path, expected_sha256: str, component_path: str,
                         *, cursor: str | None = None, limit: int = 50) -> dict:
    """A bounded page of authored upward faces, never inferred walkable ground.

    Cursor addresses raw faces (including rejected ones), is bound to exact bytes
    and scope, and is not an access grant. Rejection counts are for this page.
    """
    from pxr import Sdf, Usd, UsdGeom
    if (not isinstance(component_path, str) or not component_path.startswith("/World/Elements/")
        or len(component_path.split("/")) < 5 or not Sdf.Path(component_path).IsPrimPath()
        or Sdf.Path(component_path).ContainsPrimVariantSelection() or ".." in component_path.split("/")):
        raise ValueError("invalid_scope")
    if type(limit) is not int or not 1 <= limit <= 100:
        raise ValueError("invalid_limit")
    prefix = hashlib.sha256(f"ground-catalog/v1\0{expected_sha256}\0{component_path}".encode()).hexdigest()
    start = 0
    if cursor is not None:
        if not isinstance(cursor, str) or not re.fullmatch(prefix + r"\.(0|[1-9][0-9]{0,9})", cursor):
            raise ValueError("invalid_cursor")
        start = int(cursor.split(".")[1])
    with _source_stage(usdc_path, expected_sha256) as (stage, units, xcache):
        root = stage.GetPrimAtPath(component_path)
        if not root:
            raise ValueError("missing_scope")
        faces, rejected_meshes, rejected = [], [], {}
        position, inspected, next_offset = 0, 0, None
        # A selected component only; page work is capped at 5000 raw faces.
        meshes = []
        for prim in Usd.PrimRange(root):
            if prim.IsA(UsdGeom.Mesh):
                if len(meshes) >= 256:
                    raise ValueError("scope_mesh_budget_exceeded")
                meshes.append(prim)
        meshes.sort(key=lambda p: str(p.GetPath()))
        budget = [0, 0, 0]
        for prim in meshes:
            mesh_path = str(prim.GetPath())
            element = stage.GetPrimAtPath("/".join(mesh_path.split("/")[:5]))
            identity = element.GetCustomDataByKey("bim") or {}
            guid = identity.get("ifc_guid") if isinstance(identity, dict) else None
            if not isinstance(guid, str) or not re.fullmatch(r"[0-3][0-9A-Za-z_$]{21}", guid):
                rejected_meshes.append({"mesh_prim_path": mesh_path, "reason": "missing_identity"})
                continue
            selection = GroundFaceSelection(guid, mesh_path, 0)
            try:
                prepared = _prepare_mesh(stage, selection, units, xcache, budget)
            except ValueError as error:
                if str(error) == "scope_budget_exceeded":
                    raise
                rejected_meshes.append({"mesh_prim_path": mesh_path, "reason": str(error)})
                continue
            total = len(prepared[0])
            if position + total <= start:
                position += total
                continue
            for index in range(max(0, start - position), total):
                offset = position + index
                if len(faces) >= limit or inspected >= 5000:
                    next_offset = offset
                    break
                inspected += 1
                try:
                    faces.append(asdict(_read_face(GroundFaceSelection(guid, mesh_path, index), expected_sha256, prepared)))
                except ValueError as error:
                    reason = str(error)
                    rejected[reason] = rejected.get(reason, 0) + 1
            if next_offset is not None:
                break
            position += total
        if start > position and next_offset is None:
            raise ValueError("invalid_cursor")
        return {"schema": "ground-face-catalog/v1", "model_usdc_sha256": expected_sha256,
                "component_path": component_path, "stage_meters_per_unit": units,
                "faces": faces, "rejected_faces": rejected, "rejected_meshes": rejected_meshes,
                "inspected_faces": inspected, "complete": next_offset is None,
                "next_cursor": f"{prefix}.{next_offset}" if next_offset is not None else None,
                "actual_ground_verified": False}

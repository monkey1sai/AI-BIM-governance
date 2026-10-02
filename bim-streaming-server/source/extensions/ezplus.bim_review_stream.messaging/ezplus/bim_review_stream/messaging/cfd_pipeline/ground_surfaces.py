"""Read explicitly selected authored USD triangles without guessing walkable ground.

This source primitive is not wired to run submission, sampling or rendering.
Source identity covers a private snapshot of a self-contained, static Z-up file.
"""

from __future__ import annotations

from dataclasses import dataclass
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
    with path.open("rb") as source, destination.open("xb") as target:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
            target.write(chunk)
    if digest.hexdigest() != expected_sha256:
        raise ValueError("source_sha_mismatch")


def read_selected_ground_faces(
    usdc_path: Path,
    expected_sha256: str,
    selections: Sequence[GroundFaceSelection],
) -> list[GroundSurfaceFace]:
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

    # Never reopen or Reload a shared source layer: hash and parse the same copy.
    with TemporaryDirectory(prefix="cfd-ground-source-") as directory:
        snapshot = Path(directory) / "source.usdc"
        _snapshot(Path(usdc_path), expected_sha256, snapshot)
        layer = Sdf.Layer.OpenAsAnonymous(str(snapshot))
        if layer is None:
            raise ValueError("invalid_source_layer")
        _reject_composition(layer)  # Before Stage.Open can resolve another layer.
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
        xcache = UsdGeom.XformCache(Usd.TimeCode.Default())
        return [_read_face(stage, selection, expected_sha256, units, xcache) for selection in selections]


def _read_face(stage, selection, source_sha, units, xcache):
    from pxr import UsdGeom

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
    points = np.array(mesh.GetPointsAttr().Get() or [], dtype=np.float64).reshape(-1, 3)
    counts = [int(value) for value in (mesh.GetFaceVertexCountsAttr().Get() or [])]
    indices = [int(value) for value in (mesh.GetFaceVertexIndicesAttr().Get() or [])]
    holes = [int(value) for value in (mesh.GetHoleIndicesAttr().Get() or [])]
    if (any(count < 3 for count in counts) or sum(counts) != len(indices)
        or any(index < 0 or index >= len(points) for index in indices)
        or any(index < 0 or index >= len(counts) for index in holes)):
        raise ValueError("invalid_topology")
    face_index = selection.polygon_face_index
    if face_index >= len(counts):
        raise ValueError("missing_face")
    if face_index in holes:
        raise ValueError("hole_face")
    if counts[face_index] != 3:
        raise ValueError("unsupported_polygon")
    offset = sum(counts[:face_index])
    point_indices = tuple(indices[offset:offset + 3])
    matrix = matrix_to_numpy(xcache.GetLocalToWorldTransform(prim))
    if not np.isfinite(matrix).all() or np.any(matrix[:3, 3] != 0) or matrix[3, 3] != 1:
        raise ValueError("invalid_transform")
    determinant = float(np.linalg.det(matrix[:3, :3]))
    if not math.isfinite(determinant) or determinant == 0:
        raise ValueError("invalid_transform")
    vertices = transform_points(points[list(point_indices)], matrix) * units
    if not np.isfinite(vertices).all():
        raise ValueError("nonfinite_geometry")
    cross = np.cross(vertices[1] - vertices[0], vertices[2] - vertices[0])
    length = float(np.linalg.norm(cross))
    if not math.isfinite(length):
        raise ValueError("nonfinite_geometry")
    if length <= 1e-12:
        raise ValueError("degenerate_face")
    orientation = mesh.GetOrientationAttr().Get()
    if orientation not in ("leftHanded", "rightHanded"):
        raise ValueError("unsupported_orientation")
    sign = (-1 if orientation == "leftHanded" else 1) * (-1 if determinant < 0 else 1)
    normal = cross * sign / length
    if normal[2] <= 1e-12:
        raise ValueError("not_upward")
    xyz = tuple(tuple(_canonical_float(value) for value in vertex) for vertex in vertices)
    normal_tuple = tuple(_canonical_float(value) for value in normal)
    # Versioned big-endian binary64, preserved vertex order, canonical positive 0.
    geometry_sha = hashlib.sha256(b"cfd-ground-authored-triangle/v1\0" +
        struct.pack(">12d", *[value for vertex in xyz for value in vertex], *normal_tuple)).hexdigest()
    face_id = hashlib.sha256(
        f"cfd-ground-face/v1\0{source_sha}\0{selection.ifc_guid}\0{selection.mesh_prim_path}\0{face_index}\0{geometry_sha}".encode("utf-8")
    ).hexdigest()
    return GroundSurfaceFace(
        source_sha, selection.ifc_guid, identity["ifc_type"], selection.mesh_prim_path,
        face_index, point_indices, xyz, normal_tuple, length / 2, geometry_sha, face_id,
        str(mesh.GetSubdivisionSchemeAttr().Get()),
    )

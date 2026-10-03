"""Prepare a separate, source-bound open terrain patch; never make or run a case.

Exact binary-float XY predicates avoid inventing gaps/overlaps with a snap tolerance.
This is a bounded candidate artifact, not terrain coverage or fluid authority.
"""
from __future__ import annotations

import argparse
from collections import defaultdict
from dataclasses import asdict
from fractions import Fraction
import hashlib
import json
import math
from pathlib import Path
import re
import struct
import sys

from .ground_surfaces import GroundFaceSelection, GroundSurfaceFace, _face_identity, read_ground_selection

MAX_FACES = 100
MAX_STL_ERROR_M = 1e-5  # export fidelity only, never CFD accuracy or mesh resolution


def _xy(point):
    return tuple(Fraction(value) for value in point[:2])


def _cross(a, b, c):
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])


def _area(polygon):
    return sum((_cross(polygon[0], polygon[i], polygon[i + 1])
                for i in range(1, len(polygon) - 1)), Fraction(0)) / 2 if len(polygon) >= 3 else Fraction(0)


def _overlap(first, second):
    """Positive area only. Shared edges/vertices are allowed, stacked XY is not."""
    polygon = list(first)
    for a, b in zip(second, (*second[1:], second[0])):
        output = []
        for start, end in zip(polygon, (*polygon[1:], polygon[0])) if polygon else ():
            ds, de = _cross(a, b, start), _cross(a, b, end)
            if (ds >= 0) != (de >= 0):
                t = ds / (ds - de)
                output.append(tuple(start[i] + t * (end[i] - start[i]) for i in (0, 1)))
            if de >= 0:
                output.append(end)
        polygon = output
    return _area(polygon) > 0


def _normal(vertices):
    a, b, c = vertices
    u, v = [b[i] - a[i] for i in range(3)], [c[i] - a[i] for i in range(3)]
    n = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]]
    length = math.hypot(*n)
    if not math.isfinite(length) or length <= 2e-12 or n[2] == 0:
        raise ValueError("unsupported_or_degenerate_terrain_face")
    return tuple(value / length for value in n), length / 2


def _finite_number(value):
    try:
        return not isinstance(value, bool) and isinstance(value, (float, int)) and math.isfinite(value)
    except OverflowError:
        return False


def _validate_face(face, source_sha256):
    if (face.model_usdc_sha256 != source_sha256
            or face.geometry_representation != "authored_triangle"
            or face.actual_ground_verified is not False
            or not isinstance(face.ifc_guid, str)
            or not re.fullmatch(r"[0-3][0-9A-Za-z_$]{21}", face.ifc_guid)
            or not isinstance(face.mesh_prim_path, str)
            or not face.mesh_prim_path.startswith("/World/Elements/")
            or len(face.mesh_prim_path) > 1024
            or type(face.polygon_face_index) is not int or face.polygon_face_index < 0
            or not isinstance(face.ifc_type, str) or not re.fullmatch(r"Ifc[A-Za-z0-9]+", face.ifc_type)
            or face.subdivision_scheme not in ("none", "catmullClark", "loop", "bilinear")
            or not isinstance(face.point_indices, (tuple, list)) or len(face.point_indices) != 3
            or any(type(i) is not int or i < 0 for i in face.point_indices)
            or len(set(face.point_indices)) != 3
            or not isinstance(face.vertices_m, (tuple, list)) or len(face.vertices_m) != 3
            or any(not isinstance(p, (tuple, list)) or len(p) != 3 for p in face.vertices_m)
            or not isinstance(face.normal, (tuple, list)) or len(face.normal) != 3
            or any(not _finite_number(v) for v in (*face.normal, *(v for p in face.vertices_m for v in p)))
            or face.normal[2] <= 0 or not _finite_number(face.area_m2) or face.area_m2 <= 0
            or not isinstance(face.face_id, str) or not re.fullmatch(r"[0-9a-f]{64}", face.face_id)
            or not isinstance(face.geometry_sha256, str) or not re.fullmatch(r"[0-9a-f]{64}", face.geometry_sha256)):
        raise ValueError("invalid_terrain_face_or_source")


def _topology(triangles):
    edges, adjacency = defaultdict(list), [set() for _ in triangles]
    for index, triangle in enumerate(triangles):
        for a, b in zip(triangle, (*triangle[1:], triangle[0])):
            edges[tuple(sorted((a, b)))].append((index, a, b))
    boundary = []
    for items in edges.values():
        if len(items) > 2:
            raise ValueError("nonmanifold_terrain_edge")
        if len(items) == 2:
            (i, a, b), (j, c, d) = items
            if (a, b) != (d, c):
                raise ValueError("inconsistent_terrain_edge_orientation")
            adjacency[i].add(j)
            adjacency[j].add(i)
        else:
            boundary.append(items[0][1:])
    incoming, outgoing = defaultdict(list), defaultdict(list)
    for a, b in boundary:
        outgoing[a].append(b)
        incoming[b].append(a)
    if set(incoming) != set(outgoing) or any(len(incoming[p]) != 1 or len(outgoing[p]) != 1 for p in outgoing):
        raise ValueError("nonmanifold_terrain_boundary")
    loops, remaining = [], set(outgoing)
    while remaining:
        start = min(remaining)
        point = start
        loop = []
        while point in remaining:
            remaining.remove(point)
            loop.append(point)
            point = outgoing[point][0]
        if point != start:
            raise ValueError("nonmanifold_terrain_boundary")
        area = _area([_xy(p) for p in loop])
        if area == 0:
            raise ValueError("degenerate_terrain_boundary")
        loops.append({"vertices_m": [list(p) for p in loop], "signed_xy_area_m2": float(area),
                      "kind": "outer" if area > 0 else "interior_hole"})
    remaining, components = set(range(len(triangles))), 0
    while remaining:
        components += 1
        pending = [remaining.pop()]
        while pending:
            for neighbour in adjacency[pending.pop()]:
                if neighbour in remaining:
                    remaining.remove(neighbour)
                    pending.append(neighbour)
    return components, loops, len(boundary)


def prepare_terrain_geometry(faces, source_sha256):
    """In-memory identity checks only; the CLI obtains faces from fresh USD bytes."""
    if not isinstance(source_sha256, str) or not re.fullmatch(r"[0-9a-f]{64}", source_sha256):
        raise ValueError("invalid_source_sha")
    if not isinstance(faces, (list, tuple)) or not 1 <= len(faces) <= MAX_FACES:
        raise ValueError("terrain_face_budget")
    if not all(isinstance(face, GroundSurfaceFace) for face in faces):
        raise ValueError("invalid_terrain_face")
    for face in faces:
        _validate_face(face, source_sha256)
    ordered = sorted(faces, key=lambda face: face.face_id)
    source_triangles, encoded_triangles, normals, identities = [], [], [], set()
    source_by_encoded, seen_geometry, max_error = {}, set(), 0.0
    reversed_faces = []
    for face in ordered:
        identity = _face_identity(source_sha256, GroundFaceSelection(face.ifc_guid, face.mesh_prim_path, face.polygon_face_index), face.vertices_m, face.normal)
        if identity != (face.geometry_sha256, face.face_id):
            raise ValueError("terrain_face_identity_mismatch")
        if face.face_id in identities:
            raise ValueError("duplicate_terrain_face")
        identities.add(face.face_id)
        vertices = tuple(tuple(float(v) for v in p) for p in face.vertices_m)
        normal, area = _normal(vertices)
        # USD handedness / a mirrored parent may reverse authored winding.
        # Keep original vertices in provenance; orient only the export upwards.
        reverse = normal[2] < 0
        if reverse:
            vertices = (vertices[0], vertices[2], vertices[1])
            normal = tuple(-v for v in normal)
        reversed_faces.append(reverse)
        if not all(math.isclose(a, b, rel_tol=1e-9, abs_tol=1e-9) for a, b in zip(normal, face.normal)):
            raise ValueError("terrain_normal_mismatch")
        if not math.isclose(area, face.area_m2, rel_tol=1e-9, abs_tol=1e-12):
            raise ValueError("terrain_area_mismatch")
        geometry = tuple(sorted(vertices))
        if geometry in seen_geometry:
            raise ValueError("duplicate_terrain_geometry")
        seen_geometry.add(geometry)
        try:
            encoded = tuple(tuple(struct.unpack("<f", struct.pack("<f", v))[0] for v in p) for p in vertices)
        except OverflowError as error:
            raise ValueError("terrain_stl_precision_loss") from error
        error = max(abs(a - b) for p, q in zip(vertices, encoded) for a, b in zip(p, q))
        if not math.isfinite(error) or error > MAX_STL_ERROR_M:
            raise ValueError("terrain_stl_precision_loss")
        max_error = max(max_error, error)
        for p, q in zip(vertices, encoded):
            if q in source_by_encoded and source_by_encoded[q] != p:
                raise ValueError("terrain_stl_vertex_identity_loss")
            source_by_encoded[q] = p
        normal, _ = _normal(encoded)
        if normal[2] <= 0:
            raise ValueError("terrain_stl_orientation_loss")
        source_triangles.append(vertices)
        encoded_triangles.append(encoded)
        normals.append(normal)
    components, loops, edge_count = _topology(source_triangles)
    for triangles in (source_triangles, encoded_triangles):
        projected = [tuple(_xy(p) for p in t) for t in triangles]
        for i, triangle in enumerate(projected):
            for other in projected[i+1:]:
                if _overlap(triangle, other):
                    raise ValueError("terrain_xy_overlap_or_multilayer")
    body = b"cfd-terrain-candidate/v1".ljust(80, b"\0") + struct.pack("<I", len(ordered))
    body += b"".join(struct.pack("<12fH", *n, *(v for p in t for v in p), 0)
                     for n, t in zip(normals, encoded_triangles))
    hole_count = sum(loop["kind"] == "interior_hole" for loop in loops)
    manifest = {"schema":"cfd-terrain-preparation/v1","status":"HELD","authority":"in_memory_source_face_identity",
                "coordinate_frame":"model_world_metres_z_up","geometry_role":"terrain_surface_candidate",
                "model_usdc_sha256":source_sha256,"source_faces":[asdict(face) for face in ordered],
                "terrain_stl":{"sha256":hashlib.sha256(body).hexdigest(),"bytes":len(body),"triangle_count":len(ordered),
                               "max_coordinate_error_m":max_error,"coordinate_error_limit_m":MAX_STL_ERROR_M},
                "triangle_to_face_id":[face.face_id for face in ordered],
                "export_winding_reversed":reversed_faces,
                "quality":{"connected_components":components,"open_boundary_edges":edge_count,"boundary_loops":loops,
                           "interior_holes":hole_count,"topology_state":"incomplete" if hole_count or components != 1 else "single_open_patch",
                           "source_and_stl_xy_overlap":False,"duplicate_faces":False,"nonmanifold_edges":False},
                "reasons":["terrain_coverage_unverified","domain_and_building_coupling_unverified","not_adopted_by_case_writer"],
                "actual_ground_verified":False,"coverage_verified":False,"fluid_region_verified":False,"solver_started":False}
    if hole_count:
        manifest["reasons"].append("terrain_interior_holes")
    if components != 1:
        manifest["reasons"].append("terrain_disconnected_patches")
    return body, manifest


def _unique_keys(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate_json_key")
        result[key] = value
    return result


def main(argv=None):
    from pxr import Tf
    parser = argparse.ArgumentParser(description="Source-bound terrain candidate only; no case, mesh or solver.")
    parser.add_argument("--model-usdc", required=True)
    parser.add_argument("--model-sha256", required=True)
    parser.add_argument("--selection", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args(argv)
    try:
        with Path(args.selection).open("rb") as stream:
            raw = stream.read(512 * 1024 + 1)
        if len(raw) > 512 * 1024:
            raise ValueError("selection_byte_budget")
        selected = json.loads(raw, object_pairs_hook=_unique_keys)
        if (not isinstance(selected,dict) or set(selected)!={"model_usdc_sha256","faces"}
                or selected["model_usdc_sha256"]!=args.model_sha256 or not isinstance(selected["faces"],list)
                or not 1 <= len(selected["faces"]) <= MAX_FACES):
            raise ValueError("invalid_identity_list")
        keys = {"ifc_guid", "mesh_prim_path", "polygon_face_index", "face_id", "geometry_sha256"}
        if any(not isinstance(f,dict) or set(f)!=keys or not isinstance(f["mesh_prim_path"],str)
               or len(f["mesh_prim_path"]) > 1024 for f in selected["faces"]):
            raise ValueError("invalid_identity_list")
        faces, _ = read_ground_selection(Path(args.model_usdc), args.model_sha256,
            [GroundFaceSelection(f["ifc_guid"], f["mesh_prim_path"], f["polygon_face_index"])
             for f in selected["faces"]])
        if any((face.face_id,face.geometry_sha256)!=(item["face_id"],item["geometry_sha256"]) for face,item in zip(faces,selected["faces"])):
            raise ValueError("terrain_face_identity_mismatch")
        stl, manifest = prepare_terrain_geometry(faces, args.model_sha256)
        digest = hashlib.sha256()
        size = 0
        with Path(args.model_usdc).open("rb") as stream:
            while chunk := stream.read(1024 * 1024):
                size += len(chunk)
                if size > 512 * 1024 * 1024:
                    raise ValueError("source_byte_budget")
                digest.update(chunk)
        if digest.hexdigest() != args.model_sha256:
            raise ValueError("source_sha_mismatch")
        manifest.update(authority="fresh_source_snapshot_face_identity",
                        selection_input_sha256=hashlib.sha256(raw).hexdigest())
        encoded = json.dumps(manifest, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")
        if len(encoded) > 512 * 1024:
            raise ValueError("manifest_byte_budget")
        out = Path(args.out)
        out.mkdir()  # Exclusive new directory; never overwrite a case or artifact.
        with (out / "terrain.stl").open("xb") as target:
            target.write(stl)
        # Publish last; missing or malformed manifest is incomplete.
        with (out / "manifest.json").open("xb") as target:
            target.write(encoded)
        print(json.dumps({"status": "HELD", "triangle_count": len(faces),
                          "topology_state": manifest["quality"]["topology_state"], "actual_ground_verified": False}))
        return 2
    except (ValueError, TypeError, KeyError, UnicodeError, RecursionError, OverflowError, Tf.ErrorException):
        print("terrain_prepare_failed: invalid_input_source_or_geometry", file=sys.stderr)
        return 4
    except OSError:
        print("terrain_prepare_failed: local_io_or_output_exists", file=sys.stderr)
        return 4


if __name__ == "__main__":
    raise SystemExit(main())

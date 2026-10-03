"""Source-bound authored face catalog and immutable selection previews. No CFD jobs."""
from dataclasses import asdict
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
from tempfile import TemporaryDirectory
import threading
import numpy as np

from cfd_pipeline.ground_surfaces import GroundFaceSelection, catalog_ground_faces, read_ground_selection
from cfd_pipeline.ground_sampling import ground_sample_grid, sample_ground_points


class GroundSelectionError(ValueError):
    def __init__(self, code, status=400):
        super().__init__(code)
        self.status = status


def _sha(value):
    return isinstance(value, str) and re.fullmatch(r"[0-9a-f]{64}", value) is not None


def _json(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")


class GroundSelectionService:
    def __init__(self, conversion_store):
        self.conversions = conversion_store
        self.root = Path(conversion_store.settings.artifacts_root).resolve() / "_ground-selections"
        self.lock = threading.RLock()
        self.sample_lock = threading.Lock()

    def source(self, conversion_job_id):
        if not isinstance(conversion_job_id, str) or not re.fullmatch(r"[A-Za-z0-9_.-]{1,200}", conversion_job_id) or conversion_job_id in (".", ".."):
            raise GroundSelectionError("invalid_conversion")
        job = self.conversions.get_conversion_job(conversion_job_id)
        result = job.get("result") if isinstance(job, dict) else None
        if not isinstance(result, dict) or result.get("ready") is not True:
            raise GroundSelectionError("source_not_ready", 409)
        artifact = (result.get("artifacts") or {}).get("model_usdc")
        if not isinstance(artifact, dict) or not _sha(artifact.get("checksum_sha256")):
            raise GroundSelectionError("source_not_ready", 409)
        path = Path(str(artifact.get("path") or "")).resolve()
        expected_root = (Path(self.conversions.settings.artifacts_root) / conversion_job_id).resolve()
        if (expected_root.parent != Path(self.conversions.settings.artifacts_root).resolve()
            or path.parent != expected_root or path.name != "model.usdc"):
            raise GroundSelectionError("source_integrity_violation", 409)
        return path, artifact["checksum_sha256"]

    def catalog(self, conversion_job_id, body):
        if not isinstance(body, dict) or set(body) - {"component_path", "cursor", "limit"}:
            raise GroundSelectionError("invalid_request")
        path, source_sha = self.source(conversion_job_id)
        result = catalog_ground_faces(path, source_sha, body.get("component_path"),
                                      cursor=body.get("cursor"), limit=body.get("limit", 50))
        return {**result, "conversion_job_id": conversion_job_id}

    def prepare(self, conversion_job_id, body):
        if not isinstance(body, dict) or set(body) != {"region_name", "model_usdc_sha256", "faces"}:
            raise GroundSelectionError("invalid_request")
        name, expected_sha, requested = body["region_name"], body["model_usdc_sha256"], body["faces"]
        if (not isinstance(name, str) or not 1 <= len(name) <= 80 or not name.strip()
            or any(ord(char) < 32 or 127 <= ord(char) <= 159 or 0xd800 <= ord(char) <= 0xdfff for char in name)
            or not _sha(expected_sha) or not isinstance(requested, list) or not 1 <= len(requested) <= 100):
            raise GroundSelectionError("invalid_request")
        selections = []
        for item in requested:
            if not isinstance(item, dict) or set(item) != {"ifc_guid", "mesh_prim_path", "polygon_face_index", "face_id"} or not _sha(item["face_id"]):
                raise GroundSelectionError("invalid_request")
            selections.append(GroundFaceSelection(item["ifc_guid"], item["mesh_prim_path"], item["polygon_face_index"]))
        path, source_sha = self.source(conversion_job_id)
        if source_sha != expected_sha:
            raise GroundSelectionError("source_sha_mismatch", 409)
        faces, units = read_ground_selection(path, source_sha, selections)
        if any(face.face_id != item["face_id"] for face, item in zip(faces, requested)):
            raise GroundSelectionError("face_identity_mismatch", 409)
        faces = sorted(faces, key=lambda face: face.face_id)
        selection_sha = hashlib.sha256(b"ground-selection/v1\0" + _json([
            conversion_job_id, source_sha, name, [face.face_id for face in faces]])).hexdigest()
        selection_id = "ground_" + selection_sha
        folder = self._folder(selection_id)
        with self.lock:
            if folder.exists():
                return self._manifest(selection_id)
            self.root.mkdir(parents=True, exist_ok=True)
            with TemporaryDirectory(prefix=".draft-", dir=self.root) as temporary:
                target = Path(temporary)
                preview = target / "preview.usda"
                self._write_preview(preview, faces, units, selection_sha)
                manifest = {"schema": "ground-selection-preview/v1", "selection_id": selection_id,
                            "selection_sha256": selection_sha, "conversion_job_id": conversion_job_id,
                            "model_usdc_sha256": source_sha, "region_name": name,
                            "faces": [asdict(face) for face in faces], "stage_meters_per_unit": units,
                            "display_lift_m": 0.01, "actual_ground_verified": False,
                            "artifact_id": "artifact_" + selection_id,
                            "preview_sha256": hashlib.sha256(preview.read_bytes()).hexdigest()}
                manifest = json.loads(_json(manifest))
                (target / "manifest.json").write_bytes(_json(manifest))
                os.rename(target, folder)
            return manifest

    @staticmethod
    def _write_preview(path, faces, units, selection_sha):
        from pxr import Gf, Usd, UsdGeom
        stage = Usd.Stage.CreateNew(str(path))
        UsdGeom.SetStageUpAxis(stage, "Z")
        UsdGeom.SetStageMetersPerUnit(stage, units)
        root = UsdGeom.Xform.Define(stage, "/GroundSelections")
        root.SetResetXformStack(True)
        # Independent root: never inherits /World transforms. Sublayers do not
        # rescale units, so author points in the primary source's exact units.
        for index, face in enumerate(faces):
            xyz = np.array(face.vertices_m, dtype=np.float64)
            anchor = xyz[0].copy()
            local = np.array((xyz - anchor) / units, dtype=np.float32)
            restored = local.astype(np.float64) * units + anchor
            if (not np.isfinite(local).all() or np.max(np.abs(restored - xyz)) > 1e-4
                or np.linalg.norm(np.cross(restored[1] - restored[0], restored[2] - restored[0])) <= 1e-12):
                raise GroundSelectionError("preview_precision_unsupported", 409)
            node = "/GroundSelections/S_" + selection_sha + "/F_" + str(index)
            anchor[2] += 0.01
            xform = UsdGeom.Xform.Define(stage, node)
            xform.AddTranslateOp(precision=UsdGeom.XformOp.PrecisionDouble).Set(Gf.Vec3d(*(anchor / units)))
            mesh = UsdGeom.Mesh.Define(stage, node + "/Face")
            mesh.CreateSubdivisionSchemeAttr("none")
            mesh.CreateDoubleSidedAttr(True)
            mesh.CreatePointsAttr([Gf.Vec3f(*map(float, point)) for point in local])
            mesh.CreateFaceVertexCountsAttr([3])
            mesh.CreateFaceVertexIndicesAttr([0, 1, 2])
            mesh.CreateDisplayColorAttr([Gf.Vec3f(1.0, 0.25, 0.7)])
            mesh.CreateDisplayOpacityAttr([0.7])
        stage.GetRootLayer().customLayerData = {"ground:selection_sha256": selection_sha,
                                                "ground:display_lift_m": 0.01,
                                                "ground:actual_ground_verified": False}
        stage.GetRootLayer().Save()

    def _folder(self, selection_id):
        if not isinstance(selection_id, str) or not re.fullmatch(r"ground_[0-9a-f]{64}", selection_id):
            raise GroundSelectionError("invalid_selection_id")
        folder = (self.root / selection_id).resolve()
        if folder.parent != self.root.resolve():
            raise GroundSelectionError("selection_integrity_violation", 409)
        return folder

    def _manifest(self, selection_id):
        path = self._folder(selection_id) / "manifest.json"
        if not path.is_file():
            raise GroundSelectionError("selection_not_found", 404)
        if path.stat().st_size > 512 * 1024:
            raise GroundSelectionError("selection_integrity_violation", 409)
        document = json.loads(path.read_bytes())
        if document.get("selection_id") != selection_id or document.get("selection_sha256") != selection_id[7:]:
            raise GroundSelectionError("selection_integrity_violation", 409)
        expected = hashlib.sha256(b"ground-selection/v1\0" + _json([
            document["conversion_job_id"], document["model_usdc_sha256"], document["region_name"],
            [face["face_id"] for face in document["faces"]]])).hexdigest()
        if expected != selection_id[7:]:
            raise GroundSelectionError("selection_integrity_violation", 409)
        return document

    def _checked_faces(self, conversion_job_id, selection_id):
        manifest = self._manifest(selection_id)
        if manifest["conversion_job_id"] != conversion_job_id:
            raise GroundSelectionError("model_mismatch", 409)
        path, source_sha = self.source(conversion_job_id)
        if source_sha != manifest["model_usdc_sha256"]:
            raise GroundSelectionError("source_sha_mismatch", 409)
        faces, _ = read_ground_selection(path, source_sha, [GroundFaceSelection(
            item["ifc_guid"], item["mesh_prim_path"], item["polygon_face_index"]) for item in manifest["faces"]])
        if json.loads(_json([asdict(face) for face in faces])) != manifest["faces"]:
            raise GroundSelectionError("face_identity_mismatch", 409)
        self.preview_bytes(selection_id)
        return manifest, faces

    def checked(self, conversion_job_id, selection_id):
        return self._checked_faces(conversion_job_id, selection_id)[0]

    def sample_points(self, conversion_job_id, selection_id, body):
        if not isinstance(body, dict) or set(body) != {"bounds_m", "spacing_m"}:
            raise GroundSelectionError("invalid_request")
        queries = ground_sample_grid(body["bounds_m"], body["spacing_m"])
        if not self.sample_lock.acquire(blocking=False):
            raise GroundSelectionError("ground_sampling_busy", 429)
        try:
            manifest, faces = self._checked_faces(conversion_job_id, selection_id)
            result = sample_ground_points(faces, manifest["model_usdc_sha256"], queries)
            result.update(selection_id=manifest["selection_id"], selection_sha256=manifest["selection_sha256"],
                          conversion_job_id=conversion_job_id, bounds_m=body["bounds_m"], spacing_m=body["spacing_m"])
            if len(_json(result)) > 8 * 1024 * 1024:
                raise GroundSelectionError("ground_sample_response_too_large", 413)
            return result
        finally:
            self.sample_lock.release()

    def preview_bytes(self, selection_id):
        manifest = self._manifest(selection_id)
        path = self._folder(selection_id) / "preview.usda"
        if not path.is_file() or path.stat().st_size > 512 * 1024:
            raise GroundSelectionError("selection_integrity_violation", 409)
        body = path.read_bytes()
        if hashlib.sha256(body).hexdigest() != manifest["preview_sha256"]:
            raise GroundSelectionError("selection_integrity_violation", 409)
        return body

def register_ground_selection_routes(app, conversions):
    from fastapi import Body, HTTPException, Request
    from fastapi.responses import Response
    from starlette.concurrency import run_in_threadpool
    service = GroundSelectionService(conversions)
    app.state.ground_selection_service = service

    def authorized(request):
        token = conversions.settings.internal_conversion_token
        if not token:
            raise HTTPException(503, detail="ground_internal_auth_not_configured")
        actual = request.headers.get("X-Internal-Conversion-Token", "")
        if not hmac.compare_digest(actual.encode(), token.encode()):
            raise HTTPException(403, detail="ground_internal_auth_required")

    def invoke(function, *args):
        try:
            return function(*args)
        except GroundSelectionError as error:
            raise HTTPException(error.status, detail=str(error)) from error
        except ValueError as error:
            raise HTTPException(400, detail=str(error)) from error
        except (OSError, RuntimeError) as error:
            raise HTTPException(502, detail="ground_source_unavailable") from error

    @app.post("/api/conversions/{conversion_job_id}/ground-surfaces/catalog")
    def catalog(conversion_job_id: str, request: Request, body: dict = Body(...)):
        authorized(request)
        return invoke(service.catalog, conversion_job_id, body)

    @app.post("/api/conversions/{conversion_job_id}/ground-surfaces/previews")
    def prepare(conversion_job_id: str, request: Request, body: dict = Body(...)):
        authorized(request)
        return invoke(service.prepare, conversion_job_id, body)

    @app.get("/api/conversions/{conversion_job_id}/ground-surfaces/selections/{selection_id}")
    def saved(conversion_job_id: str, selection_id: str, request: Request):
        authorized(request)
        return invoke(service.checked, conversion_job_id, selection_id)

    @app.post("/api/conversions/{conversion_job_id}/ground-surfaces/selections/{selection_id}/sample-points")
    async def sample(conversion_job_id: str, selection_id: str, request: Request):
        authorized(request)
        body = bytearray()
        async for chunk in request.stream():
            if len(body) + len(chunk) > 8 * 1024:
                raise HTTPException(413, detail="ground_sample_request_too_large")
            body.extend(chunk)
        try:
            document = json.loads(body)
        except (ValueError, UnicodeError, RecursionError):
            raise HTTPException(400, detail="invalid_request") from None
        return await run_in_threadpool(invoke, service.sample_points, conversion_job_id, selection_id, document)

    @app.get("/ground-artifacts/{selection_id}/preview.usda")
    def preview(selection_id: str):
        # Same loopback-only artifact boundary as conversion artifacts. Return
        # the exact checked bytes, avoiding path reopen after integrity checking.
        return Response(invoke(service.preview_bytes, selection_id), media_type="application/octet-stream")

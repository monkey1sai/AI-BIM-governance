"""CFD wind-run job service (building-energy-cfd-p2-contract.md, slice S1).

Mounted on the host-native conversion service (:49101 loopback) by
``host_native_conversion_service.build_app``. It is a new *job type* of that
service, not a new service: the coordinator is the only caller, results are
served from ``/cfd-artifacts/{run_id}/{filename}`` with the same traversal
guards as ``/artifacts``, and every payload follows
``tests/contracts/cfd-run-{request,result,ledger-record}-v1.schema.json``.

Design points that the contract fixes:

* ``CFD_ENABLED`` defaults to false -> every ``/api/cfd-runs`` write returns
  503 ``cfd_disabled`` instead of pretending to work.
* One run at a time (``D5``): a single worker thread drains a FIFO queue so
  the solver never competes with itself for the CPUs Kit also needs.
* A run is bound to one exact ``model.usdc`` (``source.model_usdc_sha256``);
  a mismatch is rejected with 409 ``source_mismatch`` before anything runs.
* The run record stays in this service's job store (owner decision C-1).
* ``purpose`` is always ``design_comparison_only`` (D4).
"""

from __future__ import annotations

import hashlib
import json
import os
import queue
import re
import shutil
import threading
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Mapping, Protocol

# Module-level so FastAPI can resolve the (postponed) ``Request`` annotation of
# the route handlers; a closure-local import would make it a query parameter.
from fastapi import Body, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse

from cfd_options import (
    REQUEST_FIELD_BOUNDS,
    CfdOptions,
    CfdOptionsConfigError,
    build_options_document,
    custom_settings_limitation,
    load_options_config,
    settings_profile,
)

REQUEST_SCHEMA = "cfd-run-request/v1"
STATUS_SCHEMA = "cfd-run-status/v1"
RESULT_SCHEMA = "cfd-run-result/v1"
RUN_RECORD_SCHEMA = "cfd-run-record/v1"
PURPOSE = "design_comparison_only"
PROFILES = ("exterior-wind/v1",)
STATUSES = ("queued", "preprocessing", "meshing", "solving", "postprocessing", "ready", "failed", "cancelled")
TERMINAL_STATUSES = {"ready", "failed", "cancelled"}
FAILURE_CODES = (
    "source_mismatch",
    "preprocess_failed",
    "mesh_failed",
    "solver_failed",
    "postprocess_failed",
    "cancelled",
    "worker_unavailable",
    "cfd_disabled",
)
DEFAULT_IMAGE = "opencfd/openfoam-default:2412"
ESTIMATE_REQUEST_SCHEMA = "cfd-estimate-request/v1"
# S8: compute hard cap per wind direction, checked at submission against the estimate (CFD_MAX_CELLS_PER_DIRECTION).
# The 181 16-direction run peaked at 3.41 M cells; the S6-prerequisite AIJ run used 5.15 M on the dev machine.
DEFAULT_MAX_CELLS_PER_DIRECTION = 8_000_000
_SAFE_RUN_ID = "^cfd_[A-Za-z0-9_]{6,120}$"
_SAFE_FILENAME_CHARS = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-")


# --------------------------------------------------------------------------- config


@dataclass(frozen=True)
class CfdServiceConfig:
    enabled: bool
    image: str
    image_digest: str | None
    n_procs_max: int
    max_directions: int
    artifacts_root: Path
    public_artifacts_url: str
    internal_token: str | None
    max_cells_per_direction: int = DEFAULT_MAX_CELLS_PER_DIRECTION

    @property
    def cpus_cap(self) -> float:
        return float(self.n_procs_max)


def _truthy(value: str | None) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


def load_cfd_config(
    env: Mapping[str, str] | None,
    *,
    default_artifacts_root: Path,
    base_url: str,
    internal_token: str | None,
) -> CfdServiceConfig:
    src = dict(os.environ if env is None else env)

    def _int(name: str, default: int, lo: int, hi: int) -> int:
        try:
            value = int(src.get(name) or default)
        except ValueError:
            value = default
        return min(hi, max(lo, value))

    artifacts_root = Path(src["CFD_ARTIFACTS_ROOT"]) if src.get("CFD_ARTIFACTS_ROOT") else Path(default_artifacts_root) / "cfd"
    return CfdServiceConfig(
        enabled=_truthy(src.get("CFD_ENABLED")),
        image=src.get("CFD_IMAGE") or DEFAULT_IMAGE,
        image_digest=src.get("CFD_IMAGE_DIGEST") or None,
        n_procs_max=_int("CFD_N_PROCS", 8, 1, 64),
        max_directions=_int("CFD_MAX_DIRECTIONS", 16, 1, 16),
        artifacts_root=artifacts_root,
        public_artifacts_url=src.get("CFD_PUBLIC_ARTIFACTS_URL") or f"{base_url.rstrip('/')}/cfd-artifacts",
        internal_token=internal_token,
        max_cells_per_direction=_int("CFD_MAX_CELLS_PER_DIRECTION", DEFAULT_MAX_CELLS_PER_DIRECTION, 100_000, 200_000_000),
    )


# --------------------------------------------------------------------------- errors


class CfdRequestError(ValueError):
    def __init__(self, status_code: int, error_code: str, message: str):
        super().__init__(message)
        self.status_code = status_code
        self.error_code = error_code
        self.message = message


class CfdWorkerUnavailable(RuntimeError):
    pass


# --------------------------------------------------------------------------- request validation


def _num(value: Any, label: str, *, lo: float | None = None, hi: float | None = None, exclusive_lo: bool = False, exclusive_hi: bool = False) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise CfdRequestError(400, "invalid_request", f"{label} must be a number")
    number = float(value)
    if lo is not None and (number < lo or (exclusive_lo and number == lo)):
        raise CfdRequestError(400, "invalid_request", f"{label} below minimum {lo}")
    if hi is not None and (number > hi or (exclusive_hi and number == hi)):
        raise CfdRequestError(400, "invalid_request", f"{label} above maximum {hi}")
    return number


def _int_value(value: Any, label: str, *, lo: int, hi: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise CfdRequestError(400, "invalid_request", f"{label} must be an integer")
    if value < lo or value > hi:
        raise CfdRequestError(400, "invalid_request", f"{label} out of range [{lo}, {hi}]")
    return value


def _str_value(value: Any, label: str, *, max_len: int = 200) -> str:
    if not isinstance(value, str) or not value or len(value) > max_len:
        raise CfdRequestError(400, "invalid_request", f"{label} must be a non-empty string (<= {max_len})")
    return value


def _obj(value: Any, label: str, allowed: set[str]) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise CfdRequestError(400, "invalid_request", f"{label} must be an object")
    extra = set(value) - allowed
    if extra:
        raise CfdRequestError(400, "invalid_request", f"{label} has unknown fields: {sorted(extra)}")
    return value


_default_options: CfdOptions | None = None


def default_options() -> CfdOptions:
    """The versioned ``cfd_options.json`` (loaded once); raises ``CfdOptionsConfigError`` when it is invalid."""
    global _default_options
    if _default_options is None:
        _default_options = load_options_config()
    return _default_options


def _bounded(value: Any, key: str) -> float:
    bounds = REQUEST_FIELD_BOUNDS[key]
    if "exclusive_minimum" in bounds:
        return _num(value, key, lo=bounds["exclusive_minimum"], hi=bounds["maximum"], exclusive_lo=True)
    return _num(value, key, lo=bounds["minimum"], hi=bounds["maximum"])


def _bounded_int(value: Any, key: str) -> int:
    bounds = REQUEST_FIELD_BOUNDS[key]
    return _int_value(value, key, lo=bounds["minimum"], hi=bounds["maximum"])


def validate_run_request(body: Any, *, max_directions: int, n_procs_max: int, options: CfdOptions | None = None) -> dict[str, Any]:
    """Validate a ``cfd-run-request/v1`` body and return it with defaults applied.

    Mirrors ``tests/contracts/cfd-run-request-v1.schema.json``; the contract test
    suite feeds the schema examples through this function to keep them aligned.
    Bounds come from ``cfd_options.REQUEST_FIELD_BOUNDS`` and omitted fields take the
    standard preset of ``cfd_options.json`` (S8), so the options endpoint cannot drift.
    """
    opts = options or default_options()
    top = _obj(body, "body", {"schema", "idempotency_key", "source", "preprocess", "wind", "mesh", "solver", "requested_by"})
    for key in ("schema", "idempotency_key", "source", "preprocess", "wind", "mesh", "solver", "requested_by"):
        if key not in top:
            raise CfdRequestError(400, "invalid_request", f"missing field {key}")
    if top["schema"] != REQUEST_SCHEMA:
        raise CfdRequestError(400, "invalid_request", f"schema must be {REQUEST_SCHEMA}")
    idem = _str_value(top["idempotency_key"], "idempotency_key", max_len=128)
    if len(idem) < 8 or any(ch not in _SAFE_FILENAME_CHARS | {":"} for ch in idem):
        raise CfdRequestError(400, "invalid_request", "idempotency_key must match ^[A-Za-z0-9._:-]{8,128}$")

    source = _obj(top["source"], "source", {"conversion_job_id", "model_usdc_sha256"})
    conversion_job_id = _str_value(source.get("conversion_job_id"), "source.conversion_job_id")
    if any(ch not in _SAFE_FILENAME_CHARS for ch in conversion_job_id):
        raise CfdRequestError(400, "invalid_request", "source.conversion_job_id has illegal characters")
    sha = _str_value(source.get("model_usdc_sha256"), "source.model_usdc_sha256", max_len=64)
    if len(sha) != 64 or any(ch not in "0123456789abcdef" for ch in sha):
        raise CfdRequestError(400, "invalid_request", "source.model_usdc_sha256 must be 64 lowercase hex characters")

    pre = _obj(top["preprocess"], "preprocess", {"profile", "voxel_pitch_m", "closing_radius_voxels", "leak_fraction_limit"})
    if pre.get("profile") not in PROFILES:
        raise CfdRequestError(400, "invalid_request", f"preprocess.profile must be one of {list(PROFILES)}")
    preprocess = {
        "profile": pre["profile"],
        "voxel_pitch_m": _bounded(pre.get("voxel_pitch_m", opts.default("preprocess.voxel_pitch_m")), "preprocess.voxel_pitch_m"),
        "closing_radius_voxels": _bounded_int(pre.get("closing_radius_voxels", opts.default("preprocess.closing_radius_voxels")), "preprocess.closing_radius_voxels"),
        "leak_fraction_limit": _bounded(pre.get("leak_fraction_limit", opts.default("preprocess.leak_fraction_limit")), "preprocess.leak_fraction_limit"),
    }

    wind = _obj(top["wind"], "wind", {"wind_from_degrees", "uref_m_s", "zref_m", "z0_m", "true_north_source", "true_north_degrees_manual"})
    directions = wind.get("wind_from_degrees")
    if not isinstance(directions, list) or not directions:
        raise CfdRequestError(400, "invalid_request", "wind.wind_from_degrees must be a non-empty array")
    if len(directions) > max_directions:
        raise CfdRequestError(400, "invalid_request", f"wind.wind_from_degrees allows at most {max_directions} directions")
    normalized = [_num(d, "wind.wind_from_degrees[]", lo=0.0, hi=360.0, exclusive_hi=True) for d in directions]
    if len(set(normalized)) != len(normalized):
        raise CfdRequestError(400, "invalid_request", "wind.wind_from_degrees must be unique")
    source_mode = wind.get("true_north_source")
    if source_mode not in ("geo_reference", "manual"):
        raise CfdRequestError(400, "invalid_request", "wind.true_north_source must be geo_reference or manual")
    manual = wind.get("true_north_degrees_manual")
    if source_mode == "manual" or manual is not None:
        manual = _bounded(manual, "wind.true_north_degrees_manual")
    wind_doc = {
        "wind_from_degrees": normalized,
        "uref_m_s": _bounded(wind.get("uref_m_s"), "wind.uref_m_s"),
        "zref_m": _bounded(wind.get("zref_m"), "wind.zref_m"),
        "z0_m": _bounded(wind.get("z0_m"), "wind.z0_m"),
        "true_north_source": source_mode,
        "true_north_degrees_manual": manual,
    }

    mesh = _obj(top["mesh"], "mesh", {"background_cell_m", "surface_refinement_level", "region_refinement_level"})
    # An explicit null keeps the automatic cell rule; an omitted key takes the standard preset.
    cell = mesh["background_cell_m"] if "background_cell_m" in mesh else opts.default("mesh.background_cell_m")
    mesh_doc = {
        "background_cell_m": None if cell is None else _bounded(cell, "mesh.background_cell_m"),
        "surface_refinement_level": _bounded_int(mesh.get("surface_refinement_level", opts.default("mesh.surface_refinement_level")), "mesh.surface_refinement_level"),
        "region_refinement_level": _bounded_int(mesh.get("region_refinement_level", opts.default("mesh.region_refinement_level")), "mesh.region_refinement_level"),
    }

    solver = _obj(top["solver"], "solver", {"end_time", "n_procs"})
    solver_doc = {
        "end_time": _bounded_int(solver.get("end_time", opts.default("solver.end_time")), "solver.end_time"),
        "n_procs": min(_bounded_int(solver.get("n_procs", min(8, n_procs_max)), "solver.n_procs"), n_procs_max),
    }

    requested_by = _obj(top["requested_by"], "requested_by", {"principal", "trace_id"})
    requested_doc = {
        "principal": _str_value(requested_by.get("principal"), "requested_by.principal"),
        "trace_id": _str_value(requested_by.get("trace_id"), "requested_by.trace_id"),
    }

    return {
        "schema": REQUEST_SCHEMA,
        "idempotency_key": idem,
        "source": {"conversion_job_id": conversion_job_id, "model_usdc_sha256": sha},
        "preprocess": preprocess,
        "wind": wind_doc,
        "mesh": mesh_doc,
        "solver": solver_doc,
        "requested_by": requested_doc,
    }


def validate_estimate_request(body: Any, *, max_directions: int, n_procs_max: int, options: CfdOptions | None = None) -> dict[str, Any]:
    """``cfd-estimate-request/v1``: a run request without idempotency key, model hash and requester.

    The body is completed with placeholders and validated by ``validate_run_request`` so an estimate
    applies exactly the bounds and defaults a real submission would.
    """
    top = _obj(body, "body", {"schema", "source", "preprocess", "wind", "mesh", "solver"})
    if top.get("schema") != ESTIMATE_REQUEST_SCHEMA:
        raise CfdRequestError(400, "invalid_request", f"schema must be {ESTIMATE_REQUEST_SCHEMA}")
    for key in ("source", "preprocess", "wind"):
        if key not in top:
            raise CfdRequestError(400, "invalid_request", f"missing field {key}")
    source = _obj(top["source"], "source", {"conversion_job_id"})
    full = {
        "schema": REQUEST_SCHEMA,
        "idempotency_key": "estimate-placeholder",
        "source": {"conversion_job_id": source.get("conversion_job_id"), "model_usdc_sha256": "0" * 64},
        "preprocess": top["preprocess"],
        "wind": top["wind"],
        "mesh": top.get("mesh", {}),
        "solver": top.get("solver", {}),
        "requested_by": {"principal": "estimate", "trace_id": "estimate"},
    }
    return validate_run_request(full, max_directions=max_directions, n_procs_max=n_procs_max, options=options)


def estimate_summary(estimate: Mapping[str, Any] | None) -> dict[str, Any]:
    """The part of a ``cfd-estimate/v1`` kept on the run document (traceability of what was shown at submission)."""
    if not estimate or not estimate.get("available"):
        return {"available": False, "reason": (estimate or {}).get("reason") or "estimate_failed"}
    worst = max(estimate["directions"], key=lambda d: d["estimated_cells"])
    return {
        "available": True,
        "geometry_source": estimate["geometry_source"],
        "estimated_cells_total": estimate["totals"]["estimated_cells"],
        "estimated_seconds_total": estimate["totals"]["estimated_seconds"],
        "estimated_cells_max_direction": worst["estimated_cells"],
        "background_cell_m": estimate["background_cell_m"],
    }


# --------------------------------------------------------------------------- store


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def new_run_id(now: datetime | None = None) -> str:
    stamp = (now or datetime.now(timezone.utc)).strftime("%Y%m%dT%H%M%SZ")
    return f"cfd_{stamp}_{uuid.uuid4().hex[:6]}"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


class CfdJobStore:
    """One directory per run under ``root``; ``run.json`` is the status document."""

    def __init__(self, root: Path):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()

    def run_dir(self, run_id: str) -> Path:
        return self.root / run_id

    def _status_path(self, run_id: str) -> Path:
        return self.run_dir(run_id) / "run.json"

    def load(self, run_id: str) -> dict[str, Any] | None:
        # The worker thread rewrites run.json (tmp + replace) while request
        # threads read it; the lock keeps reads off a half-replaced file.
        with self._lock:
            path = self._status_path(run_id)
            if not path.is_file():
                return None
            return json.loads(path.read_text(encoding="utf-8"))

    def save(self, doc: Mapping[str, Any]) -> dict[str, Any]:
        with self._lock:
            run_dir = self.run_dir(str(doc["run_id"]))
            run_dir.mkdir(parents=True, exist_ok=True)
            payload = dict(doc)
            payload["updated_at"] = _utc_now()
            tmp = self._status_path(payload["run_id"]).with_suffix(".json.tmp")
            tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
            tmp.replace(self._status_path(payload["run_id"]))
            return payload

    def update(self, run_id: str, **fields: Any) -> dict[str, Any]:
        with self._lock:
            doc = self.load(run_id)
            if doc is None:
                raise KeyError(run_id)
            doc.update(fields)
            return self.save(doc)

    def list(self, *, status: str | None = None, conversion_job_id: str | None = None, limit: int = 50) -> list[dict[str, Any]]:
        docs = []
        for child in sorted(self.root.iterdir(), reverse=True) if self.root.exists() else []:
            if not child.is_dir():
                continue
            doc = self.load(child.name)
            if doc is None:
                continue
            if status and doc.get("status") != status:
                continue
            if conversion_job_id and doc.get("source", {}).get("conversion_job_id") != conversion_job_id:
                continue
            docs.append(doc)
            if len(docs) >= limit:
                break
        return docs

    def find_by_idempotency_key(self, key: str) -> dict[str, Any] | None:
        for doc in self.list(limit=10_000):
            if doc.get("request", {}).get("idempotency_key") == key:
                return doc
        return None

    def create(self, request: Mapping[str, Any], extra: Mapping[str, Any] | None = None) -> dict[str, Any]:
        with self._lock:
            run_id = new_run_id()
            while self.run_dir(run_id).exists():
                run_id = new_run_id()
            doc = {
                "schema": STATUS_SCHEMA,
                "run_id": run_id,
                "status": "queued",
                "failure_code": None,
                "error": None,
                "progress": {"directions_total": len(request["wind"]["wind_from_degrees"]), "directions_done": 0},
                "sealing_suspect": None,
                "converged_count": 0,
                "cancel_requested": False,
                "current_container": None,
                "created_at": _utc_now(),
                "started_at": None,
                "finished_at": None,
                "request": dict(request),
                "source": dict(request["source"]),
                "requested_by": dict(request["requested_by"]),
                "result_filename": None,
                "purpose": PURPOSE,
            }
            if extra:
                doc.update(dict(extra))
            return self.save(doc)

    def compare_and_set_status(self, run_id: str, expected_status: str, **fields: Any) -> dict[str, Any] | None:
        """Atomically move a run from ``expected_status``; returns None when the run moved on already."""
        with self._lock:
            doc = self.load(run_id)
            if doc is None or doc.get("status") != expected_status:
                return None
            doc.update(fields)
            return self.save(doc)

    def downloadable_filenames(self, run_id: str) -> set[str]:
        """Allowlist for ``/cfd-artifacts``: the files the result document references plus the shell."""
        names = {"run_record.json", "exclusions.json", "shell.stl"}
        result_path = self.run_dir(run_id) / "result.json"
        if result_path.is_file():
            try:
                result = json.loads(result_path.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                result = {}
            for direction in result.get("directions", []) or []:
                layer = direction.get("overlay_layer") or {}
                if isinstance(layer.get("filename"), str):
                    names.add(layer["filename"])
        return names

    def assert_artifact_downloadable(self, run_id: str, candidate: Path) -> None:
        """Mirror of the conversion ``/artifacts`` rule: terminal run, run-root file, allowlisted name.

        ``run.json``/``request.json`` (internal state incl. container names) are
        never served; use the status API instead.
        """
        doc = self.load(run_id)
        if doc is None:
            raise KeyError(run_id)
        run_dir = self.run_dir(run_id).resolve()
        resolved = Path(candidate).resolve()
        resolved.relative_to(run_dir)  # ValueError -> caller maps to 404
        if resolved.parent != run_dir:
            raise ValueError("only run-root files are served")
        if resolved.name not in self.downloadable_filenames(run_id):
            raise ValueError("file is not a published CFD artifact")
        if doc.get("status") not in TERMINAL_STATUSES:
            raise CfdRequestError(409, "not_ready", f"run {run_id} is {doc.get('status')}")


# --------------------------------------------------------------------------- runner


class CfdRunner(Protocol):
    def preflight(self) -> None: ...

    def execute(
        self,
        *,
        run: dict[str, Any],
        run_dir: Path,
        conversion_dir: Path,
        model_usdc: Path,
        progress: Callable[..., None],
        is_cancelled: Callable[[], bool],
    ) -> dict[str, Any]: ...


# CFD Case Run outcome kinds that abort a run (cfd-case-run-adr.md §4), mapped onto the frozen
# ``failure_code`` vocabulary: a case that cannot be written is a meshing failure to the browser, and a
# runner that cannot run is what the generic handler always reported as a solver failure.
_OUTCOME_FAILURE_CODES = {"case_write_failed": "mesh_failed", "runner_failed": "solver_failed", "postprocess_failed": "postprocess_failed"}
SERVICE_STOP_ON = frozenset(_OUTCOME_FAILURE_CODES)


class OpenFoamCfdRunner:
    """The production runner: cfd_pipeline preprocess -> CFD Case Run (case -> docker -> USD overlay -> record)."""

    def __init__(
        self,
        config: CfdServiceConfig,
        *,
        operator: str = "streaming-cfd-job-service",
        run_case_fn: Callable[..., dict[str, Any]] | None = None,
        preflight_fn: Callable[[], None] | None = None,
    ):
        self.config = config
        self.operator = operator
        # CFD Case Run's runner port; None = the Docker adapter (cfd_pipeline.openfoam_case.run_case).
        self.run_case_fn = run_case_fn
        # Replaces the docker/image checks (tests compose the real pipeline over a fake container).
        self.preflight_fn = preflight_fn

    def preflight(self) -> None:
        if self.preflight_fn is not None:
            self.preflight_fn()
            return
        from cfd_pipeline.openfoam_case import image_available, image_digest

        if shutil.which("docker") is None or not image_available(self.config.image):
            raise CfdWorkerUnavailable(f"docker or image {self.config.image} unavailable on this host")
        if self.config.image_digest:
            actual = image_digest(self.config.image) or ""
            if self.config.image_digest not in actual:
                raise CfdWorkerUnavailable(f"image digest mismatch: expected {self.config.image_digest}, got {actual or 'unknown'}")

    def execute(self, *, run, run_dir, conversion_dir, model_usdc, progress, is_cancelled) -> dict[str, Any]:
        from cfd_pipeline.case_run import CaseProgress, CaseRunPorts, CaseRunSpec, run_wind_directions
        from cfd_pipeline.openfoam_case import CaseParams
        from cfd_pipeline.preprocess import run_preprocess
        from cfd_pipeline.wind import true_north_from_geo

        request = run["request"]
        run_id = run["run_id"]
        pre_dir = run_dir / "pre"
        progress(status="preprocessing")
        try:
            stats = run_preprocess(
                model_usdc=model_usdc,
                out_dir=pre_dir,
                profile_id=request["preprocess"]["profile"],
                voxel_pitch_m=request["preprocess"]["voxel_pitch_m"],
                closing_radius_voxels=request["preprocess"]["closing_radius_voxels"],
            )
            shutil.copy(pre_dir / "exclusions.json", run_dir / "exclusions.json")
            shutil.copy(pre_dir / "shell.stl", run_dir / "shell.stl")
        except Exception as exc:  # noqa: BLE001
            raise _StageFailure("preprocess_failed", _bounded_error(exc, run_dir, conversion_dir)) from exc
        shell = stats["shell"]
        leak_limit = float(request["preprocess"]["leak_fraction_limit"])
        sealing_suspect = float(shell.get("leak_fraction", 0.0)) > leak_limit
        progress(sealing_suspect=sealing_suspect)

        geo_path = conversion_dir / "geo_reference.json"
        if request["wind"]["true_north_source"] == "manual":
            true_north, assumptions = normalize_true_north(float(request["wind"]["true_north_degrees_manual"]), ["true_north_manual"])
        else:
            geo_true_north, geo_flags = true_north_from_geo(geo_path if geo_path.exists() else None)
            true_north, assumptions = normalize_true_north(geo_true_north, geo_flags)
        if sealing_suspect:
            assumptions.append("sealing_suspect_accepted")

        specs: list[CaseRunSpec] = []
        for direction in request["wind"]["wind_from_degrees"]:
            tag = f"w{int(round(direction)) % 360:03d}"
            case_dir = run_dir / f"case_{tag}"
            specs.append(
                CaseRunSpec(
                    run_id=run_id,
                    tag=tag,
                    case_dir=case_dir,
                    shell_stl=run_dir / "shell.stl",
                    params=CaseParams(
                        wind_from_degrees=float(direction),
                        true_north_degrees=true_north,
                        uref_m_s=request["wind"]["uref_m_s"],
                        zref_m=request["wind"]["zref_m"],
                        z0_m=request["wind"]["z0_m"],
                        background_cell_m=request["mesh"]["background_cell_m"],
                        surface_refinement_level=request["mesh"]["surface_refinement_level"],
                        region_refinement_level=request["mesh"]["region_refinement_level"],
                        end_time=request["solver"]["end_time"],
                        n_procs=request["solver"]["n_procs"],
                        assumptions=[a for a in assumptions if a.startswith("true_north")],
                    ),
                    image=self.config.image,
                    cpus=min(float(request["solver"]["n_procs"]), self.config.cpus_cap),
                    results_dir=case_dir / "results",
                    model_usdc=model_usdc,
                    conversion_dir=conversion_dir,
                    preprocess_dir=pre_dir,
                    operator=self.operator,
                    conversion_reference=request["source"]["conversion_job_id"],
                    source_ifc_sha256=None,
                )
            )

        directions_out: list[dict[str, Any]] = []
        records: list[dict[str, Any]] = []
        first_record: dict[str, Any] | None = None

        def on_progress(event: CaseProgress) -> None:
            nonlocal first_record
            if event.stage == "meshing":
                progress(status="meshing")
            elif event.stage == "solving":
                progress(status="solving", current_container=event.container)
            elif event.stage == "solver_finished":
                progress(current_container=None)
            elif event.stage == "postprocessing":
                progress(status="postprocessing")
            elif event.stage == "direction_done":
                outcome = event.outcome
                direction = float(outcome.spec.params.wind_from_degrees)
                if outcome.kind == "ready":
                    layer_dst = run_dir / outcome.overlay_layer.name
                    shutil.copy(outcome.overlay_layer, layer_dst)
                    record = outcome.record
                    prims = (outcome.postprocess or {}).get("prims") or {}
                    directions_out.append(
                        {
                            "wind_from_degrees": direction,
                            "status": "ready",
                            "converged_by_residual_control": record["solver"].get("converged_by_residual_control"),
                            "iterations": record["solver"].get("iterations"),
                            "end_time_extended_to": (outcome.run_summary or {}).get("extended_to"),
                            "mesh_cells": (record.get("mesh") or {}).get("cells"),
                            "overlay_layer": {"artifact_id": f"cfd:{run_id}:{outcome.spec.tag}", "filename": layer_dst.name, "sha256": sha256_file(layer_dst)},
                            "pedestrian_1p5m": _pick(prims.get("PedestrianWind_1p5m"), "U_magnitude_max", "polygons"),
                            "building_pressure": _pick(prims.get("BuildingSurfacePressure"), "p_min", "p_max"),
                        }
                    )
                    if first_record is None:
                        first_record = record
                    records.append(_strip_paths({k: record[k] for k in ("case", "mesh", "solver", "outputs") if k in record} | {"wind_from_degrees": direction, "status": "ready"}))
                    progress(directions_done=len(directions_out), converged_count=sum(1 for d in directions_out if d.get("converged_by_residual_control")))
                elif outcome.kind in ("mesh_failed", "solver_failed"):
                    # A container that failed is recorded and the run continues; the reason lives in the run record.
                    directions_out.append(failed_direction_entry(direction))
                    records.append({"wind_from_degrees": direction, "status": "failed", "failure_code": outcome.kind, "docker_exit_code": outcome.exit_code})
                    progress(directions_done=len(directions_out))
                # ``cancelled`` and the SERVICE_STOP_ON kinds end the run right after the loop.

        ports = CaseRunPorts(on_progress=on_progress, should_stop=is_cancelled, **({"run_case_fn": self.run_case_fn} if self.run_case_fn is not None else {}))
        outcomes = run_wind_directions(specs, ports, stop_on=SERVICE_STOP_ON)
        last = outcomes[-1]
        if last.kind == "cancelled":
            raise _Cancelled()
        if last.kind in SERVICE_STOP_ON:
            raise _StageFailure(_OUTCOME_FAILURE_CODES[last.kind], _bounded_error(last.error or RuntimeError(last.message or last.kind), run_dir, conversion_dir))

        first = first_record or {}
        run_record = build_run_record_document(
            run_id=run_id,
            operator=self.operator,
            request=request,
            stats=stats,
            leak_limit=leak_limit,
            sealing_suspect=sealing_suspect,
            first_record=first,
            direction_records=records,
            assumptions=assumptions,
            settings_profile=run.get("settings_profile"),
        )
        (run_dir / "run_record.json").write_text(json.dumps(run_record, ensure_ascii=False, indent=2), encoding="utf-8")

        if not any(d["status"] == "ready" for d in directions_out):
            raise _StageFailure("solver_failed", "no wind direction produced a result")

        exclusions = json.loads((run_dir / "exclusions.json").read_text(encoding="utf-8"))
        return build_result_document(
            run_id=run_id,
            request=request,
            stats=stats,
            leak_limit=leak_limit,
            sealing_suspect=sealing_suspect,
            directions=directions_out,
            run_record_sha256=sha256_file(run_dir / "run_record.json"),
            exclusions_sha256=sha256_file(run_dir / "exclusions.json"),
            exclusion_counts=exclusions.get("counts", {}),
            assumptions=assumptions,
            settings_profile=run.get("settings_profile"),
        )


def normalize_true_north(true_north: float | None, flags: list[str]) -> tuple[float, list[str]]:
    """Map geo_reference flags onto the frozen ``assumptions`` vocabulary.

    Unknown true north (no TrueNorth in the IFC, or no geo_reference.json) is an
    explicit assumption, never a silent zero.
    """
    if "true_north_manual" in flags and true_north is not None:
        return float(true_north), ["true_north_manual"]
    if true_north is None:
        return 0.0, ["true_north_unknown_assumed_project_north"]
    if "true_north_default_direction" in flags:
        return float(true_north), ["true_north_default_direction"]
    return float(true_north), []


def failed_direction_entry(direction: float) -> dict[str, Any]:
    """A failed direction in cfd-run-result/v1 shape (no extra keys; reason lives in run_record)."""
    return {
        "wind_from_degrees": direction,
        "status": "failed",
        "converged_by_residual_control": None,
        "iterations": None,
        "end_time_extended_to": None,
        "mesh_cells": None,
        "overlay_layer": None,
        "pedestrian_1p5m": None,
        "building_pressure": None,
    }


def build_run_record_document(
    *,
    run_id: str,
    operator: str,
    request: Mapping[str, Any],
    stats: Mapping[str, Any],
    leak_limit: float,
    sealing_suspect: bool,
    first_record: Mapping[str, Any],
    direction_records: list[dict[str, Any]],
    assumptions: list[str],
    settings_profile: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    shell = stats.get("shell") or {}
    profile = dict(settings_profile or {})
    return _strip_paths({
        "schema": RUN_RECORD_SCHEMA,
        "run_id": run_id,
        "created_at_utc": _utc_now(),
        "operator": operator,
        "purpose": PURPOSE,
        "source": {
            "conversion_job_id": request["source"]["conversion_job_id"],
            "model_usdc_sha256": request["source"]["model_usdc_sha256"],
            **({"sidecars": first_record.get("source", {}).get("sidecars")} if first_record else {}),
        },
        "geo_reference": first_record.get("geo_reference") if first_record else None,
        "preprocess": {
            "profile": request["preprocess"]["profile"],
            "effective": stats.get("effective"),
            "element_count_total": stats.get("element_count_total"),
            "element_count_kept": stats.get("element_count_kept"),
            "excluded_by_reason": stats.get("excluded_by_reason"),
            "shell": shell,
            "leak_fraction_limit": leak_limit,
            "sealing_suspect": sealing_suspect,
            "appendage_policy": "included",
        },
        "weather": first_record.get("weather") if first_record else None,
        "directions": direction_records,
        # S8: the settings actually used (defaults applied) and how they relate to the verified standard preset.
        "settings": {
            "options_config_version": profile.get("options_config_version"),
            "preset_match": profile.get("preset_match"),
            "custom_fields": list(profile.get("custom_fields") or []),
            "requested": {key: dict(request[key]) for key in ("preprocess", "wind", "mesh", "solver")},
        },
        # Service runs are screening runs: the mesh-convergence and benchmark studies (S5b CLI) are separate documents.
        "validation_level": "screening",
        "assumptions": sorted(set(assumptions)),
        "limitations": _limitations(assumptions, settings_profile),
    })


def build_result_document(
    *,
    run_id: str,
    request: Mapping[str, Any],
    stats: Mapping[str, Any],
    leak_limit: float,
    sealing_suspect: bool,
    directions: list[dict[str, Any]],
    run_record_sha256: str,
    exclusions_sha256: str,
    exclusion_counts: Mapping[str, Any],
    assumptions: list[str],
    settings_profile: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    shell = stats.get("shell") or {}
    return {
        "schema": RESULT_SCHEMA,
        "run_id": run_id,
        "status": "ready",
        "purpose": PURPOSE,
        "source": dict(request["source"]),
        "preprocess": {
            "profile": request["preprocess"]["profile"],
            "closing_radius_voxels": int(stats["effective"]["closing_radius_voxels"]),
            "leak_fraction": float(shell.get("leak_fraction", 0.0)),
            "leak_fraction_limit": leak_limit,
            "sealing_suspect": sealing_suspect,
            "appendage_policy": "included",
        },
        "directions": directions,
        "validation_level": "screening",
        "run_record": {"schema": RUN_RECORD_SCHEMA, "filename": "run_record.json", "sha256": run_record_sha256},
        "exclusions": {"filename": "exclusions.json", "sha256": exclusions_sha256, "counts": dict(exclusion_counts)},
        "assumptions": sorted(set(assumptions)),
        "limitations": _limitations(assumptions, settings_profile),
    }


def _strip_paths(value: Any) -> Any:
    """Replace absolute filesystem paths with their basename (run records are served to browsers)."""
    if isinstance(value, dict):
        return {k: _strip_paths(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_strip_paths(v) for v in value]
    if isinstance(value, str) and (re.match(r"^[A-Za-z]:[\\/]", value) or value.startswith("/") or value.startswith("\\\\")):
        return Path(value).name
    return value


def _bounded_error(exc: BaseException, *roots: Path) -> str:
    """Exception text without host paths, bounded for status documents."""
    text = f"{type(exc).__name__}: {exc}"
    for root in roots:
        text = text.replace(str(root), "<dir>").replace(Path(root).as_posix(), "<dir>")
    text = re.sub(r"[A-Za-z]:[\\/][^\s'\"]+", "<path>", text)
    text = re.sub(r"/(?:[^\s'\"/]+/)+[^\s'\"/]*", "<path>", text)
    return text[:500]


_STAGE_FAILURE_CODES = {
    "preprocessing": "preprocess_failed",
    "meshing": "mesh_failed",
    "solving": "solver_failed",
    "postprocessing": "postprocess_failed",
}


class _StageFailure(RuntimeError):
    def __init__(self, failure_code: str, message: str):
        super().__init__(message)
        self.failure_code = failure_code
        self.message = message


class _Cancelled(RuntimeError):
    pass


def _pick(source: Mapping[str, Any] | None, *keys: str) -> dict[str, Any] | None:
    if not source or any(source.get(k) is None for k in keys):
        return None
    return {k: source[k] for k in keys}


def _limitations(assumptions: list[str], settings_profile: Mapping[str, Any] | None = None) -> list[str]:
    items = [
        "Results are for design comparison only; not a regulatory or certification basis.",
        "Coarse proof-of-concept mesh; no grid-convergence study.",
    ]
    if any(a.startswith("true_north_default") or a.startswith("true_north_unknown") for a in assumptions):
        items.append("Wind direction is relative to project north because the IFC TrueNorth is the default direction or missing.")
    if "sealing_suspect_accepted" in assumptions:
        items.append("Voxel shell leak fraction exceeded the configured limit; interior partly treated as flow domain.")
    custom = custom_settings_limitation(settings_profile)
    if custom:
        items.append(custom)
    return items


# --------------------------------------------------------------------------- service


class CfdJobService:
    """Queue + store + runner; ``install_cfd_routes`` exposes it over HTTP."""

    def __init__(
        self,
        *,
        config: CfdServiceConfig,
        conversion_artifacts_root: Path,
        conversion_lookup: Callable[[str], Mapping[str, Any] | None],
        runner: CfdRunner | None = None,
        run_background: bool = True,
        options: CfdOptions | None = None,
    ):
        self.config = config
        # S8: a broken cfd_options.json disables CFD writes (503 cfd_options_invalid) instead of the whole service.
        self.options: CfdOptions | None = options
        self.options_error: str | None = None
        if self.options is None:
            try:
                self.options = default_options()
            except CfdOptionsConfigError as exc:
                self.options_error = str(exc)
        self.store = CfdJobStore(config.artifacts_root)
        self.conversion_artifacts_root = Path(conversion_artifacts_root)
        self.conversion_lookup = conversion_lookup
        self.runner: CfdRunner = runner or OpenFoamCfdRunner(config)
        self.run_background = run_background
        self._queue: queue.Queue[str] = queue.Queue()
        self._worker: threading.Thread | None = None
        self._worker_lock = threading.Lock()
        # Serialises "find idempotency key -> create" so two concurrent POSTs with the
        # same key cannot both create a run.
        self._create_lock = threading.Lock()
        self.reconciled: dict[str, list[str]] = {"requeued": [], "failed_restart": []}
        self.reconcile_on_start()

    # ----- create / cancel

    def conversion_dir(self, conversion_job_id: str) -> Path:
        return self.conversion_artifacts_root / conversion_job_id

    def reconcile_on_start(self) -> None:
        """Bring the on-disk store back to a consistent state after a service restart.

        Runs left ``queued`` are re-enqueued; runs that were mid-flight have lost
        their worker, so any container is killed and the run is marked failed
        (``worker_unavailable``) instead of staying non-terminal forever.
        """
        for doc in self.store.list(limit=10_000):
            status = doc.get("status")
            if status in TERMINAL_STATUSES:
                continue
            run_id = doc["run_id"]
            if status == "queued":
                self.reconciled["requeued"].append(run_id)
                self._enqueue(run_id)
                continue
            self._kill_current_container(doc)
            self.store.update(
                run_id,
                status="failed",
                failure_code="worker_unavailable",
                error="service restarted while the run was in progress",
                finished_at=_utc_now(),
                current_container=None,
            )
            self.reconciled["failed_restart"].append(run_id)

    def _kill_current_container(self, doc: Mapping[str, Any] | None) -> None:
        name = (doc or {}).get("current_container")
        if not name:
            return
        from cfd_pipeline.openfoam_case import kill_container

        kill_container(str(name))

    def require_options(self) -> CfdOptions:
        if self.options is None:
            raise CfdRequestError(503, "cfd_options_invalid", f"cfd_options.json is invalid: {self.options_error}")
        return self.options

    def options_document(self) -> dict[str, Any]:
        return build_options_document(
            self.require_options(),
            enabled=self.config.enabled,
            max_directions=self.config.max_directions,
            n_procs_max=self.config.n_procs_max,
            max_cells_per_direction=self.config.max_cells_per_direction,
        )

    def _estimate(self, request: Mapping[str, Any]) -> dict[str, Any] | None:
        """``cfd-estimate/v1`` or None when the estimator itself failed (never blocks a run on its own bug)."""
        try:
            # Imported here, inside the guard: a host without numpy must still accept submissions as before S8.
            from cfd_estimate import estimate_run

            return estimate_run(
                request=request,
                conversion_dir=self.conversion_dir(request["source"]["conversion_job_id"]),
                store=self.store,
                options=self.require_options(),
                max_cells_per_direction=self.config.max_cells_per_direction,
            )
        except CfdRequestError:
            raise
        except Exception:  # noqa: BLE001
            return None

    def estimate(self, body: Any) -> dict[str, Any]:
        """``POST /api/cfd-estimates``: read-only; available whether or not CFD writes are enabled."""
        options = self.require_options()
        request = validate_estimate_request(body, max_directions=self.config.max_directions, n_procs_max=self.config.n_procs_max, options=options)
        conversion_job_id = request["source"]["conversion_job_id"]
        if self.conversion_lookup(conversion_job_id) is None:
            raise CfdRequestError(404, "conversion_not_found", "Conversion job not found.")
        if not (self.conversion_dir(conversion_job_id) / "model.usdc").is_file():
            raise CfdRequestError(409, "source_not_ready", "Conversion job has no model.usdc artifact yet.")
        estimate = self._estimate(request)
        if estimate is None:
            estimate = {"schema": "cfd-estimate/v1", "available": False, "is_estimate": True, "reason": "estimate_failed", "geometry_source": None, "geometry_basis_run_id": None, "directions": [], "totals": None, "basis": None,
                        "limits": {"max_cells_per_direction": self.config.max_cells_per_direction, "confirm_cells_per_direction": options.estimate["confirm_cells_per_direction"], "confirm_total_hours": options.estimate["confirm_total_hours"], "exceeds_hard_cap": False, "confirm_required": False, "confirm_reasons": []}}
        # The browser labels custom settings next to the estimate, also when the estimate itself is unavailable.
        estimate["settings_profile"] = settings_profile(request, options)
        return estimate

    def create_run(self, body: Any) -> tuple[dict[str, Any], bool]:
        """Validate, bind to the conversion job, persist and enqueue. Returns (doc, replayed)."""
        if not self.config.enabled:
            raise CfdRequestError(503, "cfd_disabled", "CFD runs are disabled on this host (CFD_ENABLED=false).")
        options = self.require_options()
        request = validate_run_request(body, max_directions=self.config.max_directions, n_procs_max=self.config.n_procs_max, options=options)
        existing = self.store.find_by_idempotency_key(request["idempotency_key"])
        if existing is not None:
            return existing, True
        job = self.conversion_lookup(request["source"]["conversion_job_id"])
        if job is None:
            raise CfdRequestError(404, "conversion_not_found", "Conversion job not found.")
        conversion_dir = self.conversion_dir(request["source"]["conversion_job_id"])
        model_usdc = conversion_dir / "model.usdc"
        if not model_usdc.is_file():
            raise CfdRequestError(409, "source_mismatch", "Conversion job has no model.usdc artifact yet.")
        actual = sha256_file(model_usdc)
        if actual != request["source"]["model_usdc_sha256"]:
            raise CfdRequestError(409, "source_mismatch", "model_usdc_sha256 does not match the conversion artifact.")
        # S8: the compute hard cap is enforced here whenever the model can be estimated; an estimate that cannot be
        # made (no geometry source, estimator error) does not block a run that the contract bounds allow.
        estimate = self._estimate(request)
        if estimate and estimate.get("available") and estimate["limits"]["exceeds_hard_cap"]:
            worst = max(estimate["directions"], key=lambda d: d["estimated_cells"])
            raise CfdRequestError(
                422,
                "compute_cap_exceeded",
                f"estimated {worst['estimated_cells']} cells for wind from {worst['wind_from_degrees']} degrees exceeds "
                f"CFD_MAX_CELLS_PER_DIRECTION={self.config.max_cells_per_direction}; use a larger mesh.background_cell_m",
            )
        extra = {"settings_profile": settings_profile(request, options), "estimate_at_submission": estimate_summary(estimate)}
        try:
            self.runner.preflight()
        except CfdWorkerUnavailable as exc:
            raise CfdRequestError(503, "worker_unavailable", str(exc)) from exc
        with self._create_lock:
            existing = self.store.find_by_idempotency_key(request["idempotency_key"])
            if existing is not None:
                return existing, True
            doc = self.store.create(request, extra=extra)
            (self.store.run_dir(doc["run_id"]) / "request.json").write_text(json.dumps(request, ensure_ascii=False, indent=2), encoding="utf-8")
        self._enqueue(doc["run_id"])
        return self.store.load(doc["run_id"]) or doc, False

    def cancel_run(self, run_id: str) -> dict[str, Any]:
        doc = self.store.load(run_id)
        if doc is None:
            raise CfdRequestError(404, "run_not_found", "CFD run not found.")
        if doc["status"] in TERMINAL_STATUSES:
            return doc
        # queued -> cancelled is a compare-and-set so a worker that just claimed the
        # run cannot be overwritten; if it lost the race we fall through to the
        # cooperative path (flag + kill).
        cancelled = self.store.compare_and_set_status(
            run_id, "queued", status="cancelled", failure_code="cancelled", finished_at=_utc_now(), cancel_requested=True
        )
        if cancelled is not None:
            return cancelled
        doc = self.store.update(run_id, cancel_requested=True)
        self._kill_current_container(doc)
        return doc

    # ----- execution

    def _enqueue(self, run_id: str) -> None:
        if not self.run_background:
            self.process_run(run_id)
            return
        self._queue.put(run_id)
        with self._worker_lock:
            if self._worker is None or not self._worker.is_alive():
                self._worker = threading.Thread(target=self._drain, name="cfd-job-worker", daemon=True)
                self._worker.start()

    def _drain(self) -> None:
        # Daemon thread; blocks forever so there is no idle-exit race between a
        # worker that just timed out and a producer that just enqueued.
        while True:
            run_id = self._queue.get()
            try:
                self.process_run(run_id)
            finally:
                self._queue.task_done()

    def process_run(self, run_id: str) -> dict[str, Any]:
        doc = self.store.load(run_id)
        if doc is None or doc["status"] != "queued":
            return doc or {}
        if doc.get("cancel_requested"):
            return self.store.compare_and_set_status(run_id, "queued", status="cancelled", failure_code="cancelled", finished_at=_utc_now()) or (self.store.load(run_id) or {})
        claimed = self.store.compare_and_set_status(run_id, "queued", status="preprocessing", started_at=_utc_now())
        if claimed is None:  # cancelled (or claimed elsewhere) between load and claim
            return self.store.load(run_id) or {}
        doc = claimed
        run_dir = self.store.run_dir(run_id)
        conversion_dir = self.conversion_dir(doc["source"]["conversion_job_id"])

        def progress(**fields: Any) -> None:
            if "directions_done" in fields:
                current = self.store.load(run_id) or {}
                prog = dict(current.get("progress") or {})
                prog["directions_done"] = fields.pop("directions_done")
                fields["progress"] = prog
            self.store.update(run_id, **fields)

        def is_cancelled() -> bool:
            current = self.store.load(run_id) or {}
            return bool(current.get("cancel_requested"))

        try:
            result = self.runner.execute(
                run=self.store.load(run_id) or doc,
                run_dir=run_dir,
                conversion_dir=conversion_dir,
                model_usdc=conversion_dir / "model.usdc",
                progress=progress,
                is_cancelled=is_cancelled,
            )
        except _Cancelled:
            self._kill_current_container(self.store.load(run_id))
            return self.store.update(run_id, status="cancelled", failure_code="cancelled", finished_at=_utc_now(), current_container=None)
        except _StageFailure as exc:
            self._kill_current_container(self.store.load(run_id))
            return self.store.update(run_id, status="failed", failure_code=exc.failure_code, error=exc.message, finished_at=_utc_now(), current_container=None)
        except CfdWorkerUnavailable as exc:
            self._kill_current_container(self.store.load(run_id))
            return self.store.update(run_id, status="failed", failure_code="worker_unavailable", error=_bounded_error(exc, run_dir, conversion_dir), finished_at=_utc_now(), current_container=None)
        except Exception as exc:  # noqa: BLE001 - never leave a run stuck in a running state
            current = self.store.load(run_id) or {}
            self._kill_current_container(current)
            failure_code = _STAGE_FAILURE_CODES.get(str(current.get("status")), "solver_failed")
            return self.store.update(run_id, status="failed", failure_code=failure_code, error=_bounded_error(exc, run_dir, conversion_dir), finished_at=_utc_now(), current_container=None)

        (run_dir / "result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        converged = sum(1 for d in result.get("directions", []) if d.get("converged_by_residual_control"))
        done = sum(1 for d in result.get("directions", []) if d.get("status") == "ready")
        current = self.store.load(run_id) or doc
        prog = dict(current.get("progress") or {})
        prog["directions_done"] = done
        return self.store.update(
            run_id,
            status="ready",
            finished_at=_utc_now(),
            result_filename="result.json",
            converged_count=converged,
            progress=prog,
            sealing_suspect=result.get("preprocess", {}).get("sealing_suspect"),
            current_container=None,
        )

    # ----- read models

    def status_view(self, doc: Mapping[str, Any]) -> dict[str, Any]:
        view = {k: v for k, v in doc.items() if k not in ("current_container",)}
        return view

    def result_view(self, run_id: str) -> dict[str, Any]:
        doc = self.store.load(run_id)
        if doc is None:
            raise CfdRequestError(404, "run_not_found", "CFD run not found.")
        if doc["status"] == "ready":
            result = json.loads((self.store.run_dir(run_id) / "result.json").read_text(encoding="utf-8"))
            for direction in result.get("directions", []):
                layer = direction.get("overlay_layer")
                if layer:
                    layer["url"] = f"{self.config.public_artifacts_url.rstrip('/')}/{run_id}/{layer['filename']}"
            for key in ("run_record", "exclusions"):
                if result.get(key):
                    result[key]["url"] = f"{self.config.public_artifacts_url.rstrip('/')}/{run_id}/{result[key]['filename']}"
            return result
        if doc["status"] in TERMINAL_STATUSES:
            raise CfdRequestError(409, doc.get("failure_code") or "not_ready", doc.get("error") or f"run is {doc['status']}")
        raise CfdRequestError(409, "not_ready", f"run is {doc['status']}")


# --------------------------------------------------------------------------- routes


def install_cfd_routes(
    app: Any,
    *,
    config: CfdServiceConfig,
    conversion_artifacts_root: Path,
    conversion_lookup: Callable[[str], Mapping[str, Any] | None],
    runner: CfdRunner | None = None,
    run_background: bool = True,
) -> CfdJobService:
    service = CfdJobService(
        config=config,
        conversion_artifacts_root=conversion_artifacts_root,
        conversion_lookup=conversion_lookup,
        runner=runner,
        run_background=run_background,
    )
    app.state.cfd_service = service

    def _error(exc: CfdRequestError) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content={"error_code": exc.error_code, "detail": exc.message})

    def _check_token(request: Request) -> JSONResponse | None:
        expected = config.internal_token
        if not expected:
            return None
        actual = request.headers.get("X-Internal-Conversion-Token")
        if not actual:
            return JSONResponse(status_code=401, content={"error_code": "missing_token", "detail": "Missing internal conversion token."})
        if actual != expected:
            return JSONResponse(status_code=403, content={"error_code": "invalid_token", "detail": "Invalid internal conversion token."})
        return None

    @app.post("/api/cfd-runs", status_code=202)
    def create_cfd_run(request: Request, body: dict[str, Any] = Body(...)):
        denied = _check_token(request)
        if denied is not None:
            return denied
        try:
            doc, replayed = service.create_run(body)
        except CfdRequestError as exc:
            return _error(exc)
        payload = service.status_view(doc)
        payload["idempotent_replay"] = replayed
        return JSONResponse(status_code=202 if not replayed else 200, content=payload)

    @app.get("/api/cfd-options")
    def get_cfd_options():
        # S8: defaults, bounds, presets and limits for the browser form (read-only; also when CFD writes are disabled).
        try:
            return service.options_document()
        except CfdRequestError as exc:
            return _error(exc)

    @app.post("/api/cfd-estimates")
    def create_cfd_estimate(body: dict[str, Any] = Body(...)):
        # S8: read-only cell/time estimate; the same bounds and defaults as a submission, nothing is stored.
        try:
            return service.estimate(body)
        except CfdRequestError as exc:
            return _error(exc)

    @app.get("/api/cfd-runs")
    def list_cfd_runs(status: str | None = None, conversion_job_id: str | None = None, limit: int = 50):
        if status is not None and status not in STATUSES:
            return JSONResponse(status_code=400, content={"error_code": "invalid_request", "detail": f"unknown status {status}"})
        items = [service.status_view(doc) for doc in service.store.list(status=status, conversion_job_id=conversion_job_id, limit=max(1, min(limit, 500)))]
        return {"items": items, "count": len(items), "enabled": config.enabled}

    @app.get("/api/cfd-runs/{run_id}")
    def get_cfd_run(run_id: str):
        doc = service.store.load(run_id) if _safe_run_id(run_id) else None
        if doc is None:
            raise HTTPException(status_code=404, detail="CFD run not found.")
        return service.status_view(doc)

    @app.get("/api/cfd-runs/{run_id}/result")
    def get_cfd_run_result(run_id: str):
        if not _safe_run_id(run_id):
            raise HTTPException(status_code=404, detail="CFD run not found.")
        try:
            return service.result_view(run_id)
        except CfdRequestError as exc:
            return _error(exc)

    @app.get("/api/cfd-runs/{run_id}/exclusions")
    def get_cfd_run_exclusions(run_id: str):
        doc = service.store.load(run_id) if _safe_run_id(run_id) else None
        if doc is None:
            raise HTTPException(status_code=404, detail="CFD run not found.")
        path = service.store.run_dir(run_id) / "exclusions.json"
        if not path.is_file():
            return JSONResponse(status_code=409, content={"error_code": "not_ready", "detail": "exclusion list not produced yet"})
        return json.loads(path.read_text(encoding="utf-8"))

    @app.post("/api/cfd-runs/{run_id}/cancel")
    def cancel_cfd_run(request: Request, run_id: str):
        denied = _check_token(request)
        if denied is not None:
            return denied
        if not _safe_run_id(run_id):
            raise HTTPException(status_code=404, detail="CFD run not found.")
        try:
            return service.status_view(service.cancel_run(run_id))
        except CfdRequestError as exc:
            return _error(exc)

    root = Path(config.artifacts_root).resolve()
    root.mkdir(parents=True, exist_ok=True)

    @app.get("/cfd-artifacts/{run_id}/{filename}")
    def serve_cfd_artifact(run_id: str, filename: str):
        if not _safe_run_id(run_id) or not filename or any(ch not in _SAFE_FILENAME_CHARS for ch in filename) or filename in (".", ".."):
            raise HTTPException(status_code=404)
        run_dir = (root / run_id).resolve()
        candidate = (run_dir / filename).resolve()
        try:
            run_dir.relative_to(root)
            candidate.relative_to(run_dir)
        except ValueError:
            raise HTTPException(status_code=404)
        if not candidate.is_file():
            raise HTTPException(status_code=404)
        try:
            service.store.assert_artifact_downloadable(run_id, candidate)
        except CfdRequestError as exc:
            return _error(exc)
        except (KeyError, ValueError):
            raise HTTPException(status_code=404)
        return FileResponse(str(candidate))

    return service


def _safe_run_id(value: str) -> bool:
    return bool(re.fullmatch(_SAFE_RUN_ID, value or ""))

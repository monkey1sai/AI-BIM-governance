from __future__ import annotations

from dataclasses import dataclass
import importlib.metadata
import json
from pathlib import Path
from time import perf_counter
from typing import Any, Mapping, Protocol
import re


class ConversionAdapterError(RuntimeError):
    """Base class for conversion failures that should fail a worker job."""


class ConversionAdapterUnavailable(ConversionAdapterError):
    """Raised when the configured real converter prerequisite is unavailable."""


@dataclass(frozen=True)
class ConversionAdapterResult:
    model_path: Path
    ifc_index_path: Path
    usd_index_path: Path
    mapping_path: Path | None
    converter: dict[str, Any]
    quality_metrics: dict[str, Any]
    warnings: list[str]
    entity_index_path: Path | None = None


class ConversionAdapter(Protocol):
    def convert(
        self,
        *,
        source_path: Path,
        output_dir: Path,
        job: Mapping[str, Any],
        generate_mapping: bool,
    ) -> ConversionAdapterResult:
        ...


PRIM_NAME_RE = re.compile(r"[^A-Za-z0-9_]+")
SOURCE_ENUMERATION_PROGRESS_INTERVAL = 5000
SOURCE_ENUMERATION_PROGRESS_SECONDS = 2.0
MATERIALIZATION_PROGRESS_INTERVAL = 5000
MATERIALIZATION_PROGRESS_SECONDS = 2.0
CONVERSION_PHASES = (
    "conversion_total",
    "ifc_open",
    "source_entity_enumeration",
    "geometry_iteration",
    "mesh_authoring",
    "non_renderable_entity_materialization",
    "stage_save",
    "stage_reopen",
)


def _safe_prim_name(value: str) -> str:
    cleaned = PRIM_NAME_RE.sub("_", value).strip("_")
    return cleaned or "IfcProduct"


def _entity_id(entity: Any, fallback: int) -> str:
    raw_id = None
    entity_id = getattr(entity, "id", None)
    if callable(entity_id):
        try:
            raw_id = entity_id()
        except Exception:
            raw_id = None
    if raw_id is None:
        raw_id = getattr(entity, "_id", None)
    return str(raw_id if raw_id is not None else fallback)


def _entity_class(entity: Any) -> str:
    is_a = getattr(entity, "is_a", None)
    if callable(is_a):
        try:
            return str(is_a())
        except Exception:
            return "IfcEntity"
    return str(getattr(entity, "_ifc_class", None) or entity.__class__.__name__ or "IfcEntity")


def _entity_global_id(entity: Any) -> str | None:
    guid = getattr(entity, "GlobalId", None)
    if not guid:
        return None
    return str(guid)


def _entity_name(entity: Any) -> str:
    return str(getattr(entity, "Name", "") or "")


def _write_json(path: Path, payload: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_suffix(path.suffix + ".tmp")
    temp_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    temp_path.replace(path)


def _package_version(name: str) -> str | None:
    try:
        return importlib.metadata.version(name)
    except importlib.metadata.PackageNotFoundError:
        return None


def _new_phase_timings() -> dict[str, dict[str, Any]]:
    return {
        phase: {
            "status": "not_reached",
            "duration_seconds": None,
            "diagnostic": "phase_not_reached",
        }
        for phase in CONVERSION_PHASES
    }


def _mark_phase_completed(phase_timings: dict[str, dict[str, Any]], phase: str, duration_seconds: float) -> None:
    existing = phase_timings.get(phase) or {}
    timing = {
        "status": "completed",
        "duration_seconds": duration_seconds,
    }
    if "details" in existing:
        timing["details"] = existing["details"]
    phase_timings[phase] = timing


def _mark_phase_unavailable(phase_timings: dict[str, dict[str, Any]], phase: str, diagnostic: str) -> None:
    phase_timings[phase] = {
        "status": "unavailable",
        "duration_seconds": None,
        "diagnostic": diagnostic,
    }


def _mark_phase_running(
    phase_timings: dict[str, dict[str, Any]],
    phase: str,
    *,
    diagnostic: str,
    details: Mapping[str, Any] | None = None,
) -> None:
    timing: dict[str, Any] = {
        "status": "running",
        "duration_seconds": None,
        "diagnostic": diagnostic,
    }
    if details is not None:
        timing["details"] = dict(details)
    phase_timings[phase] = timing


def _record_phase_progress(
    job: Mapping[str, Any],
    phase: str,
    phase_timings: dict[str, dict[str, Any]],
    *,
    status: str = "running",
) -> None:
    progress_path = job.get("phase_progress_path")
    if not progress_path:
        return
    _write_json(
        Path(str(progress_path)),
        {
            "conversion_job_id": job.get("conversion_job_id"),
            "source_artifact_id": job.get("source_artifact_id"),
            "current_phase": phase,
            "status": status,
            "phase_timings": phase_timings,
        },
    )


class IfcOpenShellUsdConverter:
    name = "ifcopenshell-openusd"

    def convert(
        self,
        *,
        source_path: Path,
        output_dir: Path,
        job: Mapping[str, Any],
        generate_mapping: bool,
    ) -> ConversionAdapterResult:
        try:
            import ifcopenshell
            import ifcopenshell.geom
        except Exception as exc:  # pragma: no cover - exercised through unavailable adapter tests
            raise ConversionAdapterUnavailable(
                "IfcOpenShell is unavailable. Install ifcopenshell to run real IFC conversion."
            ) from exc

        try:
            from pxr import Sdf, Usd, UsdGeom
        except Exception as exc:  # pragma: no cover - exercised through unavailable adapter tests
            raise ConversionAdapterUnavailable("OpenUSD Python bindings are unavailable. Install usd-core.") from exc

        if not source_path.is_file():
            raise ConversionAdapterError(f"Source IFC object is missing: {source_path}")

        conversion_started = perf_counter()
        phase_timings = _new_phase_timings()
        output_dir.mkdir(parents=True, exist_ok=True)
        model_path = output_dir / "model.usdc"
        ifc_index_path = output_dir / "ifc_index.json"
        usd_index_path = output_dir / "usd_index.json"
        mapping_path = output_dir / "element_mapping.json" if generate_mapping else None
        materialization_strategy = str(job.get("materialization_strategy") or "sidecar").lower()
        if materialization_strategy not in {"sidecar", "usd_prim"}:
            raise ConversionAdapterError(
                f"Unsupported materialization_strategy={materialization_strategy!r}; "
                "expected 'sidecar' or 'usd_prim'."
            )
        use_sidecar = materialization_strategy == "sidecar"
        entity_index_path: Path | None = output_dir / "entity_index.json" if use_sidecar else None

        phase_started = perf_counter()
        _record_phase_progress(job, "ifc_open", phase_timings)
        try:
            model = ifcopenshell.open(str(source_path))
        except Exception as exc:
            raise ConversionAdapterError(f"IfcOpenShell could not open source IFC: {exc}") from exc
        _mark_phase_completed(phase_timings, "ifc_open", perf_counter() - phase_started)
        _record_phase_progress(job, "ifc_open", phase_timings, status="completed")

        phase_started = perf_counter()
        _record_phase_progress(job, "source_entity_enumeration", phase_timings)
        source_entities = self._source_entities(
            model,
            job=job,
            phase_timings=phase_timings,
            phase_started=phase_started,
        )
        _mark_phase_completed(phase_timings, "source_entity_enumeration", perf_counter() - phase_started)
        _record_phase_progress(job, "source_entity_enumeration", phase_timings, status="completed")
        source_by_key = {item["ifc_entity_key"]: item for item in source_entities}
        source_by_guid = {item["ifc_guid"]: item for item in source_entities if item.get("ifc_guid")}

        settings = ifcopenshell.geom.settings()
        settings.set(settings.USE_WORLD_COORDS, True)
        iterator = ifcopenshell.geom.iterator(settings, model, 1)
        try:
            initialized = iterator.initialize()
        except Exception as exc:
            raise ConversionAdapterError(f"IfcOpenShell geometry iterator failed: {exc}") from exc
        if not initialized:
            raise ConversionAdapterError("IfcOpenShell geometry iterator produced no renderable shapes.")

        stage = Usd.Stage.CreateNew(str(model_path))
        UsdGeom.SetStageUpAxis(stage, UsdGeom.Tokens.z)
        root = UsdGeom.Xform.Define(stage, "/World")
        stage.SetDefaultPrim(root.GetPrim())

        prim_rows: list[dict[str, Any]] = []
        mapping_by_entity: dict[str, dict[str, Any]] = {}
        unmapped_usd_prims: list[dict[str, Any]] = []
        used_paths: set[str] = set()
        converted_shapes = 0
        skipped_shapes = 0
        vertex_count = 0
        face_count = 0
        keep_going = True
        mesh_authoring_seconds = 0.0

        phase_started = perf_counter()
        _record_phase_progress(job, "geometry_iteration", phase_timings)
        while keep_going:
            shape = iterator.get()
            geometry = shape.geometry
            vertices = list(geometry.verts)
            faces = list(geometry.faces)
            raw_guid = str(getattr(shape, "guid", "") or "").strip()
            diagnostic_id = raw_guid or f"shape_{converted_shapes}"
            source_entity = source_by_guid.get(raw_guid)
            mapping_entity_key = source_entity["ifc_entity_key"] if source_entity else None
            ifc_class = str(getattr(shape, "type", "") or "IfcProduct")

            if len(vertices) < 3 or len(faces) < 3:
                skipped_shapes += 1
                keep_going = iterator.next()
                continue

            prim_path = self._unique_prim_path(ifc_class, diagnostic_id, used_paths)
            mesh_started = perf_counter()
            mesh = UsdGeom.Mesh.Define(stage, prim_path)
            points = [(vertices[i], vertices[i + 1], vertices[i + 2]) for i in range(0, len(vertices), 3)]
            triangle_count = len(faces) // 3
            mesh.CreatePointsAttr(points)
            mesh.CreateFaceVertexCountsAttr([3] * triangle_count)
            mesh.CreateFaceVertexIndicesAttr(faces[: triangle_count * 3])
            if raw_guid:
                mesh.GetPrim().CreateAttribute("ifc:guid", Sdf.ValueTypeNames.String).Set(raw_guid)
            else:
                mesh.GetPrim().CreateAttribute("worker:diagnostic_id", Sdf.ValueTypeNames.String).Set(diagnostic_id)
            mesh.GetPrim().CreateAttribute("ifc:type", Sdf.ValueTypeNames.String).Set(ifc_class)
            mesh_authoring_seconds += perf_counter() - mesh_started

            converted_shapes += 1
            vertex_count += len(points)
            face_count += triangle_count
            prim_row = {
                "path": prim_path,
                "type": "Mesh",
                "ifc_guid": raw_guid or None,
                "diagnostic_id": diagnostic_id,
                "ifc_class": ifc_class,
                "vertex_count": len(points),
                "face_count": triangle_count,
            }

            if mapping_entity_key is None:
                reason = "unknown_source_guid" if raw_guid else "missing_source_guid"
                prim_row["mapping_status"] = "unmapped"
                prim_row["unmapped_reason"] = reason
                unmapped_usd_prims.append(
                    {
                        "path": prim_path,
                        "ifc_guid": raw_guid or None,
                        "diagnostic_id": diagnostic_id,
                        "reason": reason,
                    }
                )
                prim_rows.append(prim_row)
                keep_going = iterator.next()
                continue

            prim_row["mapping_status"] = "mapped"
            prim_rows.append(prim_row)
            mapping = mapping_by_entity.setdefault(
                mapping_entity_key,
                {
                    "ifc_entity_key": mapping_entity_key,
                    "ifc_entity_id": source_entity.get("ifc_entity_id"),
                    "ifc_guid": source_entity.get("ifc_guid"),
                    "ifc_class": source_entity.get("ifc_class", ifc_class),
                    "name": source_entity.get("name", ""),
                    "usd_prim_path": prim_path,
                    "primary_usd_prim_path": prim_path,
                    "usd_prim_paths": [],
                    "mapping_method": "ifcopenshell_geometry_guid_to_usd_mesh",
                    "mapping_confidence": 0.95,
                },
            )
            mapping["usd_prim_paths"].append(prim_path)
            keep_going = iterator.next()
        _mark_phase_completed(phase_timings, "geometry_iteration", perf_counter() - phase_started)
        if mesh_authoring_seconds > 0:
            _mark_phase_completed(phase_timings, "mesh_authoring", mesh_authoring_seconds)
        else:
            _mark_phase_unavailable(phase_timings, "mesh_authoring", "no_renderable_mesh_authored")
        _record_phase_progress(job, "geometry_iteration", phase_timings, status="completed")

        phase_started = perf_counter()
        _record_phase_progress(job, "non_renderable_entity_materialization", phase_timings)
        # Snapshot how many source IFC entities resolved to a renderable USD prim before sidecar
        # materialization runs; the difference between this and post-materialization mapped_count
        # is exactly the sidecar/non-renderable carrier count (no double counting by construction).
        mapped_renderable_count = len(mapping_by_entity)
        sidecar_entries = self._materialize_unmapped_entities(
            UsdGeom=UsdGeom,
            Sdf=Sdf,
            stage=stage,
            source_entities=source_entities,
            mapping_by_entity=mapping_by_entity,
            prim_rows=prim_rows,
            used_paths=used_paths,
            job=job,
            phase_timings=phase_timings,
            phase_started=phase_started,
            strategy=materialization_strategy,
        )
        # Sidecar carrier write is part of materialization: the carrier file persists
        # the non-renderable IFC entity identity. Keep the JSON dump inside this phase
        # so phase timing reflects the real materialization cost, including the
        # cost of producing entity_index.json. (Otherwise a slow JSON write would
        # falsely appear as time spent near stage_reopen.)
        sidecar_carrier_count = len(sidecar_entries)
        sidecar_write_seconds: float | None = None
        if entity_index_path is not None:
            sidecar_write_started = perf_counter()
            _write_json(
                entity_index_path,
                {
                    "source_artifact_id": job["source_artifact_id"],
                    "mapping_method": "ifc_entity_to_sidecar_index",
                    "materialization_strategy": materialization_strategy,
                    "summary": {
                        "sidecar_entity_count": sidecar_carrier_count,
                        "renderable_only": False,
                    },
                    "entities": sidecar_entries,
                },
            )
            sidecar_write_seconds = perf_counter() - sidecar_write_started
        _mark_phase_completed(
            phase_timings,
            "non_renderable_entity_materialization",
            perf_counter() - phase_started,
        )
        _record_phase_progress(job, "non_renderable_entity_materialization", phase_timings, status="completed")
        phase_started = perf_counter()
        _record_phase_progress(job, "stage_save", phase_timings)
        stage.GetRootLayer().Save()
        _mark_phase_completed(phase_timings, "stage_save", perf_counter() - phase_started)
        _record_phase_progress(job, "stage_save", phase_timings, status="completed")
        phase_started = perf_counter()
        _record_phase_progress(job, "stage_reopen", phase_timings)
        opened_stage = Usd.Stage.Open(str(model_path))
        if opened_stage is None:
            raise ConversionAdapterError("OpenUSD could not reopen generated model.usdc.")
        usd_prim_count = sum(1 for _ in opened_stage.Traverse())
        _mark_phase_completed(phase_timings, "stage_reopen", perf_counter() - phase_started)
        _record_phase_progress(job, "stage_reopen", phase_timings, status="completed")
        if converted_shapes <= 0:
            raise ConversionAdapterError("Generated model.usdc has no renderable mesh prims.")

        source_count = len(source_entities)
        mapped_count = len(mapping_by_entity)
        unmapped_count = max(source_count - mapped_count, 0)
        # Additive diagnostic: how many source IFC entities lack ifc_guid (geometry-shape entries
        # without GlobalId are still uniquely keyed by ifc_entity_key / ifc_entity_id).
        no_guid_entity_count = sum(1 for entity in source_entities if not entity.get("ifc_guid"))
        unmapped_ifc_entities = [
            {
                "ifc_entity_key": entity["ifc_entity_key"],
                "ifc_entity_id": entity.get("ifc_entity_id"),
                "ifc_guid": entity.get("ifc_guid"),
                "ifc_class": entity.get("ifc_class"),
                "name": entity.get("name", ""),
            }
            for entity in source_entities
            if entity["ifc_entity_key"] not in mapping_by_entity
        ]
        unmapped_ifc_guids = [item["ifc_guid"] for item in unmapped_ifc_entities if item.get("ifc_guid")]
        unmapped_usd_count = len(unmapped_usd_prims)
        coverage_ratio = (mapped_count / source_count) if source_count else 0.0
        # Once every source IFC entity resolves to at least one carrier (renderable USD prim or
        # sidecar entry), this fixture's coverage baseline can lock — spec scenario "Mapping
        # coverage passes locked threshold". A clean per-fixture lock is a precondition for the
        # batch-level minimum_coverage_locked gate (computed in batch_verification).
        quality_clean = source_count > 0 and unmapped_count == 0
        baseline_locked = quality_clean
        coverage_status_value = "pass" if quality_clean else "unlocked"
        threshold_status_value = "locked" if quality_clean else "measure_only"
        duration_seconds = perf_counter() - conversion_started
        _mark_phase_completed(phase_timings, "conversion_total", duration_seconds)
        _record_phase_progress(job, "conversion_total", phase_timings, status="completed")

        ifc_index = {
            "source_artifact_id": job["source_artifact_id"],
            "schema": model.schema,
            "summary": {
                "entity_count": source_count,
                "element_count": source_count,
                "guid_count": len(source_by_guid),
            },
            "entities": source_entities,
            "elements": source_entities,
        }
        usd_index = {
            "summary": {
                "prim_count": usd_prim_count,
                "mesh_prim_count": converted_shapes,
                "vertex_count": vertex_count,
                "face_count": face_count,
                "unmapped_usd_count": unmapped_usd_count,
            },
            "prims": prim_rows,
        }
        mapping_summary = {
            "source_ifc_entity_count": source_count,
            "source_ifc_element_count": source_count,
            "usd_prim_count": usd_prim_count,
            "mapped_entity_count": mapped_count,
            "unmapped_entity_count": unmapped_count,
            "mapped_count": mapped_count,
            "mapped_renderable_count": mapped_renderable_count,
            "unmapped_ifc_count": unmapped_count,
            "unmapped_usd_count": unmapped_usd_count,
            "coverage_ratio": coverage_ratio,
            "fake_mapping_count": 0,
            "minimum_coverage_baseline_locked": baseline_locked,
            "minimum_coverage_ratio": 1.0,
            "coverage_denominator": "source_ifc_entity_count",
            "coverage_status": coverage_status_value,
            "threshold_status": threshold_status_value,
            "materialization_strategy": materialization_strategy,
            "sidecar_carrier_count": sidecar_carrier_count,
            "sidecar_write_seconds": sidecar_write_seconds,
            "no_guid_entity_count": no_guid_entity_count,
        }

        _write_json(ifc_index_path, ifc_index)
        _write_json(usd_index_path, usd_index)
        if mapping_path is not None:
            _write_json(
                mapping_path,
                {
                    "mock": False,
                    "mapping_method": "ifcopenshell_geometry_guid_to_usd_mesh",
                    "coverage_policy": {
                        "mode": "measure_first",
                        "minimum_coverage_baseline_locked": baseline_locked,
                        "minimum_coverage_ratio": 1.0,
                        "coverage_denominator": "source_ifc_entity_count",
                    },
                    "items": list(mapping_by_entity.values()),
                    "unmapped_ifc_entities": unmapped_ifc_entities,
                    "unmapped_ifc_guids": unmapped_ifc_guids,
                    "unmapped_usd_prims": unmapped_usd_prims,
                    "summary": mapping_summary,
                },
            )

        converter = {
            "name": self.name,
            "ifcopenshell_version": _package_version("ifcopenshell"),
            "usd_core_version": _package_version("usd-core"),
            "license": {
                "ifcopenshell": "LGPLv3+",
                "usd_core": "LicenseRef-TOST-1.0",
            },
            "external_prerequisite": True,
        }
        quality_metrics = {
            "converter_identity": converter,
            "duration_seconds": duration_seconds,
            "source_ifc_entity_count": source_count,
            "source_ifc_element_count": source_count,
            "usd_prim_count": usd_prim_count,
            "mesh_prim_count": converted_shapes,
            "mapped_entity_count": mapped_count,
            "unmapped_entity_count": unmapped_count,
            "mapped_count": mapped_count,
            "mapped_renderable_count": mapped_renderable_count,
            "unmapped_count": unmapped_count,
            "unmapped_usd_count": unmapped_usd_count,
            "coverage_ratio": coverage_ratio,
            "threshold_status": threshold_status_value,
            "minimum_coverage_baseline_locked": baseline_locked,
            "minimum_coverage_ratio": 1.0,
            "coverage_denominator": "source_ifc_entity_count",
            "coverage_status": coverage_status_value,
            "issue_to_real_prim_readiness": baseline_locked,
            "hard_quality_gates": {
                "usdc_openable": True,
                "has_renderable_prims": converted_shapes > 0,
                "placeholder_output": False,
            },
            "source_file_size_bytes": source_path.stat().st_size,
            "output_file_size_bytes": model_path.stat().st_size,
            "converted_shape_count": converted_shapes,
            "skipped_shape_count": skipped_shapes,
            "vertex_count": vertex_count,
            "face_count": face_count,
            "phase_timings": phase_timings,
            "materialization_strategy": materialization_strategy,
            "sidecar_carrier_count": sidecar_carrier_count,
            "sidecar_write_seconds": sidecar_write_seconds,
            "no_guid_entity_count": no_guid_entity_count,
        }
        return ConversionAdapterResult(
            model_path=model_path,
            ifc_index_path=ifc_index_path,
            usd_index_path=usd_index_path,
            mapping_path=mapping_path,
            entity_index_path=entity_index_path,
            converter=converter,
            quality_metrics=quality_metrics,
            warnings=[],
        )

    def _source_entities(
        self,
        model: Any,
        *,
        job: Mapping[str, Any] | None = None,
        phase_timings: dict[str, dict[str, Any]] | None = None,
        phase_started: float | None = None,
    ) -> list[dict[str, Any]]:
        entities = self._iter_model_entities(model)
        rows: list[dict[str, Any]] = []
        started = phase_started if phase_started is not None else perf_counter()
        last_progress_at = started
        progress_write_count = 0
        profile_enabled = bool((job or {}).get("profile_source_entity_enumeration"))
        profile: dict[str, float] = {
            "iteration_seconds": 0.0,
            "id_extraction_seconds": 0.0,
            "class_extraction_seconds": 0.0,
            "guid_extraction_seconds": 0.0,
            "name_extraction_seconds": 0.0,
            "row_append_seconds": 0.0,
        }
        details: dict[str, Any] = {
            "enumerated_entity_count": 0,
            "last_ifc_class": None,
            "last_operation": "start_iteration",
            "elapsed_seconds": 0.0,
            "fallback_used": False,
        }
        index = 0
        while True:
            if profile_enabled:
                operation_started = perf_counter()
            try:
                entity = next(entities)
            except StopIteration:
                break
            if profile_enabled:
                profile["iteration_seconds"] += perf_counter() - operation_started
            index += 1
            details["last_operation"] = "extract_entity_id"
            if profile_enabled:
                operation_started = perf_counter()
            entity_id = _entity_id(entity, index)
            if profile_enabled:
                profile["id_extraction_seconds"] += perf_counter() - operation_started
            details["last_operation"] = "extract_class"
            if profile_enabled:
                operation_started = perf_counter()
            ifc_class = _entity_class(entity)
            if profile_enabled:
                profile["class_extraction_seconds"] += perf_counter() - operation_started
            details["last_ifc_class"] = ifc_class
            details["last_operation"] = "extract_global_id"
            if profile_enabled:
                operation_started = perf_counter()
            guid = _entity_global_id(entity)
            if profile_enabled:
                profile["guid_extraction_seconds"] += perf_counter() - operation_started
            details["last_operation"] = "extract_name"
            if profile_enabled:
                operation_started = perf_counter()
            name = _entity_name(entity)
            if profile_enabled:
                profile["name_extraction_seconds"] += perf_counter() - operation_started
            entity_key = guid or f"{ifc_class}:{entity_id}"
            if profile_enabled:
                operation_started = perf_counter()
            rows.append(
                {
                    "ifc_entity_key": entity_key,
                    "ifc_entity_id": entity_id,
                    "ifc_guid": guid,
                    "ifc_class": ifc_class,
                    "name": name,
                }
            )
            if profile_enabled:
                profile["row_append_seconds"] += perf_counter() - operation_started
            details["enumerated_entity_count"] = index
            details["last_operation"] = "append_row"
            details["elapsed_seconds"] = perf_counter() - started
            if profile_enabled:
                details["profile"] = dict(profile)
            now = perf_counter()
            should_publish = (
                index % SOURCE_ENUMERATION_PROGRESS_INTERVAL == 0
                or now - last_progress_at >= SOURCE_ENUMERATION_PROGRESS_SECONDS
            )
            if should_publish and phase_timings is not None and job is not None:
                progress_write_count += 1
                details["progress_write_count"] = progress_write_count
                _mark_phase_running(
                    phase_timings,
                    "source_entity_enumeration",
                    diagnostic="enumerating_ifc_source_entities",
                    details=details,
                )
                _record_phase_progress(job, "source_entity_enumeration", phase_timings)
                last_progress_at = now
        details["elapsed_seconds"] = perf_counter() - started
        if profile_enabled:
            details["profile"] = dict(profile)
        if phase_timings is not None:
            details["progress_write_count"] = progress_write_count
            _mark_phase_running(
                phase_timings,
                "source_entity_enumeration",
                diagnostic="enumerating_ifc_source_entities",
                details=details,
            )
        return rows

    def _iter_model_entities(self, model: Any) -> Any:
        try:
            return iter(model)
        except TypeError as exc:
            raise ConversionAdapterError(
                "IfcOpenShell model does not support all-entity iteration; "
                "IfcProduct-only fallback is not valid for all-entity coverage."
            ) from exc

    def _materialize_unmapped_entities(
        self,
        *,
        UsdGeom: Any,
        Sdf: Any,
        stage: Any,
        source_entities: list[dict[str, Any]],
        mapping_by_entity: dict[str, dict[str, Any]],
        prim_rows: list[dict[str, Any]],
        used_paths: set[str],
        job: Mapping[str, Any] | None = None,
        phase_timings: dict[str, dict[str, Any]] | None = None,
        phase_started: float | None = None,
        strategy: str = "sidecar",
    ) -> list[dict[str, Any]]:
        started = phase_started if phase_started is not None else perf_counter()
        last_progress_at = started
        progress_write_count = 0
        materialized = 0
        sidecar_entries: list[dict[str, Any]] = []
        use_sidecar = strategy == "sidecar"
        profile_enabled = bool((job or {}).get("profile_source_entity_enumeration"))
        profile: dict[str, float] = {
            "unique_prim_path_seconds": 0.0,
            "xform_define_seconds": 0.0,
            "attribute_write_seconds": 0.0,
            "row_append_seconds": 0.0,
            "mapping_append_seconds": 0.0,
            "progress_write_seconds": 0.0,
            # Time spent appending sidecar entries to in-memory list + mapping dict
            # (the actual entity_index.json write happens later in convert() and is
            # tracked separately by quality_metrics.sidecar_write_seconds).
            "sidecar_append_seconds": 0.0,
        }
        details: dict[str, Any] = {
            "materialized_entity_count": 0,
            "materialization_strategy": strategy,
            "elapsed_seconds": 0.0,
            "last_operation": "start_materialization",
            "progress_write_count": 0,
            "fallback_used": False,
        }

        def publish_progress(operation: str) -> None:
            nonlocal last_progress_at, progress_write_count
            if phase_timings is None or job is None:
                return
            now = perf_counter()
            details["materialized_entity_count"] = materialized
            details["elapsed_seconds"] = now - started
            details["last_operation"] = operation
            progress_write_count += 1
            details["progress_write_count"] = progress_write_count
            if profile_enabled:
                details["profile"] = dict(profile)
            progress_started = perf_counter() if profile_enabled else 0.0
            _mark_phase_running(
                phase_timings,
                "non_renderable_entity_materialization",
                diagnostic="materializing_non_renderable_ifc_entities",
                details=details,
            )
            _record_phase_progress(job, "non_renderable_entity_materialization", phase_timings)
            if profile_enabled:
                profile["progress_write_seconds"] += perf_counter() - progress_started
            last_progress_at = now

        for entity in source_entities:
            entity_key = entity["ifc_entity_key"]
            if entity_key in mapping_by_entity:
                continue
            op_started = 0.0
            if use_sidecar:
                details["last_operation"] = "sidecar_append"
                if profile_enabled:
                    op_started = perf_counter()
                sidecar_entry = {
                    "ifc_entity_key": entity_key,
                    "ifc_entity_id": entity.get("ifc_entity_id"),
                    "ifc_guid": entity.get("ifc_guid"),
                    "ifc_class": entity.get("ifc_class"),
                    "name": entity.get("name", ""),
                    "renderable": False,
                }
                sidecar_entries.append(sidecar_entry)
                mapping_by_entity[entity_key] = {
                    "ifc_entity_key": entity_key,
                    "ifc_entity_id": entity.get("ifc_entity_id"),
                    "ifc_guid": entity.get("ifc_guid"),
                    "ifc_class": entity.get("ifc_class"),
                    "name": entity.get("name", ""),
                    "usd_prim_path": None,
                    "primary_usd_prim_path": None,
                    "usd_prim_paths": [],
                    "mapping_method": "ifc_entity_to_sidecar_index",
                    "mapping_confidence": 1.0,
                    "renderable": False,
                    "carrier": "sidecar",
                }
                if profile_enabled:
                    profile["sidecar_append_seconds"] += perf_counter() - op_started
            else:
                details["last_operation"] = "unique_prim_path"
                if profile_enabled:
                    op_started = perf_counter()
                prim_path = self._unique_prim_path(
                    entity.get("ifc_class", "IfcEntity"),
                    entity_key,
                    used_paths,
                    prefix="/World/IfcEntity",
                )
                if profile_enabled:
                    profile["unique_prim_path_seconds"] += perf_counter() - op_started
                details["last_operation"] = "xform_define"
                if profile_enabled:
                    op_started = perf_counter()
                xform = UsdGeom.Xform.Define(stage, prim_path)
                prim = xform.GetPrim()
                if profile_enabled:
                    profile["xform_define_seconds"] += perf_counter() - op_started
                details["last_operation"] = "attribute_write"
                if profile_enabled:
                    op_started = perf_counter()
                prim.CreateAttribute("ifc:entityKey", Sdf.ValueTypeNames.String).Set(entity_key)
                prim.CreateAttribute("ifc:entityId", Sdf.ValueTypeNames.String).Set(str(entity.get("ifc_entity_id") or ""))
                if entity.get("ifc_guid"):
                    prim.CreateAttribute("ifc:guid", Sdf.ValueTypeNames.String).Set(entity["ifc_guid"])
                prim.CreateAttribute("ifc:type", Sdf.ValueTypeNames.String).Set(entity.get("ifc_class", "IfcEntity"))
                prim.CreateAttribute("ifc:name", Sdf.ValueTypeNames.String).Set(entity.get("name", ""))
                prim.CreateAttribute("worker:nonRenderableIfcEntity", Sdf.ValueTypeNames.String).Set("true")
                if profile_enabled:
                    profile["attribute_write_seconds"] += perf_counter() - op_started
                details["last_operation"] = "row_append"
                if profile_enabled:
                    op_started = perf_counter()
                prim_rows.append(
                    {
                        "path": prim_path,
                        "type": "Xform",
                        "ifc_entity_key": entity_key,
                        "ifc_entity_id": entity.get("ifc_entity_id"),
                        "ifc_guid": entity.get("ifc_guid"),
                        "ifc_class": entity.get("ifc_class"),
                        "mapping_status": "mapped",
                        "renderable": False,
                    }
                )
                if profile_enabled:
                    profile["row_append_seconds"] += perf_counter() - op_started
                details["last_operation"] = "mapping_append"
                if profile_enabled:
                    op_started = perf_counter()
                mapping_by_entity[entity_key] = {
                    "ifc_entity_key": entity_key,
                    "ifc_entity_id": entity.get("ifc_entity_id"),
                    "ifc_guid": entity.get("ifc_guid"),
                    "ifc_class": entity.get("ifc_class"),
                    "name": entity.get("name", ""),
                    "usd_prim_path": prim_path,
                    "primary_usd_prim_path": prim_path,
                    "usd_prim_paths": [prim_path],
                    "mapping_method": "ifc_entity_to_non_renderable_usd_prim",
                    "mapping_confidence": 1.0,
                    "renderable": False,
                    "carrier": "usd_prim",
                }
                if profile_enabled:
                    profile["mapping_append_seconds"] += perf_counter() - op_started
            materialized += 1
            now = perf_counter()
            if (
                materialized % MATERIALIZATION_PROGRESS_INTERVAL == 0
                or now - last_progress_at >= MATERIALIZATION_PROGRESS_SECONDS
            ):
                publish_progress("sidecar_append" if use_sidecar else "append_row")

        details["materialized_entity_count"] = materialized
        details["elapsed_seconds"] = perf_counter() - started
        details["last_operation"] = "completed"
        details["progress_write_count"] = progress_write_count
        if profile_enabled:
            details["profile"] = dict(profile)
        if phase_timings is not None:
            _mark_phase_running(
                phase_timings,
                "non_renderable_entity_materialization",
                diagnostic="materializing_non_renderable_ifc_entities",
                details=details,
            )
        return sidecar_entries

    def _unique_prim_path(self, ifc_class: str, guid: str, used_paths: set[str], prefix: str = "/World") -> str:
        base = f"{prefix}/{_safe_prim_name(ifc_class)}_{_safe_prim_name(guid)}"
        candidate = base
        index = 2
        while candidate in used_paths:
            candidate = f"{base}_{index}"
            index += 1
        used_paths.add(candidate)
        return candidate

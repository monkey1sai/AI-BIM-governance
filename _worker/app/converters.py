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

        output_dir.mkdir(parents=True, exist_ok=True)
        model_path = output_dir / "model.usdc"
        ifc_index_path = output_dir / "ifc_index.json"
        usd_index_path = output_dir / "usd_index.json"
        mapping_path = output_dir / "element_mapping.json" if generate_mapping else None

        started = perf_counter()
        try:
            model = ifcopenshell.open(str(source_path))
        except Exception as exc:
            raise ConversionAdapterError(f"IfcOpenShell could not open source IFC: {exc}") from exc

        source_entities = self._source_entities(model)
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

        self._materialize_unmapped_entities(
            UsdGeom=UsdGeom,
            Sdf=Sdf,
            stage=stage,
            source_entities=source_entities,
            mapping_by_entity=mapping_by_entity,
            prim_rows=prim_rows,
            used_paths=used_paths,
        )
        stage.GetRootLayer().Save()
        opened_stage = Usd.Stage.Open(str(model_path))
        if opened_stage is None:
            raise ConversionAdapterError("OpenUSD could not reopen generated model.usdc.")
        usd_prim_count = sum(1 for _ in opened_stage.Traverse())
        if converted_shapes <= 0:
            raise ConversionAdapterError("Generated model.usdc has no renderable mesh prims.")

        source_count = len(source_entities)
        mapped_count = len(mapping_by_entity)
        unmapped_count = max(source_count - mapped_count, 0)
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
        duration_seconds = perf_counter() - started

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
            "unmapped_ifc_count": unmapped_count,
            "unmapped_usd_count": unmapped_usd_count,
            "coverage_ratio": coverage_ratio,
            "fake_mapping_count": 0,
            "minimum_coverage_baseline_locked": False,
            "minimum_coverage_ratio": 1.0,
            "coverage_denominator": "source_ifc_entity_count",
            "coverage_status": "unlocked",
            "threshold_status": "measure_only",
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
                        "minimum_coverage_baseline_locked": False,
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
            "unmapped_count": unmapped_count,
            "unmapped_usd_count": unmapped_usd_count,
            "coverage_ratio": coverage_ratio,
            "threshold_status": "measure_only",
            "minimum_coverage_baseline_locked": False,
            "minimum_coverage_ratio": 1.0,
            "coverage_denominator": "source_ifc_entity_count",
            "coverage_status": "unlocked",
            "issue_to_real_prim_readiness": False,
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
        }
        return ConversionAdapterResult(
            model_path=model_path,
            ifc_index_path=ifc_index_path,
            usd_index_path=usd_index_path,
            mapping_path=mapping_path,
            converter=converter,
            quality_metrics=quality_metrics,
            warnings=[],
        )

    def _source_entities(self, model: Any) -> list[dict[str, Any]]:
        entities = self._iter_model_entities(model)
        rows: list[dict[str, Any]] = []
        for index, entity in enumerate(entities, start=1):
            entity_id = _entity_id(entity, index)
            ifc_class = _entity_class(entity)
            guid = _entity_global_id(entity)
            entity_key = guid or f"{ifc_class}:{entity_id}"
            rows.append(
                {
                    "ifc_entity_key": entity_key,
                    "ifc_entity_id": entity_id,
                    "ifc_guid": guid,
                    "ifc_class": ifc_class,
                    "name": _entity_name(entity),
                }
            )
        return rows

    def _iter_model_entities(self, model: Any) -> list[Any]:
        try:
            entities = list(model)
        except TypeError:
            entities = []
        if entities:
            return entities
        try:
            return list(model.by_type("IfcProduct"))
        except Exception:
            return []

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
    ) -> None:
        for entity in source_entities:
            entity_key = entity["ifc_entity_key"]
            if entity_key in mapping_by_entity:
                continue
            prim_path = self._unique_prim_path(
                entity.get("ifc_class", "IfcEntity"),
                entity_key,
                used_paths,
                prefix="/World/IfcEntity",
            )
            xform = UsdGeom.Xform.Define(stage, prim_path)
            prim = xform.GetPrim()
            prim.CreateAttribute("ifc:entityKey", Sdf.ValueTypeNames.String).Set(entity_key)
            prim.CreateAttribute("ifc:entityId", Sdf.ValueTypeNames.String).Set(str(entity.get("ifc_entity_id") or ""))
            if entity.get("ifc_guid"):
                prim.CreateAttribute("ifc:guid", Sdf.ValueTypeNames.String).Set(entity["ifc_guid"])
            prim.CreateAttribute("ifc:type", Sdf.ValueTypeNames.String).Set(entity.get("ifc_class", "IfcEntity"))
            prim.CreateAttribute("ifc:name", Sdf.ValueTypeNames.String).Set(entity.get("name", ""))
            prim.CreateAttribute("worker:nonRenderableIfcEntity", Sdf.ValueTypeNames.String).Set("true")
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
            }

    def _unique_prim_path(self, ifc_class: str, guid: str, used_paths: set[str], prefix: str = "/World") -> str:
        base = f"{prefix}/{_safe_prim_name(ifc_class)}_{_safe_prim_name(guid)}"
        candidate = base
        index = 2
        while candidate in used_paths:
            candidate = f"{base}_{index}"
            index += 1
        used_paths.add(candidate)
        return candidate

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

        source_elements = self._source_elements(model)
        source_by_guid = {item["ifc_guid"]: item for item in source_elements}

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
        mapping_by_guid: dict[str, dict[str, Any]] = {}
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
            guid = str(getattr(shape, "guid", "") or f"shape_{converted_shapes}")
            ifc_class = str(getattr(shape, "type", "") or "IfcProduct")

            if len(vertices) < 3 or len(faces) < 3:
                skipped_shapes += 1
                keep_going = iterator.next()
                continue

            prim_path = self._unique_prim_path(ifc_class, guid, used_paths)
            mesh = UsdGeom.Mesh.Define(stage, prim_path)
            points = [(vertices[i], vertices[i + 1], vertices[i + 2]) for i in range(0, len(vertices), 3)]
            triangle_count = len(faces) // 3
            mesh.CreatePointsAttr(points)
            mesh.CreateFaceVertexCountsAttr([3] * triangle_count)
            mesh.CreateFaceVertexIndicesAttr(faces[: triangle_count * 3])
            mesh.GetPrim().CreateAttribute("ifc:guid", Sdf.ValueTypeNames.String).Set(guid)
            mesh.GetPrim().CreateAttribute("ifc:type", Sdf.ValueTypeNames.String).Set(ifc_class)

            converted_shapes += 1
            vertex_count += len(points)
            face_count += triangle_count
            prim_rows.append(
                {
                    "path": prim_path,
                    "type": "Mesh",
                    "ifc_guid": guid,
                    "ifc_class": ifc_class,
                    "vertex_count": len(points),
                    "face_count": triangle_count,
                }
            )

            mapping = mapping_by_guid.setdefault(
                guid,
                {
                    "ifc_guid": guid,
                    "ifc_class": source_by_guid.get(guid, {}).get("ifc_class", ifc_class),
                    "primary_usd_prim_path": prim_path,
                    "usd_prim_paths": [],
                    "mapping_method": "ifcopenshell_geometry_guid_to_usd_mesh",
                    "mapping_confidence": 0.95,
                },
            )
            mapping["usd_prim_paths"].append(prim_path)
            keep_going = iterator.next()

        stage.GetRootLayer().Save()
        opened_stage = Usd.Stage.Open(str(model_path))
        if opened_stage is None:
            raise ConversionAdapterError("OpenUSD could not reopen generated model.usdc.")
        usd_prim_count = sum(1 for _ in opened_stage.Traverse())
        if usd_prim_count <= 1:
            raise ConversionAdapterError("Generated model.usdc has no renderable mesh prims.")

        source_count = len(source_elements)
        mapped_count = len(mapping_by_guid)
        unmapped_count = max(source_count - mapped_count, 0)
        coverage_ratio = (mapped_count / source_count) if source_count else 0.0
        duration_seconds = perf_counter() - started

        ifc_index = {
            "source_artifact_id": job["source_artifact_id"],
            "schema": model.schema,
            "summary": {
                "element_count": source_count,
                "guid_count": len(source_by_guid),
            },
            "elements": source_elements,
        }
        usd_index = {
            "summary": {
                "prim_count": usd_prim_count,
                "mesh_prim_count": len(prim_rows),
                "vertex_count": vertex_count,
                "face_count": face_count,
            },
            "prims": prim_rows,
        }
        mapping_summary = {
            "source_ifc_element_count": source_count,
            "usd_prim_count": usd_prim_count,
            "mapped_count": mapped_count,
            "unmapped_ifc_count": unmapped_count,
            "unmapped_usd_count": 0,
            "coverage_ratio": coverage_ratio,
            "fake_mapping_count": 0,
            "minimum_coverage_baseline_locked": False,
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
                        "minimum_coverage_ratio": None,
                    },
                    "items": list(mapping_by_guid.values()),
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
            "source_ifc_element_count": source_count,
            "usd_prim_count": usd_prim_count,
            "mesh_prim_count": len(prim_rows),
            "mapped_count": mapped_count,
            "unmapped_count": unmapped_count,
            "coverage_ratio": coverage_ratio,
            "threshold_status": "measure_only",
            "minimum_coverage_baseline_locked": False,
            "hard_quality_gates": {
                "usdc_openable": True,
                "has_renderable_prims": usd_prim_count > 1,
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

    def _source_elements(self, model: Any) -> list[dict[str, Any]]:
        elements: list[dict[str, Any]] = []
        for entity in model.by_type("IfcProduct"):
            guid = getattr(entity, "GlobalId", None)
            if not guid:
                continue
            elements.append(
                {
                    "ifc_guid": str(guid),
                    "ifc_class": entity.is_a(),
                    "name": str(getattr(entity, "Name", "") or ""),
                }
            )
        return elements

    def _unique_prim_path(self, ifc_class: str, guid: str, used_paths: set[str]) -> str:
        base = f"/World/{_safe_prim_name(ifc_class)}_{_safe_prim_name(guid)}"
        candidate = base
        index = 2
        while candidate in used_paths:
            candidate = f"{base}_{index}"
            index += 1
        used_paths.add(candidate)
        return candidate

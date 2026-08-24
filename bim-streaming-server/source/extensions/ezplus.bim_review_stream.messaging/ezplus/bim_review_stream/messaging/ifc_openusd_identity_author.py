"""IFC-first OpenUSD identity authoring.

This module is intentionally profile-gated. It authors USD from IFC identity
directly and must not become the default conversion path until runtime and
license risks are accepted.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping
import json

from conversion_authority import (
    ConversionAuthorityError,
    compute_coverage_quality,
    count_eligible_ifc_products,
)


IDENTITY_PROFILE = "ifcopenshell_openusd_identity"


@dataclass(frozen=True)
class IdentityRootPath:
    path: str
    class_token: str
    guid_token: str
    ifc_type: str
    ifc_guid: str


def usd_safe_identifier(value: str, *, fallback: str) -> str:
    """Return a deterministic USD prim-name segment.

    USD prim names must start with a letter or underscore and then contain only
    letters, digits, or underscores. The caller keeps the original IFC value in
    metadata/sidecars; this helper only creates a path-safe token.
    """
    raw = str(value or "")
    sanitized = "".join(ch if ch.isalnum() or ch == "_" else "_" for ch in raw)
    if not sanitized:
        sanitized = fallback
    if not (sanitized[0].isalpha() or sanitized[0] == "_"):
        sanitized = "_" + sanitized
    return sanitized


def build_identity_root_path(ifc_type: str, ifc_guid: str) -> IdentityRootPath:
    class_token = usd_safe_identifier(ifc_type, fallback="Unclassified")
    guid_body = usd_safe_identifier(ifc_guid, fallback="Shape")
    if guid_body.startswith("_"):
        guid_body = guid_body[1:] or "Shape"
    guid_token = f"G_{guid_body}"
    return IdentityRootPath(
        path=f"/World/Elements/{class_token}/{guid_token}",
        class_token=class_token,
        guid_token=guid_token,
        ifc_type=str(ifc_type or ""),
        ifc_guid=str(ifc_guid or ""),
    )


class IfcOpenUsdIdentityAuthor:
    def __init__(
        self,
        *,
        ifc_path: Path,
        output_dir: Path,
        source_model_version_id: str | None = None,
    ) -> None:
        self.ifc_path = Path(ifc_path)
        self.output_dir = Path(output_dir)
        self.source_model_version_id = source_model_version_id

    def author(self) -> Mapping[str, Any]:
        try:
            import ifcopenshell
            import ifcopenshell.geom
            from pxr import Gf, Usd, UsdGeom
        except Exception as exc:  # noqa: BLE001
            raise ConversionAuthorityError(
                "converter_unavailable",
                "IfcOpenShell/OpenUSD identity authoring dependencies are unavailable: "
                f"{exc}",
            ) from exc

        try:
            ifc_model = ifcopenshell.open(str(self.ifc_path))
        except Exception as exc:  # noqa: BLE001
            raise ConversionAuthorityError(
                "identity_ifc_parse_failed",
                f"IfcOpenShell could not parse identity IFC input {self.ifc_path}: {exc}",
            ) from exc

        try:
            settings = ifcopenshell.geom.settings()
            iterator = self._make_iterator(ifcopenshell.geom, settings, ifc_model)
            initialized = iterator.initialize()
        except Exception as exc:  # noqa: BLE001
            raise ConversionAuthorityError(
                "identity_geometry_iterator_failed",
                f"IfcOpenShell identity geometry iterator could not start: {exc}",
            ) from exc
        if not initialized:
            raise ConversionAuthorityError(
                "identity_no_renderable_geometry",
                f"IfcOpenShell identity authoring found no renderable geometry in {self.ifc_path}",
            )

        self.output_dir.mkdir(parents=True, exist_ok=True)
        paths = {
            "model_path": self.output_dir / "model.usdc",
            "mapping_path": self.output_dir / "element_mapping.json",
            "entity_index_path": self.output_dir / "entity_index.json",
            "metadata_path": self.output_dir / "metadata.json",
            "pset_index_path": self.output_dir / "pset_index.json",
            "spatial_index_path": self.output_dir / "spatial_index.json",
            "bbox_index_path": self.output_dir / "bbox_index.json",
            "quality_metrics_path": self.output_dir / "quality_metrics.json",
            "geo_reference_path": self.output_dir / "geo_reference.json",
        }

        stage = Usd.Stage.CreateNew(str(paths["model_path"]))
        if stage is None:
            raise ConversionAuthorityError(
                "identity_usdc_create_failed",
                f"OpenUSD could not create identity USDC at {paths['model_path']}",
            )
        world = UsdGeom.Xform.Define(stage, "/World")
        stage.SetDefaultPrim(world.GetPrim())
        for scope in ("Elements", "Spatial", "Systems", "Overlays", "GeoReference"):
            UsdGeom.Xform.Define(stage, f"/World/{scope}")
        try:
            UsdGeom.SetStageUpAxis(stage, UsdGeom.Tokens.z)
            UsdGeom.SetStageMetersPerUnit(stage, 1.0)
        except Exception:
            pass

        records: dict[tuple[str, str], dict[str, Any]] = {}
        root_paths: dict[str, tuple[str, str]] = {}
        shape_count = 0
        skipped_shape_count = 0
        while True:
            shape = iterator.get()
            geometry = getattr(shape, "geometry", None)
            points, face_indices, face_counts = self._usd_mesh_data_from_ifcopenshell(
                verts_raw=tuple(getattr(geometry, "verts", ()) or ()),
                faces_raw=tuple(getattr(geometry, "faces", ()) or ()),
                vec3_type=Gf.Vec3f,
            )
            if not points or not face_indices:
                skipped_shape_count += 1
            else:
                shape_count += 1
                ifc_guid = str(getattr(shape, "guid", "") or "")
                ifc_type = str(getattr(shape, "type", "") or "")
                ifc_name = str(getattr(shape, "name", "") or "")
                if ifc_guid:
                    identity = build_identity_root_path(ifc_type, ifc_guid)
                    identity_key = (ifc_type, ifc_guid)
                    if identity_key not in records:
                        product = self._product_by_guid(ifc_model, ifc_guid)
                        root_path = self._unique_root_path(
                            stage=stage,
                            base_path=identity.path,
                            identity_key=identity_key,
                            root_paths=root_paths,
                        )
                        root = UsdGeom.Xform.Define(stage, root_path)
                        prim = root.GetPrim()
                        prim.SetCustomDataByKey("bim:ifc_guid", ifc_guid)
                        prim.SetCustomDataByKey("bim:ifc_type", ifc_type)
                        prim.SetCustomDataByKey("bim:ifc_name", ifc_name)
                        if self.source_model_version_id:
                            prim.SetCustomDataByKey(
                                "bim:source_model_version_id",
                                self.source_model_version_id,
                            )
                        records[identity_key] = {
                            "entity_id": f"ifc:{ifc_guid}",
                            "ifc_guid": ifc_guid,
                            "ifc_type": ifc_type,
                            "ifc_name": ifc_name,
                            "usd_prim_path": root_path,
                            "mesh_count": 0,
                            "bbox_local": None,
                            "psets": self._extract_psets(product),
                            "spatial_relationships": self._extract_spatial_relationships(product),
                        }
                    record = records[identity_key]
                    child_name = f"Body_{int(record['mesh_count']):03d}"
                    record["mesh_count"] = int(record["mesh_count"]) + 1
                    mesh = UsdGeom.Mesh.Define(stage, f"{record['usd_prim_path']}/{child_name}")
                    mesh.CreatePointsAttr(points)
                    mesh.CreateFaceVertexCountsAttr(face_counts)
                    mesh.CreateFaceVertexIndicesAttr(face_indices)
                    extent = self._mesh_extent(points, vec3_type=Gf.Vec3f)
                    mesh.CreateExtentAttr(extent)
                    record["bbox_local"] = self._merge_bbox(
                        record.get("bbox_local"),
                        self._extent_to_bbox(extent),
                    )

            try:
                has_next = iterator.next()
            except Exception as exc:  # noqa: BLE001
                raise ConversionAuthorityError(
                    "identity_geometry_iterator_failed",
                    f"IfcOpenShell identity geometry iterator failed advancing: {exc}",
                ) from exc
            if not has_next:
                break

        if not records:
            raise ConversionAuthorityError(
                "identity_no_mapped_elements",
                f"Identity authoring produced no GUID-bearing renderable elements for {self.ifc_path}",
            )

        try:
            stage.GetRootLayer().Save()
        except Exception as exc:  # noqa: BLE001
            raise ConversionAuthorityError(
                "identity_usdc_save_failed",
                f"OpenUSD could not save identity USDC at {paths['model_path']}: {exc}",
            ) from exc

        reopened = Usd.Stage.Open(str(paths["model_path"]))
        if reopened is None:
            raise ConversionAuthorityError(
                "usdc_not_openable",
                f"Identity-authored USDC could not be opened by USD: {paths['model_path']}",
            )
        renderable_count = sum(1 for prim in reopened.Traverse() if UsdGeom.Mesh(prim))
        if renderable_count == 0:
            raise ConversionAuthorityError(
                "identity_no_renderable_geometry",
                f"Identity-authored USDC has no renderable mesh prims: {paths['model_path']}",
            )

        ordered = sorted(records.values(), key=lambda item: str(item["entity_id"]))
        mapped_count = len(ordered)
        quality_metrics = self._write_sidecars(
            paths=paths,
            ifc_schema=str(getattr(ifc_model, "schema", "") or "") or None,
            records=ordered,
            mapped_count=mapped_count,
            eligible_ifc_product_count=count_eligible_ifc_products(ifc_model),
            shape_count=shape_count,
            skipped_shape_count=skipped_shape_count,
            renderable_count=renderable_count,
        )
        return {
            "paths": paths,
            "quality_metrics": quality_metrics,
        }

    def _make_iterator(self, geom_module: Any, settings: Any, ifc_model: Any) -> Any:
        try:
            worker_count = max(__import__("os").cpu_count() or 1, 1)
            return geom_module.iterator(settings, ifc_model, worker_count)
        except TypeError:
            return geom_module.iterator(settings, ifc_model)

    def _unique_root_path(
        self,
        *,
        stage: Any,
        base_path: str,
        identity_key: tuple[str, str],
        root_paths: dict[str, tuple[str, str]],
    ) -> str:
        candidate = base_path
        suffix = 1
        while True:
            existing = root_paths.get(candidate)
            if existing is None and not stage.GetPrimAtPath(candidate).IsValid():
                root_paths[candidate] = identity_key
                return candidate
            if existing == identity_key:
                return candidate
            candidate = f"{base_path}__{suffix}"
            suffix += 1

    def _product_by_guid(self, ifc_model: Any, ifc_guid: str) -> Any | None:
        by_guid = getattr(ifc_model, "by_guid", None)
        if callable(by_guid):
            try:
                return by_guid(ifc_guid)
            except Exception:  # noqa: BLE001
                pass
        try:
            products = ifc_model.by_type("IfcProduct")
        except Exception:  # noqa: BLE001
            return None
        for product in products:
            try:
                if str(getattr(product, "GlobalId", "") or "") == ifc_guid:
                    return product
            except Exception:  # noqa: BLE001
                continue
        return None

    def _extract_psets(self, product: Any | None) -> dict[str, Any]:
        if product is None:
            return {}
        try:
            from ifcopenshell.util import element as element_util  # type: ignore[import-not-found]
        except Exception:  # noqa: BLE001
            return {}
        get_psets = getattr(element_util, "get_psets", None)
        if not callable(get_psets):
            return {}
        try:
            psets = get_psets(product)
        except Exception:  # noqa: BLE001
            return {}
        return self._jsonable(psets) if isinstance(psets, dict) else {}

    def _extract_spatial_relationships(self, product: Any | None) -> list[dict[str, Any]]:
        if product is None:
            return []
        try:
            from ifcopenshell.util import element as element_util  # type: ignore[import-not-found]
        except Exception:  # noqa: BLE001
            return []
        relationships: list[dict[str, Any]] = []
        for relationship_type, helper_name in (
            ("spatial_container", "get_container"),
            ("aggregate_parent", "get_aggregate"),
        ):
            helper = getattr(element_util, helper_name, None)
            if not callable(helper):
                continue
            try:
                related = helper(product)
            except Exception:  # noqa: BLE001
                continue
            ref = self._related_entity_ref(related)
            if ref:
                relationships.append({"type": relationship_type, **ref})
        return relationships

    def _related_entity_ref(self, entity: Any | None) -> dict[str, Any] | None:
        if entity is None:
            return None
        guid = str(getattr(entity, "GlobalId", "") or "")
        if not guid:
            return None
        try:
            ifc_type = entity.is_a() if hasattr(entity, "is_a") else None
        except Exception:  # noqa: BLE001
            ifc_type = None
        try:
            name = getattr(entity, "Name", None)
        except Exception:  # noqa: BLE001
            name = None
        return {
            "related_entity_id": f"ifc:{guid}",
            "related_ifc_type": str(ifc_type) if ifc_type else None,
            "related_name": str(name) if name else None,
        }

    def _jsonable(self, value: Any) -> Any:
        if value is None or isinstance(value, (str, int, float, bool)):
            return value
        if isinstance(value, Mapping):
            return {str(key): self._jsonable(item) for key, item in value.items()}
        if isinstance(value, (list, tuple, set)):
            return [self._jsonable(item) for item in value]
        ref = self._related_entity_ref(value)
        return ref if ref is not None else str(value)

    def _write_sidecars(
        self,
        *,
        paths: Mapping[str, Path],
        ifc_schema: str | None,
        records: list[dict[str, Any]],
        mapped_count: int,
        eligible_ifc_product_count: int | None,
        shape_count: int,
        skipped_shape_count: int,
        renderable_count: int,
    ) -> dict[str, Any]:
        mapping_items = [
            {
                "ifc_guid": item["ifc_guid"],
                "usd_prim_path": item["usd_prim_path"],
                "ifc_type": item["ifc_type"] or None,
                "ifc_class": item["ifc_type"] or None,
                "ifc_name": item["ifc_name"] or None,
                "entity_id": item["entity_id"],
                "mapping_fidelity": "guid_exact",
            }
            for item in records
        ]
        entity_items = [
            {
                "entity_id": item["entity_id"],
                "ifc_guid": item["ifc_guid"],
                "ifc_type": item["ifc_type"] or None,
                "name": item["ifc_name"] or None,
                "usd_prim_path": item["usd_prim_path"],
                "source_model_version_id": self.source_model_version_id,
            }
            for item in records
        ]
        bbox_items = [
            {
                "entity_id": item["entity_id"],
                "ifc_guid": item["ifc_guid"],
                "usd_prim_path": item["usd_prim_path"],
                "bbox_local": item["bbox_local"],
                "bbox_world": None,
            }
            for item in records
        ]
        warnings = ["geo_reference_missing"]
        coverage = compute_coverage_quality(
            mapped_count=mapped_count,
            eligible_ifc_product_count=eligible_ifc_product_count,
        )
        quality_metrics = {
            **coverage,
            "materialization_strategy": IDENTITY_PROFILE,
            "identity_authoring_profile": IDENTITY_PROFILE,
            "mapping_fidelity": "guid_exact",
            "semantic_mapping_fidelity": "guid_exact",
            "mapping_has_ifc_type": any(item.get("ifc_type") for item in records),
            "mapping_has_ifc_name": any(item.get("ifc_name") for item in records),
            "sidecar_carrier_count": mapped_count,
            "minimum_coverage_baseline_locked": False,
            "shape_count": shape_count,
            "skipped_shape_count": skipped_shape_count,
            "warnings": warnings,
            "hard_quality_gates": {
                "usdc_openable": True,
                "has_renderable_prims": renderable_count > 0,
                "placeholder_output": False,
            },
        }
        docs = {
            "mapping_path": {
                "format_version": 2,
                "mapping_provenance": "converter_verified",
                "mock": False,
                "allow_fake_mapping": False,
                "mapping_fidelity": "guid_exact",
                "summary": {
                    "mapped_count": mapped_count,
                    "fake_mapping_count": 0,
                    "unmapped_ifc_count": coverage["unmapped_count"] or 0,
                },
                "items": mapping_items,
            },
            "entity_index_path": {
                "format_version": 1,
                "items": entity_items,
                "entities": entity_items,
            },
            "metadata_path": {
                "source": IDENTITY_PROFILE,
                "source_ifc": self.ifc_path.name,
                "ifc_schema": ifc_schema,
                "usd_root_layer": Path(paths["model_path"]).name,
                "source_model_version_id": self.source_model_version_id,
            },
            "pset_index_path": {
                "format_version": 1,
                "items": [
                    {
                        "entity_id": item["entity_id"],
                        "ifc_guid": item["ifc_guid"],
                        "usd_prim_path": item["usd_prim_path"],
                        "psets": item.get("psets") or {},
                    }
                    for item in records
                ],
            },
            "spatial_index_path": {
                "format_version": 1,
                "items": [
                    {
                        "entity_id": item["entity_id"],
                        "ifc_guid": item["ifc_guid"],
                        "usd_prim_path": item["usd_prim_path"],
                        "relationships": item.get("spatial_relationships") or [],
                    }
                    for item in records
                ],
            },
            "bbox_index_path": {
                "format_version": 1,
                "items": bbox_items,
            },
            "quality_metrics_path": quality_metrics,
            "geo_reference_path": {
                "format_version": 1,
                "available": False,
                "crs": None,
                "local_origin": None,
                "true_north_degrees": None,
                "model_to_world_matrix": None,
                "warnings": warnings,
            },
        }
        for key, doc in docs.items():
            Path(paths[key]).write_text(
                json.dumps(doc, ensure_ascii=False),
                encoding="utf-8",
            )
        return quality_metrics

    def _usd_mesh_data_from_ifcopenshell(
        self,
        *,
        verts_raw: tuple[Any, ...],
        faces_raw: tuple[Any, ...],
        vec3_type: Any,
    ) -> tuple[list[Any], list[int], list[int]]:
        points: list[Any] = []
        for index in range(0, len(verts_raw), 3):
            try:
                points.append(
                    vec3_type(
                        float(verts_raw[index]),
                        float(verts_raw[index + 1]),
                        float(verts_raw[index + 2]),
                    )
                )
            except (IndexError, TypeError, ValueError):
                return [], [], []
        vertex_count = len(points)
        face_indices: list[int] = []
        face_counts: list[int] = []
        for index in range(0, len(faces_raw), 3):
            try:
                triangle = (
                    int(faces_raw[index]),
                    int(faces_raw[index + 1]),
                    int(faces_raw[index + 2]),
                )
            except (IndexError, TypeError, ValueError):
                return [], [], []
            if all(0 <= face_index < vertex_count for face_index in triangle):
                face_indices.extend(triangle)
                face_counts.append(3)
        return points, face_indices, face_counts

    def _mesh_extent(self, points: list[Any], *, vec3_type: Any) -> list[Any]:
        xs = [float(point[0]) for point in points]
        ys = [float(point[1]) for point in points]
        zs = [float(point[2]) for point in points]
        return [
            vec3_type(min(xs), min(ys), min(zs)),
            vec3_type(max(xs), max(ys), max(zs)),
        ]

    def _extent_to_bbox(self, extent: list[Any]) -> list[float]:
        return [
            float(extent[0][0]),
            float(extent[0][1]),
            float(extent[0][2]),
            float(extent[1][0]),
            float(extent[1][1]),
            float(extent[1][2]),
        ]

    def _merge_bbox(
        self,
        current: list[float] | None,
        new_bbox: list[float],
    ) -> list[float]:
        if current is None:
            return list(new_bbox)
        return [
            min(current[0], new_bbox[0]),
            min(current[1], new_bbox[1]),
            min(current[2], new_bbox[2]),
            max(current[3], new_bbox[3]),
            max(current[4], new_bbox[4]),
            max(current[5], new_bbox[5]),
        ]

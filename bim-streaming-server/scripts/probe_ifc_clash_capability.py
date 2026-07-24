"""Functional IfcClash capability probe for a candidate host-native runtime.

``ifcopenshell.geom.has_occ`` reports whether the optional PythonOCC bindings
can be imported.  It does not report whether IfcOpenShell's compiled C++
OpenCASCADE geometry kernel can build the triangulated BVH used by IfcClash.

This probe therefore exercises the production-shaped geometry path with three
in-memory IFC models:

* a known-overlap pair for intersection and collision;
* a known-clearance pair that is near but does not intersect; and
* a known-separated pair for negative controls across all three modes.

No IFC file or runtime artifact is written.  A missing/broken geometry backend
or any result that violates those controls fails loud with a non-zero exit code.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
import json
import platform
import sys
from typing import Any

import ifcopenshell
from ifcopenshell import geom, guid


class ClashCapabilityError(RuntimeError):
    """The installed IfcOpenShell build cannot pass the clash canary."""


@dataclass(frozen=True)
class ClashCounts:
    intersection: int
    collision: int
    clearance: int


@dataclass(frozen=True)
class ClashCapabilityResult:
    ifcopenshell_version: str
    python_version: str
    platform: str
    pythonocc_bindings_available: bool
    overlap: ClashCounts
    near_clearance: ClashCounts
    separated: ClashCounts
    capable: bool = True

    def as_json_dict(self) -> dict[str, Any]:
        return asdict(self)


def _point(model: ifcopenshell.file, *coordinates: float):
    return model.create_entity(
        "IfcCartesianPoint",
        Coordinates=tuple(float(value) for value in coordinates),
    )


def _axis_placement_3d(model: ifcopenshell.file, *coordinates: float):
    return model.create_entity(
        "IfcAxis2Placement3D",
        Location=_point(model, *coordinates),
    )


def _local_placement(
    model: ifcopenshell.file,
    x: float,
    y: float,
    z: float,
):
    return model.create_entity(
        "IfcLocalPlacement",
        RelativePlacement=_axis_placement_3d(model, x, y, z),
    )


def _box_solid(
    model: ifcopenshell.file,
    *,
    length: float,
    width: float,
    height: float,
):
    profile = model.create_entity(
        "IfcRectangleProfileDef",
        ProfileType="AREA",
        XDim=float(length),
        YDim=float(width),
        Position=model.create_entity(
            "IfcAxis2Placement2D",
            Location=model.create_entity(
                "IfcCartesianPoint",
                Coordinates=(0.0, 0.0),
            ),
        ),
    )
    return model.create_entity(
        "IfcExtrudedAreaSolid",
        SweptArea=profile,
        Position=_axis_placement_3d(model, 0.0, 0.0, 0.0),
        ExtrudedDirection=model.create_entity(
            "IfcDirection",
            DirectionRatios=(0.0, 0.0, 1.0),
        ),
        Depth=float(height),
    )


def _product_shape(model: ifcopenshell.file, context, solid):
    representation = model.create_entity(
        "IfcShapeRepresentation",
        ContextOfItems=context,
        RepresentationIdentifier="Body",
        RepresentationType="SweptSolid",
        Items=[solid],
    )
    return model.create_entity(
        "IfcProductDefinitionShape",
        Representations=[representation],
    )


def _build_probe_model(
    second_origin: tuple[float, float, float],
) -> tuple[ifcopenshell.file, Any, Any]:
    model = ifcopenshell.file(schema="IFC4")
    length_unit = model.create_entity(
        "IfcSIUnit",
        UnitType="LENGTHUNIT",
        Name="METRE",
    )
    context = model.create_entity(
        "IfcGeometricRepresentationContext",
        ContextType="Model",
        CoordinateSpaceDimension=3,
        Precision=1e-5,
        WorldCoordinateSystem=_axis_placement_3d(model, 0.0, 0.0, 0.0),
    )
    model.create_entity(
        "IfcProject",
        GlobalId=guid.new(),
        Name="IfcClashCapabilityProbe",
        UnitsInContext=model.create_entity(
            "IfcUnitAssignment",
            Units=[length_unit],
        ),
        RepresentationContexts=[context],
    )

    wall = model.create_entity(
        "IfcWall",
        GlobalId=guid.new(),
        Name="ProbeWallA",
        ObjectPlacement=_local_placement(model, 0.0, 0.0, 0.0),
        Representation=_product_shape(
            model,
            context,
            _box_solid(model, length=2.0, width=1.0, height=1.0),
        ),
    )
    beam = model.create_entity(
        "IfcBeam",
        GlobalId=guid.new(),
        Name="ProbeBeamB",
        ObjectPlacement=_local_placement(model, *second_origin),
        Representation=_product_shape(
            model,
            context,
            _box_solid(model, length=1.0, width=2.0, height=1.5),
        ),
    )
    return model, wall, beam


def _build_clash_tree(model: ifcopenshell.file):
    try:
        settings = geom.settings()
        iterator = geom.iterator(
            settings,
            model,
            1,
            geometry_library="opencascade",
        )
        initialized = iterator.initialize()
    except Exception as exc:  # pragma: no cover - backend-specific exception types
        raise ClashCapabilityError(
            f"IfcOpenShell OpenCASCADE iterator unavailable: {exc}"
        ) from exc

    if not initialized:
        raise ClashCapabilityError(
            "IfcOpenShell OpenCASCADE iterator did not initialize"
        )

    element_count = 0
    try:
        tree = geom.tree()
        while True:
            tree.add_element(iterator.get())
            element_count += 1
            if not iterator.next():
                break
    except Exception as exc:  # pragma: no cover - backend-specific exception types
        raise ClashCapabilityError(
            f"IfcOpenShell could not build the triangulated clash tree: {exc}"
        ) from exc

    if element_count < 2:
        raise ClashCapabilityError(
            f"IfcOpenShell clash canary produced only {element_count} geometry elements"
        )
    return tree


def _clash_counts(
    model: ifcopenshell.file,
    element_a: Any,
    element_b: Any,
) -> ClashCounts:
    tree = _build_clash_tree(model)
    try:
        intersection = len(
            tree.clash_intersection_many(
                [element_a], [element_b], tolerance=0.001, check_all=True
            )
        )
        collision = len(
            tree.clash_collision_many(
                [element_a], [element_b], allow_touching=False
            )
        )
        clearance = len(
            tree.clash_clearance_many(
                [element_a], [element_b], clearance=0.5, check_all=True
            )
        )
    except Exception as exc:  # pragma: no cover - backend-specific exception types
        raise ClashCapabilityError(
            f"IfcOpenShell clash operation failed: {exc}"
        ) from exc
    return ClashCounts(
        intersection=intersection,
        collision=collision,
        clearance=clearance,
    )


def run_probe() -> ClashCapabilityResult:
    overlap_model, overlap_a, overlap_b = _build_probe_model((0.4, 0.25, 0.2))
    near_model, near_a, near_b = _build_probe_model((1.7, 0.0, 0.0))
    separated_model, separated_a, separated_b = _build_probe_model((5.0, 0.0, 0.0))

    overlap = _clash_counts(overlap_model, overlap_a, overlap_b)
    if overlap.intersection < 1 or overlap.collision < 1:
        raise ClashCapabilityError(
            "known-overlap IfcClash canary did not produce intersection and collision results"
        )

    near_clearance = _clash_counts(near_model, near_a, near_b)
    if (
        near_clearance.intersection != 0
        or near_clearance.collision != 0
        or near_clearance.clearance < 1
    ):
        raise ClashCapabilityError(
            "known-clearance IfcClash canary did not produce clearance-only results"
        )

    separated = _clash_counts(separated_model, separated_a, separated_b)
    if separated != ClashCounts(intersection=0, collision=0, clearance=0):
        raise ClashCapabilityError(
            "known-separated IfcClash canary returned clash results"
        )

    return ClashCapabilityResult(
        ifcopenshell_version=ifcopenshell.version,
        python_version=platform.python_version(),
        platform=platform.platform(),
        pythonocc_bindings_available=bool(geom.has_occ),
        overlap=overlap,
        near_clearance=near_clearance,
        separated=separated,
    )


def main() -> int:
    try:
        result = run_probe()
    except ClashCapabilityError as exc:
        print(
            json.dumps(
                {
                    "capable": False,
                    "error": {
                        "code": "ifc_clash_engine_unavailable",
                        "detail": str(exc),
                    },
                },
                ensure_ascii=False,
                sort_keys=True,
            )
        )
        return 1

    print(json.dumps(result.as_json_dict(), ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())

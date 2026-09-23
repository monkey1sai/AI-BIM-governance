"""Versioned geometry pre-processing profiles (plan §5.2).

A profile decides which IFC classes form the flow obstacle, how outliers are
detected, and how the voxel wrap is parameterised. Every run records the
profile id so exclusions are reproducible.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class PreprocessProfile:
    profile_id: str
    include_classes: frozenset[str]
    exclude_classes: frozenset[str]
    # Elements whose bounding box does not touch the "core" box, expanded by
    # ``outlier_margin_heights`` times the core height, are dropped as outliers.
    outlier_core_percentile: float = 5.0
    outlier_margin_heights: float = 1.0
    # Voxel wrap parameters (metres / voxels).
    voxel_pitch_m: float = 0.5
    closing_radius_voxels: int = 4
    # A second wrap at this larger radius estimates how much interior volume
    # the exterior flood fill reached through openings at the working radius.
    sealing_reference_radius_voxels: int = 8
    sealing_leak_fraction_limit: float = 0.15  # the request schema default is pinned to this value
    keep_largest_shell_only: bool = True
    description: str = ""
    notes: tuple[str, ...] = field(default_factory=tuple)


EXTERIOR_WIND_V1 = PreprocessProfile(
    profile_id="exterior-wind/v1",
    description="Outdoor wind: sealed envelope, windows closed, doors ignored (openings sealed by voxel closing).",
    include_classes=frozenset(
        {
            "IfcWall",
            "IfcWallStandardCase",
            "IfcSlab",
            "IfcRoof",
            "IfcPlate",
            "IfcMember",
            "IfcCurtainWall",
            "IfcWindow",
            "IfcColumn",
            "IfcBeam",
            "IfcCovering",
            "IfcStairFlight",
            "IfcStair",
            "IfcRamp",
            "IfcRampFlight",
            "IfcBuildingElementProxy",
        }
    ),
    exclude_classes=frozenset(
        {
            "IfcDoor",
            "IfcLightFixture",
            "IfcFurniture",
            "IfcFurnishingElement",
            "IfcSanitaryTerminal",
            "IfcFlowTerminal",
            "IfcRailing",
            "IfcSpace",
            "IfcGrid",
            "IfcSite",
            "IfcAnnotation",
            "IfcOpeningElement",
        }
    ),
    voxel_pitch_m=0.5,
    closing_radius_voxels=4,
    sealing_reference_radius_voxels=8,
    notes=(
        "Classes not listed in include or exclude are excluded with reason class_unlisted.",
        "Voxel closing (dilate/erode) seals door openings and curtain-wall gaps up to 2*radius voxels wide so the exterior flood fill stays outside.",
        "Sealing is checked by comparing the kept volume against a wrap at sealing_reference_radius_voxels; the difference is interior volume the exterior reached (leak).",
    ),
)

PROFILES: dict[str, PreprocessProfile] = {EXTERIOR_WIND_V1.profile_id: EXTERIOR_WIND_V1}


def get_profile(profile_id: str) -> PreprocessProfile:
    try:
        return PROFILES[profile_id]
    except KeyError as exc:
        raise KeyError(f"unknown preprocess profile {profile_id!r}; known: {sorted(PROFILES)}") from exc

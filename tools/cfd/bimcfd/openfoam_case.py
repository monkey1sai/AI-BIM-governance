"""Generate and run an OpenFOAM (ESI v2412) steady RANS wind case.

The case follows the ``motorBike``/``turbineSiting`` tutorial structure:
blockMesh background -> snappyHexMesh (castellate + snap, no layers) ->
simpleFoam with k-omega SST and atmospheric-boundary-layer inlet profiles.
Sampling (1.5 m pedestrian plane, building surface pressure, streamlines)
runs as function objects at the end of the run and writes legacy ASCII VTK.
"""

from __future__ import annotations

import json
import math
import subprocess
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path

import numpy as np

from .stl import read_binary_stl, write_binary_stl
from .wind import Domain, domain_from_building, rotate_z, rotation_to_plus_x, wind_vector_model

DEFAULT_IMAGE = "opencfd/openfoam-default:2412"
PEDESTRIAN_HEIGHT_M = 1.5


@dataclass
class CaseParams:
    wind_from_degrees: float
    true_north_degrees: float | None
    uref_m_s: float = 5.0
    zref_m: float = 10.0
    z0_m: float = 0.5
    ground_z_m: float = 0.0
    background_cell_m: float | None = None
    surface_refinement_level: int = 2
    region_refinement_level: int = 1
    end_time: int = 300
    n_procs: int = 8
    turbulence_model: str = "kOmegaSST"
    streamline_seeds: int = 30
    nu_m2_s: float = 1.5e-5
    turbulence_intensity: float = 0.1
    # Caller-supplied assumptions (e.g. the IFC TrueNorth is the default
    # direction) that must travel into case_meta and the run record.
    assumptions: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)


def _foam_header(class_name: str, object_name: str, location: str | None = None) -> str:
    loc = f'    location    "{location}";\n' if location else ""
    return (
        "FoamFile\n{\n    version     2.0;\n    format      ascii;\n"
        f"    class       {class_name};\n{loc}    object      {object_name};\n}}\n\n"
    )


def _vec(values) -> str:
    return "(" + " ".join(f"{float(v):.6g}" for v in values) + ")"


def build_case(*, shell_stl: Path, out_dir: Path, params: CaseParams) -> dict:
    """Write a complete case directory and return its metadata document."""
    out_dir = Path(out_dir)
    for sub in ("system", "constant/triSurface", "0.orig/include"):
        (out_dir / sub).mkdir(parents=True, exist_ok=True)

    true_north = params.true_north_degrees
    assumptions: list[str] = list(params.assumptions)
    if true_north is None:
        true_north = 0.0
        assumptions.append("true_north_unknown_assumed_project_north")
    wind_vec = wind_vector_model(params.wind_from_degrees, true_north)
    alpha = rotation_to_plus_x(wind_vec)

    triangles = read_binary_stl(shell_stl)
    rotated = rotate_z(triangles.reshape(-1, 3), alpha).reshape(-1, 3, 3)
    vertices = rotated.reshape(-1, 3)
    faces = np.arange(vertices.shape[0]).reshape(-1, 3)
    write_binary_stl(out_dir / "constant/triSurface/building.stl", vertices, faces, solid_name="building")

    bbox_min = vertices.min(axis=0)
    bbox_max = vertices.max(axis=0)
    if bbox_max[2] <= params.ground_z_m:
        raise ValueError("building shell lies entirely below ground level")
    domain = domain_from_building(bbox_min, bbox_max, ground_z=params.ground_z_m)
    height = domain.building_height_m
    cell = params.background_cell_m or min(6.0, max(1.5, round(height / 6.0, 2)))
    size = domain.size
    cells = tuple(max(4, int(math.ceil(s / cell))) for s in size)

    location_in_mesh = (
        domain.xmin + 2.0 * height,
        0.5 * (domain.ymin + domain.ymax),
        params.ground_z_m + 0.5 * height,
    )
    refinement_box = {
        "min": (bbox_min[0] - height, bbox_min[1] - height, params.ground_z_m),
        "max": (bbox_max[0] + 2.0 * height, bbox_max[1] + height, bbox_max[2] + height),
    }

    k0 = 1.5 * (params.turbulence_intensity * params.uref_m_s) ** 2
    omega0 = math.sqrt(k0) / (0.09**0.25 * max(0.07 * height, 0.1))
    pedestrian_z = params.ground_z_m + PEDESTRIAN_HEIGHT_M

    _write(out_dir / "system/controlDict", _control_dict(params, domain, pedestrian_z))
    _write(out_dir / "system/fvSchemes", _fv_schemes())
    _write(out_dir / "system/fvSolution", _fv_solution())
    _write(out_dir / "system/blockMeshDict", _block_mesh_dict(domain, cells))
    _write(out_dir / "system/snappyHexMeshDict", _snappy_dict(params, refinement_box, location_in_mesh))
    _write(out_dir / "system/meshQualityDict", _mesh_quality_dict())
    _write(out_dir / "system/decomposeParDict", _decompose_dict(params.n_procs))
    _write(out_dir / "constant/turbulenceProperties", _turbulence_properties(params.turbulence_model))
    _write(out_dir / "constant/transportProperties", _transport_properties(params.nu_m2_s))
    _write(out_dir / "0.orig/include/ABLConditions", _abl_conditions(params))
    _write(out_dir / "0.orig/U", _field_u(params))
    _write(out_dir / "0.orig/p", _field_p())
    _write(out_dir / "0.orig/k", _field_k(k0))
    _write(out_dir / "0.orig/omega", _field_omega(omega0))
    _write(out_dir / "0.orig/nut", _field_nut())
    _write(out_dir / "Allrun", _allrun(), executable=True)
    (out_dir / "case.foam").write_text("", encoding="utf-8")

    meta = {
        "schema": "cfd-case/v1",
        "params": asdict(params),
        "assumptions": assumptions,
        "wind": {
            "wind_from_degrees": params.wind_from_degrees,
            "true_north_degrees_used": true_north,
            "wind_vector_model_xy": [float(v) for v in wind_vec],
            "solver_rotation_alpha_rad": float(alpha),
            "solver_rotation_alpha_deg": math.degrees(alpha),
        },
        "building_bbox_solver_frame": {"min": [float(v) for v in bbox_min], "max": [float(v) for v in bbox_max]},
        "domain": asdict(domain),
        "background_mesh": {"cell_size_m": cell, "cells": list(cells), "cell_count": int(np.prod(cells))},
        "refinement_box": {k: [float(v) for v in vals] for k, vals in refinement_box.items()},
        "location_in_mesh": [float(v) for v in location_in_mesh],
        "initial_conditions": {"k": k0, "omega": omega0},
        "pedestrian_plane_height_m": PEDESTRIAN_HEIGHT_M,
        "pedestrian_plane_z_m": pedestrian_z,
    }
    (out_dir / "case_meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    return meta


def run_case(*, case_dir: Path, image: str = DEFAULT_IMAGE, log_path: Path | None = None, timeout_s: int = 6 * 3600) -> dict:
    """Run ``Allrun`` inside the OpenFOAM container. Returns a run summary."""
    case_dir = Path(case_dir).resolve()
    digest = image_digest(image)
    command = [
        "docker",
        "run",
        "--rm",
        "-v",
        f"{case_dir.as_posix()}:/case",
        image,
        "bash",
        "-c",
        # The image entrypoint changes directory before exec, so be explicit.
        "cd /case && bash ./Allrun",
    ]
    started = time.time()
    log_path = log_path or (case_dir / "docker_run.log")
    with Path(log_path).open("w", encoding="utf-8") as log:
        proc = subprocess.run(command, stdout=log, stderr=subprocess.STDOUT, timeout=timeout_s, check=False)
    return {
        "image": image,
        "image_digest": digest,
        "command": command,
        "exit_code": proc.returncode,
        "elapsed_seconds": round(time.time() - started, 1),
        "log": str(log_path),
    }


def image_digest(image: str) -> str | None:
    try:
        out = subprocess.run(
            ["docker", "image", "inspect", image, "--format", "{{index .RepoDigests 0}}"],
            capture_output=True,
            text=True,
            check=False,
            timeout=60,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    value = out.stdout.strip()
    return value or None


def _write(path: Path, content: str, *, executable: bool = False) -> None:
    path.write_text(content, encoding="utf-8", newline="\n")
    if executable:
        path.chmod(0o755)


def _control_dict(params: CaseParams, domain: Domain, pedestrian_z: float) -> str:
    seed_start = (domain.xmin + 1.0, domain.ymin + 0.1 * (domain.ymax - domain.ymin), pedestrian_z)
    seed_end = (domain.xmin + 1.0, domain.ymax - 0.1 * (domain.ymax - domain.ymin), pedestrian_z)
    return (
        _foam_header("dictionary", "controlDict", "system")
        + f"""application     simpleFoam;

libs            (atmosphericModels);

startFrom       latestTime;
startTime       0;
stopAt          endTime;
endTime         {params.end_time};
deltaT          1;

writeControl    timeStep;
writeInterval   {params.end_time};
purgeWrite      0;
writeFormat     binary;
writePrecision  8;
writeCompression off;
timeFormat      general;
timePrecision   6;
runTimeModifiable false;

functions
{{
    solverInfo
    {{
        type            solverInfo;
        libs            (utilityFunctionObjects);
        fields          (U p k omega);
        writeResidualFields no;
        executeControl  timeStep;
        executeInterval 1;
        writeControl    timeStep;
        writeInterval   1;
    }}

    samples
    {{
        type            surfaces;
        libs            (sampling);
        executeControl  onEnd;
        writeControl    onEnd;
        surfaceFormat   vtk;
        formatOptions
        {{
            vtk
            {{
                legacy  true;
                format  ascii;
            }}
        }}
        fields          (U p);
        interpolationScheme cellPoint;
        surfaces
        {{
            pedestrian_1p5m
            {{
                type            cuttingPlane;
                planeType       pointAndNormal;
                pointAndNormalDict
                {{
                    point   (0 0 {pedestrian_z:.6g});
                    normal  (0 0 1);
                }}
                interpolate     true;
            }}
            building
            {{
                type            patch;
                patches         (building);
                interpolate     false;
            }}
        }}
    }}

    streamlines
    {{
        type            streamLine;
        libs            (fieldFunctionObjects);
        executeControl  onEnd;
        writeControl    onEnd;
        setFormat       vtk;
        // Honoured by the in-solver onEnd write (legacy .vtk); the standalone
        // postProcess utility ignores it and writes .vtp, which we also parse.
        formatOptions
        {{
            vtk
            {{
                legacy  true;
                format  ascii;
            }}
        }}
        U               U;
        fields          (U);
        direction       forward;
        lifeTime        20000;
        nSubCycle       5;
        cloud           particleTracks;
        interpolationScheme cellPoint;
        seedSampleSet
        {{
            type        uniform;
            axis        xyz;
            start       {_vec(seed_start)};
            end         {_vec(seed_end)};
            nPoints     {params.streamline_seeds};
        }}
    }}
}}
"""
    )


def _fv_schemes() -> str:
    return (
        _foam_header("dictionary", "fvSchemes", "system")
        + """ddtSchemes
{
    default         steadyState;
}

gradSchemes
{
    default         Gauss linear;
    limited         cellLimited Gauss linear 1;
    grad(U)         $limited;
    grad(k)         $limited;
    grad(omega)     $limited;
}

divSchemes
{
    default         none;
    div(phi,U)      bounded Gauss linearUpwindV limited;
    div(phi,k)      bounded Gauss limitedLinear 1;
    div(phi,omega)  bounded Gauss limitedLinear 1;
    div((nuEff*dev2(T(grad(U))))) Gauss linear;
}

laplacianSchemes
{
    default         Gauss linear limited corrected 0.33;
}

interpolationSchemes
{
    default         linear;
}

snGradSchemes
{
    default         limited corrected 0.33;
}

wallDist
{
    method          meshWave;
}
"""
    )


def _fv_solution() -> str:
    return (
        _foam_header("dictionary", "fvSolution", "system")
        + """solvers
{
    p
    {
        solver          GAMG;
        smoother        GaussSeidel;
        tolerance       1e-7;
        relTol          0.01;
    }

    Phi
    {
        $p;
    }

    "(U|k|omega)"
    {
        solver          smoothSolver;
        smoother        GaussSeidel;
        tolerance       1e-8;
        relTol          0.1;
        nSweeps         2;
    }
}

SIMPLE
{
    nNonOrthogonalCorrectors 0;
    consistent      yes;

    residualControl
    {
        p               1e-3;
        U               1e-4;
        "(k|omega)"     1e-4;
    }
}

potentialFlow
{
    nNonOrthogonalCorrectors 10;
}

relaxationFactors
{
    equations
    {
        U               0.9;
        k               0.7;
        omega           0.7;
    }
}

cache
{
    grad(U);
}
"""
    )


def _block_mesh_dict(domain: Domain, cells: tuple[int, int, int]) -> str:
    x0, x1, y0, y1, z0, z1 = domain.xmin, domain.xmax, domain.ymin, domain.ymax, domain.zmin, domain.zmax
    verts = [
        (x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
        (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1),
    ]
    vertex_text = "\n".join(f"    {_vec(v)}" for v in verts)
    return (
        _foam_header("dictionary", "blockMeshDict", "system")
        + f"""scale   1;

vertices
(
{vertex_text}
);

blocks
(
    hex (0 1 2 3 4 5 6 7) ({cells[0]} {cells[1]} {cells[2]}) simpleGrading (1 1 1)
);

edges
(
);

boundary
(
    inlet
    {{
        type patch;
        faces ((0 4 7 3));
    }}
    outlet
    {{
        type patch;
        faces ((1 2 6 5));
    }}
    sides
    {{
        type patch;
        faces ((0 1 5 4) (3 7 6 2));
    }}
    top
    {{
        type patch;
        faces ((4 5 6 7));
    }}
    ground
    {{
        type wall;
        faces ((0 3 2 1));
    }}
);

mergePatchPairs
(
);
"""
    )


def _snappy_dict(params: CaseParams, box: dict, location) -> str:
    level = params.surface_refinement_level
    region = params.region_refinement_level
    return (
        _foam_header("dictionary", "snappyHexMeshDict", "system")
        + f"""castellatedMesh true;
snap            true;
addLayers       false;

geometry
{{
    building.stl
    {{
        type triSurfaceMesh;
        name building;
    }}

    refinementBox
    {{
        type searchableBox;
        min {_vec(box["min"])};
        max {_vec(box["max"])};
    }}
}}

castellatedMeshControls
{{
    maxLocalCells   4000000;
    maxGlobalCells  12000000;
    minRefinementCells 10;
    maxLoadUnbalance 0.10;
    nCellsBetweenLevels 3;

    features
    (
    );

    refinementSurfaces
    {{
        building
        {{
            level ({level} {level});
            patchInfo
            {{
                type wall;
                inGroups (wall);
            }}
        }}
    }}

    resolveFeatureAngle 30;

    refinementRegions
    {{
        refinementBox
        {{
            mode inside;
            levels ((1E15 {region}));
        }}
    }}

    locationInMesh {_vec(location)};
    allowFreeStandingZoneFaces true;
}}

snapControls
{{
    nSmoothPatch    3;
    tolerance       2.0;
    nSolveIter      30;
    nRelaxIter      5;
    nFeatureSnapIter 10;
    implicitFeatureSnap true;
    explicitFeatureSnap false;
    multiRegionFeatureSnap false;
}}

addLayersControls
{{
    relativeSizes   true;
    layers
    {{
    }}
    expansionRatio  1.0;
    finalLayerThickness 0.3;
    minThickness    0.1;
    nGrow           0;
    featureAngle    60;
    slipFeatureAngle 30;
    nRelaxIter      3;
    nSmoothSurfaceNormals 1;
    nSmoothNormals  3;
    nSmoothThickness 10;
    maxFaceThicknessRatio 0.5;
    maxThicknessToMedialRatio 0.3;
    minMedialAxisAngle 90;
    nBufferCellsNoExtrude 0;
    nLayerIter      50;
}}

meshQualityControls
{{
    #include "meshQualityDict"
}}

writeFlags
(
    scalarLevels
);

mergeTolerance  1e-6;
"""
    )


def _mesh_quality_dict() -> str:
    return (
        _foam_header("dictionary", "meshQualityDict", "system")
        + """maxNonOrtho         65;
maxBoundarySkewness 20;
maxInternalSkewness 4;
maxConcave          80;
minVol              1e-13;
minTetQuality       1e-15;
minArea             -1;
minTwist            0.02;
minDeterminant      0.001;
minFaceWeight       0.05;
minVolRatio         0.01;
minTriangleTwist    -1;
nSmoothScale        4;
errorReduction      0.75;

relaxed
{
    maxNonOrtho     75;
}
"""
    )


def _decompose_dict(n_procs: int) -> str:
    return (
        _foam_header("dictionary", "decomposeParDict", "system")
        + f"""numberOfSubdomains {n_procs};

method          scotch;
"""
    )


def _turbulence_properties(model: str) -> str:
    return (
        _foam_header("dictionary", "turbulenceProperties", "constant")
        + f"""simulationType  RAS;

RAS
{{
    RASModel        {model};
    turbulence      on;
    printCoeffs     on;
}}
"""
    )


def _transport_properties(nu: float) -> str:
    return (
        _foam_header("dictionary", "transportProperties", "constant")
        + f"""transportModel  Newtonian;

nu              {nu:.6g};
"""
    )


def _abl_conditions(params: CaseParams) -> str:
    return f"""Uref            {params.uref_m_s:.6g};
Zref            {params.zref_m:.6g};
zDir            (0 0 1);
flowDir         (1 0 0);
z0              uniform {params.z0_m:.6g};
zGround         uniform {params.ground_z_m:.6g};
d               uniform 0.0;
kappa           0.41;
Cmu             0.09;
"""


def _field_u(params: CaseParams) -> str:
    return (
        _foam_header("volVectorField", "U", "0")
        + f"""#include        "include/ABLConditions"

dimensions      [0 1 -1 0 0 0 0];

internalField   uniform ({params.uref_m_s:.6g} 0 0);

boundaryField
{{
    inlet
    {{
        type            atmBoundaryLayerInletVelocity;
        #include        "include/ABLConditions"
        value           $internalField;
    }}

    outlet
    {{
        type            inletOutlet;
        inletValue      uniform (0 0 0);
        value           $internalField;
    }}

    sides
    {{
        type            slip;
    }}

    top
    {{
        type            slip;
    }}

    ground
    {{
        type            noSlip;
    }}

    building
    {{
        type            noSlip;
    }}

    "procBoundary.*"
    {{
        type            processor;
    }}
}}
"""
    )


def _field_p() -> str:
    return (
        _foam_header("volScalarField", "p", "0")
        + """dimensions      [0 2 -2 0 0 0 0];

internalField   uniform 0;

boundaryField
{
    inlet
    {
        type            zeroGradient;
    }

    outlet
    {
        type            fixedValue;
        value           uniform 0;
    }

    sides
    {
        type            slip;
    }

    top
    {
        type            slip;
    }

    ground
    {
        type            zeroGradient;
    }

    building
    {
        type            zeroGradient;
    }

    "procBoundary.*"
    {
        type            processor;
    }
}
"""
    )


def _field_k(k0: float) -> str:
    return (
        _foam_header("volScalarField", "k", "0")
        + f"""#include        "include/ABLConditions"

dimensions      [0 2 -2 0 0 0 0];

internalField   uniform {k0:.6g};

boundaryField
{{
    inlet
    {{
        type            atmBoundaryLayerInletK;
        #include        "include/ABLConditions"
        value           $internalField;
    }}

    outlet
    {{
        type            inletOutlet;
        inletValue      $internalField;
        value           $internalField;
    }}

    sides
    {{
        type            slip;
    }}

    top
    {{
        type            slip;
    }}

    ground
    {{
        type            kqRWallFunction;
        value           $internalField;
    }}

    building
    {{
        type            kqRWallFunction;
        value           $internalField;
    }}

    "procBoundary.*"
    {{
        type            processor;
    }}
}}
"""
    )


def _field_omega(omega0: float) -> str:
    return (
        _foam_header("volScalarField", "omega", "0")
        + f"""#include        "include/ABLConditions"

dimensions      [0 0 -1 0 0 0 0];

internalField   uniform {omega0:.6g};

boundaryField
{{
    inlet
    {{
        type            atmBoundaryLayerInletOmega;
        #include        "include/ABLConditions"
        value           $internalField;
    }}

    outlet
    {{
        type            inletOutlet;
        inletValue      $internalField;
        value           $internalField;
    }}

    sides
    {{
        type            slip;
    }}

    top
    {{
        type            slip;
    }}

    ground
    {{
        type            omegaWallFunction;
        value           $internalField;
    }}

    building
    {{
        type            omegaWallFunction;
        value           $internalField;
    }}

    "procBoundary.*"
    {{
        type            processor;
    }}
}}
"""
    )


def _field_nut() -> str:
    return (
        _foam_header("volScalarField", "nut", "0")
        + """#include        "include/ABLConditions"

dimensions      [0 2 -1 0 0 0 0];

internalField   uniform 0;

boundaryField
{
    inlet
    {
        type            calculated;
        value           uniform 0;
    }

    outlet
    {
        type            calculated;
        value           uniform 0;
    }

    sides
    {
        type            calculated;
        value           uniform 0;
    }

    top
    {
        type            calculated;
        value           uniform 0;
    }

    ground
    {
        type            atmNutkWallFunction;
        z0              $z0;
        value           uniform 0;
    }

    building
    {
        type            nutkWallFunction;
        value           uniform 0;
    }

    "procBoundary.*"
    {
        type            processor;
    }
}
"""
    )


def _allrun() -> str:
    return """#!/bin/bash
cd "${0%/*}" || exit 1
export OMPI_ALLOW_RUN_AS_ROOT=1
export OMPI_ALLOW_RUN_AS_ROOT_CONFIRM=1
export OMPI_MCA_btl_vader_single_copy_mechanism=none
. "${WM_PROJECT_DIR:?}/bin/tools/RunFunctions"
set -e

runApplication blockMesh
runApplication decomposePar -force
runParallel snappyHexMesh -overwrite
runParallel checkMesh -constant
restore0Dir -processor
runParallel $(getApplication)
runApplication reconstructParMesh -constant
runApplication reconstructPar -latestTime
echo "ALLRUN_COMPLETE"
"""

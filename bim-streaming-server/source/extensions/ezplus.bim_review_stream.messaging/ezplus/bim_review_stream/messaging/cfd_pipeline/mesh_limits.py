"""Mesh limits shared by the case writer and the host-native job service.

numpy-free on purpose: the job service imports it at module level, and a host without the pipeline's
dependencies must still accept submissions (cfd_job_service.py).
"""

# snappyHexMeshDict ``maxGlobalCells``. Past it snappyHexMesh stops refining early and the mesh comes out coarser
# than requested without failing, so the service's per-direction compute cap never exceeds it (settings phase B §3).
SNAPPY_MAX_GLOBAL_CELLS = 12_000_000

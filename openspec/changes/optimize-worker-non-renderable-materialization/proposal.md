## Why

After `optimize-worker-source-entity-enumeration` burned down the `source_entity_enumeration` bottleneck, the canonical `storage/*.ifc` `--limit 1 --timeout-seconds 600` rerun now advances through `ifc_open` (4.2s) → `source_entity_enumeration` (33.2s) → `geometry_iteration` (198.1s) → `mesh_authoring` (8.5s) before timing out in `non_renderable_entity_materialization`. For the 89MB fixture (`許良宇圖書館建築_2026 - 複製 (10).ifc`), `_worker` materializes one USD `Xform` prim plus six attributes for every unmapped source IFC entity. With approximately 1.5M non-renderable source entities, the Python-level USD authoring loop exceeds the remaining timeout budget. This blocks single-fixture `model.usdc` production, blocks visual preview, and prevents the canonical batch baseline from advancing past `minimum_coverage_locked=false`.

## What Changes

- Optimize `_worker` `non_renderable_entity_materialization` so canonical large IFC fixtures produce `model.usdc` within the configured per-fixture timeout without weakening all-IFC-entity coverage semantics.
- Allow design exploration of a sidecar carrier for non-renderable IFC entity identity (for example `element_mapping.json` or a dedicated `entity_index.json`), provided that `coverage_denominator=source_ifc_entity_count` and stable IFC traceability fields remain intact.
- Add measurable before/after timing evidence for `non_renderable_entity_materialization`, including unmapped entity counts, USD authoring throughput, sidecar carrier write timing when applicable, and timeout/budget diagnostics.
- Secondary scope: reduce the source enumeration `guid_extraction` / `name_extraction` cost (currently ~26s of the 33.2s enumeration window) when it can be done without compromising IFC GUID / Name fidelity. This secondary scope is optional and MUST NOT block the primary materialization burn-down.
- Preserve existing artifact intake, conversion job, lineage, mapping, readiness, and review viewer handoff contracts. The `_bim-control` metadata authority, `bim-review-coordinator` session lifecycle, `web-viewer-sample` UI, `bim-streaming-server` Kit runtime, and any auth / GPU / batch scheduler responsibilities are explicitly out of scope.
- Keep `minimum_coverage_locked=false` unless the full canonical batch still satisfies the archived baseline requirements.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `worker-artifact-pipeline`: require `_worker` non-renderable IFC entity materialization to be profiled and optimized for canonical IFC fixtures. Permit non-renderable IFC entity identity to be carried either as a non-renderable USD prim or as a sidecar mapping artifact, while preserving the all-IFC-entity coverage denominator, stable IFC traceability fields, and backward-compatible review viewer handoff.
- `runtime-verification-evidence`: require optimization evidence to record before/after `non_renderable_entity_materialization` timing, post-change canonical single-fixture rerun result, and (when secondary scope is exercised) before/after `guid_extraction` / `name_extraction` timing.

## Impact

- Owner: `_worker`.
- Likely code paths: `_worker/app/converters.py` (`_materialize_unmapped_entities`, `_unique_prim_path`, identity extraction helpers), `_worker/app/batch_verification.py`, `_worker/app/store.py` (mapping artifact emission), and focused `_worker/tests/*`.
- Data structures: conversion quality metrics, mapping artifact (`element_mapping.json`) and possibly a new sidecar artifact MAY gain non-renderable carrier diagnostics; existing fields must remain backward-compatible.
- CLI: `scripts/verify_storage_batch.py` and the `--profile-source-entities` flag may be extended to also profile materialization; no required CLI breaking change is expected.
- Dependencies: no new production dependency unless a measured standard-library / existing USD path cannot solve the bottleneck.
- Runtime boundary: visual preview remains outside `_worker` and must continue through `bim-review-coordinator`, `web-viewer-sample`, and `bim-streaming-server` after conversion succeeds. If the sidecar carrier option is adopted, the handoff contract to those downstream components MUST be documented in design.

## Why

After `optimize-worker-non-renderable-materialization` shipped the sidecar carrier and turned the canonical 89 MB fixture into a 267.72 s real `model.usdc` run, the next observable burn-down is at **batch scale**, not at single-fixture scale. The canonical `storage/*.ifc` set contains 13 fixtures (`C:\Repos\active\iot\AI-BIM-governance\storage\*.ifc`); only the first 89 MB fixture has produced a real `model.usdc` to date. We do not yet know:

- How often the remaining 12 fixtures will hit `stage_reopen`, `mapping_quality_failed`, or per-fixture timeout at the configured 600 s budget under the sidecar carrier path that just landed.
- Whether the `unmapped_count=2` residue observed on the first fixture (`coverage_ratio=0.99999875`; 2 geometry-shape IFC entities with no `ifc_guid`) recurs across other fixtures and whether the sidecar carrier should pick them up to reach `coverage_ratio=1.0` and `coverage_status=pass`.
- Whether the secondary `guid_extraction` (~10.6 s) + `name_extraction` (~10.0 s) cost in `source_entity_enumeration` is worth optimizing inside `_worker` or should be deferred to its own change.

Because of these unknowns, the spec's `Full canonical batch locks coverage` scenario cannot fire: `minimum_coverage_locked=true` requires all 13 fixtures to pass with `coverage_status=pass`, and we have neither the batch evidence nor a resolution for `unmapped_count=2`. The roadmap §5.2 / §10 #4 explicitly names this as the next worker burn-down.

## What Changes

- Run the full 13-file canonical batch (`verify_storage_batch.py --limit 13 --timeout-seconds 600`) against `WORKER_DEV_STORAGE_ROOT=C:\Repos\active\iot\AI-BIM-governance\storage` under the existing sidecar carrier path and produce a reproducible per-fixture outcome distribution: `passed`, `timed_out`, `failed`, or `mapping_quality_failed` (warn / fail coverage), with phase timings and stable artifact IDs for every fixture that produced a conversion result.
- Resolve the `unmapped_count=2` residue: ensure every source IFC entity that lacks `ifc_guid` (geometry-shape entries; non-renderable entries already covered by the sidecar) resolves to **at least one carrier** so `coverage_status=pass` is achievable. The fix MUST keep the all-IFC-entity coverage denominator, MUST NOT substitute synthetic IDs for real GUIDs, and MUST NOT change the renderable USD prim carrier shape consumed by `web-viewer-sample`.
- Profile (always) and optionally optimize the secondary `guid_extraction` + `name_extraction` cost in `source_entity_enumeration`. Profiling is mandatory so future changes can decide; the actual optimization is **gated** on the primary batch completing and on a measured win ≥ 5 s without IFC GUID / Name fidelity regression. If gated out, defer to a follow-up change with a written reason.
- Only when the full 13-file canonical batch reaches `status=passed` with all per-fixture `coverage_status=pass`, `_worker` MAY emit `minimum_coverage_locked=true` on the batch summary and `minimum_coverage_baseline_locked=true` on each per-fixture quality metrics payload. Anything short of that keeps both keys at `false`.
- Update `worker-artifact-pipeline` and `runtime-verification-evidence` so the spec text reflects: (1) batch outcome distribution evidence requirement, (2) the carrier requirement explicitly covers no-GUID geometry-shape entities, (3) optional secondary enumeration evidence layer.
- Preserve every existing contract: `_bim-control` metadata authority, `bim-review-coordinator` session lifecycle, `web-viewer-sample` UI / DataChannel, `bim-streaming-server` Kit runtime, sidecar artifact schema (`entity_index.json`), lineage graph response, and review viewer handoff. No new dependency; reuse existing `verify_storage_batch.py`.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `worker-artifact-pipeline`:
  - Add a requirement for the full canonical 13-file batch outcome distribution under the sidecar carrier (per-fixture `passed` / `timed_out` / `failed` / `mapping_quality_failed` accounting and rate computation that downstream evidence can cite).
  - Add a requirement that every source IFC entity lacking `ifc_guid` (in particular geometry-shape entries that are not currently picked up by either the renderable USD prim carrier or the sidecar) MUST also resolve to a carrier so `coverage_status=pass` is reachable without weakening the denominator policy.
  - Extend the existing `Worker optimizes source entity enumeration for canonical IFC fixtures` requirement so secondary `guid_extraction` / `name_extraction` cost MUST be measured per canonical burn-down run, with optimization permitted only when GUID / Name fidelity is preserved.
- `runtime-verification-evidence`:
  - Add a requirement that full canonical batch evidence MUST record per-fixture outcome plus the aggregate distribution (counts and rates of `passed` / `timed_out` / `failed` / `mapping_quality_failed`) under the sidecar carrier path; `minimum_coverage_locked=true` MUST NOT be claimed unless every fixture passes.
  - Modify the existing `Source entity enumeration` evidence requirement so secondary `guid_extraction` / `name_extraction` before/after timing is required when the optimization is exercised, and a written deferral statement is required when it is intentionally skipped.

## Impact

- Owner: `_worker`.
- Likely code paths: `_worker/app/converters.py` (sidecar carrier inclusion rule for no-GUID geometry-shape entities), `_worker/app/batch_verification.py` (per-fixture outcome distribution and `mapping_quality_failed` accounting), `_worker/app/store.py` (quality metrics: `coverage_status=pass` reachable when sidecar picks up no-GUID entries), `_worker/scripts/verify_storage_batch.py` (batch CLI surfacing distribution counts), and focused `_worker/tests/*`.
- Data structures: batch summary gains additive `outcome_distribution` (per-status counts and rates); per-fixture quality metrics get an explicit `no_guid_entity_count` diagnostic; sidecar `entity_index.json` semantics broaden so geometry-shape no-GUID entities are valid entries (additive, schema unchanged).
- CLI: `scripts/verify_storage_batch.py` continues to accept `--limit` / `--timeout-seconds` / `--profile-source-entities`; no required breaking change. Distribution rendering MAY be added as an additive diagnostic line.
- Dependencies: no new production dependency.
- Runtime boundary: visual preview remains outside `_worker` and continues through `bim-review-coordinator` + `web-viewer-sample` + `bim-streaming-server` for any single fixture whose conversion succeeds. No coordinator / viewer / Kit changes are in scope.
- Downstream contract: the sidecar artifact schema (`entity_index.json`) and the renderable-prim path on `element_mapping.json` remain backward-compatible. Existing consumers that filter `usd_prim_path` (e.g. `web-viewer-sample/src/Window.tsx`) keep working unchanged because no-GUID geometry-shape entries land in the sidecar, not in renderable prims.

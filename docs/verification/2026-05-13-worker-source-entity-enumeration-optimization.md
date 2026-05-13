# worker-source-entity-enumeration optimization verification

日期：2026-05-13

## Scope

本紀錄對應 OpenSpec change `optimize-worker-source-entity-enumeration`，範圍限於：

- `_worker` IFC source entity identity scan
- `source_entity_enumeration` phase progress / diagnostics
- canonical `storage/*.ifc` single-fixture burn-down evidence
- batch verification timeout evidence 與 roadmap 對齊

本 change 不處理 `_bim-control` metadata authority、`bim-review-coordinator` session lifecycle、`web-viewer-sample`、Kit runtime、WebRTC、GPU provisioning 或 production batch scheduler。

## Baseline Before This Change

前一份 canonical batch evidence：

- File: `docs/verification/2026-05-12-worker-canonical-storage-batch-baseline.md`
- Command: `python scripts\verify_storage_batch.py --limit 1 --timeout-seconds 600`
- Fixture: `許良宇圖書館建築_2026 - 複製 (10).ifc`
- Size: `89394282` bytes
- Result: `timed_out`
- Last known converter phase: `source_entity_enumeration`
- IDs:
  - `source_artifact_id=artifact_src_00de4766405d`
  - `artifact_group_id=ag_61cd043fd19c`
  - `conversion_job_id=conv_20260512095847_74be0bc7`
- Baseline decision: `minimum_coverage_locked=false`

## Implemented Optimization

- `_worker/app/converters.py` no longer materializes `list(model)` before source identity extraction.
- Source identity scan now iterates the IFC model in a single pass and keeps only stable identity fields:
  - `ifc_entity_key`
  - `ifc_entity_id`
  - `ifc_class`
  - `ifc_guid`
  - `name`
- Canonical path does not use `model.by_type("IfcProduct")` fallback for all-entity coverage.
- Long-running enumeration writes additive diagnostics:
  - `enumerated_entity_count`
  - `last_ifc_class`
  - `last_operation`
  - `elapsed_seconds`
  - `fallback_used`
  - `progress_write_count`
- Verification-only profiling can be enabled with `--profile-source-entities` and records:
  - `iteration_seconds`
  - `id_extraction_seconds`
  - `class_extraction_seconds`
  - `guid_extraction_seconds`
  - `name_extraction_seconds`
  - `row_append_seconds`

## Commands And Results

Focused tests:

```powershell
cd _worker
python -m pytest tests\test_worker_converters.py tests\test_worker_batch_verification.py tests\test_worker_store.py -q
```

Result:

- Passed: `67 passed`

API regression check:

```powershell
cd _worker
python -m pytest tests\test_worker_api.py -q
```

Result:

- Initial failure: `TypeError: Router.__init__() got an unexpected keyword argument 'on_startup'`
- Root cause: the active Python user-site had `fastapi 0.111.0` with incompatible `starlette 1.0.0`; `_worker/requirements.txt` requires `starlette==0.37.2`.
- Environment repair: installed `starlette==0.37.2` to match `_worker/requirements.txt`.
- Passed after repair: `38 passed, 1 skipped`

Closeout checks:

```powershell
cd _worker
python -m py_compile app\batch_verification.py app\converters.py app\store.py scripts\verify_storage_batch.py
python -m pytest tests\test_worker_converters.py tests\test_worker_batch_verification.py tests\test_worker_store.py -q
cd ..
openspec validate optimize-worker-source-entity-enumeration --strict
git -c safe.directory=C:/Users/IOT/.codex/worktrees/7fa9/AI-BIM-governance diff --check
```

Result:

- `py_compile`: passed
- focused converter / batch / store tests: `67 passed`
- OpenSpec strict validation: passed
- `git diff --check`: passed with CRLF conversion warnings only

Canonical profiled single-fixture run:

```powershell
cd _worker
$env:WORKER_DEV_STORAGE_ROOT='C:\Repos\active\iot\AI-BIM-governance\storage'
python scripts\verify_storage_batch.py --limit 1 --timeout-seconds 600 --profile-source-entities
```

Result:

- Batch status: `timed_out`
- Fixture count: `13`
- Selected count: `1`
- Fixture: `許良宇圖書館建築_2026 - 複製 (10).ifc`
- Size: `89394282` bytes
- `source_artifact_id=artifact_src_f2b1d643c433`
- `artifact_group_id=ag_d73913408c7f`
- `conversion_job_id=conv_20260513061340_68a74e57`
- `minimum_coverage_locked=false`

Phase timing summary:

| Phase | Status | Duration / detail |
|---|---|---|
| `ifc_open` | `completed` | `4.227619800018147s` |
| `source_entity_enumeration` | `completed` | `33.18823059997521s` |
| `geometry_iteration` | `completed` | `198.07747129997006s` |
| `mesh_authoring` | `completed` | `8.514121699961834s` |
| `non_renderable_entity_materialization` | `timed_out` | timeout during phase |
| `stage_save` | `not_reached` | `phase_not_reached` |
| `stage_reopen` | `not_reached` | `phase_not_reached` |
| `lineage_lookup` | `not_reached` | `phase_not_reached` |

Source enumeration details:

```json
{
  "enumerated_entity_count": 1604773,
  "last_ifc_class": "IfcFaceOuterBound",
  "last_operation": "append_row",
  "elapsed_seconds": 33.18821310001658,
  "fallback_used": false,
  "progress_write_count": 320
}
```

Fine-grained profile:

```json
{
  "iteration_seconds": 2.860572808596771,
  "id_extraction_seconds": 1.2914713947102427,
  "class_extraction_seconds": 1.110036589903757,
  "guid_extraction_seconds": 12.99137868807884,
  "name_extraction_seconds": 12.234985917108133,
  "row_append_seconds": 0.34240990615217015
}
```

## Interpretation

- The original blocker has moved: `source_entity_enumeration` is no longer the timeout phase for the canonical first fixture.
- The post-change run preserved all-IFC-entity semantics and counted `1,604,773` source IFC entities with `fallback_used=false`.
- The next observed blocker is `_worker`-owned `non_renderable_entity_materialization`, not source enumeration.
- No completed `model.usdc` was produced for this canonical fixture in this run.
- Visual preview remains `blocked` because no completed canonical `model.usdc` artifact exists.
- Full 13-file canonical batch remains `not_run`.

## Baseline Lock Decision

- `minimum_coverage_locked=false`
- Production mapping baseline remains unlocked.
- Issue-to-real-prim baseline is not verified.
- No visual preview or full batch pass is claimed.

## Next Follow-Up

Open a separate scoped follow-up to optimize or segment `_worker` non-renderable all-entity materialization for large canonical IFC fixtures. That follow-up should preserve the all-IFC-entity denominator while reducing USD authoring/materialization cost or making materialization resumable/diagnosable enough to complete within the configured verification budget.

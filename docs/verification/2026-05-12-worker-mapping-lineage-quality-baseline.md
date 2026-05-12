# worker-mapping-lineage-quality-baseline 驗證紀錄

日期：2026-05-12

## Scope

本紀錄對應 OpenSpec change `worker-mapping-lineage-quality-baseline`，範圍限於 `_worker`：

- `GET /api/artifacts/{artifact_id}/lineage`
- conversion quality metrics / readiness coverage policy
- all IFC entity -> USD prim coverage semantics
- repo-local `storage/*.ifc` batch verification helper
- worker UI lineage / quality observability

## Fixture Inventory

Worktree-local fixture root:

- Path: `_worker` default `../storage`
- Result: directory exists, but contains `0` IFC files.
- Batch helper output status: `blocked`
- `minimum_coverage_locked=false`

Windows local canonical fixture root:

- Path: `C:\Repos\active\iot\AI-BIM-governance\storage\*.ifc`
- Result: `13` IFC fixtures found.
- Each listed fixture size in dry-run output: `89394282` bytes.
- Dry-run output status: `partial`
- `minimum_coverage_locked=false`

## API / Store / Converter Validation

Passed:

```powershell
cd _worker
python -m py_compile app\store.py app\converters.py app\batch_verification.py app\main.py app\ui.py
python -m pytest --basetemp .\pytest-tmp-worker tests/test_worker_store.py tests/test_worker_converters.py tests/test_worker_batch_verification.py
..\_worker\.venv-pr29\Scripts\python.exe -m pytest --basetemp .\pytest-tmp-pr29 tests
```

Result:

- `56 passed`
- Follow-up clean venv full suite: `94 passed, 1 skipped`
- Clean venv package baseline: `fastapi==0.111.0`, `starlette==0.37.2`, `uvicorn==0.45.0`
- Store tests cover source-only lineage, succeeded derived lineage, stable mapping/index IDs, legacy diagnostics, unlocked coverage, locked pass, warn reviewability, fail blocking, and duplicate fixture identity.
- Converter tests cover all-entity denominator materialization for `IfcProject`, `IfcSite`, `IfcBuilding`, `IfcPropertySet`, `IfcWallType`, `IfcRelDefinesByProperties`, and product geometry.
- Converter tests also cover metadata-only USD rejection so non-renderable IFC entity prims cannot satisfy the renderable mesh hard gate.
- Batch helper tests cover missing fixture root and duplicate IFC bytes with independent source artifact IDs, conversion job IDs, original filenames, and lineage.

Historical local global-env blocker:

```powershell
cd _worker
python -m pytest tests
```

Result:

- Collection failed before reaching worker API tests when using the machine global Python environment.
- Local global dependency state:
  - `fastapi 0.111.0`
  - `starlette 1.0.0`
  - installed FastAPI requirement reports `starlette<0.38.0,>=0.37.2`
- Error: `TypeError: Router.__init__() got an unexpected keyword argument 'on_startup'`
- Interpretation: local global Python environment has an incompatible Starlette version for the installed FastAPI version.
- Mitigation in this change: `_worker/requirements.txt` now pins `fastapi==0.111.0`, `starlette==0.37.2`, and `uvicorn[standard]==0.45.0` to match `_bim-control`.
- Follow-up result: after installing requirements into a clean `_worker/.venv-pr29`, the full `_worker` test suite passed.

## Batch Fixture Verification

Dry-run over canonical Windows fixture root:

```powershell
cd _worker
$env:WORKER_DEV_STORAGE_ROOT='C:\Repos\active\iot\AI-BIM-governance\storage'
python scripts\verify_storage_batch.py --dry-run
```

Result:

- `status=partial`
- `fixture_count=13`
- `selected_count=13`
- `minimum_coverage_locked=false`
- No conversions executed by design.

Real conversion partial run:

```powershell
cd _worker
$env:WORKER_DEV_STORAGE_ROOT='C:\Repos\active\iot\AI-BIM-governance\storage'
python scripts\verify_storage_batch.py --limit 1
```

Observed:

- First attempt failed after `32.37s` because OpenUSD could not create `model.usdc` under a `264`-character worktree-derived path.
- Mitigation implemented: `_worker` now uses a short conversion staging directory when the final object layout path is long, then publishes outputs back into the existing object layout.
- Second attempt ran for `600s` and timed out before producing a completed result.
- No residual task-specific Python conversion process was found after timeout.

Conclusion:

- Batch helper path is implemented and unit-tested.
- Full real fixture baseline is not locked.
- Real all-entity conversion over the 89MB canonical fixture set remains a runtime performance / completion blocker and needs a longer controlled batch run or smaller representative fixtures.

## Coverage Policy Evidence

Implemented behavior:

- `minimum_coverage_ratio=1.0`
- `coverage_denominator=source_ifc_entity_count`
- `minimum_coverage_baseline_locked=false` preserves measure-first behavior.
- `coverage_status=warn` keeps artifact group reviewable but does not mark issue-to-real-prim readiness verified.
- `coverage_status=fail` sets mapping readiness false and uses `ready_status=mapping_quality_failed`.
- Locked pass requires every source IFC entity to map to at least one USD prim.

All-entity converter behavior:

- Geometry/product entities map to renderable mesh prims when geometry exists.
- Non-geometric IFC entities materialize as non-renderable USD prims with IFC traceability attributes.
- Missing or unknown geometry GUIDs remain `unmapped_usd_prims` and do not inflate mapped source entity coverage.

## Kit / Browser Highlight Evidence

Not run.

Reason:

- This change is `_worker`-scoped.
- Single Kit/browser issue highlight requires GPU/Kit/WebRTC prerequisites and should not be marked passed from API/store evidence alone.

Status:

- `blocked`
- No issue-to-real-prim baseline pass claimed.

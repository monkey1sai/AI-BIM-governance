# worker-canonical-storage-batch-baseline 驗證紀錄

日期：2026-05-12

## Scope

本紀錄對應 OpenSpec change `worker-canonical-storage-batch-baseline`，範圍限於：

- `_worker` canonical `storage/*.ifc` batch verification helper
- IFC -> USDC converter phase timing / timeout diagnostics
- conversion lineage / quality payload 中的 preview handoff data
- worker UI lineage / quality view 的 review viewer handoff
- roadmap 對 canonical storage batch readiness 的狀態對齊

`_worker` 仍只擁有 artifact、conversion、lineage 與 quality evidence；visual preview 必須透過既有 `bim-review-coordinator` / `web-viewer-sample` / `bim-streaming-server` flow，不讓 `_worker` 直接 render USD/USDC 或管理 review session。

## Fixture Inventory

Canonical Windows fixture root:

- Path: `C:\Repos\active\iot\AI-BIM-governance\storage\*.ifc`
- IFC count: `13`
- 每個 observed file size: `89394282` bytes
- Filenames:
  - `許良宇圖書館建築_2026 - 複製 (10).ifc`
  - `許良宇圖書館建築_2026 - 複製 (11).ifc`
  - `許良宇圖書館建築_2026 - 複製 (12).ifc`
  - `許良宇圖書館建築_2026 - 複製 (2).ifc`
  - `許良宇圖書館建築_2026 - 複製 (3).ifc`
  - `許良宇圖書館建築_2026 - 複製 (4).ifc`
  - `許良宇圖書館建築_2026 - 複製 (5).ifc`
  - `許良宇圖書館建築_2026 - 複製 (6).ifc`
  - `許良宇圖書館建築_2026 - 複製 (7).ifc`
  - `許良宇圖書館建築_2026 - 複製 (8).ifc`
  - `許良宇圖書館建築_2026 - 複製 (9).ifc`
  - `許良宇圖書館建築_2026 - 複製.ifc`
  - `許良宇圖書館建築_2026.ifc`

Worktree-local fixture root:

- Path: `storage/`
- Result: directory exists, but contains `0` IFC files.
- Decision: intentionally not used for canonical evidence; `WORKER_DEV_STORAGE_ROOT` points to the canonical Windows fixture root.

## Implementation Evidence

Implemented in this change:

- Batch summary / fixture statuses now distinguish `blocked`, `partial`, `timed_out`, `failed`, and `passed`.
- Dry-run and subset runs keep `minimum_coverage_locked=false` and cannot return batch `status=passed`.
- Real runs support configurable `--timeout-seconds` and record timeout duration, last-known phase diagnostics, source artifact ID, artifact group ID, and conversion job ID when available.
- Converter quality metrics now include phase timing fields for:
  - `ifc_open`
  - `source_entity_enumeration`
  - `geometry_iteration`
  - `mesh_authoring`
  - `non_renderable_entity_materialization`
  - `stage_save`
  - `stage_reopen`
  - `artifact_publish`
- Converter writes job-side phase progress so timed-out subprocess runs can report the last internal converter phase.
- Batch fixture results expose `review_viewer_handoff` data: `conversion_job_id`, `artifact_group_id`, source artifact ID, derived USDC artifact ID / URL, mapping artifact ID / URL, readiness state, and quality status.
- Worker UI adds a review viewer handoff action derived from `_worker` APIs; it does not parse/render USD/USDC and does not manage review sessions.

## Commands And Results

OpenSpec validation:

```powershell
openspec validate worker-canonical-storage-batch-baseline --strict
```

Result:

- Passed: `Change 'worker-canonical-storage-batch-baseline' is valid`

Static Python compile:

```powershell
cd _worker
python -m py_compile app\batch_verification.py app\converters.py app\store.py app\ui.py scripts\verify_storage_batch.py
```

Result:

- Passed

Focused tests without FastAPI collection:

```powershell
cd _worker
python -m pytest --basetemp .\pytest-tmp-canonical tests\test_worker_batch_verification.py tests\test_worker_converters.py tests\test_worker_store.py
```

Result:

- Passed: `62 passed`

Global Python full API test attempt:

```powershell
cd _worker
python -m pytest --basetemp .\pytest-tmp-canonical tests\test_worker_batch_verification.py tests\test_worker_converters.py tests\test_worker_store.py tests\test_worker_api.py
```

Result:

- Blocked during collection by known global environment drift:
  - `TypeError: Router.__init__() got an unexpected keyword argument 'on_startup'`
  - Local global environment has FastAPI / Starlette incompatibility, matching the prior verification note.
  - Clean venv full-suite validation below is the authoritative test evidence for this change.

Clean venv full suite:

```powershell
cd _worker
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m pytest --basetemp .\pytest-tmp-clean tests
```

Result:

- Passed: `100 passed, 1 skipped`
- Clean venv baseline includes `fastapi==0.111.0`, `starlette==0.37.2`, and `uvicorn==0.45.0`.

Diff hygiene:

```powershell
git diff --check
```

Result:

- Passed. Git only reported CRLF normalization warnings for touched files.

GitNexus change detection:

- Command/tool: `gitnexus detect_changes(scope=all)`
- Result: affected scope stayed within `_worker`, worker tests, OpenSpec tasks, verification docs, and roadmap docs / HTML.
- Risk level: `critical`, because the touched worker symbols participate in conversion and batch verification flows (`run_storage_batch_verification`, `WorkerStore.complete_conversion_job`, `IfcOpenShellUsdConverter.convert`, and `render_worker_ui`). This is expected for this change and is covered by focused tests plus clean venv full tests above.

Canonical dry-run:

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

Canonical real single fixture run:

```powershell
cd _worker
$env:WORKER_DEV_STORAGE_ROOT='C:\Repos\active\iot\AI-BIM-governance\storage'
python scripts\verify_storage_batch.py --limit 1 --timeout-seconds 600
```

Result:

- Fixture: `許良宇圖書館建築_2026 - 複製 (10).ifc`
- Size: `89394282` bytes
- Fixture `status=timed_out`
- `duration_seconds=600.1694987999508`
- `timeout_seconds=600.0`
- `source_artifact_id=artifact_src_00de4766405d`
- `artifact_group_id=ag_61cd043fd19c`
- `conversion_job_id=conv_20260512095847_74be0bc7`
- `lineage_api_status=not_run`
- `minimum_coverage_locked=false`
- No residual `verify_storage_batch.py` or conversion child process remained after timeout.

The first long run was emitted before a follow-up status-precedence patch, so its batch summary showed `status=partial` while `timed_out_count=1` and the fixture result was `status=timed_out`. After the patch, a short canonical timeout smoke confirmed batch `status=timed_out`.

Canonical short timeout smoke after status / phase-progress patch:

```powershell
cd _worker
$env:WORKER_DEV_STORAGE_ROOT='C:\Repos\active\iot\AI-BIM-governance\storage'
python scripts\verify_storage_batch.py --limit 1 --timeout-seconds 10
```

Result:

- Batch `status=timed_out`
- Fixture `status=timed_out`
- `ifc_open` completed in about `4.39s`
- Last known converter phase: `source_entity_enumeration`
- `geometry_iteration`, `mesh_authoring`, `stage_save`, and `stage_reopen` were not reached within the short timeout.

Interpretation:

- The deterministic blocker is inside `_worker` real conversion before completed evidence is available.
- The first observable bottleneck is source entity enumeration for the canonical 89MB fixture; full bottleneck burn-down still needs optimization or a longer profiling run with phase progress persisted.

## Visual Preview Evidence

Status: `blocked`

Reason:

- Canonical `--limit 1` real conversion did not produce a completed `model.usdc` artifact.
- Therefore no worker-hosted `model.usdc` exists for this canonical fixture to pass into `bim-review-coordinator` / `web-viewer-sample` / `bim-streaming-server`.
- No browser or Kit visual preview is claimed in this change.

## Full Canonical Batch Evidence

Status: `not_run`

Reason:

- Full 13-file real batch is gated behind either:
  - a completed canonical single-fixture conversion, or
  - a deterministic blocker record.
- This session produced a deterministic timeout blocker for the single fixture, so the full batch was intentionally not run.

## Baseline Lock Decision

- `minimum_coverage_locked=false`
- Production mapping baseline remains unlocked.
- Issue-to-real-prim baseline is not verified.
- No full canonical batch pass is claimed.

## Next Follow-Up

1. Optimize or segment `_source_entities(model)` / all-entity enumeration for the 89MB canonical fixture.
2. Re-run:

```powershell
cd _worker
$env:WORKER_DEV_STORAGE_ROOT='C:\Repos\active\iot\AI-BIM-governance\storage'
python scripts\verify_storage_batch.py --limit 1 --timeout-seconds 600
```

3. If single fixture passes, use the emitted `review_viewer_handoff` data to load worker-hosted `model.usdc` through the existing review viewer / Kit flow.
4. Only after the single-file conversion and visual-preview gate has an explicit passed or blocked result should the full 13-file batch be attempted.

# Acceptance — fix-ifc-usdc-hoops-load-failure

## L1 — Unit / contract tests

- `cd bim-streaming-server && python -m pytest tests -q` PASS
- fallback-specific tests prove:
  - HOOPS import failure can call fallback
  - fallback writes `model.usdc` + required sidecars
  - missing fallback prerequisites remain non-ready
  - fake/placeholder outputs are rejected

## L2 — OpenSpec validate

- `openspec validate fix-ifc-usdc-hoops-load-failure --strict` PASS
- `openspec validate --specs --strict` PASS or any unrelated existing failure documented

## L3 — GitNexus

- Before editing symbols: run impact analysis for `Ifc2UsdcPowershellConverterAdapter.convert`, `_run_powershell_conversion`, and any new fallback helper.
- Before commit: run detect changes and confirm affected scope stays in `bim-streaming-server` converter adapter/tests plus this OpenSpec change.

## L4 — Real runtime conversion

Required before archive:

- Use the user-provided external IFC URL or the downloaded equivalent local IFC:
  - `storage/ifc-cache/ifcready_1779433462219_1e2834ae/source.ifc`
  - size approximately `341,328,543` bytes
  - schema `IFC4`
- Create a new conversion job through the B-scheme path, not by manually copying artifacts into result directories.
- `GET /api/external/ifc-ready/<job>` shows `download_status="downloaded"` and `conversion_status="ready"`.
- `GET /api/conversions/<conversion_job_id>/result` shows:
  - `ready=true`
  - `status="succeeded"` or explicitly allowed warning status
  - `model.status="ready"`
  - `artifacts.model_usdc.url` present
  - `quality_metrics.materialization_strategy="ifcopenshell_openusd_fallback"` when fallback was used
- `model.usdc` exists in artifact dir and `Usd.Stage.Open(model.usdc)` succeeds.
- `viewer_url` is produced by coordinator, unless WebRTC/Kit viewer runtime has a separately documented blocker. A viewer/WebRTC blocker MUST NOT be reported as conversion failure if conversion ready evidence passed.

Observed implementation evidence (2026-05-22):

- Fixed conversion API path was exercised through FastAPI `TestClient` with main workspace Kit/HOOPS assets and cached target IFC.
- New streaming conversion job `stream_conv_20260522074249_54684134` returned `status="succeeded"`, `ready=true`, `model.status="ready"`.
- `quality_metrics.materialization_strategy="ifcopenshell_openusd_fallback"`, `coverage_status="pass"`, `mapped_count=5128`.
- Produced artifact:
  - `model.usdc` path: `.worktrees/fix-ifc-usdc-hoops-load-failure/bim-streaming-server/_cache/host-native-conversion-real-ifc-fallback-main-repo/artifacts/stream_conv_20260522074249_54684134/model.usdc`
  - size: `20,453,256` bytes
  - independent USD open check: `openable=True`, `mesh_count=5128`

Remaining before archive:

- Restart/deploy live host-native conversion service on `49101` with this branch's code.
- Submit a fresh coordinator `POST /api/external/ifc-ready` request and verify coordinator-level `conversion_status="ready"`.
- Verify coordinator viewer handoff / `viewer_url`, or record a separate WebRTC/viewer blocker without downgrading conversion readiness.

## Archive gate

Do not archive this change until L1-L4 pass. A failed conversion with better diagnostics is not sufficient; the final accepted result must include a real, openable USD/USDC artifact for the target IFC.

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
- `viewer_url` is produced by coordinator.
- The live web viewer must consume the coordinator session handoff and display the converted artifact for that session. A plain HTTP `200` is not enough if the viewer falls back to `/api/assets` and shows the default demo model.
- A viewer/WebRTC blocker MUST NOT be reported as conversion failure if conversion ready evidence passed, but the change still cannot be archived until the viewer handoff gap is documented or fixed.

Observed implementation evidence (2026-05-22):

- Fixed conversion API path was exercised through FastAPI `TestClient` with main workspace Kit/HOOPS assets and cached target IFC.
- New streaming conversion job `stream_conv_20260522074249_54684134` returned `status="succeeded"`, `ready=true`, `model.status="ready"`.
- `quality_metrics.materialization_strategy="ifcopenshell_openusd_fallback"`, `coverage_status="pass"`, `mapped_count=5128`.
- Produced artifact:
  - `model.usdc` path: `.worktrees/fix-ifc-usdc-hoops-load-failure/bim-streaming-server/_cache/host-native-conversion-real-ifc-fallback-main-repo/artifacts/stream_conv_20260522074249_54684134/model.usdc`
  - size: `20,453,256` bytes
  - independent USD open check: `openable=True`, `mesh_count=5128`

Observed live coordinator evidence after replacing `49101` service (2026-05-22):

- Stopped old `49101` conversion service PID `42236`.
- Started PR branch host-native conversion service on `127.0.0.1:49101`; `/health` returned `status="ok"`, `role="conversion-only"`.
- Fresh coordinator `POST /api/external/ifc-ready`:
  - `ifc_ready_job_id="ifcready_1779436887005_44f9b405"`
  - `conversion_job_id="stream_conv_20260522080140_dfa11d33"`
  - `download_status="downloaded"`
  - downloaded IFC size: `341,328,543` bytes
- Coordinator polling reached:
  - `conversion_status="ready"`
  - `viewer_url="http://127.0.0.1:8004/ui/open?session=review_session_761f0c316079"`
  - `artifact_manifest_ref="http://127.0.0.1:49101/artifacts/stream_conv_20260522080140_dfa11d33/metadata.json"`
- Streaming result for `stream_conv_20260522080140_dfa11d33` returned:
  - `status="succeeded"`
  - `ready=true`
  - `model.status="ready"`
  - `quality_metrics.materialization_strategy="ifcopenshell_openusd_fallback"`
  - `coverage_status="pass"`, `mapped_count=5128`
  - `model_usdc.url="http://127.0.0.1:49101/artifacts/stream_conv_20260522080140_dfa11d33/model.usdc"`
- Artifact checks:
  - `model.usdc` size: `20,453,257` bytes
  - independent USD open check: `openable=True`, `mesh_count=5128`
  - artifact URL download returned the same byte count
- Viewer handoff check:
  - `GET /ui/open?session=review_session_761f0c316079` returned HTTP `200`.
- Viewer session-binding correction after browser evidence showed the default demo asset:
  - Rebuilt Docker viewer container `ai-bim-web-plane-host-kit-viewer-1` from this PR worktree.
  - Playwright opened `http://127.0.0.1:5173/?session=review_session_761f0c316079` at viewport `1280x720`.
  - Screenshot evidence `tmp/viewer-session-761f0c316079.png` showed:
    - `Review session` id `review_session_761f0c316079`
    - review/model status `ready`
    - converted model URL `http://127.0.0.1:49101/artifacts/stream_conv_20260522080140_dfa11d33/model.usdc`
    - conversion summary `materialization_strategy=ifcopenshell_openusd_fallback`, `source_ifc_entity_count=5128`, `coverage_status=pass`
  - HAR evidence showed coordinator session calls:
    - `GET /api/review-sessions/review_session_761f0c316079`
    - `GET /api/review-sessions/review_session_761f0c316079/stream-config`
  - `/api/assets` may still be requested to populate the right-side dropdown, but it no longer controls the primary session/model binding for this URL.

Remaining before archive:

- Implementation PR #101 must be merged into `main`.
- Archive must run from updated `main` on a separate archive branch, then sync specs and roadmap/HTML per `AGENTS.md`.

## Archive gate

Do not archive this change until L1-L4 pass. A failed conversion with better diagnostics is not sufficient; the final accepted result must include a real, openable USD/USDC artifact for the target IFC.

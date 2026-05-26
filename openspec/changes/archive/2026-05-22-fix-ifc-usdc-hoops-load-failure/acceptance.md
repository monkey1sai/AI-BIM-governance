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
- Chrome E2E must prove the Kit-loaded stage URL, not only React metadata. The accepted proof must include a DataChannel `openStageRequest` / `openedStageResult` or `loadingStateResponse` trace whose URL equals the current conversion `model.usdc` URL.
- WebRTC disconnect evidence must be classified separately. If Kit logs contain `NVST_R_BUSY` followed by `Client disconnected from WebRTC server`, the run may keep conversion as `passed`, but viewer/render remains non-passed until reconnect or a deterministic blocker is documented.

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

Corrected runtime evidence from user observation and log inspection (2026-05-22):

- User observed `http://127.0.0.1:5173/?session=review_session_761f0c316079` still rendering the stale `許良宇圖書館建築_2026.usdc` scene and disconnecting after a few seconds.
- Kit process `PID 32216` had been running since `2026-05-21T10:17:23+08:00`, so the WebRTC/Kit runtime was long-lived rather than a fresh per-job instance.
- Kit log search found no `stream_conv_20260522080140_dfa11d33` stage-load line, so the previous viewer screenshot proved metadata display but did not prove Kit opened the converted stage.
- Kit log contained repeated disconnect evidence:
  - `NVST_R_BUSY, dropping frame`
  - `Client disconnected from WebRTC server`
- Kit log contained stale demo stage evidence for `C:/Repos/active/iot/AI-BIM-governance/bim-streaming-server/bim-models/許良宇圖書館建築_2026.usdc`.
- Therefore the following tiers remain incomplete:
  - `DataChannel openStageRequest target artifact`
  - `Kit loaded target stage`
  - `single_kit_render`
  - `reload/reconnect stability`
  - `/ui runtime dashboard observability`

Required additional evidence before archive:

- `/ui` dashboard shows the same current `ifc_ready_job_id`, `conversion_job_id`, `review_session_id`, expected `model.usdc` URL, Kit endpoint, viewer count, and latest WebRTC evidence.
- Chrome E2E starts from `http://192.168.10.105:8004/ui`, opens the viewer, and captures proof that Kit loaded `stream_conv_20260522080140_dfa11d33/model.usdc` or a newer equivalent job's `model.usdc`.
- E2E screenshot/HAR/console/log evidence proves the viewport is not the stale `許良宇圖書館建築_2026.usdc` stage.
- Reload/reconnect either succeeds without killing all Chrome processes or records a deterministic blocker with Kit/WebRTC evidence and next action.

Resolved dashboard + viewer evidence (2026-05-22):

- Evidence directory:
  - `evidence/2026-05-22-e2e-final-stage-truth-matched/` (relocated 2026-05-26 from `docs/evidence/fix-ifc-usdc-hoops-load-failure/` to archive sibling per spec `documentation-source-of-truth`)
- Runtime snapshots:
  - `00-runtime-status.json`: coordinator reports `ifcready_1779449084006_3a0fd2cb`, `conversion_job_id="stream_conv_20260522112506_2b79ba1d"`, `conversion_status="ready"`, `review_session_id="review_session_5f549af0631b"`, `expected_stage_url="http://127.0.0.1:49101/artifacts/stream_conv_20260522112506_2b79ba1d/model.usdc"`.
  - `00-ifc-ready-list.json`: read-only job list exposes `download_status="downloaded"`, `conversion_status="ready"`, `viewer_url`, expected stage/mapping URLs, and omits secret/idempotency fields from the dashboard list.
- `/ui` dashboard evidence:
  - `01-runtime-dashboard.png`
  - `01-runtime-dashboard.json`: Chrome opened `http://192.168.10.105:8004/ui` and observed `downloaded`, `ready`, `Kit / WebRTC`, active session/participant count, `stream_conv_20260522112506_2b79ba1d`, `review_session_5f549af0631b`, and the expected `model.usdc` URL.
- Viewer stage-load evidence:
  - `02-session-viewer-matched.png`
  - `02-session-viewer-matched.json`: Chrome opened `http://127.0.0.1:5173/?session=review_session_5f549af0631b&streamTimeoutMs=180000`; viewer showed `Stage truth matched`, `loaded` equals the expected `model.usdc`, WebRTC `started`, video `1920x1080`, and no `mismatch` / `disconnected` text.
  - `chrome-events.json`: browser console includes DataChannel evidence (`openedStageResult` / `loadingStateResponse`) routed through the viewer's AppStreamer Promise handling.
- Reload/reconnect evidence:
  - `03-session-viewer-reloaded.png`
  - `03-session-viewer-reloaded.json`: same Chrome tab reloaded the session and returned to `Stage truth matched` with the same loaded URL and non-zero video dimensions. This proves the current failure mode no longer requires killing all Chrome processes for a normal reload recovery.
- Root-cause correction:
  - The earlier viewer dropped built-in AppStreamer replies because `AppStreamer.sendMessage(...)` returns a Promise for `openedStageResult`, `loadingStateResponse`, and `getChildrenResponse`; those responses do not arrive via `onCustomEvent`.
  - The fix returns that Promise from `AppStream.sendMessage(...)` and maps the built-in Promise result back into existing viewer handlers, so the UI now records the actual loaded stage URL instead of relying on metadata or a visible video frame alone.

Remaining before archive:

- Implementation PR #101 must be merged into `main`.
- Archive must run from updated `main` on a separate archive branch, then sync specs and roadmap/HTML per `AGENTS.md`.

Archive closeout evidence on synced main (2026-05-22):

- Evidence directory:
  - `evidence/2026-05-22-archive-closeout-e2e/` (relocated 2026-05-26 from `docs/evidence/fix-ifc-usdc-hoops-load-failure/` to archive sibling per spec `documentation-source-of-truth`)
- Chrome/CDP reopened `http://192.168.10.105:8004/ui` after PR #101 was merged and local `main` was fast-forwarded to `origin/main`.
- Dashboard evidence:
  - `01-runtime-dashboard.png`
  - `01-runtime-dashboard.json`: observed `downloaded`, `ready`, `Kit / WebRTC`, active session/participant state, `stream_conv_20260522112506_2b79ba1d`, `review_session_5f549af0631b`, and expected `model.usdc` URL.
- Viewer evidence:
  - `02-session-viewer-matched.png`
  - `02-session-viewer-matched.json`: observed `Stage truth` + `matched`, expected stage URL equal to `http://127.0.0.1:49101/artifacts/stream_conv_20260522112506_2b79ba1d/model.usdc`, WebRTC started, and video `1920x1080`.
- Reload evidence:
  - `03-session-viewer-reloaded.png`
  - `03-session-viewer-reloaded.json`: same Chrome tab reload returned to matched state with video `1920x1080`.
- Summary:
  - `summary.json`: records dashboard/viewer/reload `ok=true` for `review_session_5f549af0631b`.

## Archive gate

Do not archive this change until L1-L4 pass. A failed conversion with better diagnostics is not sufficient; the final accepted result must include a real, openable USD/USDC artifact for the target IFC.

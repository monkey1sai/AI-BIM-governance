# Tasks — fix-ifc-usdc-hoops-load-failure

## 0. Setup

- [x] 0.1 Clean unrelated GitNexus statistic diffs from main.
- [x] 0.2 Create isolated worktree/branch `codex/openspec/fix-ifc-usdc-hoops-load-failure`.
- [x] 0.3 Create OpenSpec scaffold and artifacts.
- [x] 0.4 Commit OpenSpec scaffold before implementation.

## 1. Root-cause evidence

- [x] 1.1 Confirm `POST /api/external/ifc-ready` succeeded for `ifcready_1779433462219_1e2834ae`.
- [x] 1.2 Confirm IFC bytes were downloaded to shared volume and are a real IFC file.
- [x] 1.3 Confirm streaming conversion job `stream_conv_20260522070435_a1883f59` failed with `A3D_LOAD_CANNOT_LOAD_MODEL`.
- [x] 1.4 Confirm IfcOpenShell can parse the same IFC and produce geometry iterator output.

## 2. GitNexus pre-impact

- [x] 2.1 Run impact analysis for `Ifc2UsdcPowershellConverterAdapter.convert`.
- [x] 2.2 Run impact analysis for `_run_powershell_conversion`.
- [x] 2.3 Run impact analysis for fallback scope / adapter class.
- [x] 2.4 Impact remained LOW; no HIGH/CRITICAL stop condition.

## 3. Failing tests first

- [x] 3.1 Add unit test where primary converter failure containing `A3D_LOAD_CANNOT_LOAD_MODEL` triggers fallback.
- [x] 3.2 Add unit test where fallback writes `model.usdc`, `element_mapping.json`, `entity_index.json`, `metadata.json`, and real quality metrics.
- [x] 3.3 Add unit test where missing IfcOpenShell or OpenUSD fallback prerequisite remains non-ready and does not publish ready.
- [x] 3.4 Add test guard that fallback output with no renderable mesh or placeholder marker is rejected.

## 4. Implement fallback converter

- [x] 4.1 Add scoped fallback helper in `bim-streaming-server` messaging converter area.
- [x] 4.2 Lazy import `ifcopenshell`, `ifcopenshell.geom`, and `pxr` only inside fallback path.
- [x] 4.3 Convert IfcOpenShell geometry shapes into USD mesh prims under a stable root prim.
- [x] 4.4 Preserve IFC GUID/name/class where available in mapping and metadata.
- [x] 4.5 Write required sidecars and quality metrics.
- [x] 4.6 Validate generated `model.usdc` with USD stage openability and mesh count.
- [x] 4.7 Wire fallback into `Ifc2UsdcPowershellConverterAdapter.convert` only for primary import failure.

## 5. Local verification

- [x] 5.1 `cd bim-streaming-server && python -m pytest tests -q`
- [x] 5.2 `openspec validate fix-ifc-usdc-hoops-load-failure --strict`
- [x] 5.3 `openspec validate --specs --strict`
- [x] 5.4 GitNexus impact remained LOW; MCP detect-changes cannot see this `.worktrees/` checkout, so `git diff --stat` was used for changed-scope confirmation before commit.

## 6. Real runtime verification

- [x] 6.1 Run the fixed conversion API path via FastAPI `TestClient` using main Kit/HOOPS assets and cached target IFC.
- [x] 6.2 Verify API result `stream_conv_20260522074249_54684134` has `ready=true`, `model.status="ready"`, and fallback quality metrics.
- [x] 6.3 Verify produced `model.usdc` opens with USD runtime and contains 5128 mesh prims.
- [x] 6.4 Restart live host-native conversion service on `49101` with this branch's code.
- [x] 6.5 Submit a new coordinator `POST /api/external/ifc-ready` request with fresh correlation/idempotency.
- [x] 6.6 Poll coordinator until terminal state and verify `conversion_status="ready"` for `ifcready_1779436887005_44f9b405`.
- [x] 6.7 Verify coordinator produces `viewer_url` and viewer handoff URL returns HTTP 200.
- [x] 6.8 Verify the live Docker viewer on `127.0.0.1:5173` consumes `?session=review_session_761f0c316079` and displays the converted artifact URL for `stream_conv_20260522080140_dfa11d33`, not the default demo asset.
- [x] 6.9 Verify Kit log or DataChannel evidence shows `openStageRequest` / `openedStageResult` for current `stream_conv_20260522112506_2b79ba1d/model.usdc` (supersedes the earlier `stream_conv_20260522080140_dfa11d33` runtime job).
- [x] 6.10 Verify the rendered Chrome viewport is not the stale `許良宇圖書館建築_2026.usdc` stage.
- [x] 6.11 Verify reload/reconnect behavior after WebRTC disconnect without requiring all Chrome processes to be killed, or record a deterministic runtime blocker.

## 8. Brainstorming/OpenSpec redesign scope

- [x] 8.1 Capture corrected root-cause understanding: conversion ready is not proof of Kit loaded stage.
- [x] 8.2 Capture WebRTC disconnect evidence from Kit log (`NVST_R_BUSY`, `Client disconnected from WebRTC server`).
- [x] 8.3 Extend proposal/design with `/ui` runtime dashboard and Chrome E2E archive gate.
- [x] 8.4 User approves the design scope before implementation.

## 9. Coordinator `/ui` runtime dashboard

- [x] 9.1 Add tests for read-only IFC-ready job listing endpoint.
- [x] 9.2 Implement `GET /api/external/ifc-ready` to list recent jobs with download/conversion/viewer fields.
- [x] 9.3 Add tests for runtime status endpoint that summarizes sessions, participants, Kit bindings, and configured endpoints.
- [x] 9.4 Implement `GET /api/runtime/status` without adding coordinator USD render/parse responsibility.
- [x] 9.5 Redesign `/ui` first viewport as an operational dashboard showing IFC-ready, download, conversion, artifact, session, Kit/WebRTC, and viewer counts.
- [x] 9.6 Preserve existing dev-console controls under an explicit debug/details section.

## 10. Viewer stage-load and disconnect evidence

- [x] 10.1 Add viewer contract test requiring `?session=` handoff to select `stream_config.stage_composition.primary.url`.
- [x] 10.2 Add viewer contract test for stale/mismatched `loadingStateResponse.url`.
- [x] 10.3 Show expected stage URL, loaded stage URL, conversion job, and mismatch blocker in viewer UI.
- [x] 10.4 Handle AppStreamer `onStop` / `onTerminate` by surfacing `webrtc_disconnected` and allowing remount/reconnect.
- [x] 10.5 Ensure stale `/api/assets` demo entries cannot override the session primary artifact.

## 11. Chrome human-like E2E

- [x] 11.1 Run Chrome/CDP E2E that opens `http://192.168.10.105:8004/ui`.
- [x] 11.2 Drive or select an IFC-ready job and observe download/conversion state through the dashboard.
- [x] 11.3 Open the viewer from `/ui` and wait for WebRTC/DataChannel evidence.
- [x] 11.4 Assert loaded stage URL equals the current conversion `model.usdc` URL.
- [x] 11.5 Assert video dimensions are non-zero and screenshot does not show the stale demo stage.
- [x] 11.6 Reload/reconnect and assert recovery or deterministic blocker.
- [x] 11.7 Save screenshot/console/runtime snapshots as evidence referenced by `acceptance.md`.

## 12. Commit / PR / archive

- [x] 12.1 Commit implementation and OpenSpec artifacts.
- [x] 12.2 Push branch and open PR with Traditional Chinese title/body: PR #101.
- [ ] 12.3 Commit and push the approved runtime dashboard / viewer E2E additions.
- [ ] 12.4 Wait for CI/review and merge.
- [ ] 12.5 Archive only after PR #101 is merged and real runtime conversion + viewer evidence remains valid on synced `main`.
- [ ] 12.6 Sync roadmap Markdown and HTML if archive is performed.

# PR Summary Draft: architecture-rework-2026-05-14

## B 方案摘要

本 PR 將 AI-BIM governance demo runtime 對齊 B 方案：

- `_bim-control`：假 RVT intake facade，保存 source artifact metadata 與 `rvt_uploaded` event。
- `_worker`：RVT→IFC bridge，只產生 `ifc_ready` handoff，不在新 flow 宣告 `model.usdc` ready。
- `bim-streaming-server`：IFC→USDC conversion authority，負責 streaming conversion job、USDC/mapping/entity index/metadata result、no-placeholder-ready 檢查、stage composition 與 Kit runtime。
- `bim-review-coordinator`：session / artifact binding / primary-secondary ordering / viewport sharing metadata，不執行轉檔。
- `web-viewer-sample`：顯示 conversion authority/state，只有 `model.status="ready"` 時送出 `openStageRequest(stage_composition)`。

## Repo boundary

本 PR 沒有建立 nested git repo、submodule、或 `bim-review-platform` 新 repo。`bim-review-platform` 只作為 deployment profile 文件化，仍由既有 service folders 組成：

- `bim-review-coordinator/`
- `bim-streaming-server/`
- `web-viewer-sample/`

## Source-of-truth files updated

- `AGENTS.md`
- `README.md`
- `docs/PROJECT_DEVELOPMENT_WORKFLOW.md`
- `docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md`
- `docs/plans/AI-BIM-governance-saas-roadmap-2026-05.html`
- `openspec/changes/architecture-rework-2026-05-14/docs/architecture/ARCHITECTURE_ALIGNMENT_NOTES.md`
- `docs/contracts/bim-review-platform-boundary.md`
- `docs/verification/2026-05-14-stabilize-demo-runtime-readiness/runbook.md`

## Blocked / deferred runtime items

These are intentionally not marked passed without runtime evidence:

- Real Revit RVT export runtime is blocked unless an external Revit automation host is configured.
- Hosted `bim-streaming-server` conversion API adapter is contract-tested only; a live GPU/Kit conversion pass still requires runtime wiring.
- `single_kit_render` requires a live Kit process, WebRTC signaling, DataChannel `openedStageResult`, nonzero video dimensions, and screenshot evidence.
- `single_kit_multi_viewer` is deferred until primary + spectator browser evidence is captured against one shared Kit instance.
- Legacy `_worker` IFC→USDC fixture evidence is retained only as compatibility context and is not promoted to B 方案 `streaming_conversion_job=passed`.

## Verification

- `openspec validate architecture-rework-2026-05-14 --strict`
- `_bim-control`: `python -m pytest tests\test_rvt_intake_api.py -q`
- `_worker`: `python -m pytest tests\test_worker_rvt_bridge_api.py -q`
- `bim-streaming-server`: `python -m pytest tests\test_conversion_authority_api.py -q`
- `bim-streaming-server`: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\tests\test-stage-loading-contract.ps1`
- `bim-review-coordinator`: `npm test -- --run tests/sessions.test.ts`
- `bim-review-coordinator`: `npm run build`
- `web-viewer-sample`: `npm run test:session-first`
- `web-viewer-sample`: `npm run test:conversion-summary-card`
- `web-viewer-sample`: `npm run build`
- root smoke evidence contract: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\tests\test-smoke-evidence.ps1`
- root smoke script syntax parse: `scripts\smoke-review-session.ps1`

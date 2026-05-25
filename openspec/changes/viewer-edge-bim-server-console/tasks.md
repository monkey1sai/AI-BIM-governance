# Tasks — viewer-edge-bim-server-console

## 0. Setup

- [x] 0.1 Create branch `codex/openspec/viewer-edge-bim-server-console` from
      latest `main`.
- [x] 0.2 Inspect existing `web-viewer-sample/src/Window.tsx`(1,809 行)+
      Inspector / DemoControlPanel / USDAsset / ReviewLauncher / PresencePanel
      structure.
- [x] 0.3 Create OpenSpec scaffold:proposal / design / tasks / spec delta.

## 1. Schema expansion(viewer 端 type alignment with C1 / C4)

- [ ] 1.1 修改 `web-viewer-sample/src/types/review.ts`:
      - `ConversionQualityMetricsSummary` 加 `semantic_mapping_fidelity?:
        string | null` / `mapping_has_ifc_type?: boolean | null` /
        `mapping_has_ifc_name?: boolean | null`
      - `ReviewLifecycleStatus` 加 `"queued_for_conversion"` /
        `"dropped_on_restart"`
- [ ] 1.2 確認 `npm run build` 通過(tsc + vite build no error)

## 2. Tri-ready helper

- [ ] 2.1 新增 `web-viewer-sample/src/utils/triReady.ts`:
      - `export type TriReadyState = "yes" | "no" | "incomplete"`
      - `computeFileReady(streamConfig)`
      - `computeRuntimeReady(webrtcLifecycle, stageLoadStatus)`
      - `computeSemanticReady(qualitySummary)`
- [ ] 2.2 新增 `web-viewer-sample/verify-tri-ready-states.mjs`(仿
      `verify-conversion-summary-card.mjs` pattern):mock streamConfig 三組
      fixture,assert tri-ready 值符合預期。
- [ ] 2.3 `npm run verify` 或 `node verify-tri-ready-states.mjs` 通過。

## 3. Debug query gate

- [ ] 3.1 新增 helper(可放在 `web-viewer-sample/src/config/env.ts` 或
      `Window.tsx` 內聯)`isDebugQueryEnabled(): boolean`,讀 URL `?debug=1`。
- [ ] 3.2 `Window.tsx` 內 USDAsset / USDStage 區段條件渲染:`{isDebugQueryEnabled() && <USDAsset .../>}`。

## 4. Delete fast-MVP-irrelevant UI

- [ ] 4.1 刪除 `web-viewer-sample/src/components/ReviewLauncher.tsx`(若 fast
      MVP 無對外用途)+ Window.tsx import / render 解除。
- [ ] 4.2 刪除 `web-viewer-sample/src/components/PresencePanel.tsx` + import /
      render 解除。
- [ ] 4.3 刪除 `web-viewer-sample/src/components/ArchitectureOverview.tsx`(repo
      map 入口)+ 解除任何 import。
- [ ] 4.4 檢查 `web-viewer-sample/src/clients/reviewSocket.ts` 殘留
      collaboration handler;若有 highlight / selection / annotation event
      handler 仍存在,移除。
- [ ] 4.5 `DemoControlPanel`:刪除 issue 試標 / Socket.IO event log /
      collaboration 區段;保留 mapping verification 操作(改名 / 移到
      MappingVerificationPanel)。

## 5. Edge Console layout 元件

- [ ] 5.1 新增 `web-viewer-sample/src/components/EdgeConsoleTopBar.tsx`:
      project_id / external_model_version_id / review_session_id /
      三段 ready badge。
- [ ] 5.2 新增 `web-viewer-sample/src/components/EdgeConsoleBottomStrip.tsx`:
      webhook / conversion / stage / WebRTC 四段。
- [ ] 5.3 新增 `web-viewer-sample/src/components/RightInspector.tsx`(或拆四個
      子元件 BindingPanel / ConversionQualityPanel / MappingVerificationPanel /
      TechnicalDetailsPanel)。
- [ ] 5.4 在 `Window.tsx` render 中 wire 新 layout(保留既有 AppStream / stage-
      truth-panel)。

## 6. Verify

- [ ] 6.1 `cd web-viewer-sample && npm run build`
- [ ] 6.2 `cd web-viewer-sample && node verify-tri-ready-states.mjs`
- [ ] 6.3 既有 `node verify-conversion-summary-card.mjs` 仍通過
- [ ] 6.4 `cd web-viewer-sample && npm run lint`(目前 baseline 有
      pre-existing errors,不要求清零;新加 file 不可新增 error)
- [ ] 6.5 `openspec validate viewer-edge-bim-server-console --strict`
- [ ] 6.6 `openspec validate --specs --strict`

## 7. Commit / PR

- [ ] 7.1 `git diff --cached --check`
- [ ] 7.2 Commit (可分多 commit):`feat(viewer): Edge BIM Data Server Console
      IA + 三段 ready (viewer-edge-bim-server-console)`
- [ ] 7.3 Push branch and open PR with Traditional Chinese title / body.
- [ ] 7.4 Wait for GitHub Actions verify + human review.

## 8. Archive (post-merge,depends on C1 + C4 merged)

- [ ] 8.1 Sync local main with `origin/main`.
- [ ] 8.2 `openspec archive viewer-edge-bim-server-console`.
- [ ] 8.3 Sync delta into `openspec/specs/session-first-review-viewer/spec.md`.
- [ ] 8.4 Update `docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md` and
      regenerate the HTML view.
- [ ] 8.5 Chrome E2E archive evidence:TopBar / Inspector / BottomStrip /
      三段 ready / `?debug=1` toggle 驗證(本 archive 真實 visual evidence)。
- [ ] 8.6 Closeout per `AGENTS.md`:check / delete merged branches and report.

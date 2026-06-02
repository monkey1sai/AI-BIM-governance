# Design — harden-web-viewer-test-resilience

## Context

`web-viewer-sample` 是純前端 Vite/React/TS app（`moduleResolution=bundler`，已是 Vitest 標準搭配）。現況測試靠 4 個自製 `.mjs`（`verify-session-first-contract` / `verify-conversion-summary-card` / `verify-tri-ready-states` / `verify-struct-log`），全部用 `typescript` 套件的 `ts.transpileModule()` 即時轉 CJS + `node:assert/strict` + `new Function` 同進程 eval，刻意零 test framework。`Window.tsx`（1891 行）頂層有約 14 個 module-level 純函式（`isBlockedLifecycle` / `lifecycleStatusText` / `sameStreamEndpoint` / `sameStreamTransportEndpoint` / `appStreamResultToAppEvent` / `expectedStageUrlFromStreamConfig` / `displayNameFromStageUrl` 等）無 React/DOM 副作用、易測但無單測。

**GitNexus 拓樸（關鍵）**：`web-viewer-sample` 是**獨立** index（名為 `web-viewer-sample`，216 symbols / 18 flows），**不在** `AI-BIM-governance` index（6499 nodes）內。所有 web-viewer 的 `gitnexus_impact` / `context` / `detect_changes` **必須帶 `repo: "web-viewer-sample"`**。實測 `computeRuntimeReady` 解析為 `src/utils/triReady.ts`、incoming 只有 `verify-tri-ready-states.mjs` → blast radius 極小，純前端可安全改。

## Goals / Non-Goals

**Goals**：引入 vitest 純函式單測骨架（devDep）；修 8 個健壯性風險（#17 #27 #8 #28 #15 #16 #18 #32），把 demo-time 失效前移到 build-time。

**Non-Goals**（明確不做）：

- 不修改 `bim-review-coordinator`（含 `src/types.ts` `KitInstanceBinding` 加 `role`、`app.ts` 回填 role）——#15 靠 viewer 既有 `viewport_sharing.primary_kit_instance_id` 自足。
- 不修改 `bim-streaming-server`（Kit / WebRTC / IFC→USDC runtime）任何程式碼。
- 不改動任何對外 contract：coordinator REST / Socket.IO event shape、DataChannel command/event JSON、callback outbox payload 一律不變。
- 不新增任何 production dependency；vitest / jsdom 一律進 `devDependencies`。
- 不升級 `@nvidia/omniverse-webrtc-streaming-library`（`terminate(false)` 在已釘的 ^5.6.0 即可用）。
- 不清零既有 30 個 pre-existing ESLint errors（獨立 debt，不阻塞 vitest 引入；verify 鏈不含 lint）。
- 不一次刪除既有 4 個自製 `.mjs` verify 腳本——vitest 版綠燈前並存，`verify-session-first` 這類跨檔 source-level contract guard 長期保留。
- `BimControlClient → ReviewMetadataClient` 純改名重構為 optional / 可拆獨立 change，**非** #18 的硬性 in-scope（#18 核心是 env boundary 修補）。

## Decisions

1. **#17 vitest 版本與環境**：選 `vitest@^1.x`（對齊 `vite@^5.0.8`、`engines.node` 限 ^20，避免 vitest 2/3 拉高需求或引入未驗證 breaking）；DOM 用 `jsdom@^24`（生態最穩、與 testing-library 相容性最佳，為日後 component test 預留）；**本輪 NOT 引入 `@testing-library/*`**，只測純函式。新增獨立 `vitest.config.ts`（`test.environment='jsdom'`、`globals=true`、`include=['src/**/*.{test,spec}.{ts,tsx}']`），不動 `vite.config.ts` build 路徑；`tsconfig.json` `types` 加 `vitest/globals`。

2. **#8 公開 API 已證實（非推測）**：`package.json` pin `^5.6.0`、實裝 5.17.0；`dist/omniverse-webrtc-streaming-library.d.ts` L71 `static terminate(terminateApp?: boolean): Promise<StreamEvent>`（單一參數，無 `_force`），JSDoc 明說「If `terminateApp` is true, then the Kit app instance will also be terminated」與「the stream reference will be reset and will no longer be accessible」。`App.tsx` `_resetStream` 已是正確用法（`terminate()` 無手動清 `_stream`），`AppStream` 兩處 hack 與之對齊即可。`terminate(false)` = 清 client 端 stream + SDK 自重置 `_stream`，但**不**殺 server 端 Kit process（符合 viewer 不得停 Kit 的 boundary）。`stop()` 方法名保留（避免動呼叫端），語意僅 cleanup。

3. **#15 用既有欄位顯式辨識 primary（零跨 repo）**：viewer 端 `ReviewStreamConfig.viewport_sharing.primary_kit_instance_id` 已存在（`types/review.ts` L104-108）。判定規則：`kit_instance_id === viewport_sharing.primary_kit_instance_id` 即 primary，其餘為 spectator——不需 coordinator 新增任何欄位。抽 `selectSpectatorBinding(bindings, primaryKitInstanceId, webrtc)` 純函式，primary id 缺失時退回既有 port-diff fallback（向後相容）。

4. **#16 spectator 信任 primary serving stage**：spectator 連的是 coordinator 已保證 `spectator_ready=true` 的 Kit（已在 serving stage），不自行 load+confirm。spectator setState 加 `stageLoadStatus: 'matched'`，使 `computeRuntimeReady('started', 'matched') === 'yes'`。語意正確且不偽宣告（spectator 不獨立持有 stage-load 證據，信任 primary 是設計意圖）。

5. **#18 只修 env boundary，改名 defer**：`env.ts` 移除 `VITE_BIM_CONTROL_API_BASE` override，`bimControlApiBase` 改為 `queryCoordinatorApiBase || envCoordinatorApiBase`（永遠等於 `coordinatorApiBase`）。抽 `resolveBimControlBase` 純函式做 vitest。類別 / 欄位改名拆 optional follow-up（約 8 處引用 + 同步 `verify-session-first` token 斷言），避免 CH-4 scope 膨脹。

6. **timer / class-method 測試策略**：class component method 的 timer 行為直接 unit test 成本偏高（需 instantiate React component）。決策：能抽成純函式的決策（如 `shouldRetryPoll(retryCount, max)`）寫 vitest；timer 生命週期（存 id / unmount clear）以 **source-level 斷言 + 手動 demo** 驗證，timer unit test 標 best-effort，不阻塞本輪。

7. **既有 .mjs 並存策略（本輪實際交付）**：本輪 vitest 覆蓋抽出的純函式（`windowHelpers` / `pollHelpers` / `envHelpers`）與 `triReady`（`triReady.test.ts`，含 #16 spectator `started + matched → yes` 情境）；`verify-struct-log` 改寫成 `structLog.test.ts` **defer**（該 `.mjs` 已 10 test 綠燈，本輪不重寫）。既有 4 個 `.mjs` 一律**暫保留**直到 vitest 版穩定；`verify-session-first-contract`（跨檔 source-level contract guard）因 #17 抽函式改查 `Window.tsx + windowHelpers.ts` 聯集，長期保留。

## Risks / Trade-offs

- **vitest 引入動 build 鏈**：以獨立 `vitest.config.ts` 隔離，`vite build` 產物不變為驗收條件（baseline 對照）。
- **#16 信任 primary 可能掩蓋 spectator 真實 stage 不一致**：trade-off 已接受——spectator 本就不持有獨立 stage-load 證據，coordinator 的 `spectator_ready` 是權威；若未來要 spectator 獨立驗證需 coordinator 回傳更多欄位（跨 repo，defer）。
- **#32 動態載入改變 GFN 初始化時序**：`onload` 後才初始化、`onerror` 走失敗回饋，比無條件同步載入多一個 async 邊界；以 `source === 'gfn'` gate + id 防 double-mount 控制。
- **#18 移除 env override 改變既有部署彈性**：若有人依賴 `VITE_BIM_CONTROL_API_BASE` 指向獨立 bim-control，將失效——但這正是要修的 boundary 漏洞，且現況 bim-control 已退役（coordinator 為唯一 metadata authority）。

## Verification

baseline（動工前，現況 package.json）→ apply 後同尺再比：

- `web-viewer-sample`：`npm run verify`（= `vite build && verify-struct-log`）+ `npm run test:session-first` 須維持綠燈。
- 新增 `npm run test`（vitest run）須全綠（涵蓋抽出純函式）。
- `npm run build` 產物正常（確認 `vitest.config.ts` 獨立、`index.html` 移除 GFN script 後 vite build 不報錯）。
- root pytest 回歸（不應受 web-viewer 改動影響）：`.venv\Scripts\python.exe -m pytest tests -p no:cacheprovider`。
- `openspec validate harden-web-viewer-test-resilience --strict`。
- GitNexus：改前 `impact({target, direction:'upstream', repo:'web-viewer-sample'})`、改後 `detect_changes({repo:'web-viewer-sample'})`。
- 手動 demo（無法 unit 的部分）：spectator 連線後 Runtime tri-state 轉 `yes`（#16）、spectator 正確挑到 spectator binding（#15）、stream disconnect/重連不殘留舊 peer（#8）。

## Deferred follow-ups（兩輪 review 揭露，本 PR 不擴大 scope）

- **reviewRequestId + BimControlClient legacy 路徑 endpoint gap**（Codex）：viewer 用 `?reviewRequestId=` 開啟時，`BimControlClient.getReviewSessionRequest()` / `.getArtifacts()` 打 `/api/review-session-requests/{id}`、`/api/model-versions/{id}/artifacts`，coordinator 只有 `/api/review-sessions`、`/api/external/ifc-ready`，會 404。此為 bim-control 退役後的**既有 gap**（非 #18 引入：實測 `VITE_BIM_CONTROL_API_BASE` 未在任何 deploy/config 設定，預設下 #18 前後皆打 coordinator；主路徑 session-first 不受影響）。完整修法 = viewer 遷移到 coordinator endpoint 或 coordinator 補對應 route，與 `BimControlClient → ReviewMetadataClient` 改名一併處理（跨 repo）。
- **#28 逾時不釋放 streaming session**（Codex）：逾時 `_resetState` 清掉 `sessionId` 但未 `destroyStreamingSession`，server 端 session 可能孤兒到 idle timeout。viewer 主動 release 牽涉 server lifecycle boundary，列 follow-up（原 baseline 為無上限 poll、永不 reset，#28 已是淨改善）。
- **#16 spectator readiness 不 refresh**（Codex）：`spectator_ready=false` 時維持 pending（符合本 change spec「非真時 pending」），但 coordinator 連線後才 flip `spectator_ready` 時 viewer 不自動 refresh、需 reload。spec 未要求即時 refresh；列 follow-up（加 streamConfig re-poll / socket 監聽 viewport_sharing 變化）。
- **reconnect await terminate / GFN unmount guard**（Codex P2）：`_reconnectStream` 未 await teardown（reconnect 既有 async pattern）；`source==='gfn'` unmount-during-load 的 `onload` 競態（demo 走 stream/local 不踩）。皆 pre-existing / 窄窗，列 follow-up。

## Rollout

單一 PR；merge 後 archive 並同步 roadmap §1.6。改名（ReviewMetadataClient）若需要另開獨立 change。

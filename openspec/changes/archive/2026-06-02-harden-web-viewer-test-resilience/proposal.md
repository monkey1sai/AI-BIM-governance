# harden-web-viewer-test-resilience

## Why

`web-viewer-sample` 目前**零 test framework**：CI 只靠 4 個自製 `.mjs`（`ts.transpileModule` + `node:assert` 即時 eval source）做 source-level contract smoke，`verify-struct-log.mjs` 註解甚至明說刻意跳過 test framework。任何純函式 regression 只能靠手動 demo 才會發現。

同時散落多個「demo 當下才爆」的脆弱點：

- `pollForSessionReady` **無上限 retry**，且 catch 分支靜默殺死整條 poll、無 UI 回饋；
- spectator 連線後 `stage_truth` 永遠 `pending` → Runtime ready 永遠 `incomplete`；
- spectator binding 靠「找第一個 transport 與 primary 不同的 binding」**port 隱性挑選**，無顯式 role；
- `index.html` **無條件**注入 GeForceNow CDN script，CSP 阻擋或離線時 `GFN` ReferenceError 炸整頁；
- `env.ts` 的 `VITE_BIM_CONTROL_API_BASE` 可讓前端**繞過 coordinator boundary** 直指 bim-control；
- `AppStream` 兩處用 `(AppStreamer as any)._stream = null` **私有成員 hack** 清流；
- `_pollForKitReady` 裸 `setTimeout` **未存 id**，unmount 後仍遞迴 `setState` 並產生並行 poll chain。

本 change 引入 vitest 純函式單測骨架（devDep），並修掉上述 8 個健壯性風險（#17 #27 #8 #28 #15 #16 #18 #32），把「demo 當下才爆」變成「build 時就有 test / 防禦擋住」。所有改動皆純前端、低 blast radius（GitNexus `web-viewer-sample` index 顯示這些 symbol 只被自製 verify 腳本引用），不觸碰 coordinator / streaming-server 或任何對外 contract。

## What Changes

- **#17 引入 vitest 測試框架**：`devDependencies` 加 `vitest`（^1.x，對齊 vite ^5）、`jsdom`（^24）；新增獨立 `vitest.config.ts`（`environment='jsdom'`、`globals=true`、不污染 `vite.config.ts` build 路徑）；`scripts` 加 `test`/`test:watch`；`verify` 改為 `build && test && test:struct-log`。第一輪抽 `src/utils/windowHelpers.ts` 容納 Window.tsx 的 module-level 純函式並寫 colocated `*.test.ts`。
- **#27 `_pollForKitReady` timer race**：新增 `_pollForKitReadyId` 欄位，改用 `window.setTimeout` 存 id、callback 入口清 id、`componentWillUnmount` clear（與既有 4 個 `_clear*` 對稱）。
- **#8 私有 `_stream` hack → 公開 `terminate(false)`**：`AppStream.tsx` 兩處 `stop() + (AppStreamer as any)._stream = null` 換成 `AppStreamer.terminate(false)`（已從實裝 SDK 5.6.0 `.d.ts` 驗證為公開 API）。
- **#28 `pollForSessionReady` 無上限 retry**：加 `retryCount` + `MAX_POLL_RETRIES = 36`（10s×36 ≈ 6 分鐘），上限呼叫 `_resetState()` + setState 逾時錯誤文字；catch 分支改 reschedule 到上限而非靜默停止。
- **#15 spectator binding port 隱性挑選 → 顯式 primary 辨識**：`_resolveStreamEndpoint` 改用既有 `viewport_sharing.primary_kit_instance_id` 顯式判定 primary / spectator，port-diff 僅作 fallback；**零跨 repo、零新欄位**。
- **#16 spectator `stage_truth` 永久 pending**：spectator 分支 setState 加 `stageLoadStatus: 'matched'`（信任 coordinator 保證 `spectator_ready` 的 primary serving stage），使 spectator Runtime ready 能轉 `yes`。
- **#18 env 繞過 coordinator boundary**：`env.ts` 移除 `VITE_BIM_CONTROL_API_BASE` override，`bimControlApiBase` 永遠等於 `coordinatorApiBase`（前端不得經 env 繞過 coordinator）。`BimControlClient → ReviewMetadataClient` 純改名 **defer 為 optional follow-up**。
- **#32 無條件外部 CDN**：刪 `index.html` 的 GFN inline script；改 `AppStream` 僅在 `StreamConfig.source === 'gfn'` 時動態 `createElement('script')` 插入（帶 id 防 double-mount、`onload` 才初始化、`onerror` 走失敗回饋），CSP 阻擋 / 離線時不炸整頁。

## Impact

- **Affected specs**：`session-first-review-viewer`（MODIFIED 3 requirements，新增 spectator-binding / coordinator-boundary / poll-bounded / stream-teardown / sdk-load-failure / spectator-trusts-primary 等 scenario）。
- **Affected code**：`web-viewer-sample/` — `App.tsx`、`Window.tsx`、`AppStream.tsx`、`src/env.ts`、`index.html`、`package.json`、新增 `vitest.config.ts`、`src/utils/windowHelpers.ts` 及 colocated `*.test.ts`。
- **不改動**：`bim-review-coordinator`、`bim-streaming-server`、任何對外 contract（coordinator REST / Socket.IO event shape、DataChannel command/event JSON、callback payload）。
- **新 dependency**：`vitest` / `jsdom` 進 `devDependencies`（非 production）；不升級 `@nvidia/omniverse-webrtc-streaming-library`（`terminate(false)` 在已釘的 ^5.6.0 即可用）。

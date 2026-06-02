# Tasks — harden-web-viewer-test-resilience

## 1. #17 引入 vitest 測試框架（devDep）

- [ ] 1.1 `package.json` `devDependencies` 加 `vitest`（^1.x）、`jsdom`（^24）；`scripts` 加 `"test": "vitest run"`、`"test:watch": "vitest"`；`verify` 改為 `npm run build && npm run test && npm run test:struct-log`
- [ ] 1.2 新增 `vitest.config.ts`（`test.environment='jsdom'`、`globals=true`、`include=['src/**/*.{test,spec}.{ts,tsx}']`，不污染 `vite.config.ts`）；`tsconfig.json` `types` 加 `vitest/globals`
- [ ] 1.3 抽 `src/utils/windowHelpers.ts`，從 `Window.tsx` 搬 module-level 純函式（`isBlockedLifecycle` / `lifecycleStatusText` / `sameStreamEndpoint` / `sameStreamTransportEndpoint` / `appStreamResultToAppEvent` 等），`Window.tsx` 改 import；寫 colocated `windowHelpers.test.ts`

## 2. #27 `_pollForKitReady` 裸 setTimeout race

- [ ] 2.1 `Window.tsx` 新增 `private _pollForKitReadyId: number | null = null`；`_pollForKitReady` 改 `window.setTimeout` 存 id、callback 入口先把 id 設 null
- [ ] 2.2 `componentWillUnmount` 加 clear（可抽 `_clearPollForKitReady()` 與既有 4 個 `_clear*` 對稱）；`verify-session-first` 加 source-level 斷言（含 `_pollForKitReadyId` token + clear 呼叫）

## 3. #8 私有 `_stream` hack → 公開 `terminate(false)`

- [ ] 3.1 `AppStream.tsx` `componentWillUnmount`（L167-168）與 `static stop`（L188-189）兩處 `stop() + (AppStreamer as any)._stream = null` 換成 `AppStreamer.terminate(false)`
- [ ] 3.2 `verify-session-first` 加斷言：`AppStream.tsx` grep `_stream` / `as any` 為 0、含 `terminate(false)`

## 4. #28 `pollForSessionReady` 無上限 retry

- [ ] 4.1 `App.tsx` `pollForSessionReady` 加 `retryCount` 參數 + `MAX_POLL_RETRIES = 36`；上限呼叫 `_resetState()` + setState 逾時錯誤文字；catch 分支改 reschedule 到上限（不靜默停止）
- [ ] 4.2 抽 `shouldRetryPoll(retryCount, max)` 純函式 + colocated vitest（達上限 false、未達 true）

## 5. #15 spectator binding port 隱性挑選 → 顯式 primary 辨識

- [ ] 5.1 `Window.tsx` `_resolveStreamEndpoint` 抽 `selectSpectatorBinding(bindings, primaryKitInstanceId, webrtc)`，改用既有 `viewport_sharing.primary_kit_instance_id` 顯式挑 spectator（非 primary 者），primary id 缺失退回 port-diff fallback
- [ ] 5.2 vitest：primary id 命中時挑非 primary binding；primary id 缺失時走 port-diff fallback（向後相容）

## 6. #16 spectator `stage_truth` 永久 pending

- [ ] 6.1 `Window.tsx` `_onStreamStarted` spectator 分支 setState 加 `stageLoadStatus: 'matched'`
- [ ] 6.2 vitest：`computeRuntimeReady('started', 'matched') === 'yes'` 之 spectator 情境

## 7. #18 env 繞過 coordinator boundary（只修 boundary，改名 defer）

- [ ] 7.1 `src/env.ts` 移除 `VITE_BIM_CONTROL_API_BASE` override，`bimControlApiBase` 改為 `queryCoordinatorApiBase || envCoordinatorApiBase`（永遠等於 `coordinatorApiBase`）
- [ ] 7.2 抽 `resolveBimControlBase` 純函式 + colocated vitest（env override 不再生效、永遠回 coordinator base）

## 8. #32 無條件外部 GFN CDN

- [ ] 8.1 刪 `index.html` 的 GFN inline `<script>`
- [ ] 8.2 `AppStream.tsx` `componentDidMount` 抽 `_initStream()`，只在 `StreamConfig.source === 'gfn'` 時動態 `createElement('script')` 插入（帶 id 防 double-mount、`onload` → `_initStream`、`onerror` → 失敗回饋）

## 9. OpenSpec artifacts 與驗證

- [ ] 9.1 撰寫 proposal / design / tasks / `specs/session-first-review-viewer/spec.md` delta，`openspec validate harden-web-viewer-test-resilience --strict` 通過
- [ ] 9.2 baseline 對照：`web-viewer-sample` `npm run verify` + `test:session-first` 動工前綠燈，apply 後同指令仍綠燈，`npm run test`（vitest）全綠
- [ ] 9.3 root pytest 回歸（`.venv\Scripts\python.exe -m pytest tests -p no:cacheprovider`）不受 web-viewer 改動影響；GitNexus `detect_changes({repo:'web-viewer-sample'})` 確認 affected scope 不超預期

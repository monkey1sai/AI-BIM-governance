## Why

`unified-governance-console` 北極星 capability（#180/#181 純規格 change，已 archive）與其 MVP 垂直切片實作 change `unified-console-mvp` 已落地三頁 operator 殼 + A1–A10 overlay。但 MVP 仍有兩個與北極星 IA（`frontend-redesign-ia-and-phases.html`）不一致之處：(1) console 實際掛在 viewer dev server `:5173`、`:8004/ui` 仍是 vanilla `dev-console.html`，不是「瀏覽器唯一可達面 = `:8004/ui` React UnifiedConsole」；(2) 缺 `#/review` / `#/kit` 路由、缺 `/api/kit/*` proxy、缺 USD 樹雙向選取、缺 Stage/Artifact Binding 主入口、缺可決定性 viewer E2E harness。

本 change 即 PR #184（branch `feat/fe-redesign-foundation`）的 fe-redesign 系列（CH-0/B/C/D/E/F/G + 真實 IFC 垂直切片）對應的 OpenSpec change：依北極星 IA 把統一治理控制台收斂到 `:8004/ui` React UnifiedConsole（六 hash 路由），補齊 `/api/kit/*` forward-only proxy、USD 樹→聚焦、Stage/Artifact Binding 交易式套用、coordinator 端 stage-binding 角色權威，以及「從前端選真實 `./storage/*.ifc` → 真轉檔 → 誠實 runtime」的可操作垂直切片；全程守 frontend-operable 與誠實鐵律，並以 Playwright browser E2E 佐證。

## What Changes

- **console 上 `:8004/ui`（CH-E）**：coordinator gated 服務 `web-viewer-sample` React build（`CONSOLE_DIST_DIR` 指向 `vite base=/ui/` 產出的 `dist-ui`；未設定 / 無 `index.html` 時誠實回退既有 `dev-console.html`，zero-risk 預設）。`routing.ts` 認得六 hash 路由 `#/coordinator|intake|runtime|review|kit|demo-control`（含 `#/` 前綴）+ coordinator `/ui` pathname；viewer `?session=` 進件仍優先。
- **URL 收斂（CH-G / RK6）**：`/ui/console` 精確 301→`/ui`；`/ui/open?session=` 維持 302 凍結 handoff，且 `/ui/console`、`/ui/open` 於任何 `/ui` static / SPA fallback「之前」精確註冊，SHALL NOT 被 `/ui/*` 萬用吞掉。
- **Kit proxy 邊界（CH-D）**：coordinator `/api/kit/*` forward-only reverse-proxy 至 kit-manager `:8010`（loopback）；瀏覽器禁直連 `:8010`；變更型請求需 operator/dev 授權。Kit 控制權威留 kit-manager（守 RK1）。
- **viewer 互動（CH-B）**：USD 語意樹↔相機聚焦、viewport↔樹回灌、spectator gate。
- **Binding 與角色權威（CH-F / CH-C）**：`BindingComposer` 多選 ready USDC → 指定唯一 primary → load_order → 交易式 `composeStageRequest`，Kit `bindingApplied` 確認才宣告 applied（保留 last-good revision，失敗不偽宣告）；coordinator `POST /api/review-sessions/:id/stage-binding` 以 `source_client_id`/primary 做後端角色權威（非 UI-only gate）。
- **真實 IFC 垂直切片**：`#/demo-control` 從 `GET /api/dev/ifc-sources`（契約：無絕對路徑 / 無 `source_ref`）選真 `./storage/*.ifc` → `POST /api/dev/ifc-sources/:sourceId/register`（coordinator loopback self-fetch → 既有 `POST /api/external/ifc-ready` 真進件 → streaming-server 真轉檔）→ 誠實 runtime 狀態 + 完整 lineage。`ifc-file` byte 取用 loopback-only。
- **可決定性 E2E harness**：`FakeAppStreamer` 只換 transport + 假 Kit 大腦，不假造前端狀態機；Playwright 於專用 port 5180；截圖 / trace 落 `artifacts/e2e/`。

## Capabilities

### New Capabilities

- None（本 change 為 fe-redesign 實作交付，不新增 capability）。

### Modified Capabilities

- `unified-governance-console`：新增可驗收 `### Requirement`（console 上 `:8004/ui` 六路由 + 凍結 handoff、Kit forward-only proxy 邊界、真實 IFC frontend-operable 誠實垂直切片）。不修改既有已 live 行為要求。

## Impact

- Owner repo / folder：`web-viewer-sample/src/`（`routing.ts` / `OperatorConsole.tsx` / `KitConsolePage.tsx` / `RealIfcConsolePage.tsx` / `Window.tsx` / `console/GovernanceOverlay.tsx` / `harness/`）+ `e2e/`；`bim-review-coordinator/src/`（`app.ts` `mountDevConsole` gated 服務 + `/api/kit/*` proxy + `/api/dev/ifc-sources*` + stage-binding；`config.ts` `consoleDistDir`）；`compose.runtime-manager.yml`（dist-ui 唯讀 bind-mount + `CONSOLE_DIST_DIR`）。
- API / data shape：新增 `/api/kit/*`（forward-only）、`/api/dev/ifc-sources`（契約 shape：`source_id`/`filename`/`relative_path`/`size_bytes`/`modified_at`，無絕對路徑）、`/api/dev/ifc-sources/:id/register`（loopback）、`POST /api/review-sessions/:id/stage-binding`。既有 `/api/external/ifc-ready`、stream-config、`element_mapping`、governance-service 端點 data shape 不變。
- Runtime boundary：不變（前端只打 `:8004`；3D 著色走 viewer↔Kit 既有 WebRTC DataChannel carve-out）。coordinator `/api/kit/*` 僅 forward、不成為 Kit 權威（RK1）；`/ui/open` 凍結 handoff 不變（RK6）。
- Dependencies：無新增生產依賴。
- 驗證：`web-viewer-sample` `npx tsc --noEmit` 0 error、`npm test` 158 passed；`bim-review-coordinator` `npm run build` 綠、`npm test` 291 passed；Playwright E2E 12 specs 全綠（viewer-harness、viewer-tree-focus、real-ifc-storage-intake / conversion-lineage / viewer-lineage、kit-proxy、ui-open-regression、stage-artifact-binding、primary-spectator-authority、unified-console-routes ×2）；真轉檔產物 `stream_conv_20260605093932_f79903a0` → 真 `model.usdc` + `element_mapping.json`。GitNexus impact 全 LOW、detect_changes low / 0 affected processes。
- Deploy：coordinator / viewer 為 docker 服務；啟用 React console 需 `cd web-viewer-sample && npm run build:ui` 產 `dist-ui`（compose 唯讀 bind-mount）；未產出時自動回退 `dev-console.html`（不需改 coordinator Dockerfile）。
- Non-goals：不在此 change 實作 streaming-server（host-native Kit）DataChannel 的 `source_client_id` 後端強制，亦未在 host-native Kit runtime 上跑 WebRTC DataChannel E2E 真驗（待補；host 具 GPU/Kit runtime 並在線，非環境缺 GPU）；不做 CH-A 完整設計系統 token；不接 spectator 多人協作；不改 governance-service / streaming data shape。

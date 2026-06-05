# 前端重構實作筆記（frontend-redesign-implementation-notes）

> 來源規格：`frontend-redesign-ia-and-phases.html`（IA 總圖 + CH-A→CH-G 分期）。
> 設計尺規：Anthropic 前端原則 + NVIDIA Kit primary/spectator。
> 執行模式：自主連續推進，每期 branch→PR→Actions→merge，**done 條件 = browser E2E evidence（Playwright 截圖/trace）**。
> 誠實鐵律：沒有真人可開 URL、點按鈕、用 fixture、看到結果、且有 Playwright 證據之前，不得宣告 done。後端/API/mock/docs-only 不算完成。

## 0. Baseline（2026-06-05，改動前量測）

| 範圍 | build | test |
|---|---|---|
| bim-review-coordinator | `npm run build`(tsc) ✅ | `npm test` 23 檔 / **287 passed** ✅ |
| web-viewer-sample | `vite build` ✅ | `npm test` 14 檔 / **141 passed** ✅ |
| apps/kit-manager-web | `tsc && vite build`（未量，CH-D 前補） | 無 unit suite |

任何改動完成後須維持以上綠燈，新增測試只增不減。

## 1. 驗證過的現況（source of truth = 程式碼）

- **Coordinator `:8004`**（Express/TS，無 Vite/React）：
  - `mountDevConsole()`（`bim-review-coordinator/src/app.ts:1672`）：`/ui`、`/dev-console` → 送靜態 `src/public/dev-console.html`（vanilla JS）。
  - `/ui/open?session=`（`app.ts:1683`）→ 驗 `^(lwv_|review_session_)[A-Za-z0-9_]+$` → **302** 轉址到 viewer（`buildViewerRedirectUrl`，`app.ts:1717`，base = `VIEWER_PUBLIC_BASE_URL` = `:5173`），forward `session/coordinatorApiBase/streamRole/...`。**這是凍結 handoff path。**
  - **無 `/api/kit/*` proxy**（規格標 ★新增）；已有 `/api/governance/*`→:49102（`routes/governanceProxy.ts`）與 `/api/governance/element-mapping/for-session/:id`（`app.ts:1333`）。
- **Viewer `:5173`**（web-viewer-sample，Vite+React 18 class component）：
  - `src/main.tsx`：`isOperatorConsolePath(pathname, hash, search)`（`src/console/routing.ts`）→ 真 `=> <OperatorConsole/>`；否則 `<App/>`（NVIDIA 原廠 WebRTC viewer）。
  - console 目前掛在 **:5173** 的 `/console[/...]`、`#/console[...]`、或短 hash `#coordinator|#intake|#runtime`（且 query 無 `session=` 時）。
  - `?session=lwv_|review_session_` → `window.__INITIAL_SESSION_FROM_QUERY__`，走 viewer auto-attach（跳過 NVIDIA Forms）。
- **WebRTC 串流邊界（harness 唯一注入點）**：
  - 出站：`AppStream.sendMessage(msg)`（`AppStream.tsx:236`，static）→ `AppStreamer.sendMessage`。Window.tsx:377 唯一送出口（`void AppStream.sendMessage(message).then(r => _handleCustomEvent(r))`，部分指令同步回 response，部分走 onCustomEvent）。
  - 入站：`AppStreamer` connect config 的 `onCustomEvent` → `props.handleCustomEvent` → `Window._handleCustomEvent`（`Window.tsx:1592`，接線於 :1960）；`onStart`(success) → `streamReady` → `props.onStarted()`。
  - 影像：`<video id="remote-video">`（`AppStream.tsx:324`）。
- **既有 Kit 訊息協定**（`src/clients/streamMessages.ts` + `_handleCustomEvent`）：
  - 出站：`openStageRequest`（含 `stage_composition`/`artifact_bindings`）、`getChildrenRequest`、`focusPrimRequest`、`highlightPrimsRequest`、`clearHighlightRequest`。
  - 入站：`openedStageResult`、`loadingStateResponse`、`getChildrenResponse`、`focusPrimResult`、`highlightPrimsResult`、`stageSelectionChanged`、`updateProgress*`。
- **已存在、不要重造**：OperatorConsole 三頁 + A1–A10 catalog、GovernanceOverlay（rule-run/issue/BCF/highlight/focus）、`govPanelState`（spectator readonly）、`mappingCache`、element-mapping proxy、stage_composition schema、spectator 偵測。
- **缺口**：coordinator 端 React UnifiedConsole（現為靜態 HTML）、`/api/kit/*` proxy、USDStage 左樹 UI + 雙向選取、BindingComposer（多選 USDC/指定 primary/load_order/交易套用）UI、**Playwright 與 stream/Kit 測試 harness（完全沒有）**、URL 收斂與舊別名 redirect + CI guard。

## 2. 目標架構（合併後）

- `:8004` = 瀏覽器唯一可達面。`:8004/ui` = React UnifiedConsole（移植 OperatorConsole + kit-manager-web + 舊 dev-console 控制功能）。
- console 路由（hash）：`#/coordinator`、`#/intake`、`#/runtime`、`#/review`、`#/kit`（+ `#/demo-control` 驗證頁）。
- viewer 經 `/ui/open?session=` 進場（**不變**），含左 USDStageTree、中 ViewportLayer、右 GovernanceOverlay（含 BindingComposer）。
- A1/A2/A3 共用 viewer 互動邏輯（hooks），不在三處複製。
- console **不長 WebRTC**，3D 操作一律 HandoffButton → `/ui/open?session=`。
- `/api/kit/*` proxy 只 forward 到 kit-manager `:8010`（loopback），**Kit 控制權威留 kit-manager**（守 RK1）。

### 2.1 型別契約層（建在既有 Kit 訊息協定之上，由 hooks 共用）

`ElementRef / ViewerCommand / ViewerObservation / ViewerRoleState / StageArtifactBinding`（定義見規格 task）。對映既有訊息：

| 型別契約 | 既有 Kit 訊息 | 狀態 |
|---|---|---|
| `openStage` | `openStageRequest` / `openedStageResult` | 已存在 |
| `composeStage` | `openStageRequest.stage_composition`（→ 顯式 `composeStageRequest` 自訂 handler） | 部分，需補 |
| `selectPrim` | `selectPrimsRequest`（builder 待補）/ `stageSelectionChanged` | 需補 builder |
| `focusPrim` | `focusPrimRequest` / `focusPrimResult` | 已存在 |
| `highlightPrims` | `highlightPrimsRequest` / `highlightPrimsResult` | 已存在 |
| `clearHighlight` | `clearHighlightRequest` | 已存在 |
| obs `treeLoaded` | `getChildrenResponse` | 已存在 |
| obs `selectionChanged` | `stageSelectionChanged` | 已存在 |
| obs `bindingApplied` | （新）`composeStageRequest` ack | 需補 |
| obs `commandRejected` | （新）spectator/權威拒絕回饋 | 需補 |

共用模組（規格要求）：`useViewerInteraction / useViewerRoleState / useUsdStageTree / useStageArtifactBinding / viewerCommandClient / viewerObservationStore / resolveGovPanelState`。

## 3. 可決定性 stream/Kit 測試 harness（解鎖所有 viewer E2E）

**原則**：只換掉 transport + 假 Kit 大腦，**不假造前端狀態機**（Window/hooks/builders/handlers 照跑）。

- 注入點：新增 `src/harness/fakeStreamer.ts`（實作 `connect/sendMessage/terminate/resize`，介面同 `AppStreamer`）+ `src/harness/streamer.ts`（`export const Streamer = harnessEnabled() ? FakeAppStreamer : AppStreamer`）。`AppStream.tsx` 把直接呼叫的 `AppStreamer.X` 改為 `Streamer.X`（harness 關閉時恆等於原物件，prod 行為零變更）。
- 啟用旗標：`?harness=1` 或 `VITE_VIEWER_HARNESS=1`（預設關）。
- FakeAppStreamer 行為：connect 時捕獲 config 的 `onStart/onCustomEvent`；下一 tick 觸 `onStart(success)`→streamReady；`sendMessage(msg)` 依 `event_type` 產生**符合既有 payload 形狀**的回應（`openStageRequest`→`openedStageResult`+`loadingStateResponse(idle)`；`getChildrenRequest`→`getChildrenResponse`(以 fixture USD 樹)；`focusPrimRequest`→`focusPrimResult`；`highlightPrimsRequest`→`highlightPrimsResult`；`selectPrimsRequest`→`stageSelectionChanged`；`composeStageRequest`→ ack）。
- 假影像：harness 模式 render 一個可決定性「viewport」placeholder（標示 stage url / 選取 prim），讓截圖有可見內容。
- fixture：USD 樹 + element_mapping 取樣（不放真 IFC/usdc 進 repo；真 runtime 驗證另記）。

## 4. 分期計畫（每期 = 一個 PR + browser E2E evidence）

| 期 | 對映 | 範圍 | 風險 | 主要 E2E 證據 |
|---|---|---|---|---|
| **CH-0 基礎** | — | stream/Kit harness + Playwright config + 首個 smoke（對現有 console + harness viewer 出真截圖） | 中（純新增/旗標化，不動 prod 路徑） | unified-console smoke、viewer-harness-boot |
| **CH-A** | P0 | 設計系統 token + 共用元件骨架（左樹/中視/右疊三欄 shell） | 低，純前端 | shell 三欄 render |
| **CH-B** | 項目1 | viewer USDStageTree↔聚焦、viewport↔樹回灌、A1 操作/觀測抽成 hooks + spectator gate | **高**（動 Window.tsx，先 gitnexus_impact，邏輯抽 hook） | viewer-tree-focus、spectator-disabled |
| **CH-C**（並行） | — | streaming 角色權威（`source_client_id` 驗證；後端授權邊界） | 高（跨 sub-repo，bim-streaming-server 為權威） | spectator 後端拒絕 |
| **CH-D** | 項目4 | `/api/kit/*` reverse-proxy（coordinator 只 forward）；kit-manager-web 能力移植準備 | 邊界風險（守 RK1） | #/kit 經 proxy、無直連 :8010 |
| **CH-E** | 項目2+4 | console handoff + 把 console 由 :5173 合併到 :8004/ui（coordinator 服務 React bundle） | **高**（bootstrap） | intake-session-created、review handoff、/ui/open regression |
| **CH-F** | 項目3 | BindingComposer 主入口（多選 USDC/指定 primary/load_order/交易套用/重載 compose/active+previous revision） | 高（雙寫一致、誠實降級） | binding-applied、binding-failure-honest |
| **CH-G** | 項目5 | URL 收斂：`/ui/console`→301→`/ui`；`#console/...` alias+warn；移除舊別名 | **CRITICAL**（禁 `/ui/*` 萬用吃掉 `/ui/open`，精確列舉 + CI guard） | ui-open-regression、redirect 精確性 |

## 5. Route 遷移表

| 舊入口 | 新入口 | 行為 |
|---|---|---|
| `/8004/ui` | `:8004/ui/#/coordinator`（UnifiedConsole 預設） | 保留 |
| `/8004/ui/console` | `:8004/ui/#/coordinator` | **顯式 301**（不可用 `/ui/*` 萬用） |
| `#console/...` | `#/coordinator|#/runtime|#/review|#/kit` | alias + warn log |
| `/ui/open?session=...` | 不變 | **凍結 handoff**，byte-for-byte，CI guard |
| 直連 viewer `:5173` | dev/demo only | 非最終產品入口 |

## 6. 風險登記（規格三紅線）

- **RK6 CRITICAL**：CH-G redirect 必精確列舉，**禁 `/ui/*` 萬用**（會吃掉 `/ui/open`）+ CI/route test 證明 `/ui/open?session=` 逐字保留。
- **RK5 HIGH**：CH-B/E/F/G 都改 `Window.tsx`，動前 MUST `gitnexus_impact`，邏輯抽 hook 降爆炸半徑。
- **RK1 HIGH**：`kitProxy` 只 forward，Kit 控制權威留 kit-manager（不得把 Kit authority 搬進 coordinator）。

## 7. 驗證與證據規約

- E2E：Playwright（新增於 web-viewer-sample；coordinator 端 route guard 用 supertest/vitest）。
- 截圖固定路徑：`artifacts/e2e/{unified-console,intake-session-created,viewer-tree-focus,binding-applied,spectator-disabled,ui-open-regression}.png`（+ trace/video where configured）。
- 每期 PR 附：frontend route、按鈕、fixture、loading/success/failure/retry、runtime IDs（job_id/model_version_id/artifact_id/review_session_id/kit_instance_id/usd_stage_url/usd_prim_path/ifc_guid/binding_revision_id）。
- 真實 Omniverse/Kit 不在 CI → 用本 harness 保持同一 UI 契約與 command/observation 介面；真實本機 runtime 驗證另文件記錄。

## 8. 紀律

- 不在 `main` 開發；每期 branch→PR→Actions→merge；PR 對應一個 OpenSpec change（`openspec/changes/<date>-<slug>/`，過 review gate）。
- 改 code symbol 前 `gitnexus_impact`，commit 前 `gitnexus_detect_changes`；HIGH/CRITICAL 先回報。
- 不硬編 production URL，service endpoint 走 env/config；不留無作用 placeholder 按鈕；不留隱藏 mock-only success；不靜默失敗。
- commit 前 `git diff --cached --check`；只 `git add` 本工作檔，不掃無關 dirty。

## 9. 實作進度（branch `feat/fe-redesign-foundation` / PR #184）

| 期 | commit | 狀態 | 驗證 |
|---|---|---|---|
| CH-0 基礎（harness + Playwright） | `dfc8894` | ✅ | viewer build/vitest；Playwright viewer-harness |
| CH-B viewer 樹→聚焦 + spectator gate | `c93b9f6` | ✅ | Playwright viewer-tree-focus |
| 真實 IFC 垂直切片（intake→轉檔→session→viewer） | `1dfc271` | ✅ | Playwright real-ifc-storage-intake / conversion-lineage / viewer-lineage；真 USDC+mapping |
| CH-D `/api/kit/*` forward-only proxy | `26fb07e` | ✅ | Playwright kit-proxy（direct :8010=0；mutating 需 token） |
| CH-G/RK6 `/ui/console` 301 + `/ui/open` 守衛 | `be1af4a` | ✅ | coordinator supertest；Playwright ui-open-regression |
| PR#184 風險修正（ifc-sources 契約 / ifc-file loopback / register / kit auth） | `81d0b56` | ✅ | coordinator vitest 290；live smoke；E2E |
| CH-F Stage/Artifact Binding composer | `ad910c8` | ✅ | Playwright stage-artifact-binding / primary-spectator-authority |
| CH-C 後端 source_client_id 角色權威 | — | ❌ 未做 | 需 GPU Kit runtime 才能真驗（見 §11） |
| CH-E React UnifiedConsole 上 `:8004/ui` | — | ❌ 未做 | 需改 coordinator Dockerfile 服務 dist（見 §11） |

### 9.1 真實 ./storage IFC 工作流（demo-control）

1. 開 `http://127.0.0.1:8004/ui#/demo-control`。
2. 「IFC fixture」下拉由 `GET /api/dev/ifc-sources` 列出 `./storage/*.ifc`（`source_id`/`filename`/`relative_path`/`size_bytes`/`modified_at`，**無絕對路徑、無 source_ref**）；預選 `許良宇圖書館建築_2026.ifc`。空時顯示 `storage_empty`。
3. 「註冊並轉檔（真實）」→ `POST /api/dev/ifc-sources/:sourceId/register`：coordinator 內部 **loopback self-fetch** ifc-file → 既有 `POST /api/external/ifc-ready` 真實 intake → 序列派工 streaming-server `ifc-to-usdc` 真轉檔。瀏覽器只給 `source_id`，不構造 URL、不接觸 bytes。
4. 輪詢 `GET /api/external/ifc-ready/:jobId` → 顯示 runtime 狀態（converting/ready/runtime_blocked/conversion_timeout/download_failed）+ lineage（job_id/model_version_id/conversion_job_id/artifact_id/usdc_url/mapping）。
5. ready → auto review session + `viewer_url`(/ui/open)；經 `/ui/open?session=…` 進 viewer 顯示來源 IFC lineage + USDC artifact。
6. 安全：`ifc-file` loopback-only（擋 LAN bytes）；變更型 `/api/kit/*` 需 `x-dev-token`；`ENABLE_DEV_ROUTES=false` 關閉全部 `/api/dev/*`。

### 9.2 Route 遷移現況

| 舊入口 | 現況 | 最終（CH-E/G） |
|---|---|---|
| `:8004/ui` | dev-console.html（含 real-IFC + Kit 面板）✅ | React UnifiedConsole（CH-E 未做） |
| `:8004/ui/console` | **301 → `/ui`** ✅（RK6 guard） | 同 |
| `:8004/ui/open?session=` | **302 凍結** ✅（supertest + Playwright 守衛） | 不變 |
| `#/demo-control` / `#/kit` | dev-console 面板可達 ✅ | React 路由（CH-E） |
| `#/coordinator|intake|runtime|review` | React console 在 `:5173`（未上 :8004） | CH-E 上 :8004 |

### 9.3 primary / spectator 與 Binding

- 三層縱深：UI `disabled`+`aria-disabled`+誠實 reason banner（`resolveGovPanelState`）；前端 command 層 spectator 不送 mutating（`_applyBinding`/`_onSelectUSDPrims` guard）；後端 coordinator `/api/kit/*` mutating 需 token（CH-D）。**streaming DataChannel 的 source_client_id 後端權威（CH-C）未做**。
- Binding：選 1..N ready USDC → 指定唯一 primary → load_order → 交易式 `composeStageRequest` → Kit `bindingApplied` 確認才宣告 applied（保留 last-good revision；失敗不偽宣告）。

## 10. PR 驗證表

| Item | Result |
|---|---|
| E2E 指令 | `cd web-viewer-sample && npm run test:e2e` |
| E2E specs（9） | viewer-harness、viewer-tree-focus、real-ifc-storage-intake、real-ifc-conversion-lineage、real-ifc-viewer-lineage、kit-proxy、ui-open-regression、stage-artifact-binding、primary-spectator-authority（**unified-console-routes 待 CH-E**） |
| coordinator | `npm run verify` → vitest **290 passed** |
| viewer | `npm run build` ✅；`npm test` → **149 passed** |
| 真實 IFC fixture | `許良宇圖書館建築_2026.ifc` / `demo_lib_2026.ifc` → `stream_conv_* succeeded` → 真 model.usdc + element_mapping.json |
| 證據截圖 | `artifacts/e2e/{viewer-harness-boot,viewer-tree-focus,real-ifc-storage-intake,real-ifc-conversion-lineage,real-ifc-viewer-lineage,kit-proxy,ui-open-regression,stage-artifact-binding,primary-spectator-authority}.png`（trace/video 於 `_output/`，gitignored） |

## 11. 已知限制 / 未完成（誠實）

- **CH-C（後端角色權威）未做**：streaming-server（Kit，host-native GPU）以 `source_client_id` 驗 primary/spectator 的 DataChannel mutating 指令。目前為前端 gate + coordinator `/api/kit/*` dev-token；完整後端強制需探索 `bim-streaming-server` 並在 GPU Kit runtime 上驗證（此環境無 GPU）。
- **CH-E（React UnifiedConsole 上 :8004）未做**：需改 coordinator Dockerfile 把 `web-viewer-sample/dist` 服務在 `/ui`、`routing.ts` 認 `#/coordinator|intake|runtime|review|kit|demo-control`、把 dev-console 的 real-IFC/Kit 面板移植成 React 頁；之後補 `unified-console-routes.spec`。目前 real-IFC/Kit 在同源 dev-console.html（interim，合規）。
- **真實 3D 影像**需 host GPU；此環境 viewer Runtime=no（誠實降級，不偽造 matched）；harness 用可決定性佔位，不假造前端狀態機。
- **OpenSpec change-id**：repo 有 `openspec/changes/unified-console-mvp/`；本 PR 尚未掛上對應 change，review gate 可能標 blocker。
- overlay 右側於窄視窗略裁切（layout polish，留 CH-A/CH-E）。

# VG-01：A1 工作台嵌入 live viewer（iframe + postMessage 橋），跑檢核→3D 高亮一氣呵成 + `first_frame_at` 後端化 設計

> 含 **M3「3D viewer 包覆 A1~A3」里程碑藍圖**（§0，含 A1/A2/A3 各自 3D 顯示決策）。本 spec = 該里程碑**第一格（地基 + A1 高亮）**。
>
> **對抗驗證修訂記錄（2026-06-22）**：本 spec 經 ultracode 多代理 workflow（Haiku 收集 → Sonnet ×5 視角交叉對抗 → Opus judge panel；32 agents / ~1.98M tokens）查證後修訂。已修 5 項 UPHELD must-fix：M1 first_frame 觸發點（原指失敗/斷線路徑，改 `_completeStageLoad`）、M2 `canOperate` 被 postMessage 繞過、M3 `first_frame_at` 型別鏈遺漏三處、M4 行號全錯（已改正）、M5 origin 注入機制不存在（改複用既有 env）。所有 `file:line` 已直接 Read/grep 重新查證。

- 文件性質：spec design（設計文件）。權威序：code > contracts > AGENTS > `docs/plans` 行為合約 > spec。與實作衝突時以實作程式碼與 `docs/plans/ai-bim-governance-設計規格.md` §6（A1–A3 互動）、§6.5（3D Viewer 三角色 / 逐一對照表）、`docs/plans/ai-bim-governance-互動實作規格與標準對齊.md`（IX-A1-06 / IX-3D-04 / IX-3D-05）為準。
- 日期：2026-06-22
- Phase 對應：**M3「3D viewer 包覆 A1~A3」首格**。M2（#conv 受控動作系列 + IX-SS-04 terminate）已收斂；本格把「3D 串流線」從 console 殼層的 disabled 佔位翻成真接線。
- userFacing：true（`#a1` / `A1GovernanceWorkbenchPage` 與 `#viewer` / `ViewerPresentationPage`）。本格把 A1 工作台「在 3D 高亮」（`pages.tsx:347` 永久 disabled p1）翻成真按鈕，並把 `#viewer` 的 `first_frame_at` / `stage matched`（`pages.tsx:364` p1）翻成真證據。
- **執行時機**：產品功能軸無 in-flight 控制動作格擋路（IX-SS-04 已 merged，PR #226 / 2026-06-17）。最近三個 commit 屬六邊形 harness 軸（B#233 / C#234 / F#235），不碰 `web-viewer-sample` / `bim-review-coordinator` 產品碼。可開跑。**最大相依風險**：本格跨 **console（`:8004/ui` dist-ui）與 viewer（`:5173` dev-server image）兩個 build target**（見 §7），plan 啟動前須 `git fetch origin` 確認 main 為最新，並確認測試區能同時重建兩個 target。
- **關鍵設計決策（使用者裁定 2026-06-22）**：
  1. **產出形式 = M3 藍圖 + 第一格詳規**（§0 藍圖含 A1/A2/A3 三格 3D 顯示決策，§1–§7 第一格詳規）。
  2. **console 遙控 viewer = iframe 鑲嵌 + postMessage 橋**（不自建 WebRTC、不開新分頁）。重用既有 viewer 串流堆疊，呼應設計規格 §234「web 端不重做」。
  3. **第一格範圍 = 地基 + A1 高亮**（不縮）：一格即可 demo「點失敗構件 → 3D 紅高亮」。
  4. **`first_frame_at` 順手後端化**（記最小一筆 event，**不**做完整心跳遙測——屬 IX-SS-02）。
  5. **A1+A2+A3 全走 3D 成立，但為 4 格工作**：三格共用本格的 `<EmbeddedViewer>` + postMessage 協定，**各開獨立 spec**（§0）。

---

## 0. M3 里程碑藍圖（3D viewer 包覆 A1~A3，含三格 3D 顯示決策）

「3D viewer 包覆 A1~A3」是一整個里程碑、**4 格工作**，非單格。**格 1（本 spec）是唯一硬前提**；打通「console↔viewer 遙控線 + 誠實首幀證據」後，格 2/3/4 各自獨立、各開 spec。三格沿用格1 的 `<EmbeddedViewer>` + postMessage 協定（協定 §5「未知 type 忽略」前向相容，A2/A3 純 additive 擴 type，格1 不需預留欄位）。

```
[格1 · 本 spec]  A1 工作台嵌入 live viewer（iframe+postMessage）+ first_frame_at 後端化 + stage truth
   │  打通「遙控線 + 誠實證據」後，下面才有 3D 可被 console 工作流驅動
   ├──→ [格2 · A2 著色]   版本 diff → onion-skin（分兩階：階段一 added綠/modified黃兩色 + removed 誠實標；階段二 ghost 殘影）
   ├──→ [格3 · A3 疊合]   ★核心舞台（份量最大/L 級）：半透明圖層即時開關 + clash 紅色發光球
   └──→ [格4 · A1 收尾]   A1 在 3D 高亮後截圖存 BCF（snapshot 端點）
```

> **份量倒置警告**：§6.5 把 A3 列為「**核心舞台**」（3D 是主角、份量最大）、A1/A2 列「選用疊加」。本藍圖對 A1 詳規、A2/A3 僅藍圖，**不代表 A3 較小**——A3 是獨立 L 級主場功能（clash 資料源 + 即時 visibility 端點 + 新指令族），勿誤估成「A1 接線的延伸」。

### 0.1 A1/A2/A3 各自 3D Viewer 顯示決策（對齊 §6.5；本里程碑的總決策）

| App | §6.5 角色 | viewer 裡看到什麼（正典） | 著色維度 | 重用現成件（均在 viewer `:5173` App 層，console 透過 postMessage 橋遙控） | 各格需新建 / pre-decision |
|---|---|---|---|---|---|
| **A1**（格1） | 選用疊加（§238） | 失敗構件**紅高亮 + 鏡頭飛到**；反向 3D 點構件→清單高亮（§246） | severity（`severityToColor`：error 紅 / warning 黃 / 其餘藍） | `HighlightBridge.highlightFailed`（highlightBridge.ts:40-59）、`GovernanceOverlay`、`_hasRemoteVideoFrame()`（Window.tsx:595-598）、`_overlayHighlight`（603）、Kit 5 指令（streamMessages.ts:9-80）、`_reverseLookupGuid`（707） | `<EmbeddedViewer>` + postMessage 橋、viewer listener、coordinator `first-frame`、證據顯示（本 spec §2） |
| **A2**（格2） | 選用疊加（§238） | **onion-skin**：新增綠 / 修改黃 / **刪除紅幽靈留原位**（§247） | **change_type（added/removed/modified）≠ A1 severity**（IX-3D-05：A2 三色與 A4 isolate 共用指令族，payload 帶 `source: a1\|a2\|a4`） | diff engine 100% 可用、`apply-overlay` 誠實 501（pages.tsx:1657-1668） | 新 `diff_overlay` postMessage type + change_type→color 映射。**pre-decision**：removed 構件在 target USD **無 prim_path**（highlightBridge.ts:44-46 必回 unmapped）→ ghost 殘影做不到 `highlightPrimsRequest`，須選 2D canvas 疊 / dual-stage 雙載 / Kit ghost prim 之一（A2 spec 決）。**階段一先做 added/modified 兩色 + removed 誠實標「此版本已刪除，見清單」，ghost 推階段二** |
| **A3**（格3） | ★核心舞台（§237） | 各專業**半透明圖層疊同場景（可即時開關）+ 碰撞點紅色發光球**；點碰撞飛到+框兩構件+剖面（§248/§181）。版面**反過來**：3D 全幅主、圖層 checkbox + clash 清單做側欄 | layer 可見性 + clash 標記（Kit 5 指令**無** layer-visibility / clash-sphere） | federation builder（pages.tsx:1732-1742）、review-room handoff（DEMO）、格1 `<EmbeddedViewer>` | clash 資料源端點 + 新 `layer_toggle` / `clash_focus` 指令族 + 即時 visibility 機制。**pre-decision**：(a) clash 源 = DEMO fixture vs governance-service 真算；(b) 即時 visibility 走新後端端點 vs Kit DataChannel 指令（現況改 visibility 須**重 Build**，pages.tsx:1827）；(c) clash 球渲染走 Kit 哪個指令族（須查 Kit API 或擴 streamMessages）。**A3 spec 落地前，A3 頁誠實掛「核心舞台規劃中，現走 review-room handoff（DEMO）」，不給看似可按的灰鈕** |

> **A1+A2+A3 全走 3D = 同意三格 3D，但 A2/A3 各需獨立 spec 重設協定維度**（A2=change_type、A3=layer/clash），不是複用 A1 的 severity highlight。這是正典工作流（各格獨立成 spec），非缺陷。

---

## 1. 背景與現狀（盤點已實證，行號經 2026-06-22 重新查證）

A1「在 3D 高亮失敗構件」這條 user journey **斷成兩截**：viewer 那一側引擎齊全、console 工作台那一側按鈕全灰，兩者**互斥掛載、無橋**。

### 1.1 viewer 側（`Window.tsx` / `AppStream.tsx`，`:5173` dev-server image）— 高亮引擎與真首幀已 asbuilt

- **真首幀偵測已存在且為真信號**：`Window._hasRemoteVideoFrame()`（`Window.tsx:595-598`）= `video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0 && video.videoHeight > 0`——是「真畫面已到達」判定，**非** port open / 非 stream start（`AppStream.tsx:249-251` 的 `streamReady` 只是 `start success`，較弱）。`<video>` 在 `AppStream.tsx:337`，且 `mic:false`（receive-only）。
- **DataChannel 就緒 gating 已綁真首幀**：`Window.tsx:610` `dataChannelReady: () => this.state.showStream && this._hasRemoteVideoFrame()`。
- **stage 完成真點**：`_completeStageLoad()`（`Window.tsx:527`）為 stage 載入完成處，由 `_completeStageLoadFromVisibleStream()`（`557`，內含 `_hasRemoteVideoFrame()` guard）與 Kit stage handler（`1807` / `1826`）抵達。`_isLoadedStageExpected`（stage truth 判定）在 `Window.tsx:493` 附近。⚠️ `Window.tsx:571 / 1306 / 1356` 雖也設 `showStream`，但分別是 **失敗路徑（`_failStageLoad`，定義在 566）/ 斷線 / 開檔查詢**，**非 false→true 首幀邊緣**（M1 修正依據）。
- **治理高亮 overlay 已掛載且 asbuilt**：`Window.tsx:2269/2274` 掛 `<GovernanceOverlay onHighlight={(f) => this._overlayHighlight(f)}>`。`GovernanceOverlay.tsx:220-257`：失敗構件清單表，每列「在 3D 標示」鈕（`data-testid="gov-highlight"`，`onClick={handleHighlight}`，`GovernanceOverlay.tsx:234`）。反向 `selectedGuid`（3D 點構件→ifc_guid，`Window._reverseLookupGuid`，`Window.tsx:707`）。MVP 引擎 A2/A3/A4/A8 標 asbuilt（`GovernanceOverlay.tsx:76-81`）。
- **⚠️ `canOperate` guard 只在 render 層**：`handleHighlight`（`GovernanceOverlay.tsx:132`）才檢查 `canOperate`；但**注入的 `onHighlight` = `Window._overlayHighlight`（`Window.tsx:603`）本身無 `canOperate` 檢查**。任何直接呼叫 `_overlayHighlight` 的路徑（如新 postMessage listener）會繞過 spectator gating（M2 修正依據）。
- **HighlightBridge 成熟**（`governance/highlightBridge.ts`）：`highlightFailed(failed)`（`40-59`）→`dataChannelReady()` 否則 `{ok:false, reason:"datachannel_not_ready"}`→`cache.primPathForGuid(guid)` 否則 `{ok:false, reason:"unmapped"}`（**誠實回拒**，`44-46`）→`buildHighlightPrimsRequest`（`clients/streamMessages.ts`，Kit 5 指令在 `9-80`）。`FailedElement` 型別在 `10-15`，欄位與本 spec §2.1 `items` 對齊。

⇒ **「在 live viewer 內跑檢核→點失敗構件→3D 紅高亮→反查」已 asbuilt。** 缺的不是高亮，是「console 工作台驅動不到它」。

### 1.2 console 側（`pages.tsx` / `EdgeConsole.tsx`，`:8004/ui` dist-ui）— 工作台真、3D 動作全灰

- **route**：`EdgeConsole.tsx:55` `a1→A1GovernanceWorkbenchPage`、`:56` `a2→VersionDiffPage`、`:57` `a3→FederationPage`、`:65` `viewer→ViewerPresentationPage`。
- **A1 工作台 real**：`A1GovernanceWorkbenchPage`（`pages.tsx:207-356`）跑 `rule-runs`、輪詢、失敗清單、`issues/from-rule-run`、Excel/BCF 匯出（經 coordinator proxy 到 governance-service `:49102`）。**零 session UI**（S2 依據：取 active session 方式未定）。
- **3D 高亮 disabled（缺口核心）**：`pages.tsx:347` `<Btn prov="p1" disabled ...>在 3D 高亮</Btn>`。原因：console 為獨立殼層、與 viewer **互斥掛載**、無 DataChannel（`pages.tsx:1295`）。
- **`#viewer` 是示意頁**：`ViewerPresentationPage`（`pages.tsx:358`）列 `first_frame_at`=p1（`364`）、`WebRTC first frame`=p1（`375`）。
- **A2/A3 頁**：`VersionDiffPage`（`pages.tsx:1466`，`apply-overlay` 誠實 501 在 `1657-1668`）、`FederationPage`（`pages.tsx:1689`，visibility 改動須重 Build 在 `1827`）。

### 1.3 coordinator 側（`bim-review-coordinator/src/app.ts`）— `first_frame_at` 後端零實作

- **`first_frame` 字串在全 repo 零命中**（grep 證實 `app.ts` 無）⇒ **`first_frame_at` 後端零實作**。`GET /api/runtime/status` route 在 **`app.ts:492-499`**（`493` 呼叫 `buildRuntimeStatus`）；`buildRuntimeStatus` 在 **`app.ts:2115-2190`**（`2154` map `summarizeSessionForRuntime`）；`summarizeSessionForRuntime` 在 **`app.ts:2192`**——皆不 emit `first_frame_at`。
- **前端治理層 hardcoded 死值**：`console/coordinator/runtimeGovernance.ts:165` `firstFrame: readiness === "free" ? "missing" : "not_observed"`——**無真信號餵入**。型別 `RuntimeSessionSummary` 在 `console/coordinatorClient.ts:94-105`（10 欄，**無 `first_frame_at`**）。
- **review-session 綁定可用**：`POST /api/review-sessions` schema 完整、artifact_bindings、event log，as-built（種 session 取證用）。`GET /api/review-sessions` 可列 active sessions（S2 下拉用）。
- **viewer 無 postMessage/iframe 機制**（grep 無匹配）⇒ postMessage 橋為**全新、無既有衝突**。

### 1.4 仍讓 journey 斷裂的缺口

1. **console↔viewer 無橋、互斥掛載**：A1 工作台與 viewer 高亮引擎不同框，A1 工作流斷裂。
2. **`first_frame_at` 後端零實作 + 型別鏈三處死值**：viewer 有真信號（`_hasRemoteVideoFrame()`）但不回報；console 無從誠實顯示「3D 真載好了」，IX-A1-06 第二啟用條件無法滿足。
3. **stage truth 未閉合**：`expected == loaded` 無比對顯示（`pages.tsx:365` p1；viewer 端 `_isLoadedStageExpected`（493）已有素材）。

### 1.5 誠實鐵律硬限制

user-facing feature 必須可從前端 route 操作並有 browser E2E evidence。3D 高亮無 GPU viewport / 無 first frame 時**不得宣稱已完成**（§167, §246）；未對映構件**誠實回拒**（highlightBridge.ts:44-46）；無樂觀更新、無假資料、無 localStorage 存業務狀態。本格**不殺 GPU Kit 行程**。

---

## 2. 目標（成功標準）

> **任務相依排序（plan 須遵守）**：§2.4 coordinator `first_frame_at` 後端化（含型別鏈三處）為**最先且回歸鎖**；§2.1 `<EmbeddedViewer>` 元件 + postMessage 協定為前端地基；§2.2 viewer 側 listener 依賴 §2.1；§2.3 console A1 整合依賴 §2.1+§2.2；§2.5 證據顯示依賴 §2.4；§2.6 E2E 最後。**可切兩段 commit**：(A) 地基（§2.1/§2.2/§2.4/§2.5）綠；(B) A1 高亮接線（§2.3）綠。

1. **`<EmbeddedViewer>` 元件（console 側新增，`web-viewer-sample/src/console/`）**：封裝 `<iframe>`（src 指向既有 viewer 入口，帶 session 參數）+ postMessage 橋。**協定（版本化 `protocol:"vg01"`）**：
   - viewer→console：`viewer_ready`、`first_frame`（含 `stageUrl`）、`stage_loaded`（含 `stageUrl`）、`highlight_result`（`requestId, ok, reason?`）、`selected_guid`（`ifcGuid|null`）。
   - console→viewer：`highlight`（`items:[{ifc_guid, severity, label, rule_code}]`）、`focus`（`ifc_guid`）、`clear`。
   - **安全（M5：複用既有 env，不新增 var）**：console 送出 `targetOrigin` = viewer origin（由 iframe src 推導，非 `"*"`）；viewer 接收驗 `event.origin` ∈ **既有 `VITE_ALLOWED_COORDINATOR_ORIGINS`（`config/env.ts:9`）** 白名單（已含 console `:8004`），並以 `document.referrer` parse 出 parent origin 交叉驗；console 接收驗 `event.source === iframe.contentWindow`。未知 type / 缺 `protocol` 忽略。
2. **viewer 側 postMessage listener（`Window.tsx` 最小 additive）**：
   - 掛 `window.addEventListener("message", this._onParentMessage)`（`componentWillUnmount` 移除），驗 origin（§2.1 白名單）+ `protocol:"vg01"` + 僅 `window.parent !== window`。
   - 收 `highlight`→**先判 `canOperate`（M2：不可直接呼叫無 guard 的 `_overlayHighlight`（603）；把 `GovernanceOverlay` 的 panelState/`canOperate` 計算抽成 Window 方法層可呼叫的純函式，或在 `_overlayHighlight` 內補守衛）**，通過才走既有 HighlightBridge 路徑→回 `highlight_result`；spectator/未就緒**靜默丟棄**。收 `focus`→既有 focusPrim；`clear`→既有 `onClearHighlight`。
   - **first frame 回報（M1：觸發點改正）**：在 `_completeStageLoad()`（`Window.tsx:527`，經 `_completeStageLoadFromVisibleStream`（557 有 guard）與 stage handler（1807/1826）抵達）additive 觸發 `window.parent.postMessage({protocol:"vg01", type:"first_frame", stageUrl:this.pendingStageUrl}, <consoleOrigin>)`。**加 `this._firstFramePosted` flag 確保只送一次**（防 571/1306/1356 等失敗/斷線/開檔路徑誤觸→偽證據）。
   - `stage_loaded`：stage 載入完成 postMessage（含真 loaded url）。`selected_guid`：`_reverseLookupGuid`（707）設值處 additive postMessage。
   - **嚴格 additive**：不改 `AppStream` / `GovernanceOverlay` props 形狀 / spectator 既有路徑。
3. **console A1 頁整合（`A1GovernanceWorkbenchPage`，`pages.tsx:207-356`）**：
   - 嵌入 `<EmbeddedViewer>`（左失敗清單 / 右 3D；對齊 **A1 §163-170 五步 stepper 與 IX-A1-06**，**非** §188（那是 A4 版面，S4 修正））。
   - **session 取得（S2）**：加 active session **下拉選取器**（`GET /api/review-sessions` 列 active；無 session 誠實顯示「需先派發 review session」並 disable 高亮）。
   - 失敗清單每筆「在 3D 高亮」（取代 `pages.tsx:347` disabled）：依 **IX-A1-06 四條件** enable = `DataChannel ready ∧ first_frame ∧ stage matched ∧ 構件有 usd_prim_path`；不足時 disabled + 誠實原因。點按→`postMessage {highlight, items:[該構件]}`→收 `highlight_result`：`ok`「已在 3D 標示」、`unmapped`「此構件未對映 USD，無法高亮」、`datachannel_not_ready`「3D 尚未就緒」（**不假成功**）。
   - **雙清單矛盾處理（S3）**：iframe 內 `GovernanceOverlay` 的失敗清單區**收合/隱藏**（只當高亮引擎用），避免「console 25 筆失敗 / iframe 說無失敗」矛盾 UX。
4. **coordinator `first_frame_at` 後端化（`app.ts` additive、回歸鎖；含型別鏈 M3）**：
   - 新增 `POST /api/review-sessions/:sessionId/first-frame`（safe-id 400 / 不存在 404 / 已記冪等）：body `{endpoint_id?}`；`eventLog.append(session_id, "firstFrameObserved", {endpoint_id, actor})`；session 記 `first_frame_at`（coordinator `nowIso()`；**N3：忽略 body.observed_at**，iframe 與 coordinator 時鐘無同步保障）。**呼叫者 = console**（viewer postMessage `first_frame`→console→`coordinatorClient.reportFirstFrame(...)`；viewer 不直連 coordinator）。
   - **型別鏈三處（M3，缺一則翻不掉）**：(1) `summarizeSessionForRuntime`（`app.ts:2192`）additive emit `first_frame_at: string|null`；(2) `RuntimeSessionSummary`（`coordinatorClient.ts:94-105`）additive 加 `first_frame_at`；(3) `runtimeGovernance.ts:165` 改讀 `session.first_frame_at`（取代 hardcoded `"not_observed"`）。
   - **只記最小一筆證據；完整心跳/liveness 遙測屬 IX-SS-02**。**N2：in-memory SessionStore，coordinator 重啟後 `first_frame_at` 清除、下次 POST 重記（最小一筆非 exactly-once）**。
5. **console 證據顯示（`ViewerPresentationPage` + A1 頁）**：`first_frame_at`（`pages.tsx:364`）、`stage matched`（`365/375`）由 p1 翻真：first frame 到→綠；未到→灰（誠實「not_observed」）；stage mismatch→警示（不靜默）。
6. **誠實鐵律維持**：未對映/未就緒誠實回拒；first frame 沒到→高亮鈕 disabled + 原因；stage mismatch 警示；不殺 GPU；actor best-effort（LAN 無 RBAC，`local-operator`）。
7. **Browser E2E（Playwright，唯一接受的 user-facing 證據）通過**：見 §6.4。

---

## 3. 偏離揭露與非目標（明確不做）

**刻意設計選擇（須寫進 PR body）**：
- **不讓 console 自建 WebRTC**：重用 viewer iframe（使用者裁定）。`<EmbeddedViewer>` 不持有 RTCPeerConnection。
- **A1 高亮引擎不重做**：viewer 內 `HighlightBridge`/`GovernanceOverlay` 已 asbuilt，本格交付的是 **console↔viewer 橋 + `first_frame_at` 後端化**，非新高亮引擎。
- **七區塊只交付 6+7（S5）**：設計規格 §259 prototype 七區塊（點選→IFC語意→Pset/Qto→Spatial樹→GUID⇔USD表→**A1紅高亮(6)**→**反向跳轉(7)**）中，本格只對齊第 6（紅高亮）+ 第 7（反向 `selected_guid`）；1-5 屬既有 viewer 既能力或後續格。PR body / DoD 明寫，避免對齊宣稱超出實交付。

**非目標**：
- **不做 A2 onion-skin / A3 圖層+clash / A1 snapshot-to-BCF**（M3 格 2/3/4，§0）；**A2 ghost 殘影、A3 即時 visibility 端點 / clash 資料源**為各自 spec 的 pre-decision。
- **不做完整 first frame / heartbeat 遙測**（IX-SS-02）；不做 stale endpoint 強制釋放（IX-SS-03）。
- **不做 A2/A3 的 postMessage 指令族**（`diff_overlay` / `layer_toggle` / `clash_focus`）——協定 §5「未知 type 忽略」保證後續 additive 擴充不破格1。
- **不碰 `bim-streaming-server` / 不殺 GPU Kit 行程**；**不直連** `:49101`/`:49102`。
- **不建全站 RBAC / audit 持久層**；**不引入新 production dependency / 不新增 env var（M5 複用既有）**。

---

## 4. 設計（縱切）

### 4.1 `<EmbeddedViewer>`（console 側新元件，`web-viewer-sample/src/console/EmbeddedViewer.tsx`）

```tsx
// props：{ sessionId, viewerOrigin, onFirstFrame, onStageLoaded, onHighlightResult, onSelectedGuid }
// 對外：sendHighlight(items) / sendFocus(guid) / sendClear()
export function EmbeddedViewer(props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [viewerReady, setViewerReady] = useState(false);
  const [firstFrame, setFirstFrame] = useState(false);
  const [loadedStageUrl, setLoadedStageUrl] = useState<string | null>(null);

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== props.viewerOrigin) return;               // 安全：origin 比對
      if (e.source !== iframeRef.current?.contentWindow) return; // 安全：來源 frame
      const m = e.data; if (m?.protocol !== "vg01") return;       // 協定版本
      switch (m.type) {
        case "viewer_ready":     setViewerReady(true); break;
        case "first_frame":      setFirstFrame(true); props.onFirstFrame?.(m); break;
        case "stage_loaded":     setLoadedStageUrl(m.stageUrl); props.onStageLoaded?.(m.stageUrl); break;
        case "highlight_result": props.onHighlightResult?.(m); break;
        case "selected_guid":    props.onSelectedGuid?.(m.ifcGuid ?? null); break;
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [props.viewerOrigin]);

  const post = (msg) => iframeRef.current?.contentWindow?.postMessage(
    { protocol: "vg01", ...msg }, props.viewerOrigin);            // targetOrigin 非 "*"

  const src = `${props.viewerOrigin}/?session=${encodeURIComponent(props.sessionId)}`; // 既有 viewer 入口（plan 先驗 query 契約）
  // S1：sandbox="allow-scripts allow-same-origin"（WebRTC + sessionStorage 需要）+ allow="autoplay"（跨 origin <video> 自動播放，否則白頁）；
  //     viewer receive-only（AppStream mic:false）→ 不需 camera/microphone。
  return <iframe ref={iframeRef} src={src} title="live-3d-viewer"
                 sandbox="allow-scripts allow-same-origin" allow="autoplay" />;
}
```
- `viewerOrigin` 由 iframe src 推導；接收端白名單複用 `VITE_ALLOWED_COORDINATOR_ORIGINS`（env.ts:9）。**禁 `"*"`**。
- 不在 console 端保存業務權威資料（守 `web-viewer-sample` 邊界）。

### 4.2 console A1 頁整合（`A1GovernanceWorkbenchPage`，`pages.tsx:207-356`）

- 版面：左 = 既有失敗清單 / 記分板；右 = `<EmbeddedViewer sessionId={selected}>`。**session 來源 = 下拉選取器**（`GET /api/review-sessions` active；無則誠實 disable，S2）。
- 失敗清單「在 3D 高亮」鈕（取代 `pages.tsx:347`）：enable = IX-A1-06 四條件；`onClick`→`embeddedViewer.sendHighlight([{ifc_guid, severity, label, rule_code}])`；`onHighlightResult` 顯誠實結果。
- iframe 內 overlay 失敗清單收合（S3）。

### 4.3 viewer 側 listener（`Window.tsx` additive）

- `componentDidMount` 加 `window.addEventListener("message", this._onParentMessage)`（unmount 移除）。`_onParentMessage`：驗 `origin`（白名單）+ `protocol:"vg01"` + `window.parent !== window`；
  - `highlight`→**先 `canOperate` 守衛（M2）**→ 對每 item 走既有 HighlightBridge 路徑（經 `_overlayHighlight`（603）但補守衛，或抽純函式先判）→收 `HighlightResult`→postMessage `highlight_result`。**未就緒/spectator 靜默丟棄**。
  - `focus`→既有 focusPrim；`clear`→既有 `onClearHighlight`。
- **first frame（M1）**：於 `_completeStageLoad`（527，真完成點）postMessage `first_frame`，`_firstFramePosted` flag 只送一次。**不**接在 571/1306/1356（失敗/斷線/開檔路徑）。
- `stage_loaded`：stage 完成點 postMessage（真 loaded url，供 console 比對 stage truth）。
- `selected_guid`：`_reverseLookupGuid`（707）設值處 additive postMessage。

### 4.4 coordinator `first_frame_at` 後端化（`app.ts` additive、回歸鎖；行號經查證）

```
app.post("/api/review-sessions/:sessionId/first-frame", (req, res) => {
  if (!isSafeSessionId(sessionId)) return res.status(400)...;
  const session = store.get(sessionId); if (!session) return res.status(404)...;
  if (session.first_frame_at) return res.json({ session_id, first_frame_at: session.first_frame_at }); // 冪等
  const endpointId = typeof req.body?.endpoint_id === "string" ? req.body.endpoint_id : undefined;
  const actor = resolveActor(req);                       // best-effort（沿用既有）
  const at = nowIso();                                   // N3：coordinator 權威時戳，忽略 body.observed_at
  store.update(sessionId, { first_frame_at: at });
  eventLog.append(sessionId, "firstFrameObserved", { endpoint_id: endpointId, actor });
  res.json({ session_id: sessionId, first_frame_at: at });
});
// 型別鏈（M3）：
//  (1) summarizeSessionForRuntime（app.ts:2192）additive emit first_frame_at: string|null
//  (2) RuntimeSessionSummary（coordinatorClient.ts:94-105）additive 加 first_frame_at
//  (3) runtimeGovernance.ts:165 改讀 session.first_frame_at（取代 hardcoded "not_observed"）
```
- `nowIso()`：沿用 coordinator 既有時間來源。
- additive 欄不破既有 `runtime/status`（route 492-499 / `buildRuntimeStatus` 2115-2190）讀者；`first-frame` 路徑全新、零既有退化。
- **N2**：in-memory store，重啟後 `first_frame_at` 清除，下次 POST 重記。

### 4.5 console 證據顯示（`ViewerPresentationPage` + A1 頁）

- `ViewerPresentationPage`（`pages.tsx:358`）：`first_frame_at`（364）、`stage matched`（365/375）由 p1 翻真，讀 `runtime/status.sessions[].first_frame_at`（經 M3 型別鏈）與 `expected_stage_url == loaded`：到→綠 / 未到→灰（誠實 not_observed）/ mismatch→警示。
- A1 頁證據條：與高亮鈕 enable 條件（IX-A1-06）一致。

### 4.6 資料流（一句話）

A1 頁選 active session→跑檢核→失敗清單；右側 `<EmbeddedViewer>` iframe 載 viewer→真畫面到（`_hasRemoteVideoFrame()`，於 `_completeStageLoad` 觸發、flag 只送一次）→viewer `postMessage first_frame`→console 顯綠燈 + `POST .../first-frame`（coordinator 記 `first_frame_at`，型別鏈到 runtimeGovernance）；點失敗構件「在 3D 高亮」（IX-A1-06 四條件滿足才 enable）→console `postMessage highlight`→viewer **先判 canOperate**→既有 HighlightBridge→DataChannel→Kit 紅高亮→viewer `postMessage highlight_result`→console 顯誠實結果。全程：引擎/首幀重用、跨 frame 驗 origin、後端記真證據、前端零樂觀更新。

---

## 5. 錯誤處理

| 情境 | 行為 |
|---|---|
| postMessage origin / source 不符 / 缺 `protocol:"vg01"` | 靜默丟棄（安全/前向相容） |
| **viewer 收 highlight 但 `canOperate`=false（spectator / 未就緒）** | **靜默丟棄，不觸發 `_overlayHighlight`（M2 守 spectator 邊界）** |
| iframe viewer 未 ready / first frame 未到 | 高亮鈕 disabled + 「等待 3D 第一幀」，不送指令、不假成功 |
| 構件未對映 USD（`unmapped`） | viewer 回 `highlight_result{ok:false,reason:"unmapped"}`→console「此構件未對映，無法高亮」 |
| DataChannel 未就緒（`datachannel_not_ready`） | console「3D 尚未就緒」，鈕回 disabled |
| stage expected ≠ loaded | console mismatch 警示（非靜默、非假 matched） |
| `first-frame` POST：safe-id 400 / 不存在 404 / 已記 | 400/404 誠實顯錯；已記→冪等回傳，不重複 append |
| A1 頁無 active session | 「需先派發 review session」並 disable 高亮（不嵌空 iframe 假裝） |
| coordinator / viewer 連不上 | 誠實顯錯，不假成功、不改狀態 |

---

## 6. 測試與驗收

1. **coordinator route 測試（`tests/`，新 `session-first-frame.test.ts`）**：`first-frame` 帶/不帶 `endpoint_id`→`firstFrameObserved` event + session `first_frame_at` 寫入；safe-id 400 / 不存在 404 / 已記冪等；**型別鏈（M3）**：`summarizeSessionForRuntime`（2192）emit `first_frame_at`、`buildRuntimeStatus`（2115）透出；**回歸鎖**：既有 `runtime/status`（492）/ `review-sessions` / close 測試形狀零退化。
2. **前端 vitest**：
   - `EmbeddedViewer`：origin 不符的 message 丟棄；`vg01` message 分派；`post` targetOrigin 非 `"*"`。
   - A1 頁：IX-A1-06 四條件才 enable 高亮鈕；`highlight_result` 三 reason 對應誠實文案；無 session→disable；session 下拉（S2）。
   - viewer `_onParentMessage`：origin 驗證；**`canOperate`=false 時 highlight 靜默丟棄（M2）**；`highlight`→呼叫既有路徑（mock 驗序）；**first_frame 只在 `_completeStageLoad` 送一次（`_firstFramePosted` flag，fake stage-complete vs fake 失敗/斷線路徑不誤觸，M1）**。
   - **M3**：`runtimeGovernance.ts:165` 改讀後，`firstFrame` 反映 `session.first_frame_at`（非 hardcoded）；既有 `runtimeGovernance.test.ts` 更新。
   - 既有 `GovernanceOverlay.test.tsx` / `console.test.tsx` 不壞。
3. **GitNexus impact / detect_changes（web-viewer-sample indexed，CLAUDE.md MUST）**：改 `Window`（掛 listener / `_overlayHighlight` 守衛 / first_frame）、`A1GovernanceWorkbenchPage`、新增 `EmbeddedViewer` 前跑 `gitnexus_impact`（HIGH/CRITICAL 先回報）；commit 前 `gitnexus_detect_changes` 驗 scope 僅 `web-viewer-sample` 與 `bim-review-coordinator`。
4. **Browser E2E（Playwright，真 Kit 串流，唯一接受的 user-facing 證據）— 誠實可達框架**：守門 + 檔頭 skip 限制揭露比照既有 `*.spec.ts`。對 live 測試區：
   - 取 / 種 active review session（`POST /api/review-sessions` 綁 artifact_bindings，沿用既有真 IFC fixtures）。
   - 開 A1 頁 → 選 session → 右側 `<EmbeddedViewer>` 載入 → **截圖**：真 3D 畫面 + `first_frame` 綠燈 + `stage matched`。
   - 跑 A1 檢核 → 失敗清單；點一筆**已對映**失敗構件 → **截圖**：3D 紅高亮 + 鏡頭 focus。
   - 點一筆**未對映**構件 → **截圖**：誠實拒絕（`unmapped`）。**此張為對抗「3D 都是假的」質疑的核心信任證據（product angle 強調）。**
   - **cross-build-target**：E2E 前須重建 **console（`build:ui`）與 viewer（`docker compose build viewer` + `up -d`）兩者**（§7）；未重建任一→「改了沒效」假象。
   - **七區塊對齊（S5）**：E2E summary 明寫「僅對齊第 6（紅高亮）+ 7（反向）」。未觀察轉移以 `notObserved[]` 揭露；**不偽造**。截圖落 `artifacts/e2e/viewer-embed-a1-highlight-*` 與 tracked `docs/evidence/viewer-embed-a1-highlight/`。
5. **驗收基準**：coordinator `npm run verify`（build + test）＋ `web-viewer-sample` `npm run verify`（build）＋ vitest ＋ E2E（含誠實揭露）全綠 ＋ 四項回報；`#a1`/`#a2`/`#a3`/`#viewer`/`#sessions` 既有 E2E 與既有測試不壞。

---

## 7. 風險與緩解

- **cross-build-target（最大風險）**：本格改 **console（`build:ui`→`:8004/ui`）與 viewer（`:5173` dev-server image）兩個 target**。viewer FE 改動 `build:ui` 不會更新（記憶 `ui-open-redirects-to-5173-baked-viewer`）；改 `Window.tsx` 須 `docker compose build viewer` + `up -d`（分鐘級）。緩解 = plan **P0 前置**確認測試區能同時重建兩者並估時；E2E 前兩者皆重建，否則視為未驗證。
- **iframe sandbox/allow（S1，物理前提）**：跨 origin iframe 須 `sandbox="allow-scripts allow-same-origin"`（WebRTC + sessionStorage）+ `allow="autoplay"`（`<video>` 自動播放，否則白頁）；receive-only（`AppStream` `mic:false`）故不需 camera/mic。緩解 = plan **第一步以 harness 先驗 postMessage 通道 + iframe 能載 viewer 出畫面**，再接後續。
- **postMessage 跨 origin 安全（M5）**：送出 `targetOrigin` 非 `"*"`；接收驗 `event.origin` ∈ `VITE_ALLOWED_COORDINATOR_ORIGINS`（env.ts:9）+ `document.referrer` 交叉驗 + `event.source` frame + `protocol:"vg01"`。**不新增 env var**。
- **GitNexus impact（web-viewer-sample indexed）**：改 `Window`（核心元件，可能 HIGH）。緩解 = 編輯前 `gitnexus_impact({target:"Window", direction:"upstream"})`，HIGH/CRITICAL 先回報；listener / 守衛 / first_frame 皆 additive。
- **`canOperate` 繞過（M2）**：必在 `_onParentMessage` highlight 分支補 `canOperate`，否則 spectator 被遙控破邊界。vitest 專測。
- **first_frame 觸發點（M1）**：必接 `_completeStageLoad`（527）+ `_firstFramePosted` flag，否則失敗/斷線/開檔路徑誤觸→偽證據違誠實鐵律。
- **first_frame_at 權威/冪等（N2/N3）**：時戳由 coordinator `nowIso()` 寫（前端只觸發）；in-memory store 重啟後清除、下次重記（最小一筆非 exactly-once，完整持久化屬 IX-SS-02）。
- **session 取得（S2）**：A1 頁無 session 即無 stage 可載。緩解 = 下拉選取 active session + 無 session 誠實 disable；E2E 先種真 session。
- **誠實邊界（不殺 GPU、不重做高亮、七區塊只 6+7）**：PR body 標明 = console↔viewer 橋 + `first_frame_at` 後端化；高亮引擎重用；first frame 只記一筆。
- **不在 main 開發**：branch → PR → Actions → merge；本 spec 落 `docs/superpowers/specs/`，接 `writing-plans` → `spec-to-done`。

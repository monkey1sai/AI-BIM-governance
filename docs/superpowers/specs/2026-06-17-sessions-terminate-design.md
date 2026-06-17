# IX-SS-04：#sessions「結束 session」控制動作（重用 close 路由、模式 3 audit）設計

- 文件性質：spec design（設計文件）。權威序：code > contracts > AGENTS > `docs/plans` 行為合約 > wiki；與實作衝突時以實作程式碼與 `docs/plans/ai-bim-governance-互動實作規格與標準對齊.md` 的 **IX-SS-04 互動卡（line 164）** 與「模式 3 危險動作三段式」（line 99-105）為準。
- 日期：2026-06-17
- Phase 對應：**M2→M3 過渡的 #sessions 控制動作首張卡**。對應互動規格 IX-SS-04（`…互動實作規格與標準對齊.md:164`：「結束 session（待建）：模式 3 → `POST /api/sessions/:id/terminate`；成功後該列轉灰 60 秒再移除（讓 operator 看見因果）」）。前置：`#sessions` 讀側已 real（`GET /api/runtime/status` 讀 live `SessionStore`，`bim-review-coordinator/src/app.ts:478-485`），controlled-action 模式 3 已於 PR #221（IX-CV-03）首次落地、`IntentDialog` 共用件已存在。
- userFacing：true（`#sessions` / `SessionManagementPage`）。本輪把 `#sessions` 上「結束 session」從無按鈕（控制面板全 disabled，`web-viewer-sample/src/console/pages.tsx:687-691`）翻成 per-row 真按鈕＋真後端 release。
- **執行時機**：本 spec 為「排隊」產物。**必須等 in-flight 的 conv-watch-toggle（IX-CV-04 / M2-c，branch `claude/peaceful-payne-6785a9`）merge 後**再開跑 spec-to-done，避免兩個 controlled-action 卡並行改前端共用件造成 merge 衝突。
- **關鍵設計決策（使用者裁定 2026-06-17）**：terminate **不開新路由**，**重用既有 `POST /api/review-sessions/:sessionId/close`**（`app.ts:795-829`，已含 `markKitBindingsDraining`→`releaseKitBindings`＋事件流）。為滿足模式 3 的 audit 要求，在**同一條 close 路由** additive 補 optional `reason` 並把 `reason`/`actor` 寫進**既有 session 事件流**。**與 spec 原文 URL（`/api/sessions/:id/terminate`）的偏離為刻意**：使用者選擇最小改動、零重複 release 邏輯，且 cooperative `close` 在語意上是 operator `terminate` 的超集（同樣 drain→release binding＋append 終結事件）。見 §3 偏離揭露。

## 1. 背景與現狀（盤點已實證）

`#sessions` 的「結束 session」**讀側已 as-built、寫側全 disabled**：

- **後端 close 路由已成熟**：`POST /api/review-sessions/:sessionId/close`（`app.ts:795-829`）：`isSafeSessionId` 不合法→400（`app.ts:796`）；`store.get` 不存在→404（`app.ts:801`）；**已 `closed` → 冪等回傳 session（`app.ts:805-808`）**；否則 `store.update(status:"closing", kit_instance_bindings: markKitBindingsDraining(...))`（`app.ts:811-814`）→ `eventLog.append("sessionClosing", {final_events})`（`app.ts:815`）→ append 每筆 `final_events`（`app.ts:816-818`）→ `store.update(status:"closed", participants:[], kit_instance_bindings: releaseKitBindings(...))`（`app.ts:819-823`）→ `eventLog.append("sessionClosed", {})`（`app.ts:824`）＋ `eventLog.append("kitInstanceReleased", {kit_instance_bindings})`（`app.ts:825-827`）。**現狀缺口**：body 只收 `final_events`（`app.ts:810`），**不收 `reason`、不寫 actor**——模式 3 的 audit 那段未落地。
- **release 真實發生**：`releaseKitBindings`（import `app.ts:38`）真正釋放 binding；`markKitBindingsDraining`（`app.ts:37`）先標 draining。binding 釋放後座位可被新 session 取用。
- **session 事件流即稽核帳本**：`eventLog.append(session_id, type, payload)` 是 session 的 append-only 稽核軌；`sessionClosing`/`sessionClosed`/`kitInstanceReleased` 已在帳上。⇒ 模式 3 的 audit（who/when/what/reason）**最自然的補法 = 把 `reason`/`actor` additive 加進 `sessionClosing`/`sessionClosed` 的 payload**，零新基礎設施。
- **讀側 real（不被 DEMO 規則封鎖）**：`GET /api/runtime/status`（`app.ts:478-485`）→ `buildRuntimeStatus`（`app.ts:2001-2076`）→ `sessions.items` 由 `summarizeSessionForRuntime`（`app.ts:2078+`）emit `session_id`/`status`/`participant_count` 等真欄位（`classification:"coordinator_visible_runtime_summary"`，`app.ts:2063`，誠實 scoping 非 demo）。
- **前端 `#sessions` 面板（唯讀）**：`SessionManagementPage`（`pages.tsx:656`）讀 `coordinatorClient.runtimeStatus()`（`pages.tsx:661`），`sessions = rt?.sessions.items ?? []`（`pages.tsx:665`），per-row 表渲染 `s.session_id`/`s.status`/`s.participant_count`/`s.conversion_status`/`s.expected_stage_url`（`pages.tsx:682-683`，**唯讀、無動作鈕**）。「Controlled actions」面板四顆全 disabled（`pages.tsx:688-691`）。
- **client POST helper 已具備**：`coordinatorClient` 已有 `jsonPost`（IX-CV-03 / #221 加）；本輪只新增一支 thin wrapper。`IntentDialog`（`web-viewer-sample/src/console/IntentDialog.tsx`，#221 建）已是成熟可重用件：props `{open,title,cost,onConfirm,onCancel,busy,actionErr}`、非樂觀（`await onConfirm` 成功才由 caller 關閉）、uncontrolled `reason` textarea。

仍讓 `#sessions` 沒有「結束 session」能力的缺口：

1. **close 路由不收 reason / 不寫 actor**：模式 3 audit 缺一角（`app.ts:810` body 只取 `final_events`）。
2. **前端無 per-row 結束鈕**：session 表（`pages.tsx:682-683`）唯讀；控制面板（`pages.tsx:687-691`）非 per-row、全 disabled 佔位。
3. **session_id 形狀需驗證**：`isSafeSessionId` 只認 `^review_session_`（與 conv-prioritize-retry §1 所述 `isSafeConversionJobId` 註解一致）；但 `pages.tsx:2074` 提及 viewer 入口接受「`lwv_` / `review_session_` 前綴」。⇒ 須驗證 `runtime/status` 的 `sessions.items` 實際 `session_id` 前綴；若出現 `lwv_`，前端對 close 回 400 須誠實顯錯（不假成功），spec §6 列為驗證點。

**誠實鐵律硬限制**（`…md:99-105`）：模式 3 = ① intent（按鈕→confirm 對話框，內容含成本與後果白話）② confirm（按確認→POST，body 含 optional `reason`）③ result（證據型更新：依後端真狀態刷新；audit who/when/what/reason 由後端寫）。**禁止**樂觀更新、假資料、localStorage 存業務狀態（`…md:184`）。B 方案 LAN internal、**無 RBAC user 模型** ⇒ audit「who」誠實 best-effort（caller header，無身分記 `local-operator`），不偽造身分。

## 2. 目標（成功標準）

> **任務相依排序（plan 須遵守）**：§2.1 後端 close 路由 additive（reason/actor 上 audit）為**最先**且回歸鎖；§2.2 client wrapper 依賴 §2.1；§2.3 前端 UI 依賴 §2.2；§2.4 E2E 最後。

1. **後端 close 路由 additive 補 audit（重用、不開新路由）**：`POST /api/review-sessions/:sessionId/close`（`app.ts:795-829`）：
   - body additive 接受 optional `reason: string`（沿用既有 `final_events` 解析風格，`app.ts:810`；缺省為 undefined，不破既有 cooperative close 呼叫端）。
   - 解析 `actor`：caller header best-effort（沿用 IX-CV-03 audit 規則）或 `local-operator`。
   - `sessionClosing` payload additive 加 `reason`/`actor`（`app.ts:815`）；`sessionClosed` payload additive 加 `reason`/`actor`（`app.ts:824`）。
   - **既有 release 邏輯（`markKitBindingsDraining`→`releaseKitBindings`＋`kitInstanceReleased` 事件）零改動**；冪等（已 closed 回傳）零改動；safe-id/404 零改動。
   - 不外溢內部欄位；`reason` 不入回傳 body（回傳維持 `closed` session 物件，避免形狀退化）。
2. **前端 client thin wrapper**（`coordinatorClient.ts`）：新增 `sessionClose(sessionId, reason?) => jsonPost(\`/api/review-sessions/${encodeURIComponent(sessionId)}/close\`, { reason })`（重用既有 `jsonPost`；body 只帶 `reason`，不帶 `final_events`——operator 強制結束無協作終結事件）。
3. **前端 `#sessions` per-row「結束 session」真按鈕**（`SessionManagementPage`，`pages.tsx`）：
   - session 表（`pages.tsx:682-683`）每列加一顆「結束 session」鈕：**僅未終結狀態顯示**（`s.status === "active"`；`closing`/`closed` 不給假按鈕，顯示狀態文字即可）。
   - 點按 → 開既有 `IntentDialog`（cost 文案：「將結束此 session 並釋放其 Kit 座位，座位可被新 viewer 取用。**這不會強制關閉 GPU 上的 Kit 行程**（Kit 行程 lifecycle 屬 kit-manager-api）」）→ `onConfirm`：`await coordinatorClient.sessionClose(sessionId, reason)` → 成功 `await load()` 重抓 `runtime/status`（**非樂觀**）→ 失敗 `setActionErr` 誠實訊息、不改狀態、不關 dialog（沿用 #221 的 `actionErr`/`actionBusy` pattern）。
   - **「該列轉灰 60s 再移除」UX（IX-SS-04 原文「看見因果」）**：成功後該列標記 `terminating`（灰樣式，用既有 `ec-*` class）並啟 60s timer 後從可見列移除；其間 `load()` 重抓若該 session 已 `closed` 亦呈灰。timer 以 component-local state 管理，unmount 時清除（避免 leak）。
   - state 加 `pendingAction:{sessionId}|null` ＋ `actionBusy` ＋ `terminatingIds:Set<string>`（灰列）。
4. **誠實鐵律維持**：無樂觀更新（POST 成功後 `load()` 重抓真狀態）；非 active session 不給假按鈕；錯誤（400/404/5xx）顯誠實訊息不假成功；audit「who」best-effort 非身分稽核。
5. **Browser E2E（Playwright，A1–A10 唯一接受的 user-facing 證據）通過**：見 §6.4（誠實可達框架）。

## 3. 偏離揭露與非目標（明確不做）

**刻意偏離 spec 原文 URL（使用者裁定，須寫進 PR body）**：
- IX-SS-04 原文指定 `POST /api/sessions/:id/terminate`；本實作**重用 `POST /api/review-sessions/:sessionId/close`**，不開 `/terminate` 新路由。理由：(a) 使用者選擇最小改動、零重複 release 邏輯；(b) cooperative `close`（drain→release binding＋append 終結事件）在語意上是 operator `terminate` 的超集，行為等價；(c) 避免兩條語意重疊路由日後分裂。**權威序**：使用者最新明確指令 > docs/plans 行為合約，故此偏離合規。PR body 與 UI 文案明確標示「結束＝協作式 close 的 operator 觸發」。

**非目標**：
- **不開 `POST /api/sessions/:id/terminate` 新路由**（重用 close）。
- **不做 IX-SS-03（`POST /api/sessions/:id/endpoints/:ep/release` 強制釋放 stale endpoint / reclaim spectator）**：其啟用條件依賴 `first_frame_at` / Kit DataChannel heartbeat telemetry（IX-SS-02），而 `first_frame_at` 後端零實作、`last_heartbeat_at`（`app.ts:2050`）僅 binding lifecycle 時間戳非真心跳 ⇒ 在假 liveness 上做真釋放會踩誠實鐵律。`pages.tsx:690-691`（Reclaim stale spectator / Force release primary）**維持 disabled**，屬下一格、須先補 IX-SS-02。
- **不做 IX-KG（節點 drain / move / assign）**：獨立 follow-up。
- **不碰 `bim-streaming-server` / 不殺 GPU Kit 行程**：terminate 僅釋放 coordinator 端 session/binding；Kit 行程 lifecycle 屬 `kit-manager-api`（`pages.tsx:852` 已標 p1）。
- **不建全站 RBAC / audit 持久層**：audit = session 事件流一筆（B 方案 LAN），不做使用者身分系統。
- **不改 `final_events` 既有 cooperative close 行為**：viewer 既有 close 呼叫端（帶 `final_events`、不帶 `reason`）零退化。
- **不引入新 production dependency、瀏覽器不直連 :49101/:49102**。

## 4. 設計（縱切）

### 4.1 後端 close 路由 additive（`app.ts:795-829`，additive、回歸鎖）

```
app.post("/api/review-sessions/:sessionId/close", (request, response) => {
  // safe-id 400 / not-found 404 / already-closed 冪等回傳：全不動（app.ts:796-808）
  const reason = typeof request.body?.reason === "string" ? request.body.reason : undefined;     // ← additive
  const actor = resolveActor(request);  // caller header best-effort 或 "local-operator"（沿用 #221）  // ← additive
  const finalEvents = Array.isArray(request.body?.final_events) ? request.body.final_events : [];  // 不動
  const closing = store.update(... markKitBindingsDraining ...);                                    // 不動
  eventLog.append(session.session_id, "sessionClosing", { final_events: finalEvents.length, reason, actor }); // ← additive 欄
  for (const event of finalEvents) eventLog.append(..., "finalReviewEvent", event);                // 不動
  const closed = store.update(... status:"closed", releaseKitBindings ...);                        // 不動
  eventLog.append(session.session_id, "sessionClosed", { reason, actor });                          // ← additive 欄（原 {}）
  eventLog.append(session.session_id, "kitInstanceReleased", { kit_instance_bindings: ... });        // 不動
  response.json(closed);                                                                            // 不動（不外溢 reason）
});
```
- `resolveActor`：若 #221 已落地共用 helper 則重用；否則 inline best-effort（讀既有 caller header，無則 `local-operator`）。**plan 須先確認 #221 merge 後此 helper 是否已存在於 main**，避免重複定義。
- 影響面：`eventLog.append` payload 為 append-only JSON，additive 欄不破既有讀者；`final_events` 路徑零改動。

### 4.2 前端 client（`coordinatorClient.ts`）

- 新增 `sessionClose: (sessionId: string, reason?: string) => jsonPost<RuntimeSessionItem|SessionCloseResponse>(\`/api/review-sessions/${encodeURIComponent(sessionId)}/close\`, { reason })`。回傳型別比照 close 路由現有回傳（`closed` session 物件）；若既有 client 無對應型別，新增最小 `SessionCloseResponse = { session_id: string; status: string }`（只取消費端用到的欄位）。

### 4.3 前端 `#sessions` UI（`SessionManagementPage`，`pages.tsx`）

- state：`pendingAction:{sessionId:string}|null`、`actionBusy:boolean`、`actionErr:string|null`、`terminatingIds:Set<string>`。
- session 表（`pages.tsx:682-683`）每列末加一欄動作：
  - `s.status === "active"` 且 `!terminatingIds.has(s.session_id)` → 「結束 session」鈕（`onClick`：`setPendingAction({sessionId:s.session_id})`）。
  - `terminatingIds.has(s.session_id)` 或 `s.status` ∈ {`closing`,`closed`} → 灰列、無鈕（顯狀態文字）。
- `IntentDialog`（重用）：`open={!!pendingAction}`、`title="結束 session"`、`cost=` 上述誠實文案、`busy={actionBusy}`、`actionErr={actionErr}`、`onCancel`：`setPendingAction(null); setActionErr(null)`、`onConfirm:async (reason) => { setActionBusy(true); try { await coordinatorClient.sessionClose(pendingAction.sessionId, reason); markTerminating(pendingAction.sessionId); setPendingAction(null); await load(); } catch(e){ setActionErr(誠實訊息) } finally { setActionBusy(false) } }`。
- `markTerminating(id)`：`terminatingIds.add(id)` ＋ `setTimeout(()=> 從可見列移除, 60_000)`；timer ref 收集於 component，`useEffect` cleanup 清除。
- 移除/取代 `pages.tsx:687-691` 控制面板的「結束/釋放」誠實佔位敘述（保留 690/691 disabled 的 IX-SS-03 佔位；新增 per-row 結束鈕為 IX-SS-04 真落地）。

### 4.4 資料流（一句話）

`#sessions` 列「結束 session」→ `IntentDialog` confirm(reason) → `POST .../close {reason}` → coordinator 驗 safe-id/存在 → `markKitBindingsDraining`→`releaseKitBindings` ＋ `sessionClosing`/`sessionClosed`（含 reason/actor）事件 → 回 `closed` session → 前端 `load()` 重抓 `runtime/status` 看到 `active→closed`、該列轉灰 60s 後移除。全程後端裁決、前端零樂觀更新。

## 5. 錯誤處理

| 情境 | 行為 |
|---|---|
| `:sessionId` 不合法（非 `review_session_` 前綴，含 `lwv_` 若存在） | 400；前端顯誠實錯誤、不改狀態（§6 須驗證實際前綴） |
| session 不存在 | 404；前端顯誠實錯誤 |
| session 已 `closed` | 200 冪等回傳；前端視為成功、該列呈灰移除（非錯誤） |
| coordinator 連不上 / 5xx | 前端顯誠實錯誤，不顯假成功、不改狀態、不關 dialog |
| 重複點同一動作 | `actionBusy` 鎖 + dialog busy；`terminatingIds` 防重複觸發 |
| terminate 後 Kit 行程仍在跑 | **預期**：本動作只釋放 coordinator binding；文案已誠實標明不殺 GPU 行程 |

## 6. 測試與驗收

1. **後端 route 測試（`tests/` 既有 session close 測試擴充或新 `session-close-audit.test.ts`）**：
   - close 帶 `reason` → `sessionClosing`/`sessionClosed` 事件 payload 含 `reason`/`actor`（讀 `eventLog`/lifecycle-events 斷言）。
   - close 不帶 `reason`（既有 cooperative 呼叫端）→ 行為零退化（`reason` undefined、release 照常、`final_events` 照常 append）。
   - 已 closed 冪等回傳；safe-id 400；不存在 404；`releaseKitBindings` 真實釋放（binding `released_at` 寫入 / status 轉換）。
   - 回歸鎖：既有 close / runtime-status / external-ifc-ready 相關測試形狀零退化。
2. **前端 vitest（`pages.tsx` / `SessionManagementPage`）**：
   - 結束鈕僅 `status==="active"` 顯示；`closing`/`closed` 不顯。
   - 點按開 `IntentDialog`；confirm 呼叫 `sessionClose`；成功後 `load()` 重抓（非樂觀，mock client 驗呼叫序）。
   - 失敗 → `actionErr` 顯示、dialog 不關、狀態不變。
   - `terminatingIds` 灰列 + 60s 後移除（fake timer 驗）。
3. **GitNexus impact / detect_changes**：改 `close` 路由前跑 `gitnexus_impact` on close handler / `eventLog.append` 消費端；commit 前 `gitnexus_detect_changes` 驗 scope 僅 `bim-review-coordinator`（close 路由 + audit）與 `web-viewer-sample`（client + `#sessions` UI）。
4. **Browser E2E（Playwright，`e2e/sessions-terminate.spec.ts`）— 誠實可達框架**：守門 + 檔頭 skip 限制揭露比照 `conv-prioritize-retry.spec.ts`。對 **live 測試區實際存在的 active session** 驗端到端控制切片：列出現「結束 session」鈕 → 點按開 `IntentDialog` → 確認 → 觀察一次**真後端回應**（POST 2xx + `runtime/status` 重抓該 session `active→closed` + 該列轉灰/移除）。
   - 測試區無 active session（常態）→ 先 `POST /api/review-sessions` 種一個真 session（綁 artifact_bindings，沿用既有 fixtures）再驗結束切片。
   - 未觀察到的轉移以 `notObserved[]` 原文揭露，深度因果由 route 測試（§6.1）兜底；**不偽造**。
   - 截圖 + summary 落 `artifacts/e2e/sessions-terminate-*` 與 tracked `docs/evidence/sessions-terminate/`。
5. **驗收基準**：coordinator `npm run verify`（= build + test）＋ 前端 vitest ＋ E2E（含誠實揭露）全綠 ＋ 四項回報（改了哪些 tracked files / 最小驗證 / 哪些測試沒跑及原因 / 已知風險）；`#a1`/`#a2`/`#conv`/`#sessions` 既有 E2E 與 session 既有測試不壞。

## 7. 風險與緩解

- **重用 close 路由的 audit additive**：低風險（純 append-only 事件 payload 加欄）。緩解 = 回歸鎖既有 close 測試（不帶 reason 的 cooperative 路徑零退化）；GitNexus impact 確認 `eventLog.append` 消費端不因 additive 欄破裂。
- **session_id 前綴假設**：`isSafeSessionId` 只認 `^review_session_`，但 viewer 入口提及 `lwv_`（`pages.tsx:2074`）。緩解 = plan 第一步**先驗** `runtime/status` 的 `sessions.items[].session_id` 實際前綴；若含 `lwv_`，前端對 400 誠實顯錯（本卡不擴 safe-id，列為已知限制揭露），或於 plan 評估是否 additive 放寬 safe-id（須另跑 impact）。
- **「灰列 60s」timer 生命週期**：緩解 = timer ref 收集 + `useEffect` cleanup 清除，避免 unmount leak / setState-after-unmount。
- **誠實邊界（不殺 GPU 行程）**：confirm 文案、DoD、PR body 明確標示 terminate = 釋放 coordinator 端 binding；Kit 行程 lifecycle 屬 `kit-manager-api`，不宣稱已 kill。
- **URL 偏離 spec（§3）**：刻意、使用者裁定、行為等價；PR body 揭露，UI 文案標「結束＝協作式 close 的 operator 觸發」。
- **執行時機相依**：須等 conv-watch-toggle（IX-CV-04）merge 後再跑，避免並行改 `pages.tsx` / `coordinatorClient.ts` / `IntentDialog` 共用件衝突；plan 啟動前先 `git fetch` 確認 main 含 #221（`resolveActor`/`jsonPost`/`IntentDialog`）與 IX-CV-04 已落地。
- **Sizing 誠實**：後端 additive（小）+ 前端 per-row 鈕 + 灰列 UX + E2E 種 session，屬 **M**。重用 close 路由與既有 `IntentDialog`/`jsonPost` 大幅降低成本，可單一 spec-to-done 完成。
- **不在 main 開發**：branch → PR → Actions → merge；本 spec 落 `docs/superpowers/specs/`，接 `writing-plans` → `spec-to-done` 執行。

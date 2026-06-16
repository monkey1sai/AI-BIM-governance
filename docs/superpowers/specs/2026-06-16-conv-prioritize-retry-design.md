# M2-b：#conv 轉檔佇列「插隊／重試」控制動作（IX-CV-03，產品首個 controlled action）設計

- 文件性質：spec design（設計文件）。權威序：code > contracts > AGENTS > docs/plans 行為合約 > wiki；與實作衝突時以實作程式碼與 `docs/plans/ai-bim-governance-互動實作規格與標準對齊.md` 的 IX-CV-03 互動卡（line 156）與「模式 3 危險動作三段式」（line 99-105）為準。
- 日期：2026-06-16
- Phase 對應：**M2「轉檔管線」控制動作收斂（M2-b）**。對應 v3 計畫 M2 控制面 DoD 與互動規格 IX-CV-03（`docs/plans/ai-bim-governance-互動實作規格與標準對齊.md:156`：「插隊 `POST /api/conversion/jobs/:id/prioritize`、重試 `POST .../retry`；待建 endpoint，UI 先以 disabled+規格呈現」）。前置 M1/A1 核心閉環已於 PR #213 收尾、M2-a coverage 唯讀展開已於 PR #218 merged（讀的那半），milestone-order 解鎖；本輪做 M2 **寫/控制那半**的第一張卡（插隊／重試）。
- userFacing：true（`#conv` / `ConversionSchedulingPage`）。本輪把 `#conv` 上「插隊 / 重試 controlled action endpoint 待建」的誠實佔位（`web-viewer-sample/src/console/pages.tsx:496` `prov="p1"`）翻成真按鈕＋真端點。
- 來源範圍決策：插隊／重試操作的對象是**協調器端 in-memory dispatch FIFO**（`ConversionDispatchQueue`），不是 `bim-streaming-server` 的轉檔引擎。協調器 owns「序列化 dispatch、單一 in-flight slot」（`conversionDispatchQueue.ts:1-13`），故端點與佇列重排邏輯**全部落在 coordinator**；`bim-streaming-server` 本輪**零改動**（仍只收同一條 `POST /api/conversions/ifc-to-usdc` 派工）。`:id` = **`ifc_ready_job_id`**（未派工 job 還沒 `conversion_job_id` — 見 §1）。
- **非純 additive 警示（spec-verify 對抗複驗 cr1 修正）**：本 spec **必須修改 coordinator dispatcher closure 的 `pendingDispatchEvents` 刪除時機**（見 §2.0 / §4.0）——否則 retry 在邏輯上不可能成立（見 §1 dispatch 生命週期）。這不是新增 method，是既有 dispatch 行為變更，須跑 GitNexus impact + 回歸鎖。

## 1. 背景與現狀（盤點已實證）

M2 轉檔的「派工佇列」**已實質 as-built，但只有讀、沒有控制**：

- **協調器端序列 dispatch 佇列已存在**：`ConversionDispatchQueue`（`bim-review-coordinator/src/services/conversionDispatchQueue.ts`）是 in-memory FIFO，序列化 `POST /api/conversions/ifc-to-usdc`，單一 in-flight。提供 `enqueue`（27）、`getQueuePosition`（36：in-flight→0、queued→1-based、不在→null）、`getInFlight`（42）、`getQueuedJobIds`（46）、`drain`（55）。**沒有 reorder、沒有 retry method**（`conversion-dispatch-queue.test.ts` 鎖現行行為）。
- **job 狀態機已成熟**：`IfcReadyIntakeStatus`（`types.ts:154-165`）= `accepted` → `queued_for_conversion`（持 1-based `queue_position`）→ `dispatched` / `dispatch_failed` / `dropped_on_restart` / `failed`。store（`externalIfcReadyStore.ts`）方法齊全：`markQueuedForConversion`（117，寫 `queue_position`）、`markDispatched`（102，清 `queue_position=null`）、`markDispatchFailed`（183，狀態→`dispatch_failed`、註解明寫「為可重試狀態」）、`markDroppedOnRestart`（131）、`get`（277）、`list`（281）。
- **dispatch 接線 ＋ 生命週期真相（cr1 修正重點）**：`conversionDispatchQueue`（`app.ts:382`）的 dispatcher closure（`app.ts:398-429`）`enqueue` 於 intake 同步下載完成後（`app.ts:845`，`pendingDispatchEvents.set` 在 `838-844`、`markQueuedForConversion` 在 `851-854`），drain 於 dispose（`app.ts:1821-1824`，連同 `pendingDispatchEvents.delete`）。**關鍵**：closure 在 worker 取件時**先 `pendingDispatchEvents.delete(jobId)`（`app.ts:400`）才嘗試 `createConversionJob`**；失敗的 `markDispatchFailed` 在 `app.ts:424`（delete 之後）。⇒ **任何進入 `dispatch_failed` 的 job，其 `pendingDispatchEvents` 脈絡在同一 process 內就已被刪**（非僅重啟後）。若不改此刪除時機，retry 重新 enqueue 後 worker 會在 `app.ts:401 !pending` 立即 `markDispatchFailed("pending dispatch event lost before worker pickup")`，永遠回不到 `queued_for_conversion` → 本卡的唯一 user-facing 證據（E2E 狀態轉移）不可能通過。故 §4.0 必須先修。
- **conversion_job_id 在派工成功才產生**：`markDispatched(jobId, conversionJobId, …)`（store:102-114）才寫 `conversion_job_id`；**未派工 / 派工失敗 / 排隊中的 job `conversion_job_id` 為 null**（store create:61）。⇒ 插隊／重試的對象只能用 `ifc_ready_job_id` 定位，不能用 `conversion_job_id`。
- **`queue_position` 尚未上 wire（cr1 BLOCKER 2 修正）**：`summarizeIfcReadyJob`（`app.ts:1938-1967`，**非 1907**；C 頁列表與單一 job 共用）**未輸出 `queue_position`**；`IfcReadyListItem`（`coordinatorClient.ts:99-115`）**亦無此欄**。前端目前拿不到 position。⇒ §4.3 必須把 `queue_position` 補上 wire 與型別，否則 §4.5 插隊鈕（`queue_position==null` 即 disabled）會永久 disabled、功能靜默失效。
- **safe-id helper 已有通用版**：`isSafeConversionJobId`（`app.ts:57`，pattern `^[A-Za-z0-9_.-]+$`，#218 加；註解明寫「不可複用 `isSafeSessionId` —— 其 pattern 只認 `^review_session_`」）。`ifc_ready_job_id` 形狀 `ifcready_<ts>_<hex>`（store create:47），落在同一通用字元集。
- **前端 client 與 #conv 面板已成熟（唯讀）**：`coordinatorClient`（`coordinatorClient.ts:153-165`）目前**只有 GET**（`jsonGet`，27），無 POST helper。`IfcReadyListItem`（99-115）已含 `status` / `conversion_status` / `dispatch_error` / `conversion_job_id` 等欄位。`#conv`（`pages.tsx:437-579`）ifc-ready job 表（540-574）已可展開看 coverage（#218）。

仍讓 `#conv` 沒有「插隊／重試」控制能力的缺口：

1. **協調器無控制端點**：`app.ts` 無 `prioritize` / `retry` POST（全 repo grep 證實）。`ConversionDispatchQueue` 無 reorder / retry method。
2. **前端是寫死佔位**：`pages.tsx:496` `<Field k="插隊 / 重試 / concurrency" v="UI rule 已定義，controlled action endpoint 待建" prov="p1" />` —— 非可操作按鈕。
3. **產品尚無任何 controlled-action 基礎件**：全 console 的「會改狀態動作」目前一律 disabled 佔位（如 `SessionManagementPage` `pages.tsx:612-615`）。`docs/plans/…md:184` 指定 confirm 對話框共用 `<IntentDialog cost onConfirm>`，但 **`IntentDialog` 全 repo 尚未存在**（grep 無）。⇒ 本輪是 IX 模式 3（intent→confirm→audited）在產品的**首次真落地**，需建最小可重用 `IntentDialog`。

**誠實鐵律硬限制**：模式 3（`…md:99-105`）= ① intent（按鈕 → confirm 對話框，內容含「成本與後果」白話）② confirm（按確認 → POST，body 含 `reason` 可空）③ result（證據型更新：依後端真狀態刷新；audit who/when/what/reason 由後端寫）。**禁止**樂觀更新、假資料、localStorage 存業務狀態（`…md:184`）。B 方案為 LAN internal、**無 RBAC user 模型** ⇒ audit 的「who」誠實記為 best-effort（caller header，無身分時記 `local-operator`），不偽造身分。

## 2. 目標（成功標準）

> **任務相依排序（plan 須遵守）**：§2.0 dispatcher 修正 + §2.1 佇列 method + §2.3 `queue_position` 上 wire 為**最先**且須回歸鎖；§2.2 路由依賴前三項；§2.4/§2.5 前端依賴路由；§2.7 E2E 最後。

0. **（先做・cr1 BLOCKER 1）dispatcher delete-on-success 改造**：把 `app.ts:398-429` closure 的 `pendingDispatchEvents.delete(jobId)` 從「worker 取件即刪」改為「**`markDispatched` 成功後才刪**」；失敗（catch `markDispatchFailed`）**保留** pending 脈絡，使 `dispatch_failed` job 可被 retry 重派；`!pending` 守門路徑（脈絡確實不存在，如重啟/drain 後）維持立即 `markDispatchFailed`；`drain` 仍刪 pending（`app.ts:1824` 不動）。此為既有 dispatch 行為變更，須 GitNexus impact + 回歸鎖（見 §6/§7）。
1. **`ConversionDispatchQueue` additive 補兩 method**（純記憶體、不改既有 FIFO/worker/drain 語意）：
   - `prioritize(jobId): boolean` —— `jobId` 在 `queued[]` 非首 → splice+unshift 到前端回 `true`；已在 queued 首（index 0）→ 成功 no-op 回 `true`；in-flight 或不在 queue → 回 `false`。不碰 `inFlightJobId`/worker（in-flight 不可被搶下）。
   - `requeue(jobId): number` —— 重新 `enqueue` 並回新的 `getQueuePosition`（給 retry 用）。
   - 既有 `enqueue`/`getQueuePosition`/`drain`/worker 與 `conversion-dispatch-queue.test.ts` 既有斷言**零退化**。
2. **協調器新增兩條 production 控制路由**（route 比照既有 conv route，§4.2）：
   - `POST /api/conversion/jobs/:id/prioritize`（`:id`=`ifc_ready_job_id`）：safe-id 不合法→400；不存在→404；狀態非 `queued_for_conversion`→409；in-flight（queue 回 false）→409；成功 → `queue.prioritize` ＋**重算受影響 queued position**（§4.2）→ 回 `{ ifc_ready_job_id, status, queue_position, queued_order }`。
   - `POST /api/conversion/jobs/:id/retry`：safe-id；不存在→404；狀態非 `dispatch_failed`/`dropped_on_restart`→409；pending 脈絡**確實不存在**（重啟/drain 後，§4.0 修正後此為少數路徑）→422 誠實「請重新進件」；成功 → `requeue`＋`markQueuedForConversion`（用 requeue 回傳 position，**不用 0 哨兵**）→ 回 `{ ifc_ready_job_id, status: "queued_for_conversion", queue_position }`。
   - 兩路由永遠開啟（非 dev-gated）、只動協調器自有 dispatch 佇列、不外溢內部欄位；body 接受 optional `{ reason?: string }`。
3. **（cr1 BLOCKER 2）`queue_position` 上 wire**：`summarizeIfcReadyJob`（`app.ts:1938-1967`）回傳物件 additive 加 `queue_position: job.queue_position ?? null`；`IfcReadyListItem`（`coordinatorClient.ts:99-115`）加 `queue_position?: number | null`。其餘 wire 形狀零退化（`external-ifc-ready.test.ts` 回歸鎖）。
4. **協調器 audit（模式 3 ③）**：每次 prioritize/retry 成功寫一筆結構化 audit log（`{ action: "conversion.prioritize"|"conversion.retry", ifc_ready_job_id, reason, actor, at }`，`actor`=caller header best-effort 或 `local-operator`），沿用既有結構化 log 路徑（`structLog`，不新增基礎設施）；job `updated_at` 反映變更作為前端可見證據。
5. **前端最小 `IntentDialog`（模式 3 ① ②，首個 controlled-action 共用件）**：新增 `web-viewer-sample/src/console/IntentDialog.tsx` —— modal 顯示 `cost`（成本/後果白話）＋ optional `reason` ＋「確認執行/取消」；**非樂觀**：confirm 後 POST，成功才關閉並觸發證據型刷新。
6. **前端 `#conv` job 列真控制按鈕**：`coordinatorClient` 補 `jsonPost` ＋ `conversionPrioritize(id, reason?)` / `conversionRetry(id, reason?)`。ifc-ready job 表每列依狀態渲染：
   - 「插隊」：僅 `status==="queued_for_conversion"` 顯示；`queue_position==null || queue_position<=1`（in-flight/已隊首）→ disabled+tooltip。
   - 「重試」：僅 `status∈{dispatch_failed,dropped_on_restart}` 顯示。
   - 點按 → `IntentDialog` → 確認 POST → 成功 `load()` 重抓佇列（證據型更新）；失敗顯誠實錯誤、不改狀態。
   - 取代 `pages.tsx:496` 的 `prov="p1"` 佔位 Field。
7. **誠實鐵律維持**：無樂觀更新（POST 成功後重抓真狀態）；不可重試/插隊狀態不給假按鈕；端點錯誤（400/404/409/422/5xx）顯誠實訊息不假成功；audit「who」誠實 best-effort。
8. **Browser E2E（Playwright，A1–A10 唯一接受的 user-facing 證據）通過**：見 §6.4（誠實可達框架——對 live 測試區實際存在的佇列狀態驗「按鈕→IntentDialog→真 POST→真後端回應→列刷新」的端到端切片，未觀察到的轉移誠實標 `notObserved`）。

## 3. 非目標（明確不做）

- **不改 `bim-streaming-server` 轉檔引擎**：prioritize/retry 是協調器 dispatch-queue 操作，authority 仍只收同一條 `POST /api/conversions/ifc-to-usdc`，零新路由。（注意：§2.0 dispatcher 改造仍屬 **coordinator** 內，不碰 authority。）
- **不做 IX-CV-04 自動偵測開關（`PUT /api/conversion/watch`）**：watcher 生命週期控制，獨立 M2-b 卡（`pages.tsx:498-538` 唯讀面板不動）。
- **不做 concurrency 控制 / drain / move**（IX-KG/IX-SS、`…md:163-171`）：獨立 follow-up。
- **不做 `failed`（下游轉檔失敗）或 download-failed 的重試**：那需 authority 重跑或重新下載，屬不同因果與權威（`failed` ≠ `dispatch_failed`）；本輪 retry 僅限協調器派工失敗（`dispatch_failed`/`dropped_on_restart`）。該類列誠實不顯重試鈕。
- **不做佇列 disk 持久化**：維持 in-memory（`conversionDispatchQueue.ts:9`），重排亦只在記憶體。
- **不引入新 production dependency、不改 coverage「MUST NOT compute」鐵律、不新增基礎設施、瀏覽器不直連 :49101/:49102**。
- **不建全站通用 RBAC / audit 持久層**：audit = 結構化 log 一筆（B 方案 LAN），不做使用者身分系統。

## 4. 設計（縱切）

### 4.0 dispatcher delete-on-success 改造（`app.ts:398-429`，cr1 BLOCKER 1 先決）

把 closure 改為：
```
const pending = pendingDispatchEvents.get(jobId);
if (!pending) { markDispatchFailed(jobId, "pending dispatch event lost before worker pickup"); return; }
try {
  const dispatch = await createConversionJob(...);
  markDispatched(...);
  pendingDispatchEvents.delete(jobId);   // ← 只有成功才刪（原本在 line 400 無條件刪）
  if (pollEnabled && !poller.has(...)) schedulePollerForConversion(...);
} catch (e) {
  markDispatchFailed(jobId, ...);        // ← pending 保留，供 retry requeue
}
```
- 影響面：`pendingDispatchEvents` 的唯二讀者是此 closure 與 `drain`（`app.ts:1824`，不動）；無其他程式碼依賴「取件即刪」，故 delete-on-success 安全。
- 記憶體：成功即刪；失敗保留至 retry 成功或 dispose drain（僅 failed job、有界）。
- 回歸：`conversion-dispatch-queue.test.ts` 既有「dispatch 失敗第二個仍 dispatch」斷言不破（worker 已 shift，保留 pending 不會自動重派）；`host-native-conversion-ingest.test.ts` / `external-ifc-ready.test.ts` 回歸鎖。

### 4.1 佇列 method（`ConversionDispatchQueue`，additive）

- `prioritize(jobId)`：`const i=queued.indexOf(jobId); if(i===-1) return false; if(i===0) return true; queued.splice(i,1); queued.unshift(jobId); return true;`。不碰 `inFlightJobId`/worker。
- `requeue(jobId)`：`this.enqueue(jobId); return this.getQueuePosition(jobId) ?? 0;`。
- 既有 method/worker/drain 不動；unit 測試補在 `conversion-dispatch-queue.test.ts`。

### 4.2 協調器路由（`app.ts`，比照 quality-metrics route `app.ts:588-616`）

- `isSafeIfcReadyJobId(id)`：重用 §1 通用 pattern `^[A-Za-z0-9_.-]+$`（為語意清楚另命名，實作可共用 `isSafeConversionJobId` 的 regex；**不可複用 `isSafeSessionId`**）。
- **prioritize**：safe-id→400；`store.get(id)` 不存在→404；`job.status!=="queued_for_conversion"`→409；`queue.prioritize(id)` 回 false（in-flight/不在 queue）→409；成功後**重算 position**：`queue.getQueuedJobIds().forEach((qid,idx)=>store.markQueuedForConversion(qid, idx+1))`（順手收斂既有 position 快照漂移；in-flight job 不在 getQueuedJobIds、position 維持 0 正確）；audit→回 `{ifc_ready_job_id, status, queue_position, queued_order}`。
- **retry**：safe-id/404；`!["dispatch_failed","dropped_on_restart"].includes(job.status)`→409；`!pendingDispatchEvents.has(id)`（§4.0 修正後僅重啟/drain 後）→422；成功 → `const pos=queue.requeue(id); store.markQueuedForConversion(id,pos)`（**直接用 requeue 回傳 position，不用 0 哨兵**——0 是 `getQueuePosition` 的 in-flight 專用值 `queue.ts:37`，誤標會讓並發讀誤判 in-flight）；audit→回 `{ifc_ready_job_id, status:"queued_for_conversion", queue_position:pos}`。
  - **不重算 sibling position（與 prioritize 不對稱，刻意）**：`requeue→enqueue→push` 是 append 到隊尾、不 shift 既有 job 的相對序，故無需重算其他 job 的 position；只有 prioritize 的 unshift 會位移既有序才需重算。實作勿補多餘 recompute loop。
- body parse optional `reason`；錯誤不外溢內部欄位（比照 `app.ts:611-613`）。

### 4.3 `queue_position` 上 wire（cr1 BLOCKER 2）

- `summarizeIfcReadyJob`（`app.ts:1938-1967`）回傳物件加 `queue_position: job.queue_position ?? null`（additive）。
- `IfcReadyListItem`（`coordinatorClient.ts:99-115`）加 `queue_position?: number | null`。
- `external-ifc-ready.test.ts` 形狀回歸鎖（只新增一欄）。

### 4.4 前端 client（`coordinatorClient.ts`）

- 新增 `jsonPost<T>(path, body)`（mirror `jsonGet` 27-33，`method:"POST"`+`Content-Type:application/json`，非 2xx→throw）。
- 新增 `conversionPrioritize: (id, reason?) => jsonPost<ConversionControlResponse>(\`/api/conversion/jobs/${encodeURIComponent(id)}/prioritize\`, {reason})` 與 `conversionRetry`（同形）。
- 新增 `ConversionControlResponse = { ifc_ready_job_id:string; status:string; queue_position?:number|null; queued_order?:string[] }`。

### 4.5 前端 `IntentDialog`（`web-viewer-sample/src/console/IntentDialog.tsx`，新檔）

- props `{open, title, cost, onConfirm:(reason)=>void|Promise<void>, onCancel, busy?}`；含 reason textarea（可空）、cost 白話、「確認執行」(busy disabled)/「取消」。非樂觀：`await onConfirm(reason)` 成功才由呼叫端關閉。樣式用既有 `ec-*` class，不引新依賴。最小、不過度抽象。

### 4.6 前端 `#conv` UI（`ConversionSchedulingPage`，`pages.tsx`）

- state 加 `pendingAction:{jobId,kind:"prioritize"|"retry"}|null` ＋ `actionBusy`。
- job 表「coverage」鈕相鄰依狀態加：`queued_for_conversion`→「插隊」（`queue_position==null||<=1` disabled+title）；`dispatch_failed`/`dropped_on_restart`→「重試」。
- 點按 → 開 `IntentDialog`（cost：插隊＝「此 job 將排到佇列最前、較早派工」；重試＝「將重新派工此 job；可能再次失敗」）→ `onConfirm`：`await conversionPrioritize/Retry(jobId,reason)`→ 成功 `await load()`+關 dialog；失敗 `setErr` 誠實訊息、不改狀態、不關 dialog。
- 移除 `pages.tsx:496` 佔位 Field。

### 4.7 資料流（一句話）

`#conv` 列「重試」→ `IntentDialog` confirm(reason) → `POST .../retry` → coordinator 驗狀態 → `requeue`+`markQueuedForConversion`+audit → 回真狀態 → 前端 `load()` 重抓看到 `dispatch_failed→queued_for_conversion`（§4.0 修正後可成立）。全程後端裁決、前端零樂觀更新。

## 5. 錯誤處理

| 情境 | 行為 |
|---|---|
| `:id` 不合法 | 400；前端顯誠實錯誤、不改狀態 |
| job 不存在 | 404 |
| 插隊 但 job 非 `queued_for_conversion` | 409 + 白話 detail |
| 插隊 但 in-flight（`queue.prioritize` 回 false，不在 queued[]） | 409 |
| 插隊 但已在 queued 隊首（position 1，`i===0`） | 200 成功 no-op（非錯誤；§4.1 回 true） |
| 重試 但 job 非 `dispatch_failed`/`dropped_on_restart` | 409 + 白話 detail |
| 重試 但 pending 脈絡確不存在（重啟/drain 後） | 422「請重新進件」，不假裝可重試 |
| coordinator 連不上 / 5xx | 前端顯誠實錯誤，不顯假成功、不改狀態 |
| 重複點同一動作 | `actionBusy` 鎖 + dialog busy，避免重打 |

## 6. 測試與驗收

1. **協調器 unit（`conversion-dispatch-queue.test.ts` 擴充）**：`prioritize` 移 queued job 到前端 / in-flight 回 false / 已隊首回 true no-op / 不在 queue 回 false；`requeue` 回正確 position；既有 FIFO/drain/exception 斷言零退化。
2. **dispatcher 改造回歸（同檔 integration 段，controllable stub）**：派工成功 → pending 已刪（無殘留）；派工失敗 → pending **保留**且狀態 `dispatch_failed`；既有「第一個失敗第二個仍 dispatch」不破。
3. **協調器 route 測試（新 `tests/conversion-control-routes.test.ts`，沿用 controllable streaming stub）**：
   - prioritize：A in-flight、B/C queued → prioritize C → `queued_order` C 在 B 前、store position 重算正確。
   - retry（**依賴 §4.0 修正**）：stub 回 500 → `dispatch_failed`（pending 保留）→ retry → 狀態回 `queued_for_conversion` → 再次被 worker 取件派工（可再 release stub 驗成功路徑）。
   - 邊界：非法 id→400、不存在→404、錯狀態→409、脈絡失效→422、`reason` 進 audit。
   - 回歸鎖：`conversion-dispatch-queue.test.ts`、`host-native-conversion-ingest.test.ts`、`external-ifc-ready.test.ts`（含新 `queue_position` 欄）形狀零退化。
4. **Browser E2E（Playwright，`e2e/conv-prioritize-retry.spec.ts`）— 誠實可達框架**：守門 + 檔頭 skip 限制揭露比照 `conv-coverage-report.spec.ts`。對 **live 測試區實際存在的佇列狀態**驗端到端控制切片：列出現對應控制鈕 → 點按開 `IntentDialog` → 確認 → 觀察到一次**真後端狀態回應**（POST 2xx + 列依回傳真狀態刷新）。
   - 若測試區 :49101 未起（常態）→ 種出 `dispatch_failed` job，驗「重試」鈕 → confirm → POST 200 回 `queued_for_conversion` 且該列 `updated_at`/狀態前進（真因果）。
   - 若 :49101 在跑且有多筆 `queued_for_conversion` → 改驗「插隊」→ `queued_order` 變動。
   - 兩者皆覆蓋不到的轉移以 `notObserved[]` 原文揭露，深度因果由 route 測試（§6.3）兜底；**不偽造、不宣稱未觀察到的轉移為已驗**。
   - 截圖 + summary 落 `artifacts/e2e/conv-prioritize-retry-*` 與 tracked `docs/evidence/conv-prioritize-retry/`。
5. **驗收基準**：coordinator `npm run verify` + 前端 vitest + E2E（含誠實揭露）全綠 + 四項回報；`#a1`/`#a2`/`#minio`/`#conv` coverage 既有 E2E 與佇列既有測試不壞。

## 7. 風險與緩解

- **dispatcher delete-on-success 改造（§4.0，非 additive、cr1 BLOCKER 1）**：最高風險項。緩解 = 先做且回歸鎖；GitNexus impact 目標含 **dispatcher closure（`app.ts:398-429`）/ `pendingDispatchEvents` 生命週期 / `ConversionDispatchQueue` / `markQueuedForConversion` / `markDispatchFailed` / `summarizeIfcReadyJob`**；回歸網 = `conversion-dispatch-queue.test.ts` + `host-native-conversion-ingest.test.ts` + `external-ifc-ready.test.ts`；commit 前 `gitnexus_detect_changes` 驗 scope。
- **`queue_position` 快照一致性**：position 僅在 enqueue/重排時寫、會隨佇列消耗漂移（既有取捨）；prioritize 後主動重算受影響集合收斂；前端每次動作後 `load()` 重抓真值。
- **retry 因 §4.0 才成立**：plan 須讓 §4.0 先落地且綠燈，retry route/E2E 才有意義；否則 retry 422/instant-fail（cr1 已驗）。
- **首個 controlled action 誠實面**：模式 3 三段式完整（confirm 顯成本、POST 帶 reason、後端 audit、證據刷新）；B 方案無 RBAC ⇒ audit「who」誠實 best-effort，PR body 與 UI 不宣稱有身分稽核；無樂觀更新、無假按鈕。
- **E2E 因果可重現性**：依 :49101 live 狀態二選一驗真切片，未觀察轉移誠實 `notObserved` + route 測試兜底深度因果（§6.3/§6.4）。
- **Sizing 誠實**：含 §4.0 dispatcher 變更 + 首個 IntentDialog + 首個 audit path + E2E，本卡屬 **L+**。經 spec-verify 對抗複驗確認可單一 spec-to-done 完成，**前提：§4.0 先落地並回歸鎖**（已寫入 §2 任務相依排序）。
- **跨 repo 邊界**：改動限 `bim-review-coordinator`（dispatcher 改造 + 佇列 method + 2 路由 + safe-id + audit + `queue_position` 上 wire）與 `web-viewer-sample`（client + `IntentDialog` + `#conv` UI）；不碰 `bim-streaming-server`。
- **不在 main 開發**：branch → PR → Actions → merge；spec 落 `docs/superpowers/specs/`，接 `writing-plans` → `spec-to-done` 執行。

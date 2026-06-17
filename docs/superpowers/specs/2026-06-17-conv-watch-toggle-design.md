# IX-CV-04：#conv 轉檔「自動偵測開關」controlled action（`PUT /api/conversion/watch`）設計

- 文件性質：spec design（設計文件）。權威序：code > contracts > AGENTS > `docs/plans` 行為合約 > wiki；與實作衝突時以實作程式碼與 `docs/plans/ai-bim-governance-互動實作規格與標準對齊.md` 的 **IX-CV-04 互動卡（line 157）**與「模式 3 危險動作三段式（line 99-105）」為準。
- 日期：2026-06-17
- Phase 對應：**M2「轉檔管線」控制面收尾的最後一張互動卡（M2-c）**。前置 M2-a coverage 唯讀展開（PR #218 / 81ba1df）與 M2-b 插隊/重試 controlled action（PR #221 / 3ecc96f，「產品首個 controlled action」IX-CV-03）皆已 merged，controlled-action 基礎件（`IntentDialog`、`resolveActor`/`parseReason`、`rejectIfIpNotAllowed`、audit 路徑）已落地可重用；本輪把 `#conv` 上唯一未閉合的 measured gap（**GAP-conv-03 / IX-CV-04，狀態 not-built**）收掉。**尊重固定里程碑序列**：本卡屬 M2，不跳進 M3/M4（viewer stage-truth `first_frame_at`/`stage matched` 等後端待建項屬 M3/M4，明列於 §3 非目標）。
- userFacing：true（`#conv` / `ConversionSchedulingPage`，`web-viewer-sample/src/console/data.ts:64` badge `P1`）。本輪把「MinIO 自動偵測（O4）」Panel（`web-viewer-sample/src/console/pages.tsx:541-582`）目前**唯讀**的 watcher 狀態，補上 operator 可在 runtime 開關輪詢的 controlled action，並在關閉態顯示誠實琥珀條。
- 來源範圍決策：開關的對象是**協調器 in-process MinIO watcher loop 的生命週期**（`bim-review-coordinator/src/services/minioWatcher.ts` 的 `startMinioWatcher` / `MinioWatcherHandle.dispose`），不是 MinIO server、也不是 `bim-streaming-server` 轉檔引擎。故端點與 runtime toggle 邏輯**全部落在 coordinator**；`bim-streaming-server` 與 MinIO 本身**零改動**。
- **非純 additive 警示**：本 spec **必須把現有 watcher 啟停的「process-lifecycle 單次接線」改造成「runtime 可重入接線」**（§4.0）——把 `startMinioWatcherIfEnabled` 的 guard 從讀靜態 `config.minioWatchEnabled` 改讀新的 mutable runtime flag，並讓 `GET status` 端點一致改讀同一 flag。這不是純新增 route，是既有啟動/狀態行為變更，須跑 GitNexus impact + 回歸鎖（見 §6/§7）。

---

## 0. 交叉對抗驗證結論（已執行）＋ 實作中對抗檢查點

### 0.1 已執行的對抗驗證（plan-next-spec-to-done workflow，9 agents / 3 階段，2026-06-17）

本卡選定前已由 workflow 對抗複驗，verdict = **`confirmed-next`**。關鍵實證（spec-to-done 執行時可逐條重查，不得當作既定真值盲信）：

| 檢查 | 結論 | 實證錨點 |
|---|---|---|
| 是 real spec item，非臆造 | ✅ | `docs/plans/ai-bim-governance-互動實作規格與標準對齊.md:157`「自動偵測開關：`PUT /api/conversion/watch {enabled}`；關閉時佇列頁頂顯示琥珀條」 |
| 後端 **尚未** built（非已實作） | ✅ | 後端只有唯讀 `GET /api/external/minio-watch/status`（`bim-review-coordinator/src/app.ts:1014`）；全 repo `app.put/app.post` 對 `watch` 無命中（僅 prioritize `app.ts:669`、retry `app.ts:707`）。watcher 啟動只在 `server.on("listening")`（`app.ts:388`）與 config-immediate（`app.ts:390-391`）；`dispose()` 只在 process shutdown（`app.ts:1950-1954`） |
| 前端 **尚未** built | ✅ | `coordinatorClient.minioWatchStatus`（`coordinatorClient.ts:185`）GET-only；watcher Panel（`pages.tsx:541-582`）純唯讀顯示；無 toggle client method／無開關 UI |
| 依賴 **全部** merged、未被未建里程碑卡住 | ✅ | watcher 本體 #210（55d0aef，`startMinioWatcher`/`dispose`/`MinioWatcherStatus` 全在）；controlled-action 模式 #221（3ecc96f）；coverage #218（81ba1df）皆 on main |
| scope 為單一 spec-to-done 大小 | ✅ S–M | 一條 PUT route（toggle 既有 watcher handle）+ 一個 UI 控制 + status 端點改讀 runtime flag；沿用既有 `IntentDialog` |

### 0.2 對抗驗證點出、本 spec 必須解掉的三個設計決策（已內建於 §4）

1. **endpoint 路徑分歧**：規格寫 `PUT /api/conversion/watch`，但現有唯讀狀態端點在 `/api/external/minio-watch/status`。→ §4.1 決策：新增 mutation route 落在 `/api/conversion/watch`（與 prioritize/retry 同 `/api/conversion/*` mutation namespace，語意一致），唯讀 status **維持原路徑不動**；兩者讀同一 runtime flag + 同一 `minioWatcher` handle，狀態必然一致。
2. **start/dispose 是 process-lifecycle、非 runtime re-entry**：guard `if (!config.minioWatchEnabled || minioWatcher) return`（`app.ts:352`）讀靜態 config，只防「啟動期重複啟動」，無 runtime 再進入語意。→ §4.0 改造為 runtime flag 驅動的可重入啟停。
3. **`status.enabled` 靜態衍生**：`GET status` 的 `if (!config.minioWatchEnabled)`（`app.ts:1015`）與 watcher 內部 `MinioWatcherStatus.enabled` 寫死 literal `true`（`minioWatcher.ts:139`）。runtime 關閉後若仍讀 config，status 會謊報 enabled。→ §4.2 改讀 runtime flag，使 `status.enabled` 隨 toggle 翻轉。

### 0.3 實作中對抗檢查點（spec-to-done 的 P5 抓雷層須逐一驗，比照 M2-b cr1 模式）

- **CR-A（安全回歸）**：`PUT /api/conversion/watch` 是 mutation surface，**必須**沿用 `rejectIfIpNotAllowed`（`app.ts:655`）IP allowlist 守門 + `resolveActor`/`parseReason`/audit（`app.ts:641-650, 694`）。漏掉守門 = 任意 LAN origin 可開關 watcher → P1 安全缺陷。
- **CR-B（toggle 競態）**：`dispose()` 是 async（2s cap，`minioWatcher.ts:405-423`）。兩個並發 PUT（off 與 on）在 dispose await 期間可能交錯啟動兩個 watcher。須加同步鎖（§4.0）。
- **CR-C（未配置誠實拒絕）**：env 未 opt-in 時 MinIO 連線參數可能為空。`PUT {enabled:true}` 對未配置連線**禁止**靜默空轉或 throw 未捕捉例外，須回 422 誠實訊息（§4.1 / §5）。
- **CR-D（status 一致性）**：toggle 後前端走證據型刷新（`load()` 重抓真 status），**禁止**樂觀更新本地 `mw.enabled`。

---

## 1. 背景與現狀（盤點已實證）

### 1.1 全頁面後端待建盤點（使用者要求「須包含所有的頁面」；權威 = `web-viewer-sample/src/console/data.ts:49-76` `PAGES`）

> 目的：讓 spec-to-done 執行時對「本卡只動 `#conv`、不得溢出其他頁」有完整 context，並誠實標示各頁後端待建項與所屬里程碑。**本欄狀態取自 workflow 現狀審計（2026-06-17）；spec-to-done 實作前對 `#conv` 一列須即時複查，其餘頁僅作邊界圍籬、不在本卡 scope。**

| 分組 | 頁面 key | 名稱 | 後端待建/狀態 | 本卡關係 |
|---|---|---|---|---|
| 工作台 | `home` | 今天要做什麼 | 入口聚合，as-built | 不碰 |
| 核心治理 | `a1` / `issues` | 治理與模型檢核 / Issue·BCF | A1 全鏈路 as-built（rule-run / BCF 2.1 / Excel）；A1-F8 3D 高亮（IX-A1-06）stub，**屬 M4**（依賴 M3） | 不碰 |
| 核心治理 | `a2` | 版本差異與責任 | as-built（自寫三階對齊引擎）；**spec-vs-audit 衝突**：規格要求官方 `ifcdiff`，實作未 import，**屬 M5**，本卡不處理 | 不碰 |
| 核心治理 | `a3` `a4` `a5` `reports` | 疊合 / 語意搜尋 / IoT-FM / 報表 | roadmap（`p3`/`p4`），**屬 M3+** | 不碰 |
| OMNIVERSE | `viewer` | 3D Viewer 呈現 | **使用者圖標的頁**：`first_frame_at` / `stage matched` / `expected==loaded matched`（P1）、`highlightPrimsRequest`（P1.5）= browser DataChannel 回報鏈，**屬 M3/M4**（依賴 Kit viewer DataChannel） | **不碰**（固定序列：M2 未收完不跳 M3） |
| OMNIVERSE | `gpu` `a6`–`a10` | GPU 審查室 / 4D-5D 等 | MVP / roadmap，**屬 M3+** | 不碰 |
| 落地端 | **`conv`** | **IFC→USD 轉檔排程** | **本卡目標頁**：M2-a coverage（#218）+ M2-b 插隊/重試（#221）已 merged；**唯一未閉合 measured gap = IX-CV-04 自動偵測開關（GAP-conv-03，not-built）**；concurrency 控制另列 follow-up（`pages.tsx:539` NOT BUILT） | ✅ **本卡只動此頁** |
| 落地端 | `sessions` | Session 管理 | 控制動作多為 disabled 佔位（`pages.tsx` SessionManagementPage），**屬後續 M** | 不碰 |
| 落地端 | `instances` `minio` | Kit/GPU 機隊 / MinIO 資料 | 唯讀現狀面板，as-built | 不碰 |
| SYSTEM | `runtime` `admin` `spec` | Runtime 監控 / 系統管理 / 設計規格 | 唯讀／文件，as-built | 不碰 |

**結論**：全頁面唯一落在 M2 且 not-built 的 user-facing controlled-action 缺口就是 `#conv` 的 IX-CV-04；其餘後端待建項（含使用者圖標的 viewer stage-truth）皆屬 M3 以後，依固定序列本卡不動。

### 1.2 IX-CV-04 缺口實證（後端 + 前端）

MinIO 自動偵測（O4，#210）**已實質 as-built，但只有讀、沒有控制**：

- **watcher 本體完整**：`startMinioWatcher(opts)`（`minioWatcher.ts:200`）回傳 `MinioWatcherHandle { dispose: () => Promise<void>; getStatus: () => MinioWatcherStatus }`（`minioWatcher.ts:131-136`）。`dispose()` 為 async：先 `stopped=true` 停排程 → await in-flight tick settle（2s cap，`minioWatcher.ts:405-423`）→ `client.destroy()`。**無 pause/resume**——只有「`dispose` 掉」與「`startMinioWatcher` 起一個新的」兩態。
- **狀態結構就緒**：`MinioWatcherStatus`（`minioWatcher.ts:138-153`）含 `poll_count`（單調遞增 tick 計數，供 loop liveness 判斷）、`last_poll_at`、計數等。`enabled` 欄寫死 literal `true`（`minioWatcher.ts:139`），watcher 存在即 true、**無法表達「已關閉」**——關閉語意必須在 app.ts 層用 runtime flag 表達。
- **app.ts 啟動接線是 process-lifecycle 單次**：`startMinioWatcherIfEnabled()`（`app.ts:346-386`）guard `if (!config.minioWatchEnabled || minioWatcher) return`（`app.ts:352`）；啟動點 `server.on("listening")`（`app.ts:388`）＋ config-immediate（`app.ts:390-391`）。啟動內含 loopback-in-allowlist fail-fast（`app.ts:359-368`，allowlist 不含 loopback 會 throw）。
- **dispose 只在 shutdown**：`app.ts:1950-1954` 用安全模式 `const w = minioWatcher; minioWatcher = null; await w.dispose();`（先清引用、再 await settle）。**本卡 toggle off 直接沿用此模式。**
- **GET status 唯讀**（`app.ts:1014-1029`）：`if (!config.minioWatchEnabled)` 回 `{enabled:false, note}`；否則回 `minioWatcher?.getStatus()`。
- **前端唯讀**：`coordinatorClient.minioWatchStatus`（`coordinatorClient.ts:185`）GET-only（`MinioWatchStatus` interface `coordinatorClient.ts:138-154`，`enabled: boolean`）；`ConversionSchedulingPage`（`pages.tsx:438`）的 `load()`（`pages.tsx:460-476`）以 `Promise.allSettled` 同時抓 `listIfcReady(50)` + `minioWatchStatus()` 並 `setMw`/`setMwErr`（**toggle 後呼叫 `load()` 即得真 status，無需另寫刷新**）；MinIO 自動偵測 Panel（`pages.tsx:541-582`）純唯讀，無開關。

**仍讓 `#conv` 沒有「自動偵測開關」的缺口**：

1. **協調器無 toggle 端點**：`app.ts` 無 `PUT /api/conversion/watch`（全 repo grep 證實）。
2. **watcher 啟停無 runtime 入口**：只能靠 env `MINIO_WATCH_ENABLED` 啟動期決定 + shutdown dispose；runtime 不可開關。
3. **前端是唯讀面板**：watcher Panel 只顯示狀態，無控制；關閉態僅靠 env 決定，operator 無法在 console 關掉一個正在跑的 watcher。

### 1.3 可直接重用的 controlled-action 基礎件（M2-b 已落地）

- `IntentDialog`（`web-viewer-sample/src/console/IntentDialog.tsx`）：props `{open, title, cost, onConfirm, onCancel, busy, actionErr}`，非樂觀（confirm 後 `await onConfirm(reason)`，caller 負責失敗反饋與關閉）。
- 後端：`resolveActor`（`app.ts:641`）、`parseReason`（`app.ts:647`）、`rejectIfIpNotAllowed`（`app.ts:655`）、`structLog.withTraceId(id).audit("conversion-control", ...)`（`app.ts:694`）。
- 前端：`coordinatorClient.jsonPost`（`coordinatorClient.ts:35-45`）已存在、可直接寫 PUT 變體；`ConversionSchedulingPage` 的 `pendingAction`/`actionBusy`/`actionBusyRef`/`actionErr`/`runAction` reducer（`pages.tsx:448-529`）模式可直接擴一個 watch-toggle kind。

---

## 2. 目標（成功標準）

> **任務相依排序（plan 須遵守）**：§2.1 runtime flag 狀態機改造為**最先**且須回歸鎖（觸及既有啟動行為）；§2.2 PUT route 依賴 §2.1；§2.3 status 端點改讀 flag 與 §2.1 同批；§2.4/§2.5 前端依賴 route；§2.6 E2E 最後。

1. **（先做・CR-B/CR-C 先決）runtime enabled 狀態機改造（§4.0，非純 additive）**：在 app.ts 引入 mutable `let minioWatchRuntimeEnabled = config.minioWatchEnabled`（runtime 真相，初值 = env）＋ `let minioWatchToggleBusy = false`（toggle 同步鎖）。把 `startMinioWatcherIfEnabled` guard 的 `!config.minioWatchEnabled` 改讀 `!minioWatchRuntimeEnabled`；config-immediate 啟動路徑（`app.ts:390`）一致改讀 runtime flag。新增 `minioWatchConfigured`（連線參數齊全判斷，§4.0）。既有 `server.on("listening")` 接線與 allowlist fail-fast 不動。**回歸鎖**：env=true 仍啟動、env=false 仍預設不啟動（既有行為零退化）。
2. **協調器新增一條 production 控制路由 `PUT /api/conversion/watch`**（§4.1）：
   - 守門：`rejectIfIpNotAllowed`（沿用，CR-A）；body `{ enabled: boolean; reason?: string }`，`enabled` 非 boolean → 400。
   - `enabled === true`：若 `minioWatchToggleBusy` → 409「toggle 進行中」；若 `!minioWatchConfigured` → 422 誠實「未配置 MinIO 連線參數」；否則設 `minioWatchRuntimeEnabled=true` → `startMinioWatcherIfEnabled()`（重建 handle，**try/catch** allowlist throw → 500 誠實、並回滾 flag）→ audit → 回 toggle 後真 status。
   - `enabled === false`：設 `minioWatchRuntimeEnabled=false`；若 `minioWatcher` 存在 → 沿用安全模式 `const w=minioWatcher; minioWatcher=null; await w.dispose();`（toggle 鎖期間）→ audit → 回 `{enabled:false, ...}`。
   - 路由永遠開啟（非 dev-gated）、只動協調器自有 watcher 生命週期、不外溢內部欄位/credentials；audit `{action:"conversion.watch.toggle", enabled, actor, reason, at}`。
3. **GET status 端點改讀 runtime flag（§4.2）**：`app.ts:1015` 的 `if (!config.minioWatchEnabled)` 改 `if (!minioWatchRuntimeEnabled)`；其餘形狀零退化（關閉態仍回 `{enabled:false, bucket, prefix, interval_seconds, note}`，note 視「env 未開」或「runtime 已關」誠實區分）。
4. **前端 client（§4.3）**：`coordinatorClient` 補 `jsonPut<T>`（mirror `jsonPost`，`method:"PUT"`）＋ `conversionWatchToggle(enabled: boolean, reason?: string) => jsonPut<MinioWatchStatus>("/api/conversion/watch", { enabled, reason })`。
5. **前端 `#conv` UI（§4.4）**：MinIO 自動偵測 Panel 加開關控制：
   - 啟用態顯「自動偵測：開啟中」＋「關閉自動偵測」鈕；關閉態顯「自動偵測：已關閉」＋「開啟自動偵測」鈕（未配置時鈕 disabled+tooltip）。
   - 點按 → `IntentDialog`（cost 白話：關 = 「停止輪詢 MinIO；新上傳的 model.ifc 將不再自動進件，需手動觸發」；開 = 「恢復輪詢 MinIO；偵測到新 model.ifc 會自動進件並派工」）→ confirm POST → 成功 `await load()` 重抓真 status（證據型，CR-D）→ 關 dialog；失敗顯誠實錯誤、不改狀態、不關 dialog。
   - **關閉態琥珀條**：Panel 頂（與佇列頁 `#conv` 頂部）顯示 `ec-warn-note`「⚠ 自動偵測已關閉——新 model.ifc 不會自動進件」（規格 line 157 要求）。
6. **誠實鐵律維持**：無樂觀更新（POST 後重抓真 status）；未配置不給假「開啟」按鈕（disabled+誠實 tooltip）；端點錯誤（400/409/422/5xx）顯誠實訊息不假成功；audit「who」best-effort（`local-operator`），不偽造身分。
7. **Browser E2E（Playwright，gstack，A1–A10 唯一接受的 user-facing 證據）通過**：§6.4 誠實可達框架——對測試區實際 watcher 配置態驗「開關往返一輪」端到端切片，未達狀態誠實 `notObserved`。

---

## 3. 非目標（明確不做）

- **不做 viewer stage-truth 後端待建（使用者圖標的 `first_frame_at` / `stage matched` / `expected==loaded matched` / `highlightPrimsRequest`）**：屬 `#viewer` 頁、依賴 Kit viewer DataChannel 回報鏈，**屬 M3/M4**。固定序列下 M2 未收完不跳 M3。本卡完全不碰 `web-viewer-sample/src/App.tsx` / `Window.tsx` / viewer DataChannel。
- **不做 concurrency 控制 / pause / drain**（`pages.tsx:539` NOT BUILT follow-up）：獨立 M2 follow-up 卡，與本卡正交。
- **不改 watcher 內部 loop 邏輯**（`tick`/`triggerIntake`/SSRF assert/keySuffix assert/idempotency）：本卡只控制 watcher 的「起／停」生命週期，不碰其輪詢與安全約束。
- **不改 MinIO server 或 `bim-streaming-server`**：toggle 純協調器 in-process 操作。
- **不做 watcher 設定的 runtime 變更**（bucket/prefix/interval 改值）：只開關，不改連線參數。連線參數仍 env-only。
- **不做 toggle 狀態 disk 持久化**：runtime flag 為 in-memory；coordinator 重啟後回到 env `MINIO_WATCH_ENABLED` 初值（誠實，與 watcher in-memory 語意一致）。
- **不建全站 RBAC / audit 持久層**：audit = 結構化 log 一筆（B 方案 LAN）。
- **不引入新 production dependency；瀏覽器不直連 :49101/:49102。**

---

## 4. 設計（縱切）

### 4.0 runtime enabled 狀態機改造（`app.ts`，CR-B/CR-C 先決）

在 watcher 接線區（`app.ts:345` `let minioWatcher` 附近）新增：

```ts
// IX-CV-04：runtime toggle 真相。初值 = env opt-in；PUT /api/conversion/watch 在 runtime 覆寫。
let minioWatchRuntimeEnabled = config.minioWatchEnabled;
// toggle 同步鎖（CR-B）：dispose() 為 async（2s cap），防並發 PUT 在 await 期間交錯啟兩個 watcher。
let minioWatchToggleBusy = false;
// 連線參數齊全判斷（CR-C）：未配置時 PUT{enabled:true} 誠實 422，不空轉/不 throw。
// endpoint/bucket/accessKey/secretKey 為硬連線必要；keySuffix 有 assert、interval 有預設。
function minioWatchConfigured(): boolean {
  return Boolean(
    config.minioWatchEndpoint && config.minioWatchBucket &&
    config.minioWatchAccessKey && config.minioWatchSecretKey,
  );
}
```

改 `startMinioWatcherIfEnabled` guard（`app.ts:352`）：

```ts
// 舊：if (!config.minioWatchEnabled || minioWatcher) return;
if (!minioWatchRuntimeEnabled || minioWatcher) return;   // 改讀 runtime flag
```

改 config-immediate 啟動路徑（`app.ts:390`）：

```ts
// 舊：if (config.minioWatchEnabled && config.minioWatchSelfBaseUrl)
if (minioWatchRuntimeEnabled && config.minioWatchSelfBaseUrl) startMinioWatcherIfEnabled();
```

- `server.on("listening")` 接線（`app.ts:388`）、allowlist fail-fast（`app.ts:359-368`）、shutdown dispose（`app.ts:1950-1954`）**不動**。
- **回歸**：env=true → runtime flag 初值 true → 既有啟動行為不變；env=false → 初值 false → 預設不啟動不變。既有 `minio-watch-*` 測試零退化。

### 4.1 協調器 toggle route（`app.ts`，比照 prioritize/retry route `app.ts:669-746`）

置於控制路由區（prioritize/retry 之後）。`async` handler（需 `await dispose`）：

```ts
app.put("/api/conversion/watch", async (request, response) => {
  if (rejectIfIpNotAllowed(request, response)) return;                 // CR-A：沿用 IP allowlist 守門
  const body = request.body as { enabled?: unknown } | undefined;
  if (typeof body?.enabled !== "boolean") {
    response.status(400).json({ detail: "Body must include boolean 'enabled'." });
    return;
  }
  if (minioWatchToggleBusy) {                                          // CR-B：toggle 進行中
    response.status(409).json({ detail: "Watcher toggle in progress; retry shortly." });
    return;
  }
  const reason = parseReason(request);
  const actor = resolveActor(request);
  minioWatchToggleBusy = true;
  try {
    if (body.enabled) {
      if (!minioWatchConfigured()) {                                  // CR-C：未配置誠實拒絕
        response.status(422).json({ detail: "MinIO watch not configured (endpoint/bucket/credentials missing); cannot enable." });
        return;
      }
      minioWatchRuntimeEnabled = true;
      try {
        startMinioWatcherIfEnabled();                                 // 重建 handle（含 allowlist fail-fast）
      } catch (e) {
        minioWatchRuntimeEnabled = false;                            // 回滾 flag，誠實 500
        response.status(500).json({ detail: `Failed to start watcher: ${e instanceof Error ? e.message : String(e)}` });
        return;
      }
    } else {
      minioWatchRuntimeEnabled = false;
      if (minioWatcher) {                                            // 沿用 shutdown 安全模式
        const w = minioWatcher;
        minioWatcher = null;
        await w.dispose();
      }
    }
    // 成功 audit 同時帶 enabled（spec 要求的方向布林，供以 enabled 查 audit）與 target 方向編碼
    // （與失敗路徑 outcome-in-target、prioritize/retry target:id 慣例一致）。enabled 已加入 AuditData(optional)。
    structLog.withTraceId("minio-watch").audit("conversion-control", "conversion.watch.toggle", {
      action: "conversion.watch.toggle", actor,
      target: body.enabled ? "watch:enable" : "watch:disable", enabled: body.enabled, reason,
    }, "info");
    // 回 toggle 後真 status（與 GET status 同邏輯：runtime flag 關 → enabled:false）
    response.json(currentMinioWatchStatusPayload());                  // §4.2 抽出的共用 helper
  } finally {
    minioWatchToggleBusy = false;
  }
});
```

### 4.2 GET status 改讀 runtime flag（`app.ts:1014-1029`）＋ 抽共用 payload

把 status 計算抽成 `currentMinioWatchStatusPayload()`（GET 與 PUT 共用，避免分歧）：

```ts
function currentMinioWatchStatusPayload(): unknown {
  if (!minioWatchRuntimeEnabled) {                                   // 改讀 runtime flag（原 config.minioWatchEnabled）
    return {
      enabled: false,
      bucket: config.minioWatchBucket || null,
      prefix: config.minioWatchPrefix || null,
      interval_seconds: config.minioWatchIntervalSeconds,
      // 誠實區分「env 從未開」與「runtime 被關」
      note: config.minioWatchEnabled
        ? "已由操作者於 console 關閉（runtime override；coordinator 重啟後回 env 預設）"
        : "未啟用（env MINIO_WATCH_ENABLED opt-in）",
    };
  }
  return minioWatcher
    ? minioWatcher.getStatus()
    : { enabled: true, note: "watcher enabled but not yet started (server not listening)" };
}
app.get("/api/external/minio-watch/status", (_request, response) => {
  response.json(currentMinioWatchStatusPayload());
});
```

- 形狀回歸鎖：關閉態欄位集合與原 `app.ts:1016-1022` 完全一致（只多 note 文字分支）；啟用態不變。

### 4.3 前端 client（`coordinatorClient.ts`）

- 新增 `jsonPut<T>(path, body)`（mirror `jsonPost` `coordinatorClient.ts:35-45`，`method:"PUT"`）。
- `coordinatorClient` 物件（`coordinatorClient.ts:180-196`）加：
  ```ts
  conversionWatchToggle: (enabled: boolean, reason?: string) =>
    jsonPut<MinioWatchStatus>("/api/conversion/watch", { enabled, reason }),
  ```
- 回應型別重用既有 `MinioWatchStatus`（`coordinatorClient.ts:138-154`）——toggle 回的就是 status payload，型別已涵蓋。

### 4.4 前端 `#conv` UI（`ConversionSchedulingPage`，`pages.tsx`）

- state 擴 `pendingAction` 的 kind union：`{ jobId: string; kind: "prioritize" | "retry" } | { kind: "watch-toggle"; enabled: boolean } | null`（watch-toggle 無 jobId）。`runAction`（`pages.tsx:505`）分支補：`kind==="watch-toggle"` → `await coordinatorClient.conversionWatchToggle(pendingAction.enabled, reason)` → `await load()` 重抓 status → 關 dialog。
- MinIO 自動偵測 Panel（`pages.tsx:541-582`）：
  - `mw.enabled === false` 分支：加「開啟自動偵測」鈕（`disabled={mw 無連線配置線索 ...}`——前端無法直接知 configured，故以「env note 含『未配置』時不顯鈕」近似；保守：鈕一律可點，後端 422 兜底，前端顯誠實錯誤）→ `setPendingAction({kind:"watch-toggle", enabled:true})`。
  - 啟用態分支：加「關閉自動偵測」鈕 → `setPendingAction({kind:"watch-toggle", enabled:false})`。
  - **琥珀條**：Panel 內（`mw.enabled===false` 時）已有「未啟用」Field；另在**頁頂**（`<h1>` 下、第一個 Panel 前）依 `mw?.enabled===false` 條件渲染 `<p className="ec-warn-note">⚠ 自動偵測已關閉——新 model.ifc 不會自動進件，需手動進件</p>`（規格 line 157「關閉時佇列頁頂顯示琥珀條」）。
- `IntentDialog`（`pages.tsx:641-651`）title/cost 依 `pendingAction.kind==="watch-toggle"` 的 `enabled` 給對應白話（§2.5）。

### 4.5 資料流（一句話）

`#conv` 自動偵測 Panel「關閉自動偵測」→ `IntentDialog` confirm(reason) → `PUT /api/conversion/watch {enabled:false}` → coordinator 設 runtime flag=false + 安全 dispose watcher + audit → 回 `{enabled:false}` → 前端 `load()` 重抓真 status（`poll_count` 凍結、`enabled:false`）→ 頁頂琥珀條出現。全程後端裁決、前端零樂觀更新。

---

## 5. 錯誤處理

| 情境 | 行為 |
|---|---|
| body 無 boolean `enabled` | 400；前端顯誠實錯誤、不改狀態 |
| caller IP 不在 allowlist | 403（`rejectIfIpNotAllowed`） |
| 並發 toggle（鎖中） | 409「toggle 進行中」；前端可重試 |
| `enabled:true` 但未配置 MinIO 連線 | 422「未配置」；前端顯誠實訊息、開關維持關閉態 |
| `enabled:true` 但 allowlist 不含 loopback（start throw） | 500 誠實訊息 + 回滾 runtime flag（不留半開狀態） |
| `enabled:false` 但 watcher 已不存在 | 200 成功 no-op（flag 設 false、回 `enabled:false`） |
| coordinator 連不上 / 5xx | 前端顯誠實錯誤，不顯假成功、不改狀態 |
| 重複點同一開關 | `actionBusy` 鎖 + dialog busy，避免重打 |

---

## 6. 測試與驗收

1. **協調器 route 測試（新 `tests/conversion-watch-toggle.test.ts`；route 測試樣板最同構者 = `tests/conversion-control-routes.test.ts`（prioritize/retry，含 IP allowlist / safe-id / audit 斷言模式）；config/watcher 注入樣板 = `tests/minio-watch-status-route.test.ts` + `tests/minio-watcher-loop.test.ts`）**：
   - `PUT {enabled:false}` 對啟用中 watcher → 200 `enabled:false`、`GET status` 隨後回 `enabled:false`、watcher `dispose` 被呼叫（poll 不再前進）。
   - `PUT {enabled:true}` 對已配置但關閉態 → 200、watcher 重建、`GET status` 回 `enabled:true` 且 `poll_count` 開始前進。
   - 往返一輪（off→on）狀態一致、無雙 watcher（toggle 鎖驗證：mock dispose 延遲時並發 PUT 第二筆 409）。
   - 邊界：非 boolean→400；未配置 `enabled:true`→422；IP 不在 allowlist→403；allowlist 缺 loopback 時 `enabled:true`→500 且 flag 回滾。
   - **回歸鎖**：既有 `minio-watch-*` 測試（env=true 啟動 / env=false 不啟動 / status 唯讀形狀）零退化。
2. **協調器 `npm run verify`（= build + test）全綠**（`bim-review-coordinator/CLAUDE.md` Verify 入口）。
3. **前端 vitest（`console.test.tsx` 擴充）**：watch-toggle 鈕依 `mw.enabled` 渲染；confirm → `conversionWatchToggle` 被呼叫 + `load()` 重抓；關閉態頁頂琥珀條出現；失敗顯誠實錯誤不改狀態（非樂觀）。
4. **Browser E2E（Playwright / gstack，`e2e/conv-watch-toggle.spec.ts`）— 誠實可達框架**（守門 + 檔頭 skip 限制揭露比照 `conv-coverage-report.spec.ts` / `conv-prioritize-retry.spec.ts`）：
   - 進 `#conv`，讀 MinIO 自動偵測 Panel 初始 `enabled` 真值。
   - **若測試區 watcher 已配置且啟用**：點「關閉自動偵測」→ `IntentDialog` → 確認 → 觀察 PUT 200 + Panel 轉 `enabled:false` + **頁頂琥珀條出現**；再點「開啟自動偵測」→ 確認 → Panel 轉 `enabled:true` + 琥珀條消失（**端到端開關往返一輪**，端對端互動證據）。
   - **若測試區未配置（常態：env 未 opt-in）**：驗「開啟自動偵測」→ 確認 → PUT 422 → 前端顯誠實「未配置」訊息、開關維持關閉態、琥珀條維持（**誠實負向路徑**）；正向往返以 `notObserved` 揭露，深度由 route 測試（§6.1）兜底。
   - 截圖 + summary 落 `artifacts/e2e/conv-watch-toggle-*` 與 tracked `docs/evidence/conv-watch-toggle/`；未觀察到的轉移誠實 `notObserved[]` 原文揭露，不偽造。
5. **GitNexus**：改 `startMinioWatcherIfEnabled` / status endpoint 前跑 `gitnexus_impact`（目標含 `startMinioWatcherIfEnabled` / `minioWatcher` 生命週期 / `config.minioWatchEnabled` 讀者 / status route）；commit 前 `gitnexus_detect_changes` 驗 scope 未溢出。
6. **驗收基準**：coordinator `npm run verify` + 前端 vitest + gstack E2E（含誠實揭露）全綠 + 四項回報（改了哪些 tracked files / 最小驗證 / 沒跑的測試與原因 / 已知風險）；`#a1`/`#a2`/`#minio`/`#conv` 既有 E2E 與 watcher 既有測試不壞。

---

## 7. 風險與緩解

- **runtime 接線改造（§4.0，非 additive，最高風險）**：把靜態 `config.minioWatchEnabled` 守門改成 mutable runtime flag，影響既有啟動行為。緩解 = 先做且回歸鎖；GitNexus impact 目標含 `startMinioWatcherIfEnabled` / `minioWatcher` / `config.minioWatchEnabled` 所有讀者；回歸網 = 既有 `minio-watch-*` 測試（env on/off 啟動語意）；commit 前 `gitnexus_detect_changes`。
- **toggle 競態（CR-B）**：`dispose` async（2s cap），並發 PUT 風險。緩解 = `minioWatchToggleBusy` 同步鎖 + 先清 `minioWatcher=null` 再 await（沿用 shutdown 模式）；route 測試以延遲 dispose mock 驗第二筆 409。
- **未配置誠實面（CR-C）**：env 未 opt-in 時連線參數空。緩解 = `minioWatchConfigured()` 422 兜底；`startMinioWatcherIfEnabled` 的 allowlist throw 以 try/catch → 500 + flag 回滾，不留半開狀態。
- **安全回歸（CR-A）**：mutation surface 必沿用 `rejectIfIpNotAllowed` + audit；PR body 與 UI 不宣稱有身分稽核（B 方案無 RBAC，audit who best-effort）。
- **誠實面**：無樂觀更新（toggle 後 `load()` 重抓真 status）；未配置不給假開啟成功；關閉態頁頂琥珀條為規格硬要求；status note 誠實區分「env 未開」vs「runtime 被關」。
- **持久化取捨**：runtime flag in-memory，重啟回 env 初值——與 watcher in-memory 語意一致，誠實標於 status note 與 PR body，不偽稱持久。
- **E2E 可達性**：依測試區 watcher 配置態二選一驗真切片（正向往返 or 誠實 422 負向），未達狀態 `notObserved` + route 測試兜底深度因果。
- **跨 repo 邊界**：改動限 `bim-review-coordinator`（runtime flag + PUT route + status 改讀 + audit）與 `web-viewer-sample`（client `jsonPut`/`conversionWatchToggle` + `#conv` UI 開關/琥珀條）；不碰 `bim-streaming-server` / MinIO / viewer。
- **不在 main 開發**：branch → PR → Actions → merge；spec 落 `docs/superpowers/specs/`，接 `writing-plans` → `spec-to-done` 執行。

---

## 8. spec-to-done 執行配置（models / effort 分配，依任務本質）

> 依本機多模型降本規約（指揮官 / runtime-default = Opus 4.8 max；agent model 欄位零 Fable）。下表給 spec-to-done 各 phase 的建議 model 與 effort，使後續執行精準且省成本；P5 抓雷層與 BLOCKED 升級通道不降。

| Phase（spec-to-done 引擎） | 任務本質 | 建議 model | effort | 理由 |
|---|---|---|---|---|
| P1 std-plan（拆 plan） | 讀 spec + 現有 code anchor，產 bite-sized 任務樹 | **Opus 4.8** | high | §4.0 非 additive 改造的相依排序需高判斷；錯排會讓 toggle 測試不可成立 |
| P2 std-implement｜後端 route + runtime flag（§4.0-4.2） | 改既有啟動接線 + 新 PUT + audit | **Sonnet 4.6** | high | 邏輯中等但觸及既有行為，須照 spec 精修；附 CR-A/B/C 檢查清單 |
| P2 std-implement｜前端 client + UI（§4.3-4.4） | 新增 `jsonPut`/toggle method + Panel 開關 + 琥珀條 | **Sonnet 4.6** | medium | 沿用既有 `IntentDialog`/reducer 模式，pattern-match |
| P3 std-implement｜route 測試（§6.1） | 新測試檔 + 既有回歸鎖 | **Sonnet 4.6** | medium | 測試樣板明確（沿用 minio-watch 測試 config 注入） |
| P4 std-evidence｜gstack E2E（§6.4） | Playwright 開關往返 + 誠實揭露 | **Sonnet 4.6** | high | 端對端互動證據，誠實可達框架需嚴謹；截圖落 tracked evidence |
| 文件勘誤 / 既有測試比對 / log 抽取 | 機械性讀取/比對 | **Haiku 4.5** | low | 純讀無判斷，降本 |
| **P5 對抗抓雷層 / verification-before-completion** | CR-A~D 逐條複驗 + 誠實鐵律稽核 + GitNexus detect_changes | **Opus 4.8** | high | **不降**：安全守門漏失、樂觀更新、半開狀態、status 謊報是本卡主要失敗模式 |
| BLOCKED 升級通道 | 任一 agent 卡關 | **Opus 4.8** | max | 升級處理，不停在低模型鬼打牆 |

**交叉對抗驗證接續**：spec-to-done 內建 `spec-to-done-adversarial-verify` 於 P5 對 §0.3 的 CR-A~D 與 §1.1 全頁面邊界（不溢出 `#viewer`/其他頁）做獨立複驗；CI 端 pr-review-agent 為第二層（雙層 review 互補，不盲信單一 verdict）。

---

## 9. 給 spec-to-done 的精確落地清單（檔案 × 改動，零猜測）

**bim-review-coordinator（後端）**
- `src/app.ts:345` 附近：加 `minioWatchRuntimeEnabled` / `minioWatchToggleBusy` / `minioWatchConfigured()`（§4.0）。
- `src/app.ts:352`：guard 改讀 `minioWatchRuntimeEnabled`。
- `src/app.ts:390`：config-immediate 啟動改讀 `minioWatchRuntimeEnabled`。
- `src/app.ts:746` 後（prioritize/retry 之後）：新增 `app.put("/api/conversion/watch", ...)`（§4.1）。
- `src/app.ts:1014-1029`：抽 `currentMinioWatchStatusPayload()`、GET 改讀 runtime flag（§4.2）。
- `tests/conversion-watch-toggle.test.ts`（新；範本 `tests/conversion-control-routes.test.ts`）：§6.1。
- 回歸鎖（不得退化）：`tests/minio-watch-status-route.test.ts`、`tests/minio-watcher-loop.test.ts`、`tests/config-minio-watch.test.ts`。

**web-viewer-sample（前端）**
- `src/console/coordinatorClient.ts:45` 後：加 `jsonPut`；`:192` 後：加 `conversionWatchToggle`（§4.3）。
- `src/console/pages.tsx:448`：`pendingAction` union 加 `watch-toggle`；`:505 runAction` 加分支；`:530` 頁頂加琥珀條；`:541-582` Panel 加開關鈕；`:641 IntentDialog` title/cost 加 watch-toggle 文案（§4.4）。
- `src/console/console.test.tsx`：擴充 §6.3。
- `e2e/conv-watch-toggle.spec.ts`（新）：§6.4。

**evidence（tracked）**
- `docs/evidence/conv-watch-toggle/`：gstack 截圖 + summary（開關往返 or 誠實 422 負向）。

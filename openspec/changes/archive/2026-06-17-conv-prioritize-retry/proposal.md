## Why

M2 轉檔管線的「派工佇列」已 as-built 但**只有讀、沒有控制**：`#conv` 的「插隊 / 重試」是寫死的 `prov="p1"` 待建佔位（`web-viewer-sample/src/console/pages.tsx:496`），協調器無對應控制端點，`ConversionDispatchQueue` 無 reorder / retry。對應互動規格 IX-CV-03（`docs/plans/ai-bim-governance-互動實作規格與標準對齊.md:156`）與模式 3（危險動作三段式，line 99-105）。前置 M1/A1（#213）與 M2-a coverage 唯讀展開（#218）已 merged，milestone-order 解鎖。本輪做 M2 控制動作那半的第一張卡，也是產品**首個真 controlled action**（其餘 controlled action 現皆 disabled 佔位）。

## What Changes

- **coordinator（`bim-review-coordinator`）**：
  - 新增兩條 production 控制路由 `POST /api/conversion/jobs/:id/prioritize`、`POST /api/conversion/jobs/:id/retry`（`:id` = `ifc_ready_job_id` —— 未派工 job 還沒 `conversion_job_id`，佇列鍵只能是 ifc_ready_job_id）。safe-id 驗證（`isSafeIfcReadyJobId`，通用 pattern `^[A-Za-z0-9_.-]+$`，不複用 `isSafeSessionId`）→ 400；不存在 → 404；狀態不符 → 409；retry 脈絡確失（重啟/drain 後）→ 422；body 接受 optional `reason`（模式 3 ②）；成功寫結構化 audit log（action/actor/target/reason，模式 3 ③）。控制路由沿用既有 `EXTERNAL_INTAKE_IP_ALLOWLIST` IP 守門（預設含 loopback + docker bridge，空清單 = bypass，與 `IntranetDevAuthProvider` 語意一致）。
  - `ConversionDispatchQueue` additive 補 `prioritize(jobId): boolean`（移 queued job 到隊首）、`requeue(jobId): number`（retry 重新入列，回 `getQueuePosition` 語義 position：0=in-flight、≥1=queued，冪等不重複 append）。
  - **dispatcher closure delete-on-success 改造**（非純 additive）：`pendingDispatchEvents` 改為「`markDispatched` 成功後才刪」、失敗保留 → 讓 `dispatch_failed` job 仍持有派工脈絡可被 retry 重派；否則 retry 邏輯上不可能成立。`dispose()` 加冪等守門。`hasPendingDispatch(jobId): boolean` test-only getter 取代公開 interface 上的 map（不外洩 unknown payload）。
  - `summarizeIfcReadyJob` additive 上 wire `queue_position`（`IfcReadyListItem` 補 `queue_position: number | null` non-optional）。
- **web-viewer-sample**：`coordinatorClient` 補 `jsonPost` + `conversionPrioritize` / `conversionRetry`；新增首個共用 `IntentDialog`（模式 3 ① ②，cost 白話 + optional reason，非樂觀）；`#conv` job 列依狀態渲染「插隊」（`queued_for_conversion` 且 `queue_position>=2`）/「重試」（`dispatch_failed`/`dropped_on_restart`）控制鈕 → `IntentDialog` → 真 POST → 成功後 `load()` 重抓真狀態（POST 成功但重抓失敗時保持 dialog 開啟 + 顯誠實錯誤，不靜默關閉）。取代 `pages.tsx:496` 佔位。
- **Browser E2E（Playwright）**：`#conv` 控制鈕 → IntentDialog → 真 `POST /retry` → 2xx → 列依真狀態刷新；指揮官以可控 stack（500-then-hang stub 製造 `dispatch_failed`）取得 retry 切片**真綠**（見 `docs/evidence/conv-prioritize-retry/`），prioritize 路徑 notObserved 由 route 測試兜底。
- **非目標**：不改 `bim-streaming-server` 轉檔引擎（authority 零改動）；不做 IX-CV-04 watch toggle、concurrency / drain / move；不做 `failed`（下游轉檔失敗）或 download-failed 重試；不做佇列 disk 持久化；不建全站 RBAC / audit 持久層（audit = 結構化 log 一筆，B 方案 LAN 無身分稽核，actor best-effort）。

## Capabilities

### New Capabilities

- `conv-prioritize-retry`: operator 在 `#conv` 對 ifc-ready 佇列的 `dispatch_failed` job 按「重試」、對排隊中（`queue_position>=2`）job 按「插隊」，經 IntentDialog 三段式確認後打真協調器控制路由，後端重排 / 重派並寫 audit，前端依後端真狀態刷新（非樂觀）。

### Modified Capabilities

- None.

## Impact

- Owner repo / folder：`bim-review-coordinator/src/`（app.ts 路由 + dispatcher、services/conversionDispatchQueue.ts、lib/structLog.ts audit）、`web-viewer-sample/src/console/`（coordinatorClient、IntentDialog、pages.tsx）、`web-viewer-sample/e2e/`。`bim-streaming-server` 零改動。
- API / data shape：新增 `POST /api/conversion/jobs/:id/{prioritize,retry}`；`GET /api/external/ifc-ready` 既有形狀 additive 加 `queue_position`（回歸鎖 `external-ifc-ready.test.ts`）；`buildStreamConfig` / 既有 conversion forwarding 形狀零變動。
- Runtime boundary：不動 ports / 服務拓樸；控制動作只動協調器自有 in-memory dispatch 佇列。部署區生效需 merge 後 rebuild（dist-ui 重 bake + coordinator 重啟）。
- 行為變更框定：dispatcher delete-on-success 改造影響 `pendingDispatchEvents` 生命週期（回歸網 = `conversion-dispatch-queue.test.ts` + `host-native-conversion-ingest.test.ts` + `external-ifc-ready.test.ts`，全綠 401 tests）。GitNexus impact：`IfcReadyListItem` MEDIUM（additive optional 欄，importer 不破）；`setDispatcher`/`summarizeIfcReadyJob`/`coordinatorClient` LOW。

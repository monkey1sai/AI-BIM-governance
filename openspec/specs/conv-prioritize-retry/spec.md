# conv-prioritize-retry Specification

## Purpose
TBD - created by archiving change conv-prioritize-retry. Update Purpose after archive.
## Requirements
### Requirement: coordinator SHALL 提供 dispatch 佇列「插隊／重試」控制路由

coordinator SHALL 提供 `POST /api/conversion/jobs/:id/prioritize` 與 `POST /api/conversion/jobs/:id/retry`（`:id` = `ifc_ready_job_id`，因未派工 job 尚無 `conversion_job_id`、佇列鍵只能是 ifc_ready_job_id）。兩路由 SHALL 以通用 safe-id（pattern `^[A-Za-z0-9_.-]+$`，SHALL NOT 複用只認 `^review_session_` 的 `isSafeSessionId`）驗 `:id`，不合法 SHALL 回 400；job 不存在 SHALL 回 404。prioritize 對非 `queued_for_conversion` job SHALL 回 409；retry 對非 `dispatch_failed`/`dropped_on_restart` job SHALL 回 409、對派工脈絡確失（重啟/drain 後）job SHALL 回 422。兩路由 SHALL 沿用既有 `EXTERNAL_INTAKE_IP_ALLOWLIST` IP 守門（空清單 = bypass），SHALL 接受 optional `reason`，且成功 SHALL 寫一筆結構化 audit log（action/actor/target/reason）。控制動作的佇列與 pending 語意 SHALL 由 **IfcReadyConversionPipeline** 執行（`prioritize` / `retryDispatch`），HTTP 層只做守門與映射；SHALL 只動 coordinator 自有 in-memory dispatch 佇列，SHALL NOT 改 `bim-streaming-server` 轉檔引擎。

#### Scenario: retry 把派工失敗 job 重新排入佇列

- **WHEN** 某 ifc_ready job 因下游派工失敗處於 `dispatch_failed`，operator 對其打 `POST /api/conversion/jobs/:id/retry`
- **THEN** 路由 SHALL 回 200 且 body `status` SHALL 為 `queued_for_conversion`，該 job SHALL 被 worker 重新取件再派工（非立即 re-fail）

#### Scenario: dropped_on_restart 且已下載脈絡存在時可重試

- **WHEN** 某 ifc_ready job 處於 `dropped_on_restart`，且持久 job record 仍有完整 downloaded IFC dispatch context
- **THEN** retry 路由 SHALL 重建 pending-dispatch context、回 200，並將 job 重新排入 `queued_for_conversion`

#### Scenario: dropped_on_restart 缺少已下載脈絡時拒絕重試

- **WHEN** 某 ifc_ready job 處於 `dropped_on_restart`，但 required downloaded IFC dispatch context 不存在或不完整
- **THEN** retry 路由 SHALL 回 422，SHALL NOT 改變 job 狀態、SHALL NOT 建立 queue entry、SHALL NOT 回捏造資料

#### Scenario: prioritize 把排隊中 job 移到隊首

- **WHEN** 佇列有一筆 in-flight job 與多筆 `queued_for_conversion` job，operator 對其中一筆非隊首 job 打 `POST /api/conversion/jobs/:id/prioritize`
- **THEN** 路由 SHALL 回 200，該 job SHALL 移到 queued 隊首，受影響 queued job 的 `queue_position` SHALL 被重算

#### Scenario: 非法 / 不存在 / 狀態不符 SHALL 回對應錯誤碼

- **WHEN** 對控制路由傳入非法 id、不存在 id、或狀態不符（prioritize 非 queued / retry 既非 dispatch_failed 亦非 dropped_on_restart）
- **THEN** 路由 SHALL 分別回 400 / 404 / 409，且 SHALL NOT 改任何 job 狀態、SHALL NOT 回捏造資料

### Requirement: dispatcher SHALL 在派工失敗時保留派工脈絡供 retry

**IfcReadyConversionPipeline**（非 composition root 內聯 dispatcher closure）SHALL 僅在 `markDispatched` 成功後才刪除該 job 的 pending-dispatch 脈絡；派工失敗（`markDispatchFailed`）SHALL 保留該脈絡，使 `dispatch_failed` job 可被 `retryDispatch` / `POST /api/conversion/jobs/:id/retry` 重新派工。`dispose()` SHALL 冪等（重複呼叫 SHALL NOT 重跑 drain/clear）。job 派工成功後 pending 脈絡 SHALL 不外洩於公開 `CoordinatorApp` 介面（僅暴露 `hasPendingDispatch(jobId): boolean` test-only getter，可由 pipeline 委派）。

#### Scenario: 派工失敗保留脈絡、成功才刪

- **WHEN** 某 job 派工失敗進入 `dispatch_failed`
- **THEN** 其 pending-dispatch 脈絡 SHALL 仍存在（`hasPendingDispatch` 為 true）；待後續某次派工 `markDispatched` 成功後該脈絡 SHALL 被刪除

### Requirement: `#conv` SHALL 以模式 3 三段式提供非樂觀的控制動作

`#conv`（`ConversionPage`；`ConversionSchedulingPage` 已於 #303 退役）ifc-ready job 列 SHALL 依狀態渲染控制鈕：`dispatch_failed`/`dropped_on_restart` 顯「重試」、`queued_for_conversion` 且 `queue_position>=2` 顯可按「插隊」（`queue_position` 為 null/0/1 時插隊鈕 SHALL disabled）。點按 SHALL 開 `IntentDialog`（模式 3 ①：顯成本白話 + optional reason），confirm SHALL 打真 coordinator 控制路由（模式 3 ②）。前端 SHALL NOT 樂觀更新：POST 成功後 SHALL 以 `load()` 重抓真佇列狀態才關 dialog；POST 失敗或「POST 成功但重抓失敗」時 dialog SHALL 保持開啟並顯誠實錯誤、SHALL NOT 靜默關閉。`queue_position` SHALL 由後端原樣呈現，SHALL NOT 前端計算。

#### Scenario: 重試鈕 → IntentDialog → 真 POST → 證據型刷新

- **WHEN** operator 在 `#conv` 對 `dispatch_failed` job 點「重試」並於 IntentDialog 按確認
- **THEN** 前端 SHALL 打 `POST /api/conversion/jobs/:id/retry`、收 2xx 後 SHALL `load()` 重抓佇列並關閉 dialog，列 SHALL 依後端真狀態刷新（非樂觀）

#### Scenario: POST 成功但重抓佇列失敗 SHALL 保持 dialog 開啟

- **WHEN** 控制動作 POST 已回 2xx 但隨後重抓佇列（`load()`）失敗
- **THEN** dialog SHALL 保持開啟並顯「重新抓取佇列失敗」誠實錯誤，SHALL NOT 靜默關閉（後端動作冪等，提示可重按確認）

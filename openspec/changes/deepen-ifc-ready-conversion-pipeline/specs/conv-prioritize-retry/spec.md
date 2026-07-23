## MODIFIED Requirements

### Requirement: dispatcher SHALL 在派工失敗時保留派工脈絡供 retry

**IfcReadyConversionPipeline**（非 composition root 內聯 dispatcher closure）SHALL 僅在 `markDispatched` 成功後才刪除該 job 的 pending-dispatch 脈絡；派工失敗（`markDispatchFailed`）SHALL 保留該脈絡，使 `dispatch_failed` job 可被 `retryDispatch` / `POST /api/conversion/jobs/:id/retry` 重新派工。`dispose()` SHALL 冪等（重複呼叫 SHALL NOT 重跑 drain/clear）。job 派工成功後 pending 脈絡 SHALL 不外洩於公開 `CoordinatorApp` 介面（僅暴露 `hasPendingDispatch(jobId): boolean` test-only getter，可由 pipeline 委派）。

#### Scenario: 派工失敗保留脈絡、成功才刪

- **WHEN** 某 job 派工失敗進入 `dispatch_failed`
- **THEN** 其 pending-dispatch 脈絡 SHALL 仍存在（`hasPendingDispatch` 為 true）；待後續某次派工 `markDispatched` 成功後該脈絡 SHALL 被刪除

### Requirement: coordinator SHALL 提供 dispatch 佇列「插隊／重試」控制路由

coordinator SHALL 提供 `POST /api/conversion/jobs/:id/prioritize` 與 `POST /api/conversion/jobs/:id/retry`（`:id` = `ifc_ready_job_id`，因未派工 job 尚無 `conversion_job_id`、佇列鍵只能是 ifc_ready_job_id）。兩路由 SHALL 以通用 safe-id（pattern `^[A-Za-z0-9_.-]+$`，SHALL NOT 複用只認 `^review_session_` 的 `isSafeSessionId`）驗 `:id`，不合法 SHALL 回 400；job 不存在 SHALL 回 404。prioritize 對非 `queued_for_conversion` job SHALL 回 409；retry 對非 `dispatch_failed`/`dropped_on_restart` job SHALL 回 409、對派工脈絡確失（重啟/drain 後）job SHALL 回 422。兩路由 SHALL 沿用既有 `EXTERNAL_INTAKE_IP_ALLOWLIST` IP 守門（空清單 = bypass），SHALL 接受 optional `reason`，且成功 SHALL 寫一筆結構化 audit log（action/actor/target/reason）。控制動作的佇列與 pending 語意 SHALL 由 **IfcReadyConversionPipeline** 執行（`prioritize` / `retryDispatch`），HTTP 層只做守門與映射；SHALL 只動 coordinator 自有 in-memory dispatch 佇列，SHALL NOT 改 `bim-streaming-server` 轉檔引擎。

#### Scenario: retry 把派工失敗 job 重新排入佇列

- **WHEN** 某 ifc_ready job 因下游派工失敗處於 `dispatch_failed`，operator 對其打 `POST /api/conversion/jobs/:id/retry`
- **THEN** 路由 SHALL 回 200 且 body `status` SHALL 為 `queued_for_conversion`，該 job SHALL 被 worker 重新取件再派工（非立即 re-fail）

#### Scenario: prioritize 把排隊中 job 移到隊首

- **WHEN** 佇列有一筆 in-flight job 與多筆 `queued_for_conversion` job，operator 對其中一筆非隊首 job 打 `POST /api/conversion/jobs/:id/prioritize`
- **THEN** 路由 SHALL 回 200，該 job SHALL 移到 queued 隊首，受影響 queued job 的 `queue_position` SHALL 被重算

#### Scenario: 非法 / 不存在 / 狀態不符 SHALL 回對應錯誤碼

- **WHEN** 對控制路由傳入非法 id、不存在 id、或狀態不符（prioritize 非 queued / retry 非 dispatch_failed）
- **THEN** 路由 SHALL 分別回 400 / 404 / 409，且 SHALL NOT 改任何 job 狀態、SHALL NOT 回捏造資料

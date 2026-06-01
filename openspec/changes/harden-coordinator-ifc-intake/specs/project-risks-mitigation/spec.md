# project-risks-mitigation — Spec Delta (harden-coordinator-ifc-intake)

> Delta against `openspec/specs/project-risks-mitigation/spec.md`。
> 補充 `RISK-IN-MEMORY-QUEUE-PERSISTENCE` 的 graceful shutdown 接線:既有 requirement 要求 graceful shutdown 時 `drain()` + mark `dropped_on_restart`,但 `dispose()` 從未接上 process termination signal,真實 SIGTERM/SIGINT 下從不被觸發。本 delta 明確要求 signal 接線。

## ADDED Requirements

### Requirement: Graceful shutdown SHALL be wired to process termination signals

`bim-review-coordinator` 進程 SHALL 在收到 `SIGTERM` 或 `SIGINT` 時執行 graceful shutdown,呼叫已實作的 dispose 流程(`ConversionDispatchQueue.drain()` 把 queued job 標 `dropped_on_restart`、取消 in-flight poller、關閉 HTTP server 與 Socket.IO),再以正常退出碼結束。此為 `RISK-IN-MEMORY-QUEUE-PERSISTENCE` 既有 graceful-shutdown-drain requirement 的接線實作;dispose 本體行為 SHALL NOT 改變,in-flight job SHALL NOT 被中斷(drain 只移除尚未起跑的 queued job)。

#### Scenario: SIGTERM or SIGINT triggers graceful dispose

- **WHEN** coordinator 進程在有 queued 轉檔 job 時收到 `SIGTERM` 或 `SIGINT`
- **THEN** 進程 SHALL 執行 dispose:queued job 透過 `ConversionDispatchQueue.drain()` 標為 `dropped_on_restart`
- **AND** SHALL 關閉 HTTP server 與 Socket.IO
- **AND** SHALL 以正常退出碼(`0`)結束
- **AND** in-flight job SHALL NOT 被中斷

#### Scenario: Dispose body remains the single graceful-shutdown path

- **WHEN** 本 change 接上 signal handler
- **THEN** 既有 `dispose()` 的 drain / mark / poller-cancel / server-close 行為 SHALL NOT 被改變
- **AND** signal handler SHALL 僅作為觸發既有 dispose 的進入點,不複製或分岔 shutdown 邏輯

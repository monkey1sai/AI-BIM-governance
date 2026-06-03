# governance-issue-tracking — Spec Delta (governance-issue-db)

> 新 capability：落地端 issue 生命週期 + audit + BCF-aligned 來源綁定。

## ADDED Requirements

### Requirement: 落地端 SHALL 提供 issue 生命週期與 audit

`governance-service` SHALL 提供 issue，其狀態 SHALL 在 open / assigned / in_progress / resolved / rejected / reopened 間依受控狀態機轉換。每次建立與狀態轉換 SHALL 寫入 audit event（可重播、可驗證）。

#### Scenario: issue 狀態機與 audit

- **WHEN** 建立一個 issue 並做狀態轉換
- **THEN** 新 issue SHALL 起始於 open
- **AND** 合法轉換（如 open → assigned → resolved）SHALL 成功
- **AND** 非法轉換（如 resolved → open）SHALL 被拒（4xx）
- **AND** 每次建立與轉換 SHALL 各留一筆 audit event（含 from/to status 與時間）

### Requirement: issue SHALL 以 ifc_guid 綁定；無 guid 僅為標註（BCF 對齊）

issue SHALL 以 `ifc_guid` 為跨工具主鍵並可綁 `model_version_id`。**無 `ifc_guid` 的條目 SHALL 標為 `kind=annotation`（視覺標註），SHALL NOT 視為正式可交換 issue**（BCF 原則 rule 10）。

#### Scenario: 有/無 guid 的 kind 區分

- **WHEN** 建立 issue 時提供 `ifc_guid`
- **THEN** 其 `kind` SHALL 為 `issue`（正式、可交換）
- **WHEN** 建立時未提供 `ifc_guid`
- **THEN** 其 `kind` SHALL 為 `annotation`，SHALL NOT 當作正式 BCF issue

### Requirement: issue SHALL 可由 rule-run / diff 來源批次產生並保留來源綁定

`governance-service` SHALL 能從 A1 rule-run 的失敗構件與 A2 diff 的變更構件批次建立 issue，並保留來源綁定（`source_type` / `source_ref` 與真實 `ifc_guid`）。

#### Scenario: 從 rule-run 失敗構件建 issue

- **WHEN** 對一個有失敗構件的 rule-run 呼叫 from-rule-run
- **THEN** SHALL 為每個失敗構件建立一個 issue
- **AND** 每個 issue SHALL 帶該構件真實的 `ifc_guid` 與 `source_type=rule_result`
- **AND** 因有 `ifc_guid`，`kind` SHALL 為 `issue`

### Requirement: issue 操作 SHALL 經 coordinator proxy，且不復活退役的 socket push

瀏覽器 SHALL 只經 `bim-review-coordinator`（:8004）的 `/api/governance/issues*` 操作 issue（HTTP 請求/回應），SHALL NOT 直連 `governance-service`（:49102），SHALL NOT 復活 2026-05-21 退役的 socket collaboration server-push（`getReviewIssues` / `createAnnotation` / 即時廣播）。

#### Scenario: 經 proxy 操作 issue

- **WHEN** 瀏覽器建立或轉換 issue
- **THEN** 它 SHALL 呼叫 coordinator `/api/governance/issues*`
- **AND** issue 權威 SHALL 在 `governance-service`，coordinator 僅 HTTP 透傳
- **AND** SHALL NOT 透過已退役的 socket server-push 機制推送 issue

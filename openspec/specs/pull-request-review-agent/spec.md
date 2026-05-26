# pull-request-review-agent Specification

## Purpose
TBD - created by archiving change add-pr-review-agent. Update Purpose after archive.
## Requirements
### Requirement: 每個可審查 pull request 都會執行 PR review agent

本 repository SHALL 針對每個 targeting protected integration branch 的可審查 pull request 執行自動化 PR review agent gate。

#### Scenario: PR 被開啟或更新

- **WHEN** pull request 被 opened、reopened、marked ready for review，或有新 commits 更新
- **THEN** PR review agent gate 會針對目前 head SHA 執行
- **AND** gate 會記錄 base ref、head ref、base SHA、head SHA、PR number、trigger event 與 run timestamp

#### Scenario: Draft PR 被更新

- **WHEN** draft pull request 收到新 commits
- **THEN** PR review agent MAY 以 report-only mode 執行
- **AND** 在 pull request ready for review 前，它 MUST NOT 將 merge gate 標示為 passed

### Requirement: PR review agent 發布可審查 evidence

PR review agent SHALL 為每次 run 發布 machine-readable report 與 human-readable summary。

#### Scenario: Review report 被建立

- **WHEN** PR review agent 完成
- **THEN** 它會產生包含 `status`、`risk_level`、`changed_paths`、`openspec_changes`、`validation_commands`、`checks`、`blockers`、`warnings`、`human_review_notes` 與 `gitnexus` 的 JSON report
- **AND** 它會將 markdown summary 發布為 PR comment、status check summary 或 workflow artifact

#### Scenario: Report generation 失敗

- **WHEN** agent 無法產生可辨識已檢查項目的 report
- **THEN** gate status MUST 為 `failed`
- **AND** PR output MUST 說明 review evidence unavailable

### Requirement: PR review agent 保留 human approval boundaries

PR review agent SHALL NOT 取代 human review、CODEOWNERS、branch protection 或 merge authorization。

#### Scenario: Automated gate 通過

- **WHEN** 所有 required checks 通過，且 agent 將 review gate 標示為 `passed`
- **THEN** PR 仍需要任何已設定的 human review、CODEOWNERS approval、branch protection 與 merge policy
- **AND** agent MUST NOT 自動 merge pull request

#### Scenario: Automated GitHub review 被送出

- **WHEN** implementation 選擇寫入 GitHub review event
- **THEN** review body MUST 說明它是 automated gate verdict
- **AND** 它 MUST NOT dismiss、override 或 substitute required human approvals

### Requirement: Deterministic checks 必須先於 optional AI judgment

PR review agent SHALL 先以 deterministic checks 作為 pass/block 決策基礎，再使用任何 optional AI reviewer output。

#### Scenario: Deterministic checks 通過且 AI adapter unavailable

- **WHEN** 所有 required deterministic checks 通過，且 optional AI adapter unavailable
- **THEN** gate MAY 依 configured policy 回傳 `passed` 或 `warning`
- **AND** report MUST 記錄 AI review 被 skipped 以及原因

#### Scenario: Deterministic checks 失敗

- **WHEN** 任一 required deterministic check 失敗
- **THEN** optional AI reviewer output MUST NOT 將 gate 轉為 `passed`
- **AND** report MUST 將 failed command 或 check 列為 blocker

### Requirement: PR review agent 驗證 OpenSpec alignment

PR review agent SHALL 驗證包含 non-trivial behavior、architecture、workflow、API、data-flow 或 repo-boundary changes 的 PR，有對應 OpenSpec change 或明確 documented exception。

#### Scenario: PR 包含 OpenSpec change artifacts

- **WHEN** changed paths 包含 `openspec/changes/<change-id>/`
- **THEN** agent 會執行 `openspec validate <change-id>`
- **AND** report 會記錄 validation command、result 與 change id

#### Scenario: Behavior change 沒有 OpenSpec change

- **WHEN** changed paths 顯示 production code、workflow、API、data-flow、repo-boundary 或 verification policy changes，但沒有 OpenSpec change
- **THEN** gate status MUST 為 `blocked`
- **AND** report MUST 要求 OpenSpec change id 或 documented exception

### Requirement: PR review agent 強制 repo boundary guardrails

PR review agent SHALL 檢查 PR 是否違反 `AGENTS.md`、README 與 OpenSpec specs 記錄的 repo boundary rules。

#### Scenario: Retired runtime 被重新引入

- **WHEN** PR 新增 startup、health check、smoke、runtime dependency 或 required workflow references，將 retired `_worker`、`_bim-control`、`_s3_storage`、`_conversion-service` 或 `_conversion-server` 當作 current product runtime
- **THEN** gate status MUST 為 `blocked`
- **AND** report MUST 指出 path 與 violated boundary rule

#### Scenario: Runtime boundary changes 有文件記錄

- **WHEN** PR 改變 `bim-review-coordinator`、`bim-streaming-server`、`web-viewer-sample`、external IFC Worker 或 external company cloud 之間的 responsibilities
- **THEN** report MUST 指出 affected owner boundary
- **AND** gate MUST 要求 matching OpenSpec requirement 或 design documentation 後才能 pass

### Requirement: PR review agent 阻擋 secret 與 environment-value changes

PR review agent SHALL 阻擋 unsafe secret、credential、private key 與 real environment-value modifications。

#### Scenario: Secret-like file 被修改

- **WHEN** PR 修改 private keys、credentials、token files 或 existing `.env` secret values
- **THEN** gate status MUST 為 `blocked`
- **AND** report MUST 在不印出 secret value 的情況下指出 file path

#### Scenario: Secret-like file 被刪除

- **WHEN** PR 只刪除 private keys、credentials、token files 或 existing `.env` secret values
- **THEN** gate MAY 以 warning 進入 human review
- **AND** report MUST 要求 reviewer 確認 secret rotation 或 incident remediation

#### Scenario: Environment example 被更新

- **WHEN** PR 修改 `.env.example` 或新增 documented placeholder variables 且沒有 real secret values
- **THEN** gate MAY 在其他 checks 通過時 pass
- **AND** report MUST 記錄 env contract change 供 human review

### Requirement: PR review agent 選擇最小必要 validation

PR review agent SHALL 從 changed paths 選擇 validation commands，並記錄 skipped checks 與原因。

#### Scenario: Service-owned code changes

- **WHEN** changed paths 觸及 `bim-review-coordinator/`、`web-viewer-sample/`、`bim-streaming-server/`、`tests/` 或 `scripts/`
- **THEN** agent 會為 affected owner 選擇最小有用的 test、build、smoke 或 parse check
- **AND** report 會記錄 command、working directory、result 與 owner

#### Scenario: Required validation 無法在環境中執行

- **WHEN** required check 需要 unavailable GPU、Kit SDK、browser automation、network 或 credentials
- **THEN** agent 會依 changed paths 將 check 記錄為 `blocked`、`deferred` 或 `not_required`
- **AND** 它 MUST NOT 宣稱 unavailable validation passed

#### Scenario: Required local tooling 在 rollout 期間 unavailable

- **WHEN** GitHub-hosted runner 缺少 OpenSpec 或 GitNexus 等 local validation tool
- **AND** workflow 有明確 tooling-only rollout exception
- **THEN** agent 會將 check 記錄為 `skipped` 並附 warning
- **AND** 它 MUST NOT 宣稱 unavailable validation passed

### Requirement: PR review agent 整合 GitNexus impact evidence

PR review agent SHALL 在 code changes 通過 gate 前收集 GitNexus change detection，或記錄清楚的 unavailable reason。

#### Scenario: Code paths changed 且 GitNexus succeeds

- **WHEN** changed paths 包含 source code 或 scripts，且 GitNexus detect changes succeeds
- **THEN** report 會記錄 affected symbols、affected flows、risk level，以及 result 是否在 expected scope 內

#### Scenario: Code paths changed 且 GitNexus unavailable

- **WHEN** changed paths 包含 source code 或 scripts，且 GitNexus detect changes stale、unavailable 或 fails
- **THEN** gate status MUST 為 `blocked`，除非 PR 包含明確 docs-only 或 tooling-only exception
- **AND** report MUST 記錄 failed command 或 tool status

### Requirement: PR review agent 一致分類 risk 與 blockers

PR review agent SHALL 將每次 run 分類為 `passed`、`warning`、`blocked` 或 `failed`，並將每個 risk 分類為 `low`、`medium`、`high` 或 `critical`。

#### Scenario: High 或 critical risk 未解決

- **WHEN** deterministic checks、GitNexus evidence、path policy 或 AI reviewer output 識別出 unresolved HIGH 或 CRITICAL risk
- **THEN** gate status MUST 為 `blocked`
- **AND** report MUST 列出 merge 前需要的 mitigation

#### Scenario: 只剩 non-blocking warnings

- **WHEN** required checks 通過且只剩 non-blocking warnings
- **THEN** gate status MAY 為 `warning`
- **AND** report MUST 列出哪些 warnings 需要 human attention


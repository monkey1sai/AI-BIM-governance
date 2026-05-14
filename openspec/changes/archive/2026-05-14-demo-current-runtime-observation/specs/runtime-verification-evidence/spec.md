## ADDED Requirements

### Requirement: Demo observation evidence classifies every current capability tier

Runtime verification evidence SHALL include 一份 current demo observation report，並將每個 current demo tier 分類為 `passed`、`failed`、`blocked`、`deferred` 或 `not_observed`。此 report MUST include command 或 observation method、timestamp、service endpoints、runtime prerequisites，以及重播或比較結果所需的 identifiers。

#### Scenario: Current demo observation report is recorded

- **WHEN** demo observation pass 被執行
- **THEN** evidence 記錄 service health、API smoke、focused tests/builds、worker conversion/artifact readiness、review session lifecycle、Socket.IO collaboration、browser E2E、Kit/WebRTC runtime 與 dedicated multi-Kit capacity 的 statuses
- **AND** 每個 status 都包含 commands 或 observation steps、result summary、timestamp，以及可取得時的相關 IDs，例如 `conversion_job_id`、`artifact_group_id`、`review_request_id` 或 `session_id`

#### Scenario: Hardware or capacity prerequisite is missing

- **WHEN** Kit、GPU、browser automation、stream ports、renderable artifacts 或 multiple Kit endpoints 不可用
- **THEN** 受影響 tier 以 `blocked` 或 `deferred` 記錄，並列出 missing prerequisite 與 next runnable step
- **AND** evidence MUST NOT 將該 tier 分類為 `passed`

#### Scenario: A tier is not rerun

- **WHEN** 某個 tier 被刻意跳過，或只有 historical evidence 存在
- **THEN** current report 將該 tier 記錄為 `not_observed`，或另外引用 historical evidence，但不得將其視為 current pass

### Requirement: Demo observation evidence preserves service ownership boundaries

Runtime verification evidence SHALL 將每個 observed result 歸屬到實際擁有該責任的 service 或 folder。Evidence MUST NOT 用某一個 boundary 的成功去宣稱另一個 boundary 也成功。

#### Scenario: Worker evidence is recorded

- **WHEN** `_worker` accepts source artifacts、creates conversion jobs、exposes derived artifacts，或 reports artifact group readiness
- **THEN** evidence 將 `_worker` artifact/conversion status 與 review session、browser、Kit runtime status 分開記錄

#### Scenario: Review session evidence is recorded

- **WHEN** `_bim-control` stores review intent，且 `bim-review-coordinator` creates 或 manages a session
- **THEN** evidence 記錄 metadata authority、session lifecycle、collaboration events 與 close/release behavior，但不得宣稱 USD stage render success

#### Scenario: Browser and Kit evidence is recorded

- **WHEN** `web-viewer-sample` connects to `bim-streaming-server`
- **THEN** evidence 記錄 browser readiness、WebRTC/DataChannel status、non-zero video dimensions、`openedStageResult` 或 equivalent runtime response，以及 screenshot 或 blocker evidence，並與 API-only smoke results 分開

### Requirement: Demo observation evidence archives replayable artifacts

Runtime verification evidence SHALL 將 current demo observation results 存入 repo-local verification documentation，並在可取得時 archive 產生的 screenshots 或 machine-readable summaries。

#### Scenario: Browser evidence is captured

- **WHEN** browser 或 Kit runtime observation 產生 visual 或 machine-readable proof
- **THEN** report 引用 repo-local evidence paths、browser URL、capture time、stream endpoint、video dimensions，以及相關 session 或 artifact IDs

#### Scenario: Observation produces no visual artifact

- **WHEN** 某個 tier 因 prerequisite 缺失而無法產生 screenshot 或 machine-readable summary
- **THEN** report 明確記錄 blocker 與 missing artifact，而不是讓 evidence path 保持空白或語意不清

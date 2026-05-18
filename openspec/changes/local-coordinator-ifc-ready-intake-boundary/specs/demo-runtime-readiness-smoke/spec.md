## MODIFIED Requirements

### Requirement: Demo runtime smoke includes B-scheme conversion tiers

Demo runtime smoke SHALL 獨立分類 B 方案各層級，且 SHALL NOT 依賴已刪除的
`_worker` / `_bim-control` 服務。預設 smoke SHALL 以 contract stub
（`tests/fakes` + `tests/contracts`）呼叫唯一外部入口 `bim-review-coordinator`
`POST /api/external/ifc-ready`，並分類：`external_ifc_ready_intake`、
`streaming_internal_conversion`、`mapping_quality`、`cloud_callback_outbox`、
`coordinator_session_lifecycle`、`runtime_image_kit_launcher`、`single_kit_render`、
`single_kit_multi_viewer`、`usd_stage_composition`。外部客戶落地端 IFC Worker 與
公司雲端 `bim-control` 皆為外部系統，只能由 test fixtures 模擬，不得作為服務啟動。

#### Scenario: External IFC-ready intake passes but streaming conversion is missing

- **WHEN** contract stub（test-only 外部 IFC Worker double）對 `bim-review-coordinator` `POST /api/external/ifc-ready` 送出符合規格的 `ifc_ready`，但 `bim-streaming-server` internal conversion 未監聽
- **THEN** `external_ifc_ready_intake` MAY 為 `passed`
- **AND** `streaming_internal_conversion` 為 `blocked` 或記錄為 `dispatch_failed`
- **AND** downstream render tiers 維持非 passed

#### Scenario: Streaming conversion passes without WebRTC

- **WHEN** `bim-streaming-server` internal conversion job 產生有效 USDC 與 mapping，但 Kit/WebRTC endpoint 未監聽
- **THEN** `streaming_internal_conversion` 與 `mapping_quality` MAY 為 `passed`
- **AND** `single_kit_render` 維持 `blocked` 或 `not_observed`

#### Scenario: Cloud callback outbox is classified independently of conversion

- **WHEN** internal conversion 成功，但公司雲端 callback endpoint 不可達（OQ1 pending：真實 endpoint 維持 `pending`）
- **THEN** `streaming_internal_conversion` MAY 為 `passed`
- **AND** `cloud_callback_outbox` 會記錄 retained-and-retried，重試耗盡後進入 `dead_letter`，不得 silent drop
- **AND** conversion result 仍可在本地查詢，不受 callback delivery 影響

#### Scenario: Kit launcher prerequisite missing is deferred, not passed

- **WHEN** runtime image 已驗證產出的 Linux Kit launcher，但 NVIDIA graphics / Vulkan / GPU / Kit license 前置條件不可用
- **THEN** `runtime_image_kit_launcher` 為 `deferred` 並記錄原因
- **AND** 它 MUST NOT 為 `passed`，且 host-local Kit MUST NOT 被當作替代 pass

#### Scenario: Historical mock evidence is not promoted

- **WHEN** 存在歷史 `_worker` / `_bim-control` evidence，但目前這次 pass 沒有執行 B 方案 contract-stub run
- **THEN** B 方案 tiers MUST 為 `not_observed`、`blocked` 或 `deferred`
- **AND** 它們 MUST NOT 為 `passed`

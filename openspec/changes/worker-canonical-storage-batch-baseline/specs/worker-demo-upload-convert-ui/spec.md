## MODIFIED Requirements

### Requirement: Worker UI visualizes lineage and quality status

Worker demo UI MUST 提供 worker artifacts 的 lineage 與 conversion quality view。UI 必須透過 `_worker` API 取得資料，例如 `GET /api/artifacts/{artifact_id}/lineage`、`GET /api/conversions/{conversion_job_id}/result`、`GET /api/artifact-groups/{artifact_group_id}/readiness`，不得直接讀取 local files。

此 view 必須限制在 artifact intake、conversion observability、lineage、quality evidence 與 review viewer handoff 範圍內。它不得提供 review issue editing、annotation editing、session lifecycle management、WebRTC streaming controls，也不得直接 render USD/USDC。

當 conversion result 包含可開啟的 `model.usdc`、stable artifact IDs 與 readiness data 時，worker UI 必須提供足夠資訊或明確 action，讓使用者可以透過既有 review viewer flow 開啟轉檔成果。該 handoff 必須保留 `conversion_job_id`、`artifact_group_id`、source artifact ID、derived USDC artifact ID 或 URL、mapping artifact ID 或 URL，以及 quality status。

#### Scenario: 使用者開啟 converted artifact 的 lineage

- **WHEN** conversion job 成功，且使用者開啟它的 lineage view
- **THEN** UI 顯示 source IFC、derived USDC、index artifacts、mapping artifact、stable artifact IDs、conversion job ID、artifact group ID、object URLs、metadata URL 與 quality status

#### Scenario: Quality status 可見

- **WHEN** lineage API 或 conversion result 回傳 quality metrics
- **THEN** UI 顯示 coverage ratio、`minimum_coverage_ratio`、baseline lock status、`coverage_denominator=source_ifc_entity_count`、mapped/unmapped IFC entity counts、coverage status，以及 warnings 或 diagnostics

#### Scenario: Warning quality 仍可進入 review

- **WHEN** lineage API 或 conversion result 回報 `coverage_status=warn`
- **THEN** UI 保留 review handoff，同時清楚顯示 mapping quality degraded，且不得把 issue-to-real-prim readiness 標示為 verified

#### Scenario: Lineage 不完整

- **WHEN** lineage API 回報 missing mapping、missing derived artifact、legacy metadata gaps 或 unavailable quality metrics
- **THEN** UI 顯示 incomplete state，不得隱藏 source artifact，也不得暴露 absolute local filesystem paths

#### Scenario: Converted USDC 提供 review viewer handoff

- **WHEN** conversion result 提供可開啟的 worker-produced `model.usdc`、artifact group readiness 與 lineage data
- **THEN** UI 提供 preview/open action 或等效 handoff data，將使用者導向 `bim-review-coordinator` 或既有 review viewer flow，並帶上載入 USDC 所需的 stable artifact IDs 與 URLs

#### Scenario: Worker UI 不直接 render USDC

- **WHEN** 使用者想檢視 converted `model.usdc`
- **THEN** worker UI 將使用者導向 review viewer / Kit path，且不得在 `_worker` 內 parse USD、render USDC、開啟 WebRTC stream 或管理 review session lifecycle

#### Scenario: Review workflow 維持在 worker UI 外

- **WHEN** artifact group ready，且 lineage 已在 worker UI 可見
- **THEN** 下一個 review action 仍導向 `bim-review-coordinator` 或既有 review viewer flow，worker UI 不管理 review sessions

# conversion-webhook-lifecycle — Spec Delta (coordinator-forward-quality-metrics-summary)

> Delta against `openspec/specs/conversion-webhook-lifecycle/spec.md`。本 change
> 補實 coordinator 自動 ingest 路徑把 streaming conversion result 的
> `quality_metrics` 萃取成 `ConversionQualityMetricsSummary` 並 forward 進
> review session,使 viewer / `/ui` 三段 ready 對齊計算的 Semantic ready 有真實
> 資料來源(對接 C1 / C2 / C3 archive 後的 fast MVP closed loop)。

## ADDED Requirements

### Requirement: Coordinator forwards streaming conversion quality summary into review session stream-config

`bim-review-coordinator` SHALL forward streaming conversion `quality_metrics`
into the review session's `quality_metrics_summary` slot whenever the coordinator
auto-ingests a terminal conversion result and creates a review session
(`createReviewSessionFromIngest` path or equivalent internal flow). The
extraction SHALL be best-effort: when the result has no `quality_metrics`
section, the summary SHALL be `null` and session creation MUST NOT be blocked.
The viewer and `/ui` dashboard SHALL receive the populated summary via
`GET /api/review-sessions/:id/stream-config` for tri-ready Semantic calculation.

#### Scenario: Auto ingest copies semantic mapping fidelity to stream-config

- **WHEN** streaming conversion result `quality_metrics` 含
  `semantic_mapping_fidelity` / `mapping_has_ifc_type` / `mapping_has_ifc_name`
  (對應 `streaming-server-fallback-semantic-mapping` 提供的欄位)
- **AND** coordinator 自動 ingest 該結果建立 review session
- **THEN** 後續 `GET /api/review-sessions/<session_id>/stream-config` 回應的
  `quality_metrics_summary` SHALL 包含這三個欄位的 truthy 值
- **AND** viewer `computeSemanticReady` SHALL 對該 session 計算為 `"yes"`
- **AND** `/ui` dashboard tri-ready Semantic badge SHALL 對齊顯示為 `yes`

#### Scenario: Auto ingest preserves existing summary fields

- **WHEN** streaming conversion result `quality_metrics` 含既有欄位
  `source_ifc_entity_count` / `sidecar_carrier_count` / `materialization_strategy`
  / `coverage_ratio` / `coverage_status` / `phase_timings.conversion_total.duration_seconds`
  / `original_filename` / `artifact_group_id`
- **THEN** 萃取的 `quality_metrics_summary` SHALL 把這些值對應到原既有 schema
  欄位(`source_ifc_entity_count` / `sidecar_carrier_count` /
  `materialization_strategy` / `coverage_ratio` / `coverage_status` /
  `conversion_duration_seconds` / `fixture_name` / `artifact_group_id`)
- **AND** missing 欄位 SHALL 填 `null`,不為 `undefined`,維持 JSON schema 穩定

#### Scenario: Missing quality_metrics keeps summary null

- **WHEN** streaming conversion result 沒有 `quality_metrics` 區段(舊版
  streaming server 或非 ready terminal 結果)
- **THEN** session 建立 SHALL 仍成功且 `quality_metrics_summary` 為 `null`
- **AND** viewer / `/ui` 對 null summary 仍按 C2 / C3 既有規則計算 Semantic ready
  為 `no`(不偽宣告)

#### Scenario: Explicit POST /api/review-sessions path is unchanged

- **WHEN** external caller 透過 `POST /api/review-sessions` 主動建立 session
  並帶 `quality_metrics_summary` 在 body
- **THEN** coordinator SHALL 按照 caller 提供的值寫入 store(既有行為,不被
  本 change 蓋掉)
- **AND** 本 change 的 auto ingest 萃取 SHALL 只在 auto path 觸發,不影響
  explicit caller path

#### Scenario: Coordinator types.ts schema is additive

- **WHEN** coordinator `ConversionQualityMetricsSummary` 介面被擴充以加入
  C1 新欄位
- **THEN** 既有 caller(包含外部 explicit POST / 既有 archived test fixture)
  使用舊 schema(無 `semantic_mapping_fidelity` 等)時 SHALL 仍能通過 zod
  schema parse 與 store create
- **AND** 新欄位 SHALL 是 optional(`?: string | null` / `?: boolean | null`)

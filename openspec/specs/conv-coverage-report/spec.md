# conv-coverage-report Specification

## Purpose
TBD - created by archiving change conv-coverage-report. Update Purpose after archive.
## Requirements
### Requirement: coordinator SHALL 提供 production 唯讀 quality-metrics passthrough

`GET /api/conversions/{conversionJobId}/quality-metrics` SHALL 以 `conversion_job_id` 經既有 `fetchConversionResult` + `buildQualityMetricsSummary` 原樣回傳 `ConversionQualityMetricsSummary`（coordinator SHALL NOT 計算或改值，與 stream-config 同一真相源；SHALL NOT 要求先有 review session）。端點 SHALL 以 `isSafeConversionJobId`（`^[A-Za-z0-9_.-]+$`）驗證、不合法回 400，且 SHALL NOT 複用只認 `review_session_` 的 `isSafeSessionId`。conversion job 不存在 SHALL 回 404；conversion authority 連不上 / 逾時 SHALL 回 502 / 503。任何錯誤路徑 SHALL NOT 把內部 authority URL / upstream body 外溢給 client，且 SHALL NOT 回傳捏造或部分 coverage。

#### Scenario: 成功回後端原樣 coverage 摘要

- **WHEN** 對已轉檔 job 呼叫 `GET /api/conversions/{id}/quality-metrics` 且 authority result 含 `quality_metrics`
- **THEN** SHALL 回 200，`quality_metrics_summary.coverage_ratio` SHALL 等於 authority 值（coordinator 不改值），且 SHALL 含 `mapped_count`/`unmapped_count` 與 `usdc_url`/`mapping_url`

#### Scenario: 無 quality_metrics 誠實回 null

- **WHEN** authority result 無 `quality_metrics` 區段
- **THEN** SHALL 回 200 且 `quality_metrics_summary` SHALL 為 `null`（誠實「未取得」，非錯誤）

#### Scenario: 錯誤路徑不外溢內部欄位

- **WHEN** conversion authority 連不上（或 id 非法 / job 不存在）
- **THEN** SHALL 分別回 502/503（或 400/404），且 response body SHALL NOT 含 coverage 數字、SHALL NOT 含內部 authority URL / upstream body

### Requirement: ConversionQualityMetricsSummary SHALL additive 帶對應/未對應構件數

coordinator 與 web-viewer 的 `ConversionQualityMetricsSummary` SHALL additive 新增 optional `mapped_count` / `unmapped_count`（來源後端正規化 `quality_metrics`，缺值 SHALL 為 `null` 而非 `undefined`）。此擴充 SHALL NOT 改變既有欄位，且 SHALL NOT 破壞 stream-config `quality_metrics_summary` 既有 forwarding 形狀。

#### Scenario: 萃取帶出 mapped / unmapped

- **WHEN** `buildQualityMetricsSummary` 收到含 `mapped_count`/`unmapped_count` 的 `quality_metrics`
- **THEN** 回傳 summary SHALL 帶出該兩值；該鍵缺值時 SHALL 為 `null`

### Requirement: `#/conv` SHALL 可逐 job 展開後端原樣 coverage 報告且誠實降級

`#/conv`（`ConversionPage`；`ConversionSchedulingPage` 已於 #303 退役。`#/minio` GlobalConversionPane 亦提供等價展開與 `conv-coverage-*` testid）每列已派工 job（有 `conversion_job_id`）SHALL 可展開，懶載入 `conversionQualityMetrics` 顯示 coverage%（後端 `coverage_ratio`×100 原樣呈現）/ `coverage_status` / mapped/unmapped / usdc 路徑 / mapping_url；前端 SHALL NOT 計算 coverage。無 `conversion_job_id` 的 job SHALL NOT 可展開（`#/minio` 顯『尚未派工』、`#/conv` 顯 `—`）。property/relationship/attribute 三項拆分 SHALL 誠實標「後端未提供」（後端未產，SHALL NOT 捏造百分比）。`coverage_ratio<1` 卻四捨五入到 `100.00%` 時 SHALL 下修顯 `99.99%`（SHALL NOT 謊報 100% lossless）。

#### Scenario: 展開已派工 job 看後端真 coverage

- **WHEN** operator 在 `#/conv` 點某有 `conversion_job_id` 的 job 的 coverage 展開鈕
- **THEN** SHALL 呼叫 `conversionQualityMetrics` 並在抽屜顯示後端原樣 coverage%（含 `coverage_status`）+ mapped/unmapped + usdc 路徑

#### Scenario: 後端缺資料誠實降級不捏造

- **WHEN** `quality_metrics_summary` 為 `null`、或某欄位缺值、或顯示三項拆分
- **THEN** drawer SHALL 分別顯「未取得品質遙測」/「未取得」/「後端未提供」，且 SHALL NOT 顯任何捏造百分比

#### Scenario: 近滿覆蓋不謊報 100%

- **WHEN** `coverage_ratio<1`（仍有 unmapped）卻四捨五入到 `100.00%`
- **THEN** coverage SHALL 顯示 `99.99%` 而非 `100.00%`

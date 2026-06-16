## Why

M2 轉檔後端已 as-built（conversion authority 產 `model.usdc` + `element_mapping` + 正規化 `quality_metrics`），但 `#/conv` 仍把 coverage 標成待建佔位（`pages.tsx:427` `prov="p1"`），operator 看不到後端真實 coverage。這是 v3 M2「轉檔管線」DoD「丟一支新 model.ifc → 不碰按鈕 → `model.usdc` 出現 + coverage 報告可看」的最後一哩 —— 純 CPU、不碰 3D，前置 M1/A1 核心閉環已收尾（PR #213）。

## What Changes

- **coordinator**：新增 production 唯讀路由 `GET /api/conversions/:conversionJobId/quality-metrics`（以 `conversion_job_id` 經既有 `fetchConversionResult` + `buildQualityMetricsSummary` 原樣回傳 `ConversionQualityMetricsSummary`，coordinator 零計算、與 stream-config 同一真相源；不綁 review session）。新增 `isSafeConversionJobId` safe-id 守門（`^[A-Za-z0-9_.-]+$`，**不複用**只認 `review_session_` 的 `isSafeSessionId`）；錯誤路徑回 generic detail（**不外溢**內部 authority URL / upstream body、不回捏造或部分 coverage）。順帶補 `POST /api/internal/conversions/:id/ingest` 的 safe-id 守門。
- **coordinator + web-viewer**：兩份 `ConversionQualityMetricsSummary`（`types.ts` / `review.ts`）additive 補 `mapped_count` / `unmapped_count`（`buildQualityMetricsSummary` 補萃取，缺值回 `null`）。
- **web-viewer**：`IfcReadyListItem` 補 `conversion_job_id`（wire 已有，只補型別）；`coordinatorClient.conversionQualityMetrics` 方法 + `ConversionQualityMetricsResponse` 型別；`#/conv`（`ConversionSchedulingPage`）每列 coverage 展開抽屜（`CoverageDrawer`，懶載入、去重/載入鎖），顯 coverage%（後端 `coverage_ratio`×100 原樣）/ status / mapped/unmapped / source / materialization / 耗時 / usdc 路徑 / mapping_url；移除 `427` 佔位。
- **誠實鐵律**：三項拆分（property/relationship/attribute）誠實標「後端未提供」（後端未產，不捏百分比）；缺值顯「未取得」；`coverage_ratio<1` 卻四捨五入到 `100.00%` 時下修顯 `99.99%`（不謊報 100% lossless）；coverage 全程後端原樣、前端零計算。
- **Browser E2E**：`#/conv` coverage 展開（Playwright，隔離 branch stack viewer:5180 / coordinator:8005 / 真 authority:49101 服務 2026-06-02 真轉檔 result，`mock=false`、`guid_exact`，見 `docs/evidence/conv-coverage-report/`）。
- **非目標**：不改轉檔引擎、不做三項拆分（後端未產，誠實標未提供，列 follow-up）；不碰 `/api/external/ifc-ready` 契約形狀；不動 dev `/api/dev/conversions/*`；不引新 production dependency；不直連 :49101（瀏覽器一律經 coordinator）；不做轉檔控制動作（prioritize/retry/watch，IX-CV-03/04 留 M2-b）。

## Capabilities

### New Capabilities

- `conv-coverage-report`: operator 在 `#/conv` 展開任一已派工轉檔 job，即可看後端原樣 coverage 報告（coverage% / status / mapped/unmapped / usdc 路徑），不需先開 review session。

### Modified Capabilities

- None.

## Impact

- Owner repo / folder：`bim-review-coordinator/src/`（`app.ts` route + helper、`types.ts`、`services/streamingConversionClient.ts`）、`web-viewer-sample/src/`（`types/review.ts`、`console/coordinatorClient.ts`、`console/pages.tsx`）、`web-viewer-sample/e2e/`。
- API / data shape：新增 `GET /api/conversions/:conversionJobId/quality-metrics`（回 `{conversion_job_id, quality_metrics_summary|null, usdc_url, mapping_url}`）；`ConversionQualityMetricsSummary` additive 加 `mapped_count`/`unmapped_count`（optional，stream-config forwarding 既有形狀只新增不缺漏）；`/api/external/ifc-ready` 契約形狀零變動（`conversion_job_id` wire 已有，只補前端型別）。
- Runtime boundary：不動 ports / 服務拓樸；瀏覽器只經 coordinator（不直連 :49101）；部署區生效需 merge 後 rebuild（dist-ui 重 bake + coordinator 重啟）。
- 行為變更框定：coordinator 零計算（coverage 全來自 `buildQualityMetricsSummary`）；錯誤路徑改 generic detail（不外溢內部欄位）；既有 stream-config `quality_metrics_summary` / ifc-ready 契約回歸不壞（additive only）。

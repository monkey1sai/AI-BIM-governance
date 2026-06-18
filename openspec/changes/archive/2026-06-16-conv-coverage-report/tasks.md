## 1. coordinator production 路由 + 型別 additive

- [x] 1.1 `ConversionQualityMetricsSummary`（coordinator `types.ts` + web-viewer `review.ts` 兩份）additive 補 `mapped_count` / `unmapped_count`（optional）
- [x] 1.2 `buildQualityMetricsSummary` 補萃取 `mapped_count` / `unmapped_count`（`num()` 缺值回 `null`，schema-stable）
- [x] 1.3 `isSafeConversionJobId` helper（`^[A-Za-z0-9_.-]+$`，不複用 `isSafeSessionId`）+ 單元測試（接受真 id、擋分隔符/空白/空值/非 string）
- [x] 1.4 `GET /api/conversions/:conversionJobId/quality-metrics` production 唯讀路由（`fetchConversionResult`→`buildQualityMetricsSummary` 原樣；400/404/502/503 守門；錯誤 generic detail 不外溢內部欄位、不回捏造 coverage）+ ingest route safe-id 守門
- [x] 1.5 coordinator tests（route 200/null/400/404/502 + 同值鎖 + helper）；`npm run verify` 全綠（378 passed）

## 2. 前端 client + `#/conv` 展開 UI

- [x] 2.1 `IfcReadyListItem` 補 `conversion_job_id`（wire 已有）；`coordinatorClient.conversionQualityMetrics` + `ConversionQualityMetricsResponse`
- [x] 2.2 `ConversionSchedulingPage` 每列 coverage 展開抽屜（`CoverageDrawer`，懶載入、去重/載入鎖）；移除 `427` 佔位
- [x] 2.3 誠實降級：`summary=null`→未取得品質遙測、缺值→未取得、三項拆分→後端未提供、`coverage%` truncate near-100 不謊報 100%
- [x] 2.4 vitest（展開呼叫/真 coverage×100/null 分支/錯誤不顯數字/去重鎖/truncate 99.99%）14 passed + build 綠

## 3. 驗證 + evidence + 對抗複驗

- [x] 3.1 Browser E2E（Playwright，隔離 branch stack viewer:5180 / coordinator:8005 / 真 authority:49101 服務 2026-06-02 真轉檔 result `mock=false`）coverage 展開 PASS
- [x] 3.2 evidence `docs/evidence/conv-coverage-report/`（summary + 2 截圖，tracked）
- [x] 3.3 對抗複驗（P5）closed：e1 replay-fixture / e2 testserver-url / e3 隔離stack 三 gap `truly_closed`、無新問題；critic 非阻斷 `coverage% rounding` finding 已修（truncate near-100 + 鎖測試）

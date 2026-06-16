# M2-a：#conv 轉檔 coverage 報告展開 UI（production 唯讀 passthrough）設計

- 文件性質：spec design（設計文件）。權威序：code > contracts > AGENTS > docs/plans 行為合約 > wiki；與實作衝突時以實作程式碼與 `docs/plans/ai-bim-governance-互動實作規格與標準對齊.md` 的 IX-CV 互動卡為準。
- 日期：2026-06-16
- Phase 對應：**M2「轉檔管線」收斂第一步（M2-a）**。對應 v3 計畫 M2-R3「coverage 報告」（plan line 428）與 M2 DoD（plan line 430：「丟一支新 model.ifc 進 MinIO → 不碰任何按鈕 → `model.usdc` 出現在同資料夾 + coverage 報告可看」）與互動規格 IX-CV-02（`docs/plans/ai-bim-governance-互動實作規格與標準對齊.md:154`）。前置 M1/A1 核心閉環已於 PR #213 收尾，M2 milestone-order 解鎖。
- userFacing：true（`#conv` / `ConversionSchedulingPage`）。本輪把 `#conv` 上「coverage 待建」的誠實佔位（`web-viewer-sample/src/console/pages.tsx:427` `prov="p1"`）翻成真資料展開。
- 來源範圍決策（使用者 2026-06-16 拍板「完整做法」）：coverage 不綁 review session，以 `conversion_job_id` 直接經 coordinator production 唯讀路由取得，貼齊 M2 DoD「丟 ifc → 不碰按鈕 → coverage 可看」（不要求先開審查會議）。

## 1. 背景與現狀（盤點已實證）

M2 轉檔後端**已實質 as-built**：

- conversion authority（`bim-streaming-server`，host-native :49101）`POST /api/conversions/ifc-to-usdc` 真轉出 `model.usdc`，並以 `G_<sanitized_guid>` 命名 prim（IFC OpenUSD identity profile）。`_build_success_result`（`conversion_authority.py:383-462`）回傳含 `artifacts.model_usdc` / `element_mapping` URL（456-457）與正規化後的 `quality_metrics`（460）。`GET /api/conversions/{id}/result`（`conversion_authority.py:154-164`）對外提供完整結果。
- `quality_metrics` 由 `_normalize_quality_metrics`（`conversion_authority.py:530-544`）正規化，**確定欄位**：`source_ifc_entity_count`、`mapped_count`、`unmapped_count`、`coverage_ratio`（單一）、`coverage_status`（`pass`/`warn`）、`materialization_strategy`、`sidecar_carrier_count`、`minimum_coverage_baseline_locked`。**無 property/relationship/attribute 三項拆分欄位**（全 repo grep 證實不存在）。
- coordinator（`bim-review-coordinator`，:8004，Node/TS）已具備取數能力：`streamingConversionClient.fetchConversionResult(conversionJobId)`（`streamingConversionClient.ts:304-345`，打 :49101 `/api/conversions/:id/result`）+ `buildQualityMetricsSummary(result)`（`streamingConversionClient.ts:358-410`，把 `quality_metrics` 萃取成 `ConversionQualityMetricsSummary`）。此函式即現行 stream-config pass-through 的同一條真相源（`buildStreamConfig` app.ts:2385 回 `quality_metrics_summary`）。
- `conversion_job_id` **已在 ifc-ready 回應裡**：`summarizeIfcReadyJob`（`app.ts:1891-1921`）於 `app.ts:1907` 輸出 `conversion_job_id`；來源欄位 `IfcReadyIntakeJob.conversion_job_id`（`types.ts:180`），由 `externalIfcReadyStore.markDispatched`（`externalIfcReadyStore.ts:102-114`）於派工成功時寫入。
- 前端誠實降級件已成熟：`ConversionSummaryCard.tsx`（依 `streamConfig.quality_metrics_summary` 渲染 coverage_ratio/status + degraded 區塊）、`console/viewer/ModelInfoCard.tsx`（coverage_ratio×100，缺值顯「未取得」、fake badge）、`types/mapping.ts`（`isFakeMappingDocument` fake 隔離）。

仍讓 `#conv` 不是「coverage 報告可看」的兩個缺口：

1. **`#conv` 沒有 coverage 展開 UI**：`ConversionSchedulingPage`（`pages.tsx:397-499`）ifc-ready job 表（472-496）只列 job/project/conversion/dispatch/session/stage，coverage 那行是寫死的誠實佔位 `<Field k="mapping coverage" … prov="p1" />`（427）。job 列不可展開、看不到任何真 coverage。對應 PART A 實測（`互動實作規格…md:45`「mapping coverage 報告 P1」）與 IX-CV-02（line 154）。
2. **production 沒有「以 conversion_job_id 取 coverage」的瀏覽器可達路由**：現有只有 `GET /api/dev/conversions/:id/result`（`app.ts:1454-1465`）—— 該 handler 是 dev-intent proxy、**本身未強制守門**（`devRoutesEnabled()` app.ts:2114-2116 / Node env `ENABLE_DEV_ROUTES` 只套在 `/api/dev/ifc-sources*` 那組，非此條；守門機制是 Node 環境變數，**不是**前端 build-time 的 `import.meta.env.PROD`），且其形狀**洩漏完整 conversion result**。production 取 coverage 目前只走 review-session stream-config（`app.ts:565-576`），需先有 session —— 不符使用者拍板的「不綁 session」來源範圍。本輪新增的 production 路由只回**品質摘要子集 + artifact URL**，職責與 dev proxy 不同、並存。

**誠實鐵律硬限制**：coverage 一律「viewer MUST NOT compute」，只能把後端 `coverage_ratio` 原樣呈現（`console/governance/mappingCache.ts:5-6`、`console/viewer/ModelInfoCard.tsx:2`、`Window.tsx:2240`、`console/governance/govEndpoints.ts:15`）。element_mapping.json 的 `summary` 只有 mapped/unmapped **計數**、無分母，自算 ratio 會誤判（明令禁止）。後端既無三項拆分，本輪**不得在前端捏造三項百分比**。

## 2. 目標（成功標準）

1. **coordinator 新增 production 唯讀路由 `GET /api/conversions/:conversionJobId/quality-metrics`**：以 `conversion_job_id` 呼叫既有 `fetchConversionResult` → `buildQualityMetricsSummary`，**原樣回傳** `ConversionQualityMetricsSummary`（coordinator 零計算、零改值）。**新增 conversion-job-id safe-id validator**（pattern 比照後端 `_safe_id` 的 `^[A-Za-z0-9_.-]+$`，coordinator 端為**新 helper**——既有 `isSafeSessionId` 只認 `^review_session_`、**不可複用**驗 `stream_conv_*`）；不合法 → 400；conversion job 不存在 → 404；conversion authority 連不上/逾時 → 502/503 誠實錯誤（**絕不回捏造或部分 coverage**）。此路由**永遠開啟**（非 dev-gated），但只暴露品質摘要 + artifact URL，不外溢其他內部欄位。
2. **`buildQualityMetricsSummary` 與 `ConversionQualityMetricsSummary` additively 補 `mapped_count` / `unmapped_count`**：兩值來自後端正規化 `quality_metrics`（已存在），供 `#conv` 顯示「對應 / 未對應構件數」。additive、不刪改既有欄位、不破壞 stream-config 既有 forwarding 形狀。
3. **前端 `#conv` job 列可展開看真 coverage（不綁 session）**：`IfcReadyListItem` 補型別欄位 `conversion_job_id`（wire 已有，僅補 TS 型別）；`coordinatorClient` 新增 `conversionQualityMetrics(conversionJobId)`；ifc-ready job 表每列加展開鈕，展開時以 `conversion_job_id` 懶載入該路由，顯示：coverage%（`coverage_ratio`×100 原樣）、`coverage_status`、`mapped_count`/`unmapped_count`、`source_ifc_entity_count`、`materialization_strategy`、`conversion_duration_seconds`、usdc 輸出路徑（job/artifact）、mapping_url。取代 `pages.tsx:427` 的 `prov="p1"` 佔位（純 CPU，3D / GPU 無涉）。
4. **誠實鐵律維持**：(a) 三項拆分（property/relationship/attribute）顯示「後端未提供 — 以 coverage_ratio 為準」，不捏百分比；(b) job 尚無 `conversion_job_id`（未派工/轉檔中）→ 顯「尚未派工 / 轉檔中」，不展開假數據；(c) 路由錯誤 → 誠實錯誤訊息，不 fallback 假值；(d) coverage 永遠來自後端原樣，前端零計算。
5. **Browser E2E（gstack，A1–A10 唯一接受的 user-facing 證據）**通過：`#conv` 重新整理佇列 → 展開一筆已轉檔 job → 斷言看到真 `coverage_ratio`（×100）+ status + mapped/unmapped + usdc 路徑；附截圖。守門/skip 限制揭露比照既有 `a2-version-diff-selector.spec.ts` / `minio-fileserver-source.spec.ts` 先例。

## 3. 非目標（明確不做）

- **不改轉檔引擎、不做三項拆分**：property/relationship/attribute 分別統計需轉檔引擎 R&D（後端目前不產這三值），列為獨立 follow-up（暫名 M2-a2）。本輪誠實標「未提供」。
- **不碰 `/api/external/ifc-ready` 回應契約形狀**（`conversion_job_id` 已存在，只補前端型別；既有 `external-ifc-ready.test.ts` 契約不變）。
- **不改 stream-config 既有 `quality_metrics_summary` forwarding 語意**（`buildStreamConfig` app.ts:2385 既有路徑回歸不壞；本輪僅 additive 加 mapped/unmapped 兩欄）。
- **不動 dev-only `/api/dev/conversions/*` 路由**（新路由與其並存、職責不同：新路由 production、只回品質摘要）。
- **不引入新 production dependency、不改 coverage「MUST NOT compute」鐵律、不新增基礎設施、不直連 :49101**（瀏覽器一律經 coordinator）。
- **不做轉檔控制動作（prioritize/retry/watch）**（IX-CV-03/04 = 另一項 M2-b，需 intent→confirm→audited，獨立於本輪）。

## 4. 設計（三層縱切）

### 4.1 coordinator production 唯讀路由（`bim-review-coordinator`）

- 新路由 `GET /api/conversions/:conversionJobId/quality-metrics`（route 檔比照既有 conversion proxy / stream-config 既例放置）：
  1. 驗證 `conversionJobId`（新 conversion-job-id safe-id helper，pattern `^[A-Za-z0-9_.-]+$`；不合法 → 400；**不複用** `isSafeSessionId`）。
  2. `const result = await streamingConversionClient.fetchConversionResult(conversionJobId)`（既有，`streamingConversionClient.ts:304-345`）。
  3. `const summary = buildQualityMetricsSummary(result)`（既有，`streamingConversionClient.ts:358-410`，本輪 additive 補 mapped/unmapped）。
  4. `summary == null`（result 無 quality_metrics）→ 回 `{ conversion_job_id, quality_metrics_summary: null }`（誠實「無品質遙測」，非錯誤；前端顯「未取得」）。
  5. 成功 → 回 `{ conversion_job_id, quality_metrics_summary: summary, usdc_url, mapping_url }`（usdc/mapping URL 取自 `result`，供前端顯輸出路徑）。
  6. conversion job 不存在（authority 404）→ 404；authority 連不上 / 逾時 → 502 / 503 + 誠實 detail。**任何錯誤路徑都不回捏造 coverage**。
- **coordinator 零計算**：值全部來自 `buildQualityMetricsSummary`（與 stream-config 同一萃取），維持「只轉發不計算」契約。

### 4.2 型別 additive 擴充（`buildQualityMetricsSummary` + 兩份 `ConversionQualityMetricsSummary`）

- **兩份型別副本都要 additive 補欄**（這是查證重點，前後端各有獨立一份）：
  - coordinator `bim-review-coordinator/src/types.ts` 的 `ConversionQualityMetricsSummary`（`buildQualityMetricsSummary` 回傳型別）加 `mapped_count?: number | null`、`unmapped_count?: number | null`。
  - web-viewer `web-viewer-sample/src/types/review.ts:10-26` 的 `ConversionQualityMetricsSummary`（前端 client/渲染用的獨立副本）同步加同兩欄。
  - `console/viewer/ModelInfoCard.tsx` 另有第三份 `QualityMetricsSummary`，本輪 `#conv` 不經它，**不必動**（避免擴大面）。
- `streamingConversionClient.ts:358-410` `buildQualityMetricsSummary` 補萃取 `mapped_count` / `unmapped_count`：**用既有 `num(...)` helper（缺值回 `null` 而非 `undefined`）**，與 `host-native-conversion-ingest.test.ts:248-251` 鎖的「missing key 必須是 null」schema-stable 約定一致。兩鍵已在後端正規化 `quality_metrics`（`conversion_authority.py:537-538`）內。
- **回歸界線（查證澄清）**：`buildQualityMetricsSummary` 全 repo 僅 1 個既有 call site（`app.ts:1088` ingest 路徑），本輪新路由是第 2 個。
  - `host-native-conversion-ingest.test.ts:182`（真正會跑 `buildQualityMetricsSummary` 的 ingest→stream-config 路徑）用**逐欄 `toBe`** 斷言，加兩 optional 欄安全。
  - `sessions.test.ts:241` 雖是 strict `toEqual(summary)`，但該 case 走「caller 直接把 summary 放 POST body 再 echo」路徑、**不呼叫 `buildQualityMetricsSummary`**，故不會被注入新欄、`toEqual` 不破。**實作鐵律：勿把萃取輸出接進 session-creation passthrough**，否則該 `toEqual` 會炸。

### 4.3 前端 client（`web-viewer-sample/src/console/coordinatorClient.ts`）

- `IfcReadyListItem`（98-112）補 `conversion_job_id: string | null`（wire 已有；補型別讓 `#conv` 可讀）。
- 新增 `conversionQualityMetrics: (conversionJobId) => jsonGet<ConversionQualityMetricsResponse>(\`/api/conversions/${encodeURIComponent(conversionJobId)}/quality-metrics\`)`（mirror 既有 `streamConfig` 寫法 148）。
- 新增回應型別 `ConversionQualityMetricsResponse = { conversion_job_id: string; quality_metrics_summary: ConversionQualityMetricsSummary | null; usdc_url?: string | null; mapping_url?: string | null }`。

### 4.4 前端 UI（`#conv` `ConversionSchedulingPage`，`pages.tsx:397-499`）

- ifc-ready job 表（472-496）每列加展開鈕：
  - 有 `conversion_job_id` → 可展開；展開時懶載入 `conversionQualityMetrics(job.conversion_job_id)`，渲染 coverage（沿用 `ConversionSummaryCard` 的欄位呈現風格或抽共用小元件）：coverage%（`coverage_ratio`×100 原樣，缺值「未取得」）、`coverage_status`、`mapped_count`/`unmapped_count`、`source_ifc_entity_count`、`materialization_strategy`、`conversion_duration_seconds`、usdc 輸出路徑、mapping_url。
  - 無 `conversion_job_id`（未派工/轉檔中）→ 該列顯「尚未派工 / 轉檔中」不可展開。
  - 三項拆分區塊固定顯「後端未提供（property/relationship/attribute 三項拆分為 follow-up，以 coverage_ratio 為準）」。
  - 載入中鎖 / 去重（避免重複請求同 job）；錯誤顯誠實訊息（mirror 現有 `ec-warn-note` 422-425 既例）。
- 移除 `pages.tsx:427` 的 `prov="p1"` 佔位 Field（改由展開抽屜呈現真資料）。

### 4.5 資料流（一句話版）

`#conv` 讀 `listIfcReady` → job 列（帶 `conversion_job_id`）→ 展開某列 → `GET /api/conversions/:id/quality-metrics`（coordinator → `fetchConversionResult` :49101 → `buildQualityMetricsSummary` 原樣）→ 抽屜顯真 coverage + usdc 路徑。全程後端算、前端只顯示。

## 5. 錯誤處理

| 情境 | 行為 |
|---|---|
| `conversionJobId` 不合法 | 路由回 400；前端不展開 |
| conversion job 不存在（authority 404） | 路由回 404；前端顯「找不到轉檔結果」 |
| conversion authority 連不上 / 逾時 | 路由回 502/503 + detail；前端顯誠實錯誤，**不顯任何 coverage 數字** |
| result 無 `quality_metrics`（summary=null） | 路由回 `quality_metrics_summary: null`；前端顯「未取得品質遙測」（誠實，非錯誤） |
| job 尚無 `conversion_job_id`（未派工/轉檔中） | 前端該列不可展開，顯「尚未派工 / 轉檔中」 |
| 三項拆分 | 固定顯「後端未提供」，不捏百分比 |
| coverage_ratio 缺值 | 顯「未取得」（不自算、不填 0） |
| 重複展開同 job | 去重 / 載入鎖，避免重打 |

## 6. 測試與驗收

1. **coordinator 測試**（新增 `tests/conversion-quality-metrics-route.test.ts`）：
   - 成功：mock `fetchConversionResult` 回含 `quality_metrics` → 路由回 `quality_metrics_summary`（含新 mapped/unmapped）+ usdc/mapping_url。
   - 與既有萃取一致：同一 result 經本路由與 stream-config 出來的 coverage 值相等（鎖「同一真相源、coordinator 不計算」）。
   - 邊界：非法 id→400；authority 404→404；authority throw/timeout→502/503 且 body 無 coverage 數字；無 quality_metrics→`summary:null`。
   - 回歸鎖：`host-native-conversion-ingest.test.ts:182`、`sessions.test.ts:241`、`external-ifc-ready.test.ts:255-258`（`toMatchObject` 鎖 `conversion_job_id` 在 wire 上） 形狀零退化（只新增 mapped/unmapped 兩欄）。
2. **前端 vitest**（擴充既有 `ConversionSchedulingPage.test.tsx`）：
   - job 列展開呼叫 `conversionQualityMetrics`、渲染真 coverage；coverage_ratio×100 呈現、缺值顯「未取得」（mirror `ModelInfoCard.test.tsx` 既例）。
   - 無 `conversion_job_id` 列不可展開；路由錯誤顯誠實訊息不顯數字；三項拆分顯「未提供」。
3. **Browser E2E（Playwright，`e2e/conv-coverage-report.spec.ts`）**：
   - 守門 + 檔頭 skip 限制揭露比照 `a2-version-diff-selector.spec.ts` / `minio-fileserver-source.spec.ts`。
   - `#conv` Refresh → 展開一筆已轉檔 job → 斷言抽屜出現真 `coverage_ratio`（×100）+ status + mapped/unmapped + usdc 路徑 → 截圖。
   - 截圖 + summary 落 `artifacts/e2e/conv-coverage-report-*` 與 tracked `docs/evidence/conv-coverage-report/`。
4. **驗收基準**：coordinator 測試 + 前端 vitest + E2E 全綠 + 四項回報（改動檔 / 最小驗證 / 未跑測試與原因 / 已知風險）；`#a1`/`#a2`/`#minio`/`#intake` 既有 E2E 與 stream-config 既有測試不壞（共用 `buildQualityMetricsSummary` / `IfcReadyListItem` / pages.tsx 回歸）。

## 7. 風險與緩解

- **動到 `buildQualityMetricsSummary`（stream-config 共用函式）回歸風險**：緩解 = 純 additive（只加 mapped/unmapped 兩 optional 欄），先跑 GitNexus impact（`buildQualityMetricsSummary` + `ConversionQualityMetricsSummary` + `summarizeIfcReadyJob`），既有 forwarding 測試當回歸網；commit 前 `gitnexus_detect_changes` 驗 scope 未外溢。
- **新 production 路由暴露面**：只回品質摘要 + artifact URL、唯讀 GET、safe-id 驗證、錯誤不外溢內部欄位；不 dev-gate 但不暴露超出 stream-config 已公開的同類資料。
- **誠實鐵律**：三項拆分顯「未提供」不捏值；coverage 全程後端原樣、前端零計算；錯誤路徑零假數據；E2E 必須展開看到真 coverage（非 mock），對齊 A1–A10 operability 與 gstack 證據規約。
- **跨 repo 邊界**：本輪改動限 `bim-review-coordinator`（新路由 + summary additive）與 `web-viewer-sample`（client + #conv UI）；不碰 `bim-streaming-server`（轉檔引擎），符合 web-viewer 「不直連 :49101、一律經 coordinator」邊界。
- **不在 main 開發**：branch → PR → Actions → merge；PR 描述列改動檔與最小驗證。spec 落 `docs/superpowers/specs/`，接 `writing-plans` → `spec-to-done` 執行。

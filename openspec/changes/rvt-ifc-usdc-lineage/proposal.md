> Thaw 紀錄：2026-07-21 依使用者裁決（NOW 軌0 OQ-1）deferred；2026-08-19 使用者明確採納 owner 裁決 R-2026-08-19（命中原解凍條件「使用者明確 thaw」）→ thaw 為 active（切片制）。切片：L1 = tasks 2.1–2.7（contract fixtures → `tests/contracts/`，不接 runtime、不動 legacy path）；L2 = tasks 1.2/1.3（compatibility matrix＋五個既有 spec 的 MODIFIED deltas＋strict validate）；**L2 完成前不得進行 3.x runtime 接線**。「禁止一次性整案 apply」原則保留。

> **Historical correction 2026-07-24**：本 change 曾以 `--skip-specs` 誤作 completed archive；現因 tasks 僅 1/48 完成而恢復原 change id。〔2026-08-19 R-2026-08-19 更新：本段原「解凍前 MUST 先完成 predecessor closeout 調和」的**順序性**要求已由 owner 裁決降級——`align-frontend-design-system-reference` archive 與 `migrate-console-to-hifi-design` closeout 不再擋本 change coding，兩線平行進行。衝突面硬約束保留：本 change 不得重建 `align` 目錄、不得重複宣告其 delta、不得動 `docs/plans/*.html` 唯一 authority 裁決、不得把衝突 authority 一起 archive；shared-ownership 調和（tasks 1.3）仍是 3.x runtime 接線的前置。〕

## Why

目前 repo 已正式描述 IFC-ready intake、IFC→USDC conversion 與 `IFC GlobalId ↔ USD prim path`，但尚未把 2026-07-14～07-15 定案的 MinIO version bundle、`schedule.csv` RVT identity、三向 alignment、result publication、attempt/runtime admission 與治理操作收斂成可執行契約。缺少這層契約會讓同一版本的 RVT、IFC、USDC 與 mapping/report 各自成功，卻無法證明它們屬於同一條可稽核 lineage；現有legacy workflow callback也沒有versioned Cloud Ingest、HMAC、commit ACK、health history或「cloud只存result locator＋summary」的MySQL邊界。

## What Changes

- 定義 governed MinIO source bundle：`model.rvt`、`schedule.csv`、`model.ifc` 與最後發布的 `manifest.json`；本地檔案只可作可重建 cache/fixture。
- 定義 `schedule.csv.ID` 為 version-scoped RVT element ID，並以 `schedule.csv.IfcGUID` UUID36 與 IFC GlobalId22 的可逆編碼串接既有 stable USD element root prim。
- 分開定義 `ifc_usdc_coverage_ratio`、`rvt_ifc_alignment_ratio` 與 `rvt_ifc_usdc_lineage_ratio`；固定分母並輸出 CSV-only、IFC-only、USDC-unmapped、duplicate、invalid 差異集合與 CSV/JSON 報告。
- **BREAKING**：governed production bundle 只有在 source `manifest.json` 最後發布並通過 integrity 驗證後才可進入 `READY`；未受治理的既有 bundle 只能標為 `LEGACY_UNMANAGED`，經明確 preview/confirm 流程升格。
- 由 coordinator 擁有 stable logical `pipeline_job_id` 與 durable orchestration state，由 streaming authority 配置 immutable `attempt_id` 並執行 conversion；capacity wait 不消耗 attempt，publish interruption 在同一 attempt 冪等續傳，semantic-invalid input 必須以新 source bundle／job 修正。
- 定義正式 derived result 先上傳 USDC、mapping、alignment/quality sidecars，最後發布 `result-manifest.json`；只有 manifest 完整且 refs/checksums 通過才是 `AVAILABLE`。
- 定義 active result、compare、promote、rollback、append-only audit 與 retention；後續成功 attempt 不得靜默取代 active result。
- 所有 conversion profile 與 retry 都必須通過 runtime admission；Kit release 先 cooperative drain，force release 需理由、確認、capability 與 audit，且不得自動終止正在服務使用者的 Kit。
- 增加獨立 lineage governance UI contract；所有 design gate 以 Git-tracked `docs/plans/*.html` 為標準，manifest/goldens 只能是可重現的衍生驗證產物。HTML 尚無對應 screen/state 時必須標 `reference_missing`。
- 增加 **Cloud Ingest API** contract：`edge bim-review-coordinator → external company-cloud bim-control → cloud MySQL`。只有 integrity-valid formal result 才發布 stable MinIO 結果位置與輕量摘要；完整 mapping、alignment/diff rows 與大檔仍留在 edge MinIO。此 API 與既有 workflow callback、producer intake、browser API 完全分離。
- 在既有 `#/pipeline` Callback Outbox surface 增加唯讀文字狀態欄，顯示 `未啟用／待送／重試中／已登錄／待人工處理／衝突`；不新增 page、route、visual component 或 production frontend 實作。

## Capabilities

### New Capabilities

- `minio-model-version-bundle`: 定義 MinIO source bundle、manifest-first/publish-last、integrity、immutable version 與 legacy enrollment。
- `rvt-ifc-usdc-lineage`: 定義 RVT ID、UUID36、IFC GlobalId22、stable USD root prim、alignment metrics 與差異報告。
- `conversion-attempt-publication`: 定義 stable pipeline job、immutable attempts、result-manifest publication、正交 outcome/publication/selection states、read-only compare、active result、promote/rollback 與 retention。
- `conversion-runtime-admission`: 定義 conversion admission、capacity wait、runtime lease/readiness 與 cooperative/force release。
- `lineage-governance-console`: 定義 Version Overview、Artifacts、Alignment、Attempts、Audit、下載與 capability-gated actions。
- `cloud-lineage-publication`: 定義 edge-to-cloud lineage result locator/summary publication、HMAC、idempotent ACK、durable outbox/reconciliation、health events、外部 cloud MySQL logical model 與既有 Outbox 的文字狀態。

### Modified Capabilities

- 本 lineage proposal現階段不宣告active predecessor canonical capabilities的MODIFIED delta。本PR另含`align-frontend-design-system-reference` change本身的contract repair，精確涵蓋`agent-operability-governance`、`demo-fast-mvp-orchestration`、`documentation-source-of-truth`與`unified-governance-console`；這四組delta只由`align` change擁有、獨立strict validate並隨`align` archive，不屬於lineage archive scope。同一PR不代表兩個OpenSpec changes共用ownership。
- Predecessor closeout 後，implementation 開始前 MUST 對其他受影響 canonical capabilities補上lineage-owned MODIFIED deltas並重新 strict validate；不得只接線 code 而留下 legacy watcher、local-ready、in-memory queue 或 local-style callback 成為第二套正式契約。

## Impact

- **所屬目錄／服務**：`bim-review-coordinator` 負責 intake、minimal shadow、stable logical job、durable orchestration/admission state、active-result pointer/audit與 browser-facing API；`bim-streaming-server` 負責 immutable attempt、IFC→USDC execution、mapping、derived result contents 與 result manifest；`web-viewer-sample` 負責 lineage governance UI；Kit Manager 只提供 runtime release/telemetry，不取得 conversion authority。`governance-service`維持既有A1/A2/A3 rule-run／diff／federation與issue/BCF loopback authority，但不擁有lineage orchestration、external capability/RBAC decision、active-result pointer或Cloud Ingest。
- **保留的外部邊界**：外部客戶落地端 IFC Worker 仍是 RVT/IFC export producer；外部公司雲端 `bim-control` 仍擁有 tenant、project/model-version、RBAC、enterprise workflow 與 cloud MySQL write authority。Edge 不直接連 MySQL、不保存 cloud DB credentials、不把 company database mirror 到本地。MinIO manifest 只擁有 edge artifact bytes 與 bundle lineage，不取代 cloud authority。本 change 不復活 `_worker`、`_bim-control`、`_conversion-service` 或 `_s3_storage` runtime。
- **Active predecessor的整合順序**：目前 active MinIO intake changes、`align-frontend-design-system-reference` 與最新 main 的 `migrate-console-to-hifi-design` 已佔用相關 capability／HTML／baseline ownership；本 change 不平行修改它們的 production UI 或 derived evidence。先獨立strict validate／archive `align`並確認上述四組canonical specs落地，再完成`migrate` rebase並撤銷／調和任何 repo 外 origin 或 `VerifyOrigin` 平行權威 → `migrate` closeout → lineage rebase。Lineage rebase不得重建`align` change目錄或重複宣告其delta。`docs/plans/*.html` 始終是唯一 design authority；後續 apply 才依本 change 的新 capabilities 接線。
- **資料／API／儲存影響**：後續 apply 會新增 additive `POST /api/external/source-bundles/ready`、versioned manifests、alignment/report schemas、attempt/result identities、capability checks，以及獨立的 external `POST /api/v1/lineage-publications` client contract。既有 `/api/external/ifc-ready`、`conversion_result_ready|conversion_failed` workflow callback、coordinator-only browser boundary均保持不變。Cloud MySQL 只保存 formal result locators、摘要與 append-only receipt/health history，不保存逐 element lineage rows。
- **安全／傳送影響**：lineage publication 使用 server-side-only HTTPS target 與 HMAC-SHA256、at-least-once durable outbox、strict ACK/idempotency/conflict semantics。Local/dev 可 disabled；production `required` 缺安全設定時 startup fail closed，但 cloud ACK 不阻擋 edge `READY`／`AVAILABLE`。
- **Contract-only完成邊界**：本階段交付 versioned JSON Schema、valid/invalid examples、HMAC/ACK/error/health rules、reference-only MySQL 8 DDL 與 tracked HTML 文字契約；不包含 external cloud repo migration、真實 MySQL 寫入、production publisher/frontend 或 live E2E 完成宣稱。
- **Runtime影響**：不綁死 queue engine、service topology、port 或 deployment profile；只固定可恢復、冪等、admission 與 audit 行為。
- **非目標**：本 proposal 不實作 Revit exporter、不建立／部署 external cloud control-plane 或 cloud MySQL migration、不修改真實 credentials、不上傳或複製逐 element lineage rows到 cloud、不把 live WebRTC/GPU frame 納入 pixel gate，也不宣稱 lineage runtime、真實 cloud persistence 或 design fidelity 已完成。

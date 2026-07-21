# a1-lineage-crosscheck-view Specification

## Purpose
TBD - created by archiving change viewer-redesign. Update Purpose after archive.
## Requirements
### Requirement: A1 Dock SHALL 提供治理摘要卡（雙層呈現的第一層）

A1 Dock SHALL 顯示當前 model version 的治理摘要卡：三個 ratio（`ifc_usdc_coverage_ratio`、`rvt_ifc_alignment_ratio`、`rvt_ifc_usdc_lineage_ratio`）各含 numerator/denominator/status、coverage_status、lineage outbox 狀態 badge（六態中文對照：未啟用/待送/重試中/已登錄/待人工處理/衝突）。denominator=0 SHALL 顯示 `not_evaluable`，MUST NOT 顯示 0% 或 100%。摘要卡 SHALL 提供「開啟交叉比對」動作導向 `#lineage`。後端未接通的軸 SHALL 標 `NOT_BUILT`，MUST NOT 以 fixture 數字冒充。

#### Scenario: RVT 軸未落地時的誠實顯示

- **WHEN** 後端尚未實作 RVT/schedule.csv 收檔與 alignment 計算（現況）
- **THEN** 摘要卡 SHALL 只以真值顯示 IFC↔USDC 軸（既有 quality-metrics），RVT 軸與三向 ratio SHALL 標 `NOT_BUILT`
- **AND** MUST NOT 模擬 production success

### Requirement: #lineage 頁 SHALL 以五 surfaces 呈現 rvt↔ifc↔usdc 交叉比對

新 hash 頁 `#lineage` SHALL 呈現五 surfaces（對齊 `lineage-governance-console`）：Version Overview（source bundle、active result、三 ratios、warning state）、Artifacts（result refs + 短效 presigned 下載）、Alignment（KPI + 三欄對帳表 + diff 篩選）、Attempts（admission/attempt/publication/diagnostics）、Audit（promote/rollback/release transitions）。Alignment 對帳表 SHALL 以三欄呈現 RVT row（schedule.csv.ID）↔ IFC guid ↔ USD prim，逐列標示歸屬集合（matched/csv-only/ifc-only/usdc-unmapped/duplicate/invalid），並提供對應 filter 與 10 fixed counts 顯示。資料 SHALL 全部來自 coordinator-only API；UI MUST NOT 自行推導或成為 domain authority。

#### Scenario: Alignment 檢視

- **WHEN** operator（具 `alignment.read`）開啟 `#lineage` 的 Alignment surface
- **THEN** UI SHALL 顯示三 ratio KPI（各含 numerator/denominator/status）、10 fixed counts 與可篩選對帳表
- **AND** 任一 denominator=0 的 ratio SHALL 顯示 `not_evaluable`

#### Scenario: capability 缺失 fail-closed

- **WHEN** 使用者缺 `alignment.read` 或 capability decision 無法取得
- **THEN** 對應 surface SHALL 顯示 `authorization_unavailable` 並拒絕資料載入
- **AND** MUST NOT 以 cached stale decision 樂觀顯示

### Requirement: 對帳鍵 SHALL 以 MinIO 唯一來源貫穿

交叉比對的所有軸 SHALL 以 MinIO object 為唯一來源對帳：`source_ifc`（`*/model.ifc`）、`parsed_usdc`（Phase 2 回填 `usdc_key`）、planned `model.rvt` + `schedule.csv`（bundle 落地後）；對帳鍵 SHALL 使用 `idempotency_key（mw_<hash16>）` + `external_model_version_id` + `project_id/category`。cloud 側 SHALL 只存 result locator + 輕量摘要（§01 鐵律 1）；逐 element mapping/alignment rows/大檔 SHALL 只存在 edge MinIO。

#### Scenario: 版本對帳

- **WHEN** 使用者在 `#lineage` 選擇某 model version
- **THEN** 三軸資料 SHALL 全部以同一 `mw_<hash16>`/`external_model_version_id` 對齊
- **AND** 任一軸 object 缺失 SHALL 如實顯示缺失而非沿用他版資料

### Requirement: Alignment 列 SHALL 與共用 viewport 聯動且沿用 mapping 鐵律

Alignment 表中具 `usd_prim_path` 的列 SHALL 可觸發共用 viewport 的 highlight/focus（經 vg01 橋）；`usd_prim_path` 缺失/null 的列 SHALL disabled 且 MUST NOT 發出 highlightPrimsRequest（§06 ElementMapping 既有鐵律）。viewport 未啟動或證據鏈未齊（lease+first_frame+DataChannel ready+stage matched）時，聯動動作 SHALL 誠實 disabled 並顯示原因。

#### Scenario: unmapped 列不可高亮

- **WHEN** 某列的 usd_prim_path 為 null（IFC↔USDC unmapped）
- **THEN** 該列的 3D 高亮動作 SHALL disabled 並標示 unmapped
- **AND** MUST NOT 以 fallback path 偽高亮

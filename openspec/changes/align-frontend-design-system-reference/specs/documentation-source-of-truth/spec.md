## RENAMED Requirements

- FROM: `### Requirement: Workflow v3 and product design artifacts have distinct, non-overlapping authority`
- TO: `### Requirement: Workflow v4 與產品設計產物的權威範圍明確分離且不重疊`
- FROM: `### Requirement: workflow v3 與 product design artifacts 互相 cross-reference 持續成立`
- TO: `### Requirement: workflow v4 與 product design artifacts 互相 cross-reference 持續成立`

## MODIFIED Requirements

### Requirement: Workflow v4 與產品設計產物的權威範圍明確分離且不重疊

`docs/PROJECT_DEVELOPMENT_WORKFLOW.md`（workflow v4）與 `docs/plans/docs-plans-README.md` 導向的設計與規格正本 SHALL 維持互補不替代的分工，且需求權威序 SHALL 為 **doc-first**：`docs/plans` 設計正本（`AI-BIM 前後端設計文件.dc.html` §01 服務邊界／§02 部署拓撲／§03 前端架構 IA／§04 API 契約／§05 時序圖／§06 資料模型／§07 實作分期／§08 AI Coding 交付守則、`AI-BIM Console Hi-Fi.dc.html` 產品樣貌、`docs-plans-README.md` 導覽）是**唯一需求權威**。當 runtime code 行為偏離設計正本時，該偏離 SHALL 判為待修 implementation gap（要排修的工作），SHALL NOT 被解讀為「文件錯」而反向改寫正本遷就 code（舊「以 code＋tests 為現況權威、書面需求列後序」的權威排序已由 doc-first canon v2 刪除）。

Manifest、route inventory、semantic cases、goldens 與 CI results SHALL 只是自 tracked `docs/plans/*.html` 派生、可重建、可回溯的 validation artifacts（HTML-derived derivatives），SHALL NOT 新增、覆寫或凍結正本未定義的設計需求，亦 SHALL NOT 成為另一份需求正本。repo 外 design workspace、已刪舊檔與 arbitrary screenshot SHALL NOT 成為 parallel authority。

內部裁決序 SHALL 為：前端視覺／互動以 `AI-BIM Console Hi-Fi.dc.html` ＋ `ai-bim-governance.css`（`--ab-*` token）為最高；行為／契約／邊界以設計文件 §01–§08 為權威；Prompt Board／場景圖僅為視覺上下文；跨域衝突（原型演了正本沒列的 API）依 R2 三態處理，不臆造後端。workflow v4 是開發流程入口，MUST 只 cross-reference，不得改寫需求或 runtime 現況。

誠實鐵律半句 SHALL 原樣保留：**任何文件不得反向覆蓋 runtime 現況陳述，亦不得以文件宣稱 runtime 已完成**；「標 planned」（誠實揭露未實作）與「判待修 gap」（doc-first 排修義務）兩義務 SHALL 同時成立、彼此不矛盾。runtime 建成現況 SHALL 以 code＋tests/contracts 直接查證（作為現況證據，非需求權威）。

#### Scenario: 讀者尋找開發流程

- **WHEN** 工程師想了解七層架構、Phase 脈絡、驗證證據分層、PR Checklist、服務測試命令或核心資料流
- **THEN** 應從 `docs/PROJECT_DEVELOPMENT_WORKFLOW.md` 進入
- **AND** plans 設計文件、原型與衍生 design snapshot SHALL NOT 重述或覆寫完整開發流程

#### Scenario: 讀者尋找需求、現況或操作原型

- **WHEN** 工程師想確認 A1–A10 需求、canonical route、頁面操作、建成狀態、工作排序或 console/viewer 樣貌
- **THEN** 應從 `docs/plans/docs-plans-README.md` 進入並依 ownership 讀設計文件 §01–§08（doc-first：正本即唯一需求權威）
- **AND** console 樣貌 SHALL 以 `AI-BIM Console Hi-Fi.dc.html` 為錨；建成**現況** SHALL 以 code＋tests/evidence 查證（現況證據，非需求權威）；golden 存在、spec 完成或 gate infrastructure 完成 SHALL NOT 推定 product pass
- **AND** production 2D design coverage SHALL 由可回溯至 tracked HTML 的 `route_inventory[]`／screens 驗證，semantic/pixel result SHALL 由 branch-protected current-checkout Playwright output＋validator 產出（design fidelity 檢核結果，非需求權威）
- **AND** workflow v4 MUST 只 cross-reference，不得改寫需求或 runtime 現況

#### Scenario: workflow 與設計文件或 runtime truth 不一致

- **WHEN** workflow v4、設計文件/原型、manifest／golden 或 runtime code 描述同一 user-facing 需求且不一致
- **THEN** 設計文件/原型為**唯一需求權威**（doc-first）；manifest／golden 若無法重建為 tracked HTML 的忠實衍生物 SHALL 被拒絕並標 stale derivative 重建
- **AND** runtime 現況 SHALL 以 code＋tests/contracts 驗證，任何文件不得反向覆蓋 runtime，亦不得以文件宣稱 runtime 已完成；HTML demo data SHALL NOT 覆寫 runtime 現況陳述；不得以其中一層虛構另一層已完成
- **AND** code 行為偏離正本時 SHALL 判為待修 implementation gap（見「code 行為與設計正本衝突（doc-first 判 gap）」scenario），MUST NOT 反向改寫正本

#### Scenario: code 行為與設計正本衝突（doc-first 判 gap）

- **WHEN** runtime code 行為與正本 §01–§08 描述的同一 user-facing 需求衝突，且該條未列入保存性 carve-out 清單
- **THEN** 該偏離 SHALL 判為 implementation gap 並進 gap ledger 排修
- **AND** MUST NOT 反向改寫正本遷就 code；亦 MUST NOT 依舊「以程式碼為準、不回頭改碼」carve-out 主張正本永不修

#### Scenario: 誠實鐵律與 doc-first 非矛盾壓測

- **WHEN** 正本列了一條 planned 需求而 runtime 尚未實作
- **THEN** 文件 SHALL 標 planned（誠實，不宣稱已完成）
- **AND** 該項 SHALL 同時為待修 gap（doc-first 排修義務）；兩義務並存、無衝突

### Requirement: workflow v4 與 product design artifacts 互相 cross-reference 持續成立

`docs/PROJECT_DEVELOPMENT_WORKFLOW.md` 頂部 metadata 與 source-of-truth 表 SHALL 連到 `docs/plans/docs-plans-README.md` 與設計文件/原型；`README.md` 的產品文件入口 SHALL 列出相同 ownership（doc-first：tracked `docs/plans` 正本＝唯一需求權威、manifest/baselines＝HTML-derived derivatives、code＋tests＝runtime 現況查證面而非需求權威）。active agent workflows／OpenSpec deltas／demo docs SHALL NOT 讀取已刪除的舊正本（含 2026-07-13 刪除的六份舊檔與 2026-07-15 刪除的七檔體系/saas/審批報告/舊 prototypes），亦 SHALL NOT 依賴 repo 外 design path 作為 design gate source。

#### Scenario: active consumer 指向被刪舊正本

- **WHEN** active README、workflow、skill、OpenSpec delta、demo doc、script 或 CI 引用任一已刪舊正本檔名，或把 repo 外 design path 當 design gate source
- **THEN** change MUST 被阻擋直到引用改指 tracked 正本或正確 owning source
- **AND** 歷史 archive/evidence MAY 保留舊引用並明標 historical；`docs-plans-README.md` §4 救援表 SHALL 提供舊檔去向

#### Scenario: 設計文件與原型保持可發現

- **WHEN** 讀者從 README、workflow v4 或 plans entry 尋找產品規格、樣貌與 gate evidence
- **THEN** `AI-BIM 前後端設計文件.dc.html` 與 `AI-BIM Console Hi-Fi.dc.html` SHALL 都可被發現並開啟（連網載入 React CDN），由其派生的 manifest/baselines SHALL 可發現
- **AND** manifest/baselines SHALL 記錄 source paths/hashes 並明標 derived
- **AND** 不得把 generated HTML 或 machine supporting artifacts 當另一份 requirement source

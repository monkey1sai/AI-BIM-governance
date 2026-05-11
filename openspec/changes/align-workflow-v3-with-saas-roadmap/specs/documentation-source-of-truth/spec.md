## ADDED Requirements

### Requirement: Workflow v3 and SaaS roadmap have distinct, non-overlapping authority

`docs/PROJECT_DEVELOPMENT_WORKFLOW.md`（workflow v3）與 `docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md`（SaaS 路線圖）SHALL 維持互補不替代的分工：workflow v3 是「開發流程入口」（七層架構、Phase 完成度、驗證證據 4 層分級、IFC→USD 品質管線 7 步、開發協作流程、PR Checklist、服務測試命令、核心資料流 sequence diagram），SaaS 路線圖是「OpenSpec 候選 / NVIDIA Reference 採用決策 / §11.4 Multi-Kit Instance 並行官方定義 / 硬體配置 / MCP 查詢結果」的權威。

#### Scenario: 讀者尋找開發流程

- **WHEN** 工程師想了解七層架構、Phase 完成度、驗證證據分層、PR Checklist、服務測試命令或核心資料流 sequence diagram
- **THEN** 應該從 `docs/PROJECT_DEVELOPMENT_WORKFLOW.md` 進入；SaaS 路線圖 MUST 不重述這些內容

#### Scenario: 讀者尋找 OpenSpec 候選編號或 NVIDIA 採用決策

- **WHEN** 工程師想確認 OpenSpec 候選 #1-#9 / #1A / #2A 的精確 spec id、KPI、§13 NVIDIA Reference 採用決策、§11.4 Multi-Kit Instance 並行的官方定義、§9.0-§9.8 硬體配置或 §11 MCP 查詢結果
- **THEN** 應該從 `docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md` 進入；workflow v3 MUST 不重述這些內容，只能 cross-reference

#### Scenario: 兩份文件在同一主題（如 Phase 3 狀態、候選命名）出現不一致

- **WHEN** workflow v3 與 SaaS 路線圖描述同一主題且兩者不一致
- **THEN** roadmap 為 OpenSpec 候選命名與技術決策的權威；workflow v3 必須以對應 OpenSpec change 對齊 roadmap，不能反向覆蓋

### Requirement: 文件分工調整必須走 OpenSpec change

任何對 workflow v3 與 SaaS 路線圖之間分工的調整（例如把某類內容從 workflow v3 移到 roadmap，或反之）SHALL 透過 OpenSpec change 流程處理，不直接在 `main` 上 commit。

#### Scenario: 把流程內容從 roadmap 移到 workflow v3

- **WHEN** 有人提議把某段內容從 roadmap 搬到 workflow v3（或反向）
- **THEN** 必須新建 OpenSpec change（branch `codex/openspec/<change-id>`），提出 proposal + tasks 並走 PR review + GitHub Actions 驗證，merge 後 archive

#### Scenario: 對 README.md 的「核心文件入口」段做結構性修改

- **WHEN** 有人提議調整 `README.md` 中「核心文件入口」段的文件列表、角色定義或閱讀順序
- **THEN** 必須走 OpenSpec change 流程，不直接在 main 上修改該段；單純的拼字修正或 url 校正例外

### Requirement: workflow v3 與 roadmap 互相 cross-reference 持續成立

`docs/PROJECT_DEVELOPMENT_WORKFLOW.md` 頂部 metadata 與 §10 source-of-truth 表格 SHALL 包含指向 `docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md` 的可開啟連結；`docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md` §1 SHALL 包含指向 `docs/PROJECT_DEVELOPMENT_WORKFLOW.md` 的可開啟連結。`README.md` 「核心文件入口」段 SHALL 同時列出兩者並描述各自角色。

#### Scenario: cross-reference 被誤刪

- **WHEN** PR 修改了 workflow v3 頂部 metadata、§10 表格、roadmap §1 引言段，或 README.md 「核心文件入口」段而導致雙向 cross-reference 不再成立
- **THEN** review 必須要求補回 cross-reference 才能 merge；或必須附對應 OpenSpec change 說明為何要改變分工

## ADDED Requirements

### Requirement: R-A1 手寫正本寫入授權邊界（AI 只能提案）

手寫正本面（`docs/plans/AI-BIM 前後端設計文件.dc.html`、`docs/plans/AI-BIM Console Hi-Fi.dc.html`、`docs/plans/docs-plans-README.md`、`docs/plans/ai-bim-governance.css`）SHALL 為使用者專屬。AI MUST NOT 直接編輯這些檔案；任何改寫 SHALL 僅以獨立提案（PR diff／OpenSpec change）形式提交改寫文字供使用者審，且 AI MUST NOT 自行 merge 該提案。

#### Scenario: AI 產生對手寫正本的改寫

- **WHEN** AI 在任何任務中產生對手寫正本面任一檔案的改寫
- **THEN** 產出形式 MUST 為提案文字（PR diff 供審、不自行 merge），且 PR 描述 MUST 明示「待使用者核准」
- **AND** AI MUST NOT 對這些檔案直接執行原地 Edit/Write

#### Scenario: 提案順帶包含誤字或斷鏈修正

- **WHEN** 一個手寫正本提案 PR 順帶包含誤字或斷鏈（dead-link）修正
- **THEN** PR 描述 MUST 以獨立段落逐項揭露該類順帶修正，不得與主改寫混列

#### Scenario: 手寫正本提案 PR 在無使用者核准紀錄下被 merge

- **WHEN** 一個觸及手寫正本面的提案 PR 在無使用者核准紀錄（human approval／PR approve）下被 merge（含 AI 自行 merge）
- **THEN** 該 merge MUST 視為治理違規，並要求立即 revert 回改寫前狀態、升級（escalate）給使用者裁決後才可重新提案

#### Scenario: PR diff 直接觸及手寫正本檔本身內容

- **WHEN** 任一 PR 的 diff 直接觸及手寫正本面 4 檔任一者本身內容（而非以獨立提案／草稿檔形式提交改寫文字）
- **THEN** 該 PR MUST 視為違規並退回（唯一合法路徑＝R-A1 提案流程）

### Requirement: R-A2 機器快照面寫入路徑限定（雙旗標）

機器快照面（`docs/plans/design-system-reference.manifest.json` 與 `docs/plans/design-system-baseline/**`）SHALL 只由 `capture-design-system-reference.mjs` 帶 `--rebaseline --confirm-rebaseline` 雙旗標寫入。任何以其他方式（手改、單旗標、AI 直接編輯）觸及快照面的變更 SHALL 視為違規。

#### Scenario: PR diff 觸及快照面但缺雙旗標證據

- **WHEN** 任一 PR 的 diff 觸及機器快照面，而 PR 描述未附 `--rebaseline --confirm-rebaseline` 雙旗標執行證據
- **THEN** 該 PR MUST 視為違規並退回

### Requirement: R-A3 support.js 生成物永不手改

`support.js` SHALL 被視為 repo 外 dc-runtime 生成物，MUST NOT 被手改。任何需要的 `support.js` 行為變更 SHALL 走 dc-runtime 上游，repo 內只接收再生成結果。

#### Scenario: 需要 support.js 行為變更

- **WHEN** 有人需要改變 `support.js` 的行為
- **THEN** 變更 MUST 走 dc-runtime 上游再生成，repo 內 MUST NOT 直接編輯 `support.js`

#### Scenario: PR diff 觸及 support.js 但缺 dc-runtime 上游佐證

- **WHEN** 任一 PR 的 diff 觸及 `support.js`，而 PR 描述未附 dc-runtime 上游再生成佐證
- **THEN** 該 PR MUST 視為違規並退回

### Requirement: R-A4 改版可回復性（一步 restore + dry-run 驗證）

正本改版 SHALL bump 版本號＋日期（版本語意借 SemVer 2.0.0 類比，非引入完整標準機器）；改寫前 SHALL 建立可回復基準（以 git tag 或文件樹外 `.bak-<timestamp>` 留存並回報路徑）；使用者裁決退回時 SHALL 可依記錄的 backup path/tag 一步 restore 到改寫前版本。本 change 交付前 SHALL 以一次 dry-run restore 坐實此回復契約。

#### Scenario: 使用者對 v2 草稿裁決退回

- **WHEN** 使用者對正本 v2 草稿裁決「退回」
- **THEN** MUST 可依記錄的 backup path/tag 一步還原，且 restore 後對應正本檔的 diff 為空
- **AND** 本 change 交付前 MUST 以一次 dry-run restore 驗證此回復契約可用（避免退回時才發現備份不可用）

#### Scenario: 正本被採納

- **WHEN** 正本 v2 被使用者核准並落地
- **THEN** 正本 MUST 帶新的版本號＋日期 bump（相對前一版可辨識），且 backup path/tag 已記錄於交付說明

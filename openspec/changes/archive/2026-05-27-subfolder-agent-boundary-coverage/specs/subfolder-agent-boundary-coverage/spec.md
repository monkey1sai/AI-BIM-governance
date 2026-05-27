# subfolder-agent-boundary-coverage Specification

## ADDED Requirements

### Requirement: 每個 agent 經常觸碰的 sub-folder SHALL 提供 repo-local AGENTS.md

Workspace 內被 agent 經常觸碰的頂層 sub-folder SHALL 提供 repo-local `AGENTS.md`，作為 agent 進到該 folder 工作時的第一個 anchor。涵蓋範圍：`scripts/`、`tests/`、`docs/`、`apps/kit-manager-web/`、`infra/`、`openspec/`，以及既有的三個 sub-repo（`bim-review-coordinator/`、`bim-streaming-server/`、`web-viewer-sample/`）。每份 SHALL 採用以下七段 schema：

1. Role — 一段話，定位該 folder 在 workspace 的角色
2. Owns — 條列，明列該 folder 擁有的責任 / 產物 / 權威
3. Does Not Own — 條列，明確排除的責任
4. Required Boundaries — MUST / MUST NOT 條列
5. Before Editing — 先讀什麼、檢查什麼
6. Verify — 最小驗證指令（一條 command）
7. Done Criteria — 回報必含項

#### Scenario: Agent 進到 scripts/ 編輯 deploy 腳本

- **WHEN** agent 進到 `scripts/` 修改 `deploy.ps1`
- **THEN** `scripts/AGENTS.md` MUST 存在
- **AND** 該檔 MUST 包含七段 schema 全部段落
- **AND** "Verify" 段 MUST 提供可執行的最小驗證指令

#### Scenario: Sub-folder AGENTS.md 缺七段中任何一段

- **WHEN** PR 加入或修改 sub-folder `AGENTS.md` 但缺其中一段（例如缺 "Does Not Own"）
- **THEN** review MUST 要求補齊七段
- **AND** MUST NOT 以「該 folder 沒有限制」為由略過 "Does Not Own"

### Requirement: Sub-folder AGENTS.md SHALL 不超過 100 行

每份 sub-folder `AGENTS.md` SHALL ≤ 100 行（目標 ≤ 80 行）。行數以 LF 行尾 + `wc -l` 為準。超過時 SHALL 將細節下放到根目錄 `docs/agents/*.md` sub-file，或在 PR 描述附 OpenSpec change 說明放寬閘門理由。

#### Scenario: Sub-folder AGENTS.md 超過 100 行

- **WHEN** PR 在 merge 前 `wc -l <folder>/AGENTS.md` 回傳 > 100
- **THEN** review MUST 要求拆分到根目錄 `docs/agents/*.md` 或附 OpenSpec change

#### Scenario: 純 link 修正不觸發閘門

- **WHEN** PR 只修正 sub-folder AGENTS.md 內 link 路徑或標題，總行數未超過上限
- **THEN** 閘門 PASS，無額外要求

### Requirement: Sub-folder AGENTS.md SHALL 使用 lazy-load 不 inline 重複規範

Sub-folder `AGENTS.md` SHALL NOT inline 根目錄已有的規範內容，特別是 GitNexus block、OpenSpec workflow 完整流程、B 方案 mermaid、跨 repo 邊界完整表。SHALL 改用 lazy-load 指標指向：

- 根目錄 `AGENTS.md` 與 `CLAUDE.md`
- 根目錄 `docs/agents/repo-boundary-detail.md`
- 根目錄 `docs/agents/github-workflow.md`
- 根目錄 `docs/agents/gitnexus-usage.md`
- 根目錄 `docs/agents/sub-repo-verify-commands.md`
- 根目錄 `docs/agents/history-and-archive.md`

#### Scenario: Sub-folder AGENTS.md 把 GitNexus block 整段 inline

- **WHEN** PR 在 sub-folder `AGENTS.md` inline 完整 GitNexus "Always Do / Never Do / Resources / CLI" 區塊
- **THEN** review MUST 要求改為單句指標：「修改 code symbol 前 MUST 跑 `gitnexus_impact`；完整規範見根目錄 §4」

#### Scenario: Sub-folder AGENTS.md 重述跨 repo 邊界表

- **WHEN** PR 在 sub-folder `AGENTS.md` 重述完整跨 sub-repo 資料流或權威表
- **THEN** review MUST 要求改為 link 指向 `docs/agents/repo-boundary-detail.md`

### Requirement: 每個 sub-folder AGENTS.md SHALL 配一份 ≤ 30 行的 CLAUDE.md 鏡像

每個本 spec 覆蓋的 sub-folder SHALL 提供一份 `CLAUDE.md` 鏡像入口，內容指向 sibling `AGENTS.md`。新建的 sub-folder `CLAUDE.md` SHALL ≤ 30 行；tracked sub-repo `CLAUDE.md`（無 sub-repo 級 `.gitignore` 排除者）不適用 30 行上限，但 SHALL 以 lazy-load pointer 取代與根目錄重複的 inline 規範內容（GitNexus block、跨 repo 邊界完整表）。

#### Scenario: 新 sub-folder CLAUDE.md 超過 30 行

- **WHEN** PR 在 `scripts/` 等本 spec 新增的 sub-folder 加入 CLAUDE.md，且 `wc -l` > 30
- **THEN** review MUST 要求把規則內容移到 sibling `AGENTS.md`，CLAUDE.md 只保留最小鏡像

#### Scenario: tracked sub-repo CLAUDE.md inline 完整 GitNexus block

- **WHEN** tracked sub-repo `CLAUDE.md`（例：`bim-review-coordinator/CLAUDE.md`）inline 重述根目錄已有的 GitNexus 規範區塊
- **THEN** review MUST 要求改為單句指標：「修改 code symbol 前 MUST 跑 `gitnexus_impact`；完整規範見根目錄 §4」

### Requirement: openspec/AGENTS.md SHALL 明寫排除 archive 子目錄

`openspec/AGENTS.md` 的 "Does Not Own" 段 SHALL 明寫排除 `openspec/changes/archive/`，避免新規範回溯約束已歸檔的 historical change。`openspec/AGENTS.md` 的 "Required Boundaries" SHALL 規定：修改 `archive/` 內檔案視為 historical correction，需獨立 PR、不受本 spec 七段 schema 與行數預算約束。

#### Scenario: PR 修改 archive 內歷史 change

- **WHEN** PR 修改 `openspec/changes/archive/<dated-change>/` 內任何檔案
- **THEN** PR 描述 MUST 標示為 historical correction
- **AND** MUST NOT 因該歷史 change 不符合新七段 schema 或行數預算而被 review 阻擋

#### Scenario: openspec validate 跑在 archive 子目錄

- **WHEN** agent 在本 repo 跑 `npx openspec validate --all`
- **THEN** validate 範圍 MUST 限於 `openspec/changes/<active>/` 與 `openspec/specs/<capability>/`
- **AND** MUST NOT 把 `openspec/AGENTS.md` 或 `openspec/CLAUDE.md` 視為 spec 或 change

### Requirement: Sub-repo CLAUDE.md 邊界由各 sub-repo .gitignore 決定

Sub-repo 級 `.gitignore` 排除 `/CLAUDE.md` 的 sub-repo（目前為 `bim-streaming-server/`、`web-viewer-sample/`），其 `CLAUDE.md` 為 local-only convenience file —— 不參與 git history、不被 PR review 約束、可由本機 `gitnexus setup` 自由覆寫。本 spec 的 lazy-load / 七段 schema / 行數預算 SHALL NOT 約束這些 local-only 檔。

未被 sub-repo 級 `.gitignore` 排除的 tracked sub-repo `CLAUDE.md`（目前為 `bim-review-coordinator/CLAUDE.md`），SHALL 適用本 spec 的 lazy-load pointer 規則：與根目錄重複的 inline 規範內容 SHALL 改為 lazy-load pointer。

#### Scenario: PR 對 .gitignored 的 sub-repo CLAUDE.md 試圖加 enforcement

- **WHEN** PR 在 review 中要求修改 `bim-streaming-server/CLAUDE.md` 或 `web-viewer-sample/CLAUDE.md`（兩者皆 .gitignored local-only）
- **THEN** review MUST 拒絕該要求；改為要求修改 sibling `AGENTS.md`（tracked source of truth）

#### Scenario: tracked sub-repo CLAUDE.md 改 lazy-load pointer 後行數仍偏高

- **WHEN** `bim-review-coordinator/CLAUDE.md` 在改成 lazy-load pointer 後仍超過 100 行
- **THEN** review SHOULD 要求把 Local Boundary Rules 細節移到 sibling `AGENTS.md` 七段 schema 內，CLAUDE.md 只保留 sibling lazy-load pointer 與最小規則

#### Scenario: 將 tracked sub-repo CLAUDE.md 改為 .gitignored

- **WHEN** PR 把 `bim-review-coordinator/CLAUDE.md` 加入 sub-repo 級 `.gitignore` 排除（變成 local-only）
- **THEN** review MUST 要求 PR 描述標示此邊界轉換
- **AND** PR MUST 同步把 boundary rules 內容遷移到 sibling tracked `AGENTS.md`，避免規則消失

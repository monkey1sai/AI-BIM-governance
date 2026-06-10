## MODIFIED Requirements

### Requirement: Root agent entrypoint files SHALL respect context budget

Repo root `AGENTS.md` 與 `CLAUDE.md` 是 agent session 啟動時自動載入的 entrypoint，其長度直接乘上每次 session 的 token 成本。兩份檔 SHALL 控制在以下行數預算：

- `AGENTS.md` SHALL 不超過 **250 行**（目標 ≤ 200 行）；
- `CLAUDE.md` SHALL 不超過 **130 行**（目標 ≤ 100 行）。

行數以 LF 行尾 + `wc -l` 為準（量 repo 追蹤檔本體；GitNexus 等工具於 session 載入時自動附加至檔尾的區塊**另計**，不在本 `wc -l` 閘門範圍內）。`CLAUDE.md` 上限自 100 放寬至 130（目標 80 → 100），係反映 GitNexus code-intelligence 區塊每次 session 自動附加（約 42 行）後的真實載入成本，並保留約 10 行 headroom；目標仍鼓勵作者本體 ≤ 100 行。任何 PR 若導致兩檔回胖超過上限，必須在 PR 描述說明原因並附對應 OpenSpec change，否則 review 應要求拆分到 `docs/agents/*.md` sub-file。

#### Scenario: PR 把 AGENTS.md 改超過 250 行

- **WHEN** 一個 PR 在 merge 前 `wc -l AGENTS.md` 回傳 > 250
- **THEN** review MUST 要求把新增內容拆到對應 `docs/agents/*.md` sub-file，或要求 PR 附 OpenSpec change 說明為何需要放寬閘門

#### Scenario: PR 把 CLAUDE.md 改超過 130 行

- **WHEN** 一個 PR 在 merge 前 `wc -l CLAUDE.md` 回傳 > 130
- **THEN** review MUST 要求把新增內容拆到對應 `docs/agents/*.md` sub-file，或附 OpenSpec change 放寬閘門

#### Scenario: 純粹的 link 修正不觸發閘門

- **WHEN** PR 只是修正 sub-file 路徑或標題、未實質新增內容，且總行數仍在上限內
- **THEN** 閘門 PASS，無額外要求

# agent-doc-context-budget Specification

## Purpose
TBD - created by archiving change slim-agents-md-auto-load. Update Purpose after archive.
## Requirements
### Requirement: Root agent entrypoint files SHALL respect context budget

Repo root `AGENTS.md` 與 `CLAUDE.md` 是 agent session 啟動時自動載入的 entrypoint，其長度直接乘上每次 session 的 token 成本。兩份檔 SHALL 控制在以下行數預算：

- `AGENTS.md` SHALL 不超過 **250 行**（目標 ≤ 200 行）；
- `CLAUDE.md` SHALL 不超過 **100 行**（目標 ≤ 80 行）。

行數以 LF 行尾 + `wc -l` 為準。任何 PR 若導致兩檔回胖超過上限，必須在 PR 描述說明原因並附對應 OpenSpec change，否則 review 應要求拆分到 `docs/agents/*.md` sub-file。

#### Scenario: PR 把 AGENTS.md 改超過 250 行

- **WHEN** 一個 PR 在 merge 前 `wc -l AGENTS.md` 回傳 > 250
- **THEN** review MUST 要求把新增內容拆到對應 `docs/agents/*.md` sub-file，或要求 PR 附 OpenSpec change 說明為何需要放寬閘門

#### Scenario: PR 把 CLAUDE.md 改超過 100 行

- **WHEN** 一個 PR 在 merge 前 `wc -l CLAUDE.md` 回傳 > 100
- **THEN** review MUST 要求把新增內容拆到對應 `docs/agents/*.md` sub-file，或附 OpenSpec change 放寬閘門

#### Scenario: 純粹的 link 修正不觸發閘門

- **WHEN** PR 只是修正 sub-file 路徑或標題、未實質新增內容，且總行數仍在上限內
- **THEN** 閘門 PASS，無額外要求

### Requirement: Root entrypoint files SHALL use lazy-load sub-files

`AGENTS.md` / `CLAUDE.md` SHALL 把以下五類細節內容放在 `docs/agents/*.md` sub-file，而不是主檔：

1. 完整 folder 結構、B 方案 mermaid、Source-of-Truth 完整表 → `docs/agents/repo-boundary-detail.md`
2. PR / branch / actions / merge / sync-archive 完整 GitHub workflow → `docs/agents/github-workflow.md`
3. GitNexus 完整規範、impact analysis SOP、skill 對應表 → `docs/agents/gitnexus-usage.md`
4. 各 sub-repo 的 `npm test` / `pytest` / `npm run verify` 細節 → `docs/agents/sub-repo-verify-commands.md`
5. 歷史 `_worker` / `_bim-control` 脈絡與退役說明 → `docs/agents/history-and-archive.md`

主檔可以保留**每類細節的「一句話摘要 + sub-file link」**，但 SHALL NOT 重述 sub-file 的完整內容。

#### Scenario: AGENTS.md 重新出現完整 mermaid 圖

- **WHEN** PR 把 B 方案閉環 mermaid 加回 `AGENTS.md` 主檔
- **THEN** review MUST 要求改為 link 指向 `docs/agents/repo-boundary-detail.md`，主檔最多保留一句話摘要

#### Scenario: 新增一類 agent 入口細節

- **WHEN** 有新類別細節（例：MCP server 設定 SOP）要加進 agent 入口
- **THEN** SHALL 在 `docs/agents/` 新建對應 sub-file（例：`docs/agents/mcp-setup.md`），並在主檔 link 表加一列；MUST NOT 直接把整段內容塞進主檔

#### Scenario: sub-file 內容變更不要求改主檔

- **WHEN** 只動 `docs/agents/<sub>.md` 內部章節
- **THEN** 主檔不必跟動；除非新增 sub-file 或 sub-file rename

### Requirement: Root entrypoint files SHALL maintain a complete sub-file index

`AGENTS.md` 與 `CLAUDE.md` SHALL 各包含一張 sub-file index 表，欄位至少為「何時需要 / 讀哪份」。index 表 SHALL 涵蓋 `docs/agents/` 之下**全部** sub-file，不能有孤兒 sub-file（存在於 `docs/agents/` 但未被任何主檔 link）。

#### Scenario: 新增 sub-file 但忘了更新主檔 index

- **WHEN** PR 在 `docs/agents/` 新增 `mcp-setup.md`，但 `AGENTS.md` 與 `CLAUDE.md` 的 index 表沒新增該列
- **THEN** review MUST 要求補上 index 列

#### Scenario: index 列指向不存在的 sub-file

- **WHEN** PR 把 `AGENTS.md` 的 index 表加上「docs/agents/X.md」但 X.md 不存在
- **THEN** review MUST 要求要嘛建立 X.md、要嘛從 index 移除

#### Scenario: 兩份主檔的 index 不一致

- **WHEN** `AGENTS.md` 的 index 列出 5 個 sub-file，但 `CLAUDE.md` 的 index 只列 3 個
- **THEN** review MUST 要求兩份主檔的 index 涵蓋同一組 sub-file（標題/描述可微調，但 sub-file 集合一致）

### Requirement: Sub-files SHALL stay single-topic and link instead of copy

`docs/agents/*.md` 每個 sub-file SHALL 對應單一主題；跨主題段落（例：「GitNexus + sub-repo verify」混合說明）SHALL 用 inline link 指向 sibling sub-file，**不得 copy**。

#### Scenario: 兩個 sub-file 出現相同段落

- **WHEN** `docs/agents/gitnexus-usage.md` 與 `docs/agents/sub-repo-verify-commands.md` 同時有「跑 `npx gitnexus analyze`」完整指令段
- **THEN** review MUST 要求其一改為 link；只能其中一份保留完整內容

#### Scenario: sub-file 自身過長

- **WHEN** 一個 `docs/agents/*.md` 超過 400 行
- **THEN** review SHOULD 提議再拆分為更細的單一主題 sub-file（非硬性要求，但需在 PR 描述評估）

### Requirement: CLAUDE.md SHALL remain a thin mirror, not a duplicate

`CLAUDE.md` SHALL 維持「Claude 鏡像入口」定位：

- MUST 在開頭聲明「本檔是 AGENTS.md 鏡像入口；衝突時以 AGENTS.md 為準」；
- MUST 包含 Claude-specific 補充（例：priority stack、完成工作必回報 4 點）；
- MUST 包含與 `AGENTS.md` 一致的 sub-file index 表；
- MAY 保留 GitNexus block（Claude Code 引用度高）；
- SHALL NOT 重述 B 方案閉環、mermaid 圖、完整 folder schema、sub-repo verify 細節（這些只留 link 到 sub-file）。

#### Scenario: CLAUDE.md 重新出現 B 方案閉環文字描述

- **WHEN** PR 把 B 方案閉環完整流程文字加回 `CLAUDE.md`
- **THEN** review MUST 要求改為 link 指向 `docs/agents/repo-boundary-detail.md`

#### Scenario: CLAUDE.md 沒有引述 AGENTS.md 為 source-of-truth

- **WHEN** PR 改寫 `CLAUDE.md` 開頭，移除「AGENTS.md 為 source-of-truth」聲明
- **THEN** review MUST 要求補回該聲明

#### Scenario: AGENTS.md 與 CLAUDE.md 規範矛盾

- **WHEN** agent 載入兩份主檔後發現某條規範矛盾（例：行為對齊 priority stack 不同）
- **THEN** agent SHALL 採用 `AGENTS.md` 版本作為 source-of-truth；PR 必須在發現矛盾時優先修正 `CLAUDE.md` 對齊 `AGENTS.md`

### Requirement: Information SHALL NOT be lost during slim-down

本 change 是「移位 + 加 link」，不是刪除。所有從 `AGENTS.md` / `CLAUDE.md` 移走的段落 SHALL 完整保留在對應 `docs/agents/*.md` sub-file，不得在搬移過程中刪除事實性內容。

#### Scenario: 搬移時誤刪某段操作細節

- **WHEN** PR 把 `AGENTS.md` 的「sub-repo verify 完整指令」段刪除但未在任何 sub-file 找到對應內容
- **THEN** review MUST 要求把該段補回 `docs/agents/sub-repo-verify-commands.md`，或附 OpenSpec change 說明為何要正式刪除（不只是搬移）

#### Scenario: 內容拆分但 link 斷掉

- **WHEN** PR 把某段內容搬到 sub-file，但主檔的 link 指向錯誤路徑（404）
- **THEN** review MUST 要求修正 link

### Requirement: Repo-local Codex skills SHALL align with Claude skills

`AI-BIM-governance/` 的 repo-local skill inventory SHALL 以 `.claude/skills/` 為本機對齊來源，並同步到 `.codex/skills/` 供 Codex session 使用。兩者都是本機 agent/tooling 產物，SHALL 維持 ignored；PR 不應提交 `.claude/skills/`、`.codex/skills/` 或 generated skill 檔本體，除非使用者明確要求改變 repo policy。

OpenSpec / opsx closed-loop skills 已退役；需求拆解、分期執行與完成驗證 SHALL 使用 Superpowers skills（`writing-plans`、`subagent-driven-development`、`verification-before-completion`）作為主線治理。`.agent/`、`.cursor/`、`.windsurf/` 不再是 opsx skill source-of-truth。

#### Scenario: `.codex/skills` 與 `.claude/skills` 不一致

- **WHEN** 本機檢查發現 `.codex/skills` 與 `.claude/skills` 的 top-level skill 名稱或檔案內容不同
- **THEN** agent MUST 先回報差異；若使用者要求同步，SHALL 以 `.claude/skills` 對齊 `.codex/skills`，並保留備份路徑

#### Scenario: PR 嘗試提交本機 skill inventory

- **WHEN** PR diff 包含 `.codex/skills/`、`.claude/skills/` 或 generated skill 本體
- **THEN** review MUST 阻擋，除非 PR 說明明確引用使用者要求改變 repo policy

#### Scenario: 文件新增退役 OpenSpec slash workflow

- **WHEN** 文件新增 `/openspec new`、`/openspec apply`、`openspec validate` 作為新開發流程
- **THEN** review MUST 要求改成 Superpowers plan / checklist / verification workflow；`openspec/specs/` 可保留為歷史或 capability artifact，但不得作為已退役 skill 的操作入口

### Requirement: Agent IDE mirror docs SHALL not reintroduce opsx source-of-truth

若 repo 未來重新加入 Cursor / Windsurf / 其他 IDE 的 skill or workflow stub，該文件 SHALL 明確標記為 IDE-specific launcher 或 compatibility note，不得把 `.agent/`、`.cursor/`、`.windsurf/` 宣告為 opsx source-of-truth，也不得複製 `.claude/skills` / `.codex/skills` 內容。

#### Scenario: `.agent/` 被重新宣告為 source-of-truth

- **WHEN** PR 文件聲稱 `.agent/` 是 opsx workflow 或 skill 的唯一 source-of-truth
- **THEN** review MUST 要求移除該聲明，改以 `AGENTS.md` + `docs/agents/*.md` + Superpowers workflow 描述開發治理

#### Scenario: IDE stub 複製 skill body

- **WHEN** PR 在 `.cursor/`、`.windsurf/` 或其他 IDE launcher 複製 `.claude/skills` / `.codex/skills` 的完整 body
- **THEN** review MUST 要求改成短 launcher / compatibility note，避免多份 skill body drift

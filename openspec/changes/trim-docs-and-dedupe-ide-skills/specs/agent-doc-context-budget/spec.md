## ADDED Requirements

### Requirement: IDE skill mirrors SHALL be stubs, not duplicates

`AI-BIM-governance/` 為了支援多種 agent IDE（Codex / Cursor / Windsurf 等），保留四套 opsx skill / workflow mirror。其中 **source-of-truth SHALL 為 `.agent/`**（IDE-neutral）。其餘 IDE-specific mirror（`.cursor/skills/`、`.cursor/commands/`、`.windsurf/skills/`、`.windsurf/workflows/`）SHALL 為 **thin stub**：保留 IDE-specific frontmatter（讓 IDE 抓得到 skill entry），body SHALL 只含一行「Stub: 內容已 dedupe 到 `.agent/<path>`」+ 指向 `.agent/` 對應檔的 relative link。

任何規範修改 SHALL 改 `.agent/` source-of-truth，不改 stub；stub 不再承載業務內容。

`.claude/skills/` 屬於 Claude-specific closed-loop 進階 skills（apply-and-verify / openspec-explore-twice / opsx-worktree-guard / opsx-worktree-provision / archive-and-closeout / pr-review-gate / change-id-resolve / gitnexus-blast-radius / closed-loop-orchestrator），SHALL NOT 視為三套 mirror 的重複層，本 requirement 不涵蓋 `.claude/skills/`。

#### Scenario: PR 在 .cursor/.windsurf 寫了大段 body 內容

- **WHEN** PR 在 `.cursor/skills/openspec-propose/SKILL.md` 或 `.windsurf/workflows/opsx-apply.md` 等 mirror 檔加入超過 5 行的業務內容
- **THEN** review MUST 要求把內容搬回 `.agent/` 對應檔，mirror 改為 stub

#### Scenario: 三套 mirror 內容不一致

- **WHEN** 對同一個 opsx skill / workflow，`.agent/`、`.cursor/`、`.windsurf/` 三份 body 內容（非 frontmatter）不一致
- **THEN** review MUST 以 `.agent/` 為準；`.cursor/` / `.windsurf/` 須改回 stub 並 link 到 `.agent/`

#### Scenario: 新增一個 opsx 性質 workflow

- **WHEN** 要新增一個跨 IDE 共用的 opsx workflow（例：`opsx-rebase`）
- **THEN** 完整內容 SHALL 寫在 `.agent/workflows/opsx-rebase.md`（或 `.agent/skills/...`）；`.cursor/commands/opsx-rebase.md` 與 `.windsurf/workflows/opsx-rebase.md` SHALL 為 stub 樣板

#### Scenario: `.claude/skills/` 內 skill 被誤判為 mirror

- **WHEN** PR 把 `.claude/skills/apply-and-verify/SKILL.md` 也 stub 化、指向某個 `.agent/` 對應檔
- **THEN** review MUST 阻擋；`.claude/skills/` 是 Claude-specific closed-loop 進階層，不對應 `.agent/` source-of-truth

### Requirement: Stub format SHALL be uniform and link-back

IDE mirror stub 的 body SHALL 採統一格式，至少包含：

1. 一行明示「Stub: 內容已 dedupe 到 source-of-truth」
2. 一個 relative path link 指回 `.agent/` 對應檔
3. 一句「任何規範修改 SHALL 改 `.agent/`，不改本 stub」

frontmatter SHALL 保留各 IDE 原有的 metadata schema（`name`、`description`、`category`、`tags` 等），不得砍掉，否則 IDE 可能掃不到 skill 入口。

#### Scenario: stub 沒有 link 回 .agent/

- **WHEN** PR 把某 mirror 改成 stub，但 body 沒附 relative path link 指向 `.agent/`
- **THEN** review MUST 要求補 link，否則 agent / 人類讀到 stub 不知道 source-of-truth 在哪

#### Scenario: stub 砍掉 frontmatter

- **WHEN** PR 把 `.cursor/skills/openspec-propose/SKILL.md` 的 frontmatter 砍掉只留 body link
- **THEN** review MUST 要求補回 IDE-specific frontmatter；IDE 沒掃到 skill 入口會直接 silent failure

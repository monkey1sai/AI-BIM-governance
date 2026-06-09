## MODIFIED Requirements

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

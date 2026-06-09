## Why

使用者要求移除舊 `docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md`，並將 repo 功能需求改以 `docs/plans/ai-bim-governance-設計規格.md` 與 `docs/plans/ai-bim-governance-prototype.html` 為主。主系統架構需對齊 `https://bim-docs.jackshappybot.com/` 分頁「01 系統架構」的「BIM 模型管理平台 — 系統架構」：雲端與客戶落地端分離，外部公司雲端為 control-plane，客戶落地端為 IFC / Kit / MCP runtime data-plane。

目前 repo 入口仍把舊 SaaS roadmap 當成需求與技術決策來源，且 `documentation-source-of-truth` spec 禁止追蹤任何 `docs/plans/*.html`。這會讓新的設計規格與 prototype 無法成為正式 repo artifact，並造成 README / workflow / OpenSpec spec 指向已移除文件。

## What Changes

- 刪除舊 `docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md`。
- 加入 `docs/plans/ai-bim-governance-設計規格.md` 與 `docs/plans/ai-bim-governance-prototype.html`。
- 更新 `AGENTS.md`、`README.md`、`docs/agents/product-operability-and-script-contract.md`、`docs/PROJECT_DEVELOPMENT_WORKFLOW.md`，讓功能需求與 UI 原型入口一致；`CLAUDE.md` 不在本 change 範圍。
- 更新 `documentation-source-of-truth` 與 `demo-fast-mvp-orchestration` specs，讓 OpenSpec 的文件治理規則不再指向舊 roadmap，並允許 prototype HTML 作為唯一可追蹤的 `docs/plans/*.html` source artifact。
- 更新 `agent-doc-context-budget` spec，將開發 / 調整時的工具規範改為 `.codex/skills` 對齊 `.claude/skills`，OpenSpec / opsx closed-loop skills 退役，需求拆解與完成驗證改走 Superpowers workflow。
- 更新 `.gitignore`，繼續忽略 generated plan HTML，但明確 unignore `docs/plans/ai-bim-governance-prototype.html`。

## Capabilities

### Modified Capabilities

- `documentation-source-of-truth`
- `demo-fast-mvp-orchestration`
- `agent-doc-context-budget`

### New Capabilities

- None。

## Impact

- Owner folder：root docs / `docs/plans/` / `docs/agents/` / `openspec/specs/`。
- Runtime / API / data shape：無變更。
- Dependencies：無新增。
- Validation：文件一致性 grep、skills inventory 對齊檢查、`git diff --check`、OpenSpec validate（若 CLI 可用；本 worktree 中 `npx openspec validate docs-design-spec-source-of-truth --strict` 目前失敗為 `npm error could not determine executable to run`，需在後續驗證中修 CLI 環境或由 CI 重跑）。

## Non-goals

- 不重寫產品功能實作。
- 不把 prototype 的 demo data 宣告成 runtime evidence。
- 不改 archived OpenSpec change。
- 不恢復 `_worker` / `_bim-control` product runtime。

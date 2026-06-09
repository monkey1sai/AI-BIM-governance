## 1. 文件入口切換

- [x] 1.1 刪除 `docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md`
- [x] 1.2 加入 `docs/plans/ai-bim-governance-設計規格.md`
- [x] 1.3 加入 `docs/plans/ai-bim-governance-prototype.html`
- [x] 1.4 更新 `.gitignore`，只允許該 prototype HTML 被追蹤

## 2. Source-of-truth 對齊

- [x] 2.1 更新 `AGENTS.md`（`CLAUDE.md` 不在本 change 範圍）
- [x] 2.2 更新 `docs/agents/product-operability-and-script-contract.md`
- [x] 2.3 更新 `README.md` 核心文件入口與 demo runbook link
- [x] 2.4 更新 `docs/PROJECT_DEVELOPMENT_WORKFLOW.md` 的需求來源與 closeout 規則
- [x] 2.5 更新 demo / historical plan references，避免指向已刪 roadmap

## 3. OpenSpec governance

- [x] 3.1 更新 `openspec/specs/documentation-source-of-truth/spec.md`
- [x] 3.2 更新 `openspec/specs/demo-fast-mvp-orchestration/spec.md`
- [x] 3.3 建立本 active change 的 proposal / design / tasks / spec deltas
- [x] 3.4 更新 `openspec/specs/agent-doc-context-budget/spec.md` 與 active delta，對齊 `.codex/skills` / `.claude/skills` 與 Superpowers workflow

## 4. 驗證

- [x] 4.1 `rg` 確認非 archive 文件不再以 Markdown link 指向 deleted roadmap path；殘留舊檔名僅為「已移除 / legacy」說明或本 change artifact
- [x] 4.2 `git diff --check`
- [x] 4.3 `git check-ignore -q docs/plans/ai-bim-governance-prototype.html` 回 `not_ignored`，且 `git ls-files --others --exclude-standard docs/plans/*.html` 僅列 prototype
- [x] 4.4 `rg` 確認現行 workflow 文件不再以 `/openspec new` / `/openspec apply` 作為開發入口
- [x] 4.5 `.codex/skills` vs `.claude/skills` 檢查：35 top-level dirs / 451 files / retired skills absent
- [ ] 4.6 `npx openspec validate docs-design-spec-source-of-truth --strict`（blocked：`npm error could not determine executable to run`）
- [ ] 4.7 `npx openspec validate --all --strict`（blocked：同上，需可用 OpenSpec CLI 或 CI 補跑）

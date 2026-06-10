## 1. 放寬 CLAUDE.md 行數預算

- [x] 1.1 MODIFY spec `agent-doc-context-budget`：CLAUDE.md 100 → 130 / 目標 80 → 100，明寫 `wc -l` 量追蹤檔本體、GitNexus runtime 附加區塊另計
- [x] 1.2 更新 `AGENTS.md` sub-file 表尾預算自述（CLAUDE.md ≤ 130 / 目標 ≤ 100）
- [x] 1.3 更新 `CLAUDE.md` §2 行數預算句（本檔 ≤ 130 / 目標 ≤ 100）

## 2. 驗證

- [x] 2.1 `wc -l CLAUDE.md` = 77 ≤ 130（追蹤檔本體未超標）
- [x] 2.2 `wc -l AGENTS.md` ≤ 250（不變）
- [x] 2.3 `git diff --check` 無 trailing whitespace
- [ ] 2.4 `npx openspec validate raise-claude-md-line-budget --strict`（本機 OpenSpec CLI 不可用：`could not determine executable to run`；待 CI pr-review-agent 跑 `openspec validate --specs --strict` 補綠）

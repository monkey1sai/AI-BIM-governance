# Tasks — agent-ship-cycle-automation

## 1. .gitignore un-ignore .claude/workflows/

- [x] 1.1 比照 `.claude/skills/` 負規則模式，在 skills 那組之後新增 `!.claude/workflows/` / `.claude/workflows/*` / `!.claude/workflows/ship-item.md` / `!.claude/workflows/ship-item.js`。
- [x] 1.2 `git check-ignore -v .claude/workflows/ship-item.md` 確認被負規則放行（既有 `*-adversarial-verify.js` 仍被 ignore）。

## 2. 權威程序 .claude/workflows/ship-item.md

- [x] 2.1 寫出 per-item ship-cycle 的觸發、10 步驟、buffered auto-merge gate。
- [x] 2.2 寫入誠實鐵律（不 merge production 真 P1/P2、不偽裝 CI 綠）與 production / non-production 判斷層次。
- [x] 2.3 連結權威：完整 PR / merge / closeout 規則指向 `docs/agents/github-workflow.md`。

## 3. 可執行版 .claude/workflows/ship-item.js

- [x] 3.1 寫 Workflow-tool 腳本：`meta` 為 pure literal、body 用 `args`（`branch` / `prNumber` / `userFacing`）派 agent 執行 ship-cycle。
- [x] 3.2 回傳 schema 結果（`merged` / `prNumber` / `mergeCommit` / `heldReason`）。
- [x] 3.3 `node --check` 通過（無 TS 語法、無 `Date.now()` / `Math.random()`）。

## 4. 文件化 docs/agents/github-workflow.md

- [x] 4.1 新增「Per-item ship-cycle 自動化（ship-item workflow）」一節，連結權威程序與可執行版並摘要 buffered auto-merge gate。

## 5. OpenSpec 驗證

- [x] 5.1 `npx openspec validate agent-ship-cycle-automation --strict` 0 failed。
- [x] 5.2 `npx openspec validate --all --strict` 0 failed。
- [x] 5.3 `git diff --cached --check` 無 trailing whitespace / EOF blank。

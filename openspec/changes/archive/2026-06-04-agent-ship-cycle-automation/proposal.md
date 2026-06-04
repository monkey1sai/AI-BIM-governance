## Why

使用者於 2026-06-03 要求把「每完成一個 work item 就自動 ship」納為 repo 級 agent 自動化：每個完成的 work item 都應自動走 commit → push → 開 PR → 觀測 CI 與 reviewer comment → buffered auto-merge → closeout，而不是要求使用者靠記憶逐步手動操作。

目前 repo 已有 `docs/agents/github-workflow.md` 描述 PR / merge / closeout 規則，但缺一個 per-item、可被 agent 直接執行並守住 buffered auto-merge 紀律（官方 gate 全綠 + ~90–120s reviewer buffer + 當前 head 無新 substantive P1/P2）的權威 ship-cycle 程序。本 change 把這個程序 codify 成 repo 級 agent 自動化 workflow 並寫入 spec。

本 change 是 tooling + docs + spec change：新增 ship-item workflow、補文件、擴充 `agent-operability-governance` capability；不修改 production code、不新增 runtime 行為。

## What Changes

- `.gitignore` 比照既有 `.claude/skills/` 模式，un-ignore `.claude/workflows/ship-item.md` 與 `.claude/workflows/ship-item.js`。
- 新增 `.claude/workflows/ship-item.md`：per-item ship-cycle 的權威程序與 buffered auto-merge gate（含誠實鐵律與 production / non-production 判斷層次）。
- 新增 `.claude/workflows/ship-item.js`：Workflow-tool 可執行版，以 `args`（`branch` / `prNumber` / `userFacing`）派一個 agent 執行 ship-cycle 並回傳 schema 結果（`merged` / `prNumber` / `mergeCommit` / `heldReason`）。
- `docs/agents/github-workflow.md` 新增「Per-item ship-cycle 自動化（ship-item workflow）」一節，連結權威程序與可執行版並摘要 gate。
- 擴充 `agent-operability-governance` capability：ADD 一個 requirement，要求 agent 對每個完成的 work item 走 buffered ship-cycle 自動化。

## Non-goals

- 不改既有 PR / CI / GitHub Actions 機制（沿用現有 `pr-review-agent` + `CodeRabbit` 與 `gh pr` 流程）。
- 不強制人類 review gate 以外的新行為；buffered auto-merge 仍以官方 gate 為 merge 授權。
- 不修改 production code、不新增 runtime / deploy 行為。
- 不取代 `docs/agents/github-workflow.md` 的 PR / merge / closeout 權威規則；本 change 是其 per-item 自動化補充。

## Impact

- Affected capabilities：`agent-operability-governance`（ADDED requirement）。
- Affected files：`.gitignore`、`.claude/workflows/ship-item.md`、`.claude/workflows/ship-item.js`、`docs/agents/github-workflow.md`。
- Product / runtime / deploy behavior：無。
- Git / PR workflow：新增 repo 級 per-item ship-cycle 自動化程序與可執行 workflow。

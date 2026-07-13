# Conversion API Environment Ownership Closeout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 將已核准的 conversion API env ownership 契約安全送進 `origin/main`，並完成 PR #327、CI、review 與 branch/worktree closeout。

**Architecture:** 變更只包含兩個 `.env.example`、formal spec 與本計畫，不修改 runtime code。交付遵守 repo ship-item：本機 preflight、required checks、reviewer buffer、squash merge，最後才移除 linked worktree 與 local branch。

**Tech Stack:** PowerShell 7、Node.js 22、npm/Vitest、Git、GitHub CLI、GitNexus。

## Global Constraints

- 不讀寫或輸出任何真實 `.env` secret value。
- Root 正典 key 維持 `STREAMING_CONVERSION_API_BASE`；coordinator legacy alias 只能是空值 `CONVERSION_API_BASE=`。
- 不修改 runtime code、public API、ports、default endpoint 或 `scripts/deploy.ps1` 行為。
- linked worktree 保留至 PR merge；先移除 worktree，再刪 local branch。

---

### Task 1: Ship PR #327 and close out the branch

**Files:**
- Modify: `.env.example`
- Modify: `bim-review-coordinator/.env.example`
- Create: `docs/superpowers/specs/2026-07-13-conversion-api-env-ownership-design.md`
- Create: `docs/superpowers/plans/2026-07-13-conversion-api-env-ownership-closeout.md`

**Interfaces:**
- Consumes: `conversionApiBaseFromEnv()` 的既有 precedence、PR #327、repo ship-item gates。
- Produces: 已進入 `origin/main` 的 env ownership contract，以及完成清理的 local/remote feature refs。

- [x] **Step 1: 完成本機 behavior 與 deploy 驗證**

Run:

```powershell
cd bim-review-coordinator
npm test -- tests/config.test.ts tests/env-example-minio-watch-parity.test.ts
npm run verify
cd ..
pwsh -NoProfile -NonInteractive -File .\scripts\tests\test-preflight-env.ps1
.\scripts\deploy.ps1 -DryRun
git diff --check
```

Expected: 28 targeted tests、611 full coordinator tests、6 preflight checks passed；DryRun 不執行 auto-fix；GitNexus 回 0 symbols／low risk。

- [ ] **Step 2: Commit/push 本計畫並更新 PR body**

Run:

```powershell
git add docs/superpowers/plans/2026-07-13-conversion-api-env-ownership-closeout.md
git diff --cached --check
git commit -m "docs(env): 補充 PR closeout 執行計畫"
git push
gh pr edit 327 --body <updated-body>
```

Expected: PR body 保留四個 Deploy Path Verification labels，並列 formal spec、最新 head 與本機驗證證據。

- [ ] **Step 3: 通過 mandatory local preflight**

Run:

```powershell
.\scripts\dev\check-pr-local-preflight.ps1 -PrNumber 327
```

Expected: body evidence、pr-review-agent、affected coordinator verify 全部通過；不再有 `missing_openspec` blocker。刪除 preflight 新建的 `.tmp-pr-local-preflight/` 與 `bim-review-coordinator/tmp-eirs-test-*` 後，`git status --porcelain` 必須 clean。

- [ ] **Step 4: 通過 CI 與 reviewer buffer**

Run:

```powershell
gh pr ready 327
gh pr checks 327 --watch
gh api --paginate repos/monkey1sai/AI-BIM-governance/pulls/327/comments
gh api --paginate repos/monkey1sai/AI-BIM-governance/pulls/327/reviews
gh api --paginate repos/monkey1sai/AI-BIM-governance/issues/327/comments
```

Expected: required checks success 或 skipped-success；等待 90–120 秒後，三處 reviewer evidence 無未解除 P0/P1/P2、Blocker、Critical、High 或 CHANGES_REQUESTED。

- [ ] **Step 5: Squash merge 並 close out**

Run:

```powershell
gh pr merge 327 --squash --delete-branch
git fetch origin --prune
gh pr view 327 --json state,mergedAt,mergeCommit
```

Expected: PR state `MERGED`，remote feature branch 不存在。接著從 primary repo root 執行：

```powershell
git worktree remove C:\Repos\active\iot\AI-BIM-governance.worktrees\env-example-hygiene-20260713
git worktree prune
git branch -D chore/env-example-hygiene-20260713
```

Final gate: `git worktree list --porcelain` 與 `git branch -vv --no-abbrev` 不再列出 env branch/worktree；primary checkout 的並行 WIP 必須保持原樣。

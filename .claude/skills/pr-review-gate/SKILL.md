---
name: pr-review-gate
description: implementation PR 開出後的 review gate；等待 CI checks、列出 reviewer comments、若有 blocking risk 自動觸發 GitNexus debug loop、全綠後等使用者明確同意才 merge。Merge 動作絕不自動執行，必須使用者人工同意。
disable-model-invocation: true
allowed-tools: Bash(gh pr*) Bash(gh api*) Bash(git push*) Bash(git status*) Bash(git log*) Skill Read Grep
---

# PR Review Gate

依 [CLAUDE.md](CLAUDE.md) 與 PDF 規範，merge 是不可逆動作，必須使用者明確同意。

## 觸發方式

使用者執行 `/pr-review-gate <pr-number>`。

## 執行步驟

### Step 1：取得 PR 狀態

```
!`gh pr view <pr-number> --json number,title,state,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup,labels,reviews`
```

判定：
- `state` 必須是 `OPEN`（CLOSED → 中止；MERGED → 已 merge 不該再呼叫此 skill）
- `mergeable` 必須是 `MERGEABLE`

### Step 2：等待 CI checks

```
!`gh pr checks <pr-number>`
```

統計：
- `pass` 數
- `fail` 數
- `pending` 數

若 `fail > 0` → 進入 Debug Loop（Step 4）
若 `pending > 0` → 等待，建議使用者過幾分鐘再執行；不自己 sleep。

### Step 3：列出 review comments

```
!`gh pr view <pr-number> --json reviews,comments`
!`gh api repos/{owner}/{repo}/pulls/<pr-number>/comments`
```

分類：
- `APPROVED`
- `REQUEST_CHANGES`（blocking）
- `COMMENTED`（non-blocking）

### Step 4：Debug Loop（有 blocking risk 時）

針對每個 `REQUEST_CHANGES` comment：

1. 把 comment 文字摘要成 debug target（symbol / file / function）
2. 呼叫 `gitnexus-blast-radius post-change` skill：

```
/gitnexus-blast-radius post-change
```

3. 依結果回到 `apply-and-verify` skill 修正、重 push、回 Step 2

### Step 5：所有 gate 都綠後的 merge confirmation

**強制人工同意**：

```
顯示 summary：
- PR #<number>: <title>
- CI checks: <pass> pass, 0 fail
- Reviews: <approved> approved, 0 blocking
- mergeStateStatus: CLEAN

請使用者明確回覆是否 merge：
  ✅ "merge" / "同意 merge" / "go ahead"
  ❌ "wait" / "不要" / "暫停"
```

**絕對不可以自動執行 `gh pr merge`**。

### Step 6：使用者同意後執行 merge

只有使用者明確同意才執行：

```
!`gh pr merge <pr-number> --squash --delete-branch`
```

注意：
- 用 `--squash`（依 repo 慣例）
- 用 `--delete-branch`（除非是 `revert-*` / `release` / `hotfix`）
- **不用** `--auto`（除非使用者特別說「等 CI 自動 merge」）

### Step 7：merge 後輸出

```yaml
pr_number: <num>
merged: true
merge_method: squash
merge_commit_sha: <sha>
deleted_branch: true
next_action: |
  建議下一步：使用 /archive-and-closeout <change-id>
  進行 archive PR 流程（依 NoSuccessorWhilePredecessorOpen rule，
  archive PR merge 後才能升格下一個 active change）
```

## 安全條款（不可妥協）

| 條款 | 規則 |
|---|---|
| 人工同意 gate | `gh pr merge` 前必須使用者明確 "merge" 才執行 |
| 不繞過 protected branch | 不用 `--admin` flag，不繞過 required reviews / checks |
| 不 force push | 不用 `git push -f` 到 PR branch（除非使用者明確要求 rebase） |
| 不 amend | 用新 commit 修正，不用 `git commit --amend` 改寫 PR 歷史 |

## Debug Loop 範例

reviewer 留言：「`bim-review-coordinator/src/services/callbackOutbox.ts`
的 callback retry path 可能靜默丟棄 cloud callback」

轉成 debug target：
1. symbol: `deliverPending` (in `bim-review-coordinator/src/services/callbackOutbox.ts`)
2. 跑 `gitnexus impact --target deliverPending --direction upstream`
3. 確認 affected processes 與 reviewer 的擔心是否吻合
4. 若是 → 補 focused test（測 retry / dead_letter / metadata-only callback path）
5. 重 push commit，回到 Step 2

## 參考

- [CLAUDE.md](CLAUDE.md) 不可逆操作規範
- [GitHub PR reviews 官方](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/about-pull-request-reviews)
- [gh pr merge 官方](https://cli.github.com/manual/gh_pr_merge)

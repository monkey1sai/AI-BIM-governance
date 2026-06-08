---
name: change-id-resolve
description: 解析下一個正式 change-id，套用 NoSuccessorWhilePredecessorOpen gate。當使用者要開始新 OpenSpec change、詢問「下一個 change 是什麼」、或要判定 active change 起點時使用。
allowed-tools: Bash(git status*) Bash(git fetch*) Bash(git rev-parse*) Bash(gh pr list*) Bash(gh pr view*) Read Grep Glob
---

# Change ID Resolve

依 [AGENTS.md](AGENTS.md) 規範，找出下一個正式 active change-id。

## 規則（依優先序）

1. **永遠從 `main` 的 roadmap 讀取**：未合併 PR 內的修改不算數
2. **NoSuccessorWhilePredecessorOpen**：前一個 change 的 implementation PR 與 archive PR 都 merge 前，後繼 change 不得升格為 active
3. **既有 PR 優先**：若該 change 已有 open branch / PR，續做既有分支

## 執行步驟

### Step 1：確認 main 乾淨

```
git status --porcelain
```

若有 uncommitted changes → 回報 BLOCKER：`dirty-working-tree`，停止。

### Step 2：同步 origin

```
git fetch origin --prune
git rev-parse origin/main
```

### Step 3：讀 main 上的 roadmap

讀 [docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md](docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md)。

找最新的「YYYY-MM-DD 更新（... active change）」段落（用 Grep 搜 `active change`、`下一個 worker risk burn-down` 等關鍵字）。

**重要**：以 main 版本為準，不認 worktree 內的未提交修改。

### Step 4：列出 `openspec/changes/` 現況

```
ls openspec/changes/
```

找出非 `archive` 的目錄 → 這些是當前 active changes。

### Step 5：檢查 predecessor closeout 狀態

從 roadmap 找出最近一次 archive 的 change id（典型語句：「已先 archive 至 `openspec/changes/archive/YYYY-MM-DD-<change-id>/`」）。

驗證：

```
gh pr list --state all --search "<predecessor-change-id> in:title" --json number,state,title --limit 10
```

判定條件：
- implementation PR `MERGED` ✓
- archive PR `MERGED` ✓

若任一未 merge → 標記 BLOCKER：`NoSuccessorWhilePredecessorOpen`，回報並停止。

### Step 6：檢查當前 change 是否已有 open PR

```
gh pr list --state open --search "head:codex/openspec/<change-id>" --json number,state,headRefName,title --limit 5
```

若有 → `branch_plan = "continue-existing"`，記錄 `existing_pr` 編號。
若無 → `branch_plan = "new"`。

### Step 7：輸出決策

回傳：

```yaml
change_id: <id>
predecessor:
  change_id: <prev>
  implementation_pr: <num> # MERGED
  archive_pr: <num>        # MERGED
branch_plan: new | continue-existing
existing_pr: <number or null>
existing_branch: codex/openspec/<change-id>
blockers: []
notes: <任何特殊情況>
```

## 邊界與限制

- 只判定 change-id，不執行 branch checkout（由 orchestrator 決定）
- 不修改 roadmap，只讀
- 若 roadmap 與 `openspec/changes/` 不一致，以 roadmap 為準（roadmap 是 source of truth）
- 若多個 active change 並存於 `openspec/changes/`（policy 違規），回報並要求人工釐清

## 參考

- [AGENTS.md](AGENTS.md)：repo 邊界與 source-of-truth 順序
- [CLAUDE.md](CLAUDE.md) §0.1：Claude 與 OpenSpec 對齊規則
- [docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md](docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md)：正式 active change 來源

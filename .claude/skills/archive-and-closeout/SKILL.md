---
name: archive-and-closeout
description: implementation PR merge 後執行 archive 與 closeout：建 archive branch、跑 openspec archive、同步 specs 與 roadmap markdown/HTML、開 archive PR、等使用者同意後 merge、最後做 branch cleanup。所有 merge 動作絕不自動執行。
disable-model-invocation: true
allowed-tools: Bash(git switch*) Bash(git pull*) Bash(git status*) Bash(git fetch*) Bash(git branch*) Bash(git add*) Bash(git commit*) Bash(git push*) Bash(git diff*) Bash(gh pr*) Bash(openspec archive*) Bash(openspec validate*) Bash(gitnexus detect-changes*) Read Edit Write Grep
---

# Archive and Closeout

依 [AGENTS.md](AGENTS.md) closeout flow：implementation PR merge 後另開 archive branch，不得偷塞進 implementation PR。

## 觸發前提

- implementation PR 已 merge（用 `gh pr view <impl-pr> --json state` 驗證 = `MERGED`）
- 目前 worktree 在 `main` 上且乾淨
- `change-id` 對應的 `openspec/changes/<change-id>/` 仍存在（尚未 archive）

## 執行步驟

### Step 1：同步 main 並驗證 predecessor

```
!`git switch main`
!`git pull origin main --ff-only`
!`git status --short`
```

確認：
- worktree 乾淨
- implementation commit 已在 main 上

### Step 2：建立 archive branch

```
!`git switch -c codex/openspec/archive-<change-id>`
```

命名固定：`codex/openspec/archive-<change-id>`。

### Step 3：執行 openspec archive

```
!`openspec archive <change-id>`
```

該指令會：
- 把 `openspec/changes/<change-id>/` 移到 `openspec/changes/archive/YYYY-MM-DD-<change-id>/`
- 把 spec delta 套用到 `openspec/specs/<capability>/spec.md`

若有 implementation tasks 未完成 → openspec 會警告。仍要 archive 時：
- 在 archive proposal 寫明哪些 tasks 未完成
- 在 roadmap 寫「archive 時仍有 N 個 implementation tasks 未完成，因此 roadmap 不把它視為 runtime passed」
- 開 successor change 接續

### Step 4：同步 roadmap

依 [docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md](docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md) §1.6 規範，每次 archive 後必須更新：

1. **§1.4**：archive 清單
2. **§2 Phase 狀態**：對應 phase item 從 active → archived
3. **§5 / §6 候選**：移除已完成或調整優先級
4. **§10**：驗證證據鏈
5. roadmap 開頭加一行 `YYYY-MM-DD 更新（<change-id> archive 對齊）`

### Step 5：同步 roadmap HTML

讀同名 `.html`（若存在），同步更新 archive 段落、Phase 狀態。
若無 `.html` → 跳過，但在 archive PR body 註明。

### Step 6：四層驗證

```
!`openspec validate --strict`
!`git diff --check`
!`gitnexus detect-changes --scope staged`
```

`openspec validate --strict`（不帶 change-id）會驗整個 specs 目錄。

### Step 7：Commit

```
docs(openspec): archive <change-id> and sync roadmap

- Archive <change-id> 至 openspec/changes/archive/YYYY-MM-DD-<change-id>/
- 同步 openspec/specs/<capability>/spec.md
- 更新 docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md §1.4 / §2 / §10
- (optional) 同名 HTML 對齊
```

### Step 8：Push 並開 archive PR

```
!`git push -u origin codex/openspec/archive-<change-id>`
```

```
!`gh pr create \
  --base main \
  --head codex/openspec/archive-<change-id> \
  --title "docs(openspec): archive <change-id> and sync roadmap" \
  --body-file <archive PR body>`
```

archive PR body 模板：

```markdown
## 變更摘要
Archive `<change-id>` 並同步 specs / roadmap。

## 修改原因
依 AGENTS.md closeout flow，implementation PR (#<impl-pr-number>) 已 merge，現執行 archive 段。

## 主要變更
- 移動 `openspec/changes/<change-id>/` → `openspec/changes/archive/YYYY-MM-DD-<change-id>/`
- 同步正式 specs：<capability list>
- 更新 roadmap §1.4 / §2 / §10
- (optional) 同名 HTML 對齊

## 驗證方式
- [x] `openspec validate --strict` ✓
- [x] `git diff --check` ✓
- [x] `gitnexus detect-changes --scope staged` — 僅 openspec/ 與 docs/plans/

## 風險與影響
- archive 後 successor change 才能升格為 active
- 若 implementation tasks 未完成，roadmap 已標註並開 successor

## 回滾方式
若 archive PR merge 後發現問題：`gh pr revert <archive-pr-number>` → 將 specs / roadmap 回到 archive 前狀態。

## 後續建議
- successor change: <next change id>
- 等本 PR merge 後，roadmap 才正式升格 successor 為 active
```

### Step 9：等待 archive PR review

呼叫 `pr-review-gate`：

```
/pr-review-gate <archive-pr-number>
```

archive PR 通常 risk 較低（只動 specs/docs），但 review gate 仍必須走完。

### Step 10：使用者同意 → merge archive PR

由 `pr-review-gate` 處理人工同意 + merge。

### Step 11：Closeout

archive PR merge 後：

```
!`git switch main`
!`git fetch origin --prune`
!`git status --short --branch`
!`git branch --no-merged origin/main`
```

刪除已 merged / superseded branch：
- `codex/openspec/<change-id>` → 刪
- `codex/openspec/archive-<change-id>` → 刪（gh pr merge --delete-branch 已處理）

**不**自動刪除：
- `revert-*`
- `release/*`
- `hotfix/*`

### Step 12：升格下一個 active change

確認 roadmap 已標明下一個 active change。可呼叫：

```
/change-id-resolve
```

確認下一個 change-id 已就緒。

## 邊界與限制

- archive 必須在 implementation PR merge **之後**
- 不能在同一 PR 內 squash implementation 與 archive
- `openspec/specs/` 正式 specs **只能**在 archive 時更新（apply 階段只動 delta）
- roadmap markdown 與 HTML 必須同步（若 HTML 不存在則註明）

## 參考

- [AGENTS.md](AGENTS.md) Closeout flow
- PR #34（archive coordinator-session-lifecycle-events-audit）—— 已 merge 的 archive PR 範例
- PR #35（歸檔 canonical batch 並新增 enumeration 優化切片）—— archive + successor 同 PR 的反例（PDF 建議避免此模式）

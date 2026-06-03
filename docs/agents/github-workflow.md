> Loaded lazily by AGENTS.md / CLAUDE.md。Source-of-truth: AGENTS.md。
>
> 何時讀本檔：開 PR、處理 GitHub Actions failure、做 OpenSpec sync/archive、做 PR merge 後本地分支收斂時。

# OpenSpec + GitHub Workflow

OpenSpec change 與實作必須遵守 GitHub PR workflow，不得直接在 `main` 分支上開發。

```txt
OpenSpec = 需求 / 規格 / 驗收條件
Git Branch = 實作隔離
Pull Request = 審查與討論
GitHub Actions = 自動驗證
Merge = 正式接受變更
Archive = 把變更規格併入正式規格
```

## 開 change 前

- 執行 `/openspec new <change-id>` 前，先從最新 `main` 建立並切換到 `codex/openspec/<change-id>`。
- `/openspec apply <change-id>` 的程式碼、測試、文件與 OpenSpec task 更新都必須留在該 branch。

## PR 與 merge

- 開 PR 前要跑最小驗證並回報結果；PR 由 GitHub Actions 做自動驗證與審查討論。
- User-facing change 的 PR 描述必須包含 Frontend Verification table；無前端 route / button / fixture / browser evidence 時不得標為完整完成。
- Runtime / Docker / Kit / viewer / env / port 相關 PR 描述必須包含 Deploy Path Verification table；若未更新 `scripts/deploy.ps1`，必須明確說明已驗證或不適用。
- change 實作被正式接受並 merge 後，才執行 OpenSpec sync/archive，把 delta specs 併入 `openspec/specs/`。
- 每次執行 OpenSpec sync/archive 後，必須同步更新 `docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md`，保持 `openspec/specs/`、`openspec/changes/archive/`、Phase 狀態、OpenSpec 候選、風險與下一步規劃一致。
- Roadmap 同步以 `docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md §1.6` 為準；若沒有新的 runtime / smoke / test evidence，不得因 archive 完成就把 roadmap 的驗證狀態標成 passed。
- Roadmap 對齊完成後，若需要人類檢視，可使用文件/規劃相關 skill 由同名 Markdown on-demand 產生 HTML 檢視版；依 `documentation-source-of-truth`，`docs/plans/*.html` 是 ignored 衍生檔，不提交到 PR，source of truth 仍是 `.md`。
- 若 roadmap 未同步，OpenSpec archive 只能視為規格檔案已搬移，不能視為專案執行規劃已收斂。

## `main` 衛生

- 若發現已在 `main` 產生未提交變更，先切到對應 `codex/openspec/<change-id>` branch，再繼續工作或整理 PR。
- 本地 `main` 只作為 `origin/main` 的乾淨追蹤分支；不得在 `main` 保留本地-only commit、累積功能開發、或用 merge/pull 解 PR squash/merge 後的 ahead/behind 分岔。
- PR merge 後的本地收斂必須先 `git fetch origin --prune`，確認工作區乾淨後讓本地 `main` 指向 `origin/main`；若 `main...origin/main` 顯示 ahead/behind，先確認 ahead 內容已被 PR merge commit 吸收，再對齊 `origin/main`，不要手動解同內容衝突。

---

## Archive 後的 agent closeout event flow

OpenSpec archive 只代表規格已併入正式 specs，不代表 Git branch 已自動收斂。當 agent 完成或協助完成 archive change id、PR merge、或使用者詢問「分支是否收斂」時，必須把 branch closeout 視為同一個事件流程的收尾，不應要求使用者靠記憶手動執行。

Closeout 必須先做只讀盤點：

```powershell
git switch main
git fetch origin --prune
git status --short --branch
git branch -vv --no-abbrev
git branch --no-merged origin/main
git branch -r --no-merged origin/main
```

判斷規則：

- 對於 PR 已 `MERGED`、upstream 已 `gone`、或已被後續 PR / archive 明確 superseded 的 local branch，agent 可以在回報理由後清理 local branch。
- 對於遠端 branch，必須先用 `gh pr list --state all` 或等價方式確認 PR 狀態與 head ref；只有已 merge 或已明確 superseded 的 branch 才可建議刪除。
- `revert-*`、release、hotfix、或語意上代表回滾決策的 branch 不得自動刪除；必須先向使用者說明保留/刪除影響並取得明確同意。
- 若 `git branch --no-merged origin/main` 因 squash merge 或 replacement PR 仍列出舊 branch，不能只用 ancestry 判斷；必須交叉比對 PR 狀態、`mergedAt`、`closedAt`、branch diff 與 OpenSpec archive 內容。

清理指令範本：

```powershell
git branch -D <local-branch>
git push origin --delete <remote-branch>
git fetch origin --prune
```

完成後必須回報：

- 刪除哪些 local branch。
- 刪除哪些 remote branch。
- 哪些 branch 刻意保留，以及保留原因。
- `main` 是否已對齊 `origin/main`。
- `git branch --no-merged origin/main` 與 `git branch -r --no-merged origin/main` 的剩餘結果。

---

## Per-item ship-cycle 自動化（ship-item workflow）

每完成一個可驗證的 work item，agent SHALL 自動走 repo 級 ship-cycle（commit→push→PR→CI watch→buffered auto-merge→closeout），不應要求使用者靠記憶逐步手動執行。**權威程序與完整閘門以 `.claude/workflows/ship-item.md` 為準**（可執行版 `.claude/workflows/ship-item.js`，`Workflow({name:'ship-item', args:{branch, prNumber, userFacing}})`）；本節僅為指標，避免雙重規範漂移。摘要：官方 gate（`pr-review-agent` + `CodeRabbit`）全綠 + ~90–120s reviewer buffer + 當前 head 無新 substantive P1/P2 → `gh pr merge --squash --delete-branch` + 上節 closeout 盤點。詳細誠實鐵律、production vs non-production 判斷層次、與既有 consent gate 的調和，見 `ship-item.md`。

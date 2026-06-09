> Loaded lazily by AGENTS.md / CLAUDE.md。Source-of-truth: AGENTS.md（§0.1 開發管線）。
>
> 何時讀本檔：開 PR、處理 GitHub Actions failure、PR merge 後本地分支收斂時。

# GitHub Workflow（四套工具管線的 git 段）

所有實作走四套工具開發管線（完整定義見 `AGENTS.md` §0.1「開發管線」）；git 段固定 `branch → PR → Actions → merge`，**不得直接在 `main` 分支上開發**。

```txt
Superpowers plan = 需求 / 規格 / 分期 task（plan / execution governance，主線）
GitNexus impact  = 改 symbol 前的影響分析
Git Branch       = 實作隔離
gstack evidence  = UI / E2E / screenshot 驗收（user-facing done 的唯一證據）
Pull Request     = 審查與討論
GitHub Actions   = 自動驗證
Merge            = 正式接受變更
```

## 開分支前

- 從最新 `main` 建立並切換到功能 branch（例：`feat/<slug>`、`fix/<slug>`、`chore/<slug>`）。
- 非平凡功能先用 Superpowers `writing-plans` 產出分期 plan（存 `docs/superpowers/plans/`），再用 `subagent-driven-development` 逐 task 實作。
- 改任何 function / class / method 前先跑 GitNexus `impact`（HIGH / CRITICAL 先回報）；細節見 `gitnexus-usage.md`。
- Matt Pocock skills 僅作 issue / triage / domain-doc 輔助，不得取代 Superpowers plan。

## PR 與 merge

- 開 PR 前跑最小驗證並回報結果；commit 前跑 GitNexus `detect_changes` 驗 scope；PR 由 GitHub Actions 做自動驗證與審查討論。
- User-facing change 的 PR 描述必須包含 Frontend Verification table（Frontend URL / Buttons tested / Test fixture / Expected visible result / gstack E2E command / Screenshot evidence path / Known limitations）；無前端 route / button / fixture / **gstack browser evidence** 時不得標為完整完成。
- Runtime / Docker / Kit / viewer / env / port 相關 PR 描述必須包含 Deploy Path Verification table；若未更新 `scripts/deploy.ps1`，必須明確說明已驗證或不適用。
- 完成標準、frontend-operable rule 與誠實鐵律（無 backend 處 UI 標 `DEMO DATA` / `NOT BUILT` / `not observed`，不得只接 mock）見 `AGENTS.md` §0.1 與 `product-operability-and-script-contract.md`。

## `main` 衛生

- 若發現已在 `main` 產生未提交變更，先切到對應功能 branch，再繼續工作或整理 PR。
- 本地 `main` 只作為 `origin/main` 的乾淨追蹤分支；不得在 `main` 保留本地-only commit、累積功能開發、或用 merge/pull 解 PR squash/merge 後的 ahead/behind 分岔。
- PR merge 後的本地收斂必須先 `git fetch origin --prune`，確認工作區乾淨後讓本地 `main` 指向 `origin/main`；若 `main...origin/main` 顯示 ahead/behind，先確認 ahead 內容已被 PR merge commit 吸收，再對齊 `origin/main`，不要手動解同內容衝突。

---

## PR merge 後的 branch closeout

PR merge 不代表 Git branch 已自動收斂。當 agent 完成 / 協助完成 PR merge、或使用者詢問「分支是否收斂」時，必須把 branch closeout 視為同一事件流程的收尾，不應要求使用者靠記憶手動執行。

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

- 對於 PR 已 `MERGED`、upstream 已 `gone`、或已被後續 PR 明確 superseded 的 local branch，agent 可以在回報理由後清理 local branch。
- 對於遠端 branch，必須先用 `gh pr list --state all` 或等價方式確認 PR 狀態與 head ref；只有已 merge 或已明確 superseded 的 branch 才可建議刪除。
- `revert-*`、release、hotfix、或語意上代表回滾決策的 branch 不得自動刪除；必須先向使用者說明保留/刪除影響並取得明確同意。
- 若 `git branch --no-merged origin/main` 因 squash merge 或 replacement PR 仍列出舊 branch，不能只用 ancestry 判斷；必須交叉比對 PR 狀態、`mergedAt`、`closedAt` 與 branch diff。

清理指令範本：

```powershell
git branch -D <local-branch>
git push origin --delete <remote-branch>
git fetch origin --prune
```

完成後必須回報：刪除哪些 local / remote branch、哪些刻意保留及原因、`main` 是否已對齊 `origin/main`、`git branch --no-merged origin/main` 與 `git branch -r --no-merged origin/main` 的剩餘結果。

---

## Per-item ship-cycle 自動化（ship-item workflow）

每完成一個可驗證的 work item，agent SHALL 自動走 repo 級 ship-cycle（commit→push→PR→CI watch→buffered auto-merge→closeout），不應要求使用者靠記憶逐步手動執行。**權威程序與完整閘門以 `.claude/workflows/ship-item.md` 為準**（可執行版 `.claude/workflows/ship-item.js`，`Workflow({name:'ship-item', args:{branch, prNumber, userFacing}})`）；本節僅為指標，避免雙重規範漂移。摘要：官方 gate（`pr-review-agent` + `CodeRabbit`）全綠 + ~90–120s reviewer buffer + 當前 head 無新 substantive P1/P2 → `gh pr merge --squash --delete-branch` + 上節 closeout 盤點。詳細誠實鐵律、production vs non-production 判斷層次、與既有 consent gate 的調和，見 `ship-item.md`。

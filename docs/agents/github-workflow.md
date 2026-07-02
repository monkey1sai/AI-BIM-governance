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

四工具職責表（單一權威版；`AGENTS.md` §0.1 指向本表）：

| 工具 | 唯一職責（單線，不可越界） |
|---|---|
| **Superpowers** | 主線 plan / execution governance：`writing-plans` 拆分期 plan → `subagent-driven-development` 執行 → `verification-before-completion` done-gate |
| **GitNexus** | code intelligence：改 symbol 前 `impact`（HIGH / CRITICAL 先回報）、commit 前 `detect_changes` 驗 scope |
| **gstack** | browser QA / screenshot / E2E evidence：user-facing 完成的**唯一驗收證據來源** |
| **Matt Pocock skills** | 僅 optional 輔助：issue / triage / domain-doc；**不得當主線** |

禁止（anti-patterns）：

- ❌ 用 Matt Pocock skills 取代 Superpowers plan。
- ❌ 用 Superpowers 宣告 UI 完成而不跑 gstack。
- ❌ 用 GitNexus 當產品設計依據（設計來自 spec / prototype，非 call graph）。
- ❌ 用 gstack 改 backend symbol 而跳過 GitNexus impact。

## 開分支前

- 從最新 `main` 建立並切換到功能 branch（例：`feat/<slug>`、`fix/<slug>`、`chore/<slug>`）。
- 非平凡功能先用 Superpowers `writing-plans` 產出分期 plan（存 `docs/superpowers/plans/`），再用 `subagent-driven-development` 逐 task 實作。
- 改任何 function / class / method 前先跑 GitNexus `impact`（HIGH / CRITICAL 先回報）；細節見 `gitnexus-usage.md`。
- Matt Pocock skills 僅作 issue / triage / domain-doc 輔助，不得取代 Superpowers plan。

## PR 與 merge

- 開 PR 前跑最小驗證並回報結果；commit 前跑 GitNexus `detect_changes` 驗 scope；PR 由 GitHub Actions 做自動驗證與審查討論。
- User-facing change 的 PR 描述必須包含 Frontend Verification table（Frontend URL / Buttons tested / Test fixture / Expected visible result / gstack E2E command / Screenshot evidence path / Known limitations）；無前端 route / button / fixture / **gstack browser evidence** 時不得標為完整完成。
- Runtime / Docker / Kit / viewer / env / port 相關 PR 描述必須包含 Deploy Path Verification table；若未更新 `scripts/deploy.ps1`，必須明確說明已驗證或不適用。
- 改動治理面檔案（`AGENTS.md` / `CLAUDE.md` / `README.md` / `docs/agents|plans/` / `.github/` / `.claude/workflows/` / `.codex/skills/` / pr-review-agent scripts）的 PR 描述必須包含 **AI Coding Governance** table，7 個必填 label：`Linked issue`、`Requirement source`、`CODEOWNERS / owner review`、`GitNexus evidence`、`gstack evidence`、`Agent workflow changed?`、`Required checks expected`。所有三張表的 label 都由 `scripts/tests/check-pr-body-evidence.ps1` 逐字比對（值不得為 `-`/`tbd`/`todo` 等占位）；改 body 後需 push empty commit 重跑 check。
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
git worktree remove <worktree-path>
git worktree prune
git branch -D <local-branch>
git push origin --delete <remote-branch>
git fetch origin --prune
```

若該 branch 曾以 worktree 方式開發，`git worktree remove` 必須排在 `git branch -D` 之前；沒有先移除 worktree 就刪 branch 會留下失聯的 worktree 目錄與 `.git/worktrees/` 殘留紀錄。

完成後必須回報：刪除哪些 local / remote branch、哪些刻意保留及原因、`main` 是否已對齊 `origin/main`、`git branch --no-merged origin/main` 與 `git branch -r --no-merged origin/main` 的剩餘結果。

---

## Worktree 生命週期

當工作需要與目前 checkout **並行存活**（例：現有功能開發中途要插做 hotfix；或要跑一套不動部署區的隔離 branch E2E stack）時用 `git worktree`，其餘情況（單線開發、且需要本機 gitignored fixtures 如 `storage/` 下的 IFC 檔）優先用 `git switch` 直接切換 branch。

### 位置與命名

- **權威位置**：repo 的 **sibling 目錄**，例如 `C:\Repos\active\iot\AI-BIM-governance.worktrees\<branch-slug>`（與 repo 同層、repo 外）。
- **禁用位置**：`.claude/worktrees/` 已被 gitignore，且已有紀錄顯示會被並行 git automation 中途清空（見 `enterworktree-cleaned-by-concurrent-git.md`），`git clean -fdx` 也會把它整個掃掉；不得當作 worktree 的正式落腳點。
- **命名**：branch 用 `feat|fix|chore|docs/<slug>`；worktree 目錄名對齊同一個 `<slug>`（不重複前綴）。

### 何時用 worktree vs. 直接切 branch

- **用 worktree**：目前工作必須保持存活並行（例如：主功能還在 in-progress，需要同時開一個 hotfix branch）；或需要跑一套**隔離 branch E2E stack**（alt ports，如 coordinator `:8005`、governance `:49103`），且該 stack **不得**碰到 `D:\Users\deploy\AI-bim-geo` 部署區。
- **用 branch-switch（同一 checkout）**：單線工作、且需要本機 gitignored fixtures（例如 `storage/` 下的真實 IFC 檔案）——全新 worktree 預設不含這些檔案，除非額外做 junction 連結；此時直接切 branch 比開 worktree 簡單。

### Closeout

PR merge 後，若該 branch 曾以 worktree 開發，收斂順序為：

```powershell
git worktree remove <worktree-path>
git worktree prune
git fetch origin --prune
git branch -D <local-branch>
```

worktree closeout 是 branch closeout 的前置步驟，不是獨立可省略的動作；上節「PR merge 後的 branch closeout」判斷規則（MERGED / superseded / 保留 revert-* 等）同樣適用於 worktree 對應的 branch。

### 與部署區（D 軸）的分工

開發／驗證主線固定為：

```txt
main checkout 或 sibling worktree 開發 → branch → PR → CI 綠 → merge 進 origin/main
                                                              → 只有 merge 後的 origin/main 才會被重建進 D:\Users\deploy\AI-bim-geo
```

- 未 merge 的 branch **不得**拿部署區當驗證場所：`.\scripts\dev\rebuild-test-deploy.ps1 -Build` 這條 helper 的定義就是每次強制從 freshly fetched `origin/main` 重建，不會、也不應該去讀未 merge 的 worktree 或 branch 內容。
- merge 前需要 browser E2E 證據時，用「隔離 alt-port branch stack」（本 checkout 或 sibling worktree + coordinator `:8005` / governance `:49103`），對照 `docs/agents/product-operability-and-script-contract.md` 的 script contract，不要為了搶先驗證去動部署區的 golden path。

---

## Per-item ship-cycle 自動化（ship-item workflow）

每完成一個可驗證的 work item，agent SHALL 自動走 repo 級 ship-cycle（commit→push→PR→CI watch→buffered auto-merge→closeout），不應要求使用者靠記憶逐步手動執行。**權威程序與完整閘門以 `.claude/workflows/ship-item.md` 為準**（可執行版 `.claude/workflows/ship-item.js`，`Workflow({name:'ship-item', args:{branch, prNumber, userFacing}})`）；本節僅為指標，避免雙重規範漂移。摘要：官方 gate（main branch protection 的 **required checks 全綠**，現含 `pr-review-agent`、`agent-governance` 與各 build/test 共 11 項，以 GitHub 設定為準；CodeRabbit / Codex / Copilot 非 required check）+ ~90–120s reviewer buffer + 當前 head 無新 substantive P1/P2（含非 required reviewer 的發現）→ `gh pr merge --squash --delete-branch` + 上節 closeout 盤點。詳細誠實鐵律、production vs non-production 判斷層次、與既有 consent gate 的調和，見 `ship-item.md`。

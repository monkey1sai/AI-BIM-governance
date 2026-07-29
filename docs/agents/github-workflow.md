> Loaded lazily by AGENTS.md / CLAUDE.md。Source-of-truth: AGENTS.md（§0.1 AI Coding Governance Lanes）。
>
> 何時讀本檔：開 PR、處理 GitHub Actions failure、PR merge 後本地分支收斂時。

# GitHub Workflow（Lane-aware git 段）

Lane F/B 不使用 Superpowers，也不自動 push、開 PR 或 merge。當使用者明確要求 ship，或工作進入 Lane G/S 時，git 段固定 `branch → PR → Actions → merge`；不得直接在 `main` 開發。

| 工具 | 正確定位 |
|---|---|
| **Superpowers** | Lane S 的完整 spec-to-done；Lane G 可按需使用單一 planning/verification skill，但不是預設 |
| **GitNexus** | Lane B/G/S 的 code impact 與 scope intelligence；F 不強制 |
| **Browser E2E** | user-facing 變更的可見行為證據，可用 Playwright / gstack / supported browser engine |
| **Design fidelity** | 以 tracked design manifest/baselines 驗 screen/state；Windows runner 的 Chromium DPR1 兩 viewport pixel≤1%＋semantic 100% |
| **PR local preflight** | PR 前 affected-only machine gate，不是每次 local edit 的循環 |
| **Matt Pocock skills** | optional issue / triage 輔助 |

禁止（anti-patterns）：

- ❌ 因任務「非平凡」就把 F/B 升級成完整 Superpowers lifecycle。
- ❌ 用任何 planning/review skill 宣告 UI 完成而不跑 browser E2E。
- ❌ 用 browser E2E 取代 design diff，或用 design screenshot pass 取代真 API/runtime E2E。
- ❌ 用 GitNexus 當產品設計依據（2D 設計來自 approved pinned design reference，行為來自 TARGET/contracts，非 call graph）。
- ❌ 用 browser tool 改 backend symbol 而跳過 Lane G/S 的 GitNexus gate。

## 開分支前

- 從最新 `main` 建立功能 branch（例：`feat/<slug>`、`fix/<slug>`、`chore/<slug>`）；Lane G/S 或 checkout 不乾淨時用 dedicated worktree。
- Lane F：無 plan/spec/subagent，targeted test；checkout 乾淨時不強制 worktree。
- Lane B：只列 3–5 項 inline checklist，不建立 detailed plan；對 task/主要 entry symbol 跑一次 GitNexus impact。
- Lane G：簡潔 implementation plan + risk-scoped reviewer；Lane S 才使用完整 `writing-plans` / `subagent-driven-development` / spec-to-done。

## PR 與 merge

- 開 PR 前跑 affected validation 並回報結果；Lane B 只在 code symbol/flow 變更時跑 detect_changes，Lane G/S commit 前必跑。PR 由 GitHub Actions 做遠端確認，但不得把 Actions 當第一輪錯誤發現工具。
- **Local PR preflight 是硬 gate**：凡 GitHub workflow 可在本機等效檢查，必須先本機跑到綠再 push / watch CI；跳過本機 preflight 導致 PR 等待或重跑，視為嚴重開發時間浪費。最低要求：

  ```powershell
  .\scripts\dev\check-pr-local-preflight.ps1 -PrNumber <pr-number>
  ```

  此 wrapper 會讀指定 PR 的 `baseRefOid/headRefOid`、要求 local `HEAD` 精確等於 PR head，再用該組 SHA 的 merge-base changed paths 執行 `scripts/tests/check-pr-body-evidence.ps1`，接著在 repo-local `.tmp` 下跑 `scripts/pr-review-agent.ps1`（含 affected sub-repo verify，例如 viewer/coordinator/streaming/scripts）。若只是在診斷 GitHub 上既有 PR body gate，可暫用 `-ChangedPathsSource remote -SkipReviewAgent -SkipViewerVerify`；正式 push / CI watch 前不得跳過受影響的本機等效測試。
- **PR CI local-first policy**：PR 事件不得無差別重跑本機可重現的 heavy service checks。`.github/workflows/ci.yml` 先跑 `changed path classifier`，只有受影響的 service-level jobs（coordinator / viewer / governance-service / kit-manager / root contracts / compose / static / secret scan）才跑遠端確認；未受影響的 required job 以 job-level `if` skip，保留 check 名稱且避免 workflow-level path skip pending。`.github/workflows/pr-review-agent.yml` 的 `PR Metadata Contract` 只提供 PR-head diagnostic；不保留 raw body、不安裝 sub-repo deps、不重跑 local review agent。唯一 merge authority 是 default-branch `.github/workflows/merge-evidence.yml` 發布的 `required merge evidence` status：它以 base-pinned validator 重驗 live body SHA、NUL-safe changed paths、CI conclusions 與 artifacts。本機 `check-pr-local-preflight.ps1` 仍是 push 前的 PR review agent 與 affected sub-repo verification 硬 gate。
- 每個 PR body 必填 `Change lane: F | B | G | S`、`Behavior contract changed: yes | no`、`Requirement source: issue | docs/plans | superpowers spec | existing contract | not applicable`。behavior=yes 或 Lane G/S 時不得填 not applicable；behavior=no 不得只因 changed path 缺 spec 而 blocker。新增或刪除 route/API/schema 等 contract signal，或 deploy/security/Kit runtime/cross-service 等 Governed trigger，不得自報 F/B 規避 Lane G。
- User-facing change 的 PR 描述必須包含 Frontend Verification table；machine-required labels 以 `scripts/tests/check-pr-body-evidence.ps1` 為準。除 route/button/fixture/真 backend/runtime ID/visible state/browser evidence 外，還必須填 `Design gate status`、`Design screen(s)`、`Reference-missing route(s) / surface(s)`、`Full completion claimed`、manifest 與 visual result/comparison/artifacts。scope 由 base/head manifest 聯集推導，PR 不得自選 screen；`mixed`／`partial_reference_missing` 一律 full=no。semantic/pixel只接受 CI `design-semantic-visual` output，functional/runtime 只接受 `functional-runtime-conv` output；兩者須由 `required merge evidence` 依 plan 判定 required/typed skip 後才有 merge authority。
- Runtime / Docker / Kit / viewer / env / port 相關 PR 描述必須包含 Deploy Path Verification table；若未更新 `scripts/deploy.ps1`，必須明確說明已驗證或不適用。
- 改動治理面檔案的 PR 描述必須包含 **AI Coding Governance** table，7 個必填 label：`Linked issue`、`Requirement source`、`CODEOWNERS / owner review`、`GitNexus evidence`、`Browser E2E evidence`、`Agent workflow changed?`、`Required checks expected`。machine labels 由 `check-pr-body-evidence.ps1` 逐字比對，值不得為占位。
- `PR Metadata Contract` 與 CI 都監聽 `pull_request.edited`；default-branch invalidator 會先把 `required merge evidence` 設回 pending，新的 CI 完成後才以 live body hash重新授權。因此 PR body-only 修正流程是：更新 PR body → 等待新的 `edited` CI 與 trusted merge-evidence run → 本機 `check-pr-local-preflight.ps1` 跑綠；不得用 `gh run rerun` 的舊 payload或 `--allow-empty` commit假刷新證據。
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

Lane G/S、修 PR、checkout 不乾淨或並行工作時必須使用 dedicated worktree。Lane F/B 在已確認 checkout 乾淨且使用者未要求隔離時可直接使用 task branch。需要 gitignored fixtures（例如 `storage/` 真實 IFC）時，優先在 worktree 建 junction / symlink。

### 位置與命名

- **權威位置**：repo 的 **sibling 目錄**，例如 `C:\Repos\active\iot\AI-BIM-governance.worktrees\<branch-slug>`（與 repo 同層、repo 外）。
- **禁用位置**：`.claude/worktrees/` 已被 gitignore，且已有紀錄顯示會被並行 git automation 中途清空（見 `enterworktree-cleaned-by-concurrent-git.md`），`git clean -fdx` 也會把它整個掃掉；不得當作 worktree 的正式落腳點。
- **命名**：branch 用 `feat|fix|chore|docs/<slug>`；worktree 目錄名對齊同一個 `<slug>`（不重複前綴）。

### 何時可直接切 branch

- **用 worktree**：Lane G/S、修 PR、checkout 不乾淨、並行工作、或隔離 E2E stack。
- **可直接切 branch**：Lane F/B 且工作區乾淨，或使用者明確要求在目前 checkout 操作；不得混入既有 dirty files。

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

Lane F/B 不自動啟動 ship-cycle。只有使用者明確要求 ship，或 Lane S 的已核准 spec 授權自主推進時，才使用 `.claude/workflows/ship-item.md`（commit→push→PR→local preflight→CI watch→buffered merge→closeout）。Lane G 預設停在 PR ready；是否 merge 仍依使用者授權與 branch protection。完整 gate、reviewer buffer、finding fix 與 consent carve-out 以 `ship-item.md` 為準。

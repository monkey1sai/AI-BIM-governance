# ship-item — Per-item ship-cycle（buffered auto-merge）權威程序

> 本檔是 repo 級 agent 自動化 ship-cycle 的 source of truth。完整 PR / merge / closeout 規則見 `docs/agents/github-workflow.md`；本檔聚焦「每完成一個 work item 就自動 ship」的步驟與閘門。本檔與 ship-item.js 內嵌 prompt 為雙份維護：修改任一側 MUST 同步另一側。

## 觸發

一個完成且可驗證的 work item 已經 commit 在某條 feature branch（典型為 `codex/openspec/<change-id>`，或 `docs/*`、`feat/*` 等）。此時 agent SHALL 自動走以下 ship-cycle，不應要求使用者靠記憶手動逐步執行。

## 步驟

0. **checkout / worktree 防呆**：若指定 branch 且當前不在該 branch（`git rev-parse --abbrev-ref HEAD` 比對），不得在主 repo checkout 直接 `git checkout <branch>` / `git switch <branch>`。先跑 `git worktree list`，使用既有 dedicated worktree 或建立 sibling worktree 後再 ship；若已在 dedicated worktree 內，才允許切到該 worktree 對應 branch，避免主 checkout dirty files 污染 PR。
1. **commit 前 check**：`git diff --cached --check`，擋掉 trailing whitespace 與 EOF blank line；有就先修乾淨再 commit。
2. **commit（條件式）**：若無新 staged 改動（work item 已 commit 在 branch）則**跳過**此步；否則訊息用繁體中文，結尾附：

   ```txt
   Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
   ```

3. **push**：`git push -u origin <branch>`。遇 deny rule（如 force-push）改等價路徑——用新 commit 取代 `--amend`，不要硬推。
4. **回報 diff/log**：回報 `git diff --stat origin/main...HEAD`（這次 ship 的 **commit** 改動面，非 worktree diff）與 `git log`（這次的 commit）。
5. **開 PR（若尚無）**：branch 尚無 PR 才 `gh pr create --base main`（已有 PR——如 resume/watch 既有 PR——則沿用，不重複建立）；title / body 繁體中文。
   - 若是 **user-facing capability**，依 `AGENTS.md §0.1` 在 PR body 附 **Frontend Verification table**：

     | 欄位 | 內容 |
     |---|---|
     | Frontend URL | 使用者操作的前端 route |
     | Buttons tested | 實際點過的按鈕 |
     | Test fixture used | 用的預設 fixture |
     | Expected visible result | 前端應看到的領域物件 / 狀態 |
     | E2E command | Playwright / Chrome E2E 指令 |
     | Screenshot / evidence path | 截圖或 trace 證據路徑 |
     | Known limitations | 已知限制 |

   - 若動到 **runtime / deploy** 行為（Docker / Kit / viewer / env / port / conversion-service / demo launch），依 `github-workflow.md` 附 **Deploy Path Verification table**（是否更新 `scripts/deploy.ps1`、`.\scripts\deploy.ps1 -DryRun` 結果或不適用理由）。
   - 純 tooling / docs / spec（無 production code）→ 不適用上述兩表，但 SHALL 在 body 明確說明這點。
5.1. **本機 PR preflight（CI 等待前硬 gate）**：在 push / PR body 更新後、開始 `gh pr checks --watch` 前，MUST 先跑：

   ```powershell
   .\scripts\dev\check-pr-local-preflight.ps1 -PrNumber <n>
   ```

   此命令會用目前 PR body + 本機 `origin/main...HEAD` changed paths 重跑 machine evidence gate，並在 repo-local `.tmp` 下跑 `scripts/pr-review-agent.ps1`（含 affected sub-repo verify，例如 viewer/coordinator/streaming/scripts）。任何本機可重現的 GitHub workflow failure 都不得丟到 GitHub CI 才發現；跳過此步造成等待或重跑，視為嚴重開發時間浪費。若只是在診斷 GitHub 上既有 PR body gate，可暫用 `-ChangedPathsSource remote -SkipReviewAgent -SkipViewerVerify`，但正式 push / CI watch 前不得跳過受影響的本機等效測試。PR body-only 修正不可只 `gh run rerun`，需先本機 preflight 綠，再 push 新 commit（必要時 `--allow-empty`）觸發新的 `pull_request.synchronize`。
6. **觀測 CI**：`gh pr checks <n> --watch`，等官方 checks 跑完。
7. **reviewer buffer**：CI 變綠後 **再等 ~90–120s**。reviewer（pr-review-agent / CodeRabbit / Codex / Copilot）常在 CI 變綠之後才貼出 inline P1/P2，太早查會漏掉。
8. **查 reviewer P0/P1/P2 發現（三處來源，全部 `--paginate`）**：reviewer 的 substantive 發現不只在 inline diff comment 上，gate **三處都要查**。此步只偵測 **P0/P1/P2 等級關鍵字**（`P0`、`P1`、`P2`、`Blocker`、`Critical`、`High`、`CHANGES_REQUESTED`；`P0`/`Blocker`/`Critical` 視同 P1-equivalent hold，`High` 視同 P2），避免把 nit / low / medium / style-only 建議升級成自動修復輸入。任一處有未解除的 P0/P1/P2 finding 都要 hold：

   - **(a) inline diff comment**（`/pulls/<n>/comments`）：用 **`commit_id`**（該 comment **現所在**的 commit）篩當前 head——**不是** `original_commit_id`（comment **首次**留下的 commit；用它會漏掉留在當前 head 上的新 comment）；也**不要用 `group_by`**（未排序輸入不可靠）。
   - **(b) PR-level review**（`/pulls/<n>/reviews`）：review summary 與 `CHANGES_REQUESTED` 狀態（CodeRabbit / Codex / Copilot 的整體 verdict 常落在這裡，不是 inline）。
   - **(c) PR 對話串 issue comment**（`/issues/<n>/comments`）：PR 主對話串（如 pr-review-agent summary 的 **Blockers** 清單）走的是 issue comment endpoint，**不**在 `/pulls/<n>/comments` 內，漏查會放過整篇 Blocker。

   ```bash
   HEAD=$(gh pr view <n> --json headRefOid --jq '.headRefOid')
   # (a) inline diff comment，篩當前 head
   gh api --paginate repos/monkey1sai/AI-BIM-governance/pulls/<n>/comments \
     | jq -s "add | map(select(.commit_id | startswith(\"${HEAD:0:9}\")))"
   # (b) PR-level review（summary / CHANGES_REQUESTED）
   gh api --paginate repos/monkey1sai/AI-BIM-governance/pulls/<n>/reviews \
     | jq -s 'add | map({state, body, user: .user.login, commit_id})'
   # (c) PR 對話串 issue comment（pr-review-agent summary / Blockers）
   gh api --paginate repos/monkey1sai/AI-BIM-governance/issues/<n>/comments \
     | jq -s 'add | map({body, user: .user.login, created_at})'
   ```

   inline comment 只看綁在 **當前 head commit** 上的；review / issue comment 因不綁 diff line，按**內容**判斷該發現是否已被後續 push 真正解決（見下方 carry-forward 原則），不可只因 commit_id 移出當前 head 就當已解決。
   對每個 P0/P1/P2 finding，agent SHALL 建立穩定 key：`source + file/path + line/anchor + normalized finding text`。這個 key 是後續 carry-forward 與「同一處不重複 autofix」的判斷依據。
9. **跨 push carry-forward 未解除的 substantive 發現**：gate **不可**只看「當前 head 是否還有新 comment」就放行。reviewer 在舊 head 提出的 substantive P0/P1/P2，若 agent push 了新 head 但**並未真正修復**（reviewer 未重貼確認、或只是被 force-push / rebase 把 comment 的 `commit_id` 推離當前 head），該發現**仍視為未解除**。實作上：
   - agent SHALL 自行維護一份「**已知未解除的 substantive 發現**」清單（finding → 是否已實際修復）。
   - 每次 push 後**沿用**上一輪清單，逐項判斷是否確已修復（看對應 code 改了沒、reviewer 有無 resolve / 回覆 LGTM），而**不是**把清單清空重來。
   - P0/P1/P2 finding 進入 autofix 前，agent MUST 啟動交叉對抗驗證：builder 先提出最小修法與驗證；verifier 反查 source of truth、blast radius、是否已修過同一 key、是否可能是假陽性或產品決策；coordinator 才裁定 `autofix` / `hold for user` / `reject as false positive`。
   - 同一 finding key 在同一 PR 生命週期內最多只允許 **一次** autofix 嘗試；若同一處再被 reviewer 重貼或 autofix 後仍失敗，agent SHALL 停止第二次自動修補，改為 hold 並回報需要人工/產品裁決。
   - 只有清單中**每一項都確實修復**，且步驟 8 三處來源都無新增 substantive 發現，gate 才算這一軸通過。
   - 「當前 head 無新 comment」**不等於**「舊發現已解決」——comment 因 commit_id 移出當前 head 而被篩掉，**不可**據此放行。
10. **GATE（merge 授權）**：兩條件 **同時** 成立才放行 merge——
   - 官方 checks 全綠：main branch protection 的 **全部 required checks**（現含 `pr-review-agent`、`agent-governance` 與各 build/test 共 11 項；以 GitHub 設定為準。CodeRabbit **非** required check，其發現走步驟 8 三處來源交叉查看）；
   - 步驟 8 三處來源**無新增** substantive P0/P1/P2 / Blocker，**且**步驟 9 的 carry-forward 清單**已全數解除**。
   - 滿足 → `gh pr merge <n> --squash --delete-branch` → 接 **closeout**（見下方「closeout worktree 守衛」）：`git fetch origin --prune`、本地 `main` 用 `--ff-only` 對齊 `origin/main`（依 `github-workflow.md` 的 closeout 盤點規則）。
11. **有新 P0/P1/P2 發現就驗證後修 → 重跑 buffer cycle**：當前 head 出現新的 P0/P1/P2 finding（或 carry-forward 清單仍有未解項）時 → 先做交叉對抗驗證 → 若裁定 autofix，做一次最小修補 → push → **每一次 push 都各自重跑一次 step 6–10 的 buffer cycle**（不是只跑第一輪）。新 push 會產生新 head，舊 inline comment 不再綁當前 head，但其代表的 substantive 發現**未修復前仍留在 carry-forward 清單**；同一 finding key 不得第二次自動修補。

## closeout worktree 守衛（SHALL NOT 移除主 checkout）

closeout 的 `git worktree remove <wt>` **只能**用在 **linked / disposable worktree**（`<repo>/.worktrees/<change-id>/`）。若本次 ship-cycle 是從**主 checkout**（repo root，非 `.worktrees/` 下）跑的，**SHALL NOT** `git worktree remove` 主 checkout——對主 checkout 跑 `worktree remove` 會出錯且危險。

closeout 前先判斷當前是否在 linked worktree，只有 disposable worktree 才 remove：

```bash
GIT_DIR=$(git rev-parse --git-dir)            # linked worktree → .../.git/worktrees/<id>
COMMON=$(git rev-parse --git-common-dir)      # 主 .git 目錄
TOP=$(git rev-parse --show-toplevel)
# linked worktree 判定：git-dir != git-common-dir，或 toplevel 落在 .worktrees/ 下
if [ "$GIT_DIR" != "$COMMON" ] || printf '%s' "$TOP" | grep -q '/.worktrees/'; then
  git worktree remove "$TOP"     # disposable worktree，可安全移除
else
  : # 主 checkout：SHALL NOT git worktree remove；僅做 fetch --prune + main --ff-only
fi
```

## 誠實鐵律

- 絕不 merge 過 production code 上的真 P0/P1/P2。
- 絕不偽裝 CI 綠（不改 check 狀態、不假冒 evidence、未取得的不宣稱 pass）。

## 判斷層次（nuance）

- **production code 的 P0/P1/P2**：一律 hold，修到好才 merge，不放水。
- **非 production 產物**（evidence artifact、docs scaffolding 腳本等）上的 advisory robustness nit：在官方 gate 全綠時可做 judgment-merge，不為了一個非阻斷性的 nit 無限迴圈。
- merge 授權 = 官方 gate（required checks 全綠 + head 無新 substantive P0/P1/P2）；但 CodeRabbit / Codex / Copilot 這類非 required reviewer 的 inline comment 常抓到真 bug，**不可只看 check 狀態就 merge**，必須交叉看 inline 發現。

## 與既有 consent gate 的調和

本檔依使用者 2026-06-03 明確授權的 buffered auto-merge 而生，是 **routine feature PR** 的權威 ship-cycle。當它與既有 `.claude/skills/pr-review-gate/SKILL.md`（「merge 須使用者逐次明確同意」）並存時，依 `CLAUDE.md §1` 優先序「使用者最新明確指令 > AGENTS / github-workflow > installed skills」，**routine feature PR 以本檔的 buffered gate 為準，不再逐次人工同意**。

但下列 carve-out **不被本檔覆蓋、仍須使用者明確 consent**（與 `github-workflow.md` closeout 紀律一致）：

- `revert-*` / release / hotfix branch 的刪除或 merge（語意上代表回滾／發版決策）。
- 任何破壞性或對外（outward-facing）動作（刪資料、改權限、對外發佈、付款等）。

> 本檔**刻意不修改** `pr-review-gate` skill 來放寬其 consent 要求（避免 agent 自我放寬審批門檻）；調和只在本權威檔以優先序聲明，consent skill 本體保留治理上述 carve-out。
>
> 本調和為**文件層的優先序聲明**；`pr-review-gate` skill 本體**刻意不改**（避免 agent 自我放寬 consent，安全層阻擋此類自我放寬是正確的），故該 skill 檔仍保留 consent 字樣治理 carve-out——此為**已知且刻意**的並存，**非矛盾**。

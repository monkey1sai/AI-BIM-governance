# ship-item — Per-item ship-cycle（buffered auto-merge）權威程序

> 本檔是 repo 級 agent 自動化 ship-cycle 的 source of truth。完整 PR / merge / closeout 規則見 `docs/agents/github-workflow.md`；本檔聚焦「每完成一個 work item 就自動 ship」的步驟與閘門。

## 觸發

一個完成且可驗證的 work item 已經 commit 在某條 feature branch（典型為 `codex/openspec/<change-id>`，或 `docs/*`、`feat/*` 等）。此時 agent SHALL 自動走以下 ship-cycle，不應要求使用者靠記憶手動逐步執行。

## 步驟

1. **commit 前 check**：`git diff --cached --check`，擋掉 trailing whitespace 與 EOF blank line；有就先修乾淨再 commit。
2. **commit（條件式）**：若無新 staged 改動（work item 已 commit 在 branch）則**跳過**此步；否則訊息用繁體中文，結尾附：

   ```txt
   Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
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
6. **觀測 CI**：`gh pr checks <n> --watch`，等官方 checks 跑完。
7. **reviewer buffer**：CI 變綠後 **再等 ~90–120s**。reviewer（pr-review-agent / CodeRabbit / Codex / Copilot）常在 CI 變綠之後才貼出 inline P1/P2，太早查會漏掉。
8. **查當前 head 上的新 inline comment**：用 `--paginate` 取**全部頁**（預設 `gh api` 只回第一頁 30 筆，留言多的 PR 會漏掉後頁的 P1/P2），並用 **`commit_id`**（該 comment **現所在**的 commit）篩當前 head——**不是** `original_commit_id`（comment **首次**留下的 commit；用它會漏掉留在當前 head 上的新 comment）；也**不要用 `group_by`**（未排序輸入不可靠）：

   ```bash
   HEAD=$(gh pr view <n> --json headRefOid --jq '.headRefOid')
   gh api --paginate repos/monkey1sai/AI-BIM-governance/pulls/<n>/comments \
     | jq -s "add | map(select(.commit_id | startswith(\"${HEAD:0:9}\")))"
   ```

   只看綁在 **當前 head commit** 上的 comment，舊 head 上已處理過的不算。
9. **GATE（merge 授權）**：兩條件 **同時** 成立才放行 merge——
   - 官方 checks 全綠：`pr-review-agent` **且** `CodeRabbit`；
   - 當前 head **無新的 substantive P1/P2**。
   - 滿足 → `gh pr merge <n> --squash --delete-branch` → 接 **closeout**：`git worktree remove <該 worktree>`、`git fetch origin --prune`、本地 `main` 用 `--ff-only` 對齊 `origin/main`（依 `github-workflow.md` 的 closeout 盤點規則）。
10. **有新發現就修 → 重跑 buffer cycle**：當前 head 出現新的 substantive 發現時 → 修 → push → **每一次 push 都各自重跑一次 step 6–9 的 buffer cycle**（不是只跑第一輪）。新 push 會產生新 head，舊 comment 不再代表當前狀態。

## 誠實鐵律

- 絕不 merge 過 production code 上的真 P1/P2。
- 絕不偽裝 CI 綠（不改 check 狀態、不假冒 evidence、未取得的不宣稱 pass）。

## 判斷層次（nuance）

- **production code 的 P1/P2**：一律 hold，修到好才 merge，不放水。
- **非 production 產物**（evidence artifact、docs scaffolding 腳本等）上的 advisory robustness nit：在官方 gate 全綠時可做 judgment-merge，不為了一個非阻斷性的 nit 無限迴圈。
- merge 授權 = 官方 gate（pr-review-agent + CodeRabbit 全綠 + head 無新 substantive P1/P2）；但 Codex / Copilot 的 inline comment 常抓到真 bug，**不可只看 check 狀態就 merge**，必須交叉看 inline 發現。

## 與既有 consent gate 的調和

本檔依使用者 2026-06-03 明確授權的 buffered auto-merge 而生，是 **routine feature PR** 的權威 ship-cycle。當它與既有 `.claude/skills/pr-review-gate/SKILL.md`（「merge 須使用者逐次明確同意」）並存時，依 `CLAUDE.md §1` 優先序「使用者最新明確指令 > AGENTS / github-workflow > installed skills」，**routine feature PR 以本檔的 buffered gate 為準，不再逐次人工同意**。

但下列 carve-out **不被本檔覆蓋、仍須使用者明確 consent**（與 `github-workflow.md` closeout 紀律一致）：

- `revert-*` / release / hotfix branch 的刪除或 merge（語意上代表回滾／發版決策）。
- 任何破壞性或對外（outward-facing）動作（刪資料、改權限、對外發佈、付款等）。

> 本檔**刻意不修改** `pr-review-gate` skill 來放寬其 consent 要求（避免 agent 自我放寬審批門檻）；調和只在本權威檔以優先序聲明，consent skill 本體保留治理上述 carve-out。

# 分支收斂設計（baseline: origin/main @ 251fda6）

- 日期：2026-07-16
- 產出流程：grill-me 訪談（8 題，逐題定案）→ 本 spec；決策紀錄見 §8
- 狀態：spec 已核准即停止——**本 spec 不含執行**，執行收斂需另行授權
- 執行 lane：收斂本體 = Lane B（repo 維護，無行為契約變更）；gap-a4 子任務 = 獨立任務另行開展

## 0. 背景與 baseline

2026-07-16 盤點時本地累積 17 條分支、16 個 worktree，主因是 PR merge/close 後沒有回頭刪本地分支與 worktree。本 spec 以 **`origin/main @ 251fda6`**（#351 vendor readonly Superpowers skills）為唯一收斂基線。

**併發風險（實測發生）**：盤點進行中，另一 session 已刪除 `chore/pr-348-trust-gate-validation`、`codex/cloud-local-ephemeral-validation` 並 CLOSE PR #348。因此 §4 的執行程序把「執行前逐條重新驗證」定為硬性前置，本 spec 的分支清單只是快照、不是執行時的免驗依據。

## 1. 分支處置總表

盤點快照（撰寫當下 16 條本地分支）。**保留 3 條，刪除 13 條。**

| 分支 | 處置 | 依據 |
|---|---|---|
| main | 保留 | 主幹 |
| docs/branch-convergence-spec | 保留（本 spec 分支；PR 併入後照 §5 規則刪） | — |
| feat/gap-a4-closeout | 保留 + rebase（見 §3） | 有未併入的真實工作（E2E spec + 證據 + BACKLOG/TRUTH） |
| claude/repo-understanding-6bd459 | 刪除 | #350 已 squash 併入 main |
| claude/ecstatic-davinci-f178e9 | 刪除 | #344 已併入 |
| claude/nostalgic-bose-c84bb1 | 刪除 | #346 已併入 |
| claude/charming-wozniak-ac6b0f | 刪除 | 內容已在 main（patch 等效） |
| claude/zen-chebyshev-99c458 | 刪除 | #344 原始分支，內容已在 main |
| claude/wizardly-williams-111dbb | 刪除 | #343 已併入 |
| claude/design-gate-semantic-exec | 刪除 | 內容已在 main |
| claude/admiring-hellman-14b370 | 刪除 | 被 #350 取代；殘餘 ~160 行 pr-review-agent mirror-path 邏輯**經裁決丟棄**（#351 已重做 skill 管理；如日後需要從 reflog 撈回） |
| claude/ai-bim-docs-migration-9a0cb8 | 刪除 | 兩筆 commit 被 #342/#343 完全取代 |
| backup-pre-rebase-0e23c13 | 刪除 | rebase 已完成且結果在 main，備份退場 |
| chore/repo-health-convergence | 刪除 | #339 已併入 |
| codex-governance/skill-config-repair-20260714 | 刪除 | 已併入 main |
| docs/rebuild-design-gate-lineage-contract | 刪除 | 樹與 main 完全相同（0 ahead / 0 behind） |

一律**不留 archive tag**（裁決：內容都在 main，git reflog 90 天內可救回，tag 只是噪音）。

## 2. worktree 處置

裁決範圍：**只清「掛在待刪分支上」的 worktree**，detached 與部署區一律不動。

| worktree | 掛載分支 | 處置 |
|---|---|---|
| `.worktrees/repo-health-convergence` | chore/repo-health-convergence（待刪） | 移除 |
| `.worktrees/codex-governance-20260714` | codex-governance/skill-config-repair-20260714（待刪） | 移除 |
| `.worktrees/design-gate-lineage-contract` | docs/rebuild-design-gate-lineage-contract（待刪） | 移除 |
| `.claude/worktrees/wizardly-williams-111dbb` | claude/repo-understanding-6bd459（待刪；注意目錄名與掛載分支不同） | 移除 |
| 主 checkout（main）、`.worktrees/branch-convergence`、`AI-BIM-governance.worktrees/gap-a4-closeout` | 保留分支 | 不動 |
| `.claude/worktrees/ai-bim-docs-migration-9a0cb8`、`.claude/worktrees/zen-chebyshev-99c458` | detached | 不動（範圍外） |
| `C:/Users/IOT/.codex/worktrees/*`（5 個，全 detached 於同一舊 commit） | detached | 不動（Codex 管轄，範圍外） |
| `D:/Users/deploy/AI-bim-geo` | detached | 不動（部署區） |

## 3. feat/gap-a4-closeout 收斂子任務

分支內容（vs merge-base，8 檔 +159/−9）：`web-viewer-sample/e2e/a4-closeout.spec.ts`（99 行）、`artifacts/e2e/a4-trace/`（2 張截圖 + 2 個 trace.zip 共約 5 MB 二進位 + summary.json）、`docs/plans/BACKLOG.md`、`docs/plans/TRUTH.md`。

衝突點：main 的 #350 已裁定「functional gate 產物除籍」（tracked 證據檔導致 producer 重跑改寫 tracked 檔 → `workspace_clean=false` 假紅）。本分支照舊把證據 track 進 `artifacts/e2e/`，直接 rebase 會把問題帶回 main。

裁決處置：

1. rebase onto `origin/main`（執行時的當下 origin/main，不鎖死 251fda6）。
2. 證據改點安置：`artifacts/e2e/a4-trace/` 的截圖與 trace.zip **移出 tracked 範圍**（依除籍政策留在 untracked 的 `artifacts/e2e/` 慣例路徑）；summary.json + 抽樣截圖改放 `docs/evidence/gap-a4-closeout/`（tracked、隨 PR 可審，對齊 product-operability §5 慣例）。
3. `a4-closeout.spec.ts` 與 BACKLOG/TRUTH 更新照帶。
4. 完成後走正常 PR 流程（PR body 依 github-workflow 規範填 machine fields）。

## 4. 執行程序（安全檢查內建；執行需另行授權）

1. **重新驗證（硬性前置）**：`git fetch --prune` 後，逐條待刪分支檢查——
   - `git log origin/main..<branch> --oneline` 為空 → 可刪；
   - 非空（squash 併入者必然非空）→ 再以 `git diff origin/main <branch>` 確認唯一內容確實無保留價值（對照 §1 依據欄），有疑義即跳過並回報，不得硬刪。
2. **先 worktree 後分支**：對 §2 待移除 worktree 逐一 `git worktree remove <path>`；worktree 內有未提交變更 → **停下回報使用者**，不得 `--force`。全部移除後才 `git branch -D <branch>`。
3. 收尾：`git worktree prune`；`git fetch --prune`。
4. 產出清理報告：實刪分支/worktree 清單、跳過項目與原因、與本 spec 快照的差異（併發變動）。

**工具注意（實測教訓）**：Cowork 沙盒掛載對 `.git` 的 unlink/rename 不可靠（會留下 `index.lock`/`config.lock` 殘骸、config 寫入截斷）。所有 git 寫操作一律走 host 端（PowerShell / 本機 shell），不得經沙盒掛載執行。

## 5. 防再發散規則（極簡 3 條；建議另 PR 同步進 AGENTS.md 體系）

1. PR merged/closed 後，同一工作階段內刪除對應本地分支與 worktree（squash merge 用 `git branch -D`）。
2. `claude/<隨機名>` 分支存活期不得超過其 PR 週期；沒有對應 PR 的，7 天內裁決去留。
3. 每週一次 `git fetch --prune` + 分支/worktree 盤點（人工或排程任務）。

## 6. 驗收標準

- 本地分支僅剩：`main`、`feat/gap-a4-closeout`（完成 §3 前）、`docs/branch-convergence-spec`（其 PR 併入前）。
- `git worktree list` 無任何掛在已刪分支上的項目；無 prunable 項目。
- gap-a4 後續 PR 不因 tracked 證據觸發 `workspace_clean` 假紅。
- 清理報告已產出且與實際狀態一致。

## 7. 明確不做（out of scope）

- 不動 detached worktree（`.claude/worktrees` 2 個、`.codex` 5 個、`D:\` 部署區）。
- 不動遠端（現僅 `origin/main`；fetch.prune 已設，遠端無收斂需求）。
- 不在本 spec 內執行任何刪除；不自動串接 writing-plans 或後續 Superpowers lifecycle（Lane 規範：重流程 skill explicit-only）。

## 8. 決策紀錄（grill-me 訪談）

| # | 問題 | 裁決 |
|---|---|---|
| 1 | 收斂範圍 | 分支 + worktree 一起收 |
| 2 | 10 條內容已在 main 的分支 | 直接刪，不留 tag |
| 3 | admiring-hellman 殘餘 160 行 mirror-path 邏輯 | 丟棄，直接刪分支 |
| 4 | ai-bim-docs-migration + backup-pre-rebase | 兩條都直接刪 |
| 5 | 進行中分支（訪談中縮減為僅 gap-a4） | 逐條審查後：保留 + rebase + 證據改點安置 |
| 6 | worktree 清理範圍 | 只清掛在待刪分支上的 |
| 7 | 防再發散 | 極簡 3 條規則入 spec |
| 8 | 交付形式 | commit + push 開 draft PR |

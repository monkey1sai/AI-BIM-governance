# Tasks

> **Retro-audited 2026-05-21**：archive commit fe29121 自述 documentation lag（implementation PR #79 bab2c95 已 merged）。本次依 CLAUDE.md §2 newer-wins conflict resolution 對 PR #79 diff 與當前 repo 狀態逐項回填，evidence 引用 commit / 檔案路徑。

## 1. Runbook（docs）— 主要交付

- [x] 1.1 建立 `docs/demo/fast-mvp-demo-recap.md` — PR #79 新增 172 行
- [x] 1.2 加入雲地分離邊界回顧區塊，引用 `CLAUDE.md` §2 與 `AGENTS.md` 而非複製 — runbook §2 表格
- [x] 1.3 加入三服務 port matrix 表格（49100 / 49101 / 8004 / 5173 + host vs container 標註）— runbook §3
- [x] 1.4 加入 WSL Kit graphics 阻擋說明，引用 `runtime-image-linux-kit-launcher-readiness` deferred 狀態與 `docs/runbooks/FAST_MVP_DOCKER_KIT_MANAGER.md`（補述為何 host-native 為 demo 主路徑）— runbook §3 第一列
- [x] 1.5 加入「從零到 demo」啟動順序步驟，**直接引用既有 scripts**：
      - `scripts/start-all.ps1`（一鍵啟動三服務）
      - `scripts/demo-health-check.ps1`（coordinator + viewer health）
      - `scripts/smoke-bscheme-intake.ps1`（spec-correct ifc-ready 觸發 + 等 conversion + publish callback + evidence）
      - `CLAUDE.md` §5 既有 verification 入口作為基準驗證
      — runbook §5
- [x] 1.6 加入「現場操作三步劇本」（按 `start-all.ps1` → `demo-health-check.ps1` → `smoke-bscheme-intake.ps1` 或手動 viewer 操作）— runbook §5
- [x] 1.7 加入 storage/ 樣本選擇條件（`storage/*.ifc` 必須是 top-level，符合 `smoke-bscheme-intake.ps1` 的 `Get-TopLevelIfcFixtures` 規則），並提示「現場不要抽不認識的檔」原則 — runbook §4 step 4 / §5 step 2
- [x] 1.8 加入驗收長相區塊（成功 / 失敗 / 灰色情境 — 對齊 `smoke-bscheme-intake.ps1` 的 tier 狀態語意：`passed` / `failed` / `blocked` / `deferred` / `not_observed`）— runbook §6
- [x] 1.9 加入 Non-goals 區塊明寫排除的 roadmap Phase 1/2/5/6 元件，並提醒 `_worker` / `_bim-control` 已從 product runtime 刪除（僅 `tests/fakes`）— runbook §8

## 2. Roadmap 交叉索引

- [x] 2.1 在 `docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md` 加一段「fast MVP demo 短路徑」交叉索引到 `docs/demo/fast-mvp-demo-recap.md` — line 45 之 2026-05-20 更新區塊
- [x] 2.2 若該 roadmap 有對應的 `.html` 鏡像，同步更新（透過 `scripts/render-roadmap-html.py` 或在 archive 階段補）— `AI-BIM-governance-saas-roadmap-2026-05.html` line 310 同步區塊

## 3. OpenSpec spec delta

- [x] 3.1 建立 `openspec/changes/recap/specs/demo-fast-mvp-orchestration/spec.md`，定義新 capability 的 requirements
- [x] 3.2 校正 spec：runbook 引用既有 scripts，不新增 `scripts/demo/` 子目錄 — spec line 18/21「SHALL NOT introduce a new `scripts/demo/` subdirectory」
- [x] 3.3 確保 `openspec validate recap --strict` 綠燈 — PR #79 commit msg 自證；archive 後 `openspec validate --specs --strict` 25 passed

## 4. Verification（apply-and-verify 階段）

- [x] 4.1 `openspec validate recap --strict` 綠燈 — PR #79 commit msg verification 段
- [x] 4.2 `git diff --check` 無 whitespace 錯誤 — PR #79 commit msg verification 段
- [x] 4.3 GitNexus `detect_changes` 確認本 change 不動 production symbol（預期 risk_level = LOW；GitNexus CLI 在 worktree 有已知 quoting bug，可用靜態 `git diff --stat` 佐證）— PR #79 commit msg；fallback by `git diff --stat`，符合 memory `opsx-worktree-closeout-gotchas`
- [x] 4.4 既有 root contracts test (`python -m pytest tests -p no:cacheprovider`) 維持綠燈（baseline check）— PR #79 commit msg 「7 passed」
- [x] 4.5 Runbook 內所有指令字串實際存在於 repo（path / script 名稱可被 grep 命中）— PR #79 commit msg「runbook 引用路徑經 grep 驗證」

## 5. Commit & PR

- [x] 5.1 用 Conventional Commits 訊息：`docs(openspec): recap — fast MVP demo runbook（引用既有 scripts，不新增 production code）` — commit bab2c95 subject 對齊
- [x] 5.2 push `codex/openspec/recap` 並開 implementation PR — PR #79
- [x] 5.3 PR body 標註：
      - predecessor `coordinator-ifc-ready-worker-webhook` archive 未落地的提醒
      - GitNexus blast radius = LOW（純 docs，零 production symbol 改動）
      - 本 change 不新增 production dependency
      — PR #79 commit msg 三項皆涵蓋
- [x] 5.4 等使用者明確同意才 `gh pr merge`（Phase E review gate）— PR #79 已 merged

## 6. Archive（Phase F，使用者觸發）

- [x] 6.1 由使用者執行 `/archive-and-closeout recap` — archive commit fe29121 / PR #81 已落地

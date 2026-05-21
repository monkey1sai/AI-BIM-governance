# Tasks

## 1. Runbook（docs）— 主要交付

- [ ] 1.1 建立 `docs/demo/fast-mvp-demo-recap.md`
- [ ] 1.2 加入雲地分離邊界回顧區塊，引用 `CLAUDE.md` §2 與 `AGENTS.md` 而非複製
- [ ] 1.3 加入三服務 port matrix 表格（49100 / 49101 / 8004 / 5173 + host vs container 標註）
- [ ] 1.4 加入 WSL Kit graphics 阻擋說明，引用 `runtime-image-linux-kit-launcher-readiness` deferred 狀態與 `docs/runbooks/FAST_MVP_DOCKER_KIT_MANAGER.md`（補述為何 host-native 為 demo 主路徑）
- [ ] 1.5 加入「從零到 demo」啟動順序步驟，**直接引用既有 scripts**：
      - `scripts/start-all.ps1`（一鍵啟動三服務）
      - `scripts/demo-health-check.ps1`（coordinator + viewer health）
      - `scripts/smoke-bscheme-intake.ps1`（spec-correct ifc-ready 觸發 + 等 conversion + publish callback + evidence）
      - `CLAUDE.md` §5 既有 verification 入口作為基準驗證
- [ ] 1.6 加入「現場操作三步劇本」（按 `start-all.ps1` → `demo-health-check.ps1` → `smoke-bscheme-intake.ps1` 或手動 viewer 操作）
- [ ] 1.7 加入 storage/ 樣本選擇條件（`storage/*.ifc` 必須是 top-level，符合 `smoke-bscheme-intake.ps1` 的 `Get-TopLevelIfcFixtures` 規則），並提示「現場不要抽不認識的檔」原則
- [ ] 1.8 加入驗收長相區塊（成功 / 失敗 / 灰色情境 — 對齊 `smoke-bscheme-intake.ps1` 的 tier 狀態語意：`passed` / `failed` / `blocked` / `deferred` / `not_observed`）
- [ ] 1.9 加入 Non-goals 區塊明寫排除的 roadmap Phase 1/2/5/6 元件，並提醒 `_worker` / `_bim-control` 已從 product runtime 刪除（僅 `tests/fakes`）

## 2. Roadmap 交叉索引

- [ ] 2.1 在 `docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md` 加一段「fast MVP demo 短路徑」交叉索引到 `docs/demo/fast-mvp-demo-recap.md`
- [ ] 2.2 若該 roadmap 有對應的 `.html` 鏡像，同步更新（透過 `scripts/render-roadmap-html.py` 或在 archive 階段補）

## 3. OpenSpec spec delta

- [x] 3.1 建立 `openspec/changes/recap/specs/demo-fast-mvp-orchestration/spec.md`，定義新 capability 的 requirements
- [ ] 3.2 校正 spec：runbook 引用既有 scripts，不新增 `scripts/demo/` 子目錄
- [ ] 3.3 確保 `openspec validate recap --strict` 綠燈

## 4. Verification（apply-and-verify 階段）

- [ ] 4.1 `openspec validate recap --strict` 綠燈
- [ ] 4.2 `git diff --check` 無 whitespace 錯誤
- [ ] 4.3 GitNexus `detect_changes` 確認本 change 不動 production symbol（預期 risk_level = LOW；GitNexus CLI 在 worktree 有已知 quoting bug，可用靜態 `git diff --stat` 佐證）
- [ ] 4.4 既有 root contracts test (`python -m pytest tests -p no:cacheprovider`) 維持綠燈（baseline check）
- [ ] 4.5 Runbook 內所有指令字串實際存在於 repo（path / script 名稱可被 grep 命中）

## 5. Commit & PR

- [ ] 5.1 用 Conventional Commits 訊息：`docs(openspec): recap — fast MVP demo runbook（引用既有 scripts，不新增 production code）`
- [ ] 5.2 push `codex/openspec/recap` 並開 implementation PR
- [ ] 5.3 PR body 標註：
      - predecessor `coordinator-ifc-ready-worker-webhook` archive 未落地的提醒
      - GitNexus blast radius = LOW（純 docs，零 production symbol 改動）
      - 本 change 不新增 production dependency
- [ ] 5.4 等使用者明確同意才 `gh pr merge`（Phase E review gate）

## 6. Archive（Phase F，使用者觸發）

- [ ] 6.1 由使用者執行 `/archive-and-closeout recap`

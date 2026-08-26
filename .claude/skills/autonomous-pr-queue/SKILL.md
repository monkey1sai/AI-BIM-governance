---
name: autonomous-pr-queue
description: 自主 PR 佇列管理與自動合併技能 — 支援多 Session 並行、自動更新分支、智慧非破壞性解衝突 (.gitignore/docs/tasks)、預檢元數據自動修復、CI 綠燈追蹤、Blip 人工等效審批與自動 Squash Merge。
argument-hint: "（選填）指定動作：status / run / watch / auto-fix / approve / merge / install-hooks"
---

# autonomous-pr-queue — 自主 PR 佇列與自動合併引擎

本技能用於協調跨 Session（AGY、Codex、Claude、Grok）並行開發時的 PR 自動流轉，負責多 PR 自動更新、智慧解衝突、預檢修復、審批與合併。

## 核心功能

1. **狀態檢查 (Status)**：即時列出所有 Open PR 的 base/head、落後 main 狀態、CI 綠燈情況與審批狀態。
2. **自動更新與解衝突 (Auto-Update & Smart Conflict Resolution)**：
   - 偵測 PR 分支落後 `origin/main` 時，自動於隔離 worktree 合併。
   - 對 `.gitignore` 實施例外規則聯集合併 (`!.claude/launch.json` + `!.claude/output-styles/`)。
   - 對 `docs/current_task.md`、`docs/superpowers/plans/*`、`docs/plans/*`、`artifacts/*`、`.agents/*` 等非關鍵檔案進行安全覆蓋解衝突。
   - 對核心業務代碼衝突嚴格中斷並發出警報，絕不破壞原碼。
3. **預檢與元數據自動修復 (Auto-Fix Preflight)**：
   - 自動執行 `check-pr-local-preflight.ps1`，校正 Design gate status、Manifest 畫面與 missing 路由。
4. **自動審批 (Code Review & Blip Approval)**：
   - CI 23 項檢查 100% 綠燈後，自動調用 Blip 人工等效審批協議。
5. **自動合入與快進同步 (Auto-Merge & Fast-Forward)**：
   - 清理衝突工作區，執行 `gh pr merge --squash --delete-branch`，並調用 `syncMainSafely()` 快進更新本地 `main`。

## 操作指令

```powershell
# 1. 查詢佇列狀態
node scripts/dev/manage-pr-queue.mjs status

# 2. 單次執行全自動佇列推進（更新/修復/審批/合併）
node scripts/dev/manage-pr-queue.mjs run-queue

# 3. 針對特定 PR 執行自動修復
node scripts/dev/manage-pr-queue.mjs auto-fix --pr <prNumber>

# 4. 針對特定 PR 執行更新分支與解衝突
node scripts/dev/manage-pr-queue.mjs update-branch --pr <prNumber>

# 5. 針對特定 PR 執行 Blip 審批
node scripts/dev/manage-pr-queue.mjs approve --pr <prNumber>

# 6. 針對特定 PR 執行合併
node scripts/dev/manage-pr-queue.mjs merge --pr <prNumber>

# 7. 啟動背景巡航守護程序
node scripts/dev/manage-pr-queue.mjs watch --interval 30

# 8. 安裝本機 Git Hooks
node scripts/dev/manage-pr-queue.mjs install-hooks
```

## 多 Session 自動觸發機制 (Hook Integration)

- **看板 Hook**：所有 CLI 在執行 `register`、`done`、`Stop`、`codex-notify` 時，系統會在背景自動非同步調用 `node scripts/dev/manage-pr-queue.mjs hook`。
- **Git Hooks**：在本地執行 `git commit`、`git merge`、`git checkout` 時自動於背景觸發。
- **原子互斥鎖**：透過 `.agents/board/pr-queue.lock` 防止多程序競態衝突。

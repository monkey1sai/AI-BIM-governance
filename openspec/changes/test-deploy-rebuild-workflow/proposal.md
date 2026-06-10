## Why

測試部署區 `D:\Users\deploy\AI-bim-geo` 需要一條可重複、可審查、不可偷換路徑的重建流程，避免 agent 以 stale checkout、目前 worktree、`-DryRun` 或 sub-repo 啟動命令替代正式部署驗證。

此 change 將「請測試部署區重建」口令正式規格化：從 freshly fetched `origin/main` 重建固定部署 checkout，移除 agent/tooling 與非 runtime 文件目錄後，僅能透過部署區 `scripts\deploy.ps1 -Build` 拉起環境。

## What Changes

- 新增 `scripts\dev\rebuild-test-deploy.ps1 -Build` 作為唯一測試部署區重建入口。
- 新增 `scripts\lib\rebuild-test-deploy.ps1`，負責固定 path 檢查、fetch `origin/main`、reset/clean、移除 agent/tooling artifact，最後在部署區執行 `scripts\deploy.ps1 -Build`。
- 新增 `scripts\tests\test-rebuild-test-deploy.ps1`，覆蓋固定 path guard、清理規則、fetch fail-fast、deploy exit code propagation、禁止 `DryRun` token 等行為。
- 更新 `AGENTS.md`、`CLAUDE.md` 與 `docs/agents/*`，把使用者口令、禁止 `-DryRun`、fresh main、固定目錄與 blocker handling 寫成 agent 操作規則。
- 清理規則包含所有層級 `AGENTS.md` / `CLAUDE.md`，root `.codex/`、`.agents/`、`.agent/`、`.claude/`、`.cursor/`、`.windsurf/`、`.github/skills/`、`.github/prompts/`、`docs/`、`openspec/`、`patches/`；保留 `.github/workflows/`。
- 非目標：不修改 product runtime API、不新增服務、不改 IFC / USDC / session / governance data shape、不改 `scripts\deploy.ps1` 的 deploy contract。

## Capabilities

### New Capabilities

- `test-deploy-rebuild-workflow`: 定義 agent 觸發測試部署區重建時的固定入口、來源 checkout、清理規則、部署命令與失敗處理。

### Modified Capabilities

- None.

## Impact

- Owner repo / folder：`scripts/dev/`、`scripts/lib/`、`scripts/tests/`、根目錄 agent 入口文件與 `docs/agents/`。
- API / data shape：無變更。
- Runtime boundary：部署區會被 reset / clean，且移除 agent/tooling 與非 runtime 文件目錄；實際拉起環境仍由部署區 `scripts\deploy.ps1 -Build` 負責。
- Dependencies：無新增生產依賴；測試沿用純 PowerShell helper。
- Operator impact：要求 agent 未來遇到同義口令時只能使用 `scripts\dev\rebuild-test-deploy.ps1 -Build`，不得使用 `-DryRun` 或其他啟動命令。

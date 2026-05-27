# scripts/ Agent Rules

本檔是 `scripts/` 的 repo-local agent 規範。根目錄 `AGENTS.md` 仍是跨 repo 邊界與資料流的上位規範。

## Role

`scripts/` 是 workspace 層的 **驗證 / smoke / deploy / preflight 入口集合**。所有跨 sub-repo 的 verify、host-native Kit 啟動、Docker compose 啟停、log retention、PR review agent 都集中在此；個別 sub-repo 內部的 build / test 不屬於本 folder。

## Owns

- `verify-all.{ps1,sh}` — workspace 聚合驗證入口
- `smoke-*.ps1` — 跨 service smoke（review-session / review-socket / host-native-conversion / bscheme-intake / worker-review-request）
- `deploy.ps1` / `start-all.{ps1,sh}` / `stop-all.{ps1,sh}` — 一鍵部署與啟停
- `start-*-docker.ps1` / `stop-*-docker.ps1` / `check-*-docker.ps1` — runtime-manager / web-plane Docker 控制
- `start-demo-streaming-server.ps1` / `start-local-review-mvp.ps1` / `run-single-kit-demo.ps1` — demo runtime 啟動
- `scripts/lib/` — preflight / launcher / structured log 共用 module
- `scripts/log-retention/` — log 保存策略
- `scripts/tests/` — script-level pester / pytest 測試
- `claude-commit-guard.ps1` — Claude PreToolUse hook target
- `pr-review-agent.ps1` — PR review agent CLI
- `render-roadmap-html.py` — roadmap doc generator

## Does Not Own

- sub-repo 內部 build / test 邏輯（屬於各 sub-repo `AGENTS.md`）
- production runtime 邏輯（屬於 `bim-streaming-server` / `bim-review-coordinator`）
- contract / spec 定義（屬於 `tests/contracts/` 與 `openspec/specs/`）
- Dockerfile 與 image build（屬於 `infra/`）

## Required Boundaries

- MUST 保持 PowerShell 7+（pwsh）相容；Bash mirror（`.sh`）若存在需與 `.ps1` 行為一致。
- MUST 用 `scripts/lib/StructLog.psm1` 輸出 structured log，不要用裸 `Write-Host` 取代。
- MUST NOT 在 script 內 inline secrets；走 `.env*` 與環境變數（讀寫規則見根目錄 `AGENTS.md` §0.1）。
- MUST NOT 修改其他 sub-repo 的 source；deploy / smoke 只能呼叫 sub-repo 對外的 build / test / start command。
- MUST NOT 直接呼叫 Windows `.bat`；走 `.ps1` wrapper + `Start-Process` 完整路徑（避開 git-bash 對 `/c` 與 `$` 的破壞）。

## Before Editing

- 先讀目標 `.ps1` / `.sh` 與 `scripts/lib/` 共用 helper。
- 改 deploy / smoke 行為前先看 `scripts/tests/test-deploy-dryrun.ps1` 等對應 script-level test。
- 跨 sub-repo 行為改動需檢查根目錄 `docs/agents/sub-repo-verify-commands.md`。
- 新增 script MUST 有對應 dry-run mode 或 script-level test。

## Verify

```powershell
pwsh scripts/verify-all.ps1 -TsOnly
```

完整跨 sub-repo 驗證見 `docs/agents/sub-repo-verify-commands.md`。

## Done Criteria

- 改動沒有讓 script 變成 sub-repo runtime / metadata authority。
- 相關 script-level test 通過，或清楚說明未跑原因。
- 最終回覆列出 changed files、validation、known risks。

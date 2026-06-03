# scripts/ Agent Rules

本檔是 `scripts/` 的 repo-local agent 規範。根目錄 `AGENTS.md` 仍是跨 repo 邊界與資料流的上位規範。

## Role

`scripts/` 是 workspace 層的 **deploy / verify / preflight / script-governance 入口集合**。它不應再無限制吸收新的 root-level 啟動腳本；跨 sub-repo 的一鍵部署與驗證必須收斂到 canonical entrypoints，個別 sub-repo 內部的 build / test 不屬於本 folder。

## Owns

- `deploy.ps1` — canonical one-click deploy / demo golden path
- `verify-all.{ps1,sh}` — workspace 聚合驗證入口
- `stop-all.{ps1,sh}` — workspace 停止 / cleanup 入口
- `start-all.{ps1,sh}` / `start-*-docker.ps1` / `stop-*-docker.ps1` / `check-*-docker.ps1` — internal adapters / legacy mode adapters；不得當新 golden path
- `smoke-*.ps1` / `run-single-kit-demo.ps1` / `verify-runtime-*.ps1` — 現有 smoke / evidence scripts；新增同類腳本預設不得放 root scripts
- `scripts/lib/` — preflight / launcher / structured log 共用 module
- `scripts/log-retention/` — log 保存策略
- `scripts/tests/` — script-level pester / pytest 測試
- `claude-commit-guard.ps1` — Claude PreToolUse hook target
- `pr-review-agent.ps1` — PR review agent CLI
- `render-roadmap-html.py` — roadmap doc generator
- `SCRIPT_CONTRACT.md` / `script-registry.json` — root-level script contract 與允許清單

## Does Not Own

- sub-repo 內部 build / test 邏輯（屬於各 sub-repo `AGENTS.md`）
- production runtime 邏輯（屬於 `bim-streaming-server` / `bim-review-coordinator`）
- contract / spec 定義（屬於 `tests/contracts/` 與 `openspec/specs/`）
- Dockerfile 與 image build（屬於 `infra/`）

## Required Boundaries

- MUST 把 deploy / runtime / demo 行為收斂回 `scripts/deploy.ps1`；新增 root-level `start-*.ps1`、`smoke-*.ps1`、`check-*.ps1`、`*-docker.ps1` 預設視為錯誤，除非更新 `script-registry.json` 與 `SCRIPT_CONTRACT.md` 並說明為何不能放 `deploy.ps1`、`verify-all.ps1`、`scripts/lib/`、`scripts/tests/` 或 `tests/e2e/`。
- MUST 對 runtime / Docker / Kit / viewer / env / port / conversion-service 改動更新或明確驗證 `deploy.ps1`，至少提供 `.\scripts\deploy.ps1 -DryRun` 結果或無法執行原因。
- MUST 保持 PowerShell 7+（pwsh）相容；Bash mirror（`.sh`）若存在需與 `.ps1` 行為一致。
- MUST 用 `scripts/lib/StructLog.psm1` 輸出 structured log，不要用裸 `Write-Host` 取代。
- MUST NOT 在 script 內 inline secrets；走 `.env*` 與環境變數（讀寫規則見根目錄 `AGENTS.md` §0.1）。
- MUST NOT 修改其他 sub-repo 的 source；deploy / smoke 只能呼叫 sub-repo 對外的 build / test / start command。
- MUST NOT 直接呼叫 Windows `.bat`；走 `.ps1` wrapper + `Start-Process` 完整路徑（避開 git-bash 對 `/c` 與 `$` 的破壞）。

## Before Editing

- 先讀 `SCRIPT_CONTRACT.md` 與 `script-registry.json`。
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
- runtime / deploy 相關改動已更新或驗證 `scripts/deploy.ps1`，或清楚說明不適用原因。
- 新增 / 修改 root-level script 已同步 `script-registry.json`；否則不算完成。
- 相關 script-level test 通過，或清楚說明未跑原因。
- 最終回覆列出 changed files、validation、known risks。

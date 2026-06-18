## ADDED Requirements

### Requirement: 測試部署區重建 SHALL 只使用 fixed deployment checkout 與 fresh origin/main

測試部署區重建流程 SHALL 由 repo 內 `scripts\dev\rebuild-test-deploy.ps1 -Build` 觸發。流程 SHALL 操作固定 deployment checkout `D:\Users\deploy\AI-bim-geo`，並在 reset 前 freshly fetch `origin` with `+refs/heads/main:refs/remotes/origin/main`。若 fetch 失敗，流程 MUST fail fast 並回報 blocker；流程 SHALL NOT 使用 stale `origin/main`、目前 worktree、任意替代路徑或 sub-repo 啟動命令。

#### Scenario: fetch 成功後 deployment checkout reset 到 origin/main

- **WHEN** 操作者要求測試部署區重建且 `origin/main` fetch 成功
- **THEN** deployment checkout SHALL reset 到 freshly fetched `origin/main`
- **AND** 流程 SHALL 在 reset 前回報 deployment checkout local changes 摘要
- **AND** 流程 SHALL NOT 從目前 development worktree 直接啟動服務

#### Scenario: fetch 失敗時停止且不部署 stale code

- **WHEN** `origin/main` fetch 因 network、auth 或 remote error 失敗
- **THEN** 流程 MUST 停止並回報 fetch blocker
- **AND** 流程 SHALL NOT reset 到既有 stale tracking ref
- **AND** 流程 SHALL NOT 執行 `scripts\deploy.ps1`

### Requirement: 測試部署區 SHALL 移除 agent/tooling 與非 runtime 文件目錄

deployment checkout reset / clean 後，流程 SHALL 移除所有層級 `AGENTS.md` / `CLAUDE.md`，以及 root `.codex/`、`.agents/`、`.agent/`、`.claude/`、`.cursor/`、`.windsurf/`、`.github/skills/`、`.github/prompts/`、`docs/`、`openspec/`、`patches/`。流程 SHALL 保留 `.github/workflows/` 與 production runtime 檔案，例如 `scripts\deploy.ps1`、services、tests 與 compose files。

#### Scenario: 清理後 deployment checkout 不含 agent/planning artifact

- **WHEN** deployment checkout 含有 `AGENTS.md`、`CLAUDE.md`、`.codex/`、`.agents/`、`.claude/`、`.github/skills/`、`.github/prompts/`、`docs/`、`openspec/`、`patches/`
- **THEN** 流程 SHALL 移除上述檔案與目錄
- **AND** `.github/workflows/` SHALL 仍存在
- **AND** `scripts\deploy.ps1` SHALL 仍存在，否則流程 MUST fail before deploy

### Requirement: 測試部署區重建 SHALL 只透過 deploy.ps1 -Build 拉起環境

清理完成後，流程 SHALL 從 `D:\Users\deploy\AI-bim-geo` 執行 `.\scripts\deploy.ps1 -Build`，並回報 deployment path、origin main commit、removed artifact count、deploy exit code 與 deploy log path。流程 MUST NOT 支援或使用 `-DryRun` 代替 `-Build`。若 `deploy.ps1 -Build` 回傳非 0，wrapper SHALL 以同一 exit code 失敗。

#### Scenario: deploy.ps1 -Build 成功時回報部署結果

- **WHEN** deployment checkout 清理完成且 `scripts\deploy.ps1 -Build` exit code 為 0
- **THEN** wrapper SHALL exit 0
- **AND** wrapper SHALL 回報 deployment path、fresh origin/main commit、removed artifact count、deploy exit code 與 log path

#### Scenario: deploy.ps1 -Build 失敗時傳遞 exit code

- **WHEN** `scripts\deploy.ps1 -Build` exit code 非 0
- **THEN** wrapper SHALL 回傳相同 exit code
- **AND** wrapper SHALL 回報 deploy log path 與 failure context
- **AND** wrapper SHALL NOT 改用 `-DryRun`、`-Force` 或其他替代 command

#### Scenario: host-native runtime blocker 只允許停止必要 blocking process

- **WHEN** `deploy.ps1 -Build` Phase 3 被外部 `kit.exe` 或 conversion `python.exe` 佔用必要 ports 阻擋
- **THEN** agent MAY 停止該 blocking PID 並重跑同一條 `deploy.ps1 -Build`
- **AND** agent MUST 記錄 port、PID 與 process name
- **AND** agent SHALL NOT 停止無關 process 或改用 `-Force` / `-DryRun`

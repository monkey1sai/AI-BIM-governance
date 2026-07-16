# Script Contract

本文件定義 `scripts/` 的入口邊界，目標是防止 AI 或人員為每個新問題新增一個 root-level 啟動腳本，導致一鍵部署路徑失控。

## Canonical Operator Entrypoints

正式 operator 只應優先使用：

| Script | Role |
|---|---|
| `scripts/deploy.ps1` | canonical one-click deploy / demo golden path |
| `scripts/verify-all.ps1` | canonical aggregate verification |
| `scripts/stop-all.ps1` | canonical stop / cleanup path |

`scripts/deploy.ps1` 是 build / deploy / demo launch 的主入口。任何會影響 Docker、Kit runtime、coordinator、viewer、ports、env、conversion-service、demo launch 的改動，都必須更新或明確驗證它。

## Internal Adapters

這些 script 可以存在，但不應成為新的 golden path：

- `scripts/start-all.ps1`
- `scripts/start-runtime-manager-docker.ps1`
- `scripts/start-web-plane-docker.ps1`
- `scripts/stop-runtime-manager-docker.ps1`
- `scripts/check-*.ps1`
- `scripts/lib/*.ps1`

原則：adapter 可以被 `deploy.ps1`、`verify-all.ps1` 或 runbook 呼叫，但新增功能不應繞過 `deploy.ps1` 另起一條入口。

## Test / Smoke / Dev Scripts

新的 smoke、check、E2E、diagnostic script 預設應放：

- `scripts/tests/`
- `scripts/dev/`
- `tests/e2e/`
- sub-repo 自己的 `scripts/`

`scripts/agent/` 是例外的 trusted-controller tooling 區：只放受保護 default branch 使用的 PR contract parser、ephemeral worktree lifecycle 與 validation profile allowlist。它不是 operator deploy entrypoint；候選 PR 不得覆寫執行中的 controller，Issue / PR 內容也不得提供任意 command。

root `scripts/` 只保留已登記且有明確 operator / adapter / verifier 角色的檔案。

## Registry Rule

`scripts/script-registry.json` 是目前允許 root-level scripts 的登記表。任何 PR 若新增或重新定位 root-level script，必須同步更新 registry，並在 PR 描述說明：

- 為何不能放 `deploy.ps1`
- 為何不能放 `verify-all.ps1`
- 為何不能放 `scripts/lib/`
- 為何不能放 `scripts/tests/` 或 `tests/e2e/`

## Required Verification

Runtime / deploy 相關改動至少提供：

```powershell
.\scripts\deploy.ps1 -DryRun
```

本機 runtime 可用時，優先補：

```powershell
.\scripts\deploy.ps1 -Force -StrictPostVerify
.\scripts\verify-all.ps1
```

若因 Docker / GPU / Kit license / network 不可用而無法跑完整 deploy，必須把 blocker 寫清楚，不得宣稱 deployment-complete。

`scripts/verify-runtime-kit-launcher.ps1` 的 `passed` 另有 fail-closed 條件：probe container 必須收到
`KIT_SIGNALING_PORT=<SignalingPort>`，且在 observation window 內同時出現 launcher marker、指定的
`127.0.0.1:<SignalingPort>` 也實際接受 TCP 連線。listener probe 必須同時通過 published host endpoint
與該 probe container 內部的 loopback endpoint，避免把 Docker port proxy 誤判成 Kit ready。只有 launch
log、container 仍存活、或接近 observation deadline 都不得視為成功；無論結果為何，probe container
都必須清除。

## Prohibited By Default

除非同步更新 registry 與本 contract，否則不得新增：

- `scripts/start-*.ps1`
- `scripts/smoke-*.ps1`
- `scripts/check-*.ps1`
- `scripts/*-docker.ps1`
- `scripts/deploy-*.ps1`

## PR Table

涉及 runtime / docker / Kit / viewer / ports / env 的 PR 必須填：

| Item | Result |
|---|---|
| Affects runtime / docker / Kit / viewer / ports / env? | yes / no |
| Canonical deploy path updated? | `scripts/deploy.ps1` updated / verified / not needed |
| New root script added? | no / yes with registry entry |
| Deploy dry-run command | `.\scripts\deploy.ps1 -DryRun` |
| Full deploy tested | `.\scripts\deploy.ps1 -Force -StrictPostVerify` / not available |
| Verify command | `.\scripts\verify-all.ps1` |
| Frontend URL verified |  |
| Evidence path |  |

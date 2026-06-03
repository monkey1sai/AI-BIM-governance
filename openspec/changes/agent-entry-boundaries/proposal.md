## Why

本 repo 的 agent 入口需要跟產品定位、前端驗收與部署入口治理一致。近期工作顯示三個反覆風險：

1. A1-A10 產品項目與設計站「05 BIM治理與模型檢核」沒有寫入 repo agent contract，導致 agent 容易只看目前資料夾而忽略主要產品線。
2. user-facing 功能常被以 backend/API/tests 完成宣告，但使用者無法在前端操作驗收。
3. root `scripts/` 容易增加新的啟動 / smoke / check script，卻沒有回到 `scripts/deploy.ps1` golden path。

本 change 是 docs-only / agent-boundary change，目標是正式記錄這次 repo-boundary / workflow 例外與契約調整；不修改產品程式碼、不新增 runtime 行為。

## What Changes

- 在 root `AGENTS.md` / `CLAUDE.md` 對齊 A1-A10 產品定位、frontend-operable completion rule、script/deploy golden path。
- 新增 `docs/agents/product-operability-and-script-contract.md`，集中說明 A1-A10、前端可操作完成標準與 script contract。
- 更新 subfolder `AGENTS.md`，讓 `web-viewer-sample`、`bim-review-coordinator`、`bim-streaming-server`、`governance-service`、`apps/kit-manager-web`、`services/kit-manager-api`、`scripts` 邊界與目前內涵一致。
- 新增 `.github/PULL_REQUEST_TEMPLATE.md`，要求未來 PR 回報 Frontend Verification 與 Deploy Path Verification。
- 新增 `scripts/SCRIPT_CONTRACT.md` 與 `scripts/script-registry.json`，先登記現有 root-level scripts 並定義 `scripts/deploy.ps1` 為 canonical one-click deploy / demo golden path。

## Capabilities

### Added Capabilities

- `agent-operability-governance`

### Modified Capabilities

- None.

## Impact

- Product code：無。
- Runtime / deploy behavior：無；只建立 docs contract / registry。
- Git / PR workflow：新增 PR template，要求未來 user-facing 與 deploy/runtime 相關 PR 填驗收表。
- OpenSpec：本 change 作為 repo-boundary / workflow 變更的 documented exception 與 formal evidence。

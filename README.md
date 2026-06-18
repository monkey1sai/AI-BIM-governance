# AI-BIM-governance

`AI-BIM-governance` 是 BIM 模型治理與審查 workspace。它負責客戶落地端的
IFC intake、IFC -> USDC 轉檔、Omniverse Kit/WebRTC 串流、治理檢核操作介面，
並把必要的 metadata-only 結果回拋外部公司雲端 control-plane。

一句話版本：

```txt
外部客戶落地端 IFC Worker
→ bim-review-coordinator
→ bim-streaming-server IFC→USDC + Kit/WebRTC
→ web-viewer-sample / coordinator / Edge Console
→ metadata-only callback outbox to external cloud
```

## 目前定位

本 repo 採 B 方案邊界：

- `[外部] 公司雲端 bim-control` 是 control-plane 權威，本 repo 不 mirror。
- `[外部] 客戶落地端 IFC Worker` 是 IFC 產出者，本 repo 不啟動。
- `bim-review-coordinator/` 是唯一對外 IFC-ready intake、session、collaboration 與 callback outbox 中心。
- `bim-streaming-server/` 是 internal-only IFC->USDC conversion authority 與 Omniverse Kit/WebRTC runtime。
- `governance-service/` 是 A1/A2/A3 governance loopback authority。
- `web-viewer-sample/` 是 browser client 與 user interaction layer。
- `tests/fakes/` 與 `tests/contracts/` 只模擬外部平台，不是 runtime profile。
- 歷史 `_worker/`、`_bim-control/` 已自 product runtime 刪除，不應當成 startup、health check、smoke 或 review-session 依賴。

詳細邊界以 [AGENTS.md](AGENTS.md) 與
[docs/agents/repo-boundary-detail.md](docs/agents/repo-boundary-detail.md) 為準。

## 服務地圖

| Path | Port | Role |
|---|---:|---|
| `bim-review-coordinator/` | `8004` | IFC-ready intake、review session、callback outbox、coordinator `/ui` |
| `bim-streaming-server/` | `49101`, `49100`, `47998` | IFC->USDC conversion API、Kit signaling、WebRTC media |
| `governance-service/` | `49102` | A1 rule-run、A2 diff、A3 federation、Issue/BCF loopback |
| `web-viewer-sample/` | `5173` | Browser viewer、Edge Console UI、WebRTC/DataChannel client |
| `apps/kit-manager-web/` | dev server | Kit Manager operator UI |
| `services/kit-manager-api/` | `8010` | Kit Manager API |
| `scripts/` | n/a | deploy / verify / smoke / script contract |
| `docs/` | n/a | specs、contracts、runbooks、evidence |

## 快速啟動

### 推薦路徑：Mode C hybrid demo

Windows demo 預設走 Mode C hybrid：

```txt
Docker web-plane        : coordinator(:8004) + viewer(:5173)
Windows host-native GPU : Kit/WebRTC(:49100/47998) + conversion API(:49101)
```

前置條件：

- Windows host。
- Docker Desktop 已啟動。
- NVIDIA driver / Kit runtime 可用。
- Node、Python、root `.venv` 依既有環境準備。
- LAN demo 時，同網段裝置能連到 public host 的 `8004`、`5173`、`49100`、`47998` 與 spectator ports。

常用命令：

```powershell
cd C:\Repos\active\iot\AI-BIM-governance

# 只做 preflight，不啟服務
.\scripts\deploy.ps1 -DryRun

# 啟動 demo web-plane + host-native runtime
.\scripts\deploy.ps1 -Build
```

預設入口：

```txt
Coordinator UI : http://192.168.10.105:8004/ui
Viewer base    : http://192.168.10.105:5173
Conversion API : http://192.168.10.105:49101/health
```

停止：

```powershell
docker compose -f compose.runtime-manager.yml -f compose.host-kit.yml --env-file .env.web-plane.host-kit down
.\scripts\stop-all.ps1
```

完整 deploy / demo 細節：

- [docs/demo/fast-mvp-demo-recap.md](docs/demo/fast-mvp-demo-recap.md)
- [docs/runbooks/one-click-deploy-smoke.md](docs/runbooks/one-click-deploy-smoke.md)
- [docs/agents/product-operability-and-script-contract.md](docs/agents/product-operability-and-script-contract.md)

### 手動 debug 路徑

手動啟動只供 local debug。demo 優先使用 `.\scripts\deploy.ps1 -Build`。

```powershell
# Terminal 1: coordinator
cd C:\Repos\active\iot\AI-BIM-governance\bim-review-coordinator
npm install
npm run dev

# Terminal 2: conversion authority
cd C:\Repos\active\iot\AI-BIM-governance\bim-streaming-server
if (-not (Test-Path ..\.venv\Scripts\python.exe)) { python -m venv ..\.venv }
..\.venv\Scripts\python.exe -m pip install -r .\requirements.txt
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-host-native-conversion-service.ps1 -PythonExe ..\.venv\Scripts\python.exe

# Terminal 3: Kit / WebRTC
cd C:\Repos\active\iot\AI-BIM-governance\bim-streaming-server
.\scripts\start-streaming-server.ps1 -SkipAutoLoad

# Terminal 4: viewer
cd C:\Repos\active\iot\AI-BIM-governance\web-viewer-sample
npm install
npm run dev -- --host 127.0.0.1
```

補充說明見 [docs/contracts/local-dev-runbook.md](docs/contracts/local-dev-runbook.md)。

## 產品與需求文件

README 只是入口，不是最高權威。遇到衝突時依下表往下查。

| 想知道 | 入口 |
|---|---|
| Repo 邊界、agent 規則、source of truth | [AGENTS.md](AGENTS.md) |
| A1-A10 功能需求、UI 驗收語意、原型效力順序 | [docs/plans/docs-plans-README.md](docs/plans/docs-plans-README.md) |
| 產品殼層需求規格 | [docs/plans/ai-bim-governance-設計規格.md](docs/plans/ai-bim-governance-設計規格.md) |
| 互動行為合約與官方標準對齊 | [docs/plans/ai-bim-governance-互動實作規格與標準對齊.md](docs/plans/ai-bim-governance-互動實作規格與標準對齊.md) |
| 工程執行順序與 DoD | [docs/plans/ai-bim-governance-開發軌跡與執行計畫.md](docs/plans/ai-bim-governance-開發軌跡與執行計畫.md) |
| 可點擊產品原型 | [docs/plans/ai-bim-governance-prototype.html](docs/plans/ai-bim-governance-prototype.html) |
| 3D viewer 驗收示意原型 | [docs/plans/ai-bim-geo-viewer-prototype.html](docs/plans/ai-bim-geo-viewer-prototype.html) |
| API / event contracts | [docs/contracts/](docs/contracts/) |
| Capability specs | [openspec/specs/](openspec/specs/) |
| Runtime / E2E evidence | [docs/verification/](docs/verification/) 與 [docs/evidence/](docs/evidence/) |

Generated wiki / Graphify / GitNexus 內容只能當探索輔助。若目前 checkout 沒有
`docs/wiki/` 或 graph artifacts，不要在 README、PR 或驗收報告中把它們寫成現有入口。
最終仍以程式碼、contracts、AGENTS 邊界與 plans 規格為準。

## 開發流程

本 repo 的標準管線：

```txt
設計規格 / prototype
  → Superpowers plan
  → GitNexus impact（改 symbol 前）
  → 實作
  → gstack UI / E2E / screenshot evidence（user-facing done）
  → GitNexus detect_changes（commit 前）
  → branch → PR → Actions → merge
```

基本規則：

- 不在 `main` 上開發，從最新 `main` 切 feature / docs branch。
- 不修改 secrets、private keys、真實 token 或既有 `.env` 機密值。
- 不把大型 BIM artifact commit 進 repo：`*.ifc`、`*.usdc`、`*.usd`、`*.rvt`、`*.dwg` 預設不進 git。
- User-facing capability 不可只用 backend/API 測試宣告完成；必須有前端 route、button、fixture、loading/success/failure/retry、runtime ID 與 browser evidence。
- 3D / Kit / WebRTC 完成聲明必須有真實 runtime evidence；沒有 first frame / stage truth / WebRTC evidence 時只能標 `not observed` 或 `blocked`。

GitHub / PR 詳細規則：

- [docs/agents/github-workflow.md](docs/agents/github-workflow.md)
- [docs/agents/gitnexus-usage.md](docs/agents/gitnexus-usage.md)
- [docs/agents/sub-repo-verify-commands.md](docs/agents/sub-repo-verify-commands.md)

## 驗證命令

先跑最小有用驗證，再依變更範圍擴大。

Root contracts / fakes：

```powershell
.\.venv\Scripts\python.exe -m pytest tests -p no:cacheprovider
```

Deploy path：

```powershell
.\scripts\deploy.ps1 -DryRun
.\scripts\verify-all.ps1
```

Coordinator：

```powershell
cd bim-review-coordinator
npm test
npm run build
npm run verify
```

Streaming conversion authority：

```powershell
cd bim-streaming-server
python -m pytest tests/test_conversion_authority_api.py -q
```

Governance service：

```powershell
cd governance-service
..\.venv\Scripts\python.exe -m pytest tests -q
```

Viewer：

```powershell
cd web-viewer-sample
npm run test:session-first
npm run build
```

Kit Manager：

```powershell
cd services/kit-manager-api
..\..\.venv\Scripts\python.exe -m pytest tests -q

cd apps/kit-manager-web
npm run build
```

Shell / PowerShell script sanity：

```powershell
bash -n scripts/verify-all.sh
powershell -NoProfile -Command "[scriptblock]::Create((Get-Content -Raw scripts/smoke-bscheme-intake.ps1)) | Out-Null"
```

## Script contract

Canonical operator entrypoints：

| Script | 用途 |
|---|---|
| `scripts/deploy.ps1` | golden deploy / demo path |
| `scripts/verify-all.ps1` | aggregate verification |
| `scripts/stop-all.ps1` | stop / cleanup path |
| `scripts/dev/rebuild-test-deploy.ps1 -Build` | 重建 `D:\Users\deploy\AI-bim-geo` 測試部署區 |

Runtime / Docker / Kit / viewer / env / port / conversion-service 相關改動，至少要更新或驗證
`scripts/deploy.ps1`。新增 root-level smoke/check/start 類 script 前，先讀
[scripts/SCRIPT_CONTRACT.md](scripts/SCRIPT_CONTRACT.md) 與
[scripts/script-registry.json](scripts/script-registry.json)。

## Git 與 artifact 注意事項

- Root remote: `https://github.com/monkey1sai/AI-BIM-governance.git`
- Single root repo；服務目錄不是 submodule / subtree。
- Local runtime output、Kit build output、conversion jobs、`.gitnexus/`、`node_modules/` 不進 git。
- 真實 IFC semantic viewer E2E 使用主工作區 local `storage/` 內 IFC；new worktree 不會自動帶 ignored artifacts。
- 若 evidence 太大，只保留 summary JSON、抽樣 mapping、測試結果與截圖，不提交大型 `model.usdc` 或完整大型 mapping。

## README 維護規則

修改 README 時請核對：

```powershell
rg -n "_worker|_bim-control|docs/wiki/graphify|Docker-first Runtime Manager MVP" README.md
git diff --check -- README.md
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\deploy.ps1 -DryRun
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\tests\test-deploy-dryrun.ps1
```

第一個 `rg` 不一定要零輸出；若有輸出，必須確認文字是在描述退役 / 不可用 / 探索輔助，
不是把它寫成現行 runtime dependency。

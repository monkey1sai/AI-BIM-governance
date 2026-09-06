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
- `bim-review-coordinator/` 是唯一對外 IFC-ready intake、review session / presence control 與 callback outbox 中心；selection / annotation collaboration handlers 已退役。
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

### 測試部署：canonical Linux

目前測試部署目標由 [deploy-target-registry.json](scripts/deploy-target-registry.json)
指定為 `canonical-linux`；`local-windows` 是按需平台驗證點。部署主機、資料目錄與
連線設定由 owner 預先建立的 repo 外 private inventory 提供，不以本機 checkout 或固定 IP 推測。

操作端主工作區也須先備妥 `.env.web-plane.host-kit.canonical-linux`：若檔案不存在，
由 owner 從 `.env.web-plane.host-kit.canonical-linux.example` 複製並依目標設定；
已有檔案時保留，不覆寫。這是 registry 指定的 base env，與 private inventory 是兩個
必要輸入；缺少 base env 時 helper 會在 SSH dispatch 前停止。實際 env 不提交到 Git。

取得部署授權、備妥上述兩個輸入並確認沒有其他 runtime writer 後，從主工作區執行：

```powershell
.\scripts\dev\rebuild-test-deploy.ps1 -Build -InventoryPath '<repo-external target.local.json>'
```

此入口預設選 canonical target，使用 freshly fetched `origin/main` 重建部署 checkout，
再於目標執行 `scripts/deploy.ps1 -Build`。`-InventoryPath` 須替換為既有 inventory 路徑；
也可依 helper 支援設定 `AI_BIM_DEPLOY_TARGET_INVENTORY`。不要將 private inventory 提交到 Git。
瀏覽器入口是 inventory 所指定 public host 的 coordinator `/ui`；viewer 與串流位置依該目標設定。

部署檢查通過不代表 IFC 轉檔或 3D 閉環通過；後者仍需同一份 IFC 的產物、mapping、
正確 stage、瀏覽器首幀與 DataChannel 高亮證據。

### Windows 本機 demo：Mode C hybrid

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

Windows demo 入口（以下主機佔位符須換成該環境實際設定，不是 canonical Linux 位址）：

```txt
Coordinator UI : http://<windows-demo-host>:8004/ui
Viewer base    : http://<windows-demo-host>:5173
Conversion API : http://<windows-demo-host>:49101/health
```

停止該 Windows 本機 demo（僅在確認這些服務由本次 demo 持有時）：

```powershell
docker compose -f compose.runtime-manager.yml -f compose.host-kit.yml --env-file .env.web-plane.host-kit down
.\scripts\stop-all.ps1
```

完整 deploy / demo 細節：

- [docs/demo/fast-mvp-demo-recap.md](docs/demo/fast-mvp-demo-recap.md)
- [docs/runbooks/one-click-deploy-smoke.md](docs/runbooks/one-click-deploy-smoke.md)
- [docs/agents/product-operability-and-script-contract.md](docs/agents/product-operability-and-script-contract.md)

### 手動 debug 路徑

手動啟動只供 Windows local debug；本機 demo 使用 `.\scripts\deploy.ps1 -Build`，
canonical 測試部署使用上方 `rebuild-test-deploy.ps1` 入口。

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
| Plans 唯一入口與閱讀順序 | [docs/plans/docs-plans-README.md](docs/plans/docs-plans-README.md) |
| 設計與規格正本（服務邊界·部署·前端 IA·API 契約·時序·資料模型·實作分期·AI Coding 交付守則） | [AI-BIM 前後端設計文件.dc.html](docs/plans/AI-BIM%20前後端設計文件.dc.html)（§01–§08；開啟需連網載 React CDN） |
| Console 高保真互動原型設計稿 | [AI-BIM Console Hi-Fi.dc.html](docs/plans/AI-BIM%20Console%20Hi-Fi.dc.html)（6 screens；真 3D 仍驗 Kit WebRTC/stage/DataChannel） |
| Repo 現況與 A1-A10 建成狀態 | repo code＋tests 直接查證（不再維護建成帳本） |
| Production 2D design gate | 唯讀 authoring origin `C:\Repos\design\desigin-system`；CI 使用 [manifest](docs/plans/design-system-reference.manifest.json) 與 [golden baselines](docs/plans/design-system-baseline/) |
| API / event contracts | [docs/contracts/](docs/contracts/) |
| Capability specs | [openspec/specs/](openspec/specs/) |
| Runtime / E2E evidence | [docs/verification/](docs/verification/) 與 [docs/evidence/](docs/evidence/) |

Generated wiki / Graphify / GitNexus 內容只能當探索輔助。若目前 checkout 沒有
`docs/wiki/` 或 graph artifacts，不要在 README、PR 或驗收報告中把它們寫成現有入口。
最終仍以程式碼、contracts、AGENTS 邊界與 plans 規格為準。

## 開發流程

本 repo 不採單一固定管線；先依 [AGENTS.md](AGENTS.md) 判定 Lane F / B / G / S：

AI coding 工程改善的 proposed backlog 見 [AI Coding Optimization Roadmap](docs/agent-tooling/AI-CODING-OPTIMIZATION-ROADMAP.md)。它不是產品需求、active WIP 或 runtime 完成證據；只有被使用者或 `NOW.md` 明確提升的單一 work package 才進入實作。

需要在多個候選策略中做有界比較，或對 mapping 覆蓋率做逐輪收斂時，使用 repo 內 opt-in 的
[`token-strategy-tournament`](.claude/skills/token-strategy-tournament/SKILL.md) 與
[`mapping-coverage-loop`](.claude/skills/mapping-coverage-loop/SKILL.md) 入口；其 workflow、routing 與
Claude/Codex parity 由 tracked manifest、generator 與測試維護，不以一次性落地筆記為正本。

- Lane F：最小修正 + targeted tests，不強制 plan、worktree 或 GitNexus impact。
- Lane B：3–5 項 inline checklist + affected tests；改主要 code symbol 時跑一次 GitNexus impact。
- Lane G：dedicated branch/worktree + 簡潔 plan + GitNexus impact / `detect_changes` + integration evidence；user-facing 變更另需獨立的 design-semantic-visual 與 functional/runtime browser evidence。
- Lane S：只有使用者明確啟動 `spec-to-done` / 完整 Superpowers 時才使用，不得由任務複雜度自動升級。

基本規則：

- 不在 `main` 上開發，從最新 `main` 切 feature / docs branch。
- 不修改 secrets、private keys、真實 token 或既有 `.env` 機密值。
- 不把大型 BIM artifact commit 進 repo：`*.ifc`、`*.usdc`、`*.usd`、`*.rvt`、`*.dwg` 預設不進 git。
- User-facing capability 不可只用 backend/API 測試宣告完成；必須有前端 route、button、fixture、loading/success/failure/retry、runtime ID 與 browser evidence，並填 `Design gate status`、machine-derived screens/missing scopes 與 `Full completion claimed`。`mixed`／`partial_reference_missing` 允許誠實局部工作但不能宣稱 99%；semantic result 只由 CI Playwright 產出。
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
| `scripts/dev/rebuild-test-deploy.ps1 -Build` | 從 freshly fetched `origin/main` 重建 registry 選定的測試部署；預設 `canonical-linux`（需上述 private inventory），Windows 按需驗證須明確指定 `-TargetId local-windows` |

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

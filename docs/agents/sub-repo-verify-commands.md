> Loaded lazily by AGENTS.md / CLAUDE.md。Source-of-truth: AGENTS.md。
>
> 何時讀本檔：要跑 sub-repo 驗證指令、Cursor Cloud / Linux 環境設定、查 lint / build / health 入口時。

# Sub-repo 驗證入口

每個 sub-repo 都有自己的 repo-local `AGENTS.md` / `CLAUDE.md`（七段 schema），本檔只匯總 root 層常用的「跑哪個 sub-repo 的什麼指令」清單。

## Frontend-operable verification

User-facing capability 不得只用 backend/API 測試宣告完成。最終驗收需回報：

```txt
Frontend route
Main button(s) tested
Fixture used
Visible success state
E2E command
Screenshot / trace
Known gaps
```

以上 labels 與 `scripts/tests/check-pr-body-evidence.ps1` machine truth 對齊；可額外補 Frontend URL / Backend API called / Runtime action，但不得取代這 7 項。

PR 本機 preflight 入口：

```powershell
.\scripts\dev\check-pr-local-preflight.ps1 -PrNumber <pr-number>
```

此命令會以目前 PR body + 本機 `origin/main...HEAD` changed paths 重跑 machine evidence gate，並在偵測到 frontend paths 時執行 `web-viewer-sample` 的 `npm run verify`。它是 push / 等待 GitHub CI 前的本機硬 gate；只有診斷 GitHub 上既有 PR body gate 時才可暫用 `-ChangedPathsSource remote -SkipViewerVerify`。

優先驗證入口：

```powershell
cd web-viewer-sample
npm run build
```

若已有對應 browser E2E，必須跑 Playwright / Chrome E2E 並保留 screenshot / trace / console / network evidence。若無法跑瀏覽器，必須標為 blocked / not observed，不能宣稱 frontend-complete。

## Deploy path verification

Runtime / Docker / Kit / viewer / env / port / conversion-service 改動必須更新或明確驗證 canonical deploy path：

```powershell
.\scripts\deploy.ps1 -DryRun
.\scripts\verify-all.ps1
```

測試部署區重建固定使用 build-only helper：

```powershell
.\scripts\dev\rebuild-test-deploy.ps1 -Build
```

Helper 會重建 `D:\Users\deploy\AI-bim-geo` 並在部署區執行：

```powershell
cd D:\Users\deploy\AI-bim-geo
.\scripts\deploy.ps1 -Build
```

禁止 `-DryRun`。若 fetch `origin` explicit main refspec 失敗、approval 被拒、或清理後缺少 `scripts\deploy.ps1`，回報 blocker 並停止；不得部署 stale code。
清理規則會移除 agent/tooling docs、`.github\skills` / `.github\prompts`、root `docs` / `openspec` / `patches`，但保留 `.github\workflows`。
若 `deploy.ps1 -Build` Phase 3 被外部 `kit.exe` / conversion `python.exe` 佔用必要 ports 擋住，已授權只停止可由部署區 pidfile 或 command line / executable path 證明屬於 `D:\Users\deploy\AI-bim-geo` 的 PID tree，並記錄 port / PID / process name / ownership evidence 後重跑同一條 `-Build`。若只有 port/process-name 證據，先取得使用者確認；不得改用 `-Force` / `-DryRun`。

本機 runtime 可用時優先補：

```powershell
.\scripts\deploy.ps1 -Force -StrictPostVerify
```

## Root contracts / fakes

```powershell
python -m pytest tests -p no:cacheprovider
```

> 必須走 `.venv\Scripts\python.exe`，否則 user-site packages 會把 FastAPI / Starlette / uvicorn 拉成不相容版本（見 agent memory `venv-python-required-for-pytest.md`）。

## bim-review-coordinator (Node, port 8004)

```powershell
cd bim-review-coordinator
npm test
npm run build
npm run verify
```

## bim-streaming-server (Python + Kit)

```powershell
cd bim-streaming-server
python -m pytest tests/test_conversion_authority_api.py -q
```

Kit 渲染需要 Windows host-native（NVIDIA driver）；WSL2 / Docker 無 GPU graphics 通道，不可在容器跑 Kit runtime（見 agent memory `kit-gpu-render-needs-windows-native.md`）。

## governance-service (Python host-native, port 49102)

```powershell
cd governance-service
& "C:\Program Files\Python312\python.exe" -m pytest tests/ -v
& "C:\Program Files\Python312\python.exe" scripts/run_governance_evidence.py
```

須走 host-native `C:\Program Files\Python312\python.exe`（具 ifcopenshell 0.8.5 + ifctester）；勿用 WSL / Docker（本服務 CPU-only，無 GPU 需求）。真實 IFC evidence 落 `docs/evidence/governance-rule-run-pass/`。

## web-viewer-sample (Vite, port 5173)

```powershell
cd web-viewer-sample
npm run test:session-first
npm run build
```

Network 入口走 coordinator `:8004/ui`（LAN IP）；viewer `:5173` 是 Kit 1:1 endpoint，不可當入口直接暴露。

## services/kit-manager-api (FastAPI, port 8010)

```powershell
cd services/kit-manager-api
python -m pytest tests -q
```

若 root venv 可用：

```powershell
..\..\.venv\Scripts\python.exe -m pytest tests -q
```

## apps/kit-manager-web (Vite)

```powershell
cd apps/kit-manager-web
npm run build
```

---

## Cursor Cloud / Linux 等效啟動

### 環境概要

- Node.js 18 透過 nvm 管理；啟動 Node 服務前須先 source nvm：`export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh"`
- Python 3.12 已系統安裝；FastAPI/uvicorn 等 Python 依賴安裝在全域 site-packages（非 venv）
- `bim-streaming-server` 需要 NVIDIA GPU + Kit SDK，Cloud VM 無法運行，可跳過

### 啟動服務（B 方案：2 個可運行 Node 服務，Kit 需 GPU 可另行啟動）

每個服務需獨立 terminal / tmux session，README.md 已有完整 PowerShell 版命令，以下是 Linux 等效：

| 服務 | 工作目錄 | 啟動命令 | Port |
|---|---|---|---|
| `bim-review-coordinator` | `bim-review-coordinator/` | `npm run dev` | 8004 |
| `web-viewer-sample` | `web-viewer-sample/` | `npm run dev -- --host 0.0.0.0` | 5173 |

### 測試

- Python tests：
  - `python3 -m pytest tests`（外部平台 contracts + test-only fakes）
  - `cd bim-streaming-server && python3 -m pytest tests/test_conversion_authority_api.py`
- Node tests：`cd bim-review-coordinator && npm test`
- Build：`cd bim-review-coordinator && npm run build` / `cd web-viewer-sample && npm run build`
- Lint（`web-viewer-sample`）：`npm run lint` — 目前有 30 個 pre-existing eslint errors，這是已知狀態

### .env 設定

- 從 `.env.example` 複製：root `.env`、`bim-review-coordinator/.env`
- 預設值即為本地開發正確值，通常不需修改

### 注意事項

- `web-viewer-sample` 完整功能需要 `bim-streaming-server`（WebRTC 串流），Cloud VM 無 GPU 無法運行。但 UI 仍可正常載入，REST API 與 coordinator 互動正常
- Health check endpoints：各服務皆有 `/health`

> Loaded lazily by AGENTS.md / CLAUDE.md。Source-of-truth: AGENTS.md。
>
> Document type: runbook。這是 agent 操作指引，不建立 runtime/product behavior；後者以程式碼與可執行 tests/contracts 為準。
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
Backend API called
Runtime action
Visible success state
E2E command
Screenshot / trace
Design screen(s)
Design reference manifest
Visual fidelity result
Visual comparison
Visual artifacts
Known gaps
```

以上 labels 與 `scripts/tests/check-pr-body-evidence.ps1` machine truth 對齊；Frontend URL 可額外補充但不得取代任一 machine-required 項。

PR 本機 preflight 入口：

```powershell
.\scripts\dev\check-pr-local-preflight.ps1 -PrNumber <pr-number>
```

此命令會讀取目前 PR body 與 GitHub PR 的 exact base/head SHA，先確認本機 `HEAD` 等於 PR head，再以該組 SHA 的 three-dot changed paths 重跑 machine evidence gate；並在 repo-local `.tmp` 下執行 `scripts/pr-review-agent.ps1`（含 affected sub-repo verify，例如 viewer/coordinator/streaming/scripts）。它是 push / 等待 GitHub CI 前的本機硬 gate；只有診斷 GitHub 上既有 PR body gate 時才可暫用 `-ChangedPathsSource remote -SkipReviewAgent -SkipViewerVerify`。

GitHub PR checks 不再無差別重跑這些本機可重現的 sub-repo verify。PR 上先用 changed-path classifier 判斷受影響範圍；未受影響的 service-level required checks 由 job-level condition skip，受影響的 job 才跑遠端確認。若本機 preflight 未跑綠，不得用 GitHub CI 補跑或等待。

優先驗證入口：

```powershell
cd web-viewer-sample
npm run build
```

Design reference 與 visual lane：

```powershell
pwsh -NoProfile -File .\scripts\tests\verify-design-system-reference.ps1
cd web-viewer-sample
Remove-Item Env:DESIGN_SYSTEM_SCREEN_IDS -ErrorAction SilentlyContinue
npm run test:visual:design-system
cd ..
pwsh -NoProfile -File .\scripts\tests\verify-design-system-visual-result.ps1 -TargetCommit HEAD -AllowUntrackedArtifacts
```

Visual lane 固定 Windows runner、Chromium DPR1、1440×900＋1920×1080、pixel diff≤1%＋branch-protected Playwright semantic 100%；scope 由 base/head manifest 聯集判定。`mixed` 跑全部 approved screens並列 missing；`partial_reference_missing` 不偽造 result且 full=no。functional browser/runtime E2E 仍須另跑並保留 screenshot/trace/console/network/runtime ID；涉及 Kit 再保留 first-frame/stage/DataChannel ack。任一 lane 無法執行都標 blocked/not observed，不能宣稱 frontend-complete。

## Deploy path verification

Runtime / Docker / Kit / viewer / env / port / conversion-service 改動必須更新或明確驗證 canonical deploy path：

```powershell
.\scripts\deploy.ps1 -DryRun
.\scripts\verify-all.ps1
```

測試部署區重建固定使用 build-only helper；預設 target 是 public registry 的 canonical Linux descriptor，private topology 由 repo 外 inventory 注入：

```powershell
.\scripts\dev\rebuild-test-deploy.ps1 -Build -InventoryPath '<repo-external target.local.json>'
```

也可先設定 process-level `AI_BIM_DEPLOY_TARGET_INVENTORY` 再省略 `-InventoryPath`。owner/provisioning 必須預先建立 inventory；transport 只檢查並讀取，不上傳、不覆寫。Helper 會用 freshly fetched `origin/main` 重建 inventory 所解析的 target-scoped deployment checkout，並在該 checkout 執行：

```text
pwsh -NoProfile -NonInteractive -File scripts/deploy.ps1 -Build
```

Windows deployment 不是預設 canonical path，只能明確按需選擇：

```powershell
.\scripts\dev\rebuild-test-deploy.ps1 -Build -TargetId local-windows
```

禁止 `-DryRun`。若 fetch `origin` explicit main refspec 失敗、approval 被拒、或清理後缺少 `scripts\deploy.ps1`，回報 blocker 並停止；不得部署 stale code。
清理規則會移除所有層級的 agent instruction files、root agent tooling dirs、`.github\skills` / `.github\prompts`、root `docs` / `openspec` / `patches`，但保留 `.github\workflows` 與 tracked production dependency `docs/plans/ai-bim-governance.css`。
明確啟動的 `spec-to-done` 在目前 spec PR 已 merge、commit 可由 freshly fetched `origin/main` 取得後，只能對明確選擇的 `local-windows` target 先用 skill helper 的 `-StopOwnedRuntime -DeploymentRoot '<resolved local-windows deploy root>'` 模式處理 blocker。只有 listener 符合 per-port service role、deployment pidfile ancestor 與精確 launcher entrypoint、creation identity 經雙快照與 stop 前重驗一致時，才可用 exact process handle 停止；pidfile 僅供 lineage 佐證，port topology 由 deployment env immutable snapshot 推導，不接受 caller parameter/process-environment override，且每次 stop 前重驗 hash。canonical Linux target 的 inventory/runtime 由 owner 控制，transport 不自動停止或改寫。MUST 記錄 port / PID / process name / ownership kind，同一 port 的全部 busy owners通過後才可進入 cleanup。既有一般 Phase 3 重試能力不變，但所有自動停止也 MUST 使用同一 hardened helper 與相同閘門，再重跑同一條 target-scoped `-Build`；helper 無法證明 ownership 時必須 HELD，只有使用者逐次確認明確 PID 與 evidence 後才可人工例外。不得驗證未 merge branch或改用 `-Force` / `-DryRun`。

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

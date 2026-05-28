# AI-BIM-governance

> **BIM 審查雲端 (BIM Review Cloud) — Local B-scheme Workspace**
>
> 本 workspace 現行 B 方案的核心閉環是：外部客戶落地端 IFC Worker 通知
> `bim-review-coordinator`，coordinator 觸發 `bim-streaming-server` 的 IFC→USDC
> internal conversion，轉檔結果再以 metadata-only callback outbox 回拋外部公司雲端。

`_worker/` 與 `_bim-control/` 已自 repo product runtime 刪除。它們只保留為歷史脈絡或
`tests/fakes` / `tests/contracts` 的 test-double 對照，不是本地啟動、health check、smoke
或 review-session 依賴。

---

## Demo / Deploy 快速入口

本 repo 的本機 demo 預設使用 **Mode C hybrid**：

```txt
Docker web-plane          : bim-review-coordinator(:8004) + web-viewer-sample(:5173)
Windows host-native GPU   : bim-streaming-server Kit/WebRTC(:49100/47998) + conversion-service(:49101)
LAN demo public host      : 192.168.10.105
```

這是目前給客戶看 demo 的標準路徑。不要用全 Docker GPU profile 取代它；Kit graphics / WebRTC runtime 仍以 Windows host-native 為準。

### Demo 前置條件

- Windows host。
- Docker Desktop 已啟動，tray icon 穩定。
- NVIDIA driver 可用，`nvidia-smi` 在 PATH。
- Node / Python / Kit runtime 已照 repo 既有方式準備；缺 `.venv`、缺 Python service dependencies、缺 `.env.web-plane.host-kit`、缺 safe directory 時 `deploy.ps1` 會做安全修復。
- 同網段裝置要能連到 `192.168.10.105` 的 `8004`、`5173`、`49100`、`47998`，以及 spectator ports。

### 一鍵部署

```powershell
cd C:\Repos\active\iot\AI-BIM-governance

# 只看會做什麼，不啟服務
.\scripts\deploy.ps1 -DryRun

# Demo cold/warm deploy；預設 public host = 192.168.10.105
.\scripts\deploy.ps1 -Build
```

成功後打開：

```txt
Coordinator UI : http://192.168.10.105:8004/ui
Viewer base    : http://192.168.10.105:5173
Conversion API : http://192.168.10.105:49101/health
```

停止 demo：

```powershell
docker compose -f compose.runtime-manager.yml -f compose.host-kit.yml --env-file .env.web-plane.host-kit down
.\scripts\stop-all.ps1
```

### 如何設定參數

`deploy.ps1` 的參數來源優先序：

```txt
CLI flag > .env.web-plane.host-kit > .env.web-plane.host-kit.example > deploy.ps1 default
```

最常用的做法是用 CLI flag 做一次性覆蓋；需要長期保存的機器設定才寫進 `.env.web-plane.host-kit`。`PUBLIC_HOST` 必須是 host 或 IP，不要帶 `http://`、port、path、query。

常用範例：

```powershell
# LAN demo；預設即為 192.168.10.105
.\scripts\deploy.ps1 -Build

# 本機-only demo；viewer 只綁 127.0.0.1
.\scripts\deploy.ps1 -Build -PublicHost 127.0.0.1

# primary + 4 spectator viewer slots
.\scripts\deploy.ps1 -Build -SpectatorCount 4

# 只啟 conversion + Kit，不啟 Docker web-plane
.\scripts\deploy.ps1 -SkipDocker

# 只看 preflight / auto-fix plan，不啟服務
.\scripts\deploy.ps1 -DryRun
```

Deploy flags：

| Flag | 用途 | 何時用 |
|---|---|---|
| `-DryRun` | 只跑 preflight、寫 `deploy-audit.json`，不做 Phase 2/4 真實動作 | demo 前檢查 |
| `-Build` | 強制 `docker compose up --build` coordinator / viewer | Dockerfile 或前端/後端 image 改過 |
| `-Pull` | Phase 2 顯式 `docker compose pull` | 需要拉遠端 image 時 |
| `-Force` | Phase 3 互動 guard 全部視同 yes | 確認可停陌生 port PID 或重建 `.venv` 時 |
| `-EnvFile <path>` | 使用指定 env file | 多台 demo 主機維護不同設定 |
| `-PublicHost <host>` | 覆蓋 browser-visible host | LAN demo IP 或 local-only 切換 |
| `-ConversionBindHost <host>` | 覆蓋 conversion-service bind host | debug 49101 綁定問題 |
| `-KitSignalPort`, `-KitMediaPort` | 覆蓋 primary Kit signaling / media port | 預設 port 被佔用 |
| `-SpectatorCount` | spectator 數量，不含 primary | primary + 4 時設 `4` |
| `-KitSpectatorSignalPortStart`, `-KitSpectatorMediaPortStart`, `-KitSpectatorPortStride` | spectator port 序列設定 | 多組 demo 或避開 port collision |
| `-SkipConversion` | 跳過 Phase 4a conversion-service | rare debug；完整 demo 不建議 |
| `-SkipKit` | 跳過 Phase 4b Kit/WebRTC | 只驗 web-plane/API |
| `-SkipDocker` | 跳過 Phase 4c Docker web-plane | 只驗 host-native conversion + Kit |
| `-StrictPostVerify` | Phase 5 warning 改成 exit 5 | CI 或嚴格 smoke |

`.env.web-plane.host-kit` 常用 key：

| Key | 預設 / 作用 |
|---|---|
| `PUBLIC_HOST` | 預設 `192.168.10.105`；給 viewer / coordinator / Kit WebRTC 的公開位址 |
| `COORDINATOR_PORT`, `VIEWER_PORT` | 預設 `8004` / `5173` |
| `VIEWER_BIND_HOST` | LAN demo 會設 `0.0.0.0`；local-only 用 `127.0.0.1` |
| `HOST_CONVERSION_API_BASE` | container 連 host-native conversion API；Windows Docker Desktop 預設 `http://host.docker.internal:49101` |
| `WEB_VIEWER_COORDINATOR_API_BASE`, `WEB_VIEWER_COORDINATOR_SOCKET_URL` | browser 連 coordinator；未設時由 `PUBLIC_HOST` + `COORDINATOR_PORT` 推導 |
| `VIEWER_PUBLIC_BASE_URL`, `COORDINATOR_PUBLIC_BASE_URL` | `/ui/open` redirect 與 summary URL；未設時由 `PUBLIC_HOST` 推導 |
| `KIT_SIGNALING_HOST`, `KIT_MEDIA_HOST` | browser-visible Kit host；未設時由 `PUBLIC_HOST` 推導 |
| `KIT_SIGNALING_PORT`, `KIT_MEDIA_PORT` | primary stream 預設 `49100` / `47998` |
| `KIT_SPECTATOR_COUNT` | spectator 數量；預設 `5`，primary + 4 請設 `4` |
| `KIT_SPECTATOR_SIGNALING_PORT_START`, `KIT_SPECTATOR_MEDIA_PORT_START`, `KIT_SPECTATOR_PORT_STRIDE` | spectator ports 預設 `49110`、`48008`、stride `10` |
| `STREAMING_CONVERSION_PUBLIC_ARTIFACTS_URL` | browser/Kit-visible conversion artifacts URL；LAN 預設 `http://192.168.10.105:49101/artifacts` |
| `RUNTIME_STORAGE_ROOT` | deploy 缺值時會補 `<RepoRoot>\storage`；leaf 必須是 `storage` |

### 如何看 log

一鍵部署的主 log 都在 `scripts\.run\`。先看 `deploy.log`，再依失敗 phase 打開對應 log。

```powershell
Get-Content scripts\.run\deploy.log -Tail 120 -Wait
Get-Content scripts\.run\bim-streaming-conversion-service.log -Tail 120 -Wait
Get-Content scripts\.run\bim-streaming-conversion-service.log.err -Tail 120 -Wait
Get-Content scripts\.run\bim-streaming-server.log -Tail 120 -Wait
Get-Content scripts\.run\bim-streaming-server.log.err -Tail 120 -Wait
Get-Content scripts\.run\docker-compose-up.log -Tail 120 -Wait
Get-Content scripts\.run\docker-compose-up.err.log -Tail 120 -Wait
docker compose -f compose.runtime-manager.yml -f compose.host-kit.yml --env-file .env.web-plane.host-kit ps
docker compose -f compose.runtime-manager.yml -f compose.host-kit.yml --env-file .env.web-plane.host-kit logs -f --tail=100 coordinator viewer
```

| Log / artifact | 內容 |
|---|---|
| `scripts\.run\deploy.log` | Phase 1-5 的 `[ok] / [fix] / [ask] / [warn] / [fail]` 主線 |
| `scripts\.run\deploy-audit.json` | preflight resolved config：public host、ports、env file、volume、spectator ports |
| `scripts\.run\bim-streaming-conversion-service.log(.err)` | Phase 4a host-native conversion-service stdout/stderr |
| `scripts\.run\bim-streaming-server.log(.err)` | Phase 4b host-native Kit/WebRTC stdout/stderr |
| `scripts\.run\docker-compose-up.log` / `.err.log` | Phase 4c web-plane Docker startup |
| `scripts\.run\*.pid` | host-native wrapper PID files；`stop-all.ps1` 會用它們停服務 |
| `scripts\.run\bim-streaming-server.params.json` | Kit runtime signature；public host / ports 改變時 deploy 會重啟 Kit |

### 如何 debug

先用 phase 判斷壞在哪一層：

```powershell
.\scripts\deploy.ps1 -DryRun
Get-Content scripts\.run\deploy.log -Tail 160
```

| 失敗位置 | 先看 | 常用處理 |
|---|---|---|
| Phase 1 Docker | `docker version`、Docker Desktop tray | 啟動 Docker Desktop，等 engine running |
| Phase 1 Python deps | `.\.venv\Scripts\python.exe -c "import fastapi, starlette, uvicorn; print(fastapi.__version__, starlette.__version__, uvicorn.__version__)"` | `.\.venv\Scripts\python.exe -m pip install -r .\bim-streaming-server\requirements.txt` |
| Phase 1 port occupied | `Get-NetTCPConnection -LocalPort 8004,5173,49100,49101 -ErrorAction SilentlyContinue` | 若是自己的 PID，先 `.\scripts\stop-all.ps1`；陌生 PID 需人工確認或 `-Force` |
| Phase 1 volume | `Get-Content .env.web-plane.host-kit | Select-String RUNTIME_STORAGE_ROOT` | 確認 path leaf 是 `storage` |
| Phase 4a conversion | `scripts\.run\bim-streaming-conversion-service.log.err`、`http://127.0.0.1:49101/health` | 修 Python deps / port / STORAGE_ROOT，再重跑 |
| Phase 4b Kit | `scripts\.run\bim-streaming-server.log.err`、`nvidia-smi`、port `49100` | 確認 NVIDIA driver、Kit runtime build artifacts；必要時在 `bim-streaming-server` 跑 `.\repo.bat build` |
| Phase 4c Docker | `scripts\.run\docker-compose-up.err.log`、`docker compose ... ps` | 看 coordinator/viewer container logs，必要時 `-Build` |
| Phase 5 verify | `http://127.0.0.1:8004/health`、`http://127.0.0.1:5173`、`http://127.0.0.1:49101/health` | 對應服務健康檢查，若要嚴格失敗用 `-StrictPostVerify` |

清乾淨再重跑：

```powershell
.\scripts\stop-all.ps1
docker compose -f compose.runtime-manager.yml -f compose.host-kit.yml --env-file .env.web-plane.host-kit down
.\scripts\deploy.ps1 -Force
```

### 開啟 primary + 4 spectator viewers

`deploy.ps1` 會用同一個 Kit runtime 建 primary stream，再用 spectator ports 產生多 viewer endpoint。若 demo 目標是 **1 個 primary + 4 個 spectator viewer**，用 `-SpectatorCount 4` 明確鎖定總共 5 個 viewer：

```powershell
.\scripts\deploy.ps1 -Build -SpectatorCount 4
```

預設 port 配置：

| viewer | role | kitInstanceId | signaling | media |
|---|---|---|---|---|
| Primary | primary | `kit_local_001` | `192.168.10.105:49100` | `192.168.10.105:47998` |
| Spec 1 | spectator | `kit_local_001_spectator_01` | `192.168.10.105:49110` | `192.168.10.105:48008` |
| Spec 2 | spectator | `kit_local_001_spectator_02` | `192.168.10.105:49120` | `192.168.10.105:48018` |
| Spec 3 | spectator | `kit_local_001_spectator_03` | `192.168.10.105:49130` | `192.168.10.105:48028` |
| Spec 4 | spectator | `kit_local_001_spectator_04` | `192.168.10.105:49140` | `192.168.10.105:48038` |

開啟方式：

1. 打開 <http://192.168.10.105:8004/ui>。
2. 建立或載入 demo review session，複製畫面上的 `review_session_id`。
3. 把下方 `$session` 換成該 session id，在 PowerShell 開 5 個 viewer tab/window。

```powershell
$session = "review_session_xxx"
$base = "http://192.168.10.105:8004/ui/open?session=$session"

Start-Process "$base&userId=viewer_primary&displayName=Primary"

1..4 | ForEach-Object {
    $spec = "{0:D2}" -f $_
    $kit = "kit_local_001_spectator_$spec"
    Start-Process "$base&userId=viewer_spec_$spec&displayName=Spec_$spec&streamRole=spectator&kitInstanceId=$kit"
}
 '&streamRole=spectator&kitInstanceId=kit_local_001_spectator_02'
```

`/ui/open` 會把 request 轉到 trusted viewer URL，並自動補上 `coordinatorApiBase` / `coordinatorSocketUrl`，所以 LAN client 不會被導到自己的 `127.0.0.1`。若 spectator 畫面卡在 busy/disconnected，先看 `scripts\.run\bim-streaming-server.log`，並確認對應 signaling/media ports 沒被防火牆或其他 process 擋住。

### README 真實性檢查

本 README 的 deploy 內容以這些檔案為準：

| Source | 用來核對 |
|---|---|
| `scripts\deploy.ps1` | CLI flags、預設值、phase、log path、exit behavior |
| `.env.web-plane.host-kit.example` | LAN demo env key 與預設值 |
| `compose.host-kit.yml` | coordinator/viewer port mapping 與 container env |
| `bim-review-coordinator\tests\dev-console.test.ts` | `/ui/open` redirect 與 allowed query params |
| `docs\runbooks\one-click-deploy-smoke.md` | one-click deploy smoke 預期 |

修改 README 後至少跑：

```powershell
rg -n "給客戶的 5 步[驟]|Docker[-]first Runtime Manager MVP|CODE_GOAL_DOCKER_KIT_[M]VP|Demo 故事[位]置" README.md
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\deploy.ps1 -DryRun
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\tests\test-deploy-dryrun.ps1
git diff --check -- README.md
```

第一個 `rg` 預期沒有輸出；`deploy.ps1 -DryRun` 預期退 0，並在 Phase 1 顯示 `host-native pythonDependencies=OK`。

---

## 手動 Debug 啟動（非一鍵 demo）

本段落只供 local debug 使用，不是 demo 預設路徑。demo 優先用 `.\scripts\deploy.ps1 -Build`。

每個服務獨立 terminal，依序啟動。

Terminal 1：coordinator `8004`

```powershell
cd C:\Repos\active\iot\AI-BIM-governance\bim-review-coordinator
npm install
npm run dev
```

Terminal 2：conversion authority `49101`

```powershell
cd C:\Repos\active\iot\AI-BIM-governance\bim-streaming-server
if (-not (Test-Path ..\.venv\Scripts\python.exe)) { python -m venv ..\.venv }
..\.venv\Scripts\python.exe -m pip install -r .\requirements.txt
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-host-native-conversion-service.ps1 -PythonExe ..\.venv\Scripts\python.exe
```

Terminal 3：Kit / WebRTC `49100` / `47998`

```powershell
cd C:\Repos\active\iot\AI-BIM-governance\bim-streaming-server
.\scripts\start-streaming-server.ps1 -SkipAutoLoad
```

Terminal 4：viewer `5173`

```powershell
cd C:\Repos\active\iot\AI-BIM-governance\web-viewer-sample
npm install
npm run dev -- --host 127.0.0.1
```

> 為什麼 Kit server 用 `-SkipAutoLoad`：demo 中 USD / USDC 模型載入由
> `web-viewer-sample` 透過 DataChannel `openStageRequest` 主動觸發，避免 Kit 啟動時
> auto-load 與 browser DataChannel 請求競速。

---

## 服務分工與邊界

| 目錄 | 角色 | 責任邊界 |
|---|---|---|
| `bim-review-coordinator/` | 外部 IFC-ready intake + Session / Collaboration Control Plane | 驗證 service auth、建立 local conversion job、dispatch streaming conversion、維護 callback outbox、建立 review session、廣播 collaboration event；不渲染 3D、不保存大型模型本體。 |
| `bim-streaming-server/` | IFC→USDC Conversion Authority + Omniverse Kit Runtime / WebRTC | Internal-only conversion engine，產生 USDC / mapping / entity index / manifest；負責 Kit viewport、WebRTC、DataChannel command；不管理 project / user / annotation 權威。 |
| `web-viewer-sample/` | Browser Client / User Interaction Layer | 顯示串流畫面、建立或加入 review session、送 DataChannel command、送 annotation / collaboration event；不啟動 Kit、不保存資料權威、不直連已刪 runtime。 |
| `tests/contracts/` | API / event contracts | 描述外部 IFC Worker、公司雲端 callback、metadata-only contract。 |
| `tests/fakes/` | Test-only external platform doubles | 模擬外部 IFC Worker 與公司雲端，不是 runtime profile。 |
| `docs/contracts/` | API / event contracts | REST、Socket.IO、DataChannel 與 local runbook contract。 |
| `docs/plans/` | Implementation plans | 目前執行計畫與驗收 checklist。 |
| `docs/wiki/` | Graphify wiki snapshot | AI agent 與 reviewer 的探索輔助，最終以程式碼為準。 |
| `scripts/` | Root verification scripts | 跨服務健康檢查與 B 方案驗證入口；不得把已刪 runtime 標成必跑 pass gate。 |

### Source of Truth

```txt
對外 IFC-ready intake → bim-review-coordinator
IFC→USDC conversion authority → bim-streaming-server
雲端 metadata-only callback outbox → bim-review-coordinator
外部公司雲端 control-plane → 非本 repo runtime，由 tests/fakes 模擬
外部客戶落地端 IFC Worker → 非本 repo runtime，由 tests/fakes 模擬
Session / collaboration → bim-review-coordinator
3D runtime → bim-streaming-server
使用者操作 → web-viewer-sample
```

---

## 核心文件入口

| 文件 | 角色 | 何時看 |
|---|---|---|
| [`AGENTS.md`](AGENTS.md) | **Repo 邊界與資料權威**（最高優先） | 不確定哪個服務該做什麼、資料權威歸誰 |
| [`docs/PROJECT_DEVELOPMENT_WORKFLOW.md`](docs/PROJECT_DEVELOPMENT_WORKFLOW.md) | **開發流程入口** | 新進工程師 onboarding、PR review、demo 簡報 |
| [`docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md`](docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md) | **SaaS 路線圖** | 架構決策、OpenSpec owner、技術 review |
| [`docs/PR_REVIEW_AGENT.md`](docs/PR_REVIEW_AGENT.md) | **PR review agent gate** | 自動審查報告、blocker / warning 解讀、本機重跑 |
| [`openspec/specs/`](openspec/specs/) | **Capability specs** | 修改任何服務前先讀對應 capability spec 與 archived change |

---

## 驗證命令

Root contracts / fakes：

```powershell
python -m pytest tests -p no:cacheprovider
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

B 方案 intake → conversion smoke（會檢查目前 repo 的 `storage/*.ifc`）：

```powershell
powershell -NoProfile -File scripts\smoke-bscheme-intake.ps1
```

此 smoke 的 evidence 會寫到
[`docs/verification/evidence/2026-05-18-bscheme-intake-smoke/bscheme-readiness.json`](docs/verification/evidence/2026-05-18-bscheme-intake-smoke/bscheme-readiness.json)。
若 `storage/*.ifc` 沒有真實 IFC，`real_ifc_fixture` 與
`real_ifc_intake_conversion` 必須是 `blocked`，不得用 contract stub 或歷史
worker evidence 代替 passed。

Viewer：

```powershell
cd web-viewer-sample
npm run test:session-first
npm run build
```

Shell / PowerShell script sanity：

```powershell
bash -n scripts/verify-all.sh
powershell -NoProfile -Command "[scriptblock]::Create((Get-Content -Raw scripts/smoke-bscheme-intake.ps1)) | Out-Null"
```

---

## AI Agent 輔助 Wiki

Graphify（跨文件知識圖）：

- Report: [`docs/wiki/graphify/GRAPH_REPORT.md`](docs/wiki/graphify/GRAPH_REPORT.md)
- Interactive graph: [`docs/wiki/graphify/graph.html`](docs/wiki/graphify/graph.html)

> 它只是輔助探索；**最終以程式碼與 contracts 文件為準**。

---

## Git 注意事項

- Root repo remote: `https://github.com/monkey1sai/AI-BIM-governance.git`
- 整個 workspace 採 single root repo；只保留 `AI-BIM-governance/.git`
- 不使用 submodule / subtree 管理服務目錄
- 大型 BIM artifact 預設不進 git：`*.ifc`、`*.usdc`、`*.usd`、`*.rvt`、`*.dwg`
- 小型 fixture 可放 `_fixtures/`
- `node_modules/`、Kit build output、local conversion jobs、`.gitnexus/` 皆不納入 git

### OpenSpec GitHub workflow

```txt
OpenSpec = 需求 / 規格 / 驗收條件
Git Branch = 實作隔離
Pull Request = 審查與討論
GitHub Actions = 自動驗證
PR Review Agent = 自動整理風險、驗證命令、blocker / warning 的 gate
Merge = 正式接受變更
Archive = 把變更規格併入正式規格
```

- 每個 `/openspec new <change-id>` 先從最新 `main` 建立 `codex/openspec/<change-id>` branch。
- `/openspec apply <change-id>` 的實作、測試、文件與 task 勾選都留在該 branch。
- 開 PR 後由 review 討論、GitHub Actions 驗證與 `pr-review-agent` 報告決定是否可進入 merge；agent 不自動 merge，也不取代人工審查 / CODEOWNERS / branch protection。
- merge 後才執行 OpenSpec sync/archive，將 delta specs 併入正式 `openspec/specs/`。
- 本機可重跑自動審查：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\pr-review-agent.ps1 -BaseSha origin/main -HeadSha HEAD
```

# AI-BIM-governance

AI-BIM-governance 是本地 PoC / integration workspace，用來驗證 BIM 模型轉檔、假資料平台、假物件儲存、Omniverse Kit streaming runtime、review coordinator 與 browser web viewer 之間的最小閉環。

目前 repo 採 single root repo 管理，所有服務都是普通子目錄；不要在子目錄內恢復 nested `.git`。

## 可閱讀 Wiki

GitNexus 產生的 repo wiki 已放到：

- HTML viewer: [docs/wiki/gitnexus/index.html](docs/wiki/gitnexus/index.html)
- Markdown pages: [docs/wiki/gitnexus/](docs/wiki/gitnexus/)

Graphify 產生的跨文件知識圖譜已放到：

- Report: [docs/wiki/graphify/GRAPH_REPORT.md](docs/wiki/graphify/GRAPH_REPORT.md)
- Interactive graph: [docs/wiki/graphify/graph.html](docs/wiki/graphify/graph.html)
- Graph JSON: [docs/wiki/graphify/graph.json](docs/wiki/graphify/graph.json)
- Agent-readable wiki: [docs/wiki/graphify/wiki/index.md](docs/wiki/graphify/wiki/index.md)

原始 GitNexus 輸出仍可由 `.gitnexus/wiki/` 重新產生，但 `.gitnexus/` 是本地索引資料，不納入 git 追蹤。若要更新可閱讀版本，先重新產生 wiki，再同步到 `docs/wiki/gitnexus/`。

```powershell
npx gitnexus status
npx gitnexus wiki
Copy-Item .\.gitnexus\wiki\* .\docs\wiki\gitnexus\ -Recurse -Force
```

## 目錄分工

| 目錄 | 角色 | 責任邊界 |
|---|---|---|
| `_bim-control/` | Fake BIM Data Authority | 保存 project / model version / artifact / issue / annotation metadata；不保存大型檔案、不渲染 3D、不做 WebRTC。 |
| `_s3_storage/` | Fake Object Storage | 提供 IFC / USD / USDC / mapping JSON 等檔案本體與 HTTP static URL；不管理 session、不保存業務語意。 |
| `_conversion-service/` | IFC to USDC Conversion API | 建立 conversion job、呼叫 Kit converter、產出 `model.usdc`、`ifc_index.json`、`usd_index.json`、`element_mapping.json`，並發布到 fake storage / fake BIM API。 |
| `bim-review-coordinator/` | Session / Collaboration Control Plane | 建立 review session、查詢 BIM metadata、提供 stream config、廣播 presence / selection / annotation / issue focus events；不直接操作 USD stage。 |
| `bim-streaming-server/` | Omniverse Kit Runtime / WebRTC Streaming Server | 載入 USD / USDC、執行 viewport runtime、WebRTC streaming、DataChannel command，如 `openStageRequest`、`highlightPrimsRequest`。 |
| `web-viewer-sample/` | Browser Client / WebRTC Viewer | 顯示 streaming 畫面、建立 review session、讀 artifacts/issues、送 DataChannel command、送 collaboration events；不啟動 Kit、不保存資料權威。 |
| `docs/contracts/` | API / event contracts | 記錄 REST、Socket.IO、DataChannel 與 local runbook contract。 |
| `docs/plans/` | Implementation plans | 保存目前執行計畫與驗收 checklist。 |
| `docs/git/` | Git migration notes | 保存 nested repo remote 與 backup path 紀錄。 |
| `docs/graphify-corpus/` | Graphify source corpus | 跨文件知識圖譜的固定輸入集；目前只納入 contracts / plans / git notes。 |
| `docs/wiki/gitnexus/` | GitNexus generated wiki snapshot | 可閱讀的 repo wiki 快照，供 GitHub / 本機瀏覽。 |
| `docs/wiki/graphify/` | Graphify knowledge graph snapshot | 補足 GitNexus 不擅長的跨文件關係：service boundaries、API/event flow、conversion → review → streaming 閉環、monorepo context。 |
| `scripts/` | Root smoke scripts | 跨服務健康檢查與 review session smoke test。 |

## Source of Truth

| 資料類型 | 權威位置 |
|---|---|
| Project / model version metadata | `_bim-control` |
| Artifact metadata | `_bim-control` |
| IFC / USD / USDC file body | `_s3_storage` |
| Conversion job state | `_conversion-service` |
| Review session state | `bim-review-coordinator` |
| Collaboration events | `bim-review-coordinator` |
| USD runtime state | `bim-streaming-server` |
| Browser UI state | `web-viewer-sample` |

核心原則：

```txt
資料權威歸資料層
檔案本體歸 storage
session 歸 coordinator
3D runtime 歸 streaming server
使用者操作歸 web viewer
```

## 本地啟動

以下命令以 PowerShell 執行。每個服務建議用獨立 terminal，並從 repo root 開始：

```powershell
cd C:\Repos\active\iot\AI-BIM-governance
```

啟動 `_bim-control`：

```powershell
cd _bim-control
..\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8001
```

啟動 `_s3_storage`：

```powershell
cd _s3_storage
..\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8002
```

啟動 `_conversion-service`：

```powershell
cd _conversion-service
..\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8003
```

啟動 `bim-review-coordinator`：

```powershell
cd bim-review-coordinator
npm install
npm run dev
```

啟動 `bim-streaming-server`：

```powershell
cd bim-streaming-server
.\scripts\start-streaming-server.ps1 -UsdPath .\bim-models\許良宇圖書館建築_2026.usd
```

`start-streaming-server.ps1` 會把 NvStreamer 的 `*-NvStreamer.etl` trace 固定寫到 `bim-streaming-server/logs/nvstreamer/`。若直接使用 `repo.bat launch`，NvStreamer 會依目前工作目錄輸出 `.etl`，容易污染 server repo root。

啟動 `web-viewer-sample`：

```powershell
cd web-viewer-sample
npm install
npm run dev -- --host 127.0.0.1
```

打開 client web view：

```txt
http://127.0.0.1:5173
```

## 常用驗證命令

健康檢查：

```powershell
.\scripts\dev-health-check.ps1
```

Review session smoke：

```powershell
.\scripts\smoke-review-session.ps1
```

Conversion smoke：

```powershell
.\_conversion-service\scripts\smoke_conversion.ps1 -TimeoutSeconds 1800
```

Python tests 需要分服務執行，因為多個 FastAPI service 都使用 `app` package name，從 root 一次收集會互相污染 import cache：

```powershell
cd _bim-control
..\.venv\Scripts\python.exe -m pytest tests

cd ..\_s3_storage
..\.venv\Scripts\python.exe -m pytest tests

cd ..\_conversion-service
..\.venv\Scripts\python.exe -m pytest tests
```

Node tests / builds：

```powershell
cd bim-review-coordinator
npm test
npm run build

cd ..\web-viewer-sample
npm run build
```

Kit build / test：

```powershell
cd bim-streaming-server
.\repo.bat build
.\repo.bat test
```

## GitNexus

檢查 index：

```powershell
npx gitnexus status
```

更新 analysis：

```powershell
npx gitnexus analyze --skip-agents-md
```

產生 wiki：

```powershell
npx gitnexus wiki
```

同步 wiki 到可追蹤文件資料夾：

```powershell
Copy-Item .\.gitnexus\wiki\* .\docs\wiki\gitnexus\ -Recurse -Force
```

## Graphify

Graphify 的輸入 corpus 固定在 `docs/graphify-corpus/`，正式輸出同步到 `docs/wiki/graphify/`。更新時先產生本機暫存輸出，再同步可追蹤副本：

```powershell
# graphify-out/ 是本機暫存，不納入 git
# 目前 corpus: docs/contracts, docs/plans, docs/git
graphify query "What connects conversion output to issue highlight?" --graph docs/wiki/graphify/graph.json
```

若要重建完整 graph，沿用 `graphify` skill 產生 `graphify-out/GRAPH_REPORT.md`、`graphify-out/graph.json`、`graphify-out/graph.html`、`graphify-out/wiki/`，再同步到 `docs/wiki/graphify/`。

## Git 注意事項

- Root repo remote: `https://github.com/monkey1sai/AI-BIM-governance.git`
- Repo 內應只保留一個 `.git`：`AI-BIM-governance/.git`
- 不使用 submodule / subtree 管理目前這些服務目錄
- 大型 BIM artifact 預設不進 git：`*.ifc`、`*.usdc`、`*.usd`、`*.rvt`、`*.dwg`
- 可提交小型 fixture 時，優先放到 `_fixtures/`
- `node_modules/`、Kit build output、local conversion jobs、`.gitnexus/` 不納入 git

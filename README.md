# AI-BIM-governance

> **BIM 審查雲端 (BIM Review Cloud) — Local Demo Workspace**
>
> 本 workspace 是「BIM 模型自動轉換 → 雲端 3D 串流審查 → 多人協作標記 → 紀錄回寫主資料庫」整條閉環的本地 PoC。
> 所有服務都在你電腦上，用 fake mock 模擬正式產品 (BIM 主平台 / 雲端物件儲存)。

---

## 給客戶的 5 步驟 Demo 故事 (5-Step Demo Storyboard)

| 步驟 | 客戶看到 | 對應服務 | URL |
|---|---|---|---|
| ① 上傳建模 (Upload) | 原始建模檔已存在雲端倉庫 | `_s3_storage` | <http://127.0.0.1:8002> |
| ② 自動轉換 (Convert) | 一鍵把建模檔轉成可在瀏覽器即時審查的 3D 模型 | `_conversion-service` | <http://127.0.0.1:8003> |
| ③ 建立會議 (Meeting) | 一鍵開啟雲端審查會議，取得連線資訊 | `bim-review-coordinator` | <http://127.0.0.1:8004> |
| ④ 標記問題 (Mark)   | 進入瀏覽器看 3D 模型、點問題即高亮對應元件 | `web-viewer-sample` + `bim-streaming-server` | <http://127.0.0.1:5173> |
| ⑤ 紀錄回寫 (Record) | 審查標註已寫回主資料庫，留下審查履歷 | `_bim-control` | <http://127.0.0.1:8001> |

> **最快 demo 路徑**：直接打開瀏覽器，依序 `8002 → 8003 → 8004 → 5173 → 8001`。每頁都有頂部的步驟條，可單向流暢走完。
>
> **時間緊迫時**：可省略步驟 ⑤，從步驟 ④ 結束。但步驟條保留完整顯示，讓客戶看見全貌。

每個頁面的設計都遵守 [`docs/plans/BIM_REVIEW_DEMO_UI_GUIDELINES.md`](docs/plans/BIM_REVIEW_DEMO_UI_GUIDELINES.md)：
- 業務語言優先 (Business language first)
- 線性 5 步驟流程條 (Step bar)
- 狀態號誌化 (●綠就緒 / ●黃進行中 / ●紅未連線)
- 每個按鈕一句「會發生什麼」(Action caption)
- 失敗友善：直接告訴你哪個服務沒開、怎麼開
- 跨服務一致：淺色 + 藍色卡片風格、共用 design tokens

---

## Demo 啟動順序 (One-shot Bring-up)

每個服務獨立 terminal，依序啟動：

```powershell
# Repo root
cd C:\Repos\active\iot\AI-BIM-governance

# 1. 雲端倉庫 (8002)
cd _s3_storage
..\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8002

# 2. 主資料庫 (8001)
cd _bim-control
..\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8001

# 3. 模型轉換 (8003)
cd _conversion-service
..\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8003

# 4. 審查協調 (8004)
cd bim-review-coordinator
npm install   # 第一次需要
npm run dev

# 5. Omniverse Kit 串流伺服器 (49100 WebRTC)
cd bim-streaming-server
.\scripts\start-streaming-server.ps1 -SkipAutoLoad

# 6. 瀏覽器審查端 (5173)
cd web-viewer-sample
npm install   # 第一次需要
npm run dev -- --host 127.0.0.1
```

> 為什麼 Kit server 用 `-SkipAutoLoad`：
> demo 中 USD 模型的載入由 web-viewer-sample 透過 `openStageRequest` 主動觸發，避免 Kit 啟動時 auto-load 與 browser DataChannel 請求競速。`start-streaming-server.ps1` 會把 NvStreamer 的 `*-NvStreamer.etl` trace 固定寫到 `bim-streaming-server/logs/nvstreamer/`。

---

## 服務分工與邊界 (Service Boundaries)

| 目錄 | 角色 | Demo 故事位置 | 責任邊界 |
|---|---|---|---|
| `_bim-control/` | 主資料庫 (Fake BIM Data Authority) | 步驟 ⑤ | 保存 project / model version / artifact / issue / annotation metadata；不保存大型檔案、不渲染 3D、不做 WebRTC。 |
| `_s3_storage/` | 雲端倉庫 (Fake Object Storage) | 步驟 ① | 提供 IFC / USD / USDC / mapping JSON 等檔案本體與 HTTP static URL；不管理 session、不保存業務語意。 |
| `_conversion-service/` | 模型轉換服務 (Conversion API) | 步驟 ② | 建立 conversion job、呼叫 Kit converter、產出 `model.usdc`、`element_mapping.json`，並發布到 fake storage / fake BIM API。 |
| `bim-review-coordinator/` | 審查協調 (Session / Collaboration Control Plane) | 步驟 ③ | 建立 review session、查詢 BIM metadata、提供 stream config、廣播 presence / selection / annotation / issue focus；不直接操作 USD stage。 |
| `bim-streaming-server/` | Omniverse Kit Runtime / WebRTC | 步驟 ④ (背景) | 載入 USD / USDC、執行 viewport runtime、WebRTC streaming、DataChannel command (`openStageRequest`、`highlightPrimsRequest`)；無 UI，存在感由 web-viewer 呈現。 |
| `web-viewer-sample/` | 瀏覽器審查端 (Browser Client) | 步驟 ④ | 顯示串流畫面、建立或加入 review session、讀 artifacts/issues、送 DataChannel command、送 collaboration events；不啟動 Kit、不保存資料權威。 |
| `docs/contracts/` | API / event contracts | — | REST、Socket.IO、DataChannel 與 local runbook contract。 |
| `docs/plans/` | Implementation plans | — | 目前執行計畫與驗收 checklist；**Demo UI 守則** 在 `BIM_REVIEW_DEMO_UI_GUIDELINES.md`。 |
| `docs/wiki/` | GitNexus / Graphify wiki snapshot | — | AI agent 與 reviewer 的探索輔助，最終以程式碼為準。 |
| `scripts/` | Root smoke scripts | — | 跨服務健康檢查與 review session smoke test。 |

### Source of Truth

```txt
資料權威 → _bim-control
檔案本體 → _s3_storage
Session  → bim-review-coordinator
3D runtime → bim-streaming-server
使用者操作 → web-viewer-sample
```

---

## Demo UI 設計守則

所有面對 demo 觀眾的 UI（5 個服務頁面）都依循同一份守則：

> [`docs/plans/BIM_REVIEW_DEMO_UI_GUIDELINES.md`](docs/plans/BIM_REVIEW_DEMO_UI_GUIDELINES.md)

要點：

1. **客戶看不到的字眼**：`USD / USDC / prim_path / DataChannel / payload / Socket.IO / WebRTC signaling` 等技術名詞只能出現在「展開技術細節」折疊區。
2. **每頁頂部**固定步驟條，當前頁亮起，其他步驟可點擊跳轉。
3. **狀態號誌化**：●綠就緒 / ●黃進行中 / ●紅未連線。
4. **每個按鈕一句「會發生什麼」**：例 `[ 開始轉換 ] ↳ 系統會把建模檔轉成 3D 可審查模型 (約 30~60 秒)`。
5. **失敗友善**：直接告知哪個服務沒開、可貼的 PowerShell 啟動指令。
6. **跨服務一致**：5 個 UI 共用一份 design tokens；權威來源在 [`web-viewer-sample/src/styles/demo-theme.css`](web-viewer-sample/src/styles/demo-theme.css)。

任何 UI 改動先讀守則、再動手；違反守則的 PR 應被退回。

---

## 驗證命令 (Validation)

健康檢查：

```powershell
.\scripts\dev-health-check.ps1
```

Review session smoke：

```powershell
.\scripts\smoke-review-session.ps1
```

Socket.IO 多人協作 smoke：

```powershell
.\scripts\smoke-review-socket.ps1
```

Conversion smoke：

```powershell
.\_conversion-service\scripts\smoke_conversion.ps1 -TimeoutSeconds 1800
```

Python tests（每個 fake service 各自 `app` package name，需分服務跑避免 import cache 互相污染）：

```powershell
cd _bim-control          ; ..\.venv\Scripts\python.exe -m pytest tests
cd ..\_s3_storage        ; ..\.venv\Scripts\python.exe -m pytest tests
cd ..\_conversion-service; ..\.venv\Scripts\python.exe -m pytest tests
```

Node tests / builds：

```powershell
cd bim-review-coordinator; npm test; npm run build
cd ..\web-viewer-sample  ; npm run build
```

Kit build / test：

```powershell
cd bim-streaming-server
.\repo.bat build
.\repo.bat test
```

---

## AI Agent 輔助 Wiki

GitNexus（程式索引導覽）：
- HTML viewer: [`docs/wiki/gitnexus/index.html`](docs/wiki/gitnexus/index.html)
- Markdown pages: [`docs/wiki/gitnexus/`](docs/wiki/gitnexus/)

Graphify（跨文件知識圖）：
- Report: [`docs/wiki/graphify/GRAPH_REPORT.md`](docs/wiki/graphify/GRAPH_REPORT.md)
- Interactive graph: [`docs/wiki/graphify/graph.html`](docs/wiki/graphify/graph.html)

> 兩者只是輔助探索；**最終以程式碼與 contracts 文件為準**。

維護命令：

```powershell
npx gitnexus status
npx gitnexus analyze --skip-agents-md
npx gitnexus wiki
Copy-Item .\.gitnexus\wiki\* .\docs\wiki\gitnexus\ -Recurse -Force
```

---

## Git 注意事項

- Root repo remote: `https://github.com/monkey1sai/AI-BIM-governance.git`
- 整個 workspace 採 single root repo；只保留 `AI-BIM-governance/.git`
- 不使用 submodule / subtree 管理服務目錄
- 大型 BIM artifact 預設不進 git：`*.ifc`、`*.usdc`、`*.usd`、`*.rvt`、`*.dwg`
- 小型 fixture 可放 `_fixtures/`
- `node_modules/`、Kit build output、local conversion jobs、`.gitnexus/` 皆不納入 git

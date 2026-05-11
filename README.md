# AI-BIM-governance

> **BIM 審查雲端 (BIM Review Cloud) — Local Demo Workspace**
>
> 本 workspace 是「BIM 模型自動轉換 → 雲端 3D 串流審查 → 多人協作標記 → 紀錄回寫主資料庫」整條閉環的本地 PoC。
> 所有服務都在你電腦上，用 fake mock 模擬正式產品 (BIM 主平台 / 雲端物件儲存)。

---

## 給客戶的 5 步驟 Demo 故事 (5-Step Demo Storyboard)

| 步驟 | 客戶看到 | 對應服務 | URL |
|---|---|---|---|
| ① 上傳建模 (Upload) | 原始建模檔交給 worker facade，產生版本化 artifact group | `_worker` | <http://127.0.0.1:8005> |
| ② 自動轉換 (Convert) | 一鍵把建模檔轉成可在瀏覽器即時審查的 3D 模型 | `_worker` | <http://127.0.0.1:8005> |
| ③ 建立會議 (Meeting) | 一鍵開啟雲端審查會議，取得連線資訊 | `bim-review-coordinator` | <http://127.0.0.1:8004> |
| ④ 標記問題 (Mark)   | 進入瀏覽器看 3D 模型、點問題即高亮對應元件 | `web-viewer-sample` + `bim-streaming-server` | <http://127.0.0.1:5173> |
| ⑤ 紀錄回寫 (Record) | 審查標註已寫回主資料庫，留下審查履歷 | `_bim-control` | <http://127.0.0.1:8001> |

> **最快 demo 路徑**：直接打開瀏覽器，依序 `8005 → 8004 → 5173 → 8001`。
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

### 一鍵啟動 / 關閉 (Recommended)

**Windows (PowerShell):**

```powershell
# Repo root
cd C:\Repos\active\iot\AI-BIM-governance

# 一次啟動 worker-only demo services（背景執行；log 寫到 scripts\.run\<svc>.log）
.\scripts\start-all.ps1

# 一次關閉所有服務（tree-kill 連子行程一起清掉）
.\scripts\stop-all.ps1
```

選用旗標：`-SkipStreaming`（跳過 Kit GPU runtime）/ `-SkipViewer` / `-SkipCoordinator` / `-Visible`（顯示 console 視窗）。

**Linux / macOS (Bash):**

```bash
cd /path/to/AI-BIM-governance
./scripts/start-all.sh         # 啟動 5 個服務 (Kit GPU 不在 Linux 啟動)
./scripts/stop-all.sh          # SIGTERM (5s 寬限) → SIGKILL 整個 process group
```

選用旗標：`--skip-viewer` / `--skip-coordinator` / `--health-timeout 30`。

> 啟動腳本會做健康檢查（GET /health），用 `●綠` / `●黃` / `●紅` 即時回報；log 與 PID 寫到 `scripts/.run/`（已加入 `.gitignore`）。

### 手動啟動 (debug 用)

每個服務獨立 terminal，依序啟動：

```powershell
# Repo root
cd C:\Repos\active\iot\AI-BIM-governance

# 1. 主資料庫 (8001)
cd _bim-control
..\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8001

# 2. Worker facade：選取 .\storage 的 IFC + 轉檔 job + artifact group (8005)
cd _worker
..\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8005

# 3. 審查協調 (8004)
cd bim-review-coordinator
npm install   # 第一次需要
npm run dev

# 4. Omniverse Kit 串流伺服器 (49100 WebRTC)
cd bim-streaming-server
.\scripts\start-streaming-server.ps1 -SkipAutoLoad

# 5. 瀏覽器審查端 (5173)
cd web-viewer-sample
npm install   # 第一次需要
npm run dev -- --host 127.0.0.1
```

Worker 預設會從 repo root 的 `storage/` 掃描 `.ifc` 檔案；也可用 `_worker` 的 `WORKER_DEV_STORAGE_ROOT` 覆寫。`storage/` 只提交 README，不提交實際大型模型檔。

> 為什麼 Kit server 用 `-SkipAutoLoad`：
> demo 中 USD 模型的載入由 web-viewer-sample 透過 `openStageRequest` 主動觸發，避免 Kit 啟動時 auto-load 與 browser DataChannel 請求競速。`start-streaming-server.ps1` 會把 NvStreamer 的 `*-NvStreamer.etl` trace 固定寫到 `bim-streaming-server/logs/nvstreamer/`。

---

## 服務分工與邊界 (Service Boundaries)

| 目錄 | 角色 | Demo 故事位置 | 責任邊界 |
|---|---|---|---|
| `_bim-control/` | 主資料庫 (Fake BIM Data Authority) | 步驟 ⑤ | 保存 project / model version / artifact / issue / annotation metadata；不保存大型檔案、不渲染 3D、不做 WebRTC。 |
| `_worker/` | Worker facade (Artifact + Conversion Boundary) | 步驟 ①② | 從 `storage/` 選取 IFC、接收 IFC/RVT/DWG 或 signed upload reference、保存版本化 object layout、建立 conversion job、產出 artifact group / lineage，並只把 metadata 發布到 `_bim-control`。 |
| `bim-review-coordinator/` | 審查協調 (Session / Collaboration Control Plane) | 步驟 ③ | 建立 review session、查詢 BIM metadata、提供 stream config、廣播 presence / selection / annotation / issue focus；不直接操作 USD stage。 |
| `bim-streaming-server/` | Omniverse Kit Runtime / WebRTC | 步驟 ④ (背景) | 載入 USD / USDC、執行 viewport runtime、WebRTC streaming、DataChannel command (`openStageRequest`、`highlightPrimsRequest`)；無 UI，存在感由 web-viewer 呈現。 |
| `web-viewer-sample/` | 瀏覽器審查端 (Browser Client) | 步驟 ④ | 顯示串流畫面、建立或加入 review session、讀 artifacts/issues、送 DataChannel command、送 collaboration events；不啟動 Kit、不保存資料權威。 |
| `docs/contracts/` | API / event contracts | — | REST、Socket.IO、DataChannel 與 local runbook contract。 |
| `docs/plans/` | Implementation plans | — | 目前執行計畫與驗收 checklist；**Demo UI 守則** 在 `BIM_REVIEW_DEMO_UI_GUIDELINES.md`。 |
| `docs/wiki/` | Graphify wiki snapshot | — | AI agent 與 reviewer 的探索輔助，最終以程式碼為準。 |
| `scripts/` | Root smoke scripts | — | 跨服務健康檢查與 review session smoke test。 |

### Source of Truth

```txt
資料權威 → _bim-control
檔案/轉檔外部邊界 → _worker
Session  → bim-review-coordinator
3D runtime → bim-streaming-server
使用者操作 → web-viewer-sample
```

---

## 核心文件入口（Core Documentation Map）

> 本 repo 的 source of truth 分散在 4 份權威文件 + capability specs。讀任何架構決策或行為合約時依下列順序查閱。

| 文件 | 角色 | 何時看 |
|---|---|---|
| [`AGENTS.md`](AGENTS.md) | **Repo 邊界與資料權威**（最高優先） | 不確定哪個服務該做什麼、資料權威歸誰 |
| [`docs/PROJECT_DEVELOPMENT_WORKFLOW.md`](docs/PROJECT_DEVELOPMENT_WORKFLOW.md) | **開發流程入口**（7 層架構、Phase 完成度、驗證證據 4 層分級、IFC→USD 品質管線 7 步、OpenSpec + PR Checklist、服務測試命令、核心資料流 sequence diagram） | 新進工程師 onboarding、PR review、demo 簡報 |
| [`docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md`](docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md) | **SaaS 路線圖**（OpenSpec 候選 #1-#9 + #1A / #2A 精確 spec id 與 KPI、NVIDIA Reference 採用決策矩陣 §13、§11.4 Multi-Kit Instance 並行官方定義、硬體配置 §9.0-§9.8、MCP 查詢結果 §11） | 架構師決策、OpenSpec change owner、技術 review |
| [`openspec/specs/`](openspec/specs/) | **9 份 capability spec**（現行規格權威） | 修改任何服務前先讀對應 capability 的 spec 與 archived change |

> **workflow v3 與 SaaS 路線圖互補不替代**：workflow v3 是「怎麼做」的流程入口；路線圖是「做什麼 / 為什麼 / 怎麼決策」的技術權威。兩份文件交叉引用，避免分歧。

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

Worker review request smoke（不需要 Kit GPU，但需要 `storage/` 內有真實 IFC，且 `_worker` real converter prerequisites 可用）：

```powershell
.\scripts\smoke-worker-review-request.ps1
```

Socket.IO 多人協作 smoke：

```powershell
.\scripts\smoke-review-socket.ps1
```

Python tests（每個 fake service 各自 `app` package name，需分服務跑避免 import cache 互相污染）：

```powershell
cd _bim-control ; ..\.venv\Scripts\python.exe -m pytest tests -p no:cacheprovider
cd ..\_worker   ; ..\.venv\Scripts\python.exe -m pytest tests -p no:cacheprovider
```

Node tests / builds：

```powershell
cd bim-review-coordinator; npm test; npm run build
cd ..\web-viewer-sample  ; npm run test:session-first; npm run build
```

Kit build / test / contract smoke：

```powershell
cd bim-streaming-server
.\scripts\tests\test-stage-loading-contract.ps1
.\repo.bat build
.\repo.bat test
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
Merge = 正式接受變更
Archive = 把變更規格併入正式規格
```

- 每個 `/openspec new <change-id>` 先從最新 `main` 建立 `codex/openspec/<change-id>` branch。
- `/openspec apply <change-id>` 的實作、測試、文件與 task 勾選都留在該 branch。
- 開 PR 後由 review 討論與 GitHub Actions 驗證決定是否 merge。
- merge 後才執行 OpenSpec sync/archive，將 delta specs 併入正式 `openspec/specs/`。

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

## 給客戶的 5 步驟 Demo 故事

| 步驟 | 客戶看到 | 現行邊界 | URL / 入口 |
|---|---|---|---|
| ① IFC 就緒通知 | 客戶落地端已產生 IFC，通知本地審查服務 | 外部 IFC Worker → `bim-review-coordinator` | `POST /api/external/ifc-ready` |
| ② 自動轉換 | 系統建立 conversion job，產生可串流的 USDC / mapping / manifest | `bim-review-coordinator` → `bim-streaming-server` internal API | `http://127.0.0.1:8004` / internal `49101` |
| ③ 建立會議 | 一鍵開啟審查會議，取得 stream config | `bim-review-coordinator` | <http://127.0.0.1:8004> |
| ④ 標記問題 | 瀏覽器觀看 3D 串流，點選問題高亮元件 | `web-viewer-sample` + `bim-streaming-server` | <http://127.0.0.1:5173> / WebRTC `49100` |
| ⑤ 回拋結果 | 轉檔與審查 metadata 進入 callback outbox，回拋外部公司雲端 | `bim-review-coordinator` callback outbox | metadata-only callback |

> **最快 demo 路徑**：啟動 coordinator `8004`、streaming server、viewer `5173`。若 Kit / GPU 尚未啟動，streaming、WebRTC 與 GPU 相關項目要標成 blocked / not observed，不要標成 passed。

每個面對 demo 觀眾的 UI 都遵守
[`docs/plans/BIM_REVIEW_DEMO_UI_GUIDELINES.md`](docs/plans/BIM_REVIEW_DEMO_UI_GUIDELINES.md)：

- 業務語言優先。
- 線性 5 步驟流程條。
- 狀態號誌化。
- 每個按鈕一句「會發生什麼」。
- 失敗時直接指出哪個服務沒開、怎麼驗證。

---

## Docker-first Runtime Manager MVP

`CODE_GOAL_DOCKER_KIT_MVP.md` 的 MVP 驗收路徑只接受 Docker Compose。Host-local
`uvicorn` / `npm run dev` / host Kit launcher 只保留作為 legacy/debug，不作為 MVP pass
evidence。

Docker-first Kit MVP 的硬邊界：

- `streaming-server` GPU image 必須在 Docker build 階段於 Linux container 內執行
  `./repo.sh build`，產生 Linux Kit app。
- 現有 `bim-streaming-server/source/apps` 是 NVIDIA `kit-app-template` 產物；Docker MVP
  不重新互動產生 source，而是在乾淨 Linux builder 內 build 現有 source。
- 缺少 Linux launcher 不是可接受的前置 blocker；這代表 `failed_linux_kit_build`。
- Host-local Windows `_build`、`repo.bat`、PowerShell launcher 或 host Kit launcher 不算
  MVP pass、GPU runtime pass 或 Kit viewport pass evidence。
- `web-viewer-sample` container 使用 Node 18 與 npm 10，符合 `package.json` engines
  contract，並以 `engine-strict` 驗證。

主要入口：

```powershell
cd C:\Repos\active\iot\AI-BIM-governance
Copy-Item .env.runtime-manager.docker.example .env.runtime-manager.docker
docker compose -f compose.runtime-manager.yml --env-file .env.runtime-manager.docker config
.\scripts\start-runtime-manager-docker.ps1 -Build
.\scripts\check-runtime-manager-docker.ps1
```

Kit 管理前端：

```txt
http://127.0.0.1:5174
```

GPU Kit profile 只有在本機 Docker Desktop、NVIDIA Container Toolkit、container 內 Linux Kit
build 成功、以及 Docker build 產出的 Linux launcher 可啟動時才可宣告 pass：

```powershell
.\scripts\start-runtime-manager-docker.ps1 -Build -WithGpu
.\scripts\check-runtime-manager-docker.ps1 -WithGpu
```

若 NVIDIA runtime / GPU / license / auth / NVIDIA package network 這類外部依賴不可用，
驗證結果可記錄為 `blocked_external_dependency` 或 `blocked_gpu_runtime_unavailable`。
若 Dockerfile 沒執行 Linux build、build pipeline 缺失、或 image 內缺 Linux launcher，
必須記錄為 `failed_linux_kit_build`，不得用 host-local Kit 取代 GPU container pass。

---

## 本機 Debug 啟動

本段落只供 B 方案 local debug 使用，不作 Docker-first MVP evidence。

每個服務獨立 terminal，依序啟動：

```powershell
# Repo root
cd C:\Repos\active\iot\AI-BIM-governance

# 1. 審查協調 / 外部 IFC-ready intake / callback outbox (8004)
cd bim-review-coordinator
npm install
npm run dev

# 2. Omniverse Kit 串流 + IFC→USDC authority
cd ..\bim-streaming-server
.\scripts\start-streaming-server.ps1 -SkipAutoLoad

# 3. 瀏覽器審查端 (5173)
cd ..\web-viewer-sample
npm install
npm run dev -- --host 127.0.0.1
```

> 為什麼 Kit server 用 `-SkipAutoLoad`：demo 中 USD / USDC 模型載入由
> `web-viewer-sample` 透過 DataChannel `openStageRequest` 主動觸發，避免 Kit 啟動時
> auto-load 與 browser DataChannel 請求競速。

---

## 服務分工與邊界

| 目錄 | 角色 | Demo 故事位置 | 責任邊界 |
|---|---|---|---|
| `bim-review-coordinator/` | 外部 IFC-ready intake + Session / Collaboration Control Plane | ①③⑤ | 驗證 service auth、建立 local conversion job、dispatch streaming conversion、維護 callback outbox、建立 review session、廣播 collaboration event；不渲染 3D、不保存大型模型本體。 |
| `bim-streaming-server/` | IFC→USDC Conversion Authority + Omniverse Kit Runtime / WebRTC | ②④ | Internal-only conversion engine，產生 USDC / mapping / entity index / manifest；負責 Kit viewport、WebRTC、DataChannel command；不管理 project / user / annotation 權威。 |
| `web-viewer-sample/` | Browser Client / User Interaction Layer | ④ | 顯示串流畫面、建立或加入 review session、送 DataChannel command、送 annotation / collaboration event；不啟動 Kit、不保存資料權威、不直連已刪 runtime。 |
| `tests/contracts/` | API / event contracts | — | 描述外部 IFC Worker、公司雲端 callback、metadata-only contract。 |
| `tests/fakes/` | Test-only external platform doubles | — | 模擬外部 IFC Worker 與公司雲端，不是 runtime profile。 |
| `docs/contracts/` | API / event contracts | — | REST、Socket.IO、DataChannel 與 local runbook contract。 |
| `docs/plans/` | Implementation plans | — | 目前執行計畫與驗收 checklist。 |
| `docs/wiki/` | Graphify wiki snapshot | — | AI agent 與 reviewer 的探索輔助，最終以程式碼為準。 |
| `scripts/` | Root verification scripts | — | 跨服務健康檢查與 B 方案驗證入口；不得把已刪 runtime 標成必跑 pass gate。 |

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
Merge = 正式接受變更
Archive = 把變更規格併入正式規格
```

- 每個 `/openspec new <change-id>` 先從最新 `main` 建立 `codex/openspec/<change-id>` branch。
- `/openspec apply <change-id>` 的實作、測試、文件與 task 勾選都留在該 branch。
- 開 PR 後由 review 討論與 GitHub Actions 驗證決定是否 merge。
- merge 後才執行 OpenSpec sync/archive，將 delta specs 併入正式 `openspec/specs/`。

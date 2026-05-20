# Fast MVP Demo Recap — 用 repo 既有能力 30 分鐘跑出 demo

> **Source of truth**：本 runbook 服從 [`AGENTS.md`](../../AGENTS.md) 與 [`CLAUDE.md`](../../CLAUDE.md)。若任何指令字串或邊界宣告與這兩份文件衝突，以那兩份為準。
>
> **與 long roadmap 的關係**：[`docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md`](../plans/AI-BIM-governance-saas-roadmap-2026-05.md) 規劃 6–9 個月 8 個 Phase 與 NT$50–70 萬硬體投入；本 runbook 只覆蓋「用 repo 既有資產 + 既有 GPU 主機，30 分鐘到 demo」這條短路徑，是 roadmap 的早期驗證手段，**不是 roadmap 的替代**。

## 1. 為什麼有這份 runbook

repo 已具備 long-roadmap Phase 0 / 1 / 3 / 4 等同的 MVP 能力（`bim-review-coordinator` + `bim-streaming-server` + `web-viewer-sample` + `tests/fakes` + `tests/contracts`），缺的不是功能，而是**單機 demo 的啟動順序、port matrix、host vs container 邊界、樣本選擇規則、驗收標準**這層 orchestration 知識。這些知識原本散在以下位置：

- [`CLAUDE.md`](../../CLAUDE.md) §2 / §3 — 邊界與閉環，但不是步驟
- [`CLAUDE.md`](../../CLAUDE.md) §5 — 驗證入口，但不是 demo 啟動編排
- 多個 `scripts/*.ps1`（`start-all.ps1` / `demo-health-check.ps1` / `smoke-bscheme-intake.ps1` 等）— 已可用但缺 cross-cutting 說明
- Claude memory（`kit-gpu-render-needs-windows-native` 等）— 重要但不在 repo 公開可見

本 runbook 把上述串成「現場一份就能跑」的劇本，並把 long-roadmap 的「該擺哪不該擺哪」也凍結進來，避免下次 demo 又被舊資料污染。

## 2. 雲地分離邊界回顧（pre-flight 必讀 1 分鐘）

完整版見 [`CLAUDE.md`](../../CLAUDE.md) §2。Demo 範圍只需記住四點：

| 角色 | 屬地 | 本 demo 怎麼處理 |
|---|---|---|
| 公司雲端 `_bim-control` | 非本 repo | 用 `tests/fakes/cloud_bim_control_api.py` + coordinator outbox 自我吸收，不打外網 |
| 客戶落地端 IFC Worker | 非本 repo | 用 `tests/fakes/external_ifc_worker_client.py` + `scripts/smoke-bscheme-intake.ps1` 觸發 |
| `bim-review-coordinator` | 本 repo / localhost:8004 | 對外 IFC-ready intake + outbox + session control plane |
| `bim-streaming-server` | 本 repo / localhost:49100 + 49101 | IFC→USDC 轉檔權威 + Kit / WebRTC 3D runtime |
| `web-viewer-sample` | 本 repo / localhost:5173 | Browser client |

`_worker/` 與 `_bim-control/` **不在 product runtime**（[`CLAUDE.md`](../../CLAUDE.md) §2 已刪除說明），只剩 `tests/fakes` 作 contract 對照。任何 demo 操作不得依賴它們作為 runtime 服務。

## 3. Port matrix 與 host vs container 邊界

| Service | Port | 部署方式（demo 路徑） | 為什麼 |
|---|---|---|---|
| `bim-streaming-server` Kit / WebRTC signaling | **49100** | **Windows host-native（強制）** | WSL2 + NVIDIA Container Toolkit 對 Kit graphics-vulkan 仍卡天花板；capability `runtime-image-linux-kit-launcher-readiness` 維持 deferred；[`docs/runbooks/FAST_MVP_DOCKER_KIT_MANAGER.md`](../runbooks/FAST_MVP_DOCKER_KIT_MANAGER.md) 已凍結 evidence rule |
| `bim-streaming-server` internal conversion authority API | **49101** | **Windows host-native** | 與 49100 同住一個進程；internal-only，不對外網開放 |
| `bim-review-coordinator` | **8004** | Windows host（`scripts/start-all.ps1`）或 Docker 或 `cd bim-review-coordinator && npm run start` | 不吃 GPU，但 demo 短路徑用 host 最省事 |
| `web-viewer-sample` | **5173** | Windows host（`scripts/start-all.ps1`）或 `cd web-viewer-sample && npm run dev` | 純 browser client |

> **唯一硬限制**：Kit graphics 必須 host-native。其餘三服務的部署方式可依現場環境調整，但 runbook 預設全部 host-native，因為這是 demo 最少踩雷的組合。

## 4. Pre-flight 清單（demo 前 10 分鐘做完）

1. **硬體**：Windows 11、RTX Ada / Blackwell GPU、`nvidia-smi` 看得到驅動。沒 GPU 等於沒戲。
2. **OS 環境**：Python venv 已建在 `.venv/Scripts/python.exe`（`scripts/start-all.ps1` 會優先用它），Node.js 已可用。
3. **依賴**：`bim-review-coordinator/` 與 `web-viewer-sample/` 已 `npm install`。`bim-streaming-server/` 的 Python deps 已就位。
4. **樣本**：至少一支 `storage/<filename>.ifc` 放在 **top-level**（不要塞子目錄；對齊 `scripts/smoke-bscheme-intake.ps1` 中 `Get-TopLevelIfcFixtures` 規則）。**現場不要抽不認識的檔** — 提前用同一份檔跑過一次 smoke。
5. **Kit launcher 預檢**：跑 `pwsh -File scripts/verify-runtime-kit-launcher.ps1` 確認 Kit 能起；若 deferred 就誠實記 deferred，**不要謊報 passed**。
6. **Predecessor 提醒**：若 `openspec/changes/coordinator-ifc-ready-worker-webhook/` 仍是 active（未 archive），demo 前向 PM 確認沒有跟 archive PR 衝突。

## 5. 三步劇本（現場照做）

> 所有指令在 repo root 跑。預設 PowerShell。

### Step A — 一鍵啟動三服務

```powershell
pwsh -File scripts/start-all.ps1
```

該腳本（[`scripts/start-all.ps1`](../../scripts/start-all.ps1)）：

- Initialize Windows runtime env vars（避免 Kit 子進程環境變數壞掉）
- 用 `.venv/Scripts/python.exe`（如有）啟 `bim-streaming-server`、`bim-review-coordinator`、`web-viewer-sample`
- PID 寫到 `scripts/.run/<svc>.pid`、log 寫到 `scripts/.run/<svc>.log`
- 不開 uvicorn `--reload`（避免 PID 鏈斷裂）

對應關閉：`pwsh -File scripts/stop-all.ps1`。

### Step B — 健康檢查

```powershell
pwsh -File scripts/demo-health-check.ps1
```

該腳本（[`scripts/demo-health-check.ps1`](../../scripts/demo-health-check.ps1)）：

- 確認 `http://127.0.0.1:8004/health` 回傳 `status="ok"`
- 確認 `http://127.0.0.1:8004/ui` 與 `http://127.0.0.1:5173` 回 2xx

若 streaming-server 49100/49101 沒起，可額外用 `Test-NetConnection -ComputerName 127.0.0.1 -Port 49100` 與 `49101` 補檢。

### Step C — 觸發 spec-correct ifc-ready 並等 conversion

```powershell
pwsh -File scripts/smoke-bscheme-intake.ps1
```

該腳本（[`scripts/smoke-bscheme-intake.ps1`](../../scripts/smoke-bscheme-intake.ps1)）是本 demo 的主力：

1. 跑 `tests/` pytest 確認 `tests/contracts/` + `tests/fakes/` 綠燈
2. 從 `storage/*.ifc` top-level 挑第一支樣本（按 file size desc 排序）
3. 用 spec-correct payload（對齊 [`tests/contracts/ifc_ready_payload.json`](../../tests/contracts/ifc_ready_payload.json)）POST 到 `http://127.0.0.1:8004/api/external/ifc-ready`
4. 取得 `conversion_job_id`，輪詢 `http://127.0.0.1:49101/api/conversions/<id>/result` 直到 succeeded / failed / timeout
5. 把 streaming-server 的 conversion-result publish 回 coordinator `POST /api/internal/conversion-result`
6. 跑 coordinator `npm run verify`（含 cloud-callback-outbox / shadow / local-web-view 契約）
7. 跑 streaming-server `pytest tests/test_conversion_authority_api.py`
8. 嘗試讀 Kit launcher T0 evidence；若沒過誠實標 deferred
9. 把所有 tier 寫進 `docs/verification/evidence/2026-05-18-bscheme-intake-smoke/bscheme-readiness.json`

跑完同時打開瀏覽器 `http://127.0.0.1:5173`，按 viewer UI 開新 review session，看 USDC 是否串得進來、能否點 prim 觸發 DataChannel highlight。

## 6. 驗收長相（demo 結束時對齊這張表）

`smoke-bscheme-intake.ps1` 的 tier 狀態語意：

| Tier | demo 成功 | 可接受的灰色 | 不可接受 |
|---|---|---|---|
| `external_ifc_ready_intake` | `passed` | — | `failed` / `blocked` |
| `coordinator_session_lifecycle` | `passed` | — | `failed` / `blocked` |
| `streaming_internal_conversion` | `passed` | — | `failed` / `blocked` |
| `real_ifc_intake_conversion` | `passed` | — | `failed` / `blocked` |
| `mapping_quality` | `passed` | `not_observed`（無 quality evidence 但 conversion OK） | 用舊 worker evidence 充當 |
| `cloud_callback_outbox` | `passed` | — | `failed` |
| `runtime_image_kit_launcher` | `passed` | `deferred`（誠實標明 GPU / Kit license 阻塞） | 把 deferred 寫成 passed |
| `single_kit_render` | `passed`（GPU / Kit 都到位時） | `deferred` / `not_observed`（API-only pass） | 把 deferred 寫成 passed |
| `usd_stage_composition` | `passed` | `not_observed`（無 USD 場景組合 evidence） | 用 host-local Kit 充當 |
| `single_kit_multi_viewer` | `passed`（multi-viewer browser 驗證後） | `not_observed` | — |

對齊 [`docs/runbooks/FAST_MVP_DOCKER_KIT_MANAGER.md`](../runbooks/FAST_MVP_DOCKER_KIT_MANAGER.md) 的 Evidence rules：**`recorded_only` 與 `blocked_runtime_control_unavailable` 永遠不算 demo 成功**。

Browser 層面的 demo 成功定義（不在 smoke evidence 內，需主操作員人眼確認）：

1. viewer 在 30 秒內顯示串流 USDC stage
2. 點選一個 prim 後 5 秒內 Kit 端高亮可見
3. 多人 session（如場景需要）時，另一個 viewer 能看到同樣的高亮

## 7. 故障排除快速表

| 現象 | 第一順位檢查 |
|---|---|
| `start-all.ps1` 起完但 49100 不開 | 看 `scripts/.run/streaming-server.log`；多半是 Kit / GPU driver 環境 — 跑 `scripts/verify-runtime-kit-launcher.ps1` 確認 |
| coordinator `/health` 回非 ok | 看 `scripts/.run/coordinator.log`；多半是 8004 port 被佔用或 `.env` 沒設 |
| `smoke-bscheme-intake.ps1` 的 `real_ifc_fixture` blocked | `storage/` 沒 top-level `*.ifc`；放一支進去再跑 |
| `real_ifc_intake_conversion` blocked = 'coordinator live service is not reachable' | Step A 沒成功，重做 |
| Browser viewer 連不上 stream | 49100 不通；或 `web-viewer-sample` 沒抓對 stream config — 看 5173 console |
| 整 evidence JSON 沒寫出 | `docs\verification\evidence\2026-05-18-bscheme-intake-smoke\` 路徑權限問題；確認該目錄可寫 |

## 8. Non-goals — 明確排除的東西

本 demo runbook **不負責、也不嘗試**以下任一項。要做的請另開 OpenSpec change：

- **Roadmap Phase 1**：MinIO / Gitea / Git LFS / Speckle Server / Bonsai
- **Roadmap Phase 2**：IfcOpenShell / IfcTester / IfcClash / BCF Server / BIMcollab Zoom / Solibri
- **Roadmap Phase 3 deep**：Revit 外掛、Navisworks NWC、Bonsai authoring
- **Roadmap Phase 5**：MQTT / EMQX / HiveMQ / InfluxDB / TimescaleDB / Node-RED / Brick Schema / IoT 即時資料
- **Roadmap Phase 6**：DVC / MLflow / PyTorch / NVIDIA Replicator / ML 訓練管線
- **Roadmap Phase 7**：Prometheus / Grafana / Loki / 備份 / 災難復原 / mTLS / SELinux 強化
- **WSL2 Kit graphics workaround**：本 demo 不嘗試解，host-native 是唯一答案；要試 Linux Kit 容器化請另立 change 並把 [`capability runtime-image-linux-kit-launcher-readiness`](../../openspec/specs/runtime-image-linux-kit-launcher-readiness/spec.md) 解 deferred
- **真實外部 `_bim-control` / 真實外部 IFC Worker 接入**：全部由 `tests/fakes` 與 coordinator outbox 吸收
- **多客戶 / 多租戶 demo**：單機 single-tenant；多租戶需新 capability

## 9. 與既有 OpenSpec capability 的關係

本 runbook 屬於新 capability `demo-fast-mvp-orchestration`（隨 change `recap` 引入），與下列既有 capability **正交且不修改**：

- `local-coordinator-ifc-ready-intake-boundary` — coordinator 對外 IFC-ready 入口契約
- `streaming-ifc-usdc-conversion-authority` — streaming-server 內網轉檔權威
- `external-cloud-callback-lifecycle` — coordinator metadata-only callback outbox
- `review-session-request-lifecycle` — review session 生命週期
- `demo-runtime-readiness-smoke` — `smoke-bscheme-intake.ps1` 的 tier schema 來源
- `runtime-image-linux-kit-launcher-readiness` — Linux Kit container readiness（deferred）
- `host-native-conversion-authority-service` — host-native 轉檔權威

完整 capability 清單見 `openspec/specs/`。本 runbook 引用上述任何 capability 時，必須能在 repo 內 grep 命中。

## 10. 修訂維護

- runbook 與既有 scripts 的指令字串**用相對路徑引用**，避免硬編字串造成漂移
- 任何指令字串改動（如 `scripts/start-all.ps1` 改名、port 改變、tier 名稱改變）必須回頭更新本 runbook
- runbook 不收 GPU SKU / 廠商型號等硬體採購建議 — 那是 [`docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md`](../plans/AI-BIM-governance-saas-roadmap-2026-05.md) 的職責

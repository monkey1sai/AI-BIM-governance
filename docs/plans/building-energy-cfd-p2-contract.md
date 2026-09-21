# 建築風場 CFD P2：§04 契約草案與切片計畫（方向 A）

日期：2026-09-21。狀態：**草案，待 owner 核可後併入設計正本 §04 與 `docs/agents/repository-boundaries.md`**；本檔不是 runtime 完成證據。
上游：`building-energy-cfd.md`（P0.1／P1 已有真檔證據，PR #884）。衝突時依序採用：使用者最新指令、根目錄 `AGENTS.md`、設計正本、本檔。

## 1. Owner 裁決（2026-09-21，方向 A）

| 編號 | 裁決 | 本檔如何落實 |
|---|---|---|
| D1 邊界 | 不新增服務。CFD 執行者是 `bim-streaming-server` host-native conversion service（:49101）的新 job 類型 | 新模組 `cfd_job_service.py` 自帶 router，由 `host_native_conversion_service.py` 掛載；不改凍結的 `conversion_authority.py` |
| D2 求解器 | OpenFOAM v2412 官方容器，digest 鎖定 | 沿用 `tools/cfd/bimcfd`（搬進 streaming extension 成為 runtime 模組，見 §4） |
| D3 情境 | 戶外風場先 | profile `exterior-wind/v1`；室內 profile 留 P2 尾段 |
| D4 精度 | 設計比較用 | 所有 API 回應與 USD customData 帶 `purpose: design_comparison_only`；UI 常駐標示 |
| D5 資源 | canonical Linux 181 CPU，與 Kit 分時 | job 佇列同一時間只跑一個 CFD run；`n_procs` 可設；求解中 Kit 不停 |
| D6 紀錄 | 原建議 governance-service，**因後端凍結面調整**：`governanceProxy.ts` 是顯式白名單且禁改，governance 新路由無法對瀏覽器曝光 | run record 權威＝streaming CFD job store（job 目錄內 `run_record.json`＋索引）；coordinator 保存 ledger 指標；governance-service 只在切片 4 經既有 `/api/issues` 收 finding。若 owner 另授權改 `governanceProxy.ts` 一處與 `app.py` 一行 include，可改回 governance 存放，契約欄位不變 |

## 2. 資料流（方向 A）

```text
瀏覽器 ──REST :8004──▶ coordinator ──loopback :49101──▶ streaming CFD job service
   │                       │  ledger: cfd_runs（狀態、指標）          │  queue（同時 1 個）
   │                       │                                          ▼
   │                       │                     tools/cfd pipeline：preprocess → case → docker run → postprocess → record
   │                       │                                          │
   │                       │◀── GET /api/cfd-runs/{run_id}/result ────┘  （overlay layer、run record、剔除清單）
   │                       │
   │   POST /api/review-sessions/{id}/stage-binding（primary + secondary=cfd overlay）
   │                       ▼
   └──WebRTC/DataChannel── Kit ◀── loadArtifactGroupRequest（既有）：sublayer 結果 layer 到 /World/Overlays/Cfd/<run_id>
```

- 瀏覽器只打 coordinator；coordinator 只打 :49101；Kit 只吃既有 `loadArtifactGroupRequest`。三鐵律不變。
- 結果 layer 不改 `model.usdc`；只在 `/World/Overlays/Cfd/<run_id>` 下新增 prim。

## 3. §04 契約草案

### 3.1 streaming host-native service（internal，:49101 loopback）

新模組 `cfd_job_service.py`，掛載於 `host_native_conversion_service.py`；沿用 conversion authority 的 loopback、`STREAMING_CONVERSION_INTERNAL_TOKEN` 與 `_safe_id` 規則。

| 方法 | 路徑 | 說明 |
|---|---|---|
| POST | `/api/cfd-runs` → 202 | 建立 run；body 見 3.1.1；冪等鍵 `idempotency_key`（同鍵回同 `run_id`） |
| GET | `/api/cfd-runs` | 列表（`status`、`conversion_job_id` 篩選） |
| GET | `/api/cfd-runs/{run_id}` | 狀態與進度（3.1.2） |
| GET | `/api/cfd-runs/{run_id}/result` | 完成後的產物索引與 `run_record`（3.1.3） |
| GET | `/api/cfd-runs/{run_id}/exclusions` | 剔除清單（`cfd-exclusion-list/v1`） |
| POST | `/api/cfd-runs/{run_id}/cancel` | 取消排隊中或執行中的 run（殺容器、狀態 `cancelled`） |
| GET | `/cfd-artifacts/{run_id}/{filename}` | 結果檔（`cfd_<run_id>.usdc`、`shell.stl`、`run_record.json`）；與 `/artifacts` 相同的路徑穿越防護與 downloadable 檢查 |

3.1.1 `POST /api/cfd-runs` body（`cfd-run-request/v1`）

```json
{
  "schema": "cfd-run-request/v1",
  "idempotency_key": "string",
  "source": {
    "conversion_job_id": "stream_conv_…",
    "model_usdc_sha256": "hex64"
  },
  "preprocess": { "profile": "exterior-wind/v1", "voxel_pitch_m": 0.5, "closing_radius_voxels": 2 },
  "wind": {
    "wind_from_degrees": [0, 22.5, 45],
    "uref_m_s": 5.0, "zref_m": 10.0, "z0_m": 0.5,
    "true_north_source": "geo_reference|manual",
    "true_north_degrees_manual": null
  },
  "mesh": { "background_cell_m": 6.0, "surface_refinement_level": 2, "region_refinement_level": 1 },
  "solver": { "end_time": 300, "n_procs": 8 },
  "requested_by": { "principal": "string", "trace_id": "string" }
}
```

- `source.model_usdc_sha256` 必填且必須等於該 conversion job 的 `model.usdc` 雜湊，否則 409 `source_mismatch`（沿用「來源與產物不可混用」）。
- `wind.wind_from_degrees` 1～16 個方向；每個方向是一個 sub-run，共用前處理。
- `true_north_source=geo_reference` 而 `geo_reference.json.available=false` 且 `true_north_degrees` 為預設值時，run 仍可執行，但 result 帶 `assumptions: ["true_north_default_direction"]`，UI 必須顯示。

3.1.2 狀態（`cfd-run-status/v1`）

`status ∈ {queued, preprocessing, meshing, solving, postprocessing, ready, failed, cancelled}`；`progress.directions_done / directions_total`；`failure_code ∈ {source_mismatch, preprocess_failed, mesh_failed, solver_failed, solver_not_converged, postprocess_failed, cancelled, worker_unavailable}`。`solver_not_converged` 是 ready 的附註旗標而不是失敗（結果仍可看，但 record 標示）。

3.1.3 結果（`cfd-run-result/v1`）

```json
{
  "schema": "cfd-run-result/v1",
  "run_id": "cfd_…",
  "purpose": "design_comparison_only",
  "source": { "conversion_job_id": "…", "model_usdc_sha256": "…" },
  "directions": [
    {
      "wind_from_degrees": 0,
      "status": "ready",
      "converged_by_residual_control": true,
      "iterations": 268,
      "overlay_layer": { "artifact_id": "cfd:<run_id>:w000", "filename": "cfd_<run_id>_w000.usdc", "sha256": "…" },
      "pedestrian_1p5m": { "U_magnitude_max": 2.92, "polygons": 22466 },
      "building_pressure": { "p_min": -20.3, "p_max": 12.7 }
    }
  ],
  "run_record": { "filename": "run_record.json", "sha256": "…" },
  "exclusions": { "filename": "exclusions.json", "sha256": "…", "counts": { "class_excluded": 454, "outlier": 39 } },
  "assumptions": [],
  "limitations": ["…"]
}
```

`run_record.json` 即 `cfd-run-record/v1`（P1 已定義），每個方向一份或一份含 `directions[]`；本草案採一份含 `directions[]`。

### 3.2 coordinator（browser-facing，:8004）

新路由檔 `routes/cfdRunRoutes.ts` 與 schema `contract/schemas/cfd.ts`；不改 `governanceProxy.ts`。所有路由沿用既有 authenticated principal 與 session-scoped 授權；`POST` 類需要 primary viewer lease 或 operator scope（同 `/api/conversion/trigger` 的規則）。

| 方法 | 路徑 | 說明 |
|---|---|---|
| POST | `/api/cfd/runs` → 202 | 對應 3.1.1；coordinator 補 `source.model_usdc_sha256`（從 conversion ledger／result 取），瀏覽器不得自填 |
| GET | `/api/cfd/runs?conversion_job_id=` | ledger 列表（`cfd-run-ledger-record/v1`：`run_id, conversion_job_id, status, directions_total, directions_done, created_at, updated_at, failure_code, converged_count`） |
| GET | `/api/cfd/runs/{run_id}` | 狀態（透傳 3.1.2 加 ledger 欄位） |
| GET | `/api/cfd/runs/{run_id}/result` | 透傳 3.1.3，`overlay_layer.url` 由 coordinator 依 PUBLIC_HOST 派生（同 `/artifacts` 的 ready-model resolver 規則） |
| GET | `/api/cfd/runs/{run_id}/exclusions` | 透傳 |
| POST | `/api/cfd/runs/{run_id}/cancel` | 透傳 |
| POST | `/api/review-sessions/{sessionId}/cfd-overlays` | 把某方向的 overlay 註冊為該 session artifact group 的 `ArtifactBinding{artifact_role:"overlay", artifact_id:"cfd:<run_id>:w000", load_order: primary+1…}`；回 `binding_id`。之後瀏覽器走**既有** `POST /api/review-sessions/{id}/stage-binding` 選 primary＋secondary，Kit 以既有 `loadArtifactGroupRequest` 載入 |
| DELETE | `/api/review-sessions/{sessionId}/cfd-overlays/{binding_id}` | 移除 binding（不刪檔） |

- 不新增任何 Kit DataChannel 命令；圖層開關＝重送 stage-binding（有／無 secondary）。若 P2 實測顯示重載成本過高，再提 `setLayerVisibilityRequest` 進 `kit-datachannel-v1.schema.json`（另案）。
- `coordinator-browser-api-v1.openapi.json` 新增上述路徑；`tests/contracts/` 新增 `cfd_run_request.json`、`cfd_run_result.json`、`cfd_run_ledger_record.json`。

### 3.3 Kit（無新命令）

- 結果 layer 以 `session_sublayer` 進 stage，prim 在 `/World/Overlays/Cfd/<run_id>/{PedestrianWind_1p5m, BuildingSurfacePressure, Streamlines}`，primvars `U_magnitude`、`U`、`p`、`displayColor`（P1 已實作，不變）。
- `loadArtifactGroupResult.applied_secondary_layers` 含該 artifact_id 即視為「圖層已載入」的 runtime 證據；前端不得以 ACK 之外的推斷宣稱可見。

### 3.4 governance-service（切片 4 才動）

- 不新增路由。CFD 超標項目（例如行人高度風速 > 門檻）由 coordinator 組成 issue payload 經**既有** `/api/issues` 建立，`source: "cfd"`, `evidence: { run_id, wind_from_degrees, artifact_id, threshold }`。門檻與規則定義另案（屬 A1 整合，不在本 P2）。

### 3.5 web-viewer-sample

- 統一工作台新增「風環境」面板：選 conversion result → 選風向（1～16）→ 送出 → 進度 → 完成後每方向一列（收斂、峰值、疊圖開關）。
- 常駐標示「設計比較用」與 `assumptions`；未接通狀態依 R3 誠實停用；數值一律 `ProvTag` 標 runtime。
- 只打 coordinator；不出現 :49101 URL 之外的直連。

## 4. 程式落點與模組搬遷

| 現況（PR #884） | P2 落點 | 說明 |
|---|---|---|
| `tools/cfd/bimcfd/*` | `bim-streaming-server/.../messaging/cfd/`（`preprocess.py`、`openfoam_case.py`、`foam_vtk.py`、`usd_results.py`、`run_record.py`、`batch.py`） | 以 package 形式搬入 extension，`tools/cfd` 保留薄 CLI 指向同一套程式，避免兩份 |
| `tools/cfd/bimcfd/cli.py` | `cfd_job_service.py`（router＋queue＋store）呼叫上列模組 | job store 目錄：`<artifacts_root>/cfd/<run_id>/` |
| `tools/cfd/kit/open_stage_capture_and_quit.py` | 保留為 E2E 證據工具 | 不進 runtime |
| Docker 執行 | Linux 181 直接 `docker run`（同 P1），`n_procs` 由 env `CFD_N_PROCS` 上限 | 缺 docker 或映像 → `worker_unavailable`，不得假成功 |

新增環境變數（全部有預設、缺值時功能誠實停用而非崩潰）：`CFD_ENABLED`（預設 false）、`CFD_IMAGE`（預設 `opencfd/openfoam-default:2412`）、`CFD_IMAGE_DIGEST`（有值時 pull 後比對）、`CFD_N_PROCS`、`CFD_MAX_DIRECTIONS`（預設 16）、`CFD_ARTIFACTS_ROOT`（預設 `<artifacts_root>/cfd`）。coordinator 端：`CFD_ENABLED` 為 false 時 `/api/cfd/*` 回 503 `cfd_disabled`，UI 顯示未啟用。

## 5. 切片計畫

每切片一個 PR、一個 outcome、可獨立驗收；順序固定，前一切片合併並部署 181 後才開下一個。

| 切片 | Outcome | 主要變更 | DoD（本輪真實證據） |
|---|---|---|---|
| **S0 契約凍結** | 本檔核可後併入設計正本 §04／§01 說明與 `repository-boundaries.md`；`tests/contracts` 新增三個 JSON 與 openapi 路徑 | 只有文件與契約檔 | contract tests 綠；owner 核可 |
| **S1 streaming CFD job service** | :49101 可建立、查詢、取消 CFD run，結果檔可下載 | `cfd/` 套件搬遷、`cfd_job_service.py`、queue（同時 1）、store、`/cfd-artifacts`、`CFD_*` env | pytest 單元＋HTTP integration（fake docker runner）；本機真 docker 跑 1 方向 202→ready；`tools/cfd` CLI 仍可用 |
| **S2 coordinator ledger 與路由** | 瀏覽器可經 :8004 建 run、看進度、拿結果與 overlay URL | `cfdRunRoutes.ts`、`cfd.ts` schema、`cfdRunLedger`、`/review-sessions/{id}/cfd-overlays` binding 註冊 | vitest 契約測試；真 API 走通 POST→ready→binding；`CFD_ENABLED=false` 回 503 |
| **S3 前端與 Kit 疊圖** | 統一工作台可送出風向、看進度、在 primary viewer 開關 CFD 疊圖 | 「風環境」面板、stage-binding 帶 secondary、ProvTag、設計比較標示 | Functional＋Semantic browser E2E（真 API、真 Kit）：first frame、`loadArtifactGroupResult.applied_secondary_layers` 含 cfd artifact、疊圖截圖；visual gate 依 product path 規則 |
| **S4 181 部署與 16 風向** | 181 上跑完 16 方向並在 UI 檢視 | `scripts/deploy.ps1` canonical 路徑帶入 `CFD_*` env、映像 pull、CPU 上限 | 181 真站 16 方向 run record、Kit 疊圖截圖、Kit 串流未中斷證據 |
| **S5 品質** | 網格收斂與基準比對 | 三層網格收斂測試、AIJ 案例 C 比對、`solver_not_converged` 自動延長 endTime 一次 | 收斂曲線與比對表進 evidence；run record 新增 `validation_level` |
| **S6 A1 finding（另案入口）** | CFD 超標轉 issue | coordinator 組 payload 經既有 `/api/issues` | 不在本 P2 授權範圍，列為後續 |

不做：新 Kit 命令、governance 新路由、商用求解器、室內熱對流（`interior-ventilation/v1` 待 S5 後另提）。

## 6. 風險與待 owner 確認

| 項目 | 內容 |
|---|---|
| R-A1 | 求解與 Kit 同機搶 CPU：S4 以 `CFD_N_PROCS` 與 docker `--cpus` 限制，實測 Kit first frame 與 DataChannel ACK 不退化才算過 |
| R-A2 | 外殼 176 × 175 m 含相連附屬結構：S1 前處理 profile 增加 `footprint_clip`（可選 bbox 裁切）或維持納入；需 owner 選 |
| R-A3 | 真北未知：所有結果帶 `assumptions`，P0.2 資料到位前 UI 不得顯示羅盤方位，只顯示「相對 project north」 |
| R-A4 | 45° 等方向 300 步未收斂：S5 前先在 S1 加「未收斂自動延長一次到 600」 |
| C-1 | D6 因凍結面改放 streaming；若 owner 要放 governance，需授權改 `governanceProxy.ts` 一處與 `app.py` 一行 |
| C-2 | S0 需 owner 核可本檔並授權改設計正本 `.dc.html` §04（該檔為 generated render，改動方式見 `docs-plans-README.md` §1） |

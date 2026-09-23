# 建築風場 CFD P2：§04 契約草案與切片計畫（方向 A）

日期：2026-09-21；2026-09-23 更新現況。狀態：**S0 契約凍結（owner 已核可草案 PR #885 並裁決 C-1／R-A2／洩漏門檻）**：payload 以 `tests/contracts/cfd-run-request-v1.schema.json`、`cfd-run-result-v1.schema.json`、`cfd-run-ledger-record-v1.schema.json` 為最高標準（root `tests/test_cfd_contracts.py` 守護），設計正本 §04 新增 `c4-cfd-api` 卡，`docs/agents/repository-boundaries.md` 已納入。本檔不是 runtime 完成證據。**2026-09-23 現況：S0–S7 與 R-A1 已合併，戶外風場在 181 真站驗證，精度等級 `screening`；P2 總表與剩餘工作見 `building-energy-cfd.md` §6、§10。**
上游：`building-energy-cfd.md`（P0.1／P1 已有真檔證據，PR #884）。衝突時依序採用：使用者最新指令、根目錄 `AGENTS.md`、設計正本、本檔。

## 1. Owner 裁決（2026-09-21，方向 A）

| 編號 | 裁決 | 本檔如何落實 |
|---|---|---|
| D1 邊界 | 不新增服務。CFD 執行者是 `bim-streaming-server` host-native conversion service（:49101）的新 job 類型 | 新模組 `cfd_job_service.py` 自帶 router，由 `host_native_conversion_service.py` 掛載；不改凍結的 `conversion_authority.py` |
| D2 求解器 | OpenFOAM v2412 官方容器，digest 鎖定 | 沿用 `tools/cfd/bimcfd`（搬進 streaming extension 成為 runtime 模組，見 §4） |
| D3 情境 | 戶外風場先 | profile `exterior-wind/v1`；室內 profile 留 P2 尾段 |
| D4 精度 | 設計比較用 | 所有 API 回應與 USD customData 帶 `purpose: design_comparison_only`；UI 常駐標示 |
| D5 資源 | canonical Linux 181 CPU，與 Kit 分時 | job 佇列同一時間只跑一個 CFD run；`n_procs` 可設；求解中 Kit 不停 |
| D6 紀錄 | **owner 裁決（C-1，2026-09-21）：run record 權威留 streaming CFD job store**；`governanceProxy.ts` 是顯式白名單且屬凍結面，不改 | job 目錄內 `run_record.json`＋索引；coordinator 保存 ledger 指標（`cfd-run-ledger-record/v1`）；governance-service 只在切片 6 經既有 `/api/issues` 收 finding |
| R-A2 外殼 | **owner 裁決：相連附屬結構納入外殼**，不做 footprint 裁切 | `cfd-run-result/v1.preprocess.appendage_policy` 固定 `included` |
| 洩漏門檻 | **owner 裁決：參考建物閉合半徑 4 的 12.0% 洩漏接受** | 請求可帶 `preprocess.leak_fraction_limit`，預設 0.15；超過仍產出結果但 `sealing_suspect: true` 並在 UI 標示 |

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
   └──WebRTC/DataChannel── Kit ◀── loadArtifactGroupRequest（既有）：sublayer 結果 layer 到 /World/Overlays/Cfd/<run_id>_<wNNN>
```

- 瀏覽器只打 coordinator；coordinator 只打 :49101；Kit 只吃既有 `loadArtifactGroupRequest`。三鐵律不變。
- 結果 layer 不改 `model.usdc`；只在 `/World/Overlays/Cfd/<run_id>_<wNNN>` 下新增 prim（每個風向一個 layer；`<wNNN>` 取自 overlay artifact id `cfd:<run_id>:<wNNN>`，見 §6「CFD 疊圖 prim 路徑」）。

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
| GET | `/api/cfd-options` | S8：表單選項 `cfd-options/v1`（契約上下限、標準預設組、面板欄位中繼資料、主機上限）；CFD 未啟用時也可讀，設定檔無效回 503 `cfd_options_invalid` |
| POST | `/api/cfd-estimates` | S8：送出前估算，`cfd-estimate-request/v1` → `cfd-estimate/v1`；用與送出相同的驗證、唯讀、不存檔 |
| GET | `/cfd-artifacts/{run_id}/{filename}` | 結果檔：每個風向一個 `<run_id>_<wNNN>.usdc`，另有 `shell.stl`、`run_record.json`、`exclusions.json`（白名單＝result 引用的疊圖層加上這三個檔）；與 `/artifacts` 相同的路徑穿越防護與 downloadable 檢查 |

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
      "overlay_layer": { "artifact_id": "cfd:<run_id>:w000", "filename": "<run_id>_w000.usdc", "sha256": "…" },
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

`overlay_layer.filename` 實際為 `<run_id>_<wNNN>.usdc`；run_id 本身以 `cfd_` 開頭，例如 `cfd_<UTC 時間>_<6 碼>_w000.usdc`。2026-09-23 更正原例的 `cfd_<run_id>_w000.usdc`。

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
| GET | `/api/cfd/options` | S8：透傳 `cfd-options/v1`；不需 operator scope。回應形狀由 coordinator 契約 seam 在測試模式驗證（production 不驗） |
| POST | `/api/cfd/estimates` | S8：body 以 `cfd-estimate-request/v1` 驗證後透傳，回 `cfd-estimate/v1`；不寫 ledger。估算會掃描 streaming 端的 run 歷史，所以與建立 run 走同一個 conversion control 守門 |
| POST | `/api/review-sessions/{sessionId}/cfd-overlays` | 把某方向的 overlay 註冊為該 session artifact group 的 `ArtifactBinding{artifact_role:"overlay", artifact_id:"cfd:<run_id>:w000", load_order: primary+1…}`；回 `binding_id`。之後瀏覽器走**既有** `POST /api/review-sessions/{id}/stage-binding` 選 primary＋secondary，Kit 以既有 `loadArtifactGroupRequest` 載入 |
| DELETE | `/api/review-sessions/{sessionId}/cfd-overlays/{binding_id}` | 移除 binding（不刪檔） |

- 不新增任何 Kit DataChannel 命令；圖層開關＝重送 stage-binding（有／無 secondary）。若 P2 實測顯示重載成本過高，再提 `setLayerVisibilityRequest` 進 `kit-datachannel-v1.schema.json`（另案）。S5a 經 owner 裁決新增的 `overlayStyleRequest` 只調透明度，圖層開關仍照本條。
- `coordinator-browser-api-v1.openapi.json` 的上述路徑由 `contract/schemas/cfd.ts`＋`browserContract.ts` 生成（S2 已落地，tags `cfd`）；payload 真相仍是 `tests/contracts/cfd-run-*-v1.schema.json`（S0）。
- S3 實作註記：疊圖不新增 Kit 命令。瀏覽器流程＝`POST /api/review-sessions/{id}/cfd-overlays`（coordinator 以上游 `overlay_layer.artifact_id` 登記 binding）→ console 對 viewer iframe 送 `apply_stage_binding{primary, secondary}` → viewer 走既有 stage-binding preauthorize（需 primary viewer lease）→ Kit `loadArtifactGroupRequest` → `openedStageResult` 確認後 viewer 回 `stage_binding_result{applied, revision_id, applied_secondary_layers}`。面板只在 `applied_secondary_layers` 含該 overlay artifact_id 時顯示「Kit 已確認載入疊圖」；Kit 未回報清單時誠實顯示「未回報疊圖層清單」。「關閉疊圖」＝只帶 primary 重新套用。
- S2 實作註記：瀏覽器版 create request 不含 `source.model_usdc_sha256` 與 `requested_by`（帶了即 400）；coordinator 由 `GET /api/conversions/{id}/result` 的 `artifacts.model_usdc.checksum_sha256` 綁定來源，conversion 未 ready 回 409 `source_not_ready`；`GET /api/cfd/runs/{run_id}` 回 `{ledger, status}`；streaming 不可達時 create 回 502 `cfd_upstream_unavailable`、list 回 ledger 快取並標 `stale:true`；overlay binding 以 `store.update` 附加到 session `artifact_bindings`（`display_name` 含「design comparison only」），`stream_config.stage_composition` 的預設 secondary 仍只挑 `derived`，overlay 要在 stage-binding 明選（S3）。

### 3.3 Kit（無新命令）

- 結果 layer 以 `session_sublayer` 進 stage，prim 在 `/World/Overlays/Cfd/<run_id>_<wNNN>/{PedestrianWind_1p5m, BuildingSurfacePressure, Streamlines, FlowParticles}`（service run；CLI run 的 run id 本身已以 `_wNNN` 結尾，prim 名稱即 run id），primvars `U_magnitude`、`U`、`p`、`displayColor`（P1 已實作，不變）。
- `loadArtifactGroupResult.applied_secondary_layers` 含該 artifact_id 即視為「圖層已載入」的 runtime 證據；前端不得以 ACK 之外的推斷宣稱可見。

### 3.4 governance-service（S6 落地）

- 原草案（欄位與範圍已由下一點的 S6 實作取代）：不新增路由。CFD 超標項目（例如行人高度風速 > 門檻）由 coordinator 組成 issue payload 經**既有** `/api/issues` 建立，`source: "cfd"`, `evidence: { run_id, wind_from_degrees, artifact_id, threshold }`。門檻與規則定義另案（屬 A1 整合，不在本 P2）。
- S6 實作註記（2026-09-22 owner 授權納入 P2）：governance `IssueCreate` 沒有 `source`、`evidence` 欄位，實際 payload 只有 `title`、`description`、`severity`、`usd_prim_path`、`model_version_id`。run_id、風向、門檻與疊圖 prim 寫在 title 與 description；不帶 `ifc_guid`，存為 annotation。CFD issue 以 `usd_prim_path` 前綴 `/World/Overlays/Cfd/` 辨識，Issue Center 的「CFD」篩選即依此（PR #904）。門檻預設 5 m/s，細節見 §5 S6 列。

### 3.5 web-viewer-sample

- 統一工作台新增「風環境」面板：選 conversion result → 選風向（1～16）→ 送出 → 進度 → 完成後每方向一列（收斂、峰值、疊圖開關）。
- 常駐標示「設計比較用」與 `assumptions`；未接通狀態依 R3 誠實停用；數值一律 `ProvTag` 標 runtime。
- 只打 coordinator；不出現 :49101 URL 之外的直連。

## 4. 程式落點與模組搬遷

| 現況（PR #884） | P2 落點（S1 已落地） | 說明 |
|---|---|---|
| `tools/cfd/bimcfd/*` | `bim-streaming-server/.../messaging/cfd_pipeline/`（`preprocess.py`、`openfoam_case.py`、`foam_vtk.py`、`usd_results.py`、`run_record.py`、`batch.py`、`cli.py`） | 已以 package 形式搬入 extension；`tools/cfd/bimcfd/__init__.py` 只剩把 `__path__` 指到 `cfd_pipeline` 的薄殼，CLI 與 `tools/cfd/tests` 不變、程式只有一份 |
| `tools/cfd/bimcfd/cli.py` | `cfd_job_service.py`（config／request 驗證／`CfdJobStore`／`OpenFoamCfdRunner`／單工佇列／路由）呼叫 `cfd_pipeline`，由 `host_native_conversion_service.build_app` 掛載 | job store 目錄：`<artifacts_root>/cfd/<run_id>/`，`run.json` 為狀態文件，結果檔全部放 run 根目錄供 `/cfd-artifacts` 提供；runner 可注入供測試 |
| `tools/cfd/kit/open_stage_capture_and_quit.py` | 保留為 E2E 證據工具 | 不進 runtime |
| Docker 執行 | Linux 181 直接 `docker run`（同 P1），`n_procs` 由 env `CFD_N_PROCS` 上限 | 缺 docker 或映像 → `worker_unavailable`，不得假成功 |

新增環境變數（全部有預設、缺值時功能誠實停用而非崩潰）：`CFD_ENABLED`（預設 false）、`CFD_IMAGE`（預設 `opencfd/openfoam-default:2412`）、`CFD_IMAGE_DIGEST`（有值時與本機映像 RepoDigest 比對，不符即 `worker_unavailable`）、`CFD_N_PROCS`（上限，亦作 docker `--cpus`）、`CFD_MAX_DIRECTIONS`（預設 16）、`CFD_MAX_CELLS_PER_DIRECTION`（S8，預設 8,000,000；送出時估算的單一風向格數超過即 422 `compute_cap_exceeded`）、`CFD_ARTIFACTS_ROOT`（預設 `<artifacts_root>/cfd`）、`CFD_PUBLIC_ARTIFACTS_URL`（預設 `<base_url>/cfd-artifacts`）。streaming 端 `CFD_ENABLED=false` 時 `POST /api/cfd-runs` 回 503 `cfd_disabled`，GET 列表仍可用並回 `enabled:false`；coordinator 端對應回 503，UI 顯示未啟用。寫入路由沿用 `STREAMING_CONVERSION_INTERNAL_TOKEN`（`X-Internal-Conversion-Token`），GET 與 `/cfd-artifacts` 與既有 `/artifacts` 同樣以 loopback 綁定為信任邊界。

## 5. 切片計畫

每切片一個 PR、一個 outcome、可獨立驗收；順序固定，前一切片合併並部署 181 後才開下一個。

| 切片 | Outcome | 主要變更 | DoD（本輪真實證據） |
|---|---|---|---|
| **S0 契約凍結**（PR #886） | 三個 JSON Schema（request／result／ledger-record）＋root 契約測試；設計正本 §04 `c4-cfd-api` 卡；`repository-boundaries.md`、`docs-plans-README.md` 納入；owner 三項裁決寫入 §1 | 只有文件與契約檔。**openapi 路徑不在 S0 手改**：`coordinator-browser-api-v1.openapi.json` 由 coordinator zod 契約生成並有 drift 測試，S2 新增 `cfd.ts` schema 時一併生成 | `pytest tests/test_cfd_contracts.py` 綠；owner 核可 |
| **S1 streaming CFD job service**（已合併 #887） | :49101 可建立、查詢、取消 CFD run，結果檔可下載 | `cfd_pipeline/` 套件搬遷、`cfd_job_service.py`、queue（同時 1）、store、`/cfd-artifacts`、`CFD_*` env | `tests/test_cfd_job_service.py`（fake runner，19 項）＋既有 streaming 全套；本機真 docker 經掛載後的服務跑 1 方向 202→ready，結果通過 `cfd-run-result-v1` schema（證據 `docs/evidence/cfd-s1-2026-09-21/`）；`tools/cfd` CLI 與 42 項工具測試仍可用 |
| **S1.1 自審修正**（PR #889） | 真實輸入下 result 仍符合凍結 schema；取消、重啟、並發、下載白名單有防護 | 失敗方向以契約形狀進 result、原因進 run_record；`first` 不再讀磁碟；`normalize_true_north` 把未知真北映成 `true_north_unknown_assumed_project_north`；`run_case(should_stop)` 輪詢殺容器；`compare_and_set_status` claim／取消；`reconcile_on_start` 重排 queued、孤兒標 `worker_unavailable`；`_create_lock` 同鍵並發只建一 run；`/cfd-artifacts` 白名單（不再供 `run.json`／`request.json`）；run_record 去主機路徑、`status.error` 有界去路徑 | 服務測試 30、工具測試 44、streaming 全套綠；S1.1 程式再跑一次真 docker 1 方向 E2E |
| **S2 coordinator ledger 與路由**（PR #888） | 瀏覽器可經 :8004 建 run、看進度、拿結果與 overlay URL | `cfdRunRoutes.ts`、`cfd.ts` schema、`cfdRunClient`、`cfdRunLedger`、`/review-sessions/{id}/cfd-overlays` binding 註冊、openapi／viewer 型別重生、`CFD_ENABLED`／`CFD_RUN_LEDGER_STORE_PATH` | `tests/cfd-run-routes.test.ts` 8 項（in-process streaming stub，回應驗證 seam enforce）＋coordinator 全套 vitest 綠；POST→ready→overlay binding 於 `stream-config` 可見；`CFD_ENABLED=false` 回 503。真 Kit 載入 overlay 留 S3 |
| **S2.1 coordinator 自審修正**（PR #890） | #888 合併後自審：canonical 審查 session 登記 overlay 會被 `sessionStore` 不變量拒絕且 async handler 未接 `next`（Critical）；overlay `artifact_id` 由 coordinator 以 JS 捨入重算與 streaming Python 捨入在 .5 分歧；zod 多宣告凍結 schema 沒有的 `failure_code`；list `limit` 未套用 ledger；cancel 409／上游 401 未宣告；overlay 讀改寫跨 await | `sessionStore.isModelBinding`：`artifact_role: overlay` 不計入 ready-review 投影（`sourceProjectsExactly`／`sessionMatchesReadyBundle`）；所有 CFD handler 以 `route()` 包裝接 `next`；overlay 直接採上游 `artifact_id`、方向精確相等；寫入前重讀 session；`requested_by.principal` 改由 user auth provider（同 stage-binding）給定，不信任 `x-operator-id`；`cfdRunListQuery`／param schema 移到 `schemas/cfd.ts` 共用；cancel 宣告 409、上游 401/403 對應 502 | `tests/cfd-run-routes.test.ts` 13 項（新增 canonical session overlay、22.5°→`w022`、guard 403、stale detail、limit／409／401→502）；`unit_sessionstore`、`ready-model-session` 綠；openapi／viewer 型別重生 |
| **S3 前端與 Kit 疊圖**（PR #891） | 統一工作台可送出風向、看進度、在 primary viewer 開關 CFD 疊圖 | `WindEnvironmentPanel.tsx`（左欄工具列「風環境」disclosure）＋`cfdClient.ts`（只打 coordinator）；viewer embed 協定新增 console→viewer `apply_stage_binding` 與 viewer→console `stage_binding_result`（`viewerEmbedProtocol.ts`），Window 以既有 `_applyBinding` 交易套用、只在 Kit 確認（openedStageResult／bindingApplied）後回 `applied` 並附 Kit 回報的 `applied_secondary_layers`；`ReviewSessionViewerPane.applyStageBinding` → `ViewportSlotApi.applyStageBinding`；常駐「設計比較用」標示、`assumptions`／`sealing_suspect` 原樣顯示、ProvTag asbuilt | vitest：`WindEnvironmentPanel.test.tsx` 6 項（凍結 request 形狀、輪詢終態、overlay 登記→stage-binding→Kit 確認、409／Kit 失敗／層不在清單皆不宣告載入）、`viewerEmbedProtocol.test.ts` +5；viewer 全套 vitest、tsc、eslint（新檔零警告）。**真 Kit browser E2E（first frame、`applied_secondary_layers` 含 cfd artifact、疊圖截圖）見 PR 驗證段；未在 PR #891 完成者明列** |
| **S3.1 CFD 視覺化品質**（PR #892，owner 2026-09-21 追加） | 疊圖能當產品呈現：看得到建物、色階圖例與流線動態 | `usd_results.py`：行人面裁到建物 bbox 外擴 3H、三 prim 同一組固定色階（U 0–5 m/s；p 依本方向建物面上下限）並寫入 run prim `customData cfd:legend`、切面 `displayOpacity 0.6`、流線 `BasisCurves` 管狀 `widths 0.5`；`openfoam_case.py` 種子改為入口垂直格點 `cloud`（預設 240 點、8 列）；新模組 `flow_animation.py`：沿穩態流線平流的粒子動畫（24 fps、10 s、1500 粒子）寫成時間取樣 `UsdGeom.Points`，layer `customLayerData cfd:animation`＋標示「示意動畫，基於穩態解」；Kit `stage_loading`：偵測到 CFD 動畫 layer 即設定 timeline 循環播放並把相機框到 `/World/Elements`（非整個 overlay）；前端面板加色階圖例（U 固定 0–5、p 取 result 的建物面範圍）；`tools/cfd/kit/probe_usdvol_openvdb.py` 實測 UsdVol＋OpenVDB（結果寫回計畫書 §5.5） | tools/cfd pytest、streaming pytest（含 stage composition ＋4）、viewer vitest；Kit headless 截圖（管狀流線、透明切面、粒子三個時間點）；真 Kit WebRTC 驗收已在本機 stack 完成（Playwright＋Chrome：first frame → 顯示疊圖 → coordinator 登記 → stage-binding → Kit `applied_secondary_layers` 含 cfd artifact → 10 秒錄影；本機轉檔器被 ACL 守門擋住，模型以先前真實轉出的 `model.usdc` 註冊為 succeeded job，其餘全走真服務；證據 `docs/evidence/cfd-s3-1-2026-09-21/browser/`）。**透明度滑桿需新增 Kit DataChannel 命令，見 §6 追蹤** |
| **S4 181 部署與 16 風向**（PR #893＝部署接線；真站 run 與證據 PR #902，背景格更正 PR #907） | 181 上跑完 16 方向並在 UI 檢視 | `scripts/lib/cfd-solver-deploy.ps1`（`Resolve-CfdDeployEnvironment` fail-closed 解析、`Ensure-CfdSolverImage` 缺映像 pull by digest／digest 不符 exit 4、`Set-CfdProcessEnvironment`）；`deploy.ps1` Phase 4b 帶 `CFD_*` 給 host-native conversion，CFD 指紋進 conversion／web-plane runtime signature；`compose.runtime-manager.yml` coordinator `CFD_ENABLED`＋掛載卷上的 `CFD_RUN_LEDGER_STORE_PATH`；`docs/agents/local-verification.md` 列 canonical env 鍵。**canonical env 需 owner 加 `CFD_ENABLED=true`（其餘可用預設）** | `scripts/tests/test-deploy-cfd-solver.ps1`（解析預設／派生 URL／fail-closed／映像 present・pull・mismatch）、`test-deploy-dryrun.ps1` 綠；**181 真站證據（2026-09-22，`docs/evidence/cfd-s4-2026-09-22/`）**：16 向 run `ready` 16/16、16/16 residualControl 收斂（436–571 步、無自動延長）、1.25–3.41 M 格、行人面 \|U\|max 3.49–4.48 m/s（U_ref 5）、洩漏 12.0%、牆鐘 7.06 h（平均 26.5 分／向，`CFD_N_PROCS=4`）、`validation_level: screening`；真 Chrome Playwright 對 181：啟動 3D → 顯示 N 0° 疊圖 → Kit 確認載入 → 10 s 直播錄影（1 passed）。求解期間 Kit first frame／ACK 不退化（R-A1）已於 2026-09-23 另行量測通過，見 §6 R-A1 與 `docs/evidence/cfd-ra1-2026-09-23/`（限制見 §6 R-A1） |
| **S5 品質** | 網格收斂與基準比對；開頭先收 S3.1 遺留的透明度滑桿（owner 2026-09-21 裁決） | **S5a（PR #894）**：新 Kit DataChannel 命令 `overlayStyleRequest{prim_path, display_opacity}` → `overlayStyleResult`，宣告於 `kit-datachannel-v1.schema.json`（mutator、`OVERLAY_DISPLAY_OPACITY` 0–1、prim 限 `/World/Overlays/Cfd/**`）並重生成三份詞彙檔；Kit `overlay_style.py` 在 session layer 為目標 prim 綁 `UsdPreviewSurface`（`diffuseColor` 接 `displayColor` primvar reader、`opacity` 可調、`ior 1`＝純混合）並同步寫 `primvars:displayOpacity`；opacity 1 即移除覆寫（不動 artifact，readback 為證據）。**實測發現**：Kit 110.1 RTX 不把 `primvars:displayOpacity` 畫成半透明（0.6→0.15 只動 0.2% 像素，開 fractionalCutoutOpacity／translucency 旗標亦同），所以 S3.1 authored 的 0.6 從未真的半透明；材質路徑才是 RTX 認得的透明；coordinator Runtime Mutation Authority 加同形 Zod context；viewer `overlay_style` 通道（family `overlay`）；風環境面板行人面透明度滑桿（放開才送、只調 `PedestrianWind_1p5m`、疊圖換層即 invalidate）。**S5b-1（PR #895）**：`solver_not_converged` 自動延長 endTime 一次（`Allcontinue`：`foamDictionary` 提 endTime 至 2 倍、`runParallel -s continue` 續解、只延長一次；job service 與 CLI 共用 `run_case_with_extension`）；run record 新增 `validation_level`（`screening`／`mesh_convergence_checked`／`benchmark_compared`，高於 screening 須附 evidence sha256）與 `solver.end_time_effective`／`extended_once`；result／browser contract 加 optional `directions[].end_time_extended_to` 與 `validation_level`；`bimcfd converge`：三層背景格（Celik 2008 GCI）→ `mesh_convergence.json`＋`.svg`。**S5b-2（PR #896）**：`bimcfd aij-case-c`（AIJ UWE Case C，Zenodo 10.5281/zenodo.15401792，CC BY 4.0；3×3 個 0.2 m 方塊、中心距 0.4 m；程式自建幾何、AF 剖面 log-law 擬合入流、量測點 IDW 取樣、hit rate／FAC2／R／FB／NMSE、散點 SVG；資料檔只放本機）；`converge --refinement-box isotropic`（等向細化盒：頂點重心＋最遠頂點半徑＋同邊距，任意風向同盒） | S5a：root／Kit／coordinator／viewer 詞彙與契約測試全綠；Kit headless 以真 overlay layer 套用 0.6→0.15 的截圖對照。S5b-1：真 docker 粗網格 endTime 60→120 自動延長實證（兩趟 exit 0、`solverInfo` 兩段、record 取 `.continue` 日誌）；三層網格收斂實跑（8／6／4.5 m，21.6 萬／51.1 萬／116.6 萬格，三層皆 residualControl 收斂）曲線與 GCI 進 `docs/evidence/cfd-s5b-2026-09-22/`。**實跑結論**：行人面 `U_max` 單調收斂但 fine-grid GCI 14.4%（p 1.55）、面積加權 `U_mean` p 僅 0.27（GCI 190%）、`U_p95` 發散、`p_min` 震盪、`p_max` GCI 0.6% → 現行 6 m 預設**未達網格獨立**，`validation_level` 維持 `screening`；需 3 m 以下層級或改細化策略再測（S5b-2 前置）。**S5b-2 實跑**（`docs/evidence/cfd-s5b2-2026-09-22/`）：(1) AIJ Case C 1D／WD 0，scale 75、背景格 3 m、bbox 細化盒（基準網格；S5c 後 `aij-case-c` 預設仍 bbox 以維持可比）、68.3 萬格，600 步未收斂自動延長至 1200 仍未達 residualControl：120 點 hit rate **38%**（COST 732 門檻 66%）、FAC2 74%、R 0.85、FB **+0.34**（CFD 系統性低估行人高度風速約 30%）、NMSE 0.20 → 管線**未通過** AIJ 基準，`validation_level` 不得標 `benchmark_compared`；候選原因（RANS k-ω SST 街谷低估、入流 k／ω 與 z0 擬合、壁函數、Re 縮放）列入 S6 前置。(2) 等向盒 6／4.5／3 m（57.4 萬／130.5 萬／445.6 萬格；3 m 層 600→1200 步延長後 640 步收斂，52 分鐘）：`U_max` 單調、fine-grid GCI **1.9%**（p 2.55；形式階上限 2.8%）、`p_min` GCI 0.05%；但面積加權 `U_mean`（1.44→1.64→1.99）與 `U_p95`、`p_max` 發散 → 峰值已網格獨立、平均場尚未；GCI 由 S5b-1 的 14% 降到 1.9% **主要來自以 3 m 層取代 8 m 層**（fine-pair 差 0.203→0.088、p 1.55→2.55），不是盒模式：同層對照 `U_max` 6 m bbox 2.922 vs 等向 2.960（+1.3%）、4.5 m 3.125 vs 3.107（−0.6%）；等向盒的價值在各風向同格數（本輪只跑 0°，方向無關性未實測）。結論：現行 6 m 預設可信度只到「峰值 ±3%」，仍為 `screening`。**S5c（PR #897，owner 2026-09-22 裁決）**：`refinement_box_mode` 預設改 `isotropic`（service 與 CLI 一致；`bbox` 保留為對照選項）；離線以 S3.1 外殼建 16 方向 case：等向盒 16 向同尺寸（447×424×46 m，189,486 m²）；bbox 盒 29,085–54,149 m² 隨向變動；背景格數兩模式皆 130,848–472,320 隨計算域變動（`docs/evidence/cfd-s5c-2026-09-22/`）。代價：細化區面積 3.5–6.5 倍，S5b-2 同層真跑格數 +12%（574k vs 511k） |
| **S6 前置：AIJ 低估根因切離**（PR #898，E5 PR #899；owner 2026-09-22 裁決） | 找出 S5b-2 CFD 低估行人風速約 30% 的主因 | 各一次 AIJ 1D／WD 0 真跑，一次只改一項：(1) 入流 k／ω 改由 AF `u_rms` 給定；(2) z0（AF 擬合 0.38 mm 風洞尺度 → scale 75 後 2.82 cm，即 ABLConditions `z0 uniform 0.0282429`；換 1 cm／5 mm 管線尺度）——注意單一 `z0_m` 同時餵入流 `atmBoundaryLayerInlet*`、`atmNutkWallFunction` 與正規化參考速度，此步是「三者一起換」，要分離壁函數需先解耦；(3) scale 1（Re 對齊，需 1.5 m 行人面參數化）；(4) 背景格 1.5 m；每次比 hit rate／FB 變化 | 比對表進 evidence；hit rate ≥ 66% 前 `validation_level` 不得標 `benchmark_compared`。**實跑（`docs/evidence/cfd-s6pre-2026-09-22/`，基準 38%／FB +0.34）**：E1 入口 k／ω 改 AF u_rms（I 0.22）→ 36%／+0.37（無效）；E2 地面 z0 2.82 cm→1 cm（入流不動）→ **44%／+0.25**（唯一有效，FB 降 0.09）；E3 scale 1（Re 對齊）→ 32.5%／+0.41（更差；背景格 126×139×31 因浮點 ceil 與基準 125×139×30 略異，非嚴格同格）；E4 背景格 1.5 m（515 萬格、6,202 s）→ hit rate 40.0%、FAC2 **85%**、R 0.81、**FB −0.001**：系統性低估消失（平均預測 0.654 vs 量測 0.654），但逐點散佈仍大（RMSE 未降、hit rate 只 +1.7 pp）。四者皆 600→1200 步仍未 residualControl，每項單次、無重複；120 點 hit rate 的二項標準誤約 ±4.4 pp。**謹慎結論**：低估**偏差**的主因是網格解析度（3 m 背景格對 15 m 方塊街谷太粗）；地面 z0 是次要因子（E2 FB −0.09，部分可能來自入流與地面不再平衡的剖面發展）；入口紊流（E1）與 Re 縮放（E3）在單次未收斂實跑下未見改善（±1.3σ 內）。**E5（E4＋E2：1.5 m 格＋地面 z0 1 cm，515 萬格、6,271 s，同樣 1200 步未收斂）→ hit rate 25.0%、FAC2 86.7%、R 0.82、FB −0.085、RMSE 0.285**：在細網格上再縮 z0 看起來會過度修正成輕微高估並拉大散佈（hit rate 25% vs E4 40%，差 15 pp 約 3 個二項標準誤；RMSE 0.285 vs 0.248），故傾向解讀為：E2 在粗網格上的正向效果是對網格偏差的補償，細網格下 z0 應維持擬合值 2.82 cm。注意 E5 是兩因子組合、單次且未收斂，而 E2／E5 的 z0 改動只作用於地面壁函數（入流 z0 不動，剖面與地面不再平衡），FAC2／R 幾乎不變而 RMSE／NMSE 變差，說明差異主要在逐點分佈而非整體尺度。修正後結論：偏差主因＝網格解析度；殘餘 hit rate 缺口（E4 40% vs 66%）是逐點空間分佈（RANS 街谷／尾流結構）；下一步是模型層（realizable k-ε／LES）或 AIJ 其他組態交叉檢查，`benchmark_compared` 仍不可用 |
| **S6 A1 finding**（PR #901，prim 路徑修正 PR #905、#906；owner 2026-09-22 授權納入 P2） | 風環境成為審查產出：行人面 \|U\|max 超門檻的風向可一鍵轉成 governance issue，內容如實標示等級 | coordinator 新路由 `POST /api/cfd/runs/{runId}/findings`（body `threshold_u_m_s` 預設 5 m/s＝圖例上限、`model_version_id` 可 null、可選 `wind_from_degrees` 子集）：取 run result（非 `ready` → 409 `run_not_ready`），每個 `ready` 且 `\|U\|max > 門檻` 的風向組 `IssueCreate` payload 打**既有** governance `/api/issues`（loopback base 同 proxy；不新增 governance 路由）：title 含風向／峰值／門檻／`validation_level`／「設計比較用」，description 逐項寫 run_id、conversion_job_id、送出參數、洩漏率、assumptions、limitations、疊圖 prim；不帶 `ifc_guid`（場結果不綁單一元件 → governance 存為 `annotation`）；`severity` medium，>1.5× 門檻 high；`usd_prim_path`＝行人面 prim。同一 (run, 風向, 門檻, model_version_id) 只開一次：ledger `findings[]`（additive optional，含 `opened_by`）為 idempotency key，coordinator 以 per-run 鎖序列化 check→POST→record；ledger 遺失時先以 `GET /api/issues?kind=annotation[&model_version_id]` 用 prim path＋title 預查，找到即 replay 不重開；governance 非 2xx → 502 `governance_unavailable`，**失敗那一向**不記、之前已開的仍在 ledger 並隨 502 回 `created_count`，重試只補未開的方向；請求的角度不在 run 內回 `not_in_run`。description 的風向註記依 assumptions 決定（真北預設／未知＝相對 project north；手動或模型真北＝已旋轉）。viewer：`cfdClient.createFindings`、面板「超標方向轉 A1 issue」（門檻輸入 0.5–30、run 非 ready 時 disabled、回覆摘要＝新開幾筆／幾向超標／等級、ledger findings 清單；失敗時也重讀 ledger）；`WindSource.modelVersionId` 取 session primary binding 的 `model_version_id`，無 session 送 null | coordinator route 測試（payload 逐欄、replay、不同門檻＝新 finding、high severity、409／502／400）、ledger schema 契約測試、面板 vitest（有 session 帶 model_version_id、無 session null、門檻範圍、502 誠實顯示）。**限制**：AIJ hit rate 40% 未達 66%，service run 只到 `screening`；issue 文字據此標示，不得當合規依據。**181 真站證據（2026-09-23，`docs/evidence/cfd-s6-2026-09-23/`）**：部署 `f2905ba` 後，以 S4 的 16 向 run、審查 session 帶 `model_version_id`、門檻 4.4 m/s 從面板按「超標方向轉 A1 issue」→ 201，新開 2 筆 annotation（135° 4.48、157.5° 4.42 m/s，medium），其餘 14 向 `below_threshold`；再按一次 → 200，`created_count` 0、兩向 `idempotent_replay`；governance annotation 0→2，Issues／BCF 頁按「載入 issues」後列出兩筆（kind=annotation、ifc_guid 空、標題含 screening／設計比較用）。未做：並發與 governance 逾時的真站重現（只在 route 測試） |
| **S7 風環境面板以模型為主體**（PR #900，owner 2026-09-22 裁決方向 1） | 關掉 3D session 後風場計算不「消失」：run 以模型為鍵、無 session 也能瀏覽／送出，session 只在顯示疊圖時需要 | coordinator：`cfd-run-request/v1` 加 optional `origin{session_id}`（coordinator 專用，轉送 streaming 前剝除，凍結的 streaming 面不變）；ledger record 加 optional `origin{session_id, wind_from_degrees, uref_m_s, end_time, n_procs, background_cell_m}` 與 `queue_position`（coordinator 由 ledger 中 `queued` 記錄依 `created_at` 排序**估算**，非 streaming 權威；`submitted_at` 以既有 `created_at` 取代）；`GET /api/cfd/runs` 不帶 `conversion_job_id` 的跨模型列表本已存在，面板直接用。viewer：`cfdClient.listModels()`（`/api/conversion/records` 的 `ready` 項）、面板模型選擇器（有 session 時鎖定 session 模型）、無 session 可瀏覽／送出並送 `origin.session_id: null`、run 狀態列顯示排隊位置與來源 session、`<details>` 跨模型「所有模型的風場計算」（最近 20 筆）；「顯示疊圖」在無 session 時 disabled 並以 title 說明。自審修正：面板以「最後啟動的載入勝出」丟棄跨模型晚到回覆、session 解析中不載入挑選模型、只渲染屬於目前模型的 run；coordinator overlay 登記加 409 `model_mismatch`（run 的模型 ≠ session primary binding）；idempotent replay（200）不覆寫既有 origin | 契約測試（ledger schema additive）、coordinator route 測試（origin 不轉送、queue_position 確切名次、replay 不改 origin、model_mismatch、跨模型列表）、面板 vitest（無 session 選模型送出＋疊圖鎖、有 session 鎖定模型＋origin＋排隊位置＋總覽）；tsc／eslint 0。**181 真站證據（2026-09-22，`docs/evidence/cfd-s7-2026-09-22/`）**：無 session 展開面板 → 選擇器列 21 個 ready 模型 → 挑 S4 run 所屬模型 → 16 向結果照常瀏覽、送出可按、「顯示疊圖」disabled 並有 title、跨模型總覽 7 筆。未做：無 session 真站送出新 run、排隊位置真站畫面（無 queued run）。不新增儲存層或 DB table（owner 原提案的「cfd's db table」由既有 JSON ledger 承接） |
| **S8 計算設定可調（A 階段）**（owner 2026-09-23 選方向 1；A1＝選項端點、預估與算力上限，A2＝面板） | 計算設定能在面板調整，送出前看到每向與總計的預估格數與耗時（標明是估算），伺服器擋算力上限；引擎（`cfd_pipeline`）不改、服務預設不變 | **A1**：streaming 新增版控設定檔 `cfd_options.json`（標準預設組＝現行服務預設、面板欄位中繼資料、預估校正值與再確認門檻）與 `cfd_options.py`（契約上下限常數表，`validate_run_request` 與選項端點共用；省略的欄位改取標準預設組，數值與先前寫死的預設完全相同）；`GET /api/cfd-options` 回 `cfd-options/v1`；`POST /api/cfd-estimates`（`cfd-estimate-request/v1` → `cfd-estimate/v1`，唯讀）：背景格以引擎同一套 COST 732 計算域與格規則精算，幾何優先取同模型前一次 run 的 `shell.stl`、否則以轉檔 `bbox_index.json` 依 profile 篩類別與離群，加細後格數與耗時由本機已完成 run 的比例校正、沒有歷史時用設定檔記載來源的預設值；建立 run 時若估得出來且單一風向超過 `CFD_MAX_CELLS_PER_DIRECTION`（預設 8,000,000，canonical env 可設）即 422 `compute_cap_exceeded`，估不出來不擋；run 文件與 run record 記 `settings_profile`（是否等於標準預設組、自訂欄位）與送出時的估算摘要；不等於標準預設組的結果在 `limitations` 加註（S6 issue 文字隨之帶出，`assumptions` 封閉列舉不動）。coordinator `GET /api/cfd/options`、`POST /api/cfd/estimates` 透傳（估算與建立 run 走同一個守門；回應形狀由契約 seam 在測試模式驗證），建立時 ledger `origin` 追加 zref／z0／真北來源與手動角度、`preset_match`；三份新 JSON Schema、ledger origin additive 欄位；openapi 與 viewer 型別重生；部署腳本登記 `CFD_MAX_CELLS_PER_DIRECTION`。**A2**：viewer 風環境面板新增「計算設定」區，欄位、分區、上下限、預設值、預設組全由 `GET /api/cfd/options` 產生（新檔 `cfdSettings.ts` 純邏輯、`WindRunSettings.tsx` 呈現）：預設組（標準／自訂，改任一預設組欄位即標為自訂並顯示誠實註記）、一般（U_ref、z_ref、z0、真北來源與手動角度）、進階（背景格含「自動」、endTime）；U_ref 上限改由選項回報的契約上限（40 m/s），原本寫死的 60 移除；選項取不到時不自行編造表單，送出停用並顯示原因。設定或風向變更後防抖估算，顯示總格數與耗時、背景／近建物／加細盒格大小、每向明細與依據，一律標「估算值，不是實測」；送出時若估算已過期先即時重估，超過再確認門檻要按第二次「確認送出」，超過算力上限直接停用送出（伺服器仍會 422）。run 詳情顯示 ledger `origin` 記錄的設定（S8 以前的 run 註明當時為標準值），「用這組設定重新送出」把設定與風向帶回表單並要求確認一次；finding 回覆逐向列出已開／已存在的 issue 或 `skipped_reason` | A1：`bim-streaming-server/tests/test_cfd_options_estimate.py`（上下限對契約、標準預設組重現舊預設、設定檔防呆、選項端點、背景格與 `build_case` 對同一外殼逐格相等、bbox_index 篩選、歷史校正、再確認與硬上限、估算端點錯誤、422 不建立 run）、`tests/test_cfd_contracts.py`（新 schema 範例、估算請求沿用 run request 定義、選項範例不放寬上下限、ledger origin 選填）、coordinator `tests/cfd-run-routes.test.ts`（選項／估算透傳、400／502／503、origin 記錄、422 透傳）、`scripts/tests/test-deploy-cfd-solver.ps1`。A2：`cfdSettings.test.ts`（契約範例的上下限、隱藏欄位不算自訂、組請求、S8 前 origin 還原）、`WindEnvironmentPanel.test.tsx`（表單只由選項產生、U_ref 41 被擋、自訂註記與還原標準、送出與估算帶同一組設定、估算標示與依據、再確認與硬上限、重送、逐向原因、選項失敗不編造）。部署與真站驗證在 A1、A2 合併後一起做 |

不做：governance 新路由、商用求解器、室內熱對流（`interior-ventilation/v1` 受 P0.2 阻塞，見 `building-energy-cfd.md` §10.4）。新 Kit 命令原列不做，S5a 經 owner 裁決只新增 `overlayStyleRequest`（透明度）。

## 6. 風險與待 owner 確認

| 項目 | 內容 |
|---|---|
| R-A1 | 求解與 Kit 同機搶 CPU：S4 以 `CFD_N_PROCS` 與 docker `--cpus` 限制，實測 Kit first frame 與 DataChannel ACK 不退化才算過。**已量測通過（2026-09-23，`docs/evidence/cfd-ra1-2026-09-23/`）**：181（20 核、RTX 5080）以 2 向 run 佔滿 4 核上限（`snappyHexMesh`／`simpleFoam`，容器 391–394% CPU）期間，A-B-A 各 3 次真 Chrome：first frame 中位數 1238→1287 ms、DataChannel ACK（`camera_state`）最差 p95 40.6→43.9 ms 且 270/270 applied、呈現 fps 中位數 59.3→55.4（同期解碼幀率九次皆 60）、0 斷線；判定基準與逐次數據見 evidence。限制：每條件 3 次、只驗 `CFD_N_PROCS=4`；ACK 只量唯讀 `camera_state` 往返，會改 stage 的命令未量；前處理（host-native、不受 `--cpus` 限制）未量；判定基準在閒置三次與負載中第 1 次之後才寫定 |
| R-A2 | **已裁決：納入外殼**（§1）；`appendage_policy: included` 進契約 |
| R-A3 | 真北未知：所有結果帶 `assumptions`，P0.2 資料到位前 UI 不得顯示羅盤方位，只顯示「相對 project north」 |
| R-A4 | 45° 等方向 300 步未收斂：S1 預設 `end_time` 600（P1 半徑 4 補跑 285 步收斂），S5b-1 已加自動延長一次（`Allcontinue`，續解不重網格） |
| C-1 | **已裁決：留 streaming job store**（§1） |
| C-2 | **已執行**：S0 直接在 repo 的 `.dc.html` §04 新增 `c4-cfd-api` 卡（HTML 靜態區塊，未改 `support.js`）；上游 design repo 不回寫 |
| overlay 與 canonical session | **agent 裁決（S2.1，2026-09-21，owner 可覆寫）**：CFD overlay binding 是附加的結果圖層，不屬 ready-review 來源投影；`sessionStore` 的「恰一 binding」不變量改為只計 `artifact_role !== "overlay"` 的 model binding。另一選項（overlay 不入 `artifact_bindings`、改在 stage-binding 時組合）需改 runtime authority 的 artifact 解析，未採。POST/DELETE overlay 仍走 conversion control guard，不要求 viewer lease |
| **P0.2 阻塞（S3.1 第 5 項回報）** | 熱流／能耗需要 P0.2 三項輸入，目前 IFC 與抽取器都拿不到：(1) **U 值**：`IfcMaterialLayerSet`／`Pset_*Common.ThermalTransmittance` 在測試 IFC 未填，P0.1 抽取器也未實作材質層讀取；(2) **可開窗**：`IfcWindow` 的 `OperationType`／`Pset_WindowCommon.IsExternal` 與開口面積尚未抽取；(3) **真北**：P0.1 只拿到 `TrueNorth` 預設方向（`true_north_default_direction`），所有結果仍「相對 project north」。**不以假資料做熱流**；S3.1 只做風場視覺化。解除條件：P0.2 抽取器落地並有真 IFC 帶上述屬性；拆解與完成條件見 `building-energy-cfd.md` §10.1 |
| 風環境面板以模型為主體（owner 2026-09-22 裁決方向 1） | **已由 S7 落地（見 S7 列）**。原現況：面板從 session 的 stream-config 取模型，無 session 什麼都不列；只列該 session 綁的模型的 run；ledger 無 session／參數摘要／佇列位置；streaming 單 worker FIFO。落地差異：`submitted_at` 不另加欄位（既有 `created_at` 即送出時間）；`queue_position` 是 coordinator 依 ledger `queued` 記錄估算的 FIFO 位置，streaming 內部佇列仍是權威，二者在多 coordinator 或 ledger 重建時可能短暫不一致；不新增儲存層 |
| 疊圖透明度滑桿 | S3.1 第 4 項的滑桿需新增 Kit DataChannel 命令；owner 2026-09-21 裁決併入 S5 開頭，已由 S5a 落地（`overlayStyleRequest`，見 S5 列） |
| CFD 疊圖 prim 路徑（2026-09-23 真站 Chrome 驗證發現） | 在 181 以可見 Chrome 操作時，行人面透明度滑桿回「透明度未套用：回覆無法確認結果」。根因：CFD 服務產出的疊圖層以 `safe_prim_name(f"{run_id}_{tag}")` 命名 run prim（例：`/World/Overlays/Cfd/<run_id>_w000/PedestrianWind_1p5m`，由下載 181 上 16 向 run 的 w000 疊圖層確認），viewer 滑桿與 S6 finding 的 `usd_prim_path` 卻用 `<run_id>`，Kit 找不到 prim。S5a 本機證據用 CLI run（其 run id 本身已以 `_wNNN` 結尾）且直接指定 prim，所以沒抓到。修正：viewer 改由 overlay artifact id `cfd:<run_id>:<wNNN>`（`cfdOverlayPrimPathForArtifact`）、coordinator finding payload 改由該方向的 `overlay_layer.artifact_id` 組 prim 路徑，tag 一律取自 artifact id（Python 捨入，不在 JS 重算）。**遺留**：181 上 2026-09-23 已開的兩筆 CFD annotation（`iss_551496060cb5`、`iss_41cf5c91b681`）記錄的是舊的錯誤路徑，governance 凍結無更新端點；**owner 2026-09-23 裁決保留、不處置**。後續 PR #906：超門檻但沒有本 run 疊圖層的方向回 `overlay_missing`，不開 issue |
| 洩漏 | **已裁決：12% 接受**，預設門檻 0.15；S1 的 `sealing_check` 沿用 P1 參考半徑 8 的量法 |

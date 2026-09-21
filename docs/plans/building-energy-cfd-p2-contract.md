# 建築風場 CFD P2：§04 契約草案與切片計畫（方向 A）

日期：2026-09-21。狀態：**S0 契約凍結（owner 已核可草案 PR #885 並裁決 C-1／R-A2／洩漏門檻）**：payload 以 `tests/contracts/cfd-run-request-v1.schema.json`、`cfd-run-result-v1.schema.json`、`cfd-run-ledger-record-v1.schema.json` 為最高標準（root `tests/test_cfd_contracts.py` 守護），設計正本 §04 新增 `c4-cfd-api` 卡，`docs/agents/repository-boundaries.md` 已納入。本檔不是 runtime 完成證據；S1 起才有程式。
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
- `coordinator-browser-api-v1.openapi.json` 的上述路徑由 `contract/schemas/cfd.ts`＋`browserContract.ts` 生成（S2 已落地，tags `cfd`）；payload 真相仍是 `tests/contracts/cfd-run-*-v1.schema.json`（S0）。
- S3 實作註記：疊圖不新增 Kit 命令。瀏覽器流程＝`POST /api/review-sessions/{id}/cfd-overlays`（coordinator 以上游 `overlay_layer.artifact_id` 登記 binding）→ console 對 viewer iframe 送 `apply_stage_binding{primary, secondary}` → viewer 走既有 stage-binding preauthorize（需 primary viewer lease）→ Kit `loadArtifactGroupRequest` → `openedStageResult` 確認後 viewer 回 `stage_binding_result{applied, revision_id, applied_secondary_layers}`。面板只在 `applied_secondary_layers` 含該 overlay artifact_id 時顯示「Kit 已確認載入疊圖」；Kit 未回報清單時誠實顯示「未回報疊圖層清單」。「關閉疊圖」＝只帶 primary 重新套用。
- S2 實作註記：瀏覽器版 create request 不含 `source.model_usdc_sha256` 與 `requested_by`（帶了即 400）；coordinator 由 `GET /api/conversions/{id}/result` 的 `artifacts.model_usdc.checksum_sha256` 綁定來源，conversion 未 ready 回 409 `source_not_ready`；`GET /api/cfd/runs/{run_id}` 回 `{ledger, status}`；streaming 不可達時 create 回 502 `cfd_upstream_unavailable`、list 回 ledger 快取並標 `stale:true`；overlay binding 以 `store.update` 附加到 session `artifact_bindings`（`display_name` 含「design comparison only」），`stream_config.stage_composition` 的預設 secondary 仍只挑 `derived`，overlay 要在 stage-binding 明選（S3）。

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

| 現況（PR #884） | P2 落點（S1 已落地） | 說明 |
|---|---|---|
| `tools/cfd/bimcfd/*` | `bim-streaming-server/.../messaging/cfd_pipeline/`（`preprocess.py`、`openfoam_case.py`、`foam_vtk.py`、`usd_results.py`、`run_record.py`、`batch.py`、`cli.py`） | 已以 package 形式搬入 extension；`tools/cfd/bimcfd/__init__.py` 只剩把 `__path__` 指到 `cfd_pipeline` 的薄殼，CLI 與 `tools/cfd/tests` 不變、程式只有一份 |
| `tools/cfd/bimcfd/cli.py` | `cfd_job_service.py`（config／request 驗證／`CfdJobStore`／`OpenFoamCfdRunner`／單工佇列／路由）呼叫 `cfd_pipeline`，由 `host_native_conversion_service.build_app` 掛載 | job store 目錄：`<artifacts_root>/cfd/<run_id>/`，`run.json` 為狀態文件，結果檔全部放 run 根目錄供 `/cfd-artifacts` 提供；runner 可注入供測試 |
| `tools/cfd/kit/open_stage_capture_and_quit.py` | 保留為 E2E 證據工具 | 不進 runtime |
| Docker 執行 | Linux 181 直接 `docker run`（同 P1），`n_procs` 由 env `CFD_N_PROCS` 上限 | 缺 docker 或映像 → `worker_unavailable`，不得假成功 |

新增環境變數（全部有預設、缺值時功能誠實停用而非崩潰）：`CFD_ENABLED`（預設 false）、`CFD_IMAGE`（預設 `opencfd/openfoam-default:2412`）、`CFD_IMAGE_DIGEST`（有值時與本機映像 RepoDigest 比對，不符即 `worker_unavailable`）、`CFD_N_PROCS`（上限，亦作 docker `--cpus`）、`CFD_MAX_DIRECTIONS`（預設 16）、`CFD_ARTIFACTS_ROOT`（預設 `<artifacts_root>/cfd`）、`CFD_PUBLIC_ARTIFACTS_URL`（預設 `<base_url>/cfd-artifacts`）。streaming 端 `CFD_ENABLED=false` 時 `POST /api/cfd-runs` 回 503 `cfd_disabled`，GET 列表仍可用並回 `enabled:false`；coordinator 端對應回 503，UI 顯示未啟用。寫入路由沿用 `STREAMING_CONVERSION_INTERNAL_TOKEN`（`X-Internal-Conversion-Token`），GET 與 `/cfd-artifacts` 與既有 `/artifacts` 同樣以 loopback 綁定為信任邊界。

## 5. 切片計畫

每切片一個 PR、一個 outcome、可獨立驗收；順序固定，前一切片合併並部署 181 後才開下一個。

| 切片 | Outcome | 主要變更 | DoD（本輪真實證據） |
|---|---|---|---|
| **S0 契約凍結**（本 PR） | 三個 JSON Schema（request／result／ledger-record）＋root 契約測試；設計正本 §04 `c4-cfd-api` 卡；`repository-boundaries.md`、`docs-plans-README.md` 納入；owner 三項裁決寫入 §1 | 只有文件與契約檔。**openapi 路徑不在 S0 手改**：`coordinator-browser-api-v1.openapi.json` 由 coordinator zod 契約生成並有 drift 測試，S2 新增 `cfd.ts` schema 時一併生成 | `pytest tests/test_cfd_contracts.py` 綠；owner 核可 |
| **S1 streaming CFD job service**（已合併 #887） | :49101 可建立、查詢、取消 CFD run，結果檔可下載 | `cfd_pipeline/` 套件搬遷、`cfd_job_service.py`、queue（同時 1）、store、`/cfd-artifacts`、`CFD_*` env | `tests/test_cfd_job_service.py`（fake runner，19 項）＋既有 streaming 全套；本機真 docker 經掛載後的服務跑 1 方向 202→ready，結果通過 `cfd-run-result-v1` schema（證據 `docs/evidence/cfd-s1-2026-09-21/`）；`tools/cfd` CLI 與 42 項工具測試仍可用 |
| **S1.1 自審修正**（PR #889） | 真實輸入下 result 仍符合凍結 schema；取消、重啟、並發、下載白名單有防護 | 失敗方向以契約形狀進 result、原因進 run_record；`first` 不再讀磁碟；`normalize_true_north` 把未知真北映成 `true_north_unknown_assumed_project_north`；`run_case(should_stop)` 輪詢殺容器；`compare_and_set_status` claim／取消；`reconcile_on_start` 重排 queued、孤兒標 `worker_unavailable`；`_create_lock` 同鍵並發只建一 run；`/cfd-artifacts` 白名單（不再供 `run.json`／`request.json`）；run_record 去主機路徑、`status.error` 有界去路徑 | 服務測試 30、工具測試 44、streaming 全套綠；S1.1 程式再跑一次真 docker 1 方向 E2E |
| **S2 coordinator ledger 與路由**（本 PR） | 瀏覽器可經 :8004 建 run、看進度、拿結果與 overlay URL | `cfdRunRoutes.ts`、`cfd.ts` schema、`cfdRunClient`、`cfdRunLedger`、`/review-sessions/{id}/cfd-overlays` binding 註冊、openapi／viewer 型別重生、`CFD_ENABLED`／`CFD_RUN_LEDGER_STORE_PATH` | `tests/cfd-run-routes.test.ts` 8 項（in-process streaming stub，回應驗證 seam enforce）＋coordinator 全套 vitest 綠；POST→ready→overlay binding 於 `stream-config` 可見；`CFD_ENABLED=false` 回 503。真 Kit 載入 overlay 留 S3 |
| **S2.1 coordinator 自審修正** | #888 合併後自審：canonical 審查 session 登記 overlay 會被 `sessionStore` 不變量拒絕且 async handler 未接 `next`（Critical）；overlay `artifact_id` 由 coordinator 以 JS 捨入重算與 streaming Python 捨入在 .5 分歧；zod 多宣告凍結 schema 沒有的 `failure_code`；list `limit` 未套用 ledger；cancel 409／上游 401 未宣告；overlay 讀改寫跨 await | `sessionStore.isModelBinding`：`artifact_role: overlay` 不計入 ready-review 投影（`sourceProjectsExactly`／`sessionMatchesReadyBundle`）；所有 CFD handler 以 `route()` 包裝接 `next`；overlay 直接採上游 `artifact_id`、方向精確相等；寫入前重讀 session；`requested_by.principal` 改由 user auth provider（同 stage-binding）給定，不信任 `x-operator-id`；`cfdRunListQuery`／param schema 移到 `schemas/cfd.ts` 共用；cancel 宣告 409、上游 401/403 對應 502 | `tests/cfd-run-routes.test.ts` 13 項（新增 canonical session overlay、22.5°→`w022`、guard 403、stale detail、limit／409／401→502）；`unit_sessionstore`、`ready-model-session` 綠；openapi／viewer 型別重生 |
| **S3 前端與 Kit 疊圖**（本 PR） | 統一工作台可送出風向、看進度、在 primary viewer 開關 CFD 疊圖 | `WindEnvironmentPanel.tsx`（左欄工具列「風環境」disclosure）＋`cfdClient.ts`（只打 coordinator）；viewer embed 協定新增 console→viewer `apply_stage_binding` 與 viewer→console `stage_binding_result`（`viewerEmbedProtocol.ts`），Window 以既有 `_applyBinding` 交易套用、只在 Kit 確認（openedStageResult／bindingApplied）後回 `applied` 並附 Kit 回報的 `applied_secondary_layers`；`ReviewSessionViewerPane.applyStageBinding` → `ViewportSlotApi.applyStageBinding`；常駐「設計比較用」標示、`assumptions`／`sealing_suspect` 原樣顯示、ProvTag asbuilt | vitest：`WindEnvironmentPanel.test.tsx` 6 項（凍結 request 形狀、輪詢終態、overlay 登記→stage-binding→Kit 確認、409／Kit 失敗／層不在清單皆不宣告載入）、`viewerEmbedProtocol.test.ts` +5；viewer 全套 vitest、tsc、eslint（新檔零警告）。**真 Kit browser E2E（first frame、`applied_secondary_layers` 含 cfd artifact、疊圖截圖）見 PR 驗證段；未在本 PR 完成者明列** |
| **S3.1 CFD 視覺化品質**（本 PR，owner 2026-09-21 追加） | 疊圖能當產品呈現：看得到建物、色階圖例與流線動態 | `usd_results.py`：行人面裁到建物 bbox 外擴 3H、三 prim 同一組固定色階（U 0–5 m/s；p 依本方向建物面上下限）並寫入 run prim `customData cfd:legend`、切面 `displayOpacity 0.6`、流線 `BasisCurves` 管狀 `widths 0.5`；`openfoam_case.py` 種子改為入口垂直格點 `cloud`（預設 240 點、8 列）；新模組 `flow_animation.py`：沿穩態流線平流的粒子動畫（24 fps、10 s、1500 粒子）寫成時間取樣 `UsdGeom.Points`，layer `customLayerData cfd:animation`＋標示「示意動畫，基於穩態解」；Kit `stage_loading`：偵測到 CFD 動畫 layer 即設定 timeline 循環播放並把相機框到 `/World/Elements`（非整個 overlay）；前端面板加色階圖例（U 固定 0–5、p 取 result 的建物面範圍）；`tools/cfd/kit/probe_usdvol_openvdb.py` 實測 UsdVol＋OpenVDB（結果寫回計畫書 §5.5） | tools/cfd pytest、streaming pytest（含 stage composition ＋4）、viewer vitest；Kit headless 截圖（管狀流線、透明切面、粒子三個時間點）；真 Kit WebRTC 驗收已在本機 stack 完成（Playwright＋Chrome：first frame → 顯示疊圖 → coordinator 登記 → stage-binding → Kit `applied_secondary_layers` 含 cfd artifact → 10 秒錄影；本機轉檔器被 ACL 守門擋住，模型以先前真實轉出的 `model.usdc` 註冊為 succeeded job，其餘全走真服務；證據 `docs/evidence/cfd-s3-1-2026-09-21/browser/`）。**透明度滑桿需新增 Kit DataChannel 命令，見 §6 追蹤** |
| **S4 181 部署與 16 風向**（本 PR＝部署接線；真站 run 在合併部署後執行） | 181 上跑完 16 方向並在 UI 檢視 | `scripts/lib/cfd-solver-deploy.ps1`（`Resolve-CfdDeployEnvironment` fail-closed 解析、`Ensure-CfdSolverImage` 缺映像 pull by digest／digest 不符 exit 4、`Set-CfdProcessEnvironment`）；`deploy.ps1` Phase 4b 帶 `CFD_*` 給 host-native conversion，CFD 指紋進 conversion／web-plane runtime signature；`compose.runtime-manager.yml` coordinator `CFD_ENABLED`＋掛載卷上的 `CFD_RUN_LEDGER_STORE_PATH`；`docs/agents/local-verification.md` 列 canonical env 鍵。**canonical env 需 owner 加 `CFD_ENABLED=true`（其餘可用預設）** | `scripts/tests/test-deploy-cfd-solver.ps1`（解析預設／派生 URL／fail-closed／映像 present・pull・mismatch）、`test-deploy-dryrun.ps1` 綠；181 真站 16 方向 run record、Kit 疊圖截圖、Kit 串流未中斷證據於部署後補 |
| **S5 品質** | 網格收斂與基準比對 | 三層網格收斂測試、AIJ 案例 C 比對、`solver_not_converged` 自動延長 endTime 一次 | 收斂曲線與比對表進 evidence；run record 新增 `validation_level` |
| **S6 A1 finding（另案入口）** | CFD 超標轉 issue | coordinator 組 payload 經既有 `/api/issues` | 不在本 P2 授權範圍，列為後續 |

不做：新 Kit 命令、governance 新路由、商用求解器、室內熱對流（`interior-ventilation/v1` 待 S5 後另提）。

## 6. 風險與待 owner 確認

| 項目 | 內容 |
|---|---|
| R-A1 | 求解與 Kit 同機搶 CPU：S4 以 `CFD_N_PROCS` 與 docker `--cpus` 限制，實測 Kit first frame 與 DataChannel ACK 不退化才算過 |
| R-A2 | **已裁決：納入外殼**（§1）；`appendage_policy: included` 進契約 |
| R-A3 | 真北未知：所有結果帶 `assumptions`，P0.2 資料到位前 UI 不得顯示羅盤方位，只顯示「相對 project north」 |
| R-A4 | 45° 等方向 300 步未收斂：S1 預設 `end_time` 600（P1 半徑 4 補跑 285 步收斂），S5 再加自動延長 |
| C-1 | **已裁決：留 streaming job store**（§1） |
| C-2 | **已執行**：S0 直接在 repo 的 `.dc.html` §04 新增 `c4-cfd-api` 卡（HTML 靜態區塊，未改 `support.js`）；上游 design repo 不回寫 |
| overlay 與 canonical session | **agent 裁決（S2.1，2026-09-21，owner 可覆寫）**：CFD overlay binding 是附加的結果圖層，不屬 ready-review 來源投影；`sessionStore` 的「恰一 binding」不變量改為只計 `artifact_role !== "overlay"` 的 model binding。另一選項（overlay 不入 `artifact_bindings`、改在 stage-binding 時組合）需改 runtime authority 的 artifact 解析，未採。POST/DELETE overlay 仍走 conversion control guard，不要求 viewer lease |
| **P0.2 阻塞（S3.1 第 5 項回報）** | 熱流／能耗需要 P0.2 三項輸入，目前 IFC 與抽取器都拿不到：(1) **U 值**：`IfcMaterialLayerSet`／`Pset_*Common.ThermalTransmittance` 在測試 IFC 未填，P0.1 抽取器也未實作材質層讀取；(2) **可開窗**：`IfcWindow` 的 `OperationType`／`Pset_WindowCommon.IsExternal` 與開口面積尚未抽取；(3) **真北**：P0.1 只拿到 `TrueNorth` 預設方向（`true_north_default_direction`），所有結果仍「相對 project north」。**不以假資料做熱流**；S3.1 只做風場視覺化。解除條件：P0.2 抽取器落地並有真 IFC 帶上述屬性 |
| 疊圖透明度滑桿 | S3.1 第 4 項的滑桿需新增 Kit DataChannel 命令（例如 `overlayStyleRequest{prim_path, display_opacity}` → Kit 在 session layer 覆寫 `displayOpacity`）：涉及 `kit-datachannel-v1.schema.json`、`generate:kit-command-vocabulary`、Kit 模組、viewer command channel 與面板；未在本 PR 完成，圖例與相機框選已完成 |
| 洩漏 | **已裁決：12% 接受**，預設門檻 0.15；S1 的 `sealing_check` 沿用 P1 參考半徑 8 的量法 |

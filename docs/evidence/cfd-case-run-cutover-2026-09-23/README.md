# CFD Case Run service cutover：181 前後同請求比對（ADR Verification 4）

`docs/architecture/cfd-case-run-adr.md` §Verification 第 4 項：同一個 `cfd-run-request/v1` 請求在 canonical Linux 181 上跑三次。cutover（PR #913）**前**跑一次（before，部署 `c41d3d7`），**後**跑兩次（after 與 after2，部署 `e2231f0`）。after2 是同版本、同請求的重跑，用來量 run-to-run 變異，作為「在 solver noise 內」的基線。

主機一律寫成 `<canonical-host>`；不含專案名稱、GlobalId、IFC／USDC 檔案。`p` 是 OpenFOAM 不可壓縮求解的 kinematic pressure（m²/s²），不是 Pa。

## 結論

**條件式通過。**

- **VERIFIED**：寫 case 與網格的程式、case 輸入與容器參數在 cutover 前後相同（見下節）；三次 run 都收斂、都沒有延長 endTime，三份 `result.json` 都符合 `cfd-run-result-v1.schema.json`。
- **VERIFIED**：網格格數（840467）與行人面多邊形數（15093）三次相同。跨 cutover 差量不大於同版本重跑差量的指標：`iterations`, `U_magnitude_max`, `p_min`, `PedestrianWind_1p5m.p05`, `PedestrianWind_1p5m.p50`, `PedestrianWind_1p5m.p95`, `max_non_orthogonality`。p_min 的約 11% 跳動在同版本重跑也出現（-19.7265 → -17.7029）。
- **VERIFIED**：下列指標的跨 cutover 差量大於這一次同版本重跑的差量：

| 指標 | 跨 cutover | 同版本重跑 | 跨 cutover 相對差 |
|---|---|---|---|
| `p_max` | 0.009355 | 0.000101 | 0.000794242 |
| `PedestrianWind_1p5m.mean` | 0.000351963 | 0.000314988 | 0.000233747 |
| `BuildingSurfacePressure.p05` | 0.0282356 | 0.00914173 | 0.00397127 |
| `BuildingSurfacePressure.mean` | 0.0125391 | 0.00582739 | 0.00977471 |
| `BuildingSurfacePressure.p50` | 0.0337168 | 0.0293789 | 0.0175511 |
| `BuildingSurfacePressure.p95` | 0.0742201 | 0.0375781 | 0.0097875 |
| `mesh_faces` | 491 | 18 | 0.000189653 |
| `mesh_points` | 509 | 2 | 0.000559673 |
| `max_skewness` | 0.0748108 | 1.53e-05 | 0.0169249 |

- **INFERRED**：這些差異來自平行 snappyHexMesh（4 個程序）的執行期非決定性，建物面的 p 隨網格一起變動。依據是程式與輸入相同，而同版本重跑也產生了不同的網格（面數差 18）。但一次重跑不足以界定這個變異的分佈，所以不能說跨 cutover 的差異已落在其中。若要無條件通過，需要在同版本多跑幾次同請求，量出變異的範圍。

## 程式與輸入（VERIFIED）

- `openfoam_case.py`、`preprocess.py`、`voxel_shell.py`、`profiles.py` 在 `c41d3d7..e2231f0` 之間沒有變更（`git diff --stat` 為空）。變更只在 job service 的組合層（`cfd_job_service.py`、新增的 `case_run.py`）、S8 設定選項（`cfd_options.*`）與 `wind.py`（`true_north_from_geo` 改為公開）。
- 兩個版本的 service 都用 `build_case(shell_stl, out_dir, params)` 寫 case，都以 `cpus = min(n_procs, cpus_cap)` 與同一個 image 設定啟動容器。
- 三次 run 的 `case_meta.json` sha256 都是 `f2d520c6d30d…`；exclusions sha256 都是 `5f0b7def2abd…`；前處理 `leak_fraction` 都是 0.1198。
- 請求：`requests/` 內三份 client 送出的 body 只差 `idempotency_key`；service 正規化後的請求（去掉 `idempotency_key` 與 `requested_by`）兩兩相同。`requested_by.trace_id` 不同：before 與 after2 送出時帶了 `x-trace-id`（`adr_caserun_before_20260923`、`adr_caserun_after2_20260923`），after 沒帶，由 coordinator 產生 `trace_cfd_…`。trace id 不進入求解。

## 部署版本（`deploy.json`）

| run | run_id | 部署 commit | 建立 | 開始 | 結束 |
|---|---|---|---|---|---|
| before | `cfd_20260923T074903Z_c57d8f` | `c41d3d7` | 2026-09-23T07:49:03Z | 2026-09-23T09:45:01Z | 2026-09-23T09:49:51Z |
| after | `cfd_20260923T095259Z_b78b07` | `e2231f0` | 2026-09-23T09:52:59Z | 2026-09-23T09:52:59Z | 2026-09-23T09:57:49Z |
| after2 | `cfd_20260923T104759Z_669057` | `e2231f0` | 2026-09-23T10:47:59Z | 2026-09-23T10:47:59Z | 2026-09-23T10:52:53Z |

- `deploy-20260923-639257387033841434-004` → `c41d3d7`，部署於 2026-09-23T05:38:23Z。
- `deploy-20260923-639257539422368286-005` → `e2231f0`，部署於 2026-09-23T09:52:22Z。
- before 在 `-004` 與 `-005` 之間執行；after 與 after2 都在 `-005` 之後，且 capture after2 時沒有更晚的部署 tag。before 在佇列裡等了約兩小時，因為前面有一個 15 方向的 run。

## 同版本重跑基線（`noise_baseline.json`）

「跨 cutover」是 |before − after|，「同版本重跑」是 |after − after2|。
「跨 cutover ≤ 重跑」只和這一次重跑比較，不是統計檢定。

| 指標 | before | after | after2 | 跨 cutover | 同版本重跑 | 跨 cutover ≤ 重跑 |
|---|---|---|---|---|---|---|
| iterations | 322 | 324 | 322 | 2 | 2 | 是 |
| mesh_cells | 840467 | 840467 | 840467 | 0 | 0 | 是 |
| mesh_faces | 2588936 | 2588445 | 2588463 | 491 | 18 | **否** |
| mesh_points | 909460 | 908951 | 908949 | 509 | 2 | **否** |
| max_non_orthogonality | 64.7237 | 64.7157 | 64.7238 | 0.00798 | 0.008084 | 是 |
| max_skewness | 4.42016 | 4.34535 | 4.34533 | 0.0748108 | 1.53e-05 | **否** |
| U_magnitude_max | 3.61995 | 3.62076 | 3.62664 | 0.000813969 | 0.00588281 | 是 |
| pedestrian_polygons | 15093 | 15093 | 15093 | 0 | 0 | 是 |
| p_min | -17.7344 | -19.7265 | -17.7029 | 1.99202 | 2.02352 | 是 |
| p_max | 11.7785 | 11.7879 | 11.788 | 0.009355 | 0.000101 | **否** |
| solver_elapsed_seconds | 263.9 | 262.7 | 261.5 | 1.2 | 1.2 | 是 |
| job_wall_seconds | 290 | 290 | 294 | 0 | 4 | 是 |

`solver_elapsed_seconds` 是容器內求解的時間；`job_wall_seconds` 是整個 job（含前處理與後處理）從開始到結束的時間。

## 場量統計（overlay layer 全場，`field_stats.json`）

三份 overlay USDC（未入版控）用 pxr 讀出 `PedestrianWind_1p5m` 的 |U|（m/s，每個頂點一個值）與 `BuildingSurfacePressure` 的 p（m²/s²，每個面一個值，`uniform`）。取樣面的頂點數或面數在三次之間差 1 到 4，所以只比分佈，不做逐點差。

| prim | 統計 | before | after | after2 | 跨 cutover | 同版本重跑 |
|---|---|---|---|---|---|---|
| PedestrianWind_1p5m | n | 15694 | 15693 | 15694 | 1 | 1 |
| PedestrianWind_1p5m | faces | 15093 | 15093 | 15093 | 0 | 0 |
| PedestrianWind_1p5m | points | 15694 | 15693 | 15694 | 1 | 1 |
| PedestrianWind_1p5m | min | 0 | 0 | 0 | 0 | 0 |
| PedestrianWind_1p5m | p05 | 0.632008 | 0.632438 | 0.631797 | 0.000429231 | 0.000640571 |
| PedestrianWind_1p5m | mean | 1.50575 | 1.5061 | 1.50578 | 0.000351963 | 0.000314988 |
| PedestrianWind_1p5m | p50 | 1.54065 | 1.54068 | 1.54064 | 3.08752e-05 | 3.12924e-05 |
| PedestrianWind_1p5m | p95 | 2.0952 | 2.09511 | 2.09538 | 8.55327e-05 | 0.000266838 |
| PedestrianWind_1p5m | max | 3.61995 | 3.62076 | 3.62664 | 0.000813961 | 0.00588274 |
| BuildingSurfacePressure | n | 4196 | 4195 | 4199 | 1 | 4 |
| BuildingSurfacePressure | faces | 4196 | 4195 | 4199 | 1 | 4 |
| BuildingSurfacePressure | points | 4677 | 4679 | 4680 | 2 | 1 |
| BuildingSurfacePressure | min | -17.7344 | -19.7265 | -17.7029 | 1.99202 | 2.02352 |
| BuildingSurfacePressure | p05 | -7.10996 | -7.13819 | -7.12905 | 0.0282356 | 0.00914173 |
| BuildingSurfacePressure | mean | -1.28281 | -1.29534 | -1.28952 | 0.0125391 | 0.00582739 |
| BuildingSurfacePressure | p50 | -1.92107 | -1.88735 | -1.91673 | 0.0337168 | 0.0293789 |
| BuildingSurfacePressure | p95 | 7.58316 | 7.50894 | 7.54652 | 0.0742201 | 0.0375781 |
| BuildingSurfacePressure | max | 11.7785 | 11.7879 | 11.788 | 0.00935555 | 0.000101089 |

## 文件結構差異（after 部署包含的 S8 變更）

- `result.json` 頂層鍵：三次相同。
- `status.json` 的 status 文件：after 多了 `estimate_at_submission`, `settings_profile`。
- `status.json` 的 `ledger.origin`：after 多了 `preset_match`, `true_north_degrees_manual`, `true_north_source`, `z0_m`, `zref_m`。
- `run_record.json` 頂層：after 多了 `settings`。
- `limitations`：after 多了 1 行：「Settings differ from the verified standard preset (mesh.background_cell_m); the run is not directly comparable with standard-preset runs and remains a screening result.」。
- **INFERRED**：這些差異都來自同一次部署所含的 S8 設定選項（#911、#912），與 cutover 無關。依據是程式註解把它們標為 S8，且 cutover 不改文件格式。after 的 limitations 那一行也說明，這個請求的 `mesh.background_cell_m` 偏離 standard preset。

## Schema

- `before/result.json` 對 `tests/contracts/cfd-run-result-v1.schema.json`：0 errors（驗的是主機已遮蔽的版本）。
- `after/result.json` 對 `tests/contracts/cfd-run-result-v1.schema.json`：0 errors（驗的是主機已遮蔽的版本）。
- `after2/result.json` 對 `tests/contracts/cfd-run-result-v1.schema.json`：0 errors（驗的是主機已遮蔽的版本）。

## 已知限制

- 只跑了 0° 一個方向，而且不是 standard preset（`mesh.background_cell_m` 6 m），所以沒有涵蓋自動延長 endTime、多方向的 `stop_on`、失敗分類與 standard preset。
- 三次 run 的 `run_record.json` 內 `preprocess.shell.sealing_suspect` 都是 true（profile 門檻 0.10），`result.json` 頂層 `preprocess.sealing_suspect` 都是 false（請求門檻 0.15）。這是 ADR Context 記錄的既有漂移；bullet 4（#918）已把兩者統一，但這三次 run 都在那之前的版本上執行。
- 三次的 checkMesh 都回報 `mesh_ok: false`、`failed_checks: 1`，這是這個模型與 6 m 背景格既有的網格品質狀態，cutover 前後相同。

## 檔案

- `before/`、`after/`、`after2/`：`status.json`（coordinator `GET /api/cfd/runs/{id}`）、`result.json`（`GET …/result`）、`run_record.json`、`exclusions.json`。
- `exclusions.json` 是公開 repo 版本，保留欄位：`note`, `schema`, `profile`, `source_model_usdc_sha256`, `outlier_rule`, `counts`, `item_count`, `ifc_types_excluded`, `served_document_sha256_per_result_json`。`outlier_rule` 內的 `core_box`／`expanded_box` 是模型局部座標，不是地理座標。逐元素的 `items`（IFC GlobalId）已移除；`served_document_sha256_per_result_json` 等於同資料夾 `result.json` 的 `exclusions.sha256`。
- `requests/`：三份 client 送出的請求 body。
- `deploy.json`：部署 tag、commit 與三次 run 的時間。
- `compare.json`（before 對 after）、`compare_after_after2.json`（after 對 after2；該檔的 `before`／`after` 欄位分別是 after／after2）：請求相等性、每向指標、schema 驗證與鍵差異。
- `noise_baseline.json`：三次 run 的指標與兩組差量。`field_stats.json`：三份 overlay 的分佈統計。
- `tools/`：產生以上檔案的腳本。coordinator 位址由必填的環境變數 `CFD_COORDINATOR_BASE` 提供；`render_readme.py` 從上列 JSON 產生本檔。

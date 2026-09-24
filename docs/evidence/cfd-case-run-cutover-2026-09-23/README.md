# CFD Case Run service cutover：181 前後同請求比對（ADR Verification 4）

`docs/architecture/cfd-case-run-adr.md` §Verification 第 4 項：同一個 `cfd-run-request/v1` 請求在 canonical Linux 181 上跑 6 次。cutover（PR #913）**前**跑一次（before，部署 `c41d3d7`），**後**在同一個部署 `e2231f0` 上跑 5 次（after、after2、after3、after4、after5）。after 與 after2 在 2026-09-23 執行；after3、after4、after5 在 2026-09-24 補跑，用來界定同版本、同請求的 run-to-run 變異，作為「在 solver noise 內」的基線。

主機一律寫成 `<canonical-host>`；不含專案名稱、GlobalId、IFC／USDC 檔案。`p` 是 OpenFOAM 不可壓縮求解的 kinematic pressure（m²/s²），不是 Pa。

## 結論

**條件式通過。**

- **VERIFIED**：寫 case 與網格的程式、case 輸入與容器參數在 cutover 前後相同（見下節）；6 次 run 都收斂、都沒有延長 endTime，6 份 `result.json` 都符合 `cfd-run-result-v1.schema.json`。
- **VERIFIED**：判準在取得 after3 之前訂定（`noise_baseline.json` 的 `criterion`）：|before − 同版本中位數| ≤ 同版本全距（max − min），同版本共 5 次。這是描述性的判準，不是統計檢定；它界定的是這個請求在這台主機上觀察到的變異範圍。
- **VERIFIED**：10 個指標符合判準；下列 6 個不符合：`U_magnitude_max`、`p_max`、`BuildingSurfacePressure.p05`、`BuildingSurfacePressure.mean`、`BuildingSurfacePressure.p95`、`max_skewness`。
- **VERIFIED**：網格格數（840467）6 次都相同；行人面多邊形數在 6 次之間不同（同版本全距 2）。同版本的 5 次 run 之間，網格面數相差最多 1212、點數最多 1196；before 的面數與點數都符合判準。
- **VERIFIED**：6 次 run 記錄的求解 image digest（`opencfd/openfoam-default:2412`）、`n_procs`（4）、前處理的全部統計與 `case_meta.json` sha256 都相同。`run_record` 沒有記錄其餘 case 檔的 sha256，也沒有記錄主機的執行條件。
- **INFERRED**：不符合判準的指標中，同版本 5 次彼此非常接近，before 卻落在範圍外；差距最大的是 `max_skewness`，before 與中位數的距離是同版本全距的 1692.9 倍。這比較像 before 與 after 之間的系統性差異，而不是同版本也會出現的 run-to-run 變異。現有紀錄無法確認原因；上一點列出的已記錄項目都相同，所以原因不在這些項目裡。相對差見下表：網格指標最大 0.0172199，解的指標最大 0.0052575。
- 所以結論維持條件式通過：契約與 case 輸入不變，大部分指標落在同版本變異內；列為「否」的指標，不能宣稱在 solver noise 內。

| 指標 | before | 同版本中位數 | 同版本全距 | \|before − 中位數\| | 距離／全距 | 相對差 | 符合判準 | 落在 [min, max] |
|---|---|---|---|---|---|---|---|---|
| `iterations` | 322 | 322 | 2 | 0 | 0 | 0 | 是 | 是 |
| `U_magnitude_max` | 3.61995 | 3.626 | 0.0058921 | 0.00605238 | 1.0272 | 0.00166916 | **否** | **否** |
| `p_min` | -17.7344 | -17.7036 | 2.02352 | 0.030796 | 0.015219 | 0.00173953 | 是 | 是 |
| `p_max` | 11.7785 | 11.7883 | 0.00057 | 0.009801 | 17.1947 | 0.000831416 | **否** | **否** |
| `PedestrianWind_1p5m.p05` | 0.632008 | 0.631797 | 0.000709021 | 0.00021134 | 0.298073 | 0.000334506 | 是 | 是 |
| `PedestrianWind_1p5m.mean` | 1.50575 | 1.50579 | 0.000369618 | 4.41963e-05 | 0.119573 | 2.93509e-05 | 是 | 是 |
| `PedestrianWind_1p5m.p50` | 1.54065 | 1.54064 | 4.37498e-05 | 1.43051e-06 | 0.0326975 | 9.28515e-07 | 是 | 是 |
| `PedestrianWind_1p5m.p95` | 2.0952 | 2.09535 | 0.000266838 | 0.000158393 | 0.593594 | 7.55927e-05 | 是 | 是 |
| `BuildingSurfacePressure.p05` | -7.10996 | -7.12908 | 0.00932837 | 0.0191211 | 2.04979 | 0.00268213 | **否** | **否** |
| `BuildingSurfacePressure.mean` | -1.28281 | -1.28959 | 0.00582739 | 0.00678 | 1.16347 | 0.0052575 | **否** | **否** |
| `BuildingSurfacePressure.p50` | -1.92107 | -1.91748 | 0.0313853 | 0.00358748 | 0.114305 | 0.00187093 | 是 | **否** |
| `BuildingSurfacePressure.p95` | 7.58316 | 7.54439 | 0.0386719 | 0.0387698 | 1.00253 | 0.00513889 | **否** | **否** |
| `mesh_faces` | 2588936 | 2588463 | 1212 | 473 | 0.390264 | 0.000182734 | 是 | **否** |
| `mesh_points` | 909460 | 908951 | 1196 | 509 | 0.425585 | 0.000559986 | 是 | **否** |
| `max_non_orthogonality` | 64.7237 | 64.7238 | 0.008092 | 0.000108 | 0.0133465 | 1.66863e-06 | 是 | 是 |
| `max_skewness` | 4.42016 | 4.34533 | 4.42e-05 | 0.0748261 | 1692.9 | 0.0172199 | **否** | **否** |

## 程式與輸入（VERIFIED）

- `openfoam_case.py`、`preprocess.py`、`voxel_shell.py`、`profiles.py` 在 `c41d3d7..e2231f0` 之間沒有變更（`git diff --stat` 為空）。變更只在 job service 的組合層（`cfd_job_service.py`、新增的 `case_run.py`）、S8 設定選項（`cfd_options.*`）與 `wind.py`（`true_north_from_geo` 改為公開）。
- 兩個版本的 service 都用 `build_case(shell_stl, out_dir, params)` 寫 case，都以 `cpus = min(n_procs, cpus_cap)` 與同一個 image 設定啟動容器。
- 6 次 run 的 `case_meta.json` sha256 都是 `f2d520c6d30d…`；exclusions sha256 都是 `5f0b7def2abd…`；前處理 `leak_fraction` 都是 0.1198。
- 請求：`requests/` 內 6 份 client 送出的 body 只差 `idempotency_key`；service 正規化後的請求（去掉 `idempotency_key` 與 `requested_by`）兩兩相同。`requested_by.trace_id` 不同：before、after2、after3、after4、after5 送出時帶了 `x-trace-id`，after 沒帶，由 coordinator 產生 `trace_cfd_…`。trace id 不進入求解。

## 部署版本（`deploy.json`）

| run | run_id | 部署 commit | 建立 | 開始 | 結束 |
|---|---|---|---|---|---|
| before | `cfd_20260923T074903Z_c57d8f` | `c41d3d7` | 2026-09-23T07:49:03Z | 2026-09-23T09:45:01Z | 2026-09-23T09:49:51Z |
| after | `cfd_20260923T095259Z_b78b07` | `e2231f0` | 2026-09-23T09:52:59Z | 2026-09-23T09:52:59Z | 2026-09-23T09:57:49Z |
| after2 | `cfd_20260923T104759Z_669057` | `e2231f0` | 2026-09-23T10:47:59Z | 2026-09-23T10:47:59Z | 2026-09-23T10:52:53Z |
| after3 | `cfd_20260924T022552Z_d4f350` | `e2231f0` | 2026-09-24T02:25:52Z | 2026-09-24T02:25:52Z | 2026-09-24T02:30:46Z |
| after4 | `cfd_20260924T023053Z_f99a12` | `e2231f0` | 2026-09-24T02:30:53Z | 2026-09-24T02:30:53Z | 2026-09-24T02:35:48Z |
| after5 | `cfd_20260924T023554Z_7629fc` | `e2231f0` | 2026-09-24T02:35:54Z | 2026-09-24T02:35:54Z | 2026-09-24T02:40:49Z |

- `deploy-20260923-639257387033841434-004` → `c41d3d7`，部署於 2026-09-23T05:38:23Z。
- `deploy-20260923-639257539422368286-005` → `e2231f0`，部署於 2026-09-23T09:52:22Z。
- before 在 `-004` 與 `-005` 之間執行；after、after2、after3、after4、after5 都在 `-005` 之後，且 capture after5 時沒有更晚的部署 tag。before 在佇列裡等了約兩小時，因為前面有一個 15 方向的 run。

## 同版本重跑基線（`noise_baseline.json`）

「全距」是同版本各次的 max − min；「\|before − 中位數\|」是 before 與同版本中位數的距離。

| 指標 | before | after | after2 | after3 | after4 | after5 | 全距 | \|before − 中位數\| |
|---|---|---|---|---|---|---|---|---|
| iterations | 322 | 324 | 322 | 322 | 322 | 322 | 2 | 0 |
| mesh_cells | 840467 | 840467 | 840467 | 840467 | 840467 | 840467 | 0 | 0 |
| mesh_faces | 2588936 | 2588445 | 2588463 | 2587396 | 2588585 | 2588608 | 1212 | 473 |
| mesh_points | 909460 | 908951 | 908949 | 907883 | 909051 | 909079 | 1196 | 509 |
| max_non_orthogonality | 64.7237 | 64.7157 | 64.7238 | 64.7238 | 64.7238 | 64.7238 | 0.008092 | 0.000108 |
| max_skewness | 4.42016 | 4.34535 | 4.34533 | 4.34538 | 4.34533 | 4.34533 | 4.42e-05 | 0.0748261 |
| U_magnitude_max | 3.61995 | 3.62076 | 3.62664 | 3.626 | 3.62665 | 3.62589 | 0.0058921 | 0.00605238 |
| pedestrian_polygons | 15093 | 15093 | 15093 | 15093 | 15091 | 15093 | 2 | 0 |
| p_min | -17.7344 | -19.7265 | -17.7029 | -17.7057 | -17.7036 | -17.7034 | 2.02352 | 0.030796 |
| p_max | 11.7785 | 11.7879 | 11.788 | 11.7884 | 11.7884 | 11.7883 | 0.00057 | 0.009801 |
| solver_elapsed_seconds | 263.9 | 262.7 | 261.5 | 261.8 | 262.7 | 262.5 | 1.2 | 1.4 |
| job_wall_seconds | 290 | 290 | 294 | 294 | 295 | 295 | 5 | 4 |

`solver_elapsed_seconds` 是容器內求解的時間；`job_wall_seconds` 是整個 job（含前處理與後處理）從開始到結束的時間。兩者隨主機負載變動，不列入判準。

## 場量統計（overlay layer 全場，`field_stats.json`）

6 份 overlay USDC（未入版控）用 pxr 讀出 `PedestrianWind_1p5m` 的 |U|（m/s，每個頂點一個值）與 `BuildingSurfacePressure` 的 p（m²/s²，每個面一個值，`uniform`）。取樣面的頂點數或面數在各次之間略有差異，所以只比分佈，不做逐點差。

| prim | 統計 | before | after | after2 | after3 | after4 | after5 | 全距 | \|before − 中位數\| |
|---|---|---|---|---|---|---|---|---|---|
| PedestrianWind_1p5m | n | 15694 | 15693 | 15694 | 15694 | 15691 | 15694 | 3 | 0 |
| PedestrianWind_1p5m | faces | 15093 | 15093 | 15093 | 15093 | 15091 | 15093 | 2 | 0 |
| PedestrianWind_1p5m | points | 15694 | 15693 | 15694 | 15694 | 15691 | 15694 | 3 | 0 |
| PedestrianWind_1p5m | min | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| PedestrianWind_1p5m | p05 | 0.632008 | 0.632438 | 0.631797 | 0.631832 | 0.631729 | 0.631748 | 0.000709021 | 0.00021134 |
| PedestrianWind_1p5m | mean | 1.50575 | 1.5061 | 1.50578 | 1.50579 | 1.50573 | 1.50579 | 0.000369618 | 4.41963e-05 |
| PedestrianWind_1p5m | p50 | 1.54065 | 1.54068 | 1.54064 | 1.54064 | 1.54063 | 1.54064 | 4.37498e-05 | 1.43051e-06 |
| PedestrianWind_1p5m | p95 | 2.0952 | 2.09511 | 2.09538 | 2.09536 | 2.09535 | 2.09535 | 0.000266838 | 0.000158393 |
| PedestrianWind_1p5m | max | 3.61995 | 3.62076 | 3.62664 | 3.626 | 3.62665 | 3.62589 | 0.00589204 | 0.00605226 |
| BuildingSurfacePressure | n | 4196 | 4195 | 4199 | 4199 | 4199 | 4199 | 4 | 3 |
| BuildingSurfacePressure | faces | 4196 | 4195 | 4199 | 4199 | 4199 | 4199 | 4 | 3 |
| BuildingSurfacePressure | points | 4677 | 4679 | 4680 | 4680 | 4680 | 4680 | 1 | 3 |
| BuildingSurfacePressure | min | -17.7344 | -19.7265 | -17.7029 | -17.7057 | -17.7036 | -17.7034 | 2.02352 | 0.0307961 |
| BuildingSurfacePressure | p05 | -7.10996 | -7.13819 | -7.12905 | -7.13072 | -7.12908 | -7.12887 | 0.00932837 | 0.0191211 |
| BuildingSurfacePressure | mean | -1.28281 | -1.29534 | -1.28952 | -1.28955 | -1.2896 | -1.28959 | 0.00582739 | 0.00678 |
| BuildingSurfacePressure | p50 | -1.92107 | -1.88735 | -1.91673 | -1.91874 | -1.91849 | -1.91748 | 0.0313853 | 0.00358748 |
| BuildingSurfacePressure | p95 | 7.58316 | 7.50894 | 7.54652 | 7.53996 | 7.54761 | 7.54439 | 0.0386719 | 0.0387698 |
| BuildingSurfacePressure | max | 11.7785 | 11.7879 | 11.788 | 11.7884 | 11.7884 | 11.7883 | 0.000569344 | 0.00980091 |

## 文件結構差異（after 部署包含的 S8 變更）

- `result.json` 頂層鍵：6 次相同。
- `status.json` 的 status 文件：after 多了 `estimate_at_submission`, `settings_profile`。
- `status.json` 的 `ledger.origin`：after 多了 `preset_match`, `true_north_degrees_manual`, `true_north_source`, `z0_m`, `zref_m`。
- `run_record.json` 頂層：after 多了 `settings`。
- `limitations`：after 多了 1 行：「Settings differ from the verified standard preset (mesh.background_cell_m); the run is not directly comparable with standard-preset runs and remains a screening result.」。
- **INFERRED**：這些差異都來自同一次部署所含的 S8 設定選項（#911、#912），與 cutover 無關。依據是程式註解把它們標為 S8，且 cutover 不改文件格式。after 的 limitations 那一行也說明，這個請求的 `mesh.background_cell_m` 偏離 standard preset。

## Schema

- `before/result.json` 對 `tests/contracts/cfd-run-result-v1.schema.json`：0 errors（驗的是主機已遮蔽的版本）。
- `after/result.json` 對 `tests/contracts/cfd-run-result-v1.schema.json`：0 errors（驗的是主機已遮蔽的版本）。
- `after2/result.json` 對 `tests/contracts/cfd-run-result-v1.schema.json`：0 errors（驗的是主機已遮蔽的版本）。
- `after3/result.json` 對 `tests/contracts/cfd-run-result-v1.schema.json`：0 errors（驗的是主機已遮蔽的版本）。
- `after4/result.json` 對 `tests/contracts/cfd-run-result-v1.schema.json`：0 errors（驗的是主機已遮蔽的版本）。
- `after5/result.json` 對 `tests/contracts/cfd-run-result-v1.schema.json`：0 errors（驗的是主機已遮蔽的版本）。

## 已知限制

- 只跑了 0° 一個方向，而且不是 standard preset（`mesh.background_cell_m` 6 m），所以沒有涵蓋自動延長 endTime、多方向的 `stop_on`、失敗分類與 standard preset。
- 6 次 run 的 `run_record.json` 內 `preprocess.shell.sealing_suspect` 都是 true（profile 門檻 0.10），`result.json` 頂層 `preprocess.sealing_suspect` 都是 false（請求門檻 0.15）。這是 ADR Context 記錄的既有漂移；bullet 4（#918）已把兩者統一，但這 6 次 run 都在那之前的版本上執行。
- 6 次的 checkMesh 都回報 `mesh_ok: false`、`failed_checks: 1`，這是這個模型與 6 m 背景格既有的網格品質狀態，cutover 前後相同。
- 同版本只有 5 次，全距會隨次數增加而變大；判準界定的是觀察到的範圍，不是變異的上限。

## 檔案

- `before/`、`after/`、`after2/`、`after3/`、`after4/`、`after5/`：`status.json`（coordinator `GET /api/cfd/runs/{id}`）、`result.json`（`GET …/result`）、`run_record.json`、`exclusions.json`。
- `exclusions.json` 是公開 repo 版本，保留欄位：`note`, `schema`, `profile`, `source_model_usdc_sha256`, `outlier_rule`, `counts`, `item_count`, `ifc_types_excluded`, `served_document_sha256_per_result_json`。`outlier_rule` 內的 `core_box`／`expanded_box` 是模型局部座標，不是地理座標。逐元素的 `items`（IFC GlobalId）已移除；`served_document_sha256_per_result_json` 等於同資料夾 `result.json` 的 `exclusions.sha256`。
- `requests/`：6 份 client 送出的請求 body。
- `deploy.json`：部署 tag、commit 與 6 次 run 的時間。
- `compare.json`（before 對 after）與 `compare_after_after2.json`、`compare_after_after3.json`、`compare_after_after4.json`、`compare_after_after5.json`（after 對其他同版本 run；這些檔的 `before`／`after` 欄位分別是 after 與該次 run）：請求相等性、每向指標、schema 驗證與鍵差異。
- `noise_baseline.json`：6 次 run 的指標、同版本中位數與全距，以及判準結果。`field_stats.json`：6 份 overlay 的分佈統計。
- `tools/`：產生以上檔案的腳本。coordinator 位址由必填的環境變數 `CFD_COORDINATOR_BASE` 提供；`render_readme.py` 從上列 JSON 產生本檔，並在寫入前檢查每一句關於全部 run 的敘述。

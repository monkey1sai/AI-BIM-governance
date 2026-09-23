# CFD Case Run service cutover：181 前後同請求比對（ADR Verification 4）

ADR：`docs/architecture/cfd-case-run-adr.md` §Verification 第 4 項。同一個 `cfd-run-request/v1` 請求體（只換 `idempotency_key`）在 canonical Linux 181 於 service cutover **前**（部署版本 `c41d3d7`，PR #913 之前）與**後**（部署版本 `e2231f0`，含 PR #913；deploy tag `deploy-20260923-639257539422368286-005`）各跑一次；比較 `result.json`、run record 與 exclusions 的數值與 sha256。

主機名稱一律以 `<canonical-host>` 取代；不含專案名稱、GlobalId、IFC／USDC 檔案。

## 判讀

- **相同（VERIFIED，見下表）**：請求體（去 `idempotency_key`）相同；兩次皆 `ready`、皆以 residualControl 判定收斂；網格 840,467 格相同；exclusions sha256 相同；前處理 `leak_fraction` 0.1198 相同；兩份 `result.json` 皆通過 `cfd-run-result-v1.schema.json`，頂層鍵集合相同；solve 牆鐘時間皆 4.8 分鐘。
- **在 solver noise 內（VERIFIED）**：行人面 |U| max 相對差 2.2e-4；分佈 p05／mean／p50／p95 差 ≤ 4.3e-4 m/s。建物面 p max 相對差 7.9e-4；p05／mean／p50／p95 差 ≤ 0.08 Pa。迭代數 322 vs 324。
- **唯一超出千分位的差**：`p_min` −17.73 → −19.73 Pa（相對 11%）。它是 4,196／4,195 個面片中的單一極值，其餘分位全部一致；兩次都在 residualControl 判定收斂當下停止（322 vs 324 步），分離角落的極值對停止時機最敏感。**判為 solver noise 而非 cutover 造成的系統性差異，此為推論（INFERRED）**：沒有第三次同版本 run 量化 noise 基線。
- 取樣面頂點數差 1（15,694 vs 15,693；建物面 4,196 vs 4,195），多邊形數 15,093 相同，因此不做逐點差、只比分佈。
- 文件結構差異（run record 新增 `settings`、limitations 第 4 行）來自同一部署所含的 #912，與 cutover 無關。

**結論**：ADR Verification 第 4 項通過——service cutover 後，同請求在 canonical Linux 上的結果與 cutover 前在 solver noise 內一致，`cfd-run-result/v1` 契約不變。

## 兩次 run

| | before | after |
|---|---|---|
| run_id | `cfd_20260923T074903Z_c57d8f` | `cfd_20260923T095259Z_b78b07` |
| status | `ready` | `ready` |
| created_at | `2026-09-23T07:49:03Z` | `2026-09-23T09:52:59Z` |
| started_at | `2026-09-23T09:45:01Z` | `2026-09-23T09:52:59Z` |
| finished_at | `2026-09-23T09:49:51Z` | `2026-09-23T09:57:49Z` |
| converged_count | `1` | `1` |
| sealing_suspect | `False` | `False` |
| leak_fraction | `0.1198` | `0.1198` |
| validation_level | `screening` | `screening` |
| run_record sha256 | `88f82834a0971f6623607962d5563908f5d8d474c6b846c2010b0515aaf7e077` | `a345d6b31d47d6f47bf24c376c34205f612003afb3bb3a97e3e6af508c2b2a74` |
| exclusions sha256 | `5f0b7def2abdbd998472406c045543ab56d76e49daccfa0c63b0abc3c2e8effc` | `5f0b7def2abdbd998472406c045543ab56d76e49daccfa0c63b0abc3c2e8effc` |
| solve wall time (started→finished) | 4.8 min | 4.8 min |
| exclusion counts | `{"class_excluded": 454, "outlier": 39}` | `{"class_excluded": 454, "outlier": 39}` |

請求體（去掉 `idempotency_key`／`requested_by`）相同：**True**

## 每個風向的指標

| wind | 欄位 | before | after | 相對差 |
|---|---|---|---|---|
| 0 | status | `ready` | `ready` | — |
| 0 | converged_by_residual_control | `True` | `True` | — |
| 0 | iterations | `322` | `324` | 6.21e-03 |
| 0 | end_time_extended_to | `—` | `—` | — |
| 0 | mesh_cells | `840467` | `840467` | 0.00e+00 |
| 0 | U_magnitude_max | `3.61995` | `3.62076` | 2.25e-04 |
| 0 | polygons | `15093` | `15093` | 0.00e+00 |
| 0 | p_min | `-17.7344` | `-19.7265` | 1.12e-01 |
| 0 | p_max | `11.7785` | `11.7879` | 7.94e-04 |
| 0 | overlay_sha256 | `857716af618fedf71698b229a4a35ad224c85398923da21f83c0dfdaebe45bc8` | `0bf6fb844a10c48b5ece16ae3032274925ef25ca2cab789bbad5ab0962fdc515` | — |

## 場量統計（overlay layer 全場，不只極值）

兩次 run 的 overlay layer（USDC，未入版控）以 pxr 讀出 `PedestrianWind_1p5m` 的 `U_magnitude` 與 `BuildingSurfacePressure` 的 `p`，比較整個分佈與逐點差（拓樸相同時）。

| prim | 欄位 | before | after |
|---|---|---|---|
| PedestrianWind_1p5m | n | `15694` | `15693` |
| PedestrianWind_1p5m | min | `0` | `0` |
| PedestrianWind_1p5m | p05 | `0.632008` | `0.632438` |
| PedestrianWind_1p5m | mean | `1.50575` | `1.5061` |
| PedestrianWind_1p5m | p50 | `1.54065` | `1.54068` |
| PedestrianWind_1p5m | p95 | `2.0952` | `2.09511` |
| PedestrianWind_1p5m | max | `3.61995` | `3.62076` |
| PedestrianWind_1p5m | 拓樸相同／點座標相同 | `False` | `False` |
| BuildingSurfacePressure | n | `4196` | `4195` |
| BuildingSurfacePressure | min | `-17.7344` | `-19.7265` |
| BuildingSurfacePressure | p05 | `-7.10996` | `-7.13819` |
| BuildingSurfacePressure | mean | `-1.28281` | `-1.29534` |
| BuildingSurfacePressure | p50 | `-1.92107` | `-1.88735` |
| BuildingSurfacePressure | p95 | `7.58316` | `7.50894` |
| BuildingSurfacePressure | max | `11.7785` | `11.7879` |
| BuildingSurfacePressure | 拓樸相同／點座標相同 | `False` | `False` |

## after 部署包含的其他變更

before 版本 `c41d3d7` 早於 #908；after 版本 `e2231f0` 除 cutover（#913）外還含 #908（ADR 文件）、#910（CFD Case Run 模組，尚未被 service 使用）、#911／#912（S8 設定選項與估算：run record 新增 `settings`、limitations 多一行 standard preset 比較）、#914／#915（部署腳本）。上述文件差異歸因於 #912，與 cutover 無關；`result.json` 頂層鍵集合前後相同。

## Schema 與文件結構

- `before/result.json` 對 `tests/contracts/cfd-run-result-v1.schema.json`：通過（0 errors）
- `after/result.json` 對 `tests/contracts/cfd-run-result-v1.schema.json`：通過（0 errors）
- result 頂層鍵：after 新增 `[]`，after 移除 `[]`
- `before` run_record 頂層鍵：`['assumptions', 'created_at_utc', 'directions', 'geo_reference', 'limitations', 'operator', 'preprocess', 'purpose', 'run_id', 'schema', 'source', 'validation_level', 'weather']`
- `before` run_record.directions[] 鍵：`[['case', 'mesh', 'outputs', 'solver', 'status', 'wind_from_degrees']]`
- `before` run_record solver 摘要：`[{"iterations": 322, "converged_by_residual_control": true, "end_time_effective": 600, "extended_once": false, "exit_code": 0}]`
- `after` run_record 頂層鍵：`['assumptions', 'created_at_utc', 'directions', 'geo_reference', 'limitations', 'operator', 'preprocess', 'purpose', 'run_id', 'schema', 'settings', 'source', 'validation_level', 'weather']`
- `after` run_record.directions[] 鍵：`[['case', 'mesh', 'outputs', 'solver', 'status', 'wind_from_degrees']]`
- `after` run_record solver 摘要：`[{"iterations": 324, "converged_by_residual_control": true, "end_time_effective": 600, "extended_once": false, "exit_code": 0}]`

## assumptions / limitations

- `before` assumptions：`["true_north_unknown_assumed_project_north"]`
- `before` limitations：`["Results are for design comparison only; not a regulatory or certification basis.", "Coarse proof-of-concept mesh; no grid-convergence study.", "Wind direction is relative to project north because the IFC TrueNorth is the default direction or missing."]`
- `after` assumptions：`["true_north_unknown_assumed_project_north"]`
- `after` limitations：`["Results are for design comparison only; not a regulatory or certification basis.", "Coarse proof-of-concept mesh; no grid-convergence study.", "Wind direction is relative to project north because the IFC TrueNorth is the default direction or missing.", "Settings differ from the verified standard preset (mesh.background_cell_m); the run is not directly comparable with standard-preset runs and remains a screening result."]`

## 檔案

- `before/`、`after/`：`status.json`（coordinator `GET /api/cfd/runs/{id}`）、`result.json`（`GET …/result`）、`run_record.json`、`exclusions.json`（公開 repo 版本：只留 schema／profile／counts／剔除類別／`item_count` 與原始文件的 sha256，逐元素 GlobalId 已移除；比對用的是原始文件的 sha256）。
- `compare.json`：`compare_runs.py` 的完整輸出（請求相等性、每向指標與相對差、schema 驗證、鍵差異）。

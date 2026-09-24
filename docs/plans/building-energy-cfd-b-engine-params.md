# CFD 設定可調 B 階段：引擎參數與本機驗證（契約草案）

狀態：草案，等 owner 核准後才實作。

依據：

- owner 2026-09-23 的設定可調提案分成 A／B／C 三個階段。A 階段已在 S8 完成並真站驗證，證據在 `docs/evidence/cfd-s8-2026-09-23/`。
- 本草案遵守 `docs/architecture/cfd-case-run-adr.md` 的單一來源原則，新參數的預設值只定義在 `CaseParams`。
- 引擎端一個風向由 CFD Case Run 模組（`cfd_pipeline/case_run.py`）處理，新參數經 `CaseParams` 傳進去。
- coordinator 端的建立、讀取與 ledger 記錄，由 CFD Run Workflow 模組處理（`docs/architecture/cfd-run-workflow-adr.md`）。

## 1. 目標與範圍

**目標：** 把算力集中在建物附近。近建物維持現行解析度，只讓遠場變粗；計算域與加細範圍可以調整。用 AIJ 基準與實案證明準確度守得住，而且格數與耗時至少減半。

**範圍：**

- 引擎（`cfd_pipeline`）新增參數，預設值完全重現現行行為。
- `cfd-run-request/v1` 與 `cfd-estimate-request/v1` 以 additive optional 方式接受這些參數。
- 估算器支援新參數。
- 全部驗證在本機 docker 跑。

**不做（owner 停止點）：**

- 不改 service 預設、不動 181、不部署。
- 不把新欄位開到面板，`panel_fields` 不變；C 階段依驗證結果才開放。

## 2. 現況（讀碼確認）

| 項目 | 位置 | 現況 |
|---|---|---|
| 計算域 | `cfd_pipeline/wind.py` `domain_from_building` | 上游 5H、下游 15H、側向與上方 5H；阻塞比超過 3% 時只加寬側向。函式有參數，但 `build_case` 一律用函式預設呼叫，估算器也一樣 |
| 背景網格 | `openfoam_case.py` `build_case`、`_block_mesh_dict` | 整個計算域是一個均勻方塊，每軸格數 `max(4, ceil(size / cell))`。`cell` 取 `background_cell_m`，沒給時用自動規則 `min(6, max(1.5, round(H / 6, 2)))` |
| 加細盒 | `refinement_box_for` | 建物表面加細 2 級；只有一個加細盒，加細 1 級。bbox 模式是 bbox 外擴上游、側向、上方各 1H，下游 2H。等向模式（service 預設）以外殼頂點重心為圓心、最遠頂點距離為半徑，在外接圓外擴同樣的 1H／2H，所以離 bbox 更遠：S5b-2 的盒子離 bbox 上游約 2.6H、下游約 3.6H。AIJ 用 bbox 模式 |
| snappy 設定 | `_snappy_dict` | `nCellsBetweenLevels 3`、`maxLocalCells 4,000,000`、`maxGlobalCells 12,000,000` |
| `locationInMesh` | `build_case` | `x = xmin + 2H + 0.37·cell`，也就是固定在上游邊界往下游 2H 處 |
| 行人面 | `usd_results.py` | 取樣範圍裁到 bbox 外擴 3H，U_max 與 S6 finding 都在這個範圍取值 |
| 預設來源 | `CaseParams` 與函式預設 | ADR 規定 `CaseParams` 是唯一的預設來源；但 `domain_from_building`、`refinement_box_for` 目前仍有自己的函式預設 |

## 3. 引擎新參數（全部放在 `CaseParams`，預設等於現行）

| 參數 | 預設 | 範圍 | 作用 |
|---|---|---|---|
| `domain_upstream_h` | 5.0 | 2–10 | 上游長度，以樓高 H 的倍數表示 |
| `domain_downstream_h` | 15.0 | 5–25 | 下游長度 |
| `domain_lateral_h` | 5.0 | 2–10 | 側向邊距；阻塞比規則仍可能再加寬 |
| `domain_top_h` | 5.0 | 2–10 | 上方高度 |
| `max_blockage_ratio` | 0.03 | 0.01–0.10 | 阻塞比上限 |
| `refinement_box_scale` | 1.0 | 0.5–2.0 | 只縮放加細盒的外擴距離（1H／2H），不改盒子的基準（bbox 或外接圓）。平面很大的建物效果有限 |
| `outer_coarsening_levels` | 0 | 0–2 | 外圍放粗層數 n，見下方 |
| `coarsening_shell_h` | 1.0 | 0.5–5 | n ≥ 1 時，維持原背景解析度的外殼，從加細盒往外擴的距離（H 倍數） |
| `ground_band_height_h` | null（不加） | 見下方 | 上游沿地面的低層加細帶高度，AIJ 變體 2 用 |

**配套修正（預設行為不變）：**

- **`locationInMesh`：** 改為 `x = xmin + min(2H, 0.5·(bbox_min.x − xmin)) + 0.37·cell`。上游 5H 時等於現行值，上游只有 2H 時仍落在建物上游。另外斷言這個點在建物 bbox 外、在計算域內。
- **函式預設：** 移除 `domain_from_building`、`refinement_box_for` 的函式預設，由呼叫端（`build_case`、估算器）從 `CaseParams` 傳入，並用測試釘住。

**外圍放粗（巢狀加細盒）：**

- n 層放粗時，先算原本的細格數 `N = max(4, ceil(size / cell))`，再把 N 往上補到 2ⁿ 的倍數，並把計算域往下游、側向與上方延長到 `N · cell`。背景格改為 `cell · 2ⁿ`、格數 `N / 2ⁿ`，建物表面與加細盒的加細等級各加 n。這樣格距完全對齊，近建物的格子大小完全不變。只補 2ⁿ 倍數而不延長計算域時，格距會偏掉，例如 S5b-2 在 n = 1 時 z 方向差 2.1%。
- 外加 n 層外殼加細盒，第 k 層的等級是 n − k + 1。
  - 第 1 層（最內層）是「加細盒外擴 `coarsening_shell_h`·H」與「bbox 外擴 3H（行人面取樣範圍）」兩者的外包盒，維持原背景解析度，讓 owner 的驗收範圍與 finding 的取值區都不含放粗格。
  - 往外每層再外擴同樣距離，每層粗一倍。
- 這是 snappyHexMesh 現有的 refinementRegions 機制，不需要非均勻的 blockMesh。
- 替代做法是 blockMesh 漸變格。但 snappy 逐級加細假設背景格接近立方體，在邊界過渡區容易產生高長寬比的格子，所以不採用（推論，B 實跑時可再確認）。

**上游地面加細帶：**

- 範圍：從上游邊界到加細盒上游面，側向寬度與加細盒相同，高度 `ground_band_height_h`·H。
- 等級：等於加細盒等級（放粗時同樣加 n）。
- 厚度：帶高要避開背景格的格面，而且至少涵蓋 2 層該等級的格子。例如對齊 E4 時背景格是 1.5 m，0.1H（1.5 m）的帶高剛好等於一層背景格、落在格面上，是否被加細取決於格心判定，結果不穩定。

**加細只能逐級減半：** 任何「近建物格大小」都等於背景格除以 2 的次方。C 階段開放到面板時，要給離散選項，不能任意輸入。

**已知副作用：**

- `domain_top_h` 變小時，阻塞比規則會把側向加寬，格數可能反而增加。
- `refinement_box_scale` 大時可能碰到 `maxGlobalCells`，snappy 會提前停止加細。估算器要把這種請求列為超過上限。

## 4. 契約（additive optional，逐處列出）

**請求與估算請求：** 新欄位全部放在 `mesh` 區塊，不新增頂層區塊，這樣要改的地方最少。新欄位是 `domain_upstream_h`、`domain_downstream_h`、`domain_lateral_h`、`domain_top_h`、`max_blockage_ratio`、`refinement_box_scale`、`outer_coarsening_levels`、`coarsening_shell_h`、`ground_band_height_h`。

| 文件或程式 | 改動 |
|---|---|
| `tests/contracts/cfd-run-request-v1.schema.json`、`cfd-estimate-request-v1.schema.json` | `mesh.properties` 加上述欄位與上下限；兩份維持逐字相同，由契約測試釘住 |
| coordinator `src/contract/schemas/cfd.ts` | 共用的 `cfdMeshSettings` 加欄位，建立與估算兩個請求一起生效 |
| streaming `cfd_options.py` `REQUEST_FIELD_BOUNDS`、`cfd_job_service.py` `validate_run_request`／`validate_estimate_request` | 白名單與上下限加欄位。估算請求的組裝也要帶上，否則估算器收不到 |
| `tests/test_cfd_contracts.py` | 一致性測試比對 `mesh` 的新欄位，漏改任一處就會紅燈 |
| ledger `origin`（ledger schema、zod、CFD Run Workflow 的 origin 組裝） | 封閉物件，要明確加上選填欄位：計算域倍數、阻塞比上限、放粗層數 |
| `cfd-options/v1` | `fieldKey` 是封閉列舉，同時約束預設組的 `values` 與 `settings_profile.custom_fields`。新欄位要加進這個列舉，標準預設組也要補上它們的預設值，這樣送了新參數的請求才會被判定為「自訂」，不會被誤標成標準。`panel_fields` 與 `limits` 不變，新欄位的上下限要到 C 階段加 `panel_fields` 時才經選項端點回報 |
| run record | `settings.requested` 的 `mesh` 會自動帶出新欄位；`case.refinement` 是逐鍵取值，要明確加上新欄位與 `refinement_regions`（每個加細盒的範圍與等級） |
| `case_meta.json` | `params` 由 `asdict(CaseParams)` 產生，會自動帶出；另外加 `refinement_regions` |
| openapi 與 viewer 型別 | 重新產生 |

**部署順序：** 舊版 streaming 會拒絕帶新欄位的請求，所以 streaming、coordinator、viewer 要一起部署。只帶舊欄位的舊請求，行為完全不變。

**誠實標示（寫在 `limitations`，自由文字；`assumptions` 是封閉列舉，不動）：**

- 以加寬後的「有效計算域」判定，不看請求參數。上游 < 5H、下游 < 15H、側向或上方 < 5H、阻塞比 > 3% 時，逐項寫明低於 COST 732 建議。
- 用了外圍放粗或地面加細帶，而且不屬於已驗證的預設組時，寫明「網格配置未經驗證」。
- AIJ 的限制說明目前寫死「5H」，要改成實際的倍數。
- `validation_level` 維持 `screening`。

## 5. 估算器

- **預設參數：** 走現行路徑（精算背景格數 × 同組態歷史樣本的加細比例中位數），結果與現行估算相同。
- **非預設參數：** 背景格數照引擎同一套規則精算，包含放粗後的補齊與延長。各加細盒（含外殼與地面帶）的格數依「盒體積 ÷ 該等級的格體積」逐盒估算，再用 B 實跑的格數校正。
- **樣本過濾：** 「同組態」的判定納入新參數，放粗的 run 不會混進標準樣本池；否則一次 16 向的放粗 run 就可能讓放粗樣本過半，把標準估算放大，甚至誤觸算力上限。
- **準度要用樣本外的案例驗證：**
  - 比對對象是 result 的逐向 `mesh_cells`。`case_meta` 只有背景格數，不能直接比。
  - S8 的 +0.42%／+9.6% 是同模型、同案例的樣本內比較，不能當成準度。
  - 耗時的前處理保留值（300 秒）改用實測值。

## 6. 測試

- **golden test：**
  - 用合成幾何，在改動前的 main 上產生基準。
  - 比對預設參數產生的 `system/`、`constant/`、`0.orig/` 逐檔完全相同。
  - `build_case` 在這些目錄不寫時間戳、路徑或 run id。真正的風險是浮點格式（`.6g`）與 float32 STL，所以要逐位元組比對，不做正規化。
- **參數作用：**
  - 每個新參數寫進 blockMeshDict、snappyHexMeshDict 的值都要正確。
  - 放粗後，近建物格大小與現行完全相同，細格數是 2ⁿ 的倍數。
  - 上游 2H 時 `locationInMesh` 在建物外。
  - 外殼涵蓋 bbox 外擴 3H 的範圍。
- **契約：** 新欄位的上下限在三處一致、省略時等於 `CaseParams` 預設、超出範圍回 400；估算請求也接受新欄位；帶新欄位的請求在 `settings_profile` 被判定為自訂。
- **估算：** 預設參數時結果與現行相同；非預設參數時和實跑的 `mesh_cells` 比較；放粗樣本不進標準樣本池。

## 7. 本機驗證（docker，開發機，不用 181）

**AIJ Case C（1D、WD 0）：**

- 用 bbox 盒模式（與 E4 相同），背景格對齊 E4 的 1.5 m（0.1D），近方塊的格子大小由此加細而來。
- 步數上限固定為 1,200 步，與 E4 相同。E4 在開發機以 8 進程跑，5,152,214 格、6,202 秒，1,200 步仍未收斂，hit rate 40%、FAC2 85%。

| 變體 | 設定 |
|---|---|
| V1 | 外圍放粗 1 層，只加細方塊附近 |
| V2 | V1 再加上游沿地面的低層加細帶 |

**實案：** 用 S5b 用過的同一份外殼，跑 0°，等向盒模式，近建物解析度對齊 S5b-2 等向盒 3 m 那層。

- S5b-2 在開發機跑：4,455,873 格，延長後共 640 步收斂，3,146 秒，其中延長段約 196 秒。
- 引擎在 S5b-2 之後經過 CFD Case Run 重構，所以在同一台開發機、同核心數重跑基準，並固定步數上限（不讓延長造成耗時差），再與放粗 1 層、2 層兩個變體比較。

**驗收門檻（owner 訂的值）：**

| 對象 | 門檻 |
|---|---|
| AIJ | \|FB\| ≤ 0.05、hit rate ≥ 36%、FAC2 ≥ 0.80，格數與耗時都不超過 E4 的一半 |
| 實案 | 行人面峰值差 3% 以內；建物外 3H 範圍內的面積平均風速差 5% 以內（固定同一個行人面與取樣方式）；格數與耗時至少減半 |

**比較條件與限制：**

- hit rate 36% 只比 E4 的 40% 低約一個標準誤（120 點約 ±4.4 pp），能判斷的差異有限。
- S5b-2 的面積平均風速本身沒有網格收斂（只有峰值收斂），所以 5% 門檻的鑑別力有限，要一併註明。
- 每項只跑一次，是否收斂都要註明。

**回報格式：** 表格列出格數、耗時、步數、hit rate、FAC2、FB、NMSE、RMSE、是否收斂。證據不放 STL、OpenFOAM 輸出、AIJ 量測 CSV，也不寫專案名稱。

**成本（推論）：** AIJ 兩個變體各約 1 小時，實案基準與兩個變體合計約 2 小時，本機 CPU 約佔用 4 小時。

## 8. 交付順序

1. **B1 PR：** 引擎參數、`locationInMesh` 與函式預設的修正、契約、估算器、golden test 與單元測試。不含 UI，service 預設不變。
2. **本機實跑：** 跑第 7 節的實驗，證據另開一個 PR。
3. **回報：** 列出每個變體是否通過門檻，由 owner 決定 C 階段要把哪些設定放進預設組（例如「快速預覽」「精細」）、哪些欄位開到面板。

## 9. 待 owner 決定

- **外圍放粗機制：** 巢狀加細盒（建議），或 blockMesh 漸變格。
- **加細範圍：** 單一倍數 `refinement_box_scale`（建議），或上游、下游、側向、上方各自設定。
- **門檻：** 沿用 owner 訂的值，或依第 7 節的比較條件調整。例如 hit rate 改成「不低於 E4 超過一個標準誤」，或實案的面積平均改成只作參考。

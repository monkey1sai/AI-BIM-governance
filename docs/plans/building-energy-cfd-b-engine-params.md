# CFD 設定可調 B 階段：引擎參數與本機驗證（契約草案）

狀態：草案，等 owner 核准後才實作。依據：owner 2026-09-23 的設定可調提案（A／B／C 三階段），A 階段已在 S8 完成並真站驗證（`docs/evidence/cfd-s8-2026-09-23/`）。本草案遵守 `docs/architecture/cfd-case-run-adr.md` 的單一來源原則：新參數的預設值只定義在 `CaseParams`；引擎端的一個風向由 CFD Case Run 模組（`cfd_pipeline/case_run.py`）負責，新參數經 `CaseParams` 傳進去，不另開呼叫路徑。

## 1. 目標與範圍

**目標：** 把算力集中在建物附近。近建物維持現行解析度，遠場放粗，並讓計算域與加細範圍可以調整；用 AIJ 基準與實案證明準確度守得住、格數與耗時至少減半。

**範圍：**

- 引擎（`cfd_pipeline`）新增參數，預設值完全重現現行行為。
- `cfd-run-request/v1` 以 additive optional 方式接受這些參數；三處驗證同步（JSON Schema、coordinator zod、streaming 驗證）。
- 估算器支援新參數。
- 全部驗證在本機 docker 跑。

**不做（owner 停止點）：**

- 不改 service 預設、不動 181、不部署。
- 不把新欄位開到面板。`cfd-options/v1` 的 `panel_fields` 不變，要到 C 階段依驗證結果才開放。

## 2. 現況（讀碼確認）

| 項目 | 位置 | 現況 |
|---|---|---|
| 計算域 | `cfd_pipeline/wind.py` `domain_from_building` | 上游 5H、下游 15H、側向與上方 5H；阻塞比超過 3% 時自動加寬側向。函式已有參數，但 `build_case` 一律用預設值呼叫 |
| 背景網格 | `openfoam_case.py` `build_case`、`_block_mesh_dict` | 整個計算域一個均勻方塊，格大小為 `background_cell_m`，或自動規則 `min(6, max(1.5, H/6))` |
| 加細 | `refinement_box_for`、`_snappy_dict` | 建物表面加細 2 級。只有一個加細盒（等向模式）加細 1 級，範圍為上游、側向、上方各 1H，下游 2H。`nCellsBetweenLevels 3`，`maxGlobalCells 12,000,000` |
| 預設來源 | `CaseParams` | ADR 規定 `CaseParams` 是唯一的預設來源；service 標準預設組由測試釘在它上面 |

## 3. 引擎新參數（`CaseParams`）

| 參數 | 預設（＝現行） | 範圍 | 作用 |
|---|---|---|---|
| `domain_upstream_h` | 5.0 | 2–10 | 上游長度，以樓高 H 的倍數表示 |
| `domain_downstream_h` | 15.0 | 5–25 | 下游長度 |
| `domain_lateral_h` | 5.0 | 2–10 | 側向邊距（阻塞比規則仍可能再加寬） |
| `domain_top_h` | 5.0 | 2–10 | 上方高度 |
| `max_blockage_ratio` | 0.03 | 0.01–0.10 | 阻塞比上限 |
| `refinement_box_scale` | 1.0 | 0.5–3.0 | 加細盒範圍的倍數，等比放大現行的 1H／2H／1H／1H |
| `outer_coarsening_levels` | 0 | 0–2 | 外圍放粗層數 n，見下方說明 |
| `coarsening_shell_h` | 3.0 | 1–10 | n ≥ 1 時，維持原背景解析度的外殼離建物的距離（H 倍數） |
| `ground_band_height_h` | null（不加） | 0.1–1.0 | 上游沿地面的低層加細帶高度，給 AIJ 變體 2 用 |

**外圍放粗的做法（巢狀加細盒）：**

- n 層放粗時，背景格改為原來的 2ⁿ 倍，建物表面與加細盒的加細等級各加 n。所以近建物的格子大小完全不變。
- 另外加 n 層外殼加細盒：最內層外殼（離建物 `coarsening_shell_h`）維持原背景解析度，往外每層粗一倍。
- 這和 snappyHexMesh 現有的 refinementRegions 機制相同，不需要非均勻的 blockMesh。
- 另一個做法是 blockMesh 漸變格，但 snappy 的逐級加細假設背景格接近立方體，在邊界過渡區容易產生高長寬比的格子，所以不採用（推論，B 實跑時可再確認）。

**加細只能逐級減半：** 任何「近建物格大小」都等於背景格除以 2 的次方。C 階段開放到面板時，要給離散選項，不能任意輸入。

## 4. 契約（additive optional）

**`cfd-run-request/v1`：**

- 新增選填的 `domain` 區塊：`upstream_h`、`downstream_h`、`lateral_h`、`top_h`、`max_blockage_ratio`。
- `mesh` 區塊新增選填欄位：`refinement_box_scale`、`outer_coarsening_levels`、`coarsening_shell_h`、`ground_band_height_h`。
- 上下限寫進 `cfd_options.py` 的 `REQUEST_FIELD_BOUNDS`，JSON Schema、coordinator zod、streaming 驗證三處同步，並重新產生 openapi 與 viewer 型別。
- 省略時沿用 `CaseParams` 預設，舊請求的行為完全不變。

**其他文件：**

- **`cfd-options/v1`：** `limits` 與選項端點回報新欄位的上下限，但 `panel_fields` 不變（C 階段才開放）。標準預設組補上這些欄位，值等於 `CaseParams` 預設，由測試釘住。
- **可追溯：**
  - `case_meta.json` 的 `params` 會自動帶出新欄位，另加 `refinement_regions`（每個加細盒的範圍與等級）。
  - run record 的 `settings` 區塊與 `settings_profile.custom_fields` 包含新欄位。
  - coordinator ledger `origin` 以 additive 方式記錄 `domain` 與放粗層數。coordinator 端的建立、讀取與 ledger 記錄現在由 CFD Run Workflow 模組負責（`docs/architecture/cfd-run-workflow-adr.md`，#919、#926），新欄位從那裡接，不另開路徑。
- **誠實標示（`limitations`，自由文字；`assumptions` 是封閉列舉，不動）：**
  - 計算域小於 COST 732 建議（上游 < 5H、下游 < 15H、側向或上方 < 5H、阻塞比 > 3%）時，逐項寫明。
  - 用了外圍放粗或地面加細帶、而且不屬於已驗證的預設組時，寫明「網格配置未經驗證」。
  - `validation_level` 維持 `screening`。

## 5. 估算器

- 背景格數照引擎同一套計算域規則精算，包含新的計算域倍數與放粗後的背景格。
- 每個加細盒的格數依「盒體積 ÷ 該等級的格體積」逐盒計算，取代現行的整體加細比例；放粗層數為 0 時，結果要和現行估算一致。
- 用 B 階段實跑的格數校正這個模型，並把誤差寫進證據。
- 準度要用樣本外的案例驗證。S8 的 +0.42%／+9.6% 是同模型、同案例的樣本內比較（`docs/evidence/cfd-s8-2026-09-23/`），不能當成估算器的準度；B 的新網格配置本身就是樣本外案例。耗時的前處理保留值（300 秒）也要改用實測值。

## 6. 測試

- **golden test：** 預設參數產生的 case 檔（`system/`、`constant/`、`0.orig/`）逐檔比對，確認完全不變。比對前先正規化時間戳、路徑與 run id。
- **參數作用測試：** 每個新參數都有單元測試，確認寫進 blockMeshDict 或 snappyHexMeshDict 的值正確；也要確認放粗後，近建物的格大小與現行相同。
- **契約測試：** 新欄位的上下限在三處一致、省略時等於 `CaseParams` 預設、超出範圍回 400。
- **估算測試：** 放粗層數 0 時與現行估算相同；放粗層數 1、2 時與實際 `case_meta` 格數比較。

## 7. 本機驗證（docker，不用 181）

**AIJ Case C（1D、WD 0）：** 近方塊解析度對齊 E4（1.5 m，0.1D），步數上限與 E4 相同（1,200 步）。

| 變體 | 設定 |
|---|---|
| V1 | 外圍放粗 1 層，只加細方塊附近 |
| V2 | V1 再加上游沿地面的低層加細帶 |

**實案：** 用 S5b 用過的同一份外殼，跑 0°，近建物解析度對齊 S5b-2 等向盒 3 m 那層。

- **基準：** 在本機以同樣核心數重跑 S5b-2 的設定，讓耗時可以直接比較。S5b-2 當時在 181：4,455,873 格、3,146 秒。
- **變體：** 外圍放粗 1 層與 2 層。

**驗收門檻（owner 訂的值）：**

| 對象 | 門檻 |
|---|---|
| AIJ | \|FB\| ≤ 0.05、hit rate ≥ 36%、FAC2 ≥ 0.80，格數與耗時都不超過 E4 的一半（E4：5,152,214 格、6,202 秒） |
| 實案 | 行人面峰值差 3% 以內；建物外 3H 範圍內的面積平均風速差 5% 以內（固定同一個行人面與取樣方式）；格數與耗時至少減半 |

**比較條件與限制：**

- hit rate 36% 只比 E4 的 40% 低約一個標準誤（120 點約 ±4.4 pp），能判斷的差異有限。
- 每項只跑一次。

**回報格式：** 表格列出格數、耗時、hit rate、FAC2、FB、NMSE、RMSE、是否收斂。證據不放 STL、OpenFOAM 輸出、AIJ 量測 CSV，也不寫專案名稱。

**成本（推論）：** AIJ 兩個變體各約 1 小時，實案基準約 1 小時、兩個變體合計約 1 小時，本機 CPU 約佔用 4–5 小時。

## 8. 交付順序

1. **B1 PR：** 引擎參數、契約、估算器、golden test 與單元測試。不含 UI，service 預設不變。
2. **本機實跑：** 跑第 7 節的實驗，證據另開一個 PR。
3. **回報：** 列出每個變體是否通過門檻，由 owner 決定 C 階段要把哪些設定放進預設組（例如「快速預覽」「精細」）、哪些欄位開到面板。

## 9. 待 owner 決定

- **外圍放粗機制：** 巢狀加細盒（建議），或 blockMesh 漸變格。
- **加細範圍：** 單一倍數 `refinement_box_scale`（建議），或上游、下游、側向、上方各自設定。
- **門檻：** 沿用 owner 訂的值，或依第 7 節的比較條件調整。例如 hit rate 改成「不低於 E4 超過一個標準誤」。

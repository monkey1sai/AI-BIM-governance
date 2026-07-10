# A2 自製 diff 引擎 vs 官方 ifcdiff 對照實驗（R2 加購項，2026-07-10）

> 裁決背景：R2（spec `2026-07-10-plans-code-remediation-design.md`）保留自製多級鍵引擎並修鐵律 #9，
> 附帶本實驗——用**真實版本檔**驗證「GUID churn 假設」並與官方 ifcdiff 輸出對照。
> 環境：host `C:\Program Files\Python312\python.exe`（ifcopenshell 0.8.5）；ifcdiff 0.8.5 於隔離 venv。
> 材料：`storage/270/機電/`（真實三層規約 fixtures；同版本跨 機電/水電/消防 為複本，版本間 SHA1 各異）。

## 1. 自製引擎（governance-service/diff_engine，include_geometry=false）

| 配對 | 耗時 | base→target 構件數 | matched | counts | 變更 items 的 match 來源 |
|---|---|---|---|---|---|
| v000001（309MB）→ v000002（317MB） | **47.1s** | 1709 → 3419 | **1709／1709** | added=1710（其餘 0） | （無變更 items） |
| v000002（317MB）→ v000003（326MB） | **53.2s** | 3419 → 5128 | **3419／3419** | added=1709（其餘 0） | （無變更 items） |

## 2. 官方 ifcdiff 0.8.5（同一對 v000001 → v000002）

| 引擎 | 耗時 | added | deleted | changed |
|---|---|---|---|---|
| ifcdiff 0.8.5（含 shape 比對） | 183.4s | 1710 | 0 | 0 |
| 自製引擎（幾何 opt-in 關閉） | 47.1s | 1710 | 0（removed） | 0（moved/property 皆 0） |

## 3. 結論（誠實三條）

1. **輸出同構**：兩引擎在真實配對上計數完全一致（added=1710、零刪除、零變更）——本資料集上自製引擎與官方語意無分歧。
2. **零 GUID churn（實測）**：兩組真實版本皆為**純增量**（base 構件 100% 存活、removed=0）。
   R2 選型理由中的「三級配對抗 GUID churn」在本資料集**未被觸發**——其價值屬防禦性設計
   （對重匯出型工作流的保險），**尚無自家資料實證**；此為對鐵律 #9 簽核紀錄的誠實補充，不推翻裁決。
3. **效能**：自製 47.1s vs 官方 183.4s（3.9×）。**量測條件不對等**：ifcdiff 內建 shape 比對、
   自製引擎幾何為 opt-in 預設關；只能結論「預設路徑下自製較快」，不能宣稱演算法優勢。

## 4. 殘留與再驗條件

- 待出現「同一構件群重新匯出、GUID 再生」的真實配對（例如上游改用不同匯出器/重建模型）時，
  重跑本實驗驗證第 2/3 級配對命中率；引擎目前僅對變更 items 記錄 `evidence.match` 來源，
  全配對層級的 match 分佈需屆時在引擎加統計（additive）再量。
- ifcdiff 幾何比對在 `has_occ=False` 環境可跑（本次 shape compare 完成未報錯）——先前
  「可能撞 OCC 牆」的推測**未成立**，一併修正紀錄。

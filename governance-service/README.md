# governance-service — A1 BIM 治理與模型檢核 (Rule-Run Authority)

> 落地端內部服務 · FastAPI · `127.0.0.1:49102`（loopback only）· 純 CPU host-native ifcopenshell · 無 GPU / Kit 依賴

實作 A1（BIM Governance & Rule Checker）的可驗證垂直切片：把交付規範變成可被電腦執行的規則集，對真實 IFC 自動跑出 governance score、failed elements（帶真實 `ifc_guid`）、可匯出 Excel。

## 為什麼是獨立服務（邊界）

- 規則檢核是**重 CPU**、會掃描數千構件 → 不可跑在 Kit/WebRTC viewport thread（會卡即時串流）。
- 權威 IFC 解析器是 **Python ifcopenshell**；coordinator 是 Node/TS，故不內嵌。
- conversion authority（`bim-streaming-server` :49101）負責 IFC→USDC；本服務只**唯讀**消費既有 `element_mapping.json` 與唯讀讀取 IFC 做 CPU 檢核，不轉檔。
- **瀏覽器永不直連本服務**；一律經 coordinator `:8004` 的 `/api/governance/*` proxy（loopback 轉發）。

## 規則引擎（純 ifcopenshell predicate，不依賴 ifctester / IDS）

宣告式規則集（`rules/*.yaml`）。MVP predicate：

| predicate | 說明 | 萃取來源 |
|---|---|---|
| `property_required` | 指定 Pset 須有非空屬性（如防火門 FireRating） | `ifcopenshell.util.element.get_psets` |
| `attribute_required` | IFC 直接屬性（如 Name）須非空 | entity attribute |
| `spatial_contained` | 須被指派到空間結構（樓層/空間） | `ifcopenshell.util.element.get_container` |
| `naming_convention` | Name 須符合正規表達式 | regex |

> **ifctester / IDS-XML 匯入未安裝、未使用**，為後續 p1 項目（需先 `pip install ifctester` 並留 smoke 證據）。
> **BCF 匯出（issue→.bcfzip）為 p15**（`bcf` 模組未安裝 + LGPL 授權閘門）；本切片只提供 Excel 匯出。

## 真實 IFC 驗證證據（2026-06-02）

對 `storage/fixture-bytes.ifc`（schema **IFC4X3**）跑 default 規則集（CPU，~6s）：

| 指標 | 值 |
|---|---|
| 評估構件 | 7126（門 72 / 構件 6715 / 牆 339） |
| passed | 7055 |
| **failed** | **71** |
| errored | 0 |
| score | 99.0 |

每筆 failed 皆帶真實 `ifc_guid`（例：玻璃前門缺 `Pset_DoorCommon.FireRating`）。證據見 `docs/evidence/governance-rule-run-pass/2026-06-02/`。

## API（內部 :49102）

```
GET  /health                              誠實 preflight（ifcopenshell=true, ifctester=false, rule_sets[]）
POST /api/rule-runs                       {ifc_source_path, rule_set?, model_version_id?, element_mapping_path?} -> 202 {rule_run_id, status}
GET  /api/rule-runs/{id}                  status / score / summary
GET  /api/rule-runs/{id}/results?status=failed   失敗構件（ifc_guid, usd_prim_path, message）
GET  /api/rule-runs/{id}/export?fmt=excel openpyxl xlsx（fmt=bcf -> 501 p15）
```

`element_mapping_path` 可選；提供時 join `ifc_guid -> usd_prim_path`（未對映留 `null`，fake/smoke mapping 一律不視為覆蓋率）。

## 執行 / 測試

```bash
# 測試（host-native Python 3.12；含合成模型 + 真實 IFC + API E2E）
"/c/Program Files/Python312/python.exe" -m pytest tests/ -v

# 產生真實 IFC evidence
"/c/Program Files/Python312/python.exe" scripts/run_governance_evidence.py

# 啟動服務（loopback）
"/c/Program Files/Python312/python.exe" app.py   # 127.0.0.1:49102
```

> 必走 host-native `C:\Program Files\Python312\python.exe`（已具 ifcopenshell 0.8.5 + openpyxl 3.1.5 + fastapi/uvicorn/pyyaml/pytest）。

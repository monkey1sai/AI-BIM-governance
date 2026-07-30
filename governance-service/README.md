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
| 規則評估次數 | 7126（門 72 / 構件 6715 / 牆 339） |
| 唯一構件 | 6715（distinct `ifc_guid`） |
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
POST /api/internal/a4/issues/from-search   coordinator-only；signed row proof -> atomic confirmed Issue
```

`element_mapping_path` 可選；提供時 join `ifc_guid -> usd_prim_path`（未對映留 `null`，fake/smoke mapping 一律不視為覆蓋率）。

## 資料模型不變量

- A2 diff 第一級永遠以 IFC `GlobalId` 對齊；Tag 與 type/name/location 只可作未命中時的 fallback。生成式 property test 會打亂兩側順序與 fallback 欄位，鎖住此優先序。
- `kind=issue` 必須同時綁定非空 `ifc_guid` 與 `model_version_id`；無 `ifc_guid` 的視覺標註仍是 `annotation`。API/store 驗證與 SQLite insert/update trigger 共同 fail closed。
- Issue store 使用 SQLite WAL、`busy_timeout=5000` 與 `BEGIN IMMEDIATE` 的既有 atomic batch/transition 路徑；多人審查負載超過單機 SQLite 能力時才另案評估換庫，不在此契約內靜默改寫 storage authority。

A4 Issue route 只接受 16–4096 字元 printable-ASCII server-only internal token 與 trusted current
session/principal context 的單列 request。首次 consume 原子保存 Issue、immutable
snapshot、unique proof ID 與三個 replay digests；exact replay 回原 Issue，generic
manual/rule/diff Issue 不會被 fabricated A4 provenance 回填。
在 session-authorized lifecycle route 落地前，generic Issue list/detail/transition
不列出也不揭露 A4 Issue；trusted internal create response 是目前唯一可讀完整 A4
immutable evidence 的 API boundary。
Proof snapshot 中的 finite float 與超過 JavaScript safe range 的 integer 會以
exact decimal string 傳輸，避免 Python/Node JSON round-trip 改變 signed bytes。

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

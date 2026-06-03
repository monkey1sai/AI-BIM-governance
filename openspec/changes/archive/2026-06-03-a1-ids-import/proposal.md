## Why

A1 第一版以純 ifcopenshell predicate 實作，因 host 未裝 `ifctester` 而把 IDS-XML 匯入標 p1。buildingSMART **IDS（Information Delivery Specification）** 是業界標準、機器可讀的驗收清單；支援 IDS 讓客戶能直接用標準格式定義交付規範，而非只用本 repo 的 YAML 規則。本 change 安裝 `ifctester` 並支援以 IDS 跑 rule-run。

## What Changes

- 安裝 `ifctester>=0.8.5`（host Python 3.12；pip 安裝附帶 `bcf-client`，供後續 BCF 匯出）。
- `governance-service/rule_engine/ids_runner.py`：用 `ifctester` 載入 IDS、對 model 驗證，映射成與 YAML 引擎一致的 `RuleRunResult`（applicable_entities − passed_entities = failed，帶真實 `ifc_guid`）。
- rule-run 端點新增 `ids_path`：提供時改用 IDS（ifctester），否則用 YAML 規則集。
- `/health` 誠實回報 `ifctester=true`（現已安裝）。
- 前端 A1 Rule Center：新增 IDS 路徑輸入；填 IDS 即以 IDS 規則跑。
- sample IDS（`rules/sample-fire-rating.ids`）+ 真實 IFC smoke 證據。

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `governance-rule-run-authority`：新增以 buildingSMART IDS（ifctester）為規則來源的 rule-run；`/health` 由 `ifctester=false` 變為如實 `true`。

## Impact

- Owner repo / folder:
  - `governance-service/rule_engine/ids_runner.py`、`app.py`（rule-run ids_path 分支）、`requirements.txt`、`scripts/`、`rules/sample-fire-rating.ids`。
  - `web-viewer-sample/src/console/`（A1 IDS 欄）。
- API / data shape:
  - rule-run 請求新增可選 `ids_path`；結果格式與 YAML 引擎一致（RuleRunResult，帶 `ifc_guid`）。
- Dependencies:
  - **新增生產依賴 `ifctester>=0.8.5`**（理由：IDS 為 buildingSMART 業界標準驗收格式，A1 的核心價值之一）；pip 附帶 `bcf-client`（供後續 BCF 匯出）。純 CPU。
- Non-goals:
  - 不取代 YAML 引擎（兩者並存，按 `ids_path` 切換）；BCF 匯出仍為另一 change（F4）。
- 交叉驗證（誠實）：IDS smoke（防火門需 FireRating）對真實 IFC（72 門）得 passed 1 / failed 71，與 YAML 引擎結果一致。

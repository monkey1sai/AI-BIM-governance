## Why

A1「BIM 治理與模型檢核」是 10 大應用裡最該先做、最穩、價值最直接的一個：客戶付錢買的不是看 3D，而是減少審查時間、錯誤與返工。目前 repo 只有 conversion + streaming + viewer 閉環，**沒有任何規則檢核能力**：無法把「業主交付要求 / 公司 BIM 規範 / buildingSMART 驗收清單」變成可被電腦執行的規則集，對真實 IFC 自動跑出 governance score 與 failed elements。

落地端先前的 L4 證據只證明 `ifcopenshell` 能 host-native、CPU-only 解析真實 IFC 並枚舉 7011 個構件（guid/type/name）——這只是 **parse 基底**，不是規則檢核。本 change 在這個已驗證的基底上，新增一個真正會「萃取 Pset / 屬性 / 空間關係 + 套 predicate + 計分」的規則引擎與內部服務。

## What Changes

- 新增落地端內部服務 `governance-service`（Python/FastAPI，`127.0.0.1:49102`，loopback only），作為 A1 rule-run authority：
  - 宣告式規則集（`rules/*.yaml`），MVP predicate：`property_required` / `attribute_required` / `spatial_contained` / `naming_convention`，皆以 **純 `ifcopenshell` predicate** 實作（**不依賴 ifctester / IDS**）。
  - 對真實 IFC（唯讀）跑規則，產出帶真實 `ifc_guid` 的 pass/fail 結果、governance score，持久化於 SQLite（`rule_runs` / `rule_results`）。
  - 可選 join 既有轉檔產出的 `element_mapping.json`，補上 `usd_prim_path`（未對映留 `null`，不捏造；fake/smoke mapping 不視為覆蓋率）。
  - Excel 匯出（openpyxl）。
- 新增 coordinator 對瀏覽器的 `/api/governance/rule-runs*` proxy（loopback 轉發至 `:49102`），維持「瀏覽器只打 `:8004`」邊界。
- 不改 conversion authority、外部公司雲端 `bim-control`、外部 IFC Worker、callback outbox 權威邊界。

## Capabilities

### New Capabilities

- `governance-rule-run-authority`：落地端對真實 IFC 執行宣告式治理規則集，產出帶 `ifc_guid` 的 pass/fail 結果、score、Excel 匯出，並維持 loopback / coordinator-proxy / fake-mapping 隔離 / ifctester-未安裝 的誠實邊界。

### Modified Capabilities

- None.（coordinator proxy 為 additive route，不改既有 capability 的 requirement。）

## Impact

- Owner repo / folder:
  - 新增 `governance-service/`（擁有規則引擎、規則集、rule-run 持久化、內部 API、服務測試與 evidence 產生器）。
  - `bim-review-coordinator/` 僅新增 additive 的 `/api/governance/*` proxy route，不改既有 session / intake / callback 行為。
  - `web-viewer-sample/` 後續（change 2）以既有 `usd_prim_path` / artifact 消費結果，不成為 rule-run authority。
- API / data shape:
  - 新增內部 API（`:49102`）：`POST /api/rule-runs`、`GET /api/rule-runs/{id}`、`GET /api/rule-runs/{id}/results?status=failed`、`GET /api/rule-runs/{id}/export?fmt=excel`、`GET /health`。
  - coordinator 新增 `/api/governance/rule-runs*` proxy；外部 `POST /api/external/ifc-ready` 契約不變。
- Runtime boundary:
  - `governance-service` 綁 `127.0.0.1:49102`，瀏覽器不得直連；一律經 coordinator `:8004`。
  - 規則檢核為重 CPU，跑在獨立 process / port，不阻塞 Kit/WebRTC viewport thread。
  - 純 CPU host-native ifcopenshell，不需 GPU / Kit。
- Dependencies:
  - 無新增「非 host 既有」生產依賴（host Python 3.12 已具 `ifcopenshell` / `openpyxl` / `fastapi` / `uvicorn` / `PyYAML`）。
  - `ifctester` / IDS-XML 匯入**未安裝、未使用**，為後續 p1；BCF 匯出（issue→.bcfzip）為 p15（`bcf` 模組未安裝 + LGPL 閘門）。
- Non-goals:
  - 不實作 issue 生命週期資料庫、BCF server、IDS-XML 匯入（皆 p1/p15）。
  - 不宣稱 rule-run 結果的 `usd_prim_path` 覆蓋率來自真實多元素 mapping（真模型多元素 mapping 待真實轉檔產出）。
  - 不改 conversion authority、雲端權威、RBAC、billing。
  - 不復活 2026-05-21 退役的 collaboration server-push；3D highlight 由前端（後續 change）以既有 client `highlightPrimsRequest` 主動發送。

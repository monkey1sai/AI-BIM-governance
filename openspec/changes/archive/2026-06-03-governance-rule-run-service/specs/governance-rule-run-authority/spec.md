# governance-rule-run-authority — Spec Delta (governance-rule-run-service)

> 新 capability：落地端對真實 IFC 執行宣告式治理規則集（A1）。
> 純 CPU host-native ifcopenshell，loopback only，誠實邊界（不捏造、ifctester 未安裝如實標示）。

## ADDED Requirements

### Requirement: 落地端 SHALL 提供對真實 IFC 執行宣告式治理規則集的 rule-run authority

落地端 SHALL 提供一個內部服務 `governance-service`，接受 IFC 來源與規則集，對 IFC 構件套用宣告式規則（屬性必填、命名規則、空間指派等），並產出每構件 pass/fail 結果、governance score 與彙總。規則 SHALL 以 `ifcopenshell` predicate 實作，SHALL NOT 要求 GPU、Kit、WebRTC 或 ifctester。

#### Scenario: 對真實 IFC 跑規則集產出帶 GUID 的結果

- **WHEN** 提交一個 rule-run，指向可讀的真實 IFC 來源與一個規則集
- **THEN** `governance-service` SHALL 以 host-native `ifcopenshell` 唯讀解析該 IFC
- **AND** SHALL 對每條規則枚舉目標 IFC 型別的構件並套用 predicate
- **AND** 每筆結果 SHALL 帶該構件真實的 `ifc_guid`、`ifc_type`、`ifc_name`、`rule_code`、`severity` 與 `status`（`pass` / `fail` / `error`）
- **AND** SHALL 計算 governance score = passed / (passed + failed)
- **AND** SHALL NOT 依賴 GPU / Kit / WebRTC / ifctester

#### Scenario: 規則真的從模型萃取屬性與空間關係（非僅枚舉）

- **WHEN** 一條 `property_required` 規則檢核某 Pset 屬性（如防火門 `Pset_DoorCommon.FireRating`）
- **THEN** `governance-service` SHALL 透過 `ifcopenshell` 解析該構件的 property sets 取值
- **AND** 結果 evidence SHALL 記錄實際讀到的 Pset 清單與該屬性值
- **AND** 一條 `spatial_contained` 規則 SHALL 透過 IFC 空間關係判定構件是否被指派到樓層 / 空間

#### Scenario: 跨 IFC schema 型別別名

- **WHEN** 規則的目標型別在當前 IFC schema 不存在（例如 IFC4X3 沒有 `IfcBuildingElement`）
- **THEN** `governance-service` SHALL 嘗試已知等價別名（如 `IfcBuiltElement`）
- **AND** 若皆不存在 SHALL 記錄 warning 並讓該規則評估 0 構件，而非崩潰

### Requirement: rule-run 結果 SHALL 誠實，不捏造 mapping 或能力

`governance-service` SHALL 以 `ifc_guid` 為治理主鍵；`usd_prim_path` 為執行期定位索引。未對映或缺證據時 SHALL 如實標示，SHALL NOT 捏造數值或宣稱未具備的能力。

#### Scenario: 未對映的 usd_prim_path 為 null

- **WHEN** 提供 `element_mapping.json` 供 join，但某 `ifc_guid` 不在 mapping 中
- **THEN** 該結果的 `usd_prim_path` SHALL 為 `null`
- **AND** SHALL NOT 以任意或捏造的 prim path 取代

#### Scenario: fake / smoke mapping 不得當真實覆蓋率

- **WHEN** `element_mapping` metadata 標示 `mock`、`allow_fake_mapping`、`fake_mapping_count > 0` 或 `mapping_method = "fake_for_smoke_test"`
- **THEN** `governance-service` SHALL NOT 把該 mapping 當作真實 `guid_exact` 覆蓋率
- **AND** SHALL 記錄 warning 表明 `usd_prim_path` 不代表真實覆蓋率

#### Scenario: ifctester / IDS 與 BCF 匯出誠實標示為未建

- **WHEN** 查詢服務 `GET /health`
- **THEN** `governance-service` SHALL 如實回報 `ifctester` 是否安裝（未安裝時為 `false`）
- **AND** 當請求 BCF 匯出（`export?fmt=bcf`）時 SHALL 回應「未建」而非產出假 BCF
- **AND** rule-run 的計分與結果 SHALL NOT 因 ifctester / IDS 未安裝而捏造通過

### Requirement: rule-run SHALL 維持 loopback 與 coordinator-proxy 邊界且不阻塞串流

`governance-service` SHALL 綁定 `127.0.0.1`，瀏覽器 SHALL NOT 直連。對瀏覽器的存取 SHALL 經 `bim-review-coordinator` 的 `/api/governance/*` proxy。重 CPU 規則檢核 SHALL 在獨立 process 執行，SHALL NOT 阻塞 Kit / WebRTC viewport thread。

#### Scenario: 瀏覽器經 coordinator proxy 而非直連

- **WHEN** 瀏覽器需要觸發或讀取 rule-run
- **THEN** 它 SHALL 呼叫 coordinator `:8004` 的 `/api/governance/*`
- **AND** SHALL NOT 直接連線 `governance-service` 的 `127.0.0.1:49102`
- **AND** coordinator SHALL 以 loopback 轉發並僅回傳 metadata / 結果，不改變既有 session 與 callback 邊界

#### Scenario: 重 CPU 檢核不阻塞 viewport

- **WHEN** 對大型真實模型（數千構件）執行 rule-run
- **THEN** 檢核 SHALL 在 `governance-service`（獨立 process / port）執行
- **AND** SHALL NOT 在 `bim-streaming-server` 的 Kit runtime / WebRTC viewport thread 內執行

### Requirement: rule-run SHALL 可匯出失敗構件清單

`governance-service` SHALL 能把 rule-run 的失敗構件匯出為 Excel，供審查交付。

#### Scenario: Excel 匯出失敗構件

- **WHEN** 一個已完成的 rule-run 請求 `export?fmt=excel`
- **THEN** `governance-service` SHALL 產出 `.xlsx`，每列含 `rule_code`、`severity`、`ifc_type`、`ifc_name`、`ifc_guid`、`usd_prim_path`、`message`
- **AND** 列數 SHALL 等於失敗構件數，且不含捏造列

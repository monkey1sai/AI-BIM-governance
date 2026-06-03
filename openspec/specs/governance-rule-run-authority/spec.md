# governance-rule-run-authority Specification

## Purpose
TBD - created by archiving change governance-rule-run-service. Update Purpose after archive.
## Requirements
### Requirement: 落地端 SHALL 提供對真實 IFC 執行宣告式治理規則集的 rule-run authority

落地端 SHALL 提供一個內部服務 `governance-service`，接受 IFC 來源與規則集，對 IFC 構件套用宣告式規則（屬性必填、命名規則、空間指派等），並產出每構件 pass/fail/error 結果、governance score 與彙總。規則 SHALL 以 `ifcopenshell` predicate 實作，SHALL NOT 要求 GPU、Kit、WebRTC 或 ifctester。

governance score SHALL 誠實反映評估結果：score = passed / (passed + failed + errored)。評估失敗（`error`）SHALL 計入分母、視同未通過，SHALL NOT 被排除在分母之外而使部分或全部評估失敗的 run 呈現為虛假滿分。當無任何適用構件（分母為 0）時 score SHALL 為 100.0（vacuous）。

#### Scenario: 對真實 IFC 跑規則集產出帶 GUID 的結果

- **WHEN** 提交一個 rule-run，指向可讀的真實 IFC 來源與一個規則集
- **THEN** `governance-service` SHALL 以 host-native `ifcopenshell` 唯讀解析該 IFC
- **AND** SHALL 對每條規則枚舉目標 IFC 型別的構件並套用 predicate
- **AND** 每筆結果 SHALL 帶該構件真實的 `ifc_guid`、`ifc_type`、`ifc_name`、`rule_code`、`severity` 與 `status`（`pass` / `fail` / `error`）
- **AND** SHALL 計算 governance score = passed / (passed + failed + errored)
- **AND** SHALL NOT 依賴 GPU / Kit / WebRTC

#### Scenario: 全部構件評估失敗時 score 不得呈現為滿分

- **WHEN** 一條規則對每個目標構件評估都拋出例外（如損壞模型或錯誤 predicate），使該 run 全部為 `error`、`passed == 0`
- **THEN** governance score SHALL 為 0.0（`errored` 計入分母）
- **AND** SHALL NOT 因「分母只算 passed + failed」而回報 100.0
- **AND** 彙總 SHALL 保留 `errored` 計數供消費端辨識評估失敗

#### Scenario: 規則真的從模型萃取屬性與空間關係（非僅枚舉）

- **WHEN** 一條 `property_required` 規則檢核某 Pset 屬性（如防火門 `Pset_DoorCommon.FireRating`）
- **THEN** `governance-service` SHALL 透過 `ifcopenshell` 解析該構件的 property sets 取值
- **AND** 結果 evidence SHALL 記錄實際讀到的 Pset 清單與該屬性值
- **AND** 查找屬性時 SHALL 排除 `ifcopenshell` `get_psets()` 注入的合成 key（如 `id`），SHALL NOT 因合成 key 而使規則假性通過
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

#### Scenario: ifctester 安裝誠實回報；rule-run /export 僅 Excel，BCF 走 /api/bcf/export

- **WHEN** 查詢服務 `GET /health`
- **THEN** `governance-service` SHALL 如實回報 `ifctester` 是否安裝（未安裝時為 `false`）
- **AND** 對 rule-run 的 `export?fmt=bcf` SHALL 回 `400` 並導引「BCF 匯出請先 from-rule-run 建 issue，再 `GET /api/bcf/export`」（rule-run `/export` 僅產 Excel；BCF 2.1 匯出已落地於 `bcf/` 模組與 `/api/bcf/export`，SHALL NOT 宣稱 BCF「未建」或產出假 BCF）
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

### Requirement: rule-run SHALL 支援 buildingSMART IDS 規則來源

`governance-service` SHALL 能以 buildingSMART IDS（透過 `ifctester`）作為 rule-run 的規則來源。以 IDS 跑時，結果 SHALL 與 YAML 引擎一致地映射為帶真實 `ifc_guid` 的 pass/fail，並計分。`/health` SHALL 如實回報 `ifctester` 是否安裝。

IDS 計分 SHALL 誠實，SHALL NOT 因 `ifctester` 內部狀態殘留或零適用構件而捏造通過：

- **跨 model 不得殘留洩漏**：以同一已載入的 IDS specs 物件先後對多份 model 執行時，前一份 model 的逐構件通過狀態 SHALL NOT 洩漏到後一份。實作 SHALL 在每次驗證進入點重置 `ifctester` 不會自行清理的 requirement facet 殘留通過集合，使後一份 model 的不合規構件 SHALL NOT 因與前一份構件共用底層 STEP id 而被誤判為 pass。
- **required 構件缺席 SHALL 誠實 fail**：非 prohibited 的 required specification（`minOccurs` 非 0）在 model 中找不到任何適用構件、且 `ifctester` 判該 specification 不通過時，SHALL 產出一筆 specification 級 fail（誠實反映 required 構件缺席），SHALL NOT 因無逐構件 result 而回 score=100。

#### Scenario: 以 IDS 跑 rule-run 產出帶 GUID 的結果

- **WHEN** rule-run 提供一個可讀的 IDS 來源（`ids_path`）與 IFC
- **THEN** `governance-service` SHALL 用 ifctester 對該 IFC 驗證 IDS
- **AND** 每個 applicable 構件 SHALL 產出一筆結果，帶其真實 `ifc_guid` 與 pass/fail（未滿足 IDS 要求者為 fail）
- **AND** 結果格式 SHALL 與 YAML 引擎一致（RuleRunResult），可串接 issue / 匯出

#### Scenario: ifctester 安裝狀態誠實回報

- **WHEN** 查詢 `/health`
- **THEN** `governance-service` SHALL 如實回報 `ifctester`（已安裝時為 `true`）
- **AND** 未提供 `ids_path` 時 SHALL 仍以內建 YAML 規則集跑（兩來源並存）

#### Scenario: 重用同一 IDS specs 物件跨多份 model 不得殘留假通過

- **WHEN** 以同一已載入的 IDS specs 物件，先對一份「滿足某 IDS 要求」的 model 驗證，再對另一份「不滿足同要求」的 model 驗證
- **THEN** 第二份 model 的驗證結果 SHALL 至少有一筆 fail
- **AND** 其 governance score SHALL 小於 100
- **AND** 第二份 model 的不合規構件 SHALL NOT 因與第一份 model 構件共用底層 STEP id 而被誤判為 pass

#### Scenario: required spec 零適用構件 SHALL 誠實 fail 而非 100% pass

- **WHEN** 一個非 prohibited 的 required specification（`minOccurs` 非 0）在目標 model 中找不到任何適用構件，且 `ifctester` 判該 specification 不通過
- **THEN** `governance-service` SHALL 產出一筆 specification 級 fail，誠實反映「required 構件缺席」
- **AND** governance score SHALL 小於 100，SHALL NOT 因無逐構件 result 而回 100
- **AND** 該補上的 fail SHALL NOT 捏造不存在構件的 `ifc_guid`

### Requirement: IDS rule-run 彙總 SHALL 唯一可辨識且 error 計數誠實

以 buildingSMART IDS 作為規則來源時，rule-run 的對外彙總（`target_summary` / `errored`）SHALL 誠實且可辨識：每個 specification SHALL 在彙總中有唯一 key，SHALL NOT 因同名或未命名而互相覆寫導致構件計數低報；`errored` SHALL 由結果推導，SHALL NOT 結構性寫死；prohibited applicability 等 specification 級違規 SHALL NOT 被靜默當成乾淨通過。

#### Scenario: 同名 specification 不互相覆寫彙總

- **WHEN** 一份 IDS 含多個同名或未命名的 specification
- **THEN** 每個 specification SHALL 在 `target_summary` 有唯一 key（以 IDS identifier，否則名稱加索引後綴）
- **AND** 彙總的構件計數 SHALL NOT 因 key 衝突而被覆寫低報

#### Scenario: errored 計數由結果推導

- **WHEN** 產生 IDS rule-run 的彙總
- **THEN** `errored` SHALL 等於結果中 `status == "error"` 的筆數
- **AND** SHALL NOT 結構性寫死為 0

#### Scenario: prohibited specification 不得靜默通過

- **WHEN** 一個 prohibited applicability 的 specification 經 validate 後判定為違規（`status` 為 False）卻未產生任何逐構件 result
- **THEN** rule-run SHALL 為每個 applicable 構件補一筆 `fail`，誠實反映 specification 級違規
- **AND** 該 run 的 score SHALL NOT 因此呈現為滿分

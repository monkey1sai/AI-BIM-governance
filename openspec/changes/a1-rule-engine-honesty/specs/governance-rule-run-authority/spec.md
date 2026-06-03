# governance-rule-run-authority spec delta（change: a1-rule-engine-honesty）

## MODIFIED Requirements

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

## ADDED Requirements

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

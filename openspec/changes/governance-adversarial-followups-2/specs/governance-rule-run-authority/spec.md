# governance-rule-run-authority — Spec Delta (governance-adversarial-followups-2)

> A1-IDS 誠實計分硬化：杜絕重用 specs 物件跨 model 的殘留假通過（F1）、required spec 零適用構件誤報 100% pass（F2）。

## MODIFIED Requirements

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

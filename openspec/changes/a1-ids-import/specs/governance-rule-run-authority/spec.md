# governance-rule-run-authority — Spec Delta (a1-ids-import)

> 對既有 capability `governance-rule-run-authority` 新增 buildingSMART IDS 規則來源（ifctester）。

## ADDED Requirements

### Requirement: rule-run SHALL 支援 buildingSMART IDS 規則來源

`governance-service` SHALL 能以 buildingSMART IDS（透過 `ifctester`）作為 rule-run 的規則來源。以 IDS 跑時，結果 SHALL 與 YAML 引擎一致地映射為帶真實 `ifc_guid` 的 pass/fail，並計分。`/health` SHALL 如實回報 `ifctester` 是否安裝。

#### Scenario: 以 IDS 跑 rule-run 產出帶 GUID 的結果

- **WHEN** rule-run 提供一個可讀的 IDS 來源（`ids_path`）與 IFC
- **THEN** `governance-service` SHALL 用 ifctester 對該 IFC 驗證 IDS
- **AND** 每個 applicable 構件 SHALL 產出一筆結果，帶其真實 `ifc_guid` 與 pass/fail（未滿足 IDS 要求者為 fail）
- **AND** 結果格式 SHALL 與 YAML 引擎一致（RuleRunResult），可串接 issue / 匯出

#### Scenario: ifctester 安裝狀態誠實回報

- **WHEN** 查詢 `/health`
- **THEN** `governance-service` SHALL 如實回報 `ifctester`（已安裝時為 `true`）
- **AND** 未提供 `ids_path` 時 SHALL 仍以內建 YAML 規則集跑（兩來源並存）

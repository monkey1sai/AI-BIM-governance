# governance-bcf-export Specification

## Purpose
TBD - created by archiving change a1-bcf-export. Update Purpose after archive.
## Requirements
### Requirement: governance-service SHALL 把正式 issue 匯出為 BCF 2.1

`governance-service` SHALL 提供端點把正式 issue（`kind=issue` 且有 `ifc_guid`）匯出為 buildingSMART BCF 2.1 `.bcfzip`。匯出 SHALL 純以標準庫產生（不依賴 GPLv3 `bcf-client`）。每個 topic 的 viewpoint SHALL 以 IFC `GlobalId`（`IfcGuid`）定位構件；comment SHALL 帶 `model_version` 以保留溯源。瀏覽器 SHALL 只經 coordinator proxy 取得 `.bcfzip`，不直連內部服務。

#### Scenario: 匯出含正式 issue 的 BCF

- **WHEN** 有至少一個正式 issue（`kind=issue` 且有 `ifc_guid`）且查詢 BCF 匯出端點
- **THEN** `governance-service` SHALL 回傳 `application/octet-stream` 的 `.bcfzip`
- **AND** zip 內 SHALL 含 `bcf.version`（VersionId=2.1），且每個正式 issue 對應一個 `<topic_guid>/markup.bcf` 與 `<topic_guid>/viewpoint.bcfv`
- **AND** viewpoint 的 `Component` SHALL 以該 issue 的 `ifc_guid` 作為 `IfcGuid`

#### Scenario: annotation 與無 GUID issue 不匯出

- **WHEN** 匯出時某些 issue 為 `annotation` 或沒有 `ifc_guid`
- **THEN** 這些 issue SHALL NOT 出現在 `.bcfzip` 中（BCF 主鍵為 IfcGuid，無 guid 無法在其他工具還原）
- **AND** 當沒有任何可匯出的正式 issue 時，端點 SHALL 回 404 並誠實說明，而非回空 zip

#### Scenario: 經 coordinator proxy 取得且不新增 GPLv3 依賴

- **WHEN** 瀏覽器要下載 BCF
- **THEN** 請求 SHALL 經 coordinator `:8004` 的 `/api/governance/bcf/export` 二進位透傳至 governance-service
- **AND** BCF 產生 SHALL 不 import `bcf-client`（GPLv3），以避免 copyleft 污染專有服務

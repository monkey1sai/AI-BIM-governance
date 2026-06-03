# governance-bcf-export Specification

## Purpose
TBD - created by archiving change a1-bcf-export. Update Purpose after archive.
## Requirements
### Requirement: governance-service SHALL 把正式 issue 匯出為 BCF 2.1

`governance-service` SHALL 提供端點把正式 issue（`kind=issue` 且有 `ifc_guid`）匯出為 buildingSMART BCF 2.1 `.bcfzip`。匯出模組 SHALL 於執行期僅以標準庫（`zipfile` + `xml`）產生 `.bcfzip`，SHALL NOT import `bcf-client`（GPLv3），且匯出產物 SHALL NOT 含 `bcf-client` 任何程式碼。敘述上 SHALL 誠實：A1 IDS 匯入所需的 `ifctester` 會在環境 **transitive 安裝 `bcf-client`（GPLv3）**，因此 SHALL NOT 宣稱「整個環境不依賴 GPLv3」；正確範圍為「BCF 匯出模組與其產物不連結該套件」。每個 topic 的 viewpoint SHALL 以 IFC `GlobalId`（`IfcGuid`）定位構件；`IfcGuid` SHALL 為合法的 22 字元 base64-IFC 編碼，不符者 SHALL NOT 匯出（避免產出違反 BCF 2.1 XSD 的 `.bcfzip`）。comment SHALL 帶 `model_version` 以保留溯源；缺值時 SHALL 以明確佔位字（如 `unbound`）輸出，SHALL NOT 洩漏程式語言內部的 `None` 字面。時間戳 SHALL 以 UTC（`Z` 結尾）輸出，無時區資訊的 naive 時間 SHALL 視為 UTC（不套用系統本地時區偏移）。瀏覽器 SHALL 只經 coordinator proxy 取得 `.bcfzip`，不直連內部服務。

#### Scenario: 匯出含正式 issue 的 BCF

- **WHEN** 有至少一個正式 issue（`kind=issue` 且有 `ifc_guid`）且查詢 BCF 匯出端點
- **THEN** `governance-service` SHALL 回傳 `application/octet-stream` 的 `.bcfzip`
- **AND** zip 內 SHALL 含 `bcf.version`（VersionId=2.1），且每個正式 issue 對應一個 `<topic_guid>/markup.bcf` 與 `<topic_guid>/viewpoint.bcfv`
- **AND** viewpoint 的 `Component` SHALL 以該 issue 的 `ifc_guid` 作為 `IfcGuid`

#### Scenario: 非法 IfcGuid 不匯出

- **WHEN** 某個 `kind=issue` 的 issue 其 `ifc_guid` 不是合法的 22 字元 IfcGuid（如過短或含非法字元）
- **THEN** 該 issue SHALL NOT 出現在 `.bcfzip` 中
- **AND** 匯出 SHALL NOT 因此產生違反 BCF 2.1 XSD 的 viewpoint

#### Scenario: 缺值溯源輸出佔位字而非 None

- **WHEN** 一個正式 issue 缺少 `model_version_id`（未綁版本）而被匯出
- **THEN** comment 中 `model_version` SHALL 輸出明確佔位字 `unbound`
- **AND** comment SHALL NOT 出現程式語言內部的 `None` 字面

#### Scenario: naive 時間視為 UTC

- **WHEN** issue 的時間戳沒有時區資訊（naive）
- **THEN** 匯出的 BCF 時間 SHALL 視該時間為 UTC 並以 `Z` 結尾輸出
- **AND** SHALL NOT 因系統本地時區而偏移

#### Scenario: annotation 與無 GUID issue 不匯出

- **WHEN** 匯出時某些 issue 為 `annotation` 或沒有 `ifc_guid`
- **THEN** 這些 issue SHALL NOT 出現在 `.bcfzip` 中（BCF 主鍵為 IfcGuid，無 guid 無法在其他工具還原）
- **AND** 當沒有任何可匯出的正式 issue 時，端點 SHALL 回 404 並誠實說明，而非回空 zip

#### Scenario: 經 coordinator proxy 取得且匯出模組不連結 GPLv3

- **WHEN** 瀏覽器要下載 BCF
- **THEN** 請求 SHALL 經 coordinator `:8004` 的 `/api/governance/bcf/export` 二進位透傳至 governance-service
- **AND** BCF 匯出模組 SHALL NOT import `bcf-client`（GPLv3），匯出產物 SHALL NOT 含其程式碼，以避免 copyleft 連結污染專有服務

#### Scenario: 誠實揭露 ifctester transitive 帶入 GPLv3

- **WHEN** 描述本服務的 BCF 匯出授權狀態
- **THEN** 文件與程式註解 SHALL 誠實揭露 `ifctester`（供 IDS）會在環境 transitive 安裝 `bcf-client`（GPLv3）
- **AND** SHALL NOT 宣稱「整個環境不依賴 GPLv3 `bcf-client`」
- **AND** SHALL 將精確範圍限定為「BCF 匯出模組執行期不 import、產物不含其程式碼」

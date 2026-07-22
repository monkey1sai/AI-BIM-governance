## ADDED Requirements

### Requirement: 匯出 SHALL 產 BCF-API 3.0 JSON 並以官方 schema 驗證通過，禁自造私有格式

accepted issue 匯出時 SHALL 產 BCF-API 3.0 topic/comment/viewpoint JSON（含 guid、viewpoint 相機、GUID 綁定），SHALL NOT 自造私有格式；匯出物 SHALL 以官方 JSON schema 驗證通過為準。MVP SHALL 只做匯出端點（疊加於既有 BCF-IDS 匯出旁），SHALL NOT 實作完整 OpenCDE Foundation API server。

> OQ-B 已於 2026-07-22 裁決：原話「BFC3.0 一併納入本期」（BFC 為 BCF 之誤植）——BCFzip（BCF-XML 3.0）serializer 納入本期交付，不再列 fast-follow，見「BCFzip 匯出」Requirement。

#### Scenario: 匯出 accepted issues

- **WHEN** 匯出 3 筆 accepted issues
- **THEN** SHALL 產 BCF-API 3.0 topic/comment/viewpoint JSON
- **AND** JSON SHALL 對 BCF-API 3.0 官方 schema 驗證 0 error

### Requirement: 匯出 SHALL 一併提供 BCFzip（BCF-XML 3.0）供桌面工具直接開啟

除 BCF-API 3.0 JSON 外，匯出 SHALL 提供 BCFzip serializer：依 BCF-XML 3.0 官方規格產 .bcf zip 容器（markup／viewpoint 檔案佈局依官方規格），與 JSON 匯出共享同一 topic/comment/viewpoint 邏輯模型（同源資料，SHALL NOT 出現兩面不一致）。匯出物 SHALL 以官方 BCF-XML 3.0 schema（XSD）驗證通過為準，供 BIMcollab/Solibri/Revit 等桌面 BCF 工具直接開啟。

> 使用者裁決（2026-07-22，消解 OQ-B）：BCFzip 納入本期交付。

#### Scenario: 匯出 bcfzip

- **WHEN** 對 3 筆 accepted issues 匯出 BCFzip
- **THEN** SHALL 產出符合 BCF-XML 3.0 檔案佈局的 .bcf zip 容器
- **AND** SHALL 對官方 BCF-XML 3.0 schema 驗證 0 error

#### Scenario: 兩面同源一致

- **WHEN** 同一批 accepted issues 分別經 JSON 端點與 BCFzip 匯出
- **THEN** 兩者的 topic/comment/viewpoint 內容 SHALL 語意一致（同一邏輯模型序列化）

### Requirement: 驗證層 SHALL pin IFC 4.3 且幾何走 adapter 保留遷移路徑

規則/驗證引用 SHALL pin IFC 4.3（ISO 16739-1:2024）；幾何存取 SHALL 走 adapter，SHALL NOT 硬編 IFC4.3 entity，以保留 IFC5/IFCX 遷移路徑。

#### Scenario: 規則驗證引用版本

- **WHEN** 規則/驗證引用 IFC schema
- **THEN** SHALL pin IFC 4.3（ISO 16739-1:2024）
- **AND** 幾何存取 SHALL 走 adapter 不硬編 IFC4.3 entity

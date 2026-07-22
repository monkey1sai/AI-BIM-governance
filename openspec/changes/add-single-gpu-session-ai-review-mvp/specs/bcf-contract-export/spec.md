## ADDED Requirements

### Requirement: 匯出 SHALL 產 BCF-API 3.0 JSON 並以官方 schema 驗證通過，禁自造私有格式

accepted issue 匯出時 SHALL 產 BCF-API 3.0 topic/comment/viewpoint JSON（含 guid、viewpoint 相機、GUID 綁定），SHALL NOT 自造私有格式；匯出物 SHALL 以官方 JSON schema 驗證通過為準。MVP SHALL 只做匯出端點（疊加於既有 BCF-IDS 匯出旁），SHALL NOT 實作完整 OpenCDE Foundation API server。

> Open Question OQ-B：BCF-API 3.0 JSON 與 BCFzip 是兩種互通面共享同一邏輯模型；MVP 交付 JSON（API 面），桌面工具（BIMcollab/Solibri/Revit）互通需 BCFzip serializer（第二個 serializer，非 server），列 fast-follow，是否納入本期待使用者確認，見 proposal.md。

#### Scenario: 匯出 accepted issues

- **WHEN** 匯出 3 筆 accepted issues
- **THEN** SHALL 產 BCF-API 3.0 topic/comment/viewpoint JSON
- **AND** JSON SHALL 對 BCF-API 3.0 官方 schema 驗證 0 error

### Requirement: 驗證層 SHALL pin IFC 4.3 且幾何走 adapter 保留遷移路徑

規則/驗證引用 SHALL pin IFC 4.3（ISO 16739-1:2024）；幾何存取 SHALL 走 adapter，SHALL NOT 硬編 IFC4.3 entity，以保留 IFC5/IFCX 遷移路徑。

#### Scenario: 規則驗證引用版本

- **WHEN** 規則/驗證引用 IFC schema
- **THEN** SHALL pin IFC 4.3（ISO 16739-1:2024）
- **AND** 幾何存取 SHALL 走 adapter 不硬編 IFC4.3 entity

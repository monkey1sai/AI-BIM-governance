## ADDED Requirements

### Requirement: schedule.csv SHALL 保留 version-scoped RVT identity

Governed `schedule.csv` SHALL 至少包含 `ID` 與 `IfcGUID` 欄位。`ID` 與 source `IfcGUID` SHALL 以原始字串保存；`ID` 只宣告為該 `source_bundle_id` 內的 version-scoped RVT element ID，系統 MUST NOT 將其宣告為跨版本 global identity。有效 scheduled row SHALL 具非空唯一 `ID` 與可解析的唯一 UUID36 `IfcGUID`；UUID大小寫不影響 identity，系統 SHALL 另輸出 derived canonical `ifc_uuid36`。

#### Scenario: Valid scheduled element

- **WHEN** row 的 `ID` 非空且在 bundle 內唯一，`IfcGUID` 是可解析 UUID36且其 128-bit identity唯一
- **THEN** row SHALL 納入 RVT↔IFC alignment denominator
- **AND**原始 `ID` 字串 SHALL 不因 numeric coercion 或 leading zero 正規化而改變

#### Scenario: Duplicate 或 invalid row

- **WHEN** row 缺 ID/GUID、ID 重複、GUID 重複或 GUID 格式無效
- **THEN** row SHALL 進入具 reason code 的 invalid/duplicate 集合
- **AND** SHALL NOT 靜默算入 matched numerator

### Requirement: UUID36 與 IFC GlobalId22 SHALL 可逆對齊

`schedule.csv.IfcGUID` UUID36 與 IFC product `GlobalId` 22-character encoding SHALL 被視為同一 128-bit IFC identity 的可逆字串編碼。轉換 SHALL 以 derived canonical `ifc_uuid36` 驗證 round-trip；exact match以同一 128-bit value裁決，系統 MUST NOT 以大小寫、名稱、ordinal、幾何近似或 row position 冒充／拒絕 exact identity。

#### Scenario: UUID36 成功對應 IFC product

- **WHEN** UUID36 壓縮成合法 GlobalId22，且 round-trip回到相同128-bit identity與derived canonical `ifc_uuid36`
- **AND** source IFC 存在該 `GlobalId`
- **THEN** row SHALL 記為 RVT↔IFC exact match

#### Scenario: Transform 或 IFC lookup 失敗

- **WHEN** UUID36 無法 round-trip，或 source IFC 不存在對應 `GlobalId`
- **THEN** row SHALL 進入 CSV-only/unmatched 集合
- **AND** MUST NOT 自動改用 fuzzy identity 補配

### Requirement: Lineage mapping SHALL 指向既有 stable USD element root

Lineage mapping item SHALL additive 包含 `rvt_element_id`、`ifc_uuid36`、既有 `ifc_guid`、`usd_prim_path`、`mapping_status` 與 `diagnostics[]`。`usd_prim_path` SHALL 指向 streaming authority 已定義的 `/World/Elements/<IfcClass>/G_<encoded_guid>` stable element root，不得指向任意 tessellation child mesh。

#### Scenario: Full lineage match

- **WHEN** valid scheduled row 對應 IFC GlobalId，且 `element_mapping.json` 對應 stable root prim
- **THEN** item SHALL 記為 full RVT↔IFC↔USDC match
- **AND**四段 identity SHALL 可由報告/API 一次查閱

#### Scenario: Mapping 只指向 child mesh

- **WHEN** mapping path 指向 stable element root 下的任意 mesh child，而不是 element root
- **THEN**該 mapping SHALL 視為 USDC-unmapped/invalid lineage
- **AND** diagnostics SHALL 指出 `unstable_child_prim_target`

### Requirement: Alignment metrics SHALL 使用明確且不同的分母

系統 SHALL 分開輸出 `ifc_usdc_coverage_ratio`、`rvt_ifc_alignment_ratio` 與 `rvt_ifc_usdc_lineage_ratio`。前者分母為 eligible source `IfcProduct` count；若沿用 legacy `source_ifc_entity_count` field，schema MUST 明定它是同一 eligible集合的 alias。後兩者分母固定為 valid unique scheduled elements。報告 SHALL 同時輸出 CSV total/valid、eligible IFC product count、duplicate ID/GUID、invalid、CSV-only、IFC-only、IFC→USDC unmapped 與 full-lineage matched counts/sets。

#### Scenario: Metrics 計算

- **WHEN** alignment 完成
- **THEN**每個 ratio SHALL 同時附 `numerator`、`denominator` 與計算 scope
- **AND** generic `coverage_ratio` MUST NOT 被當成 RVT lineage accuracy

#### Scenario: Ratio denominator 為零

- **WHEN**任一 metric 的 eligible denominator 為 0
- **THEN** ratio SHALL 為 `null` 且 status SHALL 為 `not_evaluable`
- **AND**系統 MUST NOT 宣稱 0% 或 100%

#### Scenario: IFC-only products 存在

- **WHEN** source IFC 含有不在 valid schedule rows 的 products
- **THEN**它們 SHALL 列入 IFC-only 集合
- **AND** SHALL NOT 增加 `rvt_ifc_alignment_ratio` 或 `rvt_ifc_usdc_lineage_ratio` 的分母

### Requirement: Partial alignment SHALL 可交付但必須誠實揭露

完整 conversion 可在 alignment 不完整時標為 `succeeded_with_warnings`，但 result manifest、獨立Cloud Ingest lineage summary 與 lineage UI SHALL 顯示所有 alignment ratios、numerator/denominator、diff counts 與 warning codes；既有workflow callback contract保持不變。系統 SHALL 提供 machine-readable JSON 與 operator-downloadable CSV report。

#### Scenario: Conversion 成功但有 CSV-only rows

- **WHEN** USDC 可開啟且 formal result artifacts 完整，但部分 valid scheduled rows 未對應 IFC/USDC
- **THEN** result MAY 成為 `AVAILABLE` with `succeeded_with_warnings`
- **AND** SHALL NOT 宣稱 100% RVT↔IFC↔USDC lineage

## ADDED Requirements

### Requirement: 規則式碰撞審查 SHALL 以 IfcClash 產 findings 且缺依賴 fail-loud

審查引擎 SHALL 採 Finding SPI（checker 介面）。deterministic checker（IfcClash CLI/Python lib）SHALL 承擔主審查量；LLM 分流/優化建議層 SHALL 設計成故障或超預算時可整層停用而不中斷核心審查閉環（MVP SHALL NOT 建 LLM 層，僅凍結此降級接縫）。以 IfcClash 對已轉檔模型跑 clash set SHALL 產 findings。ifcopenshell 缺 OpenCASCADE（`has_occ=False`）時跑 clash SHALL 明確報錯（fail-loud）而非靜默回 0。超大模型進審查 SHALL 有 size guard 攔截避免逾時。

> Open Question OQ-2：MVP 的「AI 審查」實為零模型推論的確定性 IfcClash，`source_type=ai_review` 實為規則集版本號；須向使用者揭示 headline 落差，見 proposal.md。

#### Scenario: 正常碰撞審查

- **WHEN** 對已轉檔模型以 IfcClash 跑 clash set
- **THEN** SHALL 產出 clash findings

#### Scenario: 缺 OpenCASCADE

- **WHEN** ifcopenshell `has_occ=False` 時跑 clash
- **THEN** SHALL 明確報錯（fail-loud）
- **AND** SHALL NOT 靜默回 0 findings

#### Scenario: 超大模型

- **WHEN** 超大模型進審查
- **THEN** size guard SHALL 攔截避免逾時

### Requirement: finding ingest SHALL fail-closed 強制證據包欄位並以 IFC 世界座標表述 viewpoint

一筆 finding 進入 triage 佇列前的 ingest 驗證 SHALL 強制附：元件 GUID + 規則/條文引用 + BCF viewpoint（MVP 由幾何 bounding box 離線計算相機參數，非 live Kit 擷取）+ 信心值 + abstain 標記；缺任一欄位 SHALL 拒收（fail-closed）並進 abstain 桶不進佇列。viewpoint 相機參數 SHALL 以 IFC 模型世界座標系表述；轉檔管線 IFC→USD 的座標變換（含 georeference offset）SHALL 記入 ConversionLedger，保留可稽核變換鏈供 viewpoint 反算與幾何驗證使用。

#### Scenario: 完整證據包 finding

- **WHEN** 一筆 clash finding 含元件 GUID、clash set 規則名、以 IFC 座標表述的自動相機 viewpoint、信心值
- **THEN** SHALL 通過 ingest 驗證並出現在佇列
- **AND** SHALL 可視覺定位

#### Scenario: ingest 缺欄位

- **WHEN** finding 缺 GUID/規則引用/viewpoint/信心值任一欄位
- **THEN** SHALL 拒收（fail-closed）
- **AND** SHALL 進 abstain 桶不進佇列

### Requirement: AI 審查產出 SHALL 一律為 draft 狀態，SHALL NOT 直接建立正式 issue

AI 審查產出落庫 SHALL 一律為 draft 狀態（issues store 疊加 `source_type=ai_review` 與 draft 狀態，不改既有狀態機語意）；draft SHALL NOT 出現在正式 issue 清單、SHALL NOT 觸發任何派發。

#### Scenario: 審查跑完落庫

- **WHEN** AI 審查跑完 120 筆 finding 落庫
- **THEN** 正式 issues 淨增 SHALL 為 0
- **AND** triage 佇列 SHALL 增加對應 draft（經去重後為分組視圖）

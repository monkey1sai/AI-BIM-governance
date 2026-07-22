## ADDED Requirements

### Requirement: 規則式碰撞審查 SHALL 以 IfcClash 產 findings 且缺依賴 fail-loud

審查引擎 SHALL 採 Finding SPI（checker 介面）。deterministic checker（IfcClash CLI/Python lib）SHALL 承擔主審查量；LLM 分流層 SHALL 設計成故障或超預算時可整層停用而不中斷核心審查閉環（LLM 分流層依 2026-07-22 使用者裁決納入 MVP，見「本地小模型 LLM 分流」Requirement）。以 IfcClash 對已轉檔模型跑 clash set SHALL 產 findings。ifcopenshell 缺 OpenCASCADE（`has_occ=False`）時跑 clash SHALL 明確報錯（fail-loud）而非靜默回 0。超大模型進審查 SHALL 有 size guard 攔截避免逾時。

> OQ-2 已於 2026-07-22 裁決：原話「接受本地小模型LLM分流」——MVP 納入以本地小模型實作的最小 LLM 分流層，取代「僅凍結接縫」方案；deterministic IfcClash 仍承擔主審查量與正確性底線。

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

### Requirement: LLM 分流層 SHALL 以本地小模型實作且僅產 advisory 欄位，停用不中斷審查

MVP SHALL 落地最小 LLM 分流層：以本地部署的小型模型（local inference，如 Ollama／llama.cpp 類服務的開源小模型，選型於實作期收斂）對通過 ingest 驗證的 finding 產生分流註記（嚴重度建議、分組建議、自然語言摘要等 advisory 欄位，具體欄位實作期定案）。LLM 產出 SHALL 僅寫入 draft 的 advisory 欄位：SHALL NOT 修改證據包既有強制欄位、SHALL NOT 繞過 draft gate、SHALL NOT 觸發自動 accept／建立／關閉／指派。每筆 LLM 註記 SHALL 標註模型 id 與版本，使 `source_type=ai_review` 的 AI 版本標記具真實模型語意。推論 SHALL 於本地／內網執行，SHALL NOT 引入外部雲端 LLM API 依賴（審查資料不出域）。LLM 層停用、故障或逾時 SHALL 整層降級：finding 以無 LLM 註記形式照常入佇列，deterministic 審查閉環 SHALL 不中斷。

> 使用者裁決（2026-07-22，消解 OQ-2）：接受本地小模型 LLM 分流納入 MVP。

#### Scenario: LLM 分流註記

- **WHEN** 一筆 finding 通過 ingest 驗證且 LLM 分流層啟用
- **THEN** draft SHALL 附 advisory 分流註記與模型 id/版本標記
- **AND** 證據包既有強制欄位 SHALL 保持不變

#### Scenario: LLM 層停用降級

- **WHEN** LLM 分流層停用、故障或逾時
- **THEN** finding SHALL 以無 LLM 註記形式照常入 triage 佇列
- **AND** deterministic 審查閉環 SHALL 不中斷

#### Scenario: LLM 不得越權

- **WHEN** LLM 分流層嘗試寫入人審欄位或建立正式 issue
- **THEN** SHALL 被拒絕（欄位所有權 fail-loud）
- **AND** 正式 issue 淨增 SHALL 僅來自人審 accept

### Requirement: AI 審查產出 SHALL 一律為 draft 狀態，SHALL NOT 直接建立正式 issue

AI 審查產出落庫 SHALL 一律為 draft 狀態（issues store 疊加 `source_type=ai_review` 與 draft 狀態，不改既有狀態機語意）；draft SHALL NOT 出現在正式 issue 清單、SHALL NOT 觸發任何派發。

#### Scenario: 審查跑完落庫

- **WHEN** AI 審查跑完 120 筆 finding 落庫
- **THEN** 正式 issues 淨增 SHALL 為 0
- **AND** triage 佇列 SHALL 增加對應 draft（經去重後為分組視圖）

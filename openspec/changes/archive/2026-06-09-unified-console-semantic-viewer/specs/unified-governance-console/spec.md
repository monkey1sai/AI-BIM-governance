## ADDED Requirements

### Requirement: primary 治理 viewer SHALL 採範本式全幅語意驗證版面，A1/A2/A3 operation 與 IFC 語意 metadata 清楚分區

primary 治理 viewer SHALL 以全幅多分區版面呈現（對齊使用者核可範本 6 面板：模型資訊、IFC 語意、結構樹、GUID⇔Prim 對構表、幾何定位、Pset/空間關係），SHALL NOT 沿用固定窄 overlay 把所有面板堆疊吃滿捲軸。A1/A2/A3 治理 operation（rule-run 觸發、失敗構件→3D 高亮、issue/BCF、Stage/Artifact Binding）SHALL 收進清楚的操作分頁/區段，IFC 語意 metadata SHALL 於語意視圖分區呈現；既有能力（rule-run/highlight/issue/BCF/BindingComposer、spectator 三層權威、MappingCache/HighlightBridge）SHALL 全保留。版面 SHALL 遵循 `docs/frontend/frontend-design-guidelines.md`（深色操作員風、語義色、無障礙 WCAG AA、無 AI-slop 紫漸層白底）。

#### Scenario: 全幅 6 分區版面 + 治理操作分頁，既有能力保留

- **WHEN** 真人開 primary 治理 viewer
- **THEN** SHALL 見全幅多分區版面（模型資訊卡 / 結構樹 / 中央視區+工具列 / 對構表 / IFC 語意 + 空間 inspector），SHALL NOT 是單一窄 overlay 堆疊捲軸
- **AND** A1/A2/A3 operation SHALL 可於操作分頁/區段觸發（rule-run、失敗構件→3D 高亮、issue/BCF、Binding），spectator SHALL 維持三層唯讀權威
- **AND** SHALL 具 browser E2E 截圖證據（`gov-viewer-layout`）

### Requirement: 中央 3D 視區 SHALL 誠實不空白（無 GPU 時資訊濃密 mock viewport，有 GPU 時真 Kit 幀）

中央視區 SHALL NOT 在無 GPU/harness 情境呈現「空白且無說明」的畫面。當無真實 WebRTC 視訊幀時（`harnessEnabled()` 或 `!_hasRemoteVideoFrame()`），SHALL 呈現資訊濃密 mock viewport（至少含 Stage URL、loaded prim 數、selected prim、highlight echo、camera 狀態）並明確標示為「deterministic · no-GPU」，使檢視者不致誤判為壞掉；當真實 Kit 視訊幀可用時，SHALL 自動切換為真實 `<video>` 串流。mock viewport SHALL 為可決定性（同輸入同輸出）、不依賴 GPU、不引入新 3D 引擎生產依賴。

#### Scenario: harness/無 GPU 時中央視區顯示資訊而非空白

- **WHEN** 在 harness/無 GPU 情境開 viewer
- **THEN** 中央 SHALL 顯 mock viewport（Stage URL/loaded prims/selected/highlight echo），明標 no-GPU 決定性，SHALL NOT 全空白
- **AND** 點結構樹/對構表元件 SHALL 在 mock viewport 產生可見 focus/highlight 回饋（echo）
- **AND** 有真實 Kit 視訊幀時 SHALL 自動切真 `<video>`，SHALL 具 E2E 截圖證據（不空白）

### Requirement: IFC 語意/結構/空間面板 SHALL 經 coordinator resolve+forward 取真實 per-element 語意，缺資料誠實標示

② IFC 語意（Type/PredefinedType/ObjectType/Tag/Pset_*/Quantity_*）、③ 分層結構樹（IfcProject>Site>Building>Storey + type 計數）、⑥ 空間關係（Contained In/Building/Site）SHALL 由真實 IFC 語意提供：governance-service SHALL 以 `ifcopenshell`（`get_psets`/`get_container`）萃取 per-element 語意；前端 SHALL 只經 coordinator `:8004` 的 `GET /api/governance/elements/for-session/:sessionId/:guid`（coordinator resolve session→server IFC 路徑後 forward），SHALL NOT 直連 governance-service `:49102`。① 模型資訊與 ④ GUID⇔Prim 對構表 SHALL 用現有真實 artifact（`quality_metrics_summary`/`element_mapping.json`，含 fake-vs-real 隔離）。⑤ 幾何（Bounding Box/體積/材質）與分類碼（MasterFormat/OmniClass/Uniformat）目前無 pipeline 來源者，SHALL 誠實標示為 roadmap/N/A，SHALL NOT 捏造數值。coordinator SHALL 僅 resolve+forward（不執行語意萃取、不成為新資料權威），SHALL NOT 新增生產依賴。

#### Scenario: 點構件取真實 Pset/空間，缺資料誠實 roadmap

- **WHEN** 真人於 viewer 點選一個 IFC 構件
- **THEN** ② 面板 SHALL 顯該構件真實 IFC Type/PredefinedType/Tag + Pset/Quantity（經 coordinator forward 自 governance-service ifcopenshell 萃取），⑥ 面板 SHALL 顯真實空間容納關係
- **AND** ① 模型資訊與 ④ 對構表 SHALL 顯現有真實 artifact 值（fake mapping 時顯 fake banner、不冒充）
- **AND** ⑤ 幾何/分類碼無來源時 SHALL 顯 `—`/roadmap 標示，SHALL NOT 捏造；前端 SHALL 只打 :8004

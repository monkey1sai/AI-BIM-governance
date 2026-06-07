## Why

primary 治理 viewer 目前有兩個體驗問題（5-agent 實查 + 使用者指正）：(1) E2E 多走 harness（無 GPU），`FakeAppStreamer` 從不餵 `<video>` → 中央視區**空白**、截圖像壞掉、不友善；(2) A1/A2/A3 operation + metadata + 3D 風格太差——固定 340px 窄 overlay、字小行密、面板堆疊吃滿捲軸、無 KPI 卡、只顯 `rule_code/guid` 三欄，語意深度遠不及使用者提供的範本（AI-BIM-Geo Viewer 6 面板）。

本 change 依使用者核可方向重設計 primary viewer：對齊範本 6 面板的全幅「IFC→USD 語意驗證」版面，中央視區**不再空白**（harness 用資訊濃密 mock viewport，有 GPU 時自動切真 Kit 幀），A1/A2/A3 operation 收進乾淨分頁，全程誠實標示。資料採「真實優先」：①模型資訊、④對構表用現有真資料；②IFC語意、③分層樹、⑥空間靠**新增 governance per-element 語意端點**（ifcopenshell `get_psets`/`get_container`，後端已有能力、只差 API）；⑤幾何(BBox/材質) 與分類碼(MasterFormat/OmniClass/Uniformat) 現無 pipeline → 誠實標 roadmap/N/A。分兩階段：CH-H1（純前端版面 + ①④ + mock viewport）、CH-H2（後端語意端點 + ②③⑥）。

## What Changes

- **CH-H1 前端版面（`web-viewer-sample`）**：新元件 `console/viewer/`（`GovViewerLayout`/`ModelInfoCard`/`MappingTable`/`MockViewport`）；範本 6 分區 grid + 分頁 nav（模型/問題）；① 真 coverage（`quality_metrics_summary`+mapping summary，client 算 % + `isFakeMappingDocument` 檢查）；④ 真對構表（`element_mapping.json` 含 confidence/method，fake-vs-real 隔離）；**MockViewport 取代空白視區**（`harnessEnabled() || !_hasRemoteVideoFrame()` 顯 Stage/loaded prims/selected/highlight echo，明標 no-GPU 決定性；有真幀切 `<video>`）；工具列 select/pan/orbit/zoom 接既有 DataChannel，section/measure 誠實 p15 disabled。既有能力（rule-run/highlight/issue/BCF/BindingComposer/spectator gate）全保留、重新安置進「問題」分頁。
- **CH-H2 後端語意（`governance-service` + `bim-review-coordinator`）**：新增 governance per-element 語意端點（`ifcopenshell get_psets`/`get_container`/type/predefined_type/tag）；coordinator `GET /api/governance/elements/for-session/:sessionId/:guid`（resolve session→server IFC 路徑→forward，沿用既有 `rule-runs/for-session` 模式）；前端 ② IFC 語意（Type/PredefinedType/Tag/Pset_*/Quantity_*）+ ⑥ 空間（Contained In/Building/Site）+ ③ 分層樹計數；⑤ 幾何 + 分類碼誠實 roadmap。

## Capabilities

### New Capabilities

- None（實作交付，不新增 capability）。

### Modified Capabilities

- `unified-governance-console`：新增可驗收 requirements（primary viewer 範本 6 面板版面、中央視區誠實不空白、per-element 語意 resolve+forward 端點、缺資料誠實 roadmap）。不修改既有 live 行為要求。

## Impact

- Owner repo / folder：`web-viewer-sample/src/console/viewer/`（新元件）+ `Window.tsx`（overlay→新版面掛載，RK5 HIGH 先 gitnexus_impact 抽元件）+ `e2e/`；`governance-service`（per-element 語意端點 + ifcopenshell 萃取）；`bim-review-coordinator/src/routes/governanceProxy.ts`（for-session element proxy）。
- API / data shape：新增 governance per-element 語意端點 + coordinator proxy；既有 element_mapping/stream-config/rule-run data shape 不變。
- Runtime boundary：前端只打 :8004；governance-service 仍 IFC 讀取權威，coordinator 只 resolve+forward；3D 著色走既有 viewer↔Kit WebRTC DataChannel；無新增 prod 依賴；不復活 server-push highlight。
- 驗證：`web-viewer-sample` tsc/vitest/Playwright（新增 gov-viewer-layout、element-semantics specs，截圖不空白）；`governance-service` pytest（語意端點）；`bim-review-coordinator` vitest（proxy）。rebuild→deploy→真實 IFC→A1/A2/A3→IA 對齊。
- Non-goals：⑤ 幾何(BBox/體積/材質) 與分類碼(MasterFormat/OmniClass/Uniformat) 不在此 change 補真（誠實 roadmap/N/A，IFC 無來源即 N/A）；camera fit-to-bounds（georeferenced 黑畫面）列選配；不接 spectator 多人 viewport sharing。

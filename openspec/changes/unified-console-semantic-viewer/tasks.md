# Tasks — unified-console-semantic-viewer（primary 治理 viewer 重設計，對齊範本 6 面板）

> 兩階段：CH-H1（純前端版面 + ①④真 + mock viewport）、CH-H2（後端語意端點 + ②③⑥真）。done = browser E2E 證據（Playwright 截圖/trace，不空白）。誠實鐵律：缺資料標 roadmap/N/A，不捏造。

## 1. CH-H1 — 前端全幅語意驗證版面（純前端，可逆）

- [~] 1.1 `console/viewer/`：CH-H1a 先交付 MockViewport 組合（①模型資訊 + ④對構表 + viewport 狀態 echo + layers），**全分頁 nav（模型/問題）+ 把 A1/A2/A3 ops 移進「問題」分頁的完整 GovViewerLayout 外殼留 CH-H1b**
- [x] 1.2 `ModelInfoCard.tsx`（①）：真資料（quality_metrics_summary fixture/轉換時間/元件數 + mapped_count）；coverage% 由 coverage_ratio 原樣×100 + `isFakeMappingDocument` 誠實檢查
- [x] 1.3 `MappingTable.tsx`（④）：真 `element_mapping.json`（guid/class/name/prim_path/confidence/method）+ fake-vs-real 隔離（fake banner + 逐列 fake）+ 誠實空狀態（無 mapping_url）
- [x] 1.4 `MockViewport.tsx`：取代空白視區——`showStream && !_hasRemoteVideoFrame()` 顯資訊濃密佔位（Stage URL/loaded layers/selected echo，明標 deterministic·no-GPU）；有真 Kit 幀 Window 不渲染本元件讓 `<video>` 顯示
- [ ] 1.5 工具列 select/pan/orbit/zoom 接既有 DataChannel；section/measure 誠實 p15 disabled；③ 結構樹用既有 USD 樹（留 CH-H1b）
- [x] 1.6 `Window.tsx` additive 掛載 MockViewport（gitnexus_impact GovernanceOverlay=LOW；單一 conditional block，不改 AppStream/overlay/stage-truth/spectator）
- [x] 1.7 E2E `gov-viewer-layout.spec.ts`（harness）：mock-viewport/banner/model-info-card/mapping-table/layers/selected 皆在、截圖不空白；viewer-harness + viewer-tree-focus 無回歸

## 2. CH-H2 — 後端 per-element 語意端點 + ②③⑥ 真資料

- [x] 2.1 governance-service `GET /api/elements/semantics`：真 `ifcopenshell get_psets`(剝合成 id)/`get_container`+`get_aggregate` 空間鏈/type/predefined_type/object_type/tag（輸入 server IFC 路徑 + ifc_guid；404/400）— live 驗 ×2：fixture-bytes 真 IfcDoor 多 Pset+Qto；**真 87MB 許良宇 IFC 200/5.5s 空間鏈 Storey>Building>Site>Project**（scales to 真實部署模型）
- [x] 2.2 coordinator `GET /api/governance/elements/for-session/:sessionId/:guid`：resolve session→host IFC 路徑→forward（沿用 rule-runs/for-session resolver，server path 不外洩；400/404/502）
- [x] 2.3 前端 ② IFC 語意面板（Type/PredefinedType/ObjectType/Tag/Pset_*/Quantity_*）：點構件 lazy fetch（IfcSemanticPanel/IfcSemanticView）— browser e2e PASS
- [x] 2.4 前端 ⑥ 空間關係（IfcBuildingStorey/Building/Site 容納鏈）— browser e2e PASS
- [~] 2.5 前端 ③ 結構：**依類別計數 MVP 已做**（StructureStats，真實 element_mapping 派生 IfcWall N/IfcColumn N…，browser e2e 驗）；完整空間巢狀樹（Project>Site>Building>Storey）需後端 hierarchy 端點 → 誠實 roadmap、留後續
- [x] 2.6 ⑤ 幾何(BBox/體積/材質) + 分類碼(MasterFormat/OmniClass/Uniformat)：誠實 ⌛roadmap/N/A（端點回 null+roadmap；前端 sem-roadmap 顯示，不捏造）
- [x] 2.7 governance-service pytest（4+全 82）+ coordinator vitest（10）+ **前端 browser E2E `element-semantics`（真 session→點對構表→②Pset/Type+⑥空間+⑤roadmap）PASS** + node 全鏈 smoke（:8004 for-session 200，真 87MB IFC）
- [x] 2.8 對抗修復：(a) MockViewport gate 改為無 GPU 真 session 也可用；(b) ④對構表改經 coordinator element-mapping proxy（守邊界 + CORS-safe，不直連 :49101）— 皆 e2e 驗 + 無回歸

## 3. 驗證 / 對抗 / 對齊

- [x] 3.1 `web-viewer-sample` `npx tsc --noEmit` 0 error + `npm test` **162 passed** + Playwright **13 specs 全綠**（gov-viewer-layout 截圖不空白；無回歸）— CH-H1a 範圍
- [~] 3.2 `governance-service` pytest（per-element 語意端點待 CH-H2）；`bim-review-coordinator` CH-H1a 純前端未改（CH-H2 補 proxy 時驗）
- [x] 3.3 rebuild（dist-ui + docker viewer）→deploy→真實 ./storage IFC 走新 viewer（real-ifc 三鏈綠）→A1(rule-run score 99 / 7126 構件 / 71 真 failed+ifc_guid)/A2(diff 202)/A3(federation 201) 功能驗證；governance-service 已啟動 :49102
- [~] 3.4 IA 對齊部分（CH-H1b 後續）；**多 agent 對抗驗證 2 輪 + live-e2e**：round1（CH-H1a，4 opus）→ 1 high（guid_exact 捏造）修 `7f9e431`；live-e2e → 2 high（MockViewport gate 無 GPU 不可用、④直連 :49101 違邊界/CORS）修 `8ee9c04`；round2（CH-H2，3 opus correctness/honesty+boundary/regression）→ **0 high/blocker**。共修 3 真 bug。CH-H1b 完整版面 + repo-wide 對抗為後續。

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

- [ ] 2.1 governance-service per-element 語意端點：`ifcopenshell get_psets`/`get_container`/type/predefined_type/tag（輸入 server IFC 路徑 + ifc_guid）
- [ ] 2.2 coordinator `GET /api/governance/elements/for-session/:sessionId/:guid`：resolve session→IFC 路徑→forward（沿用 rule-runs/for-session 模式，前端只打 :8004）
- [ ] 2.3 前端 ② IFC 語意面板（Type/PredefinedType/ObjectType/Tag/Pset_*/Quantity_*）：點構件 lazy fetch
- [ ] 2.4 前端 ⑥ 空間關係（Contained In/IfcBuildingStorey/Building/Site）
- [ ] 2.5 前端 ③ 分層結構樹（IfcProject>Site>Building>Storey + type 計數）
- [ ] 2.6 ⑤ 幾何(BBox/體積/材質) + 分類碼(MasterFormat/OmniClass/Uniformat)：誠實 ⌛roadmap/N/A（不捏造）
- [ ] 2.7 E2E `element-semantics.spec.ts`（點構件→② Pset/Type、⑥ spatial 出現）+ governance-service pytest 端點測試

## 3. 驗證 / 對抗 / 對齊

- [x] 3.1 `web-viewer-sample` `npx tsc --noEmit` 0 error + `npm test` **162 passed** + Playwright **13 specs 全綠**（gov-viewer-layout 截圖不空白；無回歸）— CH-H1a 範圍
- [~] 3.2 `governance-service` pytest（per-element 語意端點待 CH-H2）；`bim-review-coordinator` CH-H1a 純前端未改（CH-H2 補 proxy 時驗）
- [x] 3.3 rebuild（dist-ui + docker viewer）→deploy→真實 ./storage IFC 走新 viewer（real-ifc 三鏈綠）→A1(rule-run score 99 / 7126 構件 / 71 真 failed+ifc_guid)/A2(diff 202)/A3(federation 201) 功能驗證；governance-service 已啟動 :49102
- [~] 3.4 IA 對齊部分（CH-H1b/CH-H2 進一步）；**多 agent 對抗驗證 round 1 完成**（4 opus lens + 對抗確認 → 1 confirmed high：ModelInfoCard 捏造 guid_exact → 已修 `7f9e431` + 鎖單元測試）；CH-H1b/CH-H2 後續 round 續清

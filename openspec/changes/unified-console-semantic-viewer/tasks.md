# Tasks — unified-console-semantic-viewer（primary 治理 viewer 重設計，對齊範本 6 面板）

> 兩階段：CH-H1（純前端版面 + ①④真 + mock viewport）、CH-H2（後端語意端點 + ②③⑥真）。done = browser E2E 證據（Playwright 截圖/trace，不空白）。誠實鐵律：缺資料標 roadmap/N/A，不捏造。

## 1. CH-H1 — 前端全幅語意驗證版面（純前端，可逆）

- [ ] 1.1 `console/viewer/GovViewerLayout.tsx`：範本 6 分區 CSS grid 外殼 + 分頁 nav（模型/問題）；既有治理能力安置進「問題」分頁
- [ ] 1.2 `ModelInfoCard.tsx`（①）：真資料（quality_metrics_summary fixture/轉換時間/元件數 + element_mapping.summary）；coverage% client 算 + `isFakeMappingDocument` 誠實檢查
- [ ] 1.3 `MappingTable.tsx`（④）：真 `element_mapping.json`（guid/class/name/prim_path/confidence/method）+ fake-vs-real 隔離（fake banner）
- [ ] 1.4 `MockViewport.tsx`：取代空白視區——`harnessEnabled() || !_hasRemoteVideoFrame()` 顯資訊濃密佔位（Stage URL/loaded prims/selected prim/highlight echo/camera state，明標 no-GPU 決定性）；有真 Kit 幀自動切 `<video>`
- [ ] 1.5 工具列 select/pan/orbit/zoom 接既有 DataChannel；section/measure 誠實 p15 disabled；③ 結構樹用既有 USD 樹
- [ ] 1.6 `Window.tsx` 掛載新版面（先 `gitnexus_impact`，RK5 HIGH，邏輯抽元件降爆炸半徑；spectator 三層權威保留）
- [ ] 1.7 E2E `gov-viewer-layout.spec.ts`（harness）：6 面板容器都在、① 真 coverage、④ mapping rows、mock viewport 顯 Stage/prims/selected（截圖不空白）、點樹→focus echo

## 2. CH-H2 — 後端 per-element 語意端點 + ②③⑥ 真資料

- [ ] 2.1 governance-service per-element 語意端點：`ifcopenshell get_psets`/`get_container`/type/predefined_type/tag（輸入 server IFC 路徑 + ifc_guid）
- [ ] 2.2 coordinator `GET /api/governance/elements/for-session/:sessionId/:guid`：resolve session→IFC 路徑→forward（沿用 rule-runs/for-session 模式，前端只打 :8004）
- [ ] 2.3 前端 ② IFC 語意面板（Type/PredefinedType/ObjectType/Tag/Pset_*/Quantity_*）：點構件 lazy fetch
- [ ] 2.4 前端 ⑥ 空間關係（Contained In/IfcBuildingStorey/Building/Site）
- [ ] 2.5 前端 ③ 分層結構樹（IfcProject>Site>Building>Storey + type 計數）
- [ ] 2.6 ⑤ 幾何(BBox/體積/材質) + 分類碼(MasterFormat/OmniClass/Uniformat)：誠實 ⌛roadmap/N/A（不捏造）
- [ ] 2.7 E2E `element-semantics.spec.ts`（點構件→② Pset/Type、⑥ spatial 出現）+ governance-service pytest 端點測試

## 3. 驗證 / 對抗 / 對齊

- [ ] 3.1 `web-viewer-sample` `npx tsc --noEmit` 0 error + `npm test` 綠 + Playwright 全 specs 綠（截圖不空白）
- [ ] 3.2 `governance-service` pytest 綠（含語意端點）；`bim-review-coordinator` build + vitest 綠（含 proxy）
- [ ] 3.3 rebuild→deploy→真實 ./storage IFC 走新 viewer→A1(rule-run)/A2(diff)/A3(federation) 功能驗證
- [ ] 3.4 對齊 `frontend-redesign-ia-and-phases.html`；多 agent 交叉對抗驗證；fix/risk/bug/block/smoke 全清

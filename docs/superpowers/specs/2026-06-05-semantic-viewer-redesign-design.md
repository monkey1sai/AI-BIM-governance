# Semantic Viewer 重設計（primary 治理 viewer）設計 spec

> 來源：brainstorming（2026-06-05）+ 5-agent 探索 + 使用者核可（資料深度=真實優先、3D=強化 harness 佔位、範圍=分期 CH-H1/H2）。
> 範本：使用者提供 AI-BIM-Geo Viewer 參考圖（6 編號面板）。設計尺規：`docs/frontend/frontend-design-guidelines.md`（Anthropic）+ `frontend-redesign-ia-and-phases.html`。
> 誠實鐵律：沒有真人可開 URL／點按鈕／用 fixture／看到結果 + Playwright 證據前不得宣告 done；缺資料一律誠實標 roadmap/N/A，不捏造。

## 1. 問題（issue）

1. 1~7 期 E2E 多走 harness（無 GPU）→ `FakeAppStreamer` 從不餵 `<video>` → 中央視區**空白**，截圖像「壞掉」、不友善。
2. primary 顯示 A1/A2/A3 operation + metadata + 3D viewer **風格太差**：固定 340px 窄 overlay、字小行密、面板堆疊吃滿捲軸、無 KPI 摘要卡、只顯 `rule_code/guid` 三欄，語意深度遠不及範本。

## 2. 目標

把 primary viewer 從窄 overlay 改成**全幅「IFC→USD 語意驗證」viewer**（對齊範本 6 面板），中央視區**不再空白**（harness 用資訊濃密 mock viewport，有 GPU 時自動切真 Kit 幀），A1/A2/A3 operation 收進乾淨分頁，全程誠實標示，並以 Playwright E2E 佐證友善度。

## 3. 資料可用性（決定誠實邊界，5-agent 實查）

| 範本面板 | 真資料 | 來源 / 作法 |
|---|---|---|
| ① 模型資訊 | ✅ 現有 | `quality_metrics_summary`（fixture/轉換時間/元件數/coverage）+ `element_mapping.summary`；coverage% client 算 + `isFakeMappingDocument` |
| ④ GUID⇔Prim 對構表 | ✅ 現有 | `element_mapping.json`（guid/class/name/prim_path/confidence/method）|
| ② IFC 語意(Pset/Type) | ✅ CH-H2 | governance-service `ifcopenshell get_psets`（predicates.py 已有能力）→ 新 per-element 端點 |
| ③ 結構樹(分層計數) | ✅ CH-H2 | hierarchy（IfcProject>Site>Building>Storey + type 計數）|
| ⑥ Pset/Quantity/空間 | ✅ CH-H2 | `get_container`（spatial）；Pset/Quantity 同 ② |
| ⑤ 幾何(BBox/材質) | ⌛ roadmap | BBox/體積需 USD runtime 算、材質無端點 → 誠實標 roadmap |
| 分類碼(MasterFormat/OmniClass/Uniformat) | ⌛ roadmap | pipeline 未實作，IFC 可能本就無 → 誠實 N/A |

## 4. IA 與版面

新 primary viewer 採範本 6 面板 + 分頁 nav（A1/A2/A3 operation 收進「問題」分頁，metadata 在「模型」分頁）：

```
nav: [模型] [問題] [批註*] [測量*] [創切*] [書籤*]   (* = 既有/未建，誠實標)
[模型] = 語意驗證視圖（① 模型資訊卡 | ③ 結構樹 | 中:工具列+3D/mock viewport | ④ 對構表 | 右:② IFC語意 + ⑥ 空間 + ⑤ 幾何(roadmap)）
[問題] = 治理操作（A3 rule-run 觸發 / A2 失敗構件→3D 高亮 / A8 issue+BCF / BindingComposer / spectator 三層權威）
```

既有能力全保留（rule-run/highlight/issue/BCF/BindingComposer/spectator gate/MappingCache/HighlightBridge），只重新安置與美化。

## 5. CH-H1（純前端，可逆小 PR）

新元件 `web-viewer-sample/src/console/viewer/`（單一職責、可獨立測）：
- `GovViewerLayout.tsx` — CSS grid 六分區外殼 + 分頁 nav（模型/問題）
- `ModelInfoCard.tsx`（①）— 真資料；coverage% + fake 檢查
- `MappingTable.tsx`（④）— 真資料 `element_mapping.json` + fake-vs-real 隔離
- `MockViewport.tsx` — `harnessEnabled() || !_hasRemoteVideoFrame()` → 資訊濃密佔位（Stage URL/loaded prims/selected prim/highlight echo/camera state，明標「deterministic·no-GPU」）；有真 Kit 幀自動切 `<video>`
- 工具列 select/pan/orbit/zoom 接既有 DataChannel；section/measure 誠實 p15 disabled
- ③ 結構樹：H1 用既有 USD 樹（分層+計數留 H2）

資料流：stream-config → ①④；點 tree/table → `focusPrimRequest`（真）/ mock echo（harness）。

## 6. CH-H2（補後端，接 ②③⑥）

- **governance-service 新端點**：per-element 語意（`get_psets`/`get_container`/type/predefined_type/tag），輸入 server IFC 路徑 + ifc_guid。
- **coordinator proxy**：`GET /api/governance/elements/for-session/:sessionId/:guid`（沿用既有 `rule-runs/for-session` resolve+forward；前端只打 :8004）。
- 前端：點構件 → ② IFC 語意（Type/PredefinedType/Tag/Pset_*/Quantity_*）+ ⑥ 空間（Contained In/Building/Site）；③ 升級分層樹+計數。
- ⑤ 幾何 + 分類碼：誠實 ⌛roadmap/N/A。

## 7. 誠實降級

fake mapping → fake banner（重用 `isFakeMappingDocument`）；缺資料面板 `—`/roadmap badge；mock viewport 明標無 GPU 決定性；真實黑畫面（georeferenced 相機框取）= 已知問題，camera fit-to-bounds 列 H2 選配，不混為 pipeline 壞。

## 8. E2E（解「不友善 + 空白」）

- CH-H1 `gov-viewer-layout.spec.ts`（harness）：6 面板容器都在、① 真 coverage、④ mapping rows、**mock viewport 顯 Stage/prims/selected（截圖不再空白）**、點樹→focus echo。
- CH-H2 `element-semantics.spec.ts`：點構件→② Pset/Type、⑥ spatial 出現 + governance-service 端點單元測試。
- 既有 real-ifc specs 保留；真 GPU 幀 graceful-skip 選配。

## 9. 邊界與風險

- 前端只打 :8004；governance-service 仍是 IFC 讀取權威，coordinator 只 resolve+forward；無新增 prod 依賴；不復活 server-push highlight。
- 動 `Window.tsx`（overlay 掛載）= RK5 HIGH → 先 `gitnexus_impact`、邏輯抽元件降爆炸半徑。
- 落地走 OpenSpec change `unified-console-semantic-viewer`（H1/H2 兩階段 tasks）→ branch→PR→Actions。
- 反轉性：CH-H1 純前端新增/重排，gated 或新分頁，可回退。

## 10. 驗收（對齊 goal 最終流程）

rebuild → deploy → 前端 E2E 全綠 → 真實 ./storage IFC 走新 viewer → A1(rule-run)/A2(diff)/A3(federation) 功能驗證 → 對齊 `frontend-redesign-ia-and-phases.html`；多 agent 對抗驗證；fix/bug/risk/block/smoke 全清。

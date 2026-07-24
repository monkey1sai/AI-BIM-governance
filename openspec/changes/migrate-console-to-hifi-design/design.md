## Context

UnifiedConsole 目前的視覺樣式來源分裂成三套，彼此互不相通：

1. **`edge-console.css`**（`web-viewer-sample/src/console/`，217 個 `--ec-*` token，NVIDIA 綠 `#76b900` 主色，深色+淺色雙主題，淺色主題由 `EdgeConsole.tsx` 一個真實可點的按鈕切換並存 `localStorage["aibim:ec-theme"]`）——現行 production 唯一真相源，`§08 R1` 白紙黑字鎖定。仍在服務 `LegacyEdgeConsole`（`#/kit`、`#/demo-control`、`#conv` 等路由）、`ConversionPage.tsx`、`governance/overlay.css`、`viewer/*.css`。
2. **`console/unified/*.tsx`（IA v2，commit #349/#350 落地）**：`UnifiedShell`/`HomePage`/`WorkspacePage`/`PipelinePage`/`OpsPage`/`ConceptPage`。伴隨的 `unified.css` 只有 58 行、僅處理 body 層級 scrollbar/keyframes，元件層級顏色是**直接寫死的 inline hex JSX style**（1:1 抄自 Hi-Fi 原型），未消費任何 CSS custom-property 檔案。
3. **`docs/plans/ai-bim-governance.css`**（20046 bytes，完整 `--ab-*`/`.ab-*` token 系統，自述「extracted from Hi-Fi console」）——repo 全域 0 引用的孤兒檔案，不在唯讀 authoring origin 內，也不是 `design-system-reference.manifest.json` 的 `token_projection.upstream_authority`（該欄位指向 origin 目錄下另一份不相關的 `source/styles.css`，`--ab-` 命中數為 0）。

使用者在完整揭露上述事實（含 `edge-console.css` 內「NVIDIA 綠為核心品牌」的既有設計註解、亮暗切換是真實功能而非死碼）後，經 grill-me 逐項確認：`ai-bim-governance.css` 要成為新的唯一 production 權威，取代 `edge-console.css`；品牌色與淺色主題的移除是有意識決策；已遷移的 IA v2 inline-hex 頁面也要一併收斂，不留第三套顏色來源。

## Goals / Non-Goals

**Goals:**
- `ai-bim-governance.css` 從孤兒檔案變成真正被 import、被消費的 production CSS 依賴。
- 收斂三套顏色來源（`--ec-*` / inline hex / `--ab-*`）為一套（`--ab-*`）。
- 移除淺色主題與其切換功能，UnifiedConsole 收斂為純深色。
- 遷移完成後重用既有 pixel/semantic 雙閘機制重新 rebaseline，不新建驗證機制。

**Non-Goals:**
- 不變更 `edge-console-operator-frontend` 或 `unified-governance-console` 任何一條既有功能/API/provenance SHALL 條款。
- 不修正這兩份 spec 本身被發現的內部過時/不一致問題（見 proposal.md Known Risks）。
- 不擴大處理 A4–A10 願景頁以外的後端能力。
- 不以 frozen deferred `align-frontend-design-system-reference` 的 tasks 2.4–2.8 當作前置；兩案完成 requirement/successor crosswalk 前不得平行 coding。
- 不在本 change 內執行實際的 rebaseline 操作（golden baseline 擷取是 tasks.md 的實作步驟，時機在視覺程式碼落地「之後」，不在 propose 階段先跑）。

## Decisions

### D1：`ai-bim-governance.css` 真實 import，而非手抄色碼延續現行 IA v2 pattern

**決策**：新頁與已遷移的 IA v2 頁面統一 `import`/`link` `ai-bim-governance.css`，元件用 `var(--ab-*)`，不手寫十六進位色碼。

**考慮過的替代方案**：跟隨現行 IA v2 已經在用的 inline-hex-手抄 pattern（改動範圍最小，因為只是把 `#41c7e8` 這類值抄進新頁面，不需要碰 build/import 設定）。

**取捨**：手抄雖然改動面積小，但無法達成使用者原始指示「以 ai-bim-governance.css 為前端設計風格」的實質意圖——檔案依然是零消費者的孤兒，日後改色要改 N 處而非 1 處。真實 import 才讓「唯一真相源」在技術上成立，且與 `design-system-reference.manifest.json` 已確立的 `primitive → semantic → component` token 投影哲學一致（即使該 manifest 目前投影的是另一份 `source/styles.css`，token 投影本身的方法論可直接套用到 `ai-bim-governance.css`）。

### D2：新建 `console-design-token-authority` capability，不對 `unified-governance-console` / `edge-console-operator-frontend` 開 MODIFIED delta

**決策**：本 change 只新增一個範圍嚴格限定在視覺/CSS token 層的 capability，不touching 既有兩份 spec 的檔案。

**考慮過的替代方案**：把視覺遷移一併寫成這兩份既有 spec 的 MODIFIED delta，順便處理它們與新 IA v2 脫節的問題。

**取捨**：查核發現 `unified-governance-console` spec.md（311 行）本身混雜至少兩三個不同時期的架構描述（primary-viewer-overlay 治理架構 vs. 英文寫的 grouped-navigation console shell），且兩份既有 spec 都**沒有規範任何具體顏色/CSS token 機制**——本次視覺遷移不牴觸其任何一條 SHALL。若順手一併 reconcile，範圍會從「換皮」爆炸成「重新盤點並修正兩份大型既有 spec 的內部一致性」，超出 grill-me 這次收斂的決策範圍。保守作法是新開一個正交 capability，把既有 spec 的內部問題記錄為 Known Risk，留給後續獨立處理。

### D3：不以 frozen deferred 的雙閘方案作為遷移前置

**決策**：`align-frontend-design-system-reference` 已於 2026-07-24 historical correction 恢復為 `Status: deferred` 的 frozen change，其未完成的 tasks 2.4–2.8（branch-protection required check、11 個語意案例 approved state variants、獨立 review authority、runner/font fingerprint pin）不是 active 前置，也不是 canonical implementation authority。本 change 可重用現有驗證工具；若要補齊該方案，須先依 current main 完成兩案 requirement/successor crosswalk，再另行 thaw／調和，禁止平行 coding。

**理由**：archive 記錄的 pixel+semantic 雙閘**機制**（manifest schema、verify script、capture/rebaseline 工具、Playwright spec 結構）與被鎖定的視覺內容正交；既有工具對顏色系統無感知，換皮後直接用同一套工具重新 rebaseline 即可。archive 內容保留作歷史脈絡，不提供現行工作計畫或權威。

### D4：品牌色與主題移除記錄於 `docs/plans/AI-BIM 前後端設計文件.dc.html` §08，不僅記錄於 OpenSpec

**決策**：`console-design-token-authority` spec 明文要求 §08 記錄「production 主色由 NVIDIA 綠改 Hi-Fi 青色系」與「移除亮色主題」為有意識決策及理由。

**理由**：§08 是「AI Coding 交付守則」，未來 AI coding agent 主要讀這份文件決定怎麼做；只寫在 OpenSpec change 裡（archive 後較不易被日常開發翻閱）不足以防止未來有人誤以為現行深色系是疏忽、想「修回」NVIDIA 綠。

## Risks / Trade-offs

- **[Risk] 26 個既有 golden baseline 全數作廢** → **Mitigation**：這是預期且必要的代價（視覺內容真的改變），已規劃遷移完成後立即用既有 `capture-design-system-reference.mjs --rebaseline --confirm-rebaseline` 重新鎖定，不新建流程，降低執行風險。
- **[Risk] `LegacyEdgeConsole` 覆蓋的功能面（A1 rule-run、A2 apply-overlay、A3 federation、Review Room 等）在換皮過程中意外破壞既有行為** → **Mitigation**：`console-design-token-authority` spec 明文要求所有既有 SHALL 條款遷移後逐字成立；實作階段每個遷移頁面 SHALL 保留其既有 browser E2E 證據案例，只允許樣式相關的截圖差異。
- **[Risk] `unified-governance-console` 與 `edge-console-operator-frontend` 兩份既有 spec 本身可能已過時或內部不一致，遷移時若程式碼行為與 spec 文字有落差，容易在不知情下「順手」改到行為** → **Mitigation**：實作前務必先讀這兩份 spec 的相關 Requirement 段落與對應真實程式碼比對，任何行為層面的不確定 SHALL 停下來澄清而非假設，不在本 change 順帶修正 spec 文字本體。
- **[Risk] `ai-bim-governance.css` 本身可能未覆蓋 `edge-console.css` 217 個 token 涵蓋的所有語意（例如某些 UI 狀態色、diff 專用色）** → **Mitigation**：實作階段 tasks.md SHALL 包含一項「逐一比對 --ec-* 與 --ab-* 語意覆蓋率，缺口另補 --ab-* token（而非退回 --ec-*）」的任務，缺口不應阻塞整體遷移但需誠實記錄。

## Migration Plan

1. 逐頁遷移（建議順序：先 `console/unified/*.tsx` 收斂 inline-hex → `--ab-*`，驗證既有 13 approved screens 視覺無 regression 外的功能改變；再遷移 `LegacyEdgeConsole` 覆蓋的頁面，逐頁跑其既有 E2E 證據案例）。
2. 全部遷移完成、`--ec-` 使用量歸零後，retire `edge-console.css`（移至 `deprecated/` 或直接刪除，依實作階段判斷）。
3. 移除 `EdgeConsole.tsx` 主題切換邏輯。
4. 更新 `docs/plans/AI-BIM 前後端設計文件.dc.html` §08。
5. 執行 `capture-design-system-reference.mjs --rebaseline --confirm-rebaseline` + `verify-design-system-reference.ps1 -VerifyOrigin`。
6. 若中途需要 rollback：`edge-console.css` 與 `--ab-*` 遷移可逐頁獨立 revert（非 atomic 一次性切換），因兩套 token 命名空間不重疊，可暫時並存於未完成遷移的過渡期而不互相污染。

## Open Questions

- `ai-bim-governance.css` 是否需要新增目前沒有的語意 token（見 Risks 第四項）——留待實作階段逐頁比對後才能確定缺口清單。
- `edge-console.css` retire 後是實體刪除還是移至歷史保存路徑——留給實作階段依當時的其他既有引用（如測試 fixture）盤點結果決定。

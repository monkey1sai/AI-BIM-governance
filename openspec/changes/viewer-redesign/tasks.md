# viewer-redesign — tasks

> spec-only change：本清單只含提案本身的交付與核准動線；實作任務屬未來 implementation change（見 proposal「落地順序建議」），不在此列。

## 1. 提案交付（本 PR）

- [x] 1.1 proposal.md / design.md（規格來源與決策，全部對齊實碼證據）
- [x] 1.2 specs：viewer-viewport / kit-datachannel-protocol / embedded-viewer-bridge / a1-lineage-crosscheck-view
- [x] 1.3 contracts：kit-datachannel-v1.schema.json、vg01-postmessage-v1.schema.json + examples（valid/invalid）
- [x] 1.4 drafts：design-doc-viewer-spec-draft.html、hifi-viewer-states-draft.html、hifi-lineage-page-draft.html（R-A1 提案文字，供使用者審核後自行套用）
- [x] 1.5 `npx openspec validate viewer-redesign --strict` 綠
- [x] 1.6 contracts JSON 全部可解析、examples 通過/如預期失敗 schema 驗證

## 2. 使用者核准動線（AI 不得代行）

- [x] 2.1 使用者審 specs 四件——**已裁決 2026-07-21**：① SLO 照案；② 工具列 `◫`=雙視窗檢視（dual-viewport，取代原「比對/剖切」提案）；③ commandRejected reason 加 `invalid_payload`（封閉列舉 5→6 值）；④ #lineage IA 照案（A1 Dock 摘要卡 + 獨立頁雙層）。裁決已回寫 specs/contracts/drafts
- [ ] 2.2 使用者審 drafts 三件並自行套用至手寫正本（或裁決退回；正本 bump 版本+日期，R-A4）
- [ ] 2.3 使用者核准後 merge 本 PR（AI 不自行 merge）

## 3. 後續（本 change 不承諾，僅指路）

- [ ] 3.1 implementation change①：內嵌持久 viewport（A1/A2 接入；引用 viewer-viewport + embedded-viewer-bridge）
- [ ] 3.2 implementation change②：A3 內嵌 + A4 接線 + spectator 邀請真實化
- [ ] 3.3 implementation change③：`#lineage` 頁（IFC↔USDC 兩軸先行；RVT 軸等 rvt-ifc-usdc-lineage 解凍）
- [ ] 3.4 contracts 遷入 `tests/contracts/` 並接 CI 驗證（隨 change①）

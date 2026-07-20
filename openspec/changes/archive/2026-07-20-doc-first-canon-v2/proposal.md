# 變更：doc-first 設計正本 v2 改寫＋治理條文修正（risk-first）

> **Change 類型：doc-only 提案。** 「實作」＝提交改寫後的正本文字供使用者審；真正動手寫正本須使用者核准（手寫正本＝使用者專屬，AI 僅能提案）。
> **Angle：risk-first。** 骨架為「失效防護在前、功能改寫在後」。所有補強皆為可驗證性／可稽核性／工具鏈邊界，未引入新 scope，未稀釋 11 條內嵌裁決。
> **本 change 不涉任何強制法規（無個資／安全認證議題）。** 審查者不得誤加合規章節。
> **Owning folder：** `docs/plans/`（設計正本，提案供審不逕改）＋ `openspec/`（capability delta）＋ `AGENTS.md` 參照鏈草稿。不動任何後端凍結面。

## Why

（以失效模式陳述）本 change 的存在理由不是「文件要更好」，而是「現行治理已處於四類可證實的失效狀態」，每一類都有 2026-07-17 grill-me 治理場 9 波對抗驗證的證據背書（`file:line` 證據集中於獨立 gap ledger，見 R-C1，正本內文只用穩定錨）：

- **F1 權威序自相矛盾**：§08 權威順序表（code＋tests 第 1、書面需求第 4）與 docs-plans-README §3.2/§3.5「現況行為權威＝code＋tests」使「code 偏離文件」被結構性地解讀為「文件錯」，implementation gap 永遠不會被排修。裁決 1 已翻轉為 doc-first：docs/plans＝唯一需求權威，code 偏離＝待修 gap。失效後果：需求靜默蒸發（例：§03 CH-G 路由全未落地卻無人視為缺陷）。
- **F2 正本 21 項失真**：失真地圖 (1)–(21) 每項都是「文件宣稱 X、實況為 Y」的靜默漂移。doc-first 翻轉後，這些失真若不先修正，等於把「錯的文件」升格為權威——**先修文件、再翻權威，順序不可倒**。
- **F3 無變更控制＝正本可被 AI 誤寫**：手寫正本（兩份 `.dc.html`、`docs-plans-README.md`、`ai-bim-governance.css`）目前無任何條文阻止 AI 直接編輯；機器快照面（manifest、baseline）無寫入路徑限定；`support.js` 為 repo 外 dc-runtime 生成物卻無「永不手改」條文。裁決 5 要求把這些防護寫死。
- **F4 狀態語言混亂**：§08 R3 的 `ProvenanceTag(mock|live)` 與實碼 `ProvTag` 7 值 `Prov` ＋ `data-prov=fixture|live` 不一致，R2 三態裁決（裁決 6/8）無共同詞彙可落地執行。

**外部佐證強度說明（研究約束落地）**：已有研究關注 spec-code 靜默漂移需架構性機制處理（措辭不誇大為「文獻公認」）；spec 作為單一真相源、drift 無聲失效特性支持 doc-first 方向與「標 planned 而非沉默宣稱已完成」。domain 事實一律以 11 條內嵌裁決為準，外部研究僅限 OpenSpec 撰寫慣例／spec 治理實踐，不得推翻或稀釋裁決；廠商行銷量化數字不入條文。

## What Changes

1. **specs delta 兩個 capability**：
   - `documentation-source-of-truth`（MODIFIED 2 條 ＋ ADDED）：現有 **6 條 requirement**，本 change 只 MODIFY 其中 **2 條**——「Workflow v3 and product design artifacts have distinct, non-overlapping authority」與「文件分工調整必須走 PR 治理流程」。每條 MODIFIED＝既有 header 逐字保留 ＋ body/scenario 改寫後之完整新 block（「逐字重現」僅約束 header 與 requirement 界定、不凍結 body，權威翻轉點寫在 body/scenario）。doc-first 偏離處置序、carve-out 斷言、R2 三態、gap ledger、失真修正群、Crosswalk、撈回等以**獨立 ADDED requirement** 承載並與 MODIFIED cross-ref。同時**保留**「文件不得反向覆蓋 runtime／不得以文件宣稱 runtime 已完成」誠實半句，並附 scenario 證明兩者非矛盾。其餘 **4 條 requirement 未觸碰**（以 `openspec validate` ＋ diff 檢核）。
   - `design-canon-change-control`（ADDED，新 capability）：手寫正本寫入授權邊界、機器快照雙旗標、`support.js` 禁改、版本 bump＋備份回復程序。
2. **21＋3＝24 項失真／核心翻轉逐條 task 化**（每項一 task、證據背書），外加變更控制章節撰寫 task、gap ledger 建立 task、裁決 7 git history（`a271e46` 父版）撈回 task、**錨點可行性 Task 0 spike（hard gate、critical-path、先於全部 24 task）**，及 **MODIFIED 範圍對齊檢查 task（只 MODIFY 這 2 條、其餘 4 條未觸碰）**。
3. **產出物**：一份改寫後的正本 v2 連貫全文草稿（`.v2-draft.dc.html` 完整平行副本，非 24 份互相衝突的並行 patch）＋ 一份獨立 gap ledger ＋ 一份 normative Crosswalk 表 ＋ 一份 24×11 追溯矩陣 ＋ AGENTS.md 參照鏈修正草稿 ＋ Open Decisions/Open Questions 專章，全部以「供使用者審」形式提交。

## Impact

- **Affected specs**：`documentation-source-of-truth`（MODIFIED 2 ＋ ADDED）、`design-canon-change-control`（新 capability）。
- **Affected docs（提案供審，不逕改）**：`docs/plans/AI-BIM 前後端設計文件.dc.html` §01–§08、`docs/plans/docs-plans-README.md`、`AGENTS.md` 參照鏈。
- **不變更**：任何後端凍結面（`app.py`／`governanceProxy.ts`／`conversion_authority.py`）、`/ui/open`、public API、event、DB schema、MinIO layout、Kit/WebRTC protocol、GPU ownership。前端仍只打 coordinator `:8004`（`:49100`／spectator 埠段 WebRTC signaling 為既有合法直連例外）。
- **不改**：機器快照面（`design-system-reference.manifest.json`、`design-system-baseline/**`）與 `support.js` 由本 change 明文限定寫入路徑，不在本 change 觸碰其內容。

## 硬前置檢查（提 PR 前必跑，機器可檢——化解 align-frontend 碰撞）

現場事實：未 archive 的 `align-frontend-design-system-reference` change 已帶一份對 `documentation-source-of-truth` 的 RENAMED delta，把本 change 掛載的「Workflow v3…」條 RENAME 為「Workflow v4 與產品設計產物的權威範圍明確分離且不重疊」，並 MODIFY body 重申「code＋tests/contracts 是現行 runtime behavior truth」（＝doc-first 要翻轉的舊權威序）。兩 in-flight change 在同一條 requirement 對撞。

本 change 對準**當前 main 觀察到的 v3 英文 header**（事實優先）下 delta。為把順序爭議轉成可機檢前置條件而非君子協定：

- **PF-1**：提 PR 前 MUST 實跑 `grep -n "Workflow v3 and product design artifacts have distinct, non-overlapping authority" openspec/specs/documentation-source-of-truth/spec.md`（或 `openspec show documentation-source-of-truth`）確認 main 上仍是 **v3 header**。
- **PF-2**：若 grep 顯示已變 **v4**（表示 align-frontend 先落地／已 archive），本 change 的 MODIFIED delta MUST 先 rebase 對準 v4 header（RENAMED v3→v4 已生效）再驗，否則逐字重現 v3 header 的 MODIFIED 立即 `validate` 失敗、§5.1 翻紅。
- **PF-3**：`openspec-ledger-reconcile`（follow-up、裁決 E）MUST NOT 早於 canon v2 採納 archive；archive 前 MUST 對已採納 canon v2 調和 align 的 RENAMED(v3→v4)＋MODIFIED body（保留 behavior-truth 誠實半句、剔除／改寫與 doc-first 對立的權威序語句）。採納訊號＝正本 v2 的 version-bump commit（見 design.md）。

## Open Questions（殘留未解決詰問，一級 artifact）

以下為 grill-me 對抗驗證後仍待使用者終裁的開放點，本 change 明文**不逕自定案、不逕自否決**（詳見 design.md §Open Decisions）：

- **OQ-1**：是否新增 `asbuilt-partial` 之類外接待決 `Prov` 值（失真項 9 遺留）。預設**不採用、不併入 7 值集**；於正本 v2 §08 R3 內以顯式 non-normative『Open Decision 註記塊』承載，normative enum 維持封閉；擴充唯一路徑＝R-A1 提案＋使用者核准。
- **OQ-2**：`ai-bim-governance.css` NVIDIA 綠品牌色票／視覺語彙授權盲區。**不逕自定案**；不入正本、僅入 design.md 與 gap ledger（品牌／授權決策，須使用者裁決）。
- **OQ-3（工具鏈盲區）**：`.dc.html` 雙檔／`ai-bim-governance.css` token 快照面能否承載 AST/符號級 drift CI（fiberplane/drift 類工具可行性）未經證實 → 不在本 change 採用，僅列名 follow-up `drift-gate-lightweight`。
- **OQ-4（無測試護欄空窗）**：§01 鐵律 3「byte-for-byte」改行為級（302/301/參數白名單）後，`ui-open-regression.spec` 尚未接 CI 的空窗期，本 change 明文標為 **known gap（不是 pass）**，接 CI 為具名 follow-up。

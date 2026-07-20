# AGENTS.md 參照鏈修正草稿（提案 diff，供審）

> **本檔性質**：`doc-first-canon-v2` change 對 `AGENTS.md` 的**參照鏈修正提案**，對應 `tasks.md` 1.2。**本檔不修改 `AGENTS.md` 本體**——`AGENTS.md` 逐字保持現狀；本檔以「現行條文原文 → 建議改寫後文字」逐段對照形式提交，**僅供使用者審閱，須使用者核准後另開獨立 PR 才落地套用至 `AGENTS.md`**。DoD 狀態＝`draft-submitted`；`user-adopted` 待使用者對本草稿表態（核准或退回）後才成立，非本 task 機器 gate 範圍。
>
> **底稿版本**：`AGENTS.md`（`openspec-doc-first-canon-v2` 分支 worktree，2026-07-18 讀取）。已核對 `git diff main -- AGENTS.md` 為空、`git show main:AGENTS.md` 與 worktree 檔案行數一致（200 行）——本 branch 未曾改動過 `AGENTS.md`，worktree 檔案與主 checkout（main）逐字相同，故下列「現行條文」行號對兩者皆準確。
>
> **對應治理脈絡**：裁決 1（doc-first 權威模型翻轉，proposal.md F1）＋裁決 5（變更控制，proposal.md F3；`design-canon-change-control`）。用語刻意重用 `openspec/changes/doc-first-canon-v2/specs/documentation-source-of-truth/spec.md` 內 MODIFIED Requirement「Workflow v3 and product design artifacts have distinct, non-overlapping authority」（現況查證面／非需求權威）與 `openspec/changes/doc-first-canon-v2/specs/design-canon-change-control/spec.md` R-A1 的措辭，避免同一 change 內出現兩套 doc-first 表述。
>
> **範圍界定（誠實鐵律，避免誤讀本草稿的拘束力）**：`AGENTS.md` **不是** R-A1 定義的「手寫正本面」4 檔之一（R-A1 明確限定為 `AI-BIM 前後端設計文件.dc.html`／`AI-BIM Console Hi-Fi.dc.html`／`docs-plans-README.md`／`ai-bim-governance.css`）。因此本草稿不宣稱直接受 R-A1 拘束；「AI 僅提案、不逕改 main」是本 task（`tasks.md` 1.2：「提案供審，不逕改 main」）明文指示，且與 `AGENTS.md` 現行「文件分工調整必須走 PR 治理流程」（`documentation-source-of-truth` capability 既有 requirement）精神一致，本草稿依此精神自我約束，落地走一般 PR 治理流程，並非宣稱 R-A1 專屬流程涵蓋 `AGENTS.md`。

---

## 對照 1：§3「Runtime/product behavior truth」定義句（AGENTS.md:132）

### 現行條文（逐字，AGENTS.md:132）

> - **Runtime/product behavior truth**：程式碼實作與可執行測試 / contracts 描述目前行為；`docs/plans/` 描述目標需求與驗收語意；兩者不一致時不得用 docs 宣稱 runtime 已完成，必須標成 implementation gap。

### 建議改寫後文字

> - **Runtime/product behavior truth**：`docs/plans/` 設計與規格正本（`AI-BIM 前後端設計文件.dc.html` §01–§08、`AI-BIM Console Hi-Fi.dc.html`、`docs-plans-README.md`）SHALL 為**唯一需求權威**；程式碼實作與可執行測試 / contracts 為 runtime **現況查證面**（用以核對 runtime 是否已落實正本需求，非需求權威本身）。兩者不一致時，該偏離 SHALL 判為待修 implementation gap，不得反向改寫正本遷就 code，亦不得用 docs 宣稱 runtime 已完成。

### 改寫理由

現行句把「code+tests＝目前行為」與「docs/plans＝目標需求」並列陳述、未直接排序，但緊接其後的優先順序清單（見對照 2）明文把 docs/plans 排在 code＋tests 之後——兩段合讀＝結構性地把 code+tests 讀成「高於」docs/plans 之權威，與本 change 裁決 1 的 doc-first 權威模型（`docs/plans`＝唯一需求權威，code 偏離＝待修 implementation gap，非「文件錯」）矛盾（即 proposal.md F1 在 `AGENTS.md` 內的具體病灶，與設計文件 §08 權威順序表、`docs-plans-README.md` §3.2/§3.5 同構、同一裁決 1 背書）。改寫**保留**誠實鐵律半句「不得以文件宣稱 runtime 已完成」原意（不刪一字，僅語序微調以承接新排序），只翻轉「何者是需求權威」的判定；「code+tests 仍是查證 runtime 現況的憑據」這件事不變、亦不弱化。

---

## 對照 2：§3 Runtime/product 行為真相優先順序清單（AGENTS.md:134-142）

### 現行條文（逐字，AGENTS.md:134-142）

`````text
Runtime/product 行為真相優先順序：

```txt
1. 程式碼實作
2. 可執行 tests / contracts 文件
3. docs/plans 設計與規格文件（目標行為 / 驗收語意）
4. AGENTS 邊界定義（本文件 + docs/agents/*.md sub-files）
5. generated wiki / generated skills / old evidence（若存在）
```
`````

### 建議改寫後文字

`````text
Runtime/product 需求權威與現況查證順序（doc-first；裁決 1）：

```txt
1. docs/plans 設計與規格文件（唯一需求權威；目標行為 / 驗收語意）
2. 程式碼實作（runtime 現況查證面，非需求權威）
3. 可執行 tests / contracts 文件（runtime 現況查證面，非需求權威）
4. AGENTS 邊界定義（本文件 + docs/agents/*.md sub-files）
5. generated wiki / generated skills / old evidence（若存在）
```
`````

### 改寫理由

此清單是 F1（proposal.md「權威序自相矛盾」）在 `AGENTS.md` 內最直接的病灶：第 1／2 名＝code＋tests、第 3 名＝docs/plans，與設計文件 §08 權威順序表（`tasks.md` item 22／task 3.1，另案改寫該 `.dc.html` 正本本體）同構、同因、同一裁決 1 背書，兩處若只改其一會讓 `AGENTS.md` 與正本自相矛盾。改寫只交換第 1–3 名順序並附註「非需求權威」／「現況查證面」限定語；第 4、5 名（AGENTS 邊界定義／generated wiki）位置與文字均不變——本草稿刻意不擴大改動範圍（YAGNI）。

---

## 新增（非取代）：`design-canon-change-control` R-A1 參照

> 本段為**新增段落**，`AGENTS.md` 現行文字無對應「現行條文」可引用（`design-canon-change-control` 是本 change 新提出的 capability，main 上尚不存在，見 task 1.1／`specs/design-canon-change-control/spec.md`），故不構成「現行→建議」對照，而是獨立新增建議，緊接於**對照 2** 改寫後清單之後插入 §3（在「目前 checkout **沒有** generated wiki 產物…」段落之前）。

### 建議新增文字（插入位置：對照 2 改寫後清單之後、原「目前 checkout 沒有 generated wiki 產物」段落之前）

> 對 `docs/plans` 手寫正本面本體（`AI-BIM 前後端設計文件.dc.html`、`AI-BIM Console Hi-Fi.dc.html`、`docs-plans-README.md`、`ai-bim-governance.css`）的改寫另受 `design-canon-change-control` capability R-A1 約束：手寫正本 SHALL 為使用者專屬，AI MUST NOT 直接編輯這些檔案；任何改寫 SHALL 僅以獨立提案（PR diff／OpenSpec change）形式提交供使用者審，且 AI MUST NOT 自行 merge。上表「1. docs/plans 設計與規格文件」列的是**需求權威**，不代表 AI 可直接改寫該正本本體——「何者是需求權威」與「誰能動手改寫正本」是兩個不同層次的問題，不得混淆。

### 新增理由

proposal.md F3 明文：「手寫正本（兩份 `.dc.html`、`docs-plans-README.md`、`ai-bim-governance.css`）目前無任何條文阻止 AI 直接編輯」。權威序翻轉為 doc-first 後，若 `AGENTS.md` 沒有這段參照，容易被誤讀成「docs/plans 現在排第一名，所以 AI 可以直接動手改」——這正是裁決 5（變更控制）要防的誤讀，也是本 task 內容要求 (b) 的直接目的。此段落把「需求權威」與「改寫授權」拆開講清楚，並指回本 change 新增的 `design-canon-change-control` R-A1 全文（`openspec/changes/doc-first-canon-v2/specs/design-canon-change-control/spec.md:3-26`）供讀者深入查閱。

---

## 本草稿的治理狀態

- **狀態**：`draft-submitted`（`tasks.md` 1.2）。`user-adopted` 待使用者對本草稿表態（核准／退回）後才成立，非本 task 機器 gate 範圍。
- **本 task 實際改動**：僅新增本檔 `openspec/changes/doc-first-canon-v2/drafts/AGENTS-refchain.v2-draft.md`；**未**對 `AGENTS.md`、`CLAUDE.md`、或任何 `docs/agents/*.md` sub-file 執行任何 Edit/Write（已用 `git diff` 自查，見下方 commit 前 scope 驗證）。
- **落地路徑**：使用者審閱本草稿並核准後，MUST 另開一個獨立 PR，diff 僅觸及 `AGENTS.md` 本體（依上述對照 1／對照 2／新增段落原樣套用），並依 `AGENTS.md` 現行「文件分工調整必須走 PR 治理流程」requirement 走一般 PR 審查（governance evidence 表、formal requirement source 指回本 change）；不得由本 change 的 PR 一併夾帶套用到 `AGENTS.md` 本體。
- **已核對、確認不需要對應修改的相鄰檔案**：
  - `CLAUDE.md`（`AGENTS.md` 之 Claude 鏡像入口）：已讀全文，其 §0 僅聲明「若本檔與 `AGENTS.md` 衝突採用 `AGENTS.md`」，不重複本草稿對照 1／對照 2 所改的優先序清單本文，故 `CLAUDE.md` 不需要對應修改。
  - `docs/AGENTS.md` 的 Required Boundaries 條 `docs/AGENTS.md:32`（「MUST 對齊根目錄 `AGENTS.md` §3 的兩條優先序」）：純 cross-ref 根目錄 §3、不重複清單本文，§3 翻轉後「兩條優先序」結構仍在，此行隨根目錄採納本草稿會自動一致，該行不需要對應修改。
- **已核對、發現含實質重複、須另案對應修改的相鄰檔案（已知缺口，非本 task 範圍）**：
  - `docs/AGENTS.md` 的 Role 段 `docs/AGENTS.md:7`（「…它不是 runtime 行為權威源。現行行為以程式碼、可執行 tests / contracts 為準；`docs/plans/` 定義目標需求與驗收語意…」）：此句幾乎逐字複述對照 1 現行條文（`AGENTS.md:132`）所欲翻轉的「code＋tests＝現況行為、docs/plans＝目標」舊框架本文，屬**實質重複**而非單純 cross-ref。故若根目錄採納對照 1／對照 2 的權威序翻轉，`docs/AGENTS.md:7` **不會**自動一致，反而會與翻新後的根目錄直接語意矛盾——即 proposal.md F1「權威序自相矛盾」被搬到 sub-file 而非消除。此為經查證確認（非「未核對」）的已知缺口，須於獨立 pass／task 另行盤點並提案改寫 `docs/AGENTS.md:7`（連帶檢視同檔 Required Boundaries `docs/AGENTS.md:33`「docs 與實作不一致時以實作為準」措辭在 doc-first 下是否需同步澄清）；本 task 範圍限根目錄 `AGENTS.md` 參照鏈（`tasks.md` 1.2），不由本 task 代為改寫（YAGNI）。
- **明確不在本草稿範圍內**：`docs/agents/*.md` 其餘 sub-files（`docs/AGENTS.md` 已於上兩項單獨處理）是否含相同「code+tests 優先於 docs/plans」措辭，本草稿未逐檔核對；若存在需另案盤點與提案，不由本 task 代為涵蓋（YAGNI；避免未經核對就擴大聲稱涵蓋範圍）。

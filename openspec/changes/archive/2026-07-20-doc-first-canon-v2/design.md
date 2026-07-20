# Design — doc-first-canon-v2

> 本 change 為 doc-only 提案：「實作」＝提交改寫後正本文字供使用者審。手寫正本＝使用者專屬，AI 僅能提案。design.md 中的 follow-up 列名為 **non-normative、不構成實作授權**。

## 1. 關鍵技術決策與取捨

### 1.1 為何用「MODIFIED 2 + ADDED」而非 REMOVED+ADDED 重寫

現行 main 的 `documentation-source-of-truth` 有 6 條 requirement（已實查）。裁決要求只翻轉需求權威序，不推翻整個 capability。故對「Workflow v3…」與「文件分工調整必須走 PR 治理流程」兩條做 MODIFIED（header 逐字保留、body/scenario 改寫）；新增治理需求（doc-first 偏離處置序、carve-out、R2 三態、gap ledger、Crosswalk、撈回）一律入 ADDED，避免膨脹既有 capability 邊界。**抽象不得無限增生**：本 change 只新增 1 個 capability（design-canon-change-control）。若實跑 validate 發現舊 scaffolding 不可嫁接，改 REMOVED+ADDED 並在此記錄裁決。

### 1.2 與 align-frontend v3/v4 header 協調（Q1，碰撞已實查）

實查證實：`openspec/changes/align-frontend-design-system-reference/specs/documentation-source-of-truth/spec.md` 已把目標條 **RENAMED v3→v4**（「Workflow v4 與產品設計產物的權威範圍明確分離且不重疊」）並 MODIFY body 重申「code＋tests/contracts 是現行 runtime behavior truth」——正是 doc-first 要翻轉的舊權威序。兩 in-flight change 在同一條 requirement 對撞。

**決策（事實優先）**：本 delta 對準當前 main 觀察到的 **v3 英文 header** 下 delta。順序爭議以 proposal.md §硬前置檢查 PF-1/PF-2 轉為可機檢前置條件（grep header 狀態；若已 v4 則先 rebase 對準 v4 再驗），非君子協定。`openspec-ledger-reconcile`（follow-up）MUST NOT 早於 canon v2 採納 archive；archive 前 MUST 對已採納 canon v2 調和 align 的 RENAMED(v3→v4)＋MODIFIED body：保留其 behavior-truth 誠實半句、剔除／改寫與 doc-first 對立的權威序語句。

### 1.3 v2 草稿檔身分與 diff base（R2-Q3 解）

- **草稿形態**：v2 草稿＝真 `.dc.html` 的**完整平行副本**（檔名 `AI-BIM 前後端設計文件.v2-draft.dc.html`、`AI-BIM Console Hi-Fi.v2-draft.dc.html`）。R-A1 禁止 AI 直接編輯真正正本，故改寫只能落在副本。
- **diff base（三處統一）**：merge-assembly 的「聯集/零新增語意」、R-B3 carve-out「改寫前後語意等價」、per-task 區塊 diff，三者一律以**對應原正本檔的當前 main 版本**為 base。
- **錨植入**：Task 0 的 `data-canon-id` 細粒度穩定錨植入該副本（屬提案文字一部分，隨使用者採納生效）。

### 1.4 採納訊號定義（Q6，閉合 archive 死結）

`user-adopted` 權威 artifact＝正本 v2 的 **version-bump commit**（merged 到 main、diff 觸及手寫正本、含版本號＋日期 bump、經使用者核准/PR approve）；退回 artifact＝提案 PR 的使用者 close/comment 裁決記錄。archive 閘與 `openspec-ledger-reconcile` 排序皆讀此 commit 存在性（`git log` 對正本路徑＋版本字串 grep 可驗）；gap ledger `adopted-in` 欄記該 commit SHA（非機器 gate、純追蹤）。此定義與 R-A4 bump 要求一致。

### 1.5 sidecar 易腐記錄（Q9）

若 Task 0 降級為 sidecar anchor map，design.md 明記其與 `file:line` 同屬易腐、不得作為 R-C1 主要載體；首選仍為 v2 草稿自帶 `data-canon-id` 細粒度錨。章級錨存在（`sec1..sec8`）、需求/區塊級錨不存在為已確認事實。

### 1.6 能複用既有閘門就不自建工具（scope_out 鍍金拒斥）

- 複用：pr-review-agent body-evidence 表、`test-agent-governance-check` dead-link/行數、design gate、全域 `.bak` 規則。
- **不自建 AST drift 工具**（改複用 test-agent-governance-check＋列名 follow-up `drift-gate-lightweight`；fiberplane/drift 為真實候選工具但對 `.dc.html` 可行性未證）。
- **不引 SemVer/ISO19650 全套機器**（版本語意僅借 SemVer 2.0.0 類比）。
- 持續成本外部化到單一 ledger：未來 drift 波以 **append-only register 進既有 ledger 結構**，而非重寫正本。

## 2. 11 條裁決索引表

| 裁決 | 摘要 | 落地位置 |
|---|---|---|
| 1 | doc-first 權威模型；三處遺跡改寫（§08 表/README §3.2-3.5/§03 carve-out 刪） | MODIFIED「Workflow v3…」body ＋ ADDED R-B1 ＋ R-C2 items 22/23/24 |
| 2 | 內部裁決序（前端視覺/行為契約/場景圖分層；跨域→R2 三態） | MODIFIED body ＋ R-B1 |
| 3 | Workspace 3D 內嵌 viewport 升格；/ui/open 凍結併存；lease/spectator follow-up | R-B6 ＋ item 18；follow-up embedded-viewport |
| 4 | 需求正本＝docs/plans；外部 design repo 唯讀 authoring origin | R-B4 |
| 5 | 變更控制（手寫正本使用者專屬/機器快照雙旗標/support.js 禁改/版本 bump） | design-canon-change-control R-A1..R-A4 |
| 6 | R2 API 三態（整合/全棧/外接才 mock）；A4 mock 邊界劃在 LLM 解讀層 | R-B5 ＋ item 12 |
| 7 | git history（a271e46 父版）撈回 TARGET-*／A5–A10 契約、對照裁決 re-審 | R-C4 ＋ task 5.6 |
| 8 | A5/A6/A10 逐元件拆分（in-repo 全棧/外接 mock 合法） | R-B5 ＋ item 12 |
| 9 | KIT_SPECTATOR_COUNT 預設 0；邀請連結真複製；內嵌 spectator streamRole | R-B6 |
| 10 | issues 權威入口 unified #a1?dock=issues；legacy #issues 雙軌退役 | R-B6 ＋ follow-up |
| 11 | migrate-console/align-frontend 反向漂移按 code reconcile 後 archive | follow-up openspec-ledger-reconcile |

## 3. 24×11 追溯矩陣（零缺格；X＝該失真項由該裁決背書）

| 失真項 | 裁1 | 裁2 | 裁3 | 裁4 | 裁5 | 裁6 | 裁7 | 裁8 | 裁9 | 裁10 | 裁11 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 §03 Route/CH-G | X | X | | | | | | | | | |
| 2 §06 六態 | X | | | | | | X | | | | |
| 3 §03 gate 失真 | X | X | | | | | | | | | X |
| 4 §07 changes.jsonl | X | | | | | | | | | | |
| 5 §07/§08 stale 編號 | X | | | | | | | | | | X |
| 6 §02 拓撲 | X | | X | | | | | | | | |
| 7 §06 enum | X | | | | | | | | | | |
| 8 §03:214 自糾 | X | | | | | | | | | | |
| 9 §08 R3 ProvTag | X | | | | | X | | X | | | |
| 10 §08 features 目錄 | X | | | | | | | | | | X |
| 11 §08 crosswalk | X | | | | | | X | | | | |
| 12 §08 A4/A5-A10 | X | | | | | X | | X | | | |
| 13 §04 契約 | X | | | | | X | X | | | | |
| 14 §04 HTTP 語意 | X | X | | | | X | | | X | | |
| 15 §01 鐵律3 | X | | | | | | | | | | |
| 16 README token | X | | | | | | | | | | X |
| 17 §03 i18n | X | | | | | | | | | | |
| 18 §07 CH-H/內嵌期 | X | | X | | | | | | | | |
| 19 §03 雙軌 | X | | | | | | | | | X | X |
| 20 metadata blocklist | X | | | | | | | | | | |
| 21 Hi-Fi A4 LIVE | X | X | | | | X | | | | | |
| 22 §08 權威表(翻轉) | X | X | | | | | | | | | |
| 23 README §3.2-3.5(翻轉) | X | | | | | | | | | | |
| 24 §03 carve-out 刪(翻轉) | X | X | | | | | | | | | |

**裁決不對映失真而以條文化落實**：裁 4（需求正本邊界→R-B4）、裁 5（變更控制→design-canon-change-control）矩陣零覆蓋，不直接改任一失真項文字，而以獨立條文承載。裁 7（撈回→R-C4）、裁 11（reconcile→follow-up）主要落地位置同為獨立條文/follow-up（見 §2 裁決索引表），但矩陣仍覆蓋部分失真項（裁7→items 2/11/13；裁11→items 3/5/10/16/19，見上表 X 標記），非零覆蓋（2026-07-19 task 5.5 逐格核對更正，原稿誤列為零覆蓋）。矩陣證每項失真至少對到裁 1（doc-first 為總綱），且每條裁決或覆蓋失真（裁1/2/3/6/7/8/9/10/11）或明列條文化落實（裁4/5 純條文化承載；裁7/11 條文化承載與矩陣覆蓋並存，依 R-C2b「或」關係擇一即足，見 spec.md:168/172）→ 零缺格。裁決 1 掛「1 MODIFIED（權威序 body）＋1 ADDED（R-B1 偏離處置序）」。

## 4. normative Crosswalk（摘要；完整 24 列在交付 Crosswalk 檔）

| 失真項 ID | 章節穩定錨 | 處置手法 | 所屬 Wave | 對應裁決 |
|---|---|---|---|---|
| 1 | §03 Route Map / CH-G | normative(doc) | 2 | 1,2 |
| 7 | §06 IfcReadyRecord/ConversionJob | descriptive(tests-delegated) | 2 | 1 |
| 9 | §08 R3 ＋ README §3.3 R3 | normative(doc)＋non-normative Open Decision 塊 | 1 | 1,6,8 |
| 14 | §04 HTTP 語意 | normative(doc)（顯式化補列、非誤動 carve-out） | 2 | 1,2,6,9 |
| 22 | §08 權威順序表 | normative(doc) 翻轉 | 1 | 1,2 |
| 23 | README §3.2/§3.5 | normative(doc) 翻轉 | 1 | 1 |
| 24 | §03 命名核對 carve-out | normative(doc) 刪除 | 1 | 1,2 |

> **R-B3 Q11 劃線**：item 14 各條（apply-overlay=501、A3 create=201、element-mapping→:49101、PROXY /*→白名單、:49100 signaling）全屬 HTTP 語意→normative(doc)；item 7（enum 對齊）屬修正正本對委任層錯述→descriptive(tests-delegated)、非 doc-first 反向遷就。顯式化既有事實補列不算誤動 carve-out，消除 §5.4/§5.5 對 item 14 的互相否決。

## 5. gap ledger schema（Q5/Q8 合併）

每列欄位：`item_id | classification{code-defect|canon-defect|undecided} | status{immediate-gap|deferred-by-canon|planned-not-built|open-decision} | file:line 證據 | verified-as-of=2026-07-17 | triage 優先序 | 符號級錨(AST/符號非裸行號) | adopted-in(commit SHA、純追蹤)`。

- **Q8 重分類**：canon v2 採納後僅無排期保護且非 planned 者入 immediate-gap；§07:575 A5–A10 deferral、§07 分期未到期 CH、v2 標 planned/標未做/目標＋現況對照 之項不得重分類為即時缺陷。
- **附記**：unified docks fixture 殼（item 3/19）雖判 immediate-gap，其修復已具名排入 follow-up `unified-docks-real-api`（已認列、非靜默缺口）。
- **CI 驗證**：複用 `test-agent-governance-check` dead-link/行數延伸，不新造工具。

## 6a. Follow-up changes（non-normative、不構成實作授權、序列化）

| Follow-up | 對應 in-flight change | 對應正本面/裁決 |
|---|---|---|
| embedded-viewport（新 CH 期） | viewer-embed-a1-highlight | R-B6 內嵌 viewport；§03 註記；item 18 |
| openspec-ledger-reconcile（裁決 E） | migrate-console-to-hifi-design、align-frontend-design-system-reference | 裁 11；**MUST NOT 早於 canon v2 採納 archive**；archive 前調和 align RENAMED(v3→v4)＋MODIFIED body |
| lineage-outbox-impl | rvt-ifc-usdc-lineage | §06 六態；item 2 |
| （A4 mock 邊界對應） | a4-semantic-search-model-qa | item 12；A4 semantic=外接 LLM |
| unified-docks-real-api（雙軌收斂） | —（本 change 新提） | item 3/19 |
| ch-g-route-convergence | —（本 change 新提） | item 1 |
| command-rejected-ch-c | —（本 change 新提） | CH-C |
| metadata-allowlist | —（本 change 新提） | item 20 |
| drift-gate-lightweight（AST/符號級 drift CI；fiberplane/drift 真實候選、可行性未證） | —（本 change 新提） | R-C1 CI 掛載點 |

觸同一 requirement 的 follow-up MUST 序列化，避免雙軌提案與 archive 聯集衝突。`openspec-ledger-reconcile` 於 archive 前 MUST 對已採納 canon v2 調和 align 的 RENAMED(Workflow v3→v4)＋MODIFIED body（align MODIFIED body 現重申「code＋tests/contracts 是現行 runtime behavior truth」＝doc-first 要翻轉的舊權威序）；序列上 align MUST NOT 早於 canon v2 採納 archive（讀 version-bump commit 存在性，Q6）。

## 6b. Open Decisions / Open Questions（一級 artifact；預設不採用、不逕自定案）

| # | 未裁決點 | 預設處置 | 待決條件 |
|---|---|---|---|
| OQ-1 | 是否新增 `asbuilt-partial` 之類外接待決 Prov 值（失真項 9 遺留） | **不採用、不併入 7 值集**；正本 v2 §08 R3 內顯式 non-normative『Open Decision 註記塊』承載，normative enum 維持封閉（7 值 Prov＋data-prov=fixture\|live）；擴充唯一路徑＝R-A1 提案＋使用者核准 | 須外接 as-built 部分覆蓋場景實際成立且經使用者裁決正本佐證 |
| OQ-2 | `ai-bim-governance.css` NVIDIA 綠品牌色票授權盲區 | **不逕自定案**；不入正本、僅入 design.md 與 gap ledger（品牌/授權決策） | 屬品牌/授權決策，須使用者裁決 |
| OQ-3 | `.dc.html`/css 快照面 AST drift CI 可行性 | 不採用、僅列名 follow-up `drift-gate-lightweight` | 工具對 `.dc.html` 雙檔可行性實測 |
| OQ-4 | 鐵律 3 行為級後 `ui-open-regression.spec` 未接 CI 空窗 | 明文標 known gap（不是 pass）；接 CI 為具名 follow-up | ui-open-regression.spec 接 CI |

載體規定（Q7）：OQ-1 於正本 v2 §08 R3 以顯式 non-normative『Open Decision 註記塊』隔離承載——normative enum 維持封閉且完整，使審查者可辨開放點為刻意隔離、非缺陷；R-B5 的 ProvTag enum 層預留乾淨擴充接口但不預先寫入待決值。OQ-2 不入正本、無 normative 對撞。

## 7. 研究依據（design.md 引用；外部僅限 OpenSpec/spec 治理，不推翻裁決）

- **doc-first 方向佐證（強度低、方向性）**：已有研究關注 spec-code 靜默漂移需架構性機制處理（如 spec-anchored/code-coupled/drift-enforced 討論，arxiv 類）；spec 作為單一真相源、drift 無聲失效特性支持 doc-first 與「標 planned 而非沉默宣稱已完成」。措辭不誇大為「文獻公認」。
- **OpenSpec 格式硬約束（已確認）**：delta 用 `## ADDED/MODIFIED/REMOVED Requirements` 標頭；每 `### Requirement:` ≥1 `#### Scenario:`；scenario 核心 WHEN/THEN 必填、GIVEN 選填（不硬套 GIVEN/WHEN/THEN）；MODIFIED delta 重現完整 requirement block；archive 保留全部 artifact；RFC2119 MUST/SHOULD/MAY 大寫且節制。`validate --strict` 只驗結構不驗事實，最終以本 repo 安裝版（v1.6.0）實跑為準。
- **版本語意**：借 SemVer 2.0.0＋ISO19650 suitability code 類比（非合規義務、非引入完整機器）。
- **不入條文者**：廠商行銷量化數字（90 天矩陣失效、6 個月文件衰減、30–50% KB 過期等）方向可信但不寫進 spec 條文；URL 不可驗來源（cebsworldwide 404、buildingSMART BCF 特定頁 403）降級為產業論述、不作嚴謹實證。
- **domain 事實**：Kit lease、navigator.clipboard 邀請、metadata blocklist、ProvTag 7 值等外部無公開研究，一律以 11 條內嵌裁決＋repo 證據為準，外部不得推翻或稀釋。

## 8. 本 change 自身失效模式（風險表）

| 風險 | 緩解 |
|---|---|
| AI 越權寫正本 | R-A1＋tasks 明文「產出＝提案文字」；PR 僅含 openspec/ 與草稿檔 |
| carve-out 被誤動 | R-B3 diff 斷言獨立 task；行為面等價判準（Q3/Q11）避免顯式化補列被誤判 |
| MODIFIED 對不上 header/範圍膨脹 | Task 0.3 先實跑 validate 確認 2 條 header 逐字重現、其餘 4 條未觸碰；新治理需求入 ADDED |
| align 先 archive → header 變 v4 | proposal PF-1/PF-2 硬前置 grep；否則 rebase 對準 v4 再驗 |
| 舊決策復活 | R-C4 逐句 provenance＋git show 實查 DoD＋三值判定 |
| canon-flip 無 task owner（R2-Q2） | R-C2 增 items 22/23/24 明確承載三處核心翻轉 |
| 需求雙 home 重複改寫 | R-C2/R-C3 單一 ownership＋cross-ref；R-B5/B6 只立原則 |
| 裸 planned 複製 F1（R2-Q5） | R-B5 強制 planned 帶 R2 三態 class；unclassified 綁 ledger triage 不逕自代裁 |
| 正本錯 code 對無出口（R2-Q5/Q6 併） | R-B1 三態分類 canon-defect→R-A1 提案、ledger pending-canon-fix |
| 具名外部依賴夾帶 | item 12 一律 genericize「外接 LLM（對應 a4-semantic-search-model-qa）」 |
| 未裁決點被逕自定案 | §6b Open Decisions：預設不採用、不逕自否決；OQ-1 §08 R3 non-normative 塊隔離 |
| 錨點載體不成立 | Task 0 spike hard gate；三段結論制 |
| 鐵律 3 無測試空窗 | 明文標 known gap（不是 pass）；ui-open-regression.spec 接 CI 為 follow-up |
| 版本無法回復 | R-A4 backup path/tag＋一步 restore＋dry-run 驗證 |
| 工具鏈鍍金/增生 | scope_out：不自建 drift 工具、不引 SemVer/ISO19650 全套、capability 僅 2 個 |

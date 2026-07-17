## MODIFIED Requirements

### Requirement: Workflow v3 and product design artifacts have distinct, non-overlapping authority

`docs/PROJECT_DEVELOPMENT_WORKFLOW.md`（workflow v3）與 `docs/plans/docs-plans-README.md` 導向的設計與規格正本 SHALL 維持互補不替代的分工，且需求權威序 SHALL 為 **doc-first**：`docs/plans` 設計正本（`AI-BIM 前後端設計文件.dc.html` §01 服務邊界／§02 部署拓撲／§03 前端架構 IA／§04 API 契約／§05 時序圖／§06 資料模型／§07 實作分期／§08 AI Coding 交付守則、`AI-BIM Console Hi-Fi.dc.html` 產品樣貌、`docs-plans-README.md` 導覽）是**唯一需求權威**。當 runtime code 行為偏離設計正本時，該偏離 SHALL 判為待修 implementation gap（要排修的工作），SHALL NOT 被解讀為「文件錯」而反向改寫正本遷就 code（本 change 刪除舊「以 code＋tests 為現況權威、書面需求列後序」的權威排序）。

內部裁決序 SHALL 為：前端視覺／互動以 `AI-BIM Console Hi-Fi.dc.html` ＋ `ai-bim-governance.css`（`--ab-*` token）為最高；行為／契約／邊界以設計文件 §01–§08 為權威；Prompt Board／場景圖僅為視覺上下文；跨域衝突（原型演了正本沒列的 API）依 R2 三態處理，不臆造後端。workflow v3 是開發流程入口，MUST 只 cross-reference，不得改寫需求或 runtime 現況。

誠實鐵律半句 SHALL 原樣保留：**任何文件不得反向覆蓋 runtime 現況陳述，亦不得以文件宣稱 runtime 已完成**；「標 planned」（誠實揭露未實作）與「判待修 gap」（doc-first 排修義務）兩義務 SHALL 同時成立、彼此不矛盾。runtime 建成現況 SHALL 以 code＋tests/contracts 直接查證（作為現況證據，非需求權威）。

#### Scenario: 讀者尋找開發流程

- **WHEN** 工程師想了解七層架構、Phase 脈絡、驗證證據分層、PR Checklist、服務測試命令或核心資料流
- **THEN** 應從 `docs/PROJECT_DEVELOPMENT_WORKFLOW.md` 進入
- **AND** plans 設計文件與原型 SHALL NOT 重述完整開發流程

#### Scenario: code 行為與設計正本衝突（doc-first 判 gap）

- **WHEN** runtime code 行為與正本 §01–§08 描述的同一 user-facing 需求衝突，且該條未列入保存性 carve-out 清單
- **THEN** 該偏離 SHALL 判為 implementation gap 並進 gap ledger 排修
- **AND** MUST NOT 反向改寫正本遷就 code；亦 MUST NOT 依舊「以程式碼為準、不回頭改碼」carve-out 主張正本永不修

#### Scenario: 誠實鐵律與 doc-first 非矛盾壓測

- **WHEN** 正本列了一條 planned 需求而 runtime 尚未實作
- **THEN** 文件 SHALL 標 planned（誠實，不宣稱已完成）
- **AND** 該項 SHALL 同時為待修 gap（doc-first 排修義務）；兩義務並存、無衝突

### Requirement: 文件分工調整必須走 PR 治理流程

任何對 workflow v3、設計文件／原型、README entrypoint 與 OpenSpec specs 之間分工的調整 SHALL 透過 PR 流程處理（含 pr-review-agent governance evidence 與 formal requirement source：issue／docs/plans／superpowers spec／existing contract／使用者明確授權），不直接 push `main`。2026-07-15 起設計與規格正本＝`AI-BIM 前後端設計文件.dc.html`（使用者授權之整批替換；舊 TRUTH/TARGET/BACKLOG/PROCESS 分工見 git history）。

在 doc-first 權威序下，對**手寫正本面**（兩份 `.dc.html`、`docs-plans-README.md`、`ai-bim-governance.css`）的改寫 SHALL 額外受 `design-canon-change-control` capability R-A1 約束：AI 只能開獨立提案 PR/OpenSpec change 附改寫文字、不自行 merge、不原地編輯；此為需求權威翻轉後對「誰能動正本」的必要保護，與本 requirement 的 PR 治理流程一致並互相 cross-reference。

#### Scenario: 把流程內容移到設計文件或把需求內容移到 workflow v3

- **WHEN** 有人提議把某段流程內容搬到設計文件／原型，或把 A1–A10 需求內容搬到 workflow v3
- **THEN** 必須開 PR 走 review ＋ GitHub Actions 驗證（governance evidence 表），並在 PR body 註明 formal requirement source；涉及 OpenSpec specs 的同步 MODIFIED delta 必須包含在同一 PR

#### Scenario: 對 README.md 的「產品與需求文件」段做結構性修改

- **WHEN** 有人提議調整 `README.md` 中「產品與需求文件」段的文件列表、角色定義或閱讀順序
- **THEN** 必須走 OpenSpec change 流程，不直接在 main 上修改該段；單純的拼字修正或 url 校正例外

#### Scenario: AI 改寫手寫正本面

- **WHEN** AI 產生對手寫正本面（含 `docs/plans/*.dc.html`、`docs-plans-README.md`、`ai-bim-governance.css`）的內容改寫
- **THEN** MUST 以獨立提案 PR/OpenSpec change 形式提交（cross-ref `design-canon-change-control` R-A1），MUST NOT 自行 merge 或原地編輯

## ADDED Requirements

### Requirement: R-B1 doc-first 偏離處置序與三態分類

當發現 runtime code 與設計正本偏離時，發現偏離的 agent SHALL 先入 gap ledger 並附偏離歸屬分類提議，分類值 SHALL 為 `{code-defect（正本對、code 待修 gap）｜canon-defect（code 對、正本寫錯）｜undecided（需解釋才能判）}`。判權 SHALL 為 agent 提議、使用者終裁；判準第一濾網 SHALL 為內部裁決序＋保存性 carve-out 清單（落在 carve-out 者依 carve-out 權威判，不入 doc-first gap 推定）。此偏離處置序與 MODIFIED「Workflow v3 and product design artifacts have distinct, non-overlapping authority」cross-ref。

當 agent 判定偏離屬 `canon-defect`（正本寫錯、code 才對）時，此為以 code 為證據、經提案＋核准改文件的路徑，權威仍終於正本，SHALL NOT 恢復舊 §03「以程式碼為準、不回頭改碼」carve-out（該 carve-out 主張文件永不修，doc-first 已刪）。

#### Scenario: 偏離判為 canon-defect

- **WHEN** agent 判定某偏離屬 canon-defect（正本寫錯、code 才對）
- **THEN** MUST 入 gap ledger 標 `pending-canon-fix` ＋ 開 `design-canon-change-control` R-A1 提案
- **AND** MUST NOT 逕自 Edit 正本，亦 MUST NOT 依舊 §03 carve-out 主張正本永不修

#### Scenario: 偏離落在 carve-out 清單

- **WHEN** 偏離對應的正本條文落在保存性 carve-out 清單（如 payload 委任、後端凍結面）
- **THEN** MUST 依該 carve-out 的權威判定，MUST NOT 逕自套 doc-first gap 推定

### Requirement: R-B2 誠實鐵律半句保留與非矛盾證明

「不得以文件宣稱 runtime 已完成／文件不得反向覆蓋 runtime 現況陳述」誠實鐵律半句 SHALL 在 doc-first 權威翻轉後原樣保留，並 SHALL 附非矛盾證明：doc-first（需求權威）與誠實鐵律（現況陳述權威）作用於不同對象，不衝突。

#### Scenario: 權威翻轉未誤傷誠實鐵律

- **WHEN** 改寫將需求權威翻為 doc-first
- **THEN** 誠實鐵律半句 MUST 保留於正本 §01 與對應章節
- **AND** MUST 附壓測 scenario 證明「標 planned」與「判待修 gap」並存無矛盾

### Requirement: R-B3 保存性 carve-out 清單與改寫前後 diff 斷言

改寫 SHALL 明列必須維持不變的 carve-out 清單並附改寫前後語意等價斷言。carve-out 至少含：§04 tests/contracts payload 委任、§01 鐵律 1–3、README §3.4 後端凍結面（`app.py`／`governanceProxy.ts`／`conversion_authority.py` 禁改；`/ui/open` 凍結；HTTP 資料／治理 API 面瀏覽器只達 `:8004`；`:49100` 及 spectator 埠段 WebRTC signaling 為既有合法直連例外，正典列於 §04）、§07:575 A5–A10 deferral 節奏。payload 委任 carve-out 邊界 SHALL 精確劃為：委任面＝payload 欄位形狀／序列化／值域 echo（以 tests/contracts 為權威）；HTTP 語意（status code／路由目標埠／代理白名單策略／合法瀏覽器直連面）＝行為權威、正本 normative 記述，不在委任 carve-out 內。語意等價判準 SHALL 為行為面（實際網路路徑／凍結三檔／302 行為）不變；顯式化既有事實之補列不算誤動 carve-out。

#### Scenario: v2 草稿完成後執行 carve-out diff 斷言

- **WHEN** v2 草稿完成
- **THEN** MUST 對 carve-out 清單逐條做改寫前後 diff 斷言（語意等價證明），任一條被誤動即為 blocker
- **AND** 顯式化既有事實之補列（如補列 `:49100` signaling 合法直連、HTTP 語意 normative 記述）MUST NOT 被判為誤動 carve-out

### Requirement: R-B4 需求正本邊界

`docs/plans` 現有資產 SHALL 為 A1–A10 需求的全部；外部 design repo（`C:\Repos\design\desigin-system`）SHALL 為唯讀 authoring origin，非需求來源。

#### Scenario: 以外部 repo 內容主張新需求

- **WHEN** 有人以外部 design repo 內容主張一項新需求
- **THEN** 該主張 SHALL 無效，MUST 先走 `design-canon-change-control` R-A1 提案改正本才成立

### Requirement: R-B5 R2 三態、mock 邊界與狀態詞彙統一

正本 SHALL 以單一狀態詞彙表達 API/功能建成狀態：R2 三態＝{正本有列＋code 有→整合；正本有列＋repo 內可建（governance/coordinator 擴充）→後端＋前端一次建到位（預設不做 mock 過渡）；依賴外接引擎（Isaac、Replicator、點雲 ICP、IoT feed、外部 LLM、P6 成本系統）→才准 mock 並掛 ProvTag；正本沒列＝NOT_BUILT}。狀態詞彙 SHALL 統一為實碼 `ProvTag`（7 值 `Prov`: `asbuilt`/`artifact`/`demo`/`p1`/`p15`/`p3`/`p4`）＋ `data-prov=fixture|live`。A4 mock 邊界 SHALL 精確劃在 LLM 解讀層（deterministic 檢索已於 governance-service/search 全棧落地）。A5/A6/A10 SHALL 依逐元件拆分（in-repo 可建＝全棧；外接依賴＝mock 合法）。

本 requirement 只定義詞彙與三態原則（single-ownership）；具體正本文字改寫 SHALL 由 R-C2 對應 task 唯一落實，本 requirement 與 R-C2 以 cross-ref 對應，MUST NOT 產生第二份改寫文字。正本 v2 中任一 `planned` 標記 SHALL 附 R2 三態 class 標籤 `{integrated-ready｜in-repo-fullstack-pending｜external-mock-legit｜not-built｜unclassified}`；`unclassified` SHALL 綁 gap ledger triage（用於 A7/A8/A9 等無裁決背書項，不逕自代裁）。是否新增 `asbuilt-partial` 之類外接待決 `Prov` 值 SHALL 為 Open Decision，預設不採用、不得靜默併入 7 值集。

#### Scenario: 功能依賴外接引擎而以 mock 呈現

- **WHEN** 某功能依賴外接引擎而以 mock 呈現
- **THEN** UI MUST 掛 ProvTag 誠實標示，且正本對應條目 MUST 標 planned

#### Scenario: 正本標 planned 但無三態 class

- **WHEN** 正本 v2 出現一個 `planned` 標記
- **THEN** MUST 附 R2 三態 class 標籤；無裁決背書者 MUST 標 `unclassified` 並綁 gap ledger triage，MUST NOT 對其逕自代裁

### Requirement: R-B6 內嵌 viewport 防護先行

Workspace 3D 內嵌（理想元件樹 `ViewportLayer=RemoteVideo(#remote-video)+OverlayHud+SelectionCallout`）SHALL 升格為應建目標；§03「Console 不長 WebRTC—3D 一律 HandoffButton」註記 SHALL 判為遺跡改寫；`/ui/open` 凍結面 SHALL 照舊併存（獨立 viewer 路徑保留）。EmbeddedViewer 若以跨-origin iframe 直嵌繞過 `/ui/open` 的 `signaling*` 參數消毒，SHALL 先具備與 `/ui/open` 等價的消毒防護，防護條文 SHALL 寫入正本 v2 先於任何實作授權（實作屬 follow-up `embedded-viewport`，不在本 change）。本 requirement 只立防護與 spectator/issues 裁決原則；對應正本段落實際改寫 SHALL 由 R-C2 唯一落實。

#### Scenario: 直嵌繞過 signaling 消毒（MUST 級防護）

- **WHEN** EmbeddedViewer 以跨-origin iframe 直嵌繞過 `/ui/open` 的 `signaling*` 參數消毒
- **THEN** MUST 先具備與 `/ui/open` 等價的消毒防護，且防護條文 MUST 寫入正本 v2 先於任何實作授權

#### Scenario: spectator 與 issues 裁決落地方向

- **WHEN** 正本記述 KIT_SPECTATOR_COUNT、邀請連結複製與 issues 入口
- **THEN** KIT_SPECTATOR_COUNT 預設 MUST 為 0（開啟＝部署決策入部署說明）；邀請連結 MUST 真複製（`navigator.clipboard`；現況 unified 假複製＝R3 違規列入改寫說明）；內嵌 spectator MUST 用 `streamRole=spectator`；issues 權威入口 MUST 記為 unified `#a1?dock=issues`（目標），legacy `#issues` 入雙軌退役清單（follow-up）

### Requirement: R-C1 gap ledger 分離原則與 schema

正本 v2 內文 SHALL 只用穩定章節／需求 ID 錨；21＋3 項失真的 `file:line` 證據 SHALL NOT 寫進手寫正本，改集中至獨立 gap ledger。gap ledger 每列 SHALL 含欄位：`classification`={code-defect｜canon-defect｜undecided}、`status`={immediate-gap｜deferred-by-canon｜planned-not-built｜open-decision}、`verified-as-of`、`triage 優先序`、`符號級錨`（AST／符號級非裸行號）、`adopted-in`（採納 commit SHA，非機器 gate、純追蹤）。gap ledger 的 drift 驗證 SHALL 複用既有 gate（`test-agent-governance-check` 的 dead-link／行數檢核延伸），不新造工具；AST 級 drift 工具對 `.dc.html` 之可行性未經證實，SHALL NOT 在本 change 採用，僅列名 follow-up `drift-gate-lightweight`。

#### Scenario: task 改寫文字內嵌裸 file:line

- **WHEN** 任一 task 的改寫文字內嵌裸 `file:line`
- **THEN** 該 task SHALL 不過 DoD

#### Scenario: canon v2 被採納後的偏離重分類

- **WHEN** canon v2 被採納
- **THEN** 僅無排期保護且非 planned 的偏離 SHALL 入 `immediate-gap`
- **AND** §07:575 A5–A10 deferral、§07 分期未到期 CH、v2 標 planned／標未做／目標＋現況對照 之項 MUST NOT 被重分類為即時缺陷

### Requirement: R-C2 失真地圖逐條改寫（唯一落實面、1 對 1 可驗）

本 change SHALL 把 21 項失真地圖 ＋ 裁決 1 明列的 3 處核心權威翻轉，共 **24 項 1 對 1 映射為 24 個獨立 task**，各自帶一 outcome ＋兩段化 DoD，MUST NOT 合併或省略。R-B5／R-B6 涉及的正本文字改寫皆匯集於此唯一落實（single-ownership），R-B5／R-B6 對同段落只提供原則性 cross-ref、不得產生第二份改寫文字。24 項為失真 (1)–(21) 加核心翻轉 (22) §08 權威順序表改 doc-first、(23) docs-plans-README §3.2/§3.5 權威語意改 doc-first、(24) 刪除 §03「以程式碼為準、不回頭改碼」carve-out。詳細條目見 `tasks.md`。

#### Scenario: 任一正本段落的唯一 ownership

- **WHEN** 某正本段落被多條需求（R-B5/R-B6 與 R-C2）涉及
- **THEN** 該段落改寫 MUST 只有一個 R-C2 task 為權威落實者，其他需求 MUST 只 cross-ref 不產生改寫文字

#### Scenario: 24 項不合併不省略

- **WHEN** 交付 R-C2 task 清單
- **THEN** 24 項 MUST 各自為獨立 task（一 outcome ＋兩段化 DoD），MUST NOT 合併或省略任一項

### Requirement: R-C2a normative Crosswalk 逐項驗收載體

本 change SHALL 產出一張 normative Crosswalk 表，欄位＝`失真項 ID｜章節穩定錨（§/需求 ID）｜區塊錨（界定 per-task draft-submitted diff 範圍）｜處置手法（逐條標 normative(doc)／descriptive(tests-delegated)，依 R-B3 劃分）｜可驗 DoD｜所屬批次（Wave）｜對應裁決編號`。每列 SHALL 獨立可勾稽；任一列無法對號即該工作包 fail。Crosswalk 為 spec 內穩定錨對號載體，與 gap ledger（repo 外 `file:line` 易腐證據 store）分工並用。

#### Scenario: Crosswalk 某列無法對號

- **WHEN** Crosswalk 任一列無法對到章節錨、處置手法或對應裁決
- **THEN** 該工作包 SHALL fail

### Requirement: R-C2b 24×11 追溯矩陣（完整性核對）

本 change SHALL 附一張「24 項失真 × 11 條裁決」追溯矩陣，證明零缺格：每項失真至少對到一條裁決來源，每條裁決至少覆蓋一項失真或明列「本裁決不對映失真而以條文化落實」。裁決 1 SHALL 掛為「1 條 MODIFIED（權威序 body 改寫，掛「Workflow v3…」條）＋ 1 條 ADDED（doc-first 偏離處置序 R-B1）」。

#### Scenario: 追溯矩陣缺格

- **WHEN** 有任一項失真對不到任何裁決，或任一裁決既不覆蓋失真也未標明條文化落實
- **THEN** 追溯矩陣 SHALL 判為缺格、不過驗收

### Requirement: R-C3 sequencing 與 merge-assembly（防並行草稿衝突）

§03 被多條 task（items 1/3/8/10/11/17/19 與核心翻轉 24）觸及、§08 被多條觸及，tasks SHALL 定義章節級彙整順序（同章 task 序列化、產出單一連貫全文），最終交付＝一份完整可審 v2 全文，MUST NOT 交付互相衝突的並行 patch。每個 task 的 `draft-submitted` ＝一份 per-task 章節內具名區塊 diff（區塊以 Crosswalk 區塊錨界定，可獨立審／獨立追溯）。v2 草稿檔身分 SHALL 為真 `.dc.html` 的完整平行副本（檔名如 `AI-BIM 前後端設計文件.v2-draft.dc.html`），merge-assembly 與 carve-out diff 一律以「對應原正本檔的當前 main 版本」為 base；Task 0 的細粒度穩定錨植入該副本。merge-assembly 為同章全 task 達 draft-submitted 後之獨立步驟，其 DoD＝組裝後章節全文 diff 恰為各 task 區塊 diff 之聯集、零新增語意（可機器比對）。

#### Scenario: 七個 task 共同重寫 §03

- **WHEN** 七個 task 共同重寫 §03，各改各自具名區塊
- **THEN** 各 task MUST 互不覆寫，merge-assembly 後 §03 全文 diff MUST 恰為各區塊 diff 之聯集、零新增語意

#### Scenario: 交付形態

- **WHEN** 本 change 交付正本 v2 改寫
- **THEN** 交付物 MUST 為一份對 base（原正本檔當前 main 版本）的完整連貫 v2 草稿副本，MUST NOT 為互相衝突的並行 patch

### Requirement: R-C4 裁決 7 撈回防腐

從 `a271e46` 父版（`git show a271e46^`）撈回 TARGET-shell/viewer/contracts 驗收句與 A5–A10 domain 契約，SHALL 逐句標注來源 commit（file:line）、逐一對照現行 11 條裁決 re-審（防復活已被 R2 三態／裁決 6 推翻的舊決策）、統一標 planned；不改 §07:575 deferral 節奏。撈不到的項 SHALL 在 design.md 標「來源不可考、不撈回」，不得憑記憶補寫。三值判定 SHALL 為 owner 提候選＋逐句附 source commit＋對映裁決編號、使用者終裁：`{相容→入 v2 標 planned｜乾淨衝突→淘汰入 ledger 記「已淘汰、不入 v2」｜含糊/部分重疊→undecided 入 ledger、不入 v2 待裁}`。

#### Scenario: 撈回句與現行裁決乾淨衝突

- **WHEN** 撈回句與現行 11 條裁決任一明文語句直接對立（如撈回句要求 mock 過渡而裁決 6 禁止）
- **THEN** SHALL 以現行裁決為準，並在 gap ledger 記錄「已淘汰、不入 v2」

#### Scenario: 撈回句來源不可考

- **WHEN** 某撈回項在 `git show a271e46^` 中找不到對應來源
- **THEN** SHALL 在 design.md 標「來源不可考、不撈回」，MUST NOT 憑記憶補寫

# Normative Crosswalk — doc-first-canon-v2（R-C2a）

> **用途**：24 項失真／核心翻轉（item 1–21＋核心翻轉 22/23/24）逐列對號正本 v2 草稿的穩定錨、處置手法、可驗 DoD、所屬 Wave、對應裁決、落實 commit。design.md §4 僅摘要 7/24 列（供快速定向），本檔為 R-C2a 要求的完整 24 列正本；design.md §3 的 24×11 追溯矩陣負責「裁決→失真項」證成，本檔負責「失真項→錨點／commit」可執行定位，兩者互補、不重複。
>
> **每列獨立可勾**：任一列的 DoD 指令可獨立執行、獨立判讀，不依賴其他列。

## 0. 欄位定義與指令慣例

- **失真項 ID**：對齊 proposal.md 失真地圖 (1)–(21) ＋ design.md §2 裁決 1 標出的三項核心翻轉（22/23/24，對應 tasks.md 3.1–3.3）。
- **章節穩定錨(secN+data-canon-id)**：Task 0 spike 首選錨點機制（`prep-evidence.md` §0.1）。兩份 `.dc.html` 用 `id="secN"`（章級，僅 `AI-BIM 前後端設計文件.v2-draft.dc.html` 有 `sec1..sec8`；Hi-Fi 檔無 secN，逐畫面 `data-screen-label`＋`data-canon-id`）＋ `data-canon-id="..."`（區塊級）；`docs-plans-README.v2-draft.md` 無 HTML id，用 `<!-- canon:... -->` 行尾註解比照精神植錨。本欄取「該項最主要落點」的 secN／檔案＋首要 data-canon-id／canon 註解。
- **區塊錨**：該項實際觸及的**全部**穩定錨（含次要／延伸位置），供多錨項目（如 item 9/12/14/16/18/21）完整定位；單錨項目與欄 2 相同屬預期現象、非缺格。
- **處置手法**：`normative(doc)`＝改寫後之正本文字本身即權威、code 偏離即待修 gap；`descriptive(tests-delegated)`＝正本文字對「委任層」（tests/contracts 或型別定義）之描述性引用，正本不自行定義權威值、以委任層為準（design.md §4 R-B3 Q11 劃線：本 change 僅 item 7 屬此類，其餘 23 項皆 normative(doc)）。
- **可驗 DoD(指令/grep)**：每列附至少一條可獨立執行的 grep／指令＋預期輸出，供機器或人工複核；指令假設 cwd＝本 worktree 根目錄（`.worktrees/doc-first-canon-v2`），下列 3 個 shell 變數為捷徑：
  ```bash
  MAIN="openspec/changes/doc-first-canon-v2/drafts/AI-BIM 前後端設計文件.v2-draft.dc.html"
  HIFI="openspec/changes/doc-first-canon-v2/drafts/AI-BIM Console Hi-Fi.v2-draft.dc.html"
  README="openspec/changes/doc-first-canon-v2/drafts/docs-plans-README.v2-draft.md"
  ```
  （表內指令一律以 `$MAIN`／`$HIFI`／`$README` 代稱上列三檔；`\|` 為 markdown 表格內對字面 pipe 字元的轉義，執行時去除跳脫符號還原為 `|`。）
- **所屬 Wave**：對齊 tasks.md `## 3. Wave 1`／`## 4. Wave 2` 兩節（本 change 24 項失真僅涉 Wave 1／Wave 2；Wave 3 概念不存在，tasks.md §5「彙整、載體與撈回」為 non-wave 收斂節）。
- **對應裁決編號**：逐字取自 design.md §3「24×11 追溯矩陣」該列 X 標記（非轉抄 design.md §4 摘要表、亦非各 task PASS note 內文——§4 摘要與 §3 矩陣對 item 24 即互相牴觸、而 PASS note 又忠實引用 §4 摘要一併偏離，詳見 §2 附註；§3 為零缺格追溯正本、內部一致，取之最穩）。
- **落實 commit**：`git log` 對 `task#N:` 前綴訊息逐一核對 tasks.md 對應子任務編號後取得；欄位填**該項落地的最後一個 commit sha**（含 gap-fix／review-fix，即目前 worktree 內的最終狀態）；完整 base＋fix commit chain 見 §3 附錄，供全鏈追溯。

## 1. 24 列主表

| 失真項 ID | 章節穩定錨(secN+data-canon-id) | 區塊錨 | 處置手法 | 可驗 DoD(指令/grep) | 所屬 Wave | 對應裁決編號 | 落實 commit |
|---|---|---|---|---|---|---|---|
| 1 | sec3／`c3-route-map` | `c3-route-map`＋`c3-legacy-route-convergence` | normative(doc) | `grep -c "CH-G(URL 收斂)整體狀態:未做" $MAIN` → 1 | Wave 2 | 裁1,2 | `fdf8479` |
| 2 | sec6／`c6-callback-outbox-lineage-outbox` | `c6-callback-outbox-lineage-outbox` | normative(doc) | `grep -A2 'data-canon-id="c6-callback-outbox-lineage-outbox"' $MAIN \| grep -c "planned(class: in-repo-fullstack-pending)"` → 1 | Wave 2 | 裁1,7 | `d5f3ae5` |
| 3 | sec3／`c3-badge-spectator-gate` | `c3-badge-spectator-gate` | normative(doc) | `grep -c "unified docks 現為 fixture 殼、無真實寫入亦無 gate 接線" $MAIN` → 1 | Wave 2 | 裁1,2,11 | `519ff0c` |
| 4 | sec7／`c7-residual-badges` | `c7-residual-badges`（第 2 個 badge，main 舊行 577） | normative(doc) | `grep -c "ai_journal" $MAIN` → 0（歸零；改指 OpenSpec change 目錄＋PR body AI Coding Governance 表） | Wave 1 | 裁1 | `8635d32` |
| 5 | sec7＋sec8／`c7-residual-badges`＋`c8-hifi-verification-chain` | `c7-residual-badges`（main 舊行 578/579）＋`c8-hifi-verification-chain`（main 舊行 673） | normative(doc) | `grep -cE "2\.4–2\.8\|已知不一致" $MAIN` → 0 | Wave 1 | 裁1,11 | `3cfc840` |
| 6 | sec2／`c2-docker-web-plane` | `c2-docker-web-plane`（MinIO／UnifiedConsole 改標）＋`c2-host-native-gpu`（governance-service 移入） | normative(doc) | `grep -c "governance-service(host-native,不在任何 compose 內)" $MAIN` → 1 | Wave 2 | 裁1,3 | `7b9c3f4` |
| 7 | sec6／`c6-ifc-ready-record` | `c6-ifc-ready-record`＋`c6-conversion-job` | descriptive(tests-delegated) | `grep -c "accepted\|queued_for_conversion\|dispatched\|dispatch_failed\|dropped_on_restart\|failed" $MAIN` → 1 | Wave 2 | 裁1 | `fdf8479` |
| 8 | sec3／`c3-naming-check` | `c3-naming-check`（DataChannel 自糾 bullet，main 舊行 214） | normative(doc) | `grep -c "標「待補」與現況不符" $MAIN` → 0 | Wave 1 | 裁1 | `abd9000` |
| 9 | sec8／`c8-r3-provenance`；README §3(3)／`<!-- canon:r-four-iron-rules -->` | `c8-r3-provenance`（＋巢狀 `c8-r3-oq1-open-decision`）；README「四條鐵律」R3 子句（R3 本身無獨立子錨，隨整條 R1–R4 bullet 共用 `r-four-iron-rules`） | normative(doc)＋non-normative Open Decision 塊 | `grep -c "ProvenanceTag" $MAIN; grep -c "ProvenanceTag" $README` → 各 0；`grep -A15 'data-canon-id="c8-r3-provenance"' $MAIN \| grep -c "ProvTag"` → 1 | Wave 1 | 裁1,6,8 | `fdf8479` |
| 10 | sec8／`c8-closing-badges` | `c8-closing-badges`（結構 badge）＋共用元件清單標題鄰近新增 badge | normative(doc) | `grep -c "現況 1/14 以此命名存在" $MAIN` → 1 | Wave 2 | 裁1,11 | `36f4af3` |
| 11 | sec8／`c8-task-sequence-table` | 新增子表 `c8-task-ch-crosswalk` | normative(doc) | `grep -c 'data-canon-id="c8-task-ch-crosswalk"' $MAIN` → 1 | Wave 2 | 裁1,7 | `6cecd0c` |
| 12 | sec8／`c8-r2-api-tristate` | `c8-r2-api-tristate`＋`c8-domain-reality-table`＋`c8-task-sequence-table`（＋README §3(3) R2 子句，同錨 `r-four-iron-rules`） | normative(doc) | `grep -cE "Isaac\|Replicator\|P6[^0-9]" $MAIN` → 0；`grep -A20 'data-canon-id="c8-domain-reality-table"' $MAIN \| grep -c "planned(class: in-repo-fullstack-pending)"` → 3 | Wave 2 | 裁1,6,8 | `633b832` |
| 13 | sec4／`id="sec4"`（標題列，無專屬 data-canon-id） | `#sec4` 標題後新增獨立 badge（main 行 230，先於 `c4-coordinator-api`） | normative(doc) | `grep -A6 'id="sec4"' $MAIN \| grep -c "A1–A10 各 API 的契約檔=planned"` → 1 | Wave 2 | 裁1,6,7 | `7b651d8` |
| 14 | sec4／`c4-coordinator-api` | `c4-coordinator-api`（PROXY 白名單＋element-mapping 列）＋`c4-governance-api`（apply-overlay 501／federated-sets 201）＋`c8-r2-api-tristate`（:49100 例外句延伸） | normative(doc)（顯式化補列、非誤動 carve-out） | `grep -c "501(overlay 實走前端 DataChannel" $MAIN` → 1；`grep -c "→ 201(同步 create;A1/A2 為 202 async)" $MAIN` → 1；`grep -c ":49100(WebRTC signaling)與 spectator 埠段" $MAIN` → 1 | Wave 2 | 裁1,2,6,9 | `dcadd6f` |
| 15 | sec1／`c1-badges` | `c1-badges`（鐵律 3 badge） | normative(doc) | `grep -c "byte-for-byte" $MAIN` → 0；`grep -A5 'data-canon-id="c1-badges"' $MAIN \| grep -c "known gap(不是 pass)"` → 1（gap-fix 2026-07-19：task 5.7〔Open Decisions 專章，commit `43ba986`〕於 §08 OQ-4 索引列新增第二處「known gap(不是 pass)」，原全域 `grep -c` 由 1 漂為 2；本列改以 §01 `c1-badges` 錨 `grep -A5` 隔離、只計鐵律 3 badge 單處，維持每列獨立可勾、不依賴 OQ-4 列） | Wave 2 | 裁1 | `eaeff4b` |
| 16 | README §1／`<!-- canon:r-file-table -->`；README §3(3)／`<!-- canon:r-four-iron-rules -->` | README §1 檔案清單新增列（`ai-bim-governance.css`，鄰近 `r-file-table`）＋§3 R1 子句（`--ab-*`／`--ec-*` 退役，同 `r-four-iron-rules` 錨） | normative(doc) | `grep -c -- "--ec-\* token 單一真相源" $README` → 0；`grep -c "design token 單一真相源＝docs/plans/ai-bim-governance.css" $README` → 1 | Wave 2 | 裁1,11 | `413ad43` |
| 17 | sec3／`c3-badge-i18n` | `c3-badge-i18n` | normative(doc) | `grep -c "中央字典現置 console/unified/fixtures.ts" $MAIN` → 1 | Wave 2 | 裁1 | `fc34ac4` |
| 18 | sec7／`c7-ch-schedule-table` | `c7-ch-schedule-table`（新增 CH-H／CH-I 列）＋sec3／`c3-badge-workspace-handoff` | normative(doc) | `grep -A20 'data-canon-id="c7-ch-schedule-table"' $MAIN \| grep -cE "CH-H\|CH-I"` → 2；`grep -c "內嵌=CH-I" $MAIN` → 1 | Wave 2 | 裁1,3 | `0cb7989` |
| 19 | sec3／`c3-badge-dual-track` | `c3-badge-dual-track` | normative(doc) | `grep -c "雙軌現況(2026-07-18)" $MAIN` → 1 | Wave 2 | 裁1,10,11 | `6729fea` |
| 20 | sec4／`c4-contract-conversion-result-callback` | `c4-contract-conversion-result-callback` | normative(doc) | `grep -c "metadata-allowlist:planned(class: in-repo-fullstack-pending)" $MAIN` → 1（gap-fix 2026-07-19：task 6.1〔planned 無裸標檢查／class token 統一，commit `79ea3d5`〕將 draft 內舊字串 `follow-up metadata-allowlist(planned)` 收斂為 R2-class 化 `metadata-allowlist:planned(class: in-repo-fullstack-pending)`〔draft:322〕，舊字串 HEAD 已歸 0；本列 DoD 期望字串同步對齊 HEAD） | Wave 2 | 裁1 | `1e5daea` |
| 21 | HIFI doc（無 secN）／`hifi-home` | `hifi-home`（啟動器 caption）＋`hifi-workspace`（A4 dock 標頭 badge）＋`hifi-concept`（concept_note 雙語）＋`apps` 資料陣列（script 內，無獨立 canon-id，同步驅動 nav／home 兩面渲染） | normative(doc) | `grep -ic "hybrid" $HIFI` → 5 | Wave 2 | 裁1,2,6 | `ccac174` |
| 22（核心翻轉） | sec8／`c8-authority-table` | `c8-authority-table` | normative(doc) 翻轉 | `grep -c "docs/plans 需求正本" $MAIN` → 1 | Wave 1 | 裁1,2 | `32edfa2` |
| 23（核心翻轉） | README §3(2)／`<!-- canon:r-authority-order -->`；README §3(5)／`<!-- canon:r-runtime-authority -->` | README 條列 2（權威順序表）＋條列 5（需求權威語意） | normative(doc) 翻轉 | `grep -c "需求權威＝本目錄設計正本（doc-first）" $README` → 1 | Wave 1 | 裁1 | `6698b75` |
| 24（核心翻轉） | sec3／`c3-naming-check` | `c3-naming-check` | normative(doc) 刪除 | `grep -c "以下以程式碼為準,不回頭改程式碼命名" $MAIN` → 0 | Wave 1 | 裁1,2 | `f079ef0` |

## 2. 與既有 artifact 的一致性核對（本表撰寫期發現，記錄不逕改他檔）

本表撰寫時逐列對照 `gap-ledger.md`（task 5.3，已 PASS＋commit）與 `design.md`，發現兩處既有 artifact 的引註／內部一致性瑕疵；依 R-C2 single-ownership，本檔不越權修改 `gap-ledger.md`／`design.md`，僅在此記錄供後續 task／PR 審查參考：

- **gap-ledger.md item 9／16 之「錨(data-canon-id)」欄**：兩列原記 README 錨為 `<!-- canon:r-authority-order -->`（誤）；經本表直接複查 `docs-plans-README.v2-draft.md`，「四條鐵律」整條 bullet（含 item 9 之 R3 子句、item 16 之 R1 子句）實際尾隨 `<!-- canon:r-four-iron-rules -->`（第 40 行），`r-authority-order` 錨在前一條「權威順序」bullet（第 39 行），非四條鐵律所在行；item 16 另涉 §1 檔案清單新增列，鄰近錨實為 `<!-- canon:r-file-table -->`（第 21 行）。本表 §1 主表對 item 9/16 已採用直接複查後的正確錨點；`gap-ledger.md` item 9／16 錨欄亦已於 fixer gap-fix（2026-07-19）同步更正——item 9 改 `r-four-iron-rules`、item 16 併列 `r-file-table`＋`r-four-iron-rules`，兩檔錨欄現一致。
- **design.md 自身 §4 摘要與 §3 矩陣對 item 24「對應裁決」互相牴觸（真正缺陷；非 tasks.md 轉寫錯）**：design.md §4 摘要表（design.md:95）逐字為「24 \| §03 命名核對 carve-out \| normative(doc) 刪除 \| 1 \| 1,2,24 \|」，對應裁決欄自建檔起即寫 `1,2,24`（`git blame` 覆核該行溯及 design.md 首版 commit `378a9c1`、從未改動，`1,2,24` 非後續 typo）；但 design.md §3「24×11 追溯矩陣」item 24 列（design.md:81）僅於 裁1／裁2 兩格標 X——全案僅 11 條裁決（§3 表頭 design.md:56＝裁1..裁11）、根本無「裁24」。二者對同一失真項給出不同的裁決集，屬 design.md **內部 §4-vs-§3 不一致**（§4 摘要多出一個不可能的自我指涉「24」）。tasks.md 3.3 PASS note 之「裁1,2,24」係**忠實逐字轉抄** design.md §4 摘要現況、非 tasks.md 誤植。依 §0 欄位慣例（本檔 §1「對應裁決編號」逐字取自 §3 矩陣，非 §4 摘要亦非 PASS note），本表 §1 對 item 24 採 §3 矩陣值 `裁1,2`（內部一致、不含「裁24」）。**gap-fix（2026-07-19，fixer）**：該 `1,2,24` 為本 change 自有交付物之原始 authoring 失真（非跨 repo 邊界），就地即可修——故本次已將 design.md:95（§4 摘要表 item 24 列）該格由 `1,2,24` 更正為 `1,2`（單格修正，對齊 §3 矩陣與本表 §1 item 24 之 `裁1,2`），原「留 design.md 擁有者於後續 PR 修正」之遞延撤銷（final reviewer 判定：對自有交付物之遞延不成立）；上段對 §4 該格「逐字為 `1,2,24`」「`git blame` 溯及 `378a9c1`、從未改動」與「tasks.md 3.3 PASS note 忠實轉抄 §4 摘要現況」諸描述，均係本 gap-fix **前**之狀態快照（證 `1,2,24` 為原始 authoring 缺陷、非後續 typo）；本 gap-fix **後** design.md §4 現況已改為 `1,2`，而 `tasks.md` 3.3／5.4 PASS note 內殘留之「裁1,2,24」依 audit-trail 慣例（不回改原 PASS 文字以存軌跡）保留為轉抄當時之歷史記錄、非現況值。design.md §4／§3 矩陣／本表 §1 三方現一致。

## 3. commit chain 附錄（base＋fix 完整鏈，補充主表「落實 commit」單一終態值）

| 失真項 ID | commit chain（時間序，最後一個＝主表落實 commit） |
|---|---|
| 1 | `8d39349`（base）→ `9b115e6`（fix：CH-G #intake 現況欄移除偽斷言）→ `fdf8479`（gap-fix：`c3-legacy-route-convergence` 內 draft 裸行號 `app.ts:3703-3704` 收斂為「gap ledger item 1」指標，task 5.3 R-C1 正本零裸行號 side-effect） |
| 2 | `2480f1a`（base）→ `d5f3ae5`（fix：改用封閉列舉 token） |
| 3 | `519ff0c` |
| 4 | `8635d32` |
| 5 | `3cfc840` |
| 6 | `7b9c3f4` |
| 7 | `a6b3cea`（base）→ `fdf8479`（gap-fix：`c6-ifc-ready-record`／`c6-conversion-job` 內 draft 裸行號 `types.ts:195-206`／`conversionLedger.ts:11` 收斂為「gap ledger item 7」指標，task 5.3 R-C1 正本零裸行號 side-effect） |
| 8 | `abd9000` |
| 9 | `973204b`（base）→ `bf062ff`（fix：README §3.3 R3 殘留收斂）→ `fdf8479`（gap-fix：`c8-r3-provenance` 內 draft 裸行號 `data.ts:6` 收斂為「gap ledger item 9」指標，task 5.3 R-C1 正本零裸行號 side-effect） |
| 10 | `afd80f5`（base）→ `36f4af3`（fix：0/14→1/14 計數矯正） |
| 11 | `d0c104e`（base）→ `6cecd0c`（review-fix：`c8-task-ch-crosswalk` 子表 Task 11–12 列 stale forward-ref「§07 CH-H 家族…現況本文件尚未列」收斂為「§07 CH-H/CH-I，對應 item 18，已列入本文件」，task 5.2 §08 merge-assembly Plan B final-review f1 side-effect） |
| 12 | `6a6cfa1`（base）→ `68e1507`（review-fix：餵法表殘留對齊）→ `633b832`（fix：封閉 class token） |
| 13 | `7b651d8` |
| 14 | `dcadd6f` |
| 15 | `0485a22`（base）→ `a44b892`（fix：signaling* 具名 allowlist）→ `eaeff4b`（fix：citation 歸屬＋CRLF 計數矯正） |
| 16 | `c017e64`（base）→ `413ad43`（fix：查證方法陳述矯正） |
| 17 | `fc34ac4` |
| 18 | `0cb7989` |
| 19 | `6729fea` |
| 20 | `1e5daea` |
| 21 | `ccac174` |
| 22 | `8d12b8b`（base）→ `32edfa2`（review-fix：移除誤植「使用者最新明確指令」列） |
| 23 | `6698b75` |
| 24 | `f079ef0` |

## 4. 與 §5.1/§5.2 merge-assembly 的關係

本表逐項的「章節穩定錨／區塊錨」與 `assembly-verification.md`（tasks.md 5.1／5.2）之 hunk-對號結論互證：任一項在本表列出的 data-canon-id，皆可於 `assembly-verification.md` 對應章節之 hunk 明細中找到同一 data-canon-id 出現、且對號至同一失真項編號；兩檔案交叉核對零矛盾（本表建表時逐一複查，未發現任一項本表錨點與 assembly-verification.md hunk 對號不一致）。

---

verified-as-of：2026-07-19（本 task 執行時對 worktree 內三份 v2 草稿逐項 grep 複核，見各列 DoD 指令輸出）。

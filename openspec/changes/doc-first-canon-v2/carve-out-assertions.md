# Carve-out Diff 斷言清單 — doc-first-canon-v2（Task 2.4 / R-B3 補償閘）

> 對應 tasks.md `2.4 carve-out diff 斷言（R-B3 補償閘）`與 spec delta `documentation-source-of-truth` ADDED `R-B3 保存性 carve-out 清單與改寫前後 diff 斷言`。本檔操作化 R-B3「carve-out 至少含」五項為可逐條執行的改寫前後語意等價檢核；不新增第 6 項 carve-out（擴充 carve-out 清單本身須另走 `design-canon-change-control` R-A1 提案，非本檔權責）。

## 0. 通則

- **diff base（design.md §1.3 三處統一之一）**：一律以「對應原正本檔的**當前 main 版本**」為 base，即 `git show main:<path>`；**不是** `docs/plans/` 工作樹副本本身（雖然本 change 生命週期內二者理應逐字相同，因 R-A1 禁止 AI 直接編輯正本——工作樹副本僅作為 main 未動的旁證，main 版本才是規範定義的 base）。改寫後版本一律讀 `openspec/changes/doc-first-canon-v2/drafts/*.v2-draft.*`。
- **判準總則（R-B3）**：語意等價 = **行為面**（實際網路路徑／凍結三檔／302 行為等）不變；**顯式化既有事實之補列不算誤動**（如 item 14 全部子項、`:49100` signaling 合法直連例外）。
- **執行時機**：本清單於兩個時點皆可執行——(a) **開發期迴歸防護**：Wave 1/2/3 任一 task 進行時，防止手滑動到不該動的段落；(b) **R-B3 定案 gate**：`WHEN v2 草稿完成 THEN MUST 對 carve-out 清單逐條做改寫前後 diff 斷言`（spec.md R-B3 scenario），為 tasks.md §6 收斂驗收的必經檢核之一。
- **Blocker 規則**：任一條檢核未過、且不落在該條「備註」已列名的允許改寫/允許新增例外 → 判**誤動**、SHALL 為 blocker。處置：(a) 若源頭是某 R-C2 wave task 越界動了不該動的內容 → 退回該 task 重做，不得就地放行；(b) 若為新提議之語意變更（例如想再放寬某條 carve-out）→ 須先走 `design-canon-change-control` R-A1 提案＋使用者核准，本檔或任何 task 不得逕自定案。
- **指令執行前提**：全部指令假設 cwd = 本 worktree 根目錄（`.worktrees/doc-first-canon-v2`），且本地 `main` ref 可達（`git merge-base HEAD main` 有效）；本檔撰寫時已逐條實跑，基準態（Wave 1/2 尚未開始改寫正文，僅 Task 0 植入 `data-canon-id`／`<!-- canon:* -->` 錨）全數 PASS，verified-as-of = 2026-07-18。
- **錨點覆蓋現況**：Task 0.1 已於 v2 草稿植入細粒度穩定錨（`.dc.html` 用 `data-canon-id`、README 用 `<!-- canon:xxx -->` HTML 註解）；本清單五項中四項有可用錨（items 2/3/4/5），item 1（§04 payload 委任句）尚無專屬細粒度錨，僅有章級 `id="sec4"`——細粒度區塊錨留待 R-C2a task 5.4 Crosswalk 建表時一併補設，本檔以逐字 grep/diff 作為現行精確定位機制，不依賴該錨。

## 1. 摘要表

| # | Carve-out | 原文位置 | 改寫預期 | 誤動判準核心 |
|---|---|---|---|---|
| 1 | §04 Payload 委任 | `.dc.html` §04 標題列（main:224） | 逐字不變 | 委任句本身被改寫/刪除 |
| 2 | §01 鐵律 1–3 | `.dc.html` §01 `c1-badges`（main:105–107） | 鐵律1/2 逐字不變；鐵律3 措辭 MAY 改（item 15） | 鐵律1/2 任何字變動；鐵律3 遺失凍結／CI guard 語意 |
| 3 | README §3.4 後端凍結面 | `docs-plans-README.md` §3.4（main:39） | 逐字不變（MAY 新增 `:49100` 例外澄清／`<!-- canon:* -->` 錨點） | 三禁改檔名／禁直連清單／`coordinator :8004`／byte-identical 任一被刪減/弱化 |
| 4 | README §3.5 誠實半句 | `docs-plans-README.md` §3.5（main:40） | 整句預期被 item 23 翻轉；誠實子句 MUST 留 | 「不得以文件宣稱 runtime 已完成」字面或等價改述雙雙消失 |
| 5 | §07:575 A5–A10 deferral | `.dc.html` §07 `c7-residual-badges` 內首個 badge（main:575） | 逐字不變 | 任何字被改寫/刪除 |

## 2. 逐條斷言

### Carve-out 1 — §04「Payload 以 tests/contracts/\*.json 為最高標準」委任

**原文位置**：`docs/plans/AI-BIM 前後端設計文件.dc.html` §04（`id="sec4"`，main line 220）標題列 span，main line 224。尚無 Task 0 細粒度 `data-canon-id`（該行為章節標題說明，不在既有錨點清單內；區塊錨待 task 5.4 Crosswalk 補設）。同概念於 `docs-plans-README.md` 有兩處回聲：§2 讀取路線表（main line 28：「Payload 以 `tests/contracts/*.json` 為最高標準」）與 §4 舊檔去向表 TARGET-contracts 列（main line 49：「Payload 以 `tests/contracts/*.json` 為準」，措辭「為準」非「為最高標準」，屬既有的非逐字回聲，本身不是本 carve-out 的逐字保護對象，僅作交叉印證）。

> 原文：`Payload 以 tests/contracts/*.json 為最高標準`

**判準**：R-B3 精確劃界——委任面＝payload 欄位形狀／序列化／值域 echo（以 tests/contracts 為權威），本句逐字保護；HTTP 語意（status code／路由目標埠／代理白名單策略／合法瀏覽器直連面，即 item 14 全部子項）＝行為權威、正本 normative 記述，**不在**本委任 carve-out 內，可在 §04 其他區塊新增而不算誤動——但**不得**改寫或刪除本句字面。

**檢核指令**：
```bash
# (a) .dc.html 本句：main 與 draft 逐字相等（空 diff = PASS）
diff \
  <(git show main:"docs/plans/AI-BIM 前後端設計文件.dc.html" | grep -F 'Payload 以 tests/contracts/*.json 為最高標準') \
  <(grep -F 'Payload 以 tests/contracts/*.json 為最高標準' "openspec/changes/doc-first-canon-v2/drafts/AI-BIM 前後端設計文件.v2-draft.dc.html")

# (b) README 兩處回聲：main 與 draft 逐字相等
diff \
  <(git show main:"docs/plans/docs-plans-README.md" | grep -F 'tests/contracts/*.json') \
  <(grep -F 'tests/contracts/*.json' "openspec/changes/doc-first-canon-v2/drafts/docs-plans-README.v2-draft.md")
```
兩者皆須空輸出（`echo $?` = 0）；若 (a) 非空，直接判誤動（此句無「等價改述」豁免，因 R-B3 明定逐字委任語意，不是可翻轉語句）。若 (b) 非空但 (a) 空，屬次要回聲漂移，記入備註人工核對是否仍語意等價，不單獨構成 blocker。

**備註**：item 14 全部子項（`apply-overlay`=501、A3 create=201、element-mapping→`:49101`、`PROXY /*`→白名單、`:49100` signaling 合法例外）落在 HTTP 語意面而非本句，屬顯式化既有事實補列，**不算誤動**；上面 (a) 的空 diff 天然涵蓋此邊界——只要本句字面沒被動過，§04 其他地方新增再多都不影響本檢核結果。

---

### Carve-out 2 — §01 鐵律 1（metadata-only）／鐵律 2（`:8004` 唯一瀏覽器面）／鐵律 3（`/ui/open` 凍結，改為行為級描述但凍結本體不動）

**原文位置**：`docs/plans/AI-BIM 前後端設計文件.dc.html` §01（`id="sec1"`），`data-canon-id="c1-badges"` 區塊（main/draft line 104），三個 badge span（main line 105 / 106 / 107）。

> 鐵律 1：`鐵律 1 — 大模型檔案(.ifc / .usdc)不出落地端;workflow callback與Cloud Ingest均只傳metadata/result ref`
> 鐵律 2：`鐵律 2 — :8004 是瀏覽器唯一可達面;:49101/:49102/:8010 一律經 proxy`
> 鐵律 3：`鐵律 3 — /ui/open?session= handoff 凍結,byte-for-byte + CI guard`

**判準**：鐵律 1、鐵律 2 未被本 change 任何 R-C2 task 列為改寫目標 → 逐字不變。鐵律 3 是 item 15／task 4.11 的明訂改寫目標——「byte-for-byte」措辭 **MAY** 改為行為級描述（302/301/參數白名單），但下列語意元素 **MUST** 全部保留：(a) `/ui/open?session=` 為 handoff 凍結對象、(b) 凍結本體不動（措辭可換，但「這是凍結面」的宣告不能消失）、(c) 仍要求 CI guard（即便 `ui-open-regression.spec` 尚未掛 CI 為 OQ-4 known gap，鐵律文字本身「應有 CI guard」的要求不能被拿掉）。

**檢核指令**：
```bash
DRAFT="openspec/changes/doc-first-canon-v2/drafts/AI-BIM 前後端設計文件.v2-draft.dc.html"

# 鐵律 1：逐字相等
diff \
  <(git show main:"docs/plans/AI-BIM 前後端設計文件.dc.html" | grep -F '鐵律 1 — 大模型檔案(.ifc / .usdc)不出落地端') \
  <(grep -F '鐵律 1 — 大模型檔案(.ifc / .usdc)不出落地端' "$DRAFT")

# 鐵律 2：逐字相等
diff \
  <(git show main:"docs/plans/AI-BIM 前後端設計文件.dc.html" | grep -F '鐵律 2 — :8004 是瀏覽器唯一可達面') \
  <(grep -F '鐵律 2 — :8004 是瀏覽器唯一可達面' "$DRAFT")

# 鐵律 3：must-preserve（非逐字相等）——同一行須同時含凍結對象與「凍結」宣告
grep -F '鐵律 3' "$DRAFT" | grep -F '/ui/open?session=' | grep -F '凍結'
```
鐵律 1/2 兩條 diff 皆須空輸出。鐵律 3 的 grep 鏈須有輸出（非空 = 三元素同行存在）；若無輸出，MUST 人工判讀該行是否仍以其他措辭表達「handoff 凍結對象是 `/ui/open?session=`」與「有 CI guard 要求」，不得逕自判 pass。

**備註**：鐵律 3 若被整段刪除、或改寫後不再提及 `/ui/open?session=` 為凍結對象、或悄悄拿掉 CI guard 要求，一律判誤動；單純把「byte-for-byte」字面換成「302/301/參數白名單」等行為級描述本身**不算誤動**（item 15 授權範圍內的改寫，非 carve-out 破口）。`ui-open-regression.spec` 未接 CI 之空窗本身已由 OQ-4 明文標 known gap，本檢核不重複判定該空窗，只驗文字語意未失真。

---

### Carve-out 3 — README §3.4 後端凍結面三檔＋禁直連清單

**原文位置**：`docs/plans/docs-plans-README.md` §3 效力，第 4 點（main line 39）；draft 對應 `<!-- canon:r-backend-freeze -->` 錨（`openspec/changes/doc-first-canon-v2/drafts/docs-plans-README.v2-draft.md`）。

> 原文：`4. **後端凍結面**（自舊 TARGET-contracts §1 承繼，效力不變）：前端只打 coordinator \`:8004\`；proxy 路徑 byte-identical；禁改 governance \`app.py\`、coordinator \`governanceProxy.ts\`、streaming \`conversion_authority.py\`；瀏覽器禁直連 \`:49101\`／\`:49102\`／\`:8010\`。`

**判準**：三禁改檔名（`app.py`／`governanceProxy.ts`／`conversion_authority.py`）、`:49101`／`:49102`／`:8010` 禁直連清單、coordinator `:8004` 為前端唯一目標，逐字不變。R-B3 明文允許新增「`:49100` 及 spectator 埠段 WebRTC signaling 為既有合法直連例外，正典列於 §04」之澄清句（可加在本點或僅加在 §04，兩者皆合規）。

**檢核指令**：
```bash
README_DRAFT="openspec/changes/doc-first-canon-v2/drafts/docs-plans-README.v2-draft.md"
# Task 0 已於本行行尾內嵌 `<!-- canon:r-backend-freeze -->` 錨（屬允許新增，非受保護 carve-out 內容）；
# 全句 diff 前兩側先剝除 canon 錨點註解，否則錨點恆造成假性非空 diff、反而掩蓋真實改寫（見下方判準）。
SED_STRIP_CANON='s/[[:space:]]*<!-- canon:[^>]*>//g'

# 主檢核：前綴錨定全句逐字相等（空 diff = PASS；涵蓋整行——連接詞、`coordinator :8004`、`byte-identical` 全在內，非僅抽驗子字串）。
# grep pattern 必須錨定 §3 第 4 點列首前綴 `4. **後端凍結面**`（唯一命中 main line 39／draft line 40 的受保護 carve-out 原文）；
# 不可退回裸子字串 `後端凍結面`——該四字亦命中 §4 舊檔去向表 TARGET-contracts 列（main line 49／draft line 50 的「後端凍結面見本檔 §3.4」交叉引用句，不在本 carve-out 保護範圍內）；
# README 全檔於本 change 期間大量重寫，順手調整該交叉引用列用詞屬合理編輯，裸子字串會把它一併撈進比對、誤判為非空 diff 並機械導向誤動判定（false positive）。
diff \
  <(git show main:"docs/plans/docs-plans-README.md" | grep -F '4. **後端凍結面**' | sed "$SED_STRIP_CANON") \
  <(grep -F '4. **後端凍結面**' "$README_DRAFT" | sed "$SED_STRIP_CANON")

# 子檢核（僅在主檢核非空、且差異已判定為允許新增時，作為「既有受保護內容未被刪減」之佐證；三條並列覆蓋 三檔名單／埠禁令／`:8004`＋byte-identical）
grep -F '禁改 governance `app.py`、coordinator `governanceProxy.ts`、streaming `conversion_authority.py`' "$README_DRAFT"
grep -F '瀏覽器禁直連 `:49101`／`:49102`／`:8010`' "$README_DRAFT"
grep -F '前端只打 coordinator `:8004`；proxy 路徑 byte-identical' "$README_DRAFT"
```
主檢核空 diff = PASS（錨點已剝除，基準態即乾淨空 diff，不再因錨點落入「需人工判讀」的決策樹分支）。主檢核 grep 已前綴錨定至 §3 第 4 點列（`4. **後端凍結面**`），非空 diff 只可能源自該受保護行本身之變動，不會被 §4 TARGET-contracts 交叉引用列（「後端凍結面見本檔 §3.4」，與本點共用「後端凍結面」四字但不在保護範圍）等無關列汙染——故下述決策樹只需涵蓋「允許新增」與「刪除/改寫既有」兩支即完備。若主檢核**非空**，先判定差異是否**僅**為允許新增（`:49100`／spectator 例外澄清句、或新增之 `<!-- canon:* -->` 錨點註解；二者皆為新增、不刪減既有內容）：若是，改跑上列**三條** grep 確認三檔名單、既有埠禁令、`coordinator :8004`＋`byte-identical` 皆逐字完整存在 → 三條皆有輸出即 PASS。若差異涉及刪除或改寫既有三檔名單／埠清單／`:8004`／`byte-identical` 任一項（哪怕只弱化一字，例如 `byte-identical`→`largely identical`），即判誤動。

**備註**：同 item 1 pattern——item 14 的 `:49100` signaling 例外澄清、或 Task 0 於行尾內嵌之 `<!-- canon:* -->` 錨點註解若加入本點，皆屬允許新增、不算誤動（主檢核已先剝除錨點、子檢核三條 grep 佐證既有受保護子字串未被刪減）；但三禁改檔名單、既有埠禁令、或 `coordinator :8004`／`byte-identical` 凍結子句若被刪減/弱化（哪怕只弱化一項，例如把「禁改」改成「謹慎修改」、或把 `byte-identical` 改成 `largely identical`），即判誤動，需退回重做或走 R-A1 改 carve-out 本身。

---

### Carve-out 4 —「不得以文件宣稱 runtime 已完成」誠實半句

**原文位置**：`docs/plans/docs-plans-README.md` §3 效力，第 5 點（main line 40）；draft 對應 `<!-- canon:r-runtime-authority -->` 錨。

> 原文：`5. **現況行為權威＝code＋tests**；設計文件＝目標權威；兩者落差＝implementation gap，不得以文件宣稱 runtime 已完成。`

**判準**：本點整句是 item 23／task 3.2 明訂的翻轉目標（doc-first 權威語意翻轉「現況行為權威＝code＋tests；設計文件＝目標權威」兩子句）——**不**要求整句逐字不變。但「不得以文件宣稱 runtime 已完成」誠實子句（或其已於 MODIFIED spec body 定案之等價擴寫「亦不得以文件宣稱 runtime 已完成」）**MUST** 在改寫後文字中以字面或明確等價形式繼續出現，不得被刪除或稀釋（R-B2／R-B3 雙重規範，本檔僅驗證行為結果）。

**檢核指令**：
```bash
README_DRAFT="openspec/changes/doc-first-canon-v2/drafts/docs-plans-README.v2-draft.md"

# 主檢核：誠實子句字面是否仍在 point 5 錨點行（非逐字整句比對——整句預期被翻轉）。
# 錨定 <!-- canon:r-runtime-authority --> 行後再 grep 誠實子句（同 §2 item 2 鐵律 3 同行鏈式手法、item 3 列首錨定手法）——
# 防「裸字串整檔 grep」破口：若未來 wave 稀釋/刪除 point 5 誠實半句、卻在檔案他處（§4 表、其他註解）留下字串殘影，
# 裸 grep 會靜默 PASS（本 change 要根除的最關鍵失效模式）；錨定後殘影不在 point 5 錨點行 → 鏈式 grep 空輸出 → 走下方 MANUAL-CHECK 而非假 PASS。
grep -F '<!-- canon:r-runtime-authority -->' "$README_DRAFT" | grep -F '不得以文件宣稱 runtime 已完成'

# 等價改述比對基準：MODIFIED spec body 已定案的擴寫版本（供人工比對「等價改述」時的參照文字）
grep -F '不得以文件宣稱 runtime 已完成' "openspec/changes/doc-first-canon-v2/specs/documentation-source-of-truth/spec.md"
```
第一條（錨定 point 5 `<!-- canon:r-runtime-authority -->` 行後仍命中誠實子句）若有輸出 → PASS（誠實子句逐字留存於 point 5，即使整句其餘部分已改寫）。若第一條**無**輸出，**不得**逕判 fail：MUST 人工比對改寫後 point 5 文字是否為明確等價改述（例如換成第二條列出之「亦不得以文件宣稱 runtime 已完成」或語意相同之表述），確認等價則 PASS 並在 PR 說明記錄改述形式；純字面消失且找不到任何等價改述 = 誤動。**注意**：因主檢核已錨定 point 5，字串若只殘留在 point 5 以外的檔案他處（tamper／殘影情境），第一條空輸出 → 正確落入本 MANUAL-CHECK 由人工判讀，而非被殘影騙成假 PASS——此即本檢核相對裸字串整檔 grep 的補強。

**備註**：item 23 對「現況行為權威＝code＋tests」與「設計文件＝目標權威」兩子句的權威語意翻轉，**不算**本 carve-out 的誤動對象——那兩句本非本 carve-out 保護範圍，doc-first 翻轉正是本 change 的核心目的；本 carve-out 只保護誠實子句本身。此為五條中唯一「預期整句改寫、只保護子句」的特例，判準與其餘四條（逐字不變）不同，勿混用。

---

### Carve-out 5 — §07:575 A5–A10 deferral 節奏

**原文位置**：`docs/plans/AI-BIM 前後端設計文件.dc.html` §07（`id="sec7"`），`data-canon-id="c7-residual-badges"` 容器（main/draft line 574）內首個 badge span，main/draft line 575。容器內共 5 個 badge（575/576/577/578/579 行），錨為容器級、非本句專屬；tasks.md items 4/5（task 3.5/3.6）觸及同容器內第 576/578/579 行其他 badge，**不**動 575 行本句。

> 原文：`A5–A10:僅 Concept 路由 + 概念稿,不做假後端;每一模組落地前先補 governance-service 對應 API 與契約測試`

**判準**：逐字不變（未被本 change 任何 R-C2 task 列為改寫目標；同容器內鄰行改寫不影響本句)。

**檢核指令**：
```bash
diff \
  <(git show main:"docs/plans/AI-BIM 前後端設計文件.dc.html" | grep -F 'A5–A10:僅 Concept 路由 + 概念稿,不做假後端;每一模組落地前先補 governance-service 對應 API 與契約測試') \
  <(grep -F 'A5–A10:僅 Concept 路由 + 概念稿,不做假後端;每一模組落地前先補 governance-service 對應 API 與契約測試' "openspec/changes/doc-first-canon-v2/drafts/AI-BIM 前後端設計文件.v2-draft.dc.html")
```
空輸出 = PASS；任何差異（含容器內鄰行 576/578/579 的合法改寫誤傷本行）即判誤動。

**備註**：R-C1 scenario「canon v2 被採納後的偏離重分類」明定本句所護之「§07:575 A5–A10 deferral」項，在 canon v2 採納後 **MUST NOT** 被重分類為 `immediate-gap`；本檢核只驗**文字**未被誤動，「重分類保護」屬 gap ledger（task 5.3）的獨立欄位語意，非本檔檢核範圍，不重複判定。

## 3. 合併執行（便利彙整，非新增規範）

以下為 §2 五條指令的彙整版，供 tasks.md §6 收斂驗收時一次執行；純屬操作便利包裝，不引入新判準：

```bash
CANON="docs/plans/AI-BIM 前後端設計文件.dc.html"
DRAFT="openspec/changes/doc-first-canon-v2/drafts/AI-BIM 前後端設計文件.v2-draft.dc.html"
README_MAIN="docs/plans/docs-plans-README.md"
README_DRAFT="openspec/changes/doc-first-canon-v2/drafts/docs-plans-README.v2-draft.md"

echo "[1] §04 payload 委任"; diff <(git show main:"$CANON" | grep -F 'Payload 以 tests/contracts/*.json 為最高標準') <(grep -F 'Payload 以 tests/contracts/*.json 為最高標準' "$DRAFT") && echo PASS || echo "FAIL(判誤動前先讀本檔 §2 item 1 判準)"

echo "[2a] 鐵律1"; diff <(git show main:"$CANON" | grep -F '鐵律 1 — 大模型檔案(.ifc / .usdc)不出落地端') <(grep -F '鐵律 1 — 大模型檔案(.ifc / .usdc)不出落地端' "$DRAFT") && echo PASS || echo FAIL
echo "[2b] 鐵律2"; diff <(git show main:"$CANON" | grep -F '鐵律 2 — :8004 是瀏覽器唯一可達面') <(grep -F '鐵律 2 — :8004 是瀏覽器唯一可達面' "$DRAFT") && echo PASS || echo FAIL
echo "[2c] 鐵律3 must-preserve"; grep -F '鐵律 3' "$DRAFT" | grep -F '/ui/open?session=' | grep -qF '凍結' && echo PASS || echo "MANUAL-CHECK(見本檔 §2 item 2 判準)"

echo '[3] README §3.4 後端凍結面（前綴錨定全句 diff，同 §2 item 3 主檢核，非子字串抽驗；pattern 錨定列首 `4. **後端凍結面**` 以排除 §4 交叉引用列）'; diff <(git show main:"$README_MAIN" | grep -F '4. **後端凍結面**' | sed 's/[[:space:]]*<!-- canon:[^>]*>//g') <(grep -F '4. **後端凍結面**' "$README_DRAFT" | sed 's/[[:space:]]*<!-- canon:[^>]*>//g') && echo PASS || echo "MANUAL-CHECK(非空;見本檔 §2 item 3 判準:確認差異僅為 :49100/spectator 例外或新增錨點,且三檔名單/埠禁令/coordinator :8004/byte-identical 三條子 grep 皆有輸出未遭刪改)"

echo "[4] README §3.5 誠實子句（錨定 point 5 canon:r-runtime-authority 行，非裸全檔 grep——防字串殘影靜默 PASS，同 §2 item 4 主檢核）"; grep -F '<!-- canon:r-runtime-authority -->' "$README_DRAFT" | grep -qF '不得以文件宣稱 runtime 已完成' && echo PASS || echo "MANUAL-CHECK(見本檔 §2 item 4 判準,找等價改述;或誠實子句已脫離 point 5 錨點行)"

echo "[5] §07:575 A5-A10 deferral"; diff <(git show main:"$CANON" | grep -F 'A5–A10:僅 Concept 路由 + 概念稿,不做假後端;每一模組落地前先補 governance-service 對應 API 與契約測試') <(grep -F 'A5–A10:僅 Concept 路由 + 概念稿,不做假後端;每一模組落地前先補 governance-service 對應 API 與契約測試' "$DRAFT") && echo PASS || echo FAIL
```

本檔撰寫當下（Wave 1/2 尚未動筆，僅 Task 0 錨點已植入）實跑上述彙整區塊，五項全數 `PASS`（含 [3] 錨點無關全句 diff 空、[2c]/[4] 之 grep 鏈皆有輸出），記錄為基準態證據；Wave 1/2/3 各 task 提交前 SHOULD 重跑本區塊作迴歸防護，tasks.md §6 收斂驗收時 MUST 重跑一次作為最終 gate 證據。

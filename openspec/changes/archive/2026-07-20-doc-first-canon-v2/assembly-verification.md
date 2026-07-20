# assembly-verification.md — merge-assembly 驗證報告

> 本檔為 `tasks.md` §5 彙整類 task 的執行證據載體。Task 0（§03）率先寫入；Task 1（§08）等後續 task 以獨立章節 append，不覆蓋既有內容。

---

## §03 merge-assembly 驗證（tasks.md 5.1）

### 0. 範圍與方法

**Diff 指令（實跑）**：

```
git diff --no-index "docs/plans/AI-BIM 前後端設計文件.dc.html" "openspec/changes/doc-first-canon-v2/drafts/AI-BIM 前後端設計文件.v2-draft.dc.html"
```

**§03 邊界界定**（以兩檔 `id="secN"` 章級穩定錨定界，見 prep-evidence.md §0.1）：

| 檔案 | `id="sec3"` 行 | `id="sec4"` 行 | §03 內容範圍 |
|---|---|---|---|
| 原檔（`docs/plans/...dc.html`，= main） | 147 | 220 | old line 147–219（73 行） |
| 草稿（`.../drafts/...v2-draft.dc.html`） | 147 | 224 | new line 147–223（77 行） |

净增 4 行。

**Hunk 擷取**：對全檔跑 `git diff --no-index -U0`（零上下文，逐行精確定界）取得全部 hunk header，篩選 old-range 或 new-range 落於上表區間者。全檔共 69 個 hunk，其中 **8 個** 落於 §03 範圍（old line 154–215）；old line 220 之後（`@@ -225,0 +230 @@` 起）屬 §04，不收錄——此即 item 13 被 tasks.md 5.1 原文註記「(§04 不同章)」排除的機器證據。

**完整性自證**：8 個 hunk 的行數增量總和 = 2+0+0+1+0+0+0+1 = **+4**，與上表淨增 4 行**精確相符** → 證明 8 個 hunk 已窮盡 §03 全部差異，無遺漏、無重複計算。

### 1. Hunk 對號表（零未解釋 hunk）

| # | old→new range | 內容摘要 | 對映 item（task） | 落實 commit | 判定 |
|---|---|---|---|---|---|
| 1 | `-154,18` → `+154,20` | Route Map 表（2欄→3欄「Route/目標/現況」）＋ 舊路由收斂(CH-G)表（2欄→3欄）＋ 新增 CH-G 整體狀態 badge；植錨 `data-canon-id="c3-route-map"`／`"c3-legacy-route-convergence"` | **item 1**（task 4.1，§03 Route Map/CH-G） | `8d39349`（主體改寫）＋ `9b115e6`（`#intake` 現況欄偽斷言 gap-fix）＋ `3ed51f5`（錨） | 對號 |
| 2 | `-175` → `+177` | 純植錨：`<div>`（元件樹容器）加 `data-canon-id="c3-component-tree"`；內文（AppShell/WorkspacePage/DockPanel 等）逐字未動 | **植錨**（tasks.md 0.1 bootstrap，非任一 item 內容變更） | `3ed51f5` | 對號（植錨） |
| 3 | `-188` → `+190` | 純植錨：`<div>`（共用 hooks 容器）加 `data-canon-id="c3-shared-hooks"`；內文（useViewerInteraction 等 7 個 hook）逐字未動 | **植錨**（tasks.md 0.1 bootstrap） | `3ed51f5` | 對號（植錨） |
| 4a | old line 200 → new line 202（同屬 `-200,3`/`+202,4`） | badge「Console 不長 WebRTC — 3D 一律 HandoffButton → /ui/open?session=…」→「【目標】Workspace 內嵌 viewport(EmbeddedViewer 跨-origin iframe…)。【現況】unified Workspace 為靜態示意,內嵌=CH-I」；植錨 `c3-badge-workspace-handoff` | **item 18**（task 4.14，§07 CH-H/CH-I 主任務之 §03 side-effect） | `0cb7989` | 對號（見 §2 說明） |
| 4b | old line 201 → new line 203 | badge「spectator 一律 readonly:resolveGovPanelState 統一 gate 所有 Dock 的寫入行為」→「【目標】…【現況】gate 僅接線 legacy viewer overlay 路徑…unified docks 現為 fixture 殼…follow-up unified-docks-real-api」；植錨 `c3-badge-spectator-gate` | **item 3**（task 4.3，§03:201 gate 失真） | `519ff0c`（＋`3ed51f5` 錨） | 對號 |
| 4c | old line 202 → new line 204 | badge「i18n:zh-Hant 預設 · en 切換;字典置 console/i18n.ts」→「…runtime(t/getLang/setLang/useLang)在 console/i18n.ts,中央字典現置 console/unified/fixtures.ts(getL/Dict);搬遷至獨立字典檔屬 backlog」；植錨 `c3-badge-i18n` | **item 17**（task 4.13，§03 i18n） | `fc34ac4`（＋`3ed51f5` 錨） | 對號 |
| 4d | （新增）→ new line 205 | 全新 badge「雙軌現況(2026-07-18):unified 殼(…)=Hi-Fi 像素級移植 fixture(data-prov=fixture,不打 /api);真實整合頁活在 legacy 深連結 #a1-workbench/#semantic-search…issues 權威入口【目標】=unified #a1?dock=issues」；新增植錨 `c3-badge-dual-track` | **item 19**（task 4.15，§03 雙軌現況） | `6729fea` | 對號 |
| 5 | `-205,2` → `+208,2` | 容器 `<div>` 標頭改寫「命名核對(code-truth,對照 console/unified/*)」→「現況對照(doc-first,對照 console/unified/*)」；植錨 `c3-naming-check` | **item 24**（task 3.3，§03 命名核對 carve-out 刪） | `f079ef0`（＋`3ed51f5` 錨） | 對號 |
| 6 | `-208` → `+211` | 引言句刪除權威語句「以下以程式碼為準,不回頭改程式碼命名以遷就舊文件」→ 中性引導「以下逐條列現況對照」 | **item 24**（task 3.3） | `f079ef0` | 對號 |
| 7 | `-214` → `+217` | 刪除 stale 自糾句（「§04 DataChannel 表把 selectPrimsRequest/composeStageRequest 標「待補」與現況不符…」），併入「DataChannel 唯一待補=commandRejected(見 §04)」 | **item 8**（task 3.7，§03:214 stale 自糾） | `abd9000` | 對號 |
| 8 | `-215,0` → `+219`（純插入） | 新增收斂 badge「上列為 2026-07-18 現況;理想 IA(含元件/hook 命名)為應建目標,收斂路徑見 §07 分期與 follow-up changes;命名遷移屬實作 PR 範疇」 | **item 24**（task 3.3） | `f079ef0` | 對號 |

**排除項（非疏漏，機器可驗）**：item 13（§04 tests/contracts 誠實化，task 4.9，commit `7b651d8`）之 hunk 落於 old line 225（`@@ -225,0 +230 @@`），屬 §04（old line 220 起），不屬 §03；與 tasks.md 5.1 原文自身註記「13(§04 不同章)」一致，故不列入本表、亦不計入下方「零未解釋」統計。

### 2. item 18 觸及 §03 之正當性說明（非 tasks.md 5.1 原列六項之一，但可完全對號）

Task 0 原始指示鎖定的比對清單為「items 1/3/8/17/19/24＋植錨」，item 18（§07 CH-H/CH-I 家族）不在其中。Hunk 4a（`c3-badge-workspace-handoff`）實際由 item 18 的任務（task 4.14）觸及。判定為**可對號、不予回改**，理由：

1. **獨立佐證鏈（三處、均在本次編輯之前已存在）**：
   - `design.md:44`（§2 裁決索引表，裁決 3）：「Workspace 3D 內嵌 viewport 升格；/ui/open 凍結併存；lease/spectator follow-up ｜ R-B6 ＋ **item 18**；follow-up embedded-viewport」——裁決 3 的主題本來就是「Workspace」3D 內嵌，而 Workspace 正是 §03 描述的對象。
   - `design.md:75`（§3 24×11 矩陣）：「18 §07 CH-H/內嵌期」列掛裁 1、裁 3——裁 3 即上一點的 Workspace 內嵌裁決。
   - `design.md:111`（§6a follow-up 表）：「embedded-viewport（新 CH 期）｜viewer-embed-a1-highlight｜R-B6 內嵌 viewport；**§03 註記**；item 18」——明文記載 item 18 帶有「§03 註記」，非本次驗證新發現。
2. **task 4.14（tasks.md line 52）自身 PASS 記錄**已完整記載此次 §03 改寫的理由：spec delta `R-B6`（`documentation-source-of-truth/spec.md:116`）要求「Workspace 3D 內嵌…SHALL 升格為應建目標；§03『Console 不長 WebRTC—3D 一律 HandoffButton』註記 SHALL 判為遺跡改寫；`/ui/open` 凍結面 SHALL 照舊併存」，三要素逐一落地於新 badge。
3. **反向驗證（若回改會怎樣）**：若將此 hunk 回改為原文「Console 不長 WebRTC — 3D 一律 HandoffButton → /ui/open?session=;Workspace 是 viewer 殼的宿主」，則 §03 將明文宣稱「Workspace 永不內嵌 WebRTC」，與 §07（item 18 新增的 CH-I「Workspace 內嵌 viewport」planned 期）**直接矛盾**——回改本身會製造 Task 0 職責範圍內要抓的那種「改寫塊之間互相矛盾」，而非消除它。
4. `git diff --cached --check`／單一 span 純文字替換（未增減任一 div/span 標籤，見 task 4.14 PASS 記錄之標籤配對核驗），非結構性改動，風險面已在原任務內核實。

結論：**不回改**；hunk 4a 判定為「對號於 item 18（§07 主任務的 §03 side-effect），有三處獨立既存文件佐證＋任務自身完整記錄，回改反而製造矛盾」。此為本報告發現的唯一一處「原六項清單外」的 hunk，其餘 7 個 hunk 全數對號於 tasks.md 5.1 原列六項（1/3/8/17/19/24）或植錨（tasks.md 0.1）。

**零未解釋 hunk**：8 個 hunk 全數對號完畢（6 項落於原清單、1 項植錨、1 項為 item 18 side-effect 並附三處獨立佐證＋反向矛盾驗證）。

---

### 3. §03 全文連貫性檢查（改寫塊之間有無互相矛盾）

通讀草稿 §03 全文（`drafts/AI-BIM 前後端設計文件.v2-draft.dc.html:147-220`），逐一核對各改寫塊之間的語意介面：

#### 3.1 指定檢查項：Task 9（item 24 現況對照塊）vs Task 14（item 19 雙軌 badge）

Plan C Task 0 原文明點此對——「Task 9 的現況對照」＝`c3-naming-check`（task#9 commit `f079ef0`，item 24）；「Task 14 的雙軌段」＝`c3-badge-dual-track`（task#14 commit `6729fea`，item 19）。逐句核對：

- **`c3-naming-check`（現況對照塊）範疇**：糾正左欄「元件樹(UnifiedConsole)」/「共用 hooks」示意圖裡的**符號命名**（`AppShell`/`DockPanel`/`useViewerInteraction` 等）與現行 `console/unified/*` 實碼**命名**不符，逐條列出「舊名 → 實名」（如 `AppShell` 不存在 → `EdgeConsole.tsx` + `UnifiedShell.tsx`）。**主題＝命名精確性**。
- **`c3-badge-dual-track`（雙軌段）範疇**：陳述 unified 殼（`#home`/`#a1..#a10`/`#pipeline`/`#runtime`）現況為「Hi-Fi 像素級移植 fixture」（`data-prov=fixture`、不打 `/api`），真正接通 API 的整合頁活在 **legacy 深連結**（`#a1-workbench`/`#semantic-search`）、無 nav 入口。**主題＝功能完整度的雙軌並存事實**，與命名無關。
- **交集點但非重複**：`c3-naming-check` 第一條提到「現況是 `EdgeConsole.tsx`(hash router + **雙殼分流**)」——此處「雙殼分流」四字是對 `EdgeConsole.tsx` 職責的精簡陳述（它在 unified 殼與 legacy 殼之間路由），**未展開**細節；`c3-badge-dual-track` 才是這件事的完整闡述（誰是 fixture、誰有真整合、collections 缺 nav 入口、issues 權威裁決）。二者是「一句帶過的伏筆」與「完整說明」的關係，非同一資訊的重複表述，故**不合併**。
- **交叉引用一致性**：`c3-badge-dual-track` 內「issues 權威入口【目標】=unified `#a1?dock=issues`」的語法，逐字沿用 item 1（`c3-route-map`，hunk 1）表格既有例句「`#a1?dock=issues`」（見對號表 hunk 1，old line 158 對應行），非另造新語法——與 Route Map 表**互相印證、無矛盾**。
- item 19 任務本身（task 4.15 PASS 記錄）已載明「依 R-C2 Scenario『任一正本段落的唯一 ownership』(spec.md:147-150) 本 task 另立新徽章、不觸碰既有三徽章任一字」——即原任務執行時已主動避免與既有 badge（含間接關聯的 naming-check 塊）重疊，本次複核確認該判斷成立。

**結論：不重複、不衝突，維持現狀，不合併。**

#### 3.2 其餘改寫塊間交叉檢查

- **三塊「unified=fixture／legacy=真整合」敘事一致性**：`c3-badge-workspace-handoff`（【現況】unified Workspace 為靜態示意）、`c3-badge-spectator-gate`（【現況】unified docks 現為 fixture 殼、無真實寫入亦無 gate 接線）、`c3-badge-dual-track`（unified 殼=fixture,不打 /api；真整合在 legacy）——三者從三個不同切面（viewport 內嵌／dock 寫入 gate／整體路由雙軌）共同支撐同一底層事實，敘事方向一致、無互斥描述；各自主題不同（分屬 item 18/3/19 三個獨立 task 的權責範圍），非同一資訊重複刊登，不需合併。
- **Route Map 表（item 1）與雙軌 badge（item 19）**：Route Map 表對 `#/workspace?dock=a1..a4|issues` 列標「未做…?dock= 為疊加覆寫查詢(如 `#a1?dock=issues`)」；雙軌 badge 引用同一語法標「issues 權威入口目標」——語法逐字一致（見 3.1 交叉引用一致性），無矛盾。
- **CH-G 收斂表（item 1）與命名對照塊（item 24）**：CH-G 表描述「路由層級」的目標/現況差距；命名對照塊描述「元件/hook 符號」的命名差距——兩者維度正交（路由 vs 元件命名），無交集、無矛盾。
- **DataChannel 待補句（item 8）與 §04 交叉引用**：item 8 改寫後句「DataChannel 唯一待補=`commandRejected`(見 §04)」——`commandRejected` 一詞的§04 現況描述由 item 8 自身任務（task 3.7 PASS 記錄）已核對「於 §04:283、§07:569/578 三處既有描述皆語意一致、逐字未動」，本次複核未見新增矛盾（§04 本身之逐句核對屬 tasks.md 5.2 §08 merge-assembly／後續 task 範疇，非本 task 5.1 §03 範圍，故不在此展開重驗）。
- **收斂 badge（item 24，hunk 8）與 naming-check 塊本體**：收斂 badge「上列為 2026-07-18 現況;理想 IA…為應建目標,收斂路徑見 §07 分期與 follow-up changes;命名遷移屬實作 PR 範疇」——與其正上方的逐條命名對照（元件樹/hooks 仍保留「理想 IA」示意圖原樣、下方逐條列出實碼命名）形成「示意圖＝目標／逐條列表＝現況／收斂 badge＝路徑聲明」三層結構，彼此呼應而非矛盾。此結構為 item 8（task 3.7）與 item 24（task 3.3）兩個任務共同作用於同一容器（`c3-naming-check`）的疊加結果——task 3.7 刪 stale 自糾句（hunk 7）、task 3.3 改標頭/引言/新增收斂句（hunk 5/6/8）——彼此改動的行不重疊（見對號表），無編輯衝突。

**§03 全文連貫性檢查結論：未發現改寫塊之間的矛盾；`c3-naming-check` 與 `c3-badge-dual-track` 主題正交、互為伏筆與展開關係，維持分立、不合併。草稿未因本次檢查而修改。**

---

### 4. 結論（tasks.md 5.1 DoD 對照）

| DoD 項目 | 狀態 |
|---|---|
| 報告列出 §03 全部 hunks 的對號表、零未解釋 hunk | ✅ 8/8 hunk 全數對號（§1 表），含 1 項計畫外但有三重獨立佐證＋反向矛盾驗證的 item 18 side-effect（§2） |
| §03 全文連貫性檢查（改寫塊之間無互相矛盾） | ✅ 通讀＋逐塊交叉核對，含 Plan 指定的 Task 9/Task 14 比對（§3.1），未發現矛盾、無需合併 |
| 發現矛盾已修並 commit | 不適用——**未發現矛盾**，草稿本檔（`drafts/AI-BIM 前後端設計文件.v2-draft.dc.html`）於本 task 內**零修改** |
| tasks.md 5.1 打勾 | 本檔提交後於同一 commit 內打勾 |

本 task 為**純驗證性質**：未修改 `drafts/AI-BIM 前後端設計文件.v2-draft.dc.html`，僅新增本報告檔＋勾選 `tasks.md` 5.1。

---

## §08 merge-assembly 驗證（tasks.md 5.2）

### 0. 範圍與方法

**Diff 指令（實跑）**：

```
git diff --no-index "docs/plans/AI-BIM 前後端設計文件.dc.html" "openspec/changes/doc-first-canon-v2/drafts/AI-BIM 前後端設計文件.v2-draft.dc.html"
```

**§08 邊界界定**（以兩檔 `id="sec8"` 開始行 ＋ 其配對的 closing `</div>` 定界——非僅到檔尾；`</div>` 之後兩檔皆另有一段跨章共用的頁尾 footer，逐字相同，不屬 §08）：

| 檔案 | `id="sec8"` 行 | §08 closing `</div>` 行 | §08 內容範圍 |
|---|---|---|---|
| 原檔（`docs/plans/...dc.html`，= main） | 584 | 731 | old line 584–731（148 行） |
| 草稿（`.../drafts/...v2-draft.dc.html`） | 592 | 755 | new line 592–755（164 行） |

淨增 16 行。

**Hunk 擷取**：對全檔跑 `git diff --no-index -U0`（零上下文）取得全部 hunk header，篩選 old-range 或 new-range 落於上表區間者。全檔共 69 個 hunk，其中 **23 個** 落於 §08 範圍（old line 595–729）；old line 578 以前（`@@ -578,2 +587 @@` 及更早）屬 §07，不收錄。

**完整性自證**：23 個 hunk 的行數增量（new 行數－old 行數）逐一為：0,0,0,0,0,0,0,**+1**,0,0,**+4**,0,0,0,0,0,**+10**,**+1**,0,0,0,0,0——總和 = 1+4+10+1 = **+16**，與上表淨增 16 行**精確相符** → 證明 23 個 hunk 已窮盡 §08 全部差異，無遺漏、無重複計算。

### 1. Hunk 對號表（零未解釋 hunk）

| # | old→new range | 內容摘要 | 對映 item（task） | 判定 |
|---|---|---|---|---|
| 1 | `-595` → `+603` | 純植錨：三層輸入卡「10 張應用場景圖」容器加 `data-canon-id="c8-input-scenario-images"`；內文未動 | **植錨**（tasks.md 0.1 bootstrap） | 對號（植錨） |
| 2 | `-599` → `+607` | 純植錨：三層輸入卡「10 張 Prompt Board」容器加 `data-canon-id="c8-input-prompt-board"`；內文未動 | **植錨**（tasks.md 0.1 bootstrap） | 對號（植錨） |
| 3 | `-603` → `+611` | 純植錨：三層輸入卡「現有 Repo」容器加 `data-canon-id="c8-input-repo-authority"`；內文未動 | **植錨**（tasks.md 0.1 bootstrap） | 對號（植錨） |
| 4 | `-609,10` → `+617,10` | 權威優先順序表核心翻轉：7 列 code-first 序（既有 repo→AGENTS.md→API client→書面需求→Prompt Board→場景圖→示例數字）→ 6 列 doc-first 序（docs/plans 需求正本→tests/contracts→AGENTS.md/OpenSpec→Prompt Board→場景圖→示例數字）；表頭語意改「AGENTS.md 參照本節」；新增誠實半句「code+tests=runtime 現況查證面…」；植錨 `c8-authority-table` | **item 22**（task 3.1，§08 權威表核心翻轉） | 對號 |
| 5 | `-627` → `+635` | 純植錨：R1 卡容器加 `data-canon-id="c8-r1-stack-authority"`；內文（技術棧、ai-bim-governance.css 引用）逐字未動 | **植錨**（tasks.md 0.1 bootstrap；R1＝carve-out，非本 change 24 項失真項之一） | 對號（植錨） |
| 6 | `-636` → `+644` | 純植錨：R1a 卡容器加 `data-canon-id="c8-r1a-brand-theme"`；內文（品牌決策、migrate-console-to-hifi-design 引用）逐字未動 | **植錨**（tasks.md 0.1 bootstrap；R1a＝carve-out） | 對號（植錨） |
| 7 | `-643` → `+651` | 純植錨：R2 卡容器加 `data-canon-id="c8-r2-api-tristate"`；容器標籤本身無其他文字變動 | **植錨**（tasks.md 0.1 bootstrap） | 對號（植錨） |
| 8 | `-645,3` → `+653,4` | R2 三態核心重寫：`Existing/Planned/Missing endpoint`（3 行舊三態）→ `Existing / In-canon+repo內可建 / In-canon+依賴外接引擎 / Missing(正本沒列)`（4 行新四態，含 `design-canon-change-control R-A1` 提案路徑） | **item 12**（task 4.8，處1(a) R2 pre 區塊重寫） | 對號 |
| 9 | `-649` → `+658` | R2 卡說明句**單行雙改**：中段插入「,依上方 R2 三態分類、非現有契約」；尾端追加新句「例外::49100(WebRTC signaling)與 spectator 埠段、:47998(media)為合法瀏覽器直連面(串流本體)。」；原句「瀏覽器仍只連 :8004,禁直連 :49101/:49102/:8010。」逐字未動 | **item 12**（task 4.8，處1(b) 中段插入）＋**item 14**（task 4.10，§08 R2 例外句尾端追加） | 對號（見 §2.1 拆解說明） |
| 10 | `-651` → `+660` | 純植錨：R3 卡容器加 `data-canon-id="c8-r3-provenance"`；容器標籤本身無其他文字變動 | **植錨**（tasks.md 0.1 bootstrap） | 對號（植錨） |
| 11 | `-653` → `+662,5` | R3 詞彙核心收斂：`ProvenanceTag(mock \| live)` → 實碼元件 `ProvTag`＋7 值 `Prov`（asbuilt/artifact/demo/p1/p15/p3/p4，cross-ref `data.ts:6`）＋unified 層 `data-prov="fixture\|live"`；新增巢狀 `c8-r3-oq1-open-decision` non-normative 註記塊（`asbuilt-partial` 待決值，預設不採用） | **item 9**（task 3.4，§08 R3 詞彙收斂＋OQ-1 開放議題塊） | 對號 |
| 12 | `-655` → `+668` | 純植錨：R4 卡容器加 `data-canon-id="c8-r4-one-outcome-one-task"`；內文逐字未動 | **植錨**（tasks.md 0.1 bootstrap；R4＝carve-out） | 對號（植錨） |
| 13 | `-663` → `+676` | 純植錨：Hi-Fi 驗證鏈容器加 `data-canon-id="c8-hifi-verification-chain"`；容器標籤本身無其他文字變動 | **植錨**（tasks.md 0.1 bootstrap） | 對號（植錨） |
| 14 | `-673` → `+686` | Hi-Fi 驗證鏈殘留 badge stale 編號修正：「tasks.md 的 2.4–2.8(…)仍未全部打勾,3.4 明確以此為 archive 前提」→ 不硬編任務編號，改「剩餘工作與 archive 前提以其 tasks.md **現行版本**為準(歷史版本曾用不同任務編號,已重構)」 | **item 5**（task 3.6，§08 stale 編號，同任務同步改寫 §07 對應句） | 對號（見 §2.2 說明） |
| 15 | `-680` → `+693` | 純植錨：Task 順序表容器加 `data-canon-id="c8-task-sequence-table"`；容器標籤本身無其他文字變動 | **植錨**（tasks.md 0.1 bootstrap） | 對號（植錨） |
| 16 | `-684` → `+697` | Task 5–10 列內容重寫：「A4–A9 contract-first prototype(typed adapter + fixture)」→「A5–A9:repo 內可建面全棧一次到位(預設,不做 mock 過渡);僅外接引擎面可 mock(掛 ProvTag);A4 已超前完成 deterministic 全棧」 | **item 12**（task 4.8，處3 Task 表「5–10」列） | 對號 |
| 17 | `-687,0` → `+701,10`（純插入） | 新增區塊：「Task↔CH Crosswalk」標頭 ＋ 新表 `c8-task-ch-crosswalk`（5 列：Task 0/1–3/4/5–10/11–12 對映 CH）＋ 收斂 note badge | **item 11**（task 4.7，§08:679 crosswalk 缺失補表） | 對號 |
| 18 | `-688,0` → `+712`（純插入） | 新增 badge span：「待抽取目標;現況 1/14 以此命名存在(僅 ProvTag,見 components.tsx),其餘 13 項功能近義物異名散落(Metric/FlowBar 等)——命名收斂於抽取時裁決」（置於「共用元件優先抽取」標題後） | **item 10**（task 4.6，gap-fix：0/14 失真更正為 1/14） | 對號 |
| 19 | `-692` → `+716` | 共用元件清單 badge：`ProvenanceTag` → `ProvTag(既有)` | **item 9**（task 3.4，處(c) §08 共用元件清單 badge 詞彙同步） | 對號 |
| 20 | `-707,9` → `+731,9` | 真實程度表核心重寫：表頭「A4–A10 初期真實程度(前端完整;domain engine 需另接)」→「A4–A10 真實程度(A4=hybrid 已部分落地;A5–A10=Concept 稿,前端完整為目標)」；A4 列拆「deterministic 已全棧落地」＋「semantic=外接 LLM(a4-semantic-search-model-qa)」；A5/A6/A10 列補 `planned(class: in-repo-fullstack-pending)` 雙標記；A7/A8/A9 列具名廠商依賴（Isaac/Replicator/P6）移除、改 genericize `external(mock 合法,掛 ProvTag)` | **item 12**（task 4.8，處2 真實程度表＋gap-fix 封閉 class token） | 對號 |
| 21 | `-720` → `+744` | 「餵法 → 成果對照」表第 2 列成果欄：「統一 shell;A1–A3 真整合;A4–A10 contract-first」→「統一 shell;A1–A3 真整合;A4 deterministic 已全棧;A5–A10 仍為概念稿(缺逐模組 task/E2E)」 | **item 12**（經 `git log -L` 溯源為獨立 review-fix commit `68e1507`，見 §2.3） | 對號（見 §2.3 說明，非 tasks.md item 12 checkbox 文字自述範圍） |
| 22 | `-726,2` → `+750,2` | 收尾 badge 容器加 `data-canon-id="c8-closing-badges"`；結構 badge 拆分：「結構 = modular monolith frontend(單一 SPA + features/a1..a10)— 不是 microfrontend,不是十套專案」→「結構=modular monolith(單一 SPA)✔;features/a1..a10 為目標佈局(現況=src/console/ 以扁平檔為主,另有 coordinator/unified/governance/modelData/viewer 五個既有功能子夾…)— 不是 microfrontend,不是十套專案」 | **item 10**（task 4.6，結構 badge gap-fix） | 對號 |
| 23 | `-729` → `+753` | 收尾 badge：「把本節鐵律與權威順序寫進 AGENTS.md / OpenSpec,任務包只引用、不重抄」→「本節鐵律與權威順序由 AGENTS.md / OpenSpec 參照(見 doc-first-canon-v2 提案),任務包只引用、不重抄」 | **item 22**（task 3.1，§08 尾 badge 參照語意同步） | 對號 |

**零未解釋 hunk**：23 個 hunk 全數對號完畢（10 項純植錨屬 tasks.md 0.1 bootstrap；11 項對映 items 9/10/11/12/14/22 中的一項；1 項對映 item 5，非本 task 原列六項之一但有完整既存證據，見 §2.2；1 項（hunk 21）需額外溯源，見 §2.3；hunk 9 為單一 hunk 承載 item 12＋item 14 兩項各自獨立編輯，見 §2.1）。

### 2. 需要額外說明的 hunk

#### 2.1 hunk 9 — 單一 hunk 承載 item 12＋item 14 兩項獨立編輯

R2 卡說明句原文（old line 649）：

> 圖中 /api/a4/semantic/query、/api/a6/kpi、/api/a8/jobs 等皆屬「建議」;正式契約以 §04 + tests/contracts 為準。瀏覽器仍只連 :8004,禁直連 :49101/:49102/:8010。

草稿現文（new line 658）：

> 圖中 /api/a4/semantic/query、/api/a6/kpi、/api/a8/jobs 等皆屬「建議」**,依上方 R2 三態分類、非現有契約**;正式契約以 §04 + tests/contracts 為準。瀏覽器仍只連 :8004,禁直連 :49101/:49102/:8010。**例外::49100(WebRTC signaling)與 spectator 埠段、:47998(media)為合法瀏覽器直連面(串流本體)。**

因兩處編輯（粗體）落在同一行、git diff 以整行為最小單位，呈現為單一 hunk，但兩處字元範圍不重疊、來源任務不同：

- 中段插入「,依上方 R2 三態分類、非現有契約」＝ item 12（task 4.8 PASS 記錄「處1(b) 卡下說明文字…同步插入」，逐字相符）。
- 尾端新句「例外::49100…」＝ item 14（task 4.10 PASS 記錄「[3] §08 `c8-r2-api-tristate` 卡說明句…原句尾追加…」，逐字相符；實碼佐證 `bim-streaming-server/SYSTEM_DESIGN.md:319-321/482-486`）。
- 原句「正式契約以 §04 + tests/contracts 為準。瀏覽器仍只連 :8004,禁直連 :49101/:49102/:8010。」逐字未動——task 4.8 自身已明文記錄「該句屬 Task 9/item 14 範疇,未搶做、未重複改」，task 4.10 亦未改動此句，兩任務對同一行的編輯互不侵犯、無需回改。

#### 2.2 hunk 14 — 對號於 item 5（非本 task 原列六項之一，但有完整既存證據）

本 task 指示鎖定的比對清單為「items 9/10/11/12/14 的 R2 例外句/22」，item 5（§07/§08 stale 編號）不在其中。Hunk 14（Hi-Fi 驗證鏈殘留 badge）實際由 item 5 的任務（task 3.6）觸及。判定為**可對號、不予回改**，理由：

1. task 3.6（tasks.md line 34，item 5）自身 PASS 記錄逐字記載：「(b) §08 `c8-hifi-verification-chain` 驗證鏈段落…「tasks.md 的 2.4–2.8(…)仍未全部打勾,3.4 明確以此為 archive 前提」同步改寫為相同不硬編編號句式」——與本 hunk 內容逐字相符，非本次驗證新發現。
2. item 5 的 DoD 原文本身即橫跨兩章：「§07:578/§08:673 stale 編號…改寫；§07:579 stale「已知不一致」註記刪除」——§08 一併觸及屬任務原始範圍，非越界。
3. 反向驗證（若回改會怎樣）：若將本 hunk 回改為原文，會重新在 §08 寫回已證實 stale 的具體任務編號（「tasks.md 的 2.4–2.8…3.4」），而上游 `align-frontend-design-system-reference/tasks.md` 現行結構已證實為 §1–§5、archive gate 為 5.3——回改本身會重新製造 item 5 已修復的失真，而非消除它。

結論：**不回改**；hunk 14 判定為「對號於 item 5（§07/§08 跨章 stale 編號任務的 §08 半邊），有任務自身完整記錄＋反向矛盾驗證」。

#### 2.3 hunk 21 — 對號於 item 12（經 `git log -L` 溯源，非 tasks.md item 12 checkbox 文字自述範圍）

「餵法 → 成果對照」表第 2 列成果欄文字（draft:744）在 tasks.md 中**未**被任何 task 的 PASS 記錄逐字提及（對「統一 shell」「A4 deterministic 已全棧」「A4–A10 contract-first」三詞全文 grep tasks.md 僅命中 item 12/task 4.8 段落中對「A4–A9 contract-first **prototype**」——即 Task 表 5–10 列被移除舊字串的歷史記錄，非本列的變更記錄）。

實跑 `git log -p -L744,744:"openspec/changes/doc-first-canon-v2/drafts/AI-BIM 前後端設計文件.v2-draft.dc.html"` 溯源，找到獨立 commit `68e1507`（提交訊息：「task#7: fix §08 餵法表殘留「A4–A10 contract-first」對齊 A4 全棧/A5–A10 概念稿 canon」）。該 commit 訊息完整說明：

> 修 final-review IMPORTANT-1:§08「餵法 → 成果對照」表中列（圖 + repo + 文字契約）成果欄殘留舊框架「A4–A10 contract-first」，與本 change 於同 §08 新寫入的 canon 直接矛盾——Task 表（c8-task-sequence-table）已改「A5–A9 repo 內可建面全棧一次到位;A4 已超前完成 deterministic 全棧」、真實程度表（c8-domain-reality-table）已標「A4=hybrid 已部分落地、deterministic 檢索已全棧落地」。

即：本列文字是 item 12（task 4.8）Task 表／真實程度表兩處改寫後、為消除同章內部矛盾而做的**同一語意範圍**延伸修正，只是落地方式是獨立 review-fix commit 而非 task 4.8 checkbox 文字內自述的「處1/處2/處3」之一。判定依據：

1. **內容一致性**：新文字「A4 deterministic 已全棧」與 Task 表 5–10 列「A4 已超前完成 deterministic 全棧」（hunk 16）、真實程度表 A4 列「deterministic 檢索已全棧落地」（hunk 20）三處用語完全一致；「A5–A10 仍為概念稿」與真實程度表 A5–A10 各列「planned/external」定性同向（尚未落地＝仍為概念稿）。
2. **commit 訊息自陳因果**：明確指出殘留字串「與本 change 於同 §08 新寫入的 canon 直接矛盾」，即修正動機正是本 task 5.2 要檢查的「§08 內部連貫」範疇本身，此 commit 已先一步做掉這項連貫性修正。
3. **無其他候選任務**：全文 grep 排除任何其他 task 對此列有編輯記錄；`git log -L` 為該行變更歷史的權威且唯一來源。

結論：**對號、不回改**；hunk 21 判定為「item 12 範疇內的既有 review-fix，內容與 item 12 其餘兩處改寫同源一致，僅未收錄進 tasks.md item 12 checkbox 的自述文字，屬文件記錄缺口而非內容缺陷——已於本報告補記，不另建新 gap-fix」。

### 3. Task 11–12 crosswalk 列 stale forward-ref 修正（Plan B final-review f1，本 task 必修項）

`c8-task-ch-crosswalk` 表（item 11／task 4.7 落地）Task 11–12 列原文（改寫前，draft:708）：

> Task 12 跨頁/E2E 貼近 CH-G(URL 收斂,現況未做);Task 11 A10 整合儀表板未有對應 CH,擬由未來新期承接(§07 CH-H 家族/內嵌 viewport 期,對應 item 18,**現況本文件尚未列**)

task 4.14（item 18，§07 CH-H/CH-I 家族）PASS 記錄明文預告此殘留：「本 task 完成後 CH-H/CH-I 已實際列入 §07,該括號句「現況本文件尚未列」轉為 stale。依 R-C2 Scenario「任一正本段落的唯一 ownership」…本 task 不就地代改該表,留待 task 5.2 §08 merge-assembly…收斂消解此 stale 括號句。」

**驗證 stale 屬實**：

- 主檔 main（`docs/plans/AI-BIM 前後端設計文件.dc.html` §07，line 557–580）之 CH 分期表**只到 CH-G**，無 CH-H、無 CH-I——證實 CH-H/CH-I 為 doc-first-canon-v2 本身新增（非本 change 之前既有）。
- 草稿 `c7-ch-schedule-table`（draft:570–581）CH-G 列後已新增 CH-H（「semantic viewer 家族(H1/H2/H3)」，「code 已出貨」）與 CH-I（「Workspace 內嵌 viewport」，`follow-up embedded-viewport`）兩列——與 task 4.14 PASS 記錄逐字相符。
- 故原句「現況本文件尚未列」與草稿現況矛盾：CH-H/CH-I **已經列入**本文件（§07），此句為 stale forward-reference（撰寫 task 4.7 當下，item 18/task 4.14 尚未執行）。

**已執行修正**（`drafts/AI-BIM 前後端設計文件.v2-draft.dc.html` 單行文字替換,`git diff --stat` 確認 1 insertion/1 deletion、無其他行受影響）：

> Task 12 跨頁/E2E 貼近 CH-G(URL 收斂,現況未做);Task 11 A10 整合儀表板未有對應 CH,擬由未來新期承接(**§07 CH-H/CH-I,對應 item 18,已列入本文件**)

改寫原則：只修正「現況本文件尚未列」→「已列入本文件」此一失真斷言本身；保留原句結構與「對應 item 18」交叉引用（利於後續讀者追溯），語意不變（本列仍是「Task 11 無對應 CH、擬由未來新期承接」的陳述，括號僅為佐證性交叉引用，非宣稱 Task 11＝CH-H/CH-I），不構成 merge-assembly「零新增語意」原則下的新增語意（本次修正屬本 task 指示明文授權之必修 stale 訂正，非 items 9/10/11/12/14/22 聯集範圍內的內容變更）。

**修正後驗證**：

- `git diff --stat`：1 file changed, 1 insertion(+), 1 deletion(-)（純文字置換，無結構變動）。
- div/span 標籤配對：`291/291`、`591/591`，改動前後不變（純既有 `<span>` 內文字置換，未增減任一標籤）。
- CRLF 行結尾：766 行、0 條 bare LF（python byte-level 核驗，全檔保留）。
- `npx openspec validate doc-first-canon-v2 --strict`：`Change 'doc-first-canon-v2' is valid`。
- carve-out-assertions.md §3 合併執行七項全 PASS（見 §5）：本次編輯範圍（`c8-task-ch-crosswalk` 表格內文）非任一 carve-out 錨點。

### 4. §08 內部連貫性檢查

**指示要求核對對象**：新權威表（item 22）、R2 三態重詮釋（item 12）、真實程度表（item 12）、Task 表 crosswalk（item 11）彼此一致；R1/R1a/R4 未動＝carve-out。

#### 4.1 四表彼此一致

- **權威表（`c8-authority-table`）與其餘三表的關係**：權威表將「docs/plans 需求正本」定為第 1 順位，是 R2 三態／真實程度表／Task-CH crosswalk 三者共同的上游依據——三者皆是「在 doc-first 權威序確立後，對 A4–A10 各模組如何落地」的下游重詮釋，無需彼此逐句重複陳述權威序本身（權威表已一次陳述，其餘三表只需在措辭上與其精神一致，不互相矛盾即可）。
- **R2 三態卡（`c8-r2-api-tristate`）與真實程度表（`c8-domain-reality-table`）用語一致**：R2 卡「In-canon + repo 內可建 → 後端 + 前端一次建到位(預設,不做 mock 過渡)」與真實程度表 A5/A6/A10 列「`planned(class: in-repo-fullstack-pending)`」同一分類（repo 內可建、尚未落地＝pending）；R2 卡「In-canon + 依賴外接引擎 → 不得已才 mock(掛 ProvTag 誠實標示)」與真實程度表 A5–A10 各列「`external(mock 合法,掛 ProvTag)`」同一分類、同一 `ProvTag` 詞彙。A4 列「deterministic 檢索已全棧落地」對映 R2 卡「Existing → directly integrate」（search 後端已存在／已整合）；A4 列「semantic 模式=外接 LLM」對映 R2 卡「依賴外接引擎 → 才 mock」。四種分類與兩表逐一互證，無矛盾。
- **Task 表（`c8-task-sequence-table`）與 R2 卡用語一致**：Task 表「5–10」列「A5–A9:repo 內可建面全棧一次到位(預設,不做 mock 過渡);僅外接引擎面可 mock(掛 ProvTag);A4 已超前完成 deterministic 全棧」與 R2 卡四態表**逐字複用同一措辭**（「repo 內可建…一次到位(預設,不做 mock 過渡)」「才 mock(掛 ProvTag」），非另造新框架。
- **Task↔CH Crosswalk（`c8-task-ch-crosswalk`）與 R2 卡顯式互引**：Crosswalk 表「5–10」列備註欄原句直接寫「依 R2 三態重詮釋(見左方 R2 卡)= repo 內可建面全棧一次到位,外接引擎面才 mock」——以文字明示讀者「這是同一分類語言」，非本報告推論出的隱性一致，是作者刻意的顯式交叉引用。
- **「餵法 → 成果對照」表第 2 列（hunk 21，§2.3）** 與上述三表用語同樣一致：「A4 deterministic 已全棧;A5–A10 仍為概念稿(缺逐模組 task/E2E)」——與 Task 表「A4 已超前完成 deterministic 全棧」、真實程度表 A4 列「deterministic 檢索已全棧落地」用詞相同；「仍為概念稿」與真實程度表 A5–A10 之 `planned`/`external` 標記（尚未落地）同向。

**結論：四表（含 hunk 21 所在的第五個關聯段落）彼此一致，無矛盾措辭，關鍵詞彙（`ProvTag`／`in-repo-fullstack-pending`／`external`／`deterministic`／`概念稿`）跨表統一，非各自表述。**

#### 4.2 R3 `ProvTag`／`Prov` 詞彙全域一致性（R2/真實程度表對 `ProvTag` 之引用的前提）

R2 卡與真實程度表多處引用「掛 ProvTag」，其定義來自 R3 卡（item 9，hunk 11）。對 §08 全文（甚至整份草稿）做詞彙殘留檢查：

```
grep -n "ProvenanceTag" "drafts/AI-BIM 前後端設計文件.v2-draft.dc.html"   → 0 命中(exit 1)
grep -n "asbuilt-partial" 同檔                                            → 僅 1 處，落於 c8-r3-oq1-open-decision 非 normative 區塊內
grep -n "NOT_BUILT" 同檔                                                  → 僅 1 處，R2 卡本身定義
grep -n "Planned endpoint\|Existing endpoint\|Missing endpoint" 同檔     → 0 命中(exit 1，舊三態詞彙已全數移除)
```

即：`ProvTag`/`Prov` 為 §08 全文唯一在用的出處誠實詞彙，無新舊詞彙並存造成的混淆；`asbuilt-partial` 僅存在於其定義所在的 OQ-1 非 normative 開放議題塊，未洩漏到任何 normative 列表（真實程度表 A5–A10 的「external(mock 合法,掛 ProvTag)」皆用 `ProvTag`，非誤用 `asbuilt-partial`）。

#### 4.3 R1／R1a／R4 未動＝carve-out（逐字級驗證）

以 hunk 對號表 §1 的 5/6/12 三行（純植錨、old-range 與 new-range 各僅 1 行）為起點，逐卡直接比對 main 與 draft 的完整區塊（剝除 `data-canon-id` 屬性後）：

| 卡 | main 範圍 | draft 範圍 | 行數 | 剝除 canon-id 後逐字比對 |
|---|---|---|---|---|
| R1（`c8-r1-stack-authority`） | line 627–635 | line 635–643 | 9 行 | **完全相同** |
| R1a（`c8-r1a-brand-theme`） | line 636–642 | line 644–650 | 7 行 | **完全相同** |
| R4（`c8-r4-one-outcome-one-task`） | line 655–658 | line 668–671 | 4 行 | **完全相同** |

（以 Python 逐行比對，`re.sub(r' data-canon-id="[^"]*"', '', line)` 剝除植錨屬性後 list 相等；邊界以相鄰卡片的下一張卡 `<div>` 開啟行為終止點交叉驗證，例如 `main[635]`／`draft[643]` 均為 R1a 卡的開啟 `<div>`，`main[658]`／`draft[671]` 均為 R4 卡的收尾 `</div>`，確認未截斷或多算。）

**結論：R1（技術棧權威）、R1a（品牌與主題）、R4（一個 outcome 一個 task）三張鐵律卡，內容除新增 `data-canon-id` 屬性外逐字未動，「未動＝carve-out」claim 成立**——三者皆不在 items 9/10/11/12/14/22 任一項的改寫目標範圍內，本 change 亦未透過任一 R-C2 wave task 觸碰其內文，符合預期。

### 5. carve-out 迴歸複驗（本 task 編輯後）

實跑 `carve-out-assertions.md §3` 合併執行區塊（本 task 於 draft 內做過一處單行文字編輯，見 §3，故重跑作迴歸防護）：

```
[1] §04 payload 委任        → PASS
[2a] 鐵律1                  → PASS
[2b] 鐵律2                  → PASS
[2c] 鐵律3 must-preserve    → PASS
[3] README §3.4 後端凍結面  → PASS
[4] README §3.5 誠實子句    → PASS
[5] §07:575 A5-A10 deferral → PASS
```

七項全數 PASS；本 task 編輯範圍（`c8-task-ch-crosswalk` 表格內文，§08）未落於任一 carve-out 錨點（§04/§01/README §3.4/§3.5/§07:575），與預期一致。

### 6. 結論（tasks.md 5.2 DoD 對照）

| DoD 項目 | 狀態 |
|---|---|
| 報告列出 §08 全部 hunks 的對號表、零未解釋 hunk | ✅ 23/23 hunk 全數對號（§1 表），含 3 項需額外說明（hunk 9 一對二、hunk 14 對號 item 5、hunk 21 經 `git log -L` 溯源對號 item 12，§2） |
| §08 全文 diff＝各區塊 diff 之聯集、零新增語意 | ✅ 完整性自證：23 hunk 行數增量總和 +16 ＝ §08 淨增行數 +16，精確相符（§0） |
| §08 內部連貫（新權威表／R2 三態／真實程度表／Task 表 crosswalk 彼此一致；R1/R1a/R4 未動＝carve-out） | ✅ 四表（＋餵法表關聯列）用語跨表統一、無矛盾（§4.1）；`ProvTag`/`Prov` 詞彙全域一致、無新舊並存（§4.2）；R1/R1a/R4 逐字級比對確認未動（§4.3） |
| Task 11–12 crosswalk 列 stale forward-ref 修正（Plan B final-review f1，必修） | ✅ 已修正 draft:708（§3），`openspec validate --strict` 綠、div/span 平衡、carve-out 七項複驗 PASS |
| tasks.md 5.2 打勾 | 本檔提交後於同一 commit 內打勾 |

本 task 對草稿檔（`drafts/AI-BIM 前後端設計文件.v2-draft.dc.html`）僅有**一處**實質編輯：§3 所述 Task 11–12 crosswalk 列 stale forward-ref 修正（本 task 指示明文必修項）；其餘為純驗證與報告撰寫，未回改任何既有 hunk。

---

## 24×11 追溯矩陣驗證（tasks.md 5.5，R-C2b）

### 0. 範圍與方法

對象：`design.md` §3「24×11 追溯矩陣」（design.md:54-84，24 列失真項 × 11 欄裁決）＋其緊接的說明句（design.md:83）。逐格核對非人工目視（表格欄位多、易誤讀），改以 Python 腳本解析 markdown 表格逐格取值，並與 task 5.4 已完成（PASS＋commit）之 `crosswalk.md`「對應裁決編號」欄（獨立以 grep 對 design.md §3 重新取值，非轉抄）交叉核對，兩份獨立來源逐列比對結果**完全一致**（24 列、每列裁決集合逐字相同），排除單一腳本 parsing 誤判的風險。

### 1. 逐格核對結果（三項检查，依 R-C2b 條文＋任務指示）

#### 1.1 每項失真至少對到一條裁決來源

腳本逐列統計：24 列（失真項 1–24）**全數**在裁1欄標 X，即全數滿足「至少對到一條裁決來源」。零缺格。

#### 1.2 每條裁決至少覆蓋一項失真或明列條文化落實

逐欄統計 X 數（腳本核驗，行加總=49＝欄加總=49，交叉自證無漏算/重複算）：

| 裁決 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 覆蓋失真項數 | 24 | 6 | 2 | **0** | **0** | 5 | 3 | 2 | 1 | 1 | 5 |

裁1/2/3/6/7/8/9/10/11（9 條）矩陣覆蓋 ≥1 項失真，滿足 R-C2b「覆蓋失真」分支。裁4／裁5（2 條）矩陣覆蓋為 0，須靠「明列條文化落實」分支——design.md:83 說明句原文列名裁4/5/7/11 四條為「不直接改任一失真項文字，而以獨立條文/follow-up 承載」。

**發現（逐格核對而非僅核對「註記是否存在」才發現）**：說明句原文對裁 7、裁 11 的「零覆蓋」敘述與矩陣本體 X 標記不符——裁 7 實際覆蓋 3 項（item 2「§06 六態」、item 11「§08 crosswalk」、item 13「§04 契約」），裁 11 實際覆蓋 5 項（item 3「§03 gate 失真」、item 5「§07/§08 stale 編號」、item 10「§08 features 目錄」、item 16「README token」、item 19「§03 雙軌」）。已以 `crosswalk.md`「對應裁決編號」欄（task 5.4 獨立 grep 結果）逐項覆核，兩來源完全一致，非本次腳本誤判：

| 失真項 | design.md §3 矩陣 | crosswalk.md 對應裁決編號 | 一致 |
|---|---|---|---|
| 2 | 裁1,裁7 | 裁1,7 | ✅ |
| 3 | 裁1,裁2,裁11 | 裁1,2,11 | ✅ |
| 5 | 裁1,裁11 | 裁1,11 | ✅ |
| 10 | 裁1,裁11 | 裁1,11 | ✅ |
| 11 | 裁1,裁7 | 裁1,7 | ✅ |
| 13 | 裁1,裁6,裁7 | 裁1,6,7 | ✅ |
| 16 | 裁1,裁11 | 裁1,11 | ✅ |
| 19 | 裁1,裁10,裁11 | 裁1,10,11 | ✅ |

**是否構成 R-C2b 定義的「缺格」**：不構成。spec.md:172 Scenario「追溯矩陣缺格」的觸發條件為「任一裁決既不覆蓋失真也未標明條文化落實」——裁 7／裁 11 兩者皆有矩陣覆蓋（見上表），已獨立滿足「覆蓋失真」分支，不落入「既不…也未…」的缺格條件；spec.md:168 本身把「覆蓋失真」與「條文化落實」以「或」連接（非互斥），一條裁決可同時符合兩者。`git log --follow` 核查 design.md 僅 2 個 commit（`378a9c1` 首版、`bf062ff` 僅動 §4 item 9 錨點欄，未動 §3），證實此說明句的敘述缺陷自首版即存在、非本分支後續編輯漂移所致。

**處置**：雖非 R-C2b 定義之「缺格」，但屬本 task「Files: design.md」明確範圍內、可獨立驗證的事實性錯誤（矩陣本體與其緊鄰說明句自相矛盾），已於 design.md:83 更正說明句——裁4/5 維持「矩陣零覆蓋、純條文化承載」原意不變；裁7/11 改為準確敘述「矩陣仍覆蓋部分失真項（列出 items），非零覆蓋，主要落地位置同為獨立條文/follow-up」，並註記 `R-C2b「或」關係擇一即足`，避免讀者誤讀矩陣覆蓋與條文化落實為互斥。此為本 task 對 `design.md` 的唯一實質編輯（`git diff --stat`：1 file changed, 1 insertion(+), 1 deletion(-)，單行說明句置換，未動矩陣本體 24×11 X 標記、未動 §1/§2/§4–§8 任何其他章節）。

#### 1.3 裁決 1 掛「1 MODIFIED＋1 ADDED」

對照 `specs/documentation-source-of-truth/spec.md`（`grep -n "^## \(ADDED\|MODIFIED\|REMOVED\) Requirements\|^### Requirement:"`）：該檔僅 2 條 `## MODIFIED Requirements`（「Workflow v3 and product design artifacts have distinct, non-overlapping authority」＋「文件分工調整必須走 PR 治理流程」），其餘 12 條（R-B1–R-B6、R-C1、R-C2、R-C2a、R-C2b、R-C3、R-C4）皆為 `## ADDED Requirements`。裁決 1 之「落地位置」（design.md:42）明列 `MODIFIED「Workflow v3…」body ＋ ADDED R-B1`：

- **MODIFIED**：對應 2 條 MODIFIED 之第一條「Workflow v3 and product design artifacts have distinct, non-overlapping authority」（header 逐字保留、body 改寫為 doc-first 權威序，task 2.1 已 PASS）——裁決 1 專屬 1 條，另一條 MODIFIED（「文件分工調整必須走 PR 治理流程」）為裁決 5（變更控制 cross-ref）落地，非裁決 1。
- **ADDED**：對應 R-B1（doc-first 偏離處置序與三態分類，task 2.3 已 PASS）——裁決 1 專屬 1 條；其餘 11 條 ADDED（R-B2–R-B6、R-C1–R-C4）分屬其他裁決或本 change 自身彙整/驗收機制（tasks.md §5 彙整節），非裁決 1 之「MODIFIED/ADDED」計數範圍（R-C2b 本身即為此類彙整/驗收機制之一，非裁決 1 專屬）。
- items 22/23/24（design.md §2 裁決 1 列另註記的「三處遺跡改寫」）為**草稿檔本文**（`.v2-draft.dc.html`/`.v2-draft.md`）之文字改寫，非 OpenSpec `spec.md` 之 MODIFIED/ADDED requirement delta，不計入本項數。

驗證：`裁決 1 掛 1 MODIFIED＋1 ADDED` 逐字準確，且與 spec.md:168 R-C2b 條文「裁決 1 SHALL 掛為『1 條 MODIFIED…＋ 1 條 ADDED…』」一致。零缺格。

### 2. 結論（tasks.md 5.5 DoD 對照）

| DoD 項目 | 狀態 |
|---|---|
| 每項失真至少對到一條裁決來源 | ✅ 24/24 列皆掛裁1（§1.1） |
| 每條裁決覆蓋失真或明列條文化落實 | ✅ 裁1/2/3/6/7/8/9/10/11 矩陣覆蓋 ≥1 項；裁4/5 矩陣零覆蓋、純以條文化落實承載（§1.2） |
| 裁決 1 掛「1 MODIFIED＋1 ADDED」 | ✅ 對照 spec.md 逐條 grep 核實（§1.3） |
| R-C2b 定義之「缺格」 | ✅ 零缺格（spec.md:172 Scenario 未觸發，§1.2） |
| 發現缺格才修 | 未發現 R-C2b 定義之缺格，故矩陣本體（X 標記）零修改；**但**發現且修正 1 項說明句事實性錯誤（design.md:83 對裁7/11「零覆蓋」誤述，§1.2），此修正在本 task「Files: design.md」範圍內、單行置換、不影響矩陣本體或任何裁決/失真項對應關係 |
| `npx openspec validate doc-first-canon-v2 --strict` | ✅ `Change 'doc-first-canon-v2' is valid` |
| tasks.md 5.5 打勾 | 本檔提交後於同一 commit 內打勾 |

**核對結果：矩陣零缺格（依 R-C2b 定義驗證，見 §1）；design.md:83 說明句 1 處事實性精確度修正（非缺格修正，見 §1.2），為本 task 對 design.md 的唯一實質編輯。**

---

## planned 無裸標檢查＋class token 統一（tasks.md 6.1）

### 0. 範圍與方法

**Grep 指令（實跑）**：對三份 v2 canon draft 全文搜尋 `planned` 字面出現處（審計 corpus 對齊 task 5.3/5.4 已確立之「三份 v2 草稿」）：

```bash
grep -n "planned" "openspec/changes/doc-first-canon-v2/drafts/AI-BIM 前後端設計文件.v2-draft.dc.html"
grep -n "planned" "openspec/changes/doc-first-canon-v2/drafts/docs-plans-README.v2-draft.md"
grep -n "planned" "openspec/changes/doc-first-canon-v2/drafts/AI-BIM Console Hi-Fi.v2-draft.dc.html"
```

`.dc.html` draft 命中 **8 行**（draft:562 修前含同行重複 `planned` 2 處＝9 處字面，task 7 移除裸前綴後每行單一、現況 8 行 8 處，見 §1 #4）；`docs-plans-README.v2-draft.md` **0 命中**；`AI-BIM Console Hi-Fi.v2-draft.dc.html` **0 命中**——後兩份 draft 本次無需任何編輯，逐一確認完畢。

依 task 指示「已知待統一點」，另對兩份 `.dc.html` draft（`AI-BIM 前後端設計文件` 與 `AI-BIM Console Hi-Fi`）追加搜尋 `external(` 括號樣式（task 4.8 遺留、非 `planned` 字面但屬同一 R-B5 token 統一範圍）：`AI-BIM 前後端設計文件` 命中 **6 行**（A5–A10 真實程度表 draft:775–780，修前掃描、本次已全數收斂為 `external-mock-legit`）、Hi-Fi **0 命中**。

**Hi-Fi draft 零命中之結構性理由（非漏檢）**：Hi-Fi console draft 之建成狀態語彙採 LIVE／HYBRID／Concept Preview 徽章機制（task 4.17 落地，本檔 grep：LIVE 9／HYBRID 2／Concept Preview 3），非本正本 §04/§06/§08 所用之 R2 `planned`／`external` class-token 體系（Hi-Fi 全檔 `in-repo-fullstack-pending`／`external-mock-legit`／`unclassified` 三 token 皆 0 命中）；故 Hi-Fi 天然無裸 `planned`／`external(` 標記。三份 canon draft 已全數納入本次審計，Hi-Fi 以「不適用 R2 class-token、改用獨立徽章」查證後記錄（非靜默留白），與 task 5.3/5.4 三份草稿審計 corpus 一致，符合 R-C1 誠實鐵律。

R-B5 封閉列舉 token（`specs/documentation-source-of-truth/spec.md:102`）：`{integrated-ready｜in-repo-fullstack-pending｜external-mock-legit｜not-built｜unclassified}`。

### 1. 逐處列表（位置／原標／改後）

| # | 位置（draft，`.../AI-BIM 前後端設計文件.v2-draft.dc.html`） | 原標 | 改後 | 判定 |
|---|---|---|---|---|
| 1 | draft:230（§04 header badge） | `A1–A10 各 API 的契約檔=planned(class: in-repo-fullstack-pending)` | 未動——已合規 | 已附封閉 token，逐一核對通過，免動 |
| 2 | draft:322（§04 `c4-contract-conversion-result-callback` 卡，HARD RULE 補註，item 20／task 4.16 落地） | `強化為 allowlist=follow-up metadata-allowlist(planned);鐵律語意不變。`（**裸標**——`(planned)` 無 class） | `強化為 allowlist=follow-up metadata-allowlist:planned(class: in-repo-fullstack-pending);鐵律語意不變。` | **本次修正**：design.md §6a 具名 follow-up「metadata-allowlist｜—（本 change 新提）｜item 20」；`gap-ledger.md`（task 5.3）item 20 classification=`code-defect`、status=`planned-not-built`——非孤兒裁決，屬 repo 內（coordinator 後端 blocklist→allowlist 驗證邏輯擴充）可建、無外接引擎依賴 → `in-repo-fullstack-pending`，非 `unclassified` |
| 3 | draft:547（§06 `c6-callback-outbox-lineage-outbox` 卡，item 2／task 4.2 落地） | `lineage: ... — planned(class: in-repo-fullstack-pending)——coordinator 現況僅 3 態 outbox...` | 未動——已合規（task 4.2 自身 2026-07-18 gap-fix 已將原「`class: repo 內可建/全棧`」中文改述改為此封閉 token） | 本次覆核：grep `class: repo 內可建/全棧` 於 draft 全檔 0 命中（exit 1），確認 task 4.2 的「六態 planned 列」已無殘留非封閉措辭，免再動 |
| 4 | draft:562（§06 R-C4 撈回 domain 實體區段標頭） | `planned domain 實體(A5–A10) — R-C4 撈回,全列 planned(class: in-repo-fullstack-pending);外接引擎分類仍以 §08 domain-reality 表為準,本表不改`（標頭前綴**裸「planned」**，與其後「全列 planned(class:…)」語意重複但只有後者帶 class） | `domain 實體(A5–A10) — R-C4 撈回,全列 planned(class: in-repo-fullstack-pending);外接引擎分類仍以 §08 domain-reality 表為準,本表不改` | **本次修正**：移除冗餘裸前綴「planned 」；語意不變（原句「全列 planned(class:…)」本已涵蓋整組 4 張卡片=同一 class），消除機讀規則下的假陽性裸標，不新增/不弱化任何分類宣告 |
| 5 | draft:775（§08 `c8-domain-reality-table`，A5 IoT/FM 列） | `;感測 feed:external(mock 合法,掛 ProvTag)`（**裸標**——`external` 非封閉 token） | `;感測 feed:external-mock-legit(mock 合法,掛 ProvTag)` | **本次修正**：R-B5（spec.md:100）明列「IoT feed」為外接引擎依賴例 → `external-mock-legit`；人讀語意括號「(mock 合法,掛 ProvTag)」保留，token 為主體 |
| 6 | draft:776（A6 4D/5D 列） | `;成本/排程外部系統:external(mock 合法,掛 ProvTag)` | `;成本/排程外部系統:external-mock-legit(mock 合法,掛 ProvTag)` | **本次修正**：R-B5 明列「P6 成本系統」為外接引擎依賴例 → `external-mock-legit` |
| 7 | draft:777（A7 Scan 列） | ` — 點雲 ICP:external(mock 合法,掛 ProvTag)` | ` — 點雲 ICP:external-mock-legit(mock 合法,掛 ProvTag)` | **本次修正**：R-B5 明列「點雲 ICP」為外接引擎依賴例（逐字同名）→ `external-mock-legit` |
| 8 | draft:778（A8 Synthetic 列） | ` — 合成資料引擎:external(mock 合法,掛 ProvTag)` | ` — 合成資料引擎:external-mock-legit(mock 合法,掛 ProvTag)` | **本次修正**：R-B5 明列「Isaac、Replicator」為外接引擎依賴例（task 4.8 已 genericize 移除具名廠商，改「合成資料引擎」）→ `external-mock-legit` |
| 9 | draft:779（A9 機器人 列） | ` — 機器人 runtime:external(mock 合法,掛 ProvTag)` | ` — 機器人 runtime:external-mock-legit(mock 合法,掛 ProvTag)` | **本次修正**：R-B5「Isaac」類機器人 runtime 為外接引擎依賴例（task 4.8 已 genericize）→ `external-mock-legit` |
| 10 | draft:780（A10 整合 列） | ` — 聚合儀表板:planned(class: in-repo-fullstack-pending)</span>...;各 domain service:external(mock 合法,掛 ProvTag)` | `planned` 段未動（已合規）；`;各 domain service:external-mock-legit(mock 合法,掛 ProvTag)` | **部分修正**：A10 儀表板自身 repo 內可建（聚合邏輯）維持 `in-repo-fullstack-pending` 不變；其匯總之各 domain service 外接依賴 → `external-mock-legit` |

**排除項（非 R2 狀態標記，逐一確認後判定不計入裸標）**：

| 位置 | 文字 | 排除理由 |
|---|---|---|
| draft:581（§06 `c6-schedule-activity` 卡，ScheduleActivity(A6) 欄位列） | `activity_id · wbs_code<br>planned/actual dates · progress<br>cost_code · element_guids[]` | `planned/actual dates` 為 ScheduleActivity 資料實體的**欄位名稱**（對應 EVM／schedule 領域慣用的「計畫日期／實際日期」欄位對，如 `planned_date`/`actual_date`），非 R2 三態建成狀態標記；與同卡其餘欄位（`activity_id`、`wbs_code`、`cost_code`）同屬 schema 描述，非「本功能建成狀態＝planned」的宣告，故不適用 R-B5 class 標籤，不計入裸標統計 |

### 2. 「已知待統一點」逐項覆核

task 指示明列兩個 Wave 2 遺留待統一點，逐一驗證現況：

- **task 4.2 的六態 planned 列（人讀「repo 內可建/全棧」）**：grep 全檔 `class: repo 內可建/全棧` → **0 命中**（exit 1）。查 tasks.md task 4.2 自身 PASS 記錄（`2026-07-18,fixer` gap fix 段）：已先於本 task 將該中文改述換成封閉列舉值 `in-repo-fullstack-pending`（即上表 #3，draft:547）。本 task 覆核確認無殘留，免重工。
- **task 4.8 的「planned(全棧)」**：grep 全檔 `planned(全棧)` → **0 命中**（exit 1）。查 assembly-verification.md §08 對號表 hunk 20（本檔前段既有記錄）：task 4.8 落地時已直接採用 `planned(class: in-repo-fullstack-pending)` 格式（即上表 #5/#6/#10 各列的 planned 段），非任務指示引述之過渡態裸格式。
- **task 4.8 的「external(mock 合法,掛 ProvTag)」**：grep 命中 6 處（draft:775–780）——**此點確實遺留至本 task**，已依上表 #5–#10 全數改為 `external-mock-legit(mock 合法,掛 ProvTag)`（token 為機讀主體、人讀語意括號原樣保留，符合任務指示格式要求）。

**明確排除（未在任務指示「已知待統一點」名單內，逐一評估後判定維持原狀不動）**：R2 legend 卡本體（draft:694–697，`In-canon + repo 內可建`／`In-canon + 依賴外接引擎`／`Missing(正本沒列) → NOT_BUILT`）、Task 表 5–10 列（draft:738）、Task↔CH Crosswalk 表 5–10 列備註（draft:748）、docs-plans-README.v2-draft.md §08 四鐵律回聲段（README draft:40）——以上四處皆為 R2 三態**分類法本身的定義／legend 敘述**（人讀散文，非對某一具體功能套用的 `planned` 狀態標記），且 R-B5 spec 本文（spec.md:100）自身即以同一人讀散文定義三態，非以封閉 token 表達；`NOT_BUILT`（全大寫底線）為 legend 沿用之既有第四態代稱，非 R-B5 五值封閉列舉之 `not-built`，非本次 class 標籤統一對象。四處皆未含字面 `planned` 或 `external(...)` 括號樣式，不落入本 task 兩道搜尋（§0）範圍，YAGNI 原則下不逕自擴大改寫。

### 3. 迴歸驗證

- **`planned` 全檔覆核**：改後 grep `planned` 仍 8 行命中（230/322/547/562/581/775/776/780），除 draft:581（已排除,非狀態標記）外，其餘 7 行**逐一目視確認**皆含 `(class: in-repo-fullstack-pending)`，零裸標。
- **`external(` 覆核**：改後 grep `external(` 不含 `external-mock-legit(` 前綴者 → 0 命中（exit 1）；`external-mock-legit(` → 6 命中，與預期改動數一致。
- **`git diff --stat`**：`1 file changed, 8 insertions(+), 8 deletions(-)`——恰為上表 8 處實質修正（#2/#4/#5/#6/#7/#8/#9/#10 之 external 段），純文字置換，無新增/刪除任何行、無新增/刪除任何 div/span 標籤。
- **div/span 標籤配對**：python 腳本核驗全檔平衡，`<div>`/`</div>` 306/306、`<span>`/`</span>` 636/636，開閉相等。
- **行結尾一致性（LF）**：以 `git cat-file -p` 讀 git 內部 blob（繞過 checkout smudge filter）核驗——git 實際儲存為 817 行 LF、0 條 CRLF；pre/post-edit 皆 817 行、行尾風格未被本次編輯破壞、全檔保留。註：本機 `core.autocrlf=true`，checkout 到 Windows 工作目錄時 LF→CRLF，直接讀本機檔案位元組會顯示 817 CRLF——此為 checkout 暫態、非入庫內容（實際 commit 及 CI/PR diff 所見均為 LF）；原述「817 行 CRLF」係量到本機 checkout 產物，已改用 blob 級量測法並校正措辭。
- **carve-out-assertions.md §3 合併執行七項迴歸**（本次編輯範圍落於 §04/§06/§08 R2/R3 相關卡片，非任一 carve-out 錨點，實跑防護）：

  ```
  [1] §04 payload 委任        → PASS
  [2a] 鐵律1                  → PASS
  [2b] 鐵律2                  → PASS
  [2c] 鐵律3 must-preserve    → PASS
  [3] README §3.4 後端凍結面  → PASS
  [4] README §3.5 誠實子句    → PASS
  [5] §07:575 A5-A10 deferral → PASS
  ```

  七項全數 PASS，本次編輯未觸及任一 carve-out 錨點。
- **`npx openspec validate doc-first-canon-v2 --strict`**：`Change 'doc-first-canon-v2' is valid`。
- **`docs-plans-README.v2-draft.md`**：本 task 零編輯（`planned`／`external(` 皆 0 命中，逐一確認後免動）。
- **`AI-BIM Console Hi-Fi.v2-draft.dc.html`**：本 task 零編輯（`planned`／`external(` 皆 0 命中；建成狀態採 LIVE／HYBRID／Concept 徽章、非 R2 class-token 體系，詳見 §0 結構性理由）。

### 4. 結論（tasks.md 6.1 DoD 對照）

| DoD 項目 | 狀態 |
|---|---|
| grep 三份 v2 draft 全部 `planned` 出現處，逐一確認附 R2 三態 class | ✅ `.dc.html` 8 行／README 0 行／Hi-Fi 0 命中；逐一列表見 §1，1 處排除（draft:581 欄位名非狀態標記） |
| 裸標補 class，使用 R-B5 封閉列舉 token | ✅ 2 處裸 `planned` 補 class（draft:322 新增、draft:562 移除冗餘前綴）；token 皆取自 R-B5 五值封閉列舉 |
| 無裁決背書者標 `unclassified` 綁 ledger triage | 不適用——本次覆核之全部項目皆可追溯至 R-B5 spec 明文例舉（IoT feed／P6 成本系統／點雲 ICP／Isaac／Replicator）或 design.md §6a／gap-ledger.md 具名 follow-up（metadata-allowlist／item 20），零孤兒項，故無需標記 `unclassified` |
| task 4.2／4.8 已知待統一點統一改封閉 token | ✅ task 4.2 六態列、task 4.8 `planned(全棧)` 兩點覆核確認已先行合規（§2）；task 4.8 `external(mock 合法,掛 ProvTag)` 6 處本次統一改 `external-mock-legit(...)`，人讀語意括號保留、token 為機讀主體 |
| 零裸 `planned` 且全部 class=R-B5 封閉 token | ✅ 迴歸驗證見 §3 |
| tasks.md 6.1 打勾 | 本檔提交後於同一 commit 內打勾 |

本 task 對 `drafts/AI-BIM 前後端設計文件.v2-draft.dc.html` 實質編輯 **8 處**（純文字置換，見 §1／§3 diff stat）；對 `drafts/docs-plans-README.v2-draft.md` **零編輯**（逐一確認後確認免動）。

---

## J1–J5 旅程端到端走查（tasks.md 6.4）

> **本節性質：軟性人工走查記錄，非機器可驗證 gate。** tasks.md 6.4 原文明定「不列入完成 gate」——本節結論不影響、不覆蓋上方 5.1–5.7／6.1–6.3 各節之機器可驗證 PASS 結論；本節是在那些逐 hunk／逐條規則的機器檢核之外，額外做一次「像真人讀者一樣從頭到尾讀一遍」的人工複核，用來抓那些因為「文字本身沒被任何 task 的 hunk 觸及、因此不會出現在 diff 裡」而被機器檢核天然漏掉的問題。

### 0. 範圍與方法

- **走查對象**：`AI-BIM 前後端設計文件.v2-draft.dc.html`（§01–§08 全文逐行讀通，非抽樣）、`docs-plans-README.v2-draft.md`（全文讀通）、`AI-BIM Console Hi-Fi.v2-draft.dc.html`（依 J3 路徑抽樣讀通：header/nav、Home 畫面、Workspace 三欄+A1–A4 dock badge 區塊）。
- **五旅程路徑**：逐字對齊 `docs-plans-README.v2-draft.md` §2「讀取路線」表前五列（該表第六列「查『X 建了沒』」非本 task 五旅程範圍，本次走查中一併核對、未見異常，不獨立成節）：

  | 旅程 | 路徑（= README §2 對應列） |
  |---|---|
  | J1 | 本檔（README）→ 設計文件 §01（服務邊界＋鐵律 1–3） |
  | J2 | §04 API 契約（Payload 以 tests/contracts/\*.json 為最高標準）＋ §08 權威順序與 R1–R4 |
  | J3 | §03 前端架構 IA → §07 對應 CH 期 → Hi-Fi 原型比對 → design-system-reference.manifest.json visual gate |
  | J4 | §04 Kit DataChannel 訊息協定 ＋ §05 時序 F1／F2 |
  | J5 | §07 實作分期 ＋ §08 Task 0–12 |

- **記錄準則**：每旅程記錄「可讀通」「卡點」「跨 task 矛盾」三類；卡點＝措辭鬆散但緊鄰上下文已自我澄清、不需動筆；矛盾＝兩段文字對同一事實給出無法同時成立的斷言，依任務指示「發現矛盾＝修 draft 再記」處理。

### J1 — 新 agent 第一次進 repo（README → §01）

- **可讀通**：README §0 一句話定位直接指向正本檔；§1 檔案清單先建立六份檔案的角色地圖；§2 讀取路線第一列導向 §01；§01「服務邊界」的 Web Plane／Control Plane Boundary／Internal 三欄圖＋鐵律 1–3 badge 自成一體，不需先讀 §02–§08 即可理解系統邊界與三條硬限制。
- **卡點**：無。§01 鐵律 3 badge 提到 `e2e/ui-open-regression.spec.ts` 尚未接 CI 的 known gap，與 §08 OQ-4 呼應（此時新讀者尚未讀到 §08，屬合理的前向引用，不構成卡點）。
- **跨 task 矛盾**：未發現。（README 版頭「v5 · 2026-07-15」與 `.dc.html` 內文標頭「v1 · 2026-07-14」版本號不同——兩者是各自獨立檔案的既有版本序，非本 change 引入的矛盾，不予處理。）

### J2 — 動 code 前（§04 + §08 權威序）

- **可讀通**：§04 header「Payload 以 tests/contracts/\*.json 為最高標準」是 carve-out item 1 明文保護的委任語意，範圍限定在 payload 欄位形狀，非一般需求權威；§08 `c8-authority-table`（draft:659 起）翻轉後 row 1＝docs/plans 需求正本、row 2＝tests/contracts（payload 委任，§04 保留）——兩處合讀一致：一般需求權威＝doc-first，payload 細節＝委任 tests/contracts，非互斥。R1–R4 四條鐵律清楚可操作。
- **發現並已修正的矛盾**：§08 章節標題正下方的三詞標語（改寫前原文）「圖片決定「長相」·文字契約決定「行為」·repo 決定「真相」」，在讀者尚未讀到下方 `c8-authority-table` 之前即先聲奪人宣稱「repo 決定真相」，與同一 §08 開頭區塊內、僅一欄之隔的 authority table row 1（docs/plans 需求正本最高）＋緊接的誠實半句（draft:667）「code + tests = runtime 現況的查證面;code 偏離本正本 = implementation gap 待修」直接衝突——若 repo「決定真相」，code 便不可能「偏離」一個由自己定義的真相，此為 proposal.md F1「權威序自相矛盾」病灶的殘留分身。此行文字本身不在 24 項失真清單／design.md 24×11 矩陣／crosswalk.md 任一項的改寫範圍內（既非任一 hunk 觸及，Wave 1／Wave 2 任何 task 皆未列為改寫目標），純靠端到端全文讀通才被發現。**已修正**：比照本文件其餘處對「repo/code」現況角色的既定用語——同段誠實半句「code+tests=runtime 現況的查證面」（draft:667）、README §2 末列「查『X 建了沒』（現況）｜repo code＋tests 直接查證」、`AGENTS-refchain.v2-draft.md` 對照 2 建議改寫同樣把 AGENTS.md 原文標題「Runtime/product 行為**真相**優先順序」改為「Runtime/product 需求權威與**現況查證**順序」（避開「真相」一詞）——三處既有先例一致指向同一改法，將標語「repo 決定「真相」」改為「repo 決定「現況」」（draft:637，1 行內 2 字置換，`git diff --stat`：1 file changed, 1 insertion(+), 1 deletion(-)）。改後：docs/plans 決定「應然」需求真相，repo 只決定「現況」查證結果，與 authority table／誠實半句／README 現況查證框架不再字面衝突。
  - **修正後驗證**：`carve-out-assertions.md` §3 合併執行七項全 `PASS`（本次編輯落於 §08 header 標語，非任一 carve-out 錨點）；div/span 標籤配對 306/306·636/636（與編輯前基準相同，純文字置換未增減標籤）；行結尾一致性以 git blob 層（`git cat-file -p`，繞過 checkout smudge filter）核驗全檔保留純 LF（817 行 LF、0 CRLF，與編輯前基準相同；原述「818 行、817 CRLF、0 bare LF」測量方向相反、係量到本機 `core.autocrlf=true` 之 checkout 產物，已比照本檔 §3「行結尾一致性(LF)」（:425）與 88653cc 同款改用 blob 級量測法校正）；`npx openspec validate doc-first-canon-v2 --strict` 綠（`Change 'doc-first-canon-v2' is valid`）。
- **次要觀察（措辭鬆散，未達矛盾門檻，不修正）**：同一標語「文字契約決定「行為」」以「契約」稱呼 Prompt Board，但緊接的 Prompt Board 卡片本文明說「其中 API 多為『建議』，不是現有契約」——用語鬆散，但同一視覺區塊內立即自我澄清，判定為可讀通、非跨 task 矛盾，依 YAGNI 不予修改（避免超出「矛盾」修正範圍）。

### J3 — 前端任務（§03 → §07 → Hi-Fi）

- **可讀通**：§03 Route Map／CH-G 表、元件樹／hooks 現況對照、四個 badge（workspace-handoff／spectator-gate／i18n／dual-track）建立「現況 vs 目標」的清楚圖像；§07 CH-0～CH-I 分期表延續同一框架（CH-G／CH-I 標橙色「未做」，其餘標青色「已出貨」）；Hi-Fi `hifi-workspace` 畫面視覺上呈現內嵌 viewport＋streaming 徽章，對映 §07 CH-I「Workspace 內嵌 viewport｜follow-up embedded-viewport」與 §03 badge「【現況】unified Workspace 為靜態示意」——三者合讀的正確理解是「Hi-Fi＝有意識的目標互動設計，不是『已建成』宣稱」；Hi-Fi 首頁/dock 徽章系統（LIVE／HYBRID／Concept Preview）標示 A1–A3 live、A4 hybrid，與 task 4.17 記錄一致。
- **卡點（未達矛盾門檻，不修正）**：§07 CH-C 資料列本身（青色、無「未做」字樣）「本設計對映」欄文字含「commandRejected 回饋」，若只看這一列容易誤讀成 commandRejected 已隨 CH-C 出貨；但同一 §07 區塊緊接的 `c7-residual-badges` 明文澄清「CH-C 殘留：…commandRejected（spectator / 權威拒絕回饋）仍待補，詳見 §04」，且 §04 `c4-datachannel-protocol` 卡本身亦標記 commandRejected 為「待補」。三處合看無矛盾，但要求讀者讀完整個 §07 區塊（含表格下方的殘留 badge）才能得到準確狀態，只看表格列本身會暫時誤讀——記錄為排版可讀性建議（例如未來若重排版面可考慮把殘留說明併入同一列），本次不調整版面結構（超出本 task「文字矛盾」修正範圍）。
- **跨 task 矛盾**：未發現（J2 記錄之「repo 決定真相」問題落在同一 §08，J3 路徑亦會途經，已於 J2 修正，此處不重複列為新發現）。

### J4 — 查 3D／runtime 互動（§04 DataChannel + §05）

- **可讀通**：§04 `c4-datachannel-protocol` OUT/IN 訊息列表與 §05 F1 步驟⑪⑫、F2 步驟⑥⑦逐一對應（`openStageRequest`/`openedStageResult`、`highlightPrimsRequest`/`highlightPrimsResult`+`stageSelectionChanged`），訊息名稱與方向箭頭一致；`commandRejected` 待補狀態在 §04 本卡與 §07 殘留 badge 雙重標註一致（見 J3 記錄），§05 時序圖未畫出 `commandRejected`（因其尚未實作、不出現在 happy-path 時序圖屬合理省略，非遺漏）。
- **卡點**：無新增卡點（J3 已記錄的 CH-C 表格列易誤讀問題屬 §07，J4 路徑不經過 §07 CH 表，不重複列出）。
- **跨 task 矛盾**：未發現。

### J5 — 排工作（§07 + §08 Task 表）

- **可讀通**：§08 `c8-task-sequence-table`（Task 0–12 建議順序）與 §07 CH-0～CH-I 分期表雙軸並存；`c8-task-ch-crosswalk` 表逐列對映兩軸；表格上下皆有明文但書「Task↔CH Crosswalk（近似對映，非嚴格一對一）」／「CH＝基礎建設軸…Task＝feature 軸…二軸非逐項嚴格對應…Task 5–10 無對應 CH 屬預期現象、非缺漏」，讀者被清楚告知不要把兩軸當成嚴格因果關係。
- **卡點（未達矛盾門檻，不修正）**：Crosswalk 表「Task 11–12」列將「Task 11 A10 整合儀表板未有對應 CH」的括號說明指向「§07 CH-H/CH-I，對應 item 18，已列入本文件」——CH-H（semantic viewer 家族）／CH-I（Workspace 內嵌 viewport）兩期主題與「A10 整合儀表板（碳排/能耗/法規/風險決策）」字面上無直接關聯，快速讀者可能誤以為 CH-H/CH-I 就是「將實作 A10」的明確承諾。經查該括號句是 task 5.2 stale forward-ref 修正的既有產物——原文更早即以「未來新期」措辭將 Task 11 缺口與（當時尚未存在的）CH-H 家族/內嵌 viewport 期並列，task 5.2 僅將「現況本文件尚未列」更正為「已列入本文件」，未變更兩者關聯性本身；且緊鄰表格上下兩處但書已明文「近似對映」「Task 5–10 無對應 CH 屬預期現象」定調全表僅供粗略排程參考，非嚴格承諾。判定為可讀通的鬆散措辭、非矛盾，不修改——若要修改需重新界定「Task 11 缺口由誰承接」的措辭範圍，超出本 task「發現矛盾即修」的最小必要修正原則，且會與 task 5.2 的 R-C2 single-ownership 精神產生二次改動同一段落的疑慮，留供後續 wave 或 follow-up 視需要處理。
- **跨 task 矛盾**：未發現（J2 記錄之「repo 決定真相」問題同樣落在 §08，此路徑會再次途經同一標語，但已於 J2 修正，不重複列出）。

### 結論（tasks.md 6.4 DoD 對照）

| DoD 項目 | 狀態 |
|---|---|
| 五旅程記錄存在 | ✅ J1–J5 各自記錄可讀通／卡點／跨 task 矛盾，見上 |
| 發現矛盾已修 | ✅ 發現 1 處（§08 header 標語「repo 決定「真相」」與其下 authority table／誠實半句字面衝突，屬 F1 病灶殘留分身），已修正為「repo 決定「現況」」（draft:637，1 insertion/1 deletion）；修正後 `carve-out-assertions.md` §3 七項全 PASS、div/span 306/306·636/636 平衡、CRLF 以 git blob 層核驗保留純 LF（817 行 LF/0 CRLF；原述「818 行/817 CRLF/0 bare LF」測量方向相反、量到本機 core.autocrlf checkout 產物，已比照 §3「行結尾一致性(LF)」校正）、`npx openspec validate doc-first-canon-v2 --strict` 綠 |
| 明標「軟性走查，非機器 gate」 | ✅ 本節標題與 §0 已明文標示，不影響 tasks.md 6.1–6.3／5.x 之機器可驗證 gate 結論 |
| tasks.md 6.4 打勾 | 本檔提交後於同一 commit 內打勾 |

本 task 對 `drafts/AI-BIM 前後端設計文件.v2-draft.dc.html` 實質編輯 **1 處**（§08 header 標語矛盾修正，draft:637）；對 `docs-plans-README.v2-draft.md`／`AI-BIM Console Hi-Fi.v2-draft.dc.html` 零編輯（走查後確認可讀通，無需修改）。

---

### 附記（task#10:fix）：289b913 out-of-scope 揭露範圍訂正

> 比照 6.1（:425）／task#7（88653cc）／本節 J2（:487、:513）gap-fix 先例：**新增更正記錄、不回改各原文 PASS 斷言**（存審計軌跡）。本附記僅訂正「揭露範圍」一句，未觸及任何原文行。

commit 289b913 message 末段稱「out-of-scope 之其他 task 同款措辭（`tasks.md:55/65`、`assembly:228`）不在本 finding 範圍」，僅點名 **3 處**——此句**低估了同款措辭的實際分布**。經對 `tasks.md` 全檔 `grep "CRLF"` 逐行分類，同一方向性錯誤——斷言「CRLF 全檔保留（N 行／CRLF 段、0 bare LF）」，實則量到本機 `core.autocrlf=true` 之 checkout smudge 產物，而該 draft 之 git blob 為 **0 CRLF／純 LF**——尚存在於下列 **14 處 `tasks.md` 行**（皆為 wave 各 task 對 `drafts/*.dc.html` 編輯之歷史 PASS 記錄，289b913 未提及）：

| tasks.md 行 | task | tasks.md 行 | task |
|---|---|---|---|
| 34 | 3.6 | 47 | 4.9 |
| 39 | 4.1 | 48 | 4.10 |
| 40 | 4.2 | 52 | 4.14 |
| 41 | 4.3 | 53 | 4.15 |
| 44 | 4.6 | 54 | 4.16 |
| 45 | 4.7 | 60 | 5.2 |
| 46 | 4.8 | 64 | 5.6 |

- **根因與 :425／:487／:513／`tasks.md:69`／`:72` 同一**：兩份 draft 之 git blob 皆純 LF——`git cat-file -p HEAD:"…v2-draft.dc.html" | tr -cd '\r' | wc -c` ＝ `0`（主 draft 817 行、Hi-Fi draft 973 行）；工作目錄 `tr -cd '\r'` 顯示 817／973 CR 係 checkout 暫態（`.gitattributes` 僅 `*.sh eol=lf`，`.dc.html` 走 `core.autocrlf` smudge），非入庫內容。
- **完整 out-of-scope 集合（供後續 wave 一次清理、避免再度低估）**：上列 14 處 ＋ 289b913 已揭露之 `tasks.md:55`（Hi-Fi 973）／`tasks.md:65`（主 draft 818）／`assembly-verification.md:228`（task 5.2，766 行）＝ 共 **17 處**未回改之同款措辭。另 `tasks.md:49` 已附**計數**更正註記（762→761，方向未翻）；已就地翻正方向者＝`tasks.md:69`（88653cc 同款）／`:72`（289b913）／`assembly:425`（6.1）／`:487`、`:513`（本節 J2）；`tasks.md:20/21` 之「含 CRLF」係 delta/main header 逐字比對斷言、非行尾保留斷言，不屬同款、不計入。本清單以 `tasks.md` 全檔 grep 為據、核驗涵蓋上述兩份 draft blob（該 14 處斷言對象皆此二檔）。
- **處置**：此 14 處為審計軌跡中的措辭方向錯誤，**不影響**各 task 實質編輯正確性（div/span 標籤配對、內容置換均有效、carve-out 迴歸皆 PASS）；比照 gap-fix 先例不回改原文 PASS 記錄，統一揭露於此，留待後續 wave 視需要一次清理。

---

### 附記（fixer gap-fix，2026-07-19）：c90ebd8「完整 out-of-scope 集合」方法論訂正——grep 範圍擴及整個 change 目錄（17→18）

> 比照 6.1（:425）／task#7（88653cc）／J2（:487、:513）／task#10（c90ebd8，:521 起）gap-fix 先例：**新增更正記錄、不回改各原文 PASS／證據斷言**（append-only，存審計軌跡）。本附記僅訂正上一則附記（c90ebd8 於 :526／:538 所立「完整 out-of-scope 集合」）之**方法論範圍**與**計數**，未觸及 `recovered-requirements.md:127` 等任何原文行。

c90ebd8 於 :538 宣稱之「完整 out-of-scope 集合＝共 **17 處**」係**僅對 `tasks.md` 全檔 grep** 導出（:526「經對 `tasks.md` 全檔 `grep "CRLF"` 逐行分類」、:538「本清單以 `tasks.md` 全檔 grep 為據」）——**方法論本身低估**：grep 範圍未涵蓋 change 目錄其餘檔案，因而漏掉一處同族方向性錯誤。

- **訂正後方法論**：改對**整個 change 目錄** `grep -rn CRLF openspec/changes/doc-first-canon-v2/`——命中 **4 檔／29 處**：`tasks.md`（21）／`assembly-verification.md`（6）／`recovered-requirements.md`（1）／`crosswalk.md`（1），非僅 `tasks.md`。
- **新增第 18 處（c90ebd8 漏列）**：`recovered-requirements.md:127`（task 5.6，`4041ce7` 撈回）證據註腳「CRLF 全檔保留（806 行、0 bare LF）」——與 :425／:487／:513／:538 同一方向性錯誤：該處量到本機 `core.autocrlf=true` 之 checkout smudge 產物，實則主 draft git blob 為**純 LF／0 CRLF**。獨立核驗：`git cat-file -p 4041ce7:"…前後端設計文件.v2-draft.dc.html" | tr -cd '\r' | wc -c` ＝ `0`（該 blob 806 行），工作目錄 checkout `tr -cd '\r'` ＝ `817`（smudge 暫態）；806 行落在主 draft 766（:228，task 5.2）→817（:513，最終）之行數時間序內合理，屬真陽性。**共 17 → 18 處**未回改之同款措辭。
- **`crosswalk.md:78`（第 4 檔 CRLF 命中）分類＝不計入**：該行係 gap-ledger 變更歷史表列（item 15）之 **commit 描述**「`eaeff4b`（fix：citation 歸屬＋CRLF 計數矯正）」，屬對某修正 commit 的摘述、**非**「CRLF 全檔保留（N 行、0 bare LF）」型之行尾保留方向性斷言，不屬同款、不計入（比照 :538 對 `tasks.md:20/21`「含 CRLF」逐字比對句之同款排除理由）。
- **`assembly-verification.md` 自身 6 處 CRLF 命中已全數涵蓋、無新漏**：`:228`（task 5.2，已計入上列 17→18 之基數）／`:425`（6.1）·`:487`·`:513`（J2）三處早已就地翻正方向／`:525`·`:538`（c90ebd8 前註本文）＋本附記——無新增未揭露之同款斷言。
- **處置**：`recovered-requirements.md:127` 該處為審計軌跡中的措辭方向錯誤，**不影響** task 5.6 撈回實質正確性（三值判定、採納計數 11/2、carve-out §3 七項 PASS 均不受行尾量測方向影響）；比照 gap-fix 先例**不回改** :127 原文證據行，統一揭露於此，與前列 17 處併為 **18 處**留待後續 wave 一次清理。修正後 `npx openspec validate doc-first-canon-v2 --strict` 綠。

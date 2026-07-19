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

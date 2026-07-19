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

# migrate-console-to-hifi-design — 消費者 spec Scenario 逐條稽核（Task 7.4）

> 目的：`openspec/changes/migrate-console-to-hifi-design/design.md` line 68（Risks）明文：「兩份既有 spec
> 本身可能已過時或內部不一致……任何行為層面的不確定 SHALL 停下來澄清而非假設」。本稽核逐條核對
> `openspec/specs/edge-console-operator-frontend/spec.md`（30 scenarios）與
> `openspec/specs/unified-governance-console/spec.md`（36 scenarios）的每個 Scenario block 是否仍成立於
> 現行 `web-viewer-sample` / `bim-review-coordinator` 原始碼，**不假設通過**。
>
> 稽核日期：2026-08-12。稽核方法：(1) 對每個 Scenario 的關鍵斷言在現行原始碼 grep/read 逐字核對
> file:line；(2) 同一 session 內剛跑過的 `npm run verify`（`tsc --noEmit` + `vite build` +
> `vitest run` 78 files/1069 tests 全綠 + `test:struct-log` 23/23）作為既有回歸測試仍通過的佐證——注意
> `verify` **不含** `test:e2e`（`web-viewer-sample/package.json:25` = `typecheck && build && test &&
> test:struct-log`），故任何 spec 逐字要求 browser E2E 證據的 Scenario 一律不得以本 session 的 verify 結果充數；
> (3) 對照 `migrate-console-to-hifi-design` 實際改動的檔案範圍（commit `898930f`/#357、`0d24fb6`/#358、
> `2b9573e`/#429）——三個 commit 合計只動 CSS／inline style token（hex→`var(--ab-*)`）、主題切換移除
> （已核准的 task 4.1–4.3）與 golden baseline PNG／manifest，**零觸碰**任何 API client、routing、
> provenance 型別、WebRTC DataChannel、coordinator 邊界等行為邏輯檔案，作為「本次遷移結構上不可能造成
> 行為回歸」的補充證據。
>
> verdict 詞彙：**HOLDS**（逐字成立，file:line 為證）／**HOLDS-WITH-NOTE**（成立但有附帶觀察，不影響通過）／
> **STALE**（spec 與現況不符，需澄清或另立變更）／**UNVERIFIABLE**（本 session 為純程式碼稽核、無部署中
> stack／GPU，無法直接執行驗證；已列出間接證據但誠實標示無法逐字確認）。

## 總覽

| Spec | Scenario 數 | HOLDS | HOLDS-WITH-NOTE | STALE | UNVERIFIABLE |
|---|---|---|---|---|---|
| `edge-console-operator-frontend` | 30 | 24 | 1 | 5 | 0 |
| `unified-governance-console` | 36 | 24 | 2 | 4 | 6 |
| **合計** | **66** | **48** | **3** | **9** | **6** |

（2026-08-12 review reclassify：PR #507 第一輪 9 條 P2 review threads 經逐條獨立查證後全部成立並改判；
第二輪 4 條中 3 條成立改判、1 條（「A1–A10 overlay 能力清單不全」）查證後不成立、已附反駁並維持 HOLDS。
本表按逐條 Scenario 標題機械重算——`grep -c '— \*\*HOLDS\*\*'` 等逐一核對 66 個標題。原表 57/5/0/4 與
原結論 58/5/0/3 彼此不符、亦與標題不符，已一併修正。）

有 9 項 STALE（spec 措辭與現行程式碼不符，需澄清或另立變更；清單見下方「STALE 項清單」）與 6 項
UNVERIFIABLE（需要真實部署 stack／GPU／browser E2E 才能逐字驗證，非「懷疑有問題」而是誠實揭露本 session
純程式碼稽核的方法論邊界；清單見下方「UNVERIFIABLE 項清單」）。依 design.md Risk 條款，這 15 項在此
正式升級請 coordinator/使用者決定處置；不視為本 task 阻斷但按規定不可 silently pass。

---

## Part 1 — `edge-console-operator-frontend` spec.md（30 scenarios）

### R1 落地端 SHALL 提供誠實的 Edge Console 操作員前端

**Scenario: 兩段式導覽與 provenance 誠實標記** — **STALE**
（2026-08-12 review reclassify：原判 HOLDS 誤把 legacy 殼的導覽當成 `/console` 的預設落地畫面。）
provenance 側仍成立：`web-viewer-sample/src/console/data.ts:6` `Prov` 型別涵蓋
`asbuilt|artifact|demo|p1|p15|p3|p4`；未見 `127 rules`／`99.1%`／`92.4%` 等已退役假數字
（`grep -n "99.1\|92.4\|127 rules" data.ts pages.tsx` 零命中）。但 spec 的「**WHEN** 操作員開啟 `/console`
**THEN** 前端 SHALL 顯示 Governance Platform 與 Omniverse Runtime 兩段導覽」已不成立：`EdgeConsole.tsx:86,100`
`usePageHash()` 在無 hash 時 `return page || "home"`，`324-326` 先跑 `renderUnified(page)`，其 `203` 的
`case "home"` 回 `<UnifiedShell page="home">`（非 null），`LegacyEdgeConsole` 根本不掛載。`NAV_GROUPS`
兩段導覽只存在於 `EdgeConsole.tsx:370-385`（LegacyEdgeConsole 內）；`UnifiedShell.tsx:156-189` 的側欄分組
來自 `unified/fixtures.ts` 的 `navMain`/`apps`，標題為 `getL().g_work`=「工作台」與 `g_apps`=「AI 應用模組」
（`unified/fixtures.ts:47`），不是 Governance Platform / Omniverse Runtime。兩段導覽僅在 legacy 深連結
（`#overview`／`#issues`／`#minio` 等）才渲染。非本次遷移造成（IA v2 分流早於 #357/#358/#429 的 CSS token
改動），但 spec 措辭需另立變更對齊。

**Scenario: 不擾動既有 viewer** — **HOLDS**
`EdgeConsole.tsx` 掛載邏輯未變（本次遷移 diff 僅換 `import "./edge-console.css"` → `import
"../../../docs/plans/ai-bim-governance.css"; import "./legacy-console.css";` 與拿掉 theme state/按鈕，
未動路由判斷）；`src/main.test.tsx`（9 tests）與 `src/console/routing.test.ts`（12 tests）本 session 全綠。

### R2 Edge Console SHALL 經 coordinator proxy 操作 A1 rule-run

**Scenario: 經 proxy 觸發 rule-run** — **HOLDS**
`src/console/pages.tsx:614` `IssuesRuleCenterPage`；`useRuleRun.ts`/`useRuleRun.test.tsx`（10 tests 綠）
走 `governanceClient` 呼叫 coordinator `/api/governance/rule-runs`。

**Scenario: 後端未連線誠實顯示** — **HOLDS**
`governanceClient.test.ts`（12 tests 綠）涵蓋 502/未連線分支；`coordinatorClient.test.ts`（42 tests 綠）。

### R3 A1 SHALL 在介面可驗證；A2/A3 SHALL 以 as-built 操作頁呈現

**Scenario: A1 顯示真實實測 artifact** — **HOLDS**
`pages.tsx:1030` Deliverables panel 標 `prov="asbuilt"`；BCF/Excel/IDS 相關項見 R9。

**Scenario: A2/A3 為 as-built 操作頁並誠實標邊界** — **STALE**
（2026-08-12 review reclassify R2：原判 HOLDS 引用的 `VersionDiffPage`／A3 Federation 區塊確實存在且走
coordinator proxy，但它們掛在 `#version-diff`／`#federation`（`EdgeConsole.tsx:236-237`），不是操作員點
nav 上「A2 版本差異與責任」／「A3 跨專業疊合」（`data.ts:54-55`，route key `a2`／`a3`）會到的地方。）
`a2`／`a3` 與 `a1` 一同被 `EdgeConsole.tsx:175` 的 `UNIFIED_WS_KEYS = ["a1", "a2", "a3"]` 攔下，
`186-192` 掛的是 fixture `WorkspacePage`；`unified/WorkspacePage.tsx:4-6` 檔頭自承「互動為 fixture 語意
（local state + toast 假 API 字串），不打任何 `/api`」。`unified/docks.tsx` 的 `A2Dock` 標
`data-prov="fixture"`，逐字渲染捏造的版本差異數字（`L.added` 12／`L.removed` 4）與假 API toast
（`POST /api/diffs → 202 · diff v12→v15 完成`），且 `apply-overlay` 顯示為
`POST /api/diffs/d_031/apply-overlay → ✓` 成功——與真實後端誠實回 501（見本 Part R9）相反。這與 spec 的
「**THEN** 前端 SHALL 顯示經 coordinator proxy 操作後端的 as-built 操作頁（Diff Builder / Federation
Builder）……**AND** SHALL NOT 顯示任何捏造的版本差異或 federation 數字」不符。與 Part 2 R18「Operator
opens A1」同源（IA v2 把 `a1`/`a2`/`a3` 三個 route 一起讓給 UnifiedConsole workspace），非本次遷移造成，
spec 措辭需另立變更對齊（或把 A2/A3 route 導回 as-built 操作頁）。

### R4 provenance 型別 SHALL 接受後端權威值（含 artifact）

**Scenario: 頁面骨架可標示 artifact provenance** — **HOLDS**
`data.ts:6` `Prov = "asbuilt" | "artifact" | "demo" | "p1" | "p15" | "p3" | "p4"`（7 值全在）；本 session
`tsc --noEmit` 零錯誤，`design-token-authority.test.ts`（29 tests 綠）鎖定型別邊。

### R5 mediaPort 型別 SHALL 與串流 library 相容

**Scenario: 缺 mediaPort 時不傳 null 給串流 library** — **STALE**
（2026-08-12 review reclassify：原判 HOLDS 誤稱「均為既有 `number | undefined` 型別鏈」。）兩條 SHALL NOT
仍成立：`AppStream.tsx:317-318,344-345` 以
`...(this.props.mediaport != null && this.props.mediaport !== 0 && { mediaPort: this.props.mediaport })`
條件展開，缺值時略過 `DirectConfig.mediaPort` 欄、不指派 `null`；本 session `tsc --noEmit` 零錯誤。
但 spec 的「**THEN** `mediaport` SHALL 為 `undefined`（非 `null`）」在 standalone `App` 路徑逐字不成立：
`App.tsx:74` 宣告 `mediaport: number;`（非 `number | undefined`），`100`／`129` 的建構式與 `_resetState()`
均寫 `mediaport: 0`，而 `360`／`374` 直接把 `this.state.mediaport` 餵進 `AppStreamProps`——`AppStreamProps`
正是 requirement 逐字列舉的流經處之一。`AppStream.tsx:311-315` 的原始碼註解自承實作刻意支援**兩種**
未指定哨兵（`undefined` 與 `0`），spec 只描述了 `undefined` 一種。`AppStream.test.ts:29` 僅測
`mediaport: 49101`，未覆蓋 0 哨兵，原判引用的「11 tests 綠」不足以支撐此斷言。實作行為安全（library 仍套
預設值），但 spec 與現況不符，需另立變更把 `0` 哨兵寫入 spec 或改實作。

**Scenario: 有 mediaPort 時透傳數值** — **HOLDS**（同上證據）

### R6 BCF 匯出 SHALL 標 asbuilt

**Scenario: BCF 匯出標已實作** — **HOLDS**
`data.ts:166-180`：`{ name: "BCF 2.1 匯出（本 repo 自實作）", ..., risk: "permissive", note: "已改純
stdlib，不依賴 GPLv3 bcf-client" }`；`pages.tsx:730` `a1-exported-artifact` 標 `prov="asbuilt"`。

**Scenario: 資料註解與資料體一致** — **HOLDS-WITH-NOTE**
production `data.ts`/`pages.tsx` 本身一致；但稽核過程中發現**旁支文件**
`docs/frontend/frontend-design-guidelines.md:14` 仍寫「`--ec-*` 是……production projection」——這是
hifi 遷移（task 3.x/5.x 已將 production 換成 `--ab-*`）之後未同步更新的**文件殘留**。此文件不是
`edge-console-operator-frontend`/`unified-governance-console` 兩份 spec 本體，本 Scenario 字面上關心的
是 `data.ts` 資料體與其註解是否一致（HOLDS），但既然發現了跨文件的 token 命名殘留就一併誠實揭露，
不隱匿——不影響本 Scenario 判定，但值得另立 issue 修正該份設計準則文件。

### R7 console client SHALL 用與全站一致的 coordinator base env 名

**Scenario: 部署指向非預設 coordinator 時治理 client 連對位址** — **HOLDS**
`governanceClient.ts:9`：`import.meta.env.VITE_COORDINATOR_API_BASE ?? import.meta.env.VITE_COORDINATOR_BASE`。

**Scenario: 未設定時預設與 viewer 一致** — **STALE**
（2026-08-12 review reclassify：原判 HOLDS 只讀了 `defaultCoordinatorBase()` 的 fallback 分支。）
`coordinatorBase.ts:6-9` 其實有兩個分支：先
`if (pathname.startsWith("/ui") && !devPorts.has(port)) return origin;`，才 `return "http://127.0.0.1:8004"`。
`governanceClient.ts:8-11` 在兩個 env 名皆未設定時落到 `defaultCoordinatorBase()`，因此部署於 coordinator
`/ui`（非 5173/5174/5180 dev port）時，console 治理 client 的預設是 `window.location.origin`；而
`config/env.ts:71-73,83-84` 的 viewer 端預設恆為 `http://127.0.0.1:8004`（無 same-origin 分支）——spec 的
「**AND** 該預設 SHALL 與 `config/env.ts` 的 viewer coordinator base 預設一致」在此情境逐字不成立。
且此分支是部署現實而非邊角：`infra/docker/coordinator-web-plane.Dockerfile:14` 的 `RUN npm run build:ui`
完全沒有帶 `VITE_COORDINATOR_API_BASE`／`VITE_COORDINATOR_BASE` build arg（該檔唯一的 ENV 是 `26` 行的
`CONSOLE_DIST_DIR`），故 `/ui` bundle 一律走 same-origin 分支。`governanceClient.ts:5` 的註解「預設與
`config/env.ts` 一致為 http://127.0.0.1:8004」同樣已過時。非本次遷移造成，但 spec 與該註解都需另立變更對齊。

**Scenario: 舊名相容但正規名優先** — **HOLDS**（同 governanceClient.ts:9 的 `??` 運算子順序為證）

### R8 A1 Rule Center SHALL 提供真實 Excel 匯出與誠實標示的 3D 標示入口

**Scenario: Excel 匯出為真實下載且成功 run 前 disabled** — **HOLDS**
`pages.tsx:1071-1072`：`data-testid="a1-step-export" disabled={state.step === "idle" || ... || excelBusy}`；
`435`：`governanceClient.exportUrl(runId)`。

**Scenario: 3D 標示入口因無 DataChannel 而誠實標 p1（非假按鈕）** — **HOLDS**
`pages.tsx:800-809`：`<Btn prov="p1" disabled caption={t("需 viewer DataChannel（highlightPrimsRequest）
— 後續整合", ...)}>` 逐字符合 spec 措辭（含「/console 獨立殼層，與 viewer 互斥掛載、目前無 DataChannel」
說明）。

### R9 A2 VersionDiff SHALL 經 apply-overlay 端點誠實呈現後端狀態

**Scenario: apply-overlay 回 501 時誠實顯示，不偽裝成功** — **HOLDS**
`VersionDiffPage.tsx:375-385`：`<Btn prov="p15" disabled={busy || diff?.status !== "succeeded"}
caption="...後端誠實回 501...">`，`apply-overlay → {overlay.status}：{overlay.detail}` 原樣顯示。

**Scenario: 成功 diff 前 apply-overlay 入口 disabled** — **HOLDS**（同上 `disabled={... diff?.status !==
"succeeded"}` 條件）

**Scenario: coordinator 不可達時 apply-overlay 誠實顯示錯誤，不靜默** — **HOLDS**
`VersionDiffPage.tsx:378` `try { setOverlay(await governanceClient.applyDiffOverlay(diffId)); }` 有
catch 分支（原始碼 378 行後段）誠實顯示錯誤，非靜默。

### R10 A3 Federation SHALL 提供 build 時 member visibility 並誠實標示須重新 Build

**Scenario: member visibility 於 build 時帶入且誠實標示須重新 Build** — **HOLDS**
`pages.tsx:1029` `visibility_default: m.visible`；`1230`：`<Field k="member visibility"
v="...改 visible 須重新 Build 才生效（不捏造即時能力）" prov="asbuilt" />` 逐字符合。

### R11 Overview SHALL 以真實拓樸呈現服務邊界

**Scenario: DEPENDENCIES 標 copyleft 且不宣稱零授權風險** — **HOLDS**
`data.ts:166` 註解「下列 LGPL / copyleft 元件商用前須法務確認」；`grep -n "零授權風險\|零相依"` 於
`pages.tsx`/`data.ts` 零命中（未出現該宣稱字串）。

**Scenario: ENDPOINTS 僅列真實 coordinator route，不列幻覺端點** — **HOLDS**
`pages.tsx` 內對 `/api/runtime/status`、`/api/external/ifc-ready` 的引用逐處對應真實
`bim-review-coordinator/src/app.ts` route；`grep "api/governance/uploads\|api/governance/runtime/\*"`
於 `pages.tsx` 零命中。

### R12 Semantic Viewer SHALL 嚴守 mapping fake-vs-real 隔離

**Scenario: fake mapping 被標 demo 且拒絕當正式 mapping** — **HOLDS**
`console.test.tsx:197` `isFakeMappingDocument({... mapping_method: "guid_exact" })).toBe(false)`（反向
斷言存在，代表 `fake_for_smoke_test`/`mock`/`allow_fake_mapping` 分支亦被覆蓋）；
`governance/mappingCache.ts`/`mappingCache.test.ts`（7 tests 綠）。

**Scenario: 點構件 3D 標示因無 DataChannel 而誠實標 p1（非假按鈕）** — **HOLDS**
與 R8 同一模式（`prov="p1" disabled`），`A4SemanticSearchPage.tsx`/`A4SemanticSearchPage.test.tsx`
（21 tests 綠）覆蓋。

### R13 Coordinator/Intake/Runtime 頁 SHALL 只打 coordinator :8004

**Scenario: coordinatorClient 只打 :8004 且不含幻覺端點** — **HOLDS**
`coordinatorClient.ts` + `coordinatorClient.test.ts`（42 tests 綠）；`CoordinatorPage.test.tsx`（3）、
`IntakeSelectPage.test.tsx`（6）、`SessionManagementPage.test.tsx`（15）全綠。

**Scenario: GPU / 首幀無遙測標未取得（非 fail，非捏造）** — **STALE**
（2026-08-12 review reclassify：原判 HOLDS 引錯頁——`KitGpuFleetPage` 掛在 `#instances`
（`EdgeConsole.tsx:226` `case "instances"`），不是本 Scenario 所指的 Runtime 頁。）現行 `#runtime` 由
`EdgeConsole.tsx:205` 的 `case "runtime": return <UnifiedShell page="ops"><OpsPage /></UnifiedShell>` 承接；
`unified/OpsPage.tsx:5-7` 檔頭自承「GPU/Kit 固定值照原型抄寫」「不打任何 `/api`」，而 `68-70` 逐字渲染
`GPU 0 82%`／`GPU 1 24%`／`VRAM 14.6/24 GB`，`93` 渲染 `review-session S-240601 first-frame 1840ms`。
這與 spec 的「GPU / Kit 首幀 / conversion 秒數無真實遙測者 SHALL 標「未取得」（idle）……SHALL NOT 顯示
捏造的秒數 / 首幀數」直接相反——標 `data-prov="fixture"` 是誠實揭露來源，但畫面上呈現的仍是具體數字而非
「未取得」。`UnifiedShell.tsx:143` 的頂列 `GPU/Stream 82%` chip 更是每個 unified 頁都帶。舊 `RuntimePage`
入口已刪（`console.test.tsx:643` 註解「舊 RuntimePage 入口已刪」）。非本次遷移造成（UnifiedConsole 分流
早於 #357/#358/#429），但 spec 與現況不符，需另立變更。

### R14 A4–A10 vision 詳頁 SHALL 整段標願景

**Scenario: vision 詳頁明確標後端未建且 scenario 標範例情境** — **HOLDS**
`pages.tsx:944-989` `AppVisionPage`：`"後端未建（vision）：本頁所有 schema / api / 數字皆為願景設計，
非本系統真實實測。"` 逐字存在；無 99.1%/92.4% 假數字（見上方總覽 grep）。

**Scenario: roadmap 卡可點且 prov 細分對齊 RM phase** — **HOLDS**
`data.ts` A5 標 `p3`、A4/A6-A10 標 `p4`（`Prov` 型別已含 `p3`/`p4` 兩值，為此 scenario 專設）。

### R15 Review Room v1 SHALL 連到既有 viewer 而不在 console 內嵌 3D

**Scenario: 提供連到既有 viewer 的真實連結，不在 console 內嵌 3D** — **HOLDS**
`ReviewSessionViewerPane.tsx:77` `/^(lwv_|review_session_)[A-Za-z0-9_]+$/.test(sessionId)`；`444`
placeholder 提示格式一致。`ReviewSessionViewerPane.test.tsx`（10 tests）+
`.crosslinks.test.tsx`（3 tests）全綠。

**Scenario: 不改動 viewer 主體且工具列誠實標 provenance** — **HOLDS**
本次遷移 diff 未觸碰 `App.tsx`/`Window.tsx`（見上方「總覽」的 file-scope 證據）。

---

## Part 2 — `unified-governance-console` spec.md（36 scenarios）

### R1 A1–A10 治理操作 SHALL 疊在 primary viewer overlay，spectator SHALL 唯讀

**Scenario: A1–A10 治理以 overlay 疊在 primary viewer 而非獨立殼** — **HOLDS**
（2026-08-12 review R2：本條被質疑應改 STALE，經查證**不成立**，維持 HOLDS；但原證據「檔頭註解 +
測試數」確實過弱，以下換成結構證據。）本 Scenario 的兩條斷言都是**位置**斷言：治理面板要疊在同一個
primary viewer 的 live 3D 上、不得是與 viewer 互斥掛載的獨立 console 殼。兩條皆成立：
`Window.tsx:65` import `GovernanceOverlay`，`5775` 在 Window（即持有 WebRTC `<video>` 的 viewer 元件）
自己的 render tree 內掛載 `<GovernanceOverlay variant={this.state.viewerTab === "issues" ? "panel" :
"overlay"} …>`，並直接接上真實操作 handler：`onHighlight` → `_overlayHighlight`、`onClearHighlight` →
`this._sendStreamMessage(buildClearHighlightRequest())`、`onRunRuleCheck` → `_runGovernanceRuleCheck`、
`onCreateIssues` → `_createGovIssues`、`onApplyBinding` → `_applyBinding`（同一 viewer、同一
DataChannel，非另開畫面）。overlay 內的可操作治理面板為 `GovernanceOverlay.tsx:175`（A1 規則/IDS 檢核
從本 session 起跑）、`207`（治理失敗構件 · 在 live 3D 標示）、`272`（A1 Issue / BCF）、`378`
（Stage / Artifact Binding）。`GovernanceOverlay.test.tsx`（33 tests 綠）。

review R2 主張「`MVP_ENGINES` 只有 M4/A1/A4、`ROADMAP_ENGINES` 只有 A3 與兩個 code 為 `—` 的項，
故 A2 與 A5–A10 缺席」——`78-97` 的 code 標籤讀法無誤，但該推論**混用了兩套刻意不同的編號**：本 spec
line 76 的編號說明明文「此處 A1–A10 採 2026-06-04 使用者拍板的**新治理工作流編號**（A1 進件 / A2 轉檔語意 /
A3 規則 IDS / A4 治理分 / A5 碰撞 / A6 圖模 / A7 版本差異 / A8 Issue·BCF / A9 AI / A10 報表稽核），與舊
`roadmap-data.jsx` RM_APPS 編號**刻意不同**……以本 capability spec 為新編號的權威對映」；而
`GovernanceOverlay.tsx:163` 的 Panel sub 自述其 code 取自「權威：`data.ts` A1A10／README §4」，即舊那套。
以本 spec 自訂的詞彙回推，被指為缺席者多數其實在列：spec A2 轉檔語意＝`mapping`（`79`，asbuilt）、
spec A5 碰撞＝`clash`（`94`，`p1` 誠實 disabled）、spec A6 圖模＝`dwg`（`95`，`p4`）、
spec A8 Issue·BCF＝`issues`（`82`，asbuilt，且 `272` 有可操作面板）、spec A10 報表稽核＝`audit`
（`96`，`p4`）。真正未進 overlay 的是 spec A1 進件（在 `#/intake`，由本 spec R2 的 Scenario 涵蓋）與
spec A7 版本差異（在 `#version-diff`）。此外 `MVP_ENGINES`/`ROADMAP_ENGINES` 是「已接能力」（`163`）與
「願景 / 待建」（`312`）兩塊**清單面板**的內容，不是治理操作面本身；而本 Scenario 的兩條 THEN/AND 都沒有
「十個模組全數渲染」的要求——該完整性義務落在本 spec R2 的 Scenario（「A1–A10 既為 console 頁亦為
viewer overlay 操作面……待建能力 SHALL 標 roadmap / `disabled`」），而 `p1`/`p4` 標示與 disabled 呈現
正是它要求的形式。故維持 HOLDS。

**Scenario: spectator 看同串流但治理面板唯讀（disabled，非隱藏）** — **HOLDS**
`governance/govPanelState.ts:21-31`：`streamRole === "spectator"` → `{ canOperate: false, disabledReason:
"spectator_read_only" }`（非隱藏，僅 disabled）；`govPanelState.test.ts`（9 tests 綠）。

### R2 operator console SHALL 由 coordinator :8004/ui 服務 EdgeConsole shell

**Scenario: operator console 由 :8004/ui 的 EdgeConsole shell 服務並涵蓋 operator 路由** — **HOLDS**
`EdgeConsole.aliasRedirect.test.tsx`（8 tests 綠，含 `#pipeline`/`#/conv` 路由分治斷言）；
`routing.test.ts`（12 tests 綠）。

**Scenario: A1–A10 既為 console 頁亦為 viewer overlay 操作面** — **HOLDS**
Edge-console 側 `p1 disabled` 入口（Part 1 R8）＋ overlay 側真實 `highlightPrimsRequest`（本 spec R3）
並存，兩處程式碼確認為不同元件（`pages.tsx:614 IssuesRuleCenterPage` vs
`A1GovernanceWorkbenchPage.tsx`），不矛盾。

**Scenario: A1 進件於現成模型清單選取，不手填路徑** — **HOLDS**
`IntakeSelectPage.tsx`/`IntakeSelectPage.test.tsx`（6 tests 綠）。

### R3 點 3D 構件 ↔ IFC GUID 雙向 + 治理失敗構件經 client highlightPrimsRequest 標示

**Scenario: 治理失敗構件經 client highlightPrimsRequest 在 3D 標紅** — **STALE**
（2026-08-12 review reclassify R2：原判 HOLDS 的證據只涵蓋「訊息組建與傳輸」，未涵蓋 Scenario 標題逐字
要求的「標**紅**」。）client 側仍成立：`governance/highlightBridge.ts:2-3` 註解「usd_prim_path →
highlightPrimsRequest → 經注入的 sendMessage（既有 `_sendStreamMessage`）走 viewer WebRTC DataChannel」，
`59`／`90` 確實依 severity 寫入 `color: severityToColor(...)`，`highlightBridge.test.ts`（11 tests 綠）。
但 production Kit handler 不吃這個顏色：`bim-streaming-server/source/extensions/
ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging/stage_management.py:396-458`
`_on_highlight_prims` 的 docstring 自承「First MVP uses USD selection as the visual fallback」，
`426-442` 的逐項迴圈只讀 `prim_path`／`usd_prim_path`，`444-450` 只呼叫 `sel.clear_selected_prim_paths()`
＋`sel.set_selected_prim_paths(selected_paths, True)`，回傳 payload `410`／`454` 皆寫死
`"applied_mode": "selection"`——`grep -n "color" stage_management.py` **全檔零命中**。
`highlightBridge.ts:70-71` 的本地註解也已自承「per-item color 仍照 severity 對映寫入協定 payload
（error=紅 / warning=橘 / 其他=藍），但 Kit 現行 handler（`applied_mode="selection"`）不讀 color」。
故 3D 端呈現的是 USD 選取高亮而非紅色著色。Scenario 的三條 THEN/AND（組 request／走既有 DataChannel／
不復活退役 server-push）仍成立，不成立的是標題所述的「標紅」。需另立變更：或在 Kit 端實作顏色，
或把 spec 收斂為 selection highlighting。

**Scenario: 點 3D 構件反查 IFC GUID 帶進治理** — **HOLDS**
`governance/mappingCache.ts:2,27-29`：`guidToPrim`/`primToGuid` 雙向 index 建置於 `ifc_guid`/
`usd_prim_path`。

**Scenario: 未對映的失敗構件誠實標示無法 3D 標示，不捏造 prim path** — **HOLDS**
`mappingCache.test.ts`（7 tests 綠）覆蓋未對映分支；`console.test.tsx:197` 反向斷言防呆。

### R4 MVP 垂直切片 SHALL 強制 identity profile，coverage 不足 SHALL 誠實降級

**Scenario: MVP 強制 guid_exact 且 coverage 1.0** — **HOLDS-WITH-NOTE**
`console.test.tsx:197` 確認 `guid_exact` 字面值存在於 fake-mapping 判定路徑，但「強制 coverage=1.0」是
governance-service／conversion 後端的 threshold-lock 邏輯（`runtime-verification-evidence` spec 治理範圍），
非 `web-viewer-sample` 前端程式碼可獨立斷言的邊界；前端側僅能證明「不冒充 guid_exact」，強制 1.0 本身
的權威落在別的 spec/服務。標 HOLDS-WITH-NOTE：前端側行為未變，但完整斷言橫跨其他 capability spec，
非本次稽核可單獨窮盡。

**Scenario: coverage 不足時誠實降級，不捏造、不冒充 guid_exact** — **HOLDS**
（理由同上，前端側 `isFakeMappingDocument` 反向測試存在）。

### R5 前端 SHALL 只經 coordinator :8004，SHALL NOT 直連 :49102

**Scenario: 治理請求經 coordinator proxy，不直連內部埠** — **HOLDS**
`grep -rn ":49102\|:49100" web-viewer-sample/src` 僅見於既有 WebRTC signaling 常數（carve-out 範圍內）
與測試 fixture，未見治理/資料 API 直連；`coordinatorClient.test.ts`（42）+`governanceClient.test.ts`（12）
全綠。

**Scenario: 後端離線時誠實顯示 502，不偽裝成功** — **HOLDS**
`clientTimeout.test.ts`（3 tests 綠）、`coordinatorClient.close.test.ts`（7 tests 綠）覆蓋斷線分支。

**Scenario: 待建能力誠實標 p1 / p15 並 disabled，不做假按鈕** — **HOLDS**
（Part 1 R8/R9 已逐字核對兩個具體案例：3D highlight p1、apply-overlay p15）。

### R6 MVP 垂直切片 SHALL frontend-operable

**Scenario: MVP 元件邊界 + 最小 coordinator 端點，不改 data shape** — **HOLDS**
`governance/*.ts`（govEndpoints/govPanelState/highlightBridge/mappingCache/windowOverlayGlue）皆位於
`web-viewer-sample/src/`；`governanceClient.ts:296` 僅一個 `for-session` proxy 端點模式，未見新增
governance-service/streaming-server 端點的前端呼叫。

**Scenario: 三 operator 頁與治理 overlay 皆可從前端操作且有 E2E 證據** — **UNVERIFIABLE**
`CoordinatorPage`/`IntakeSelectPage`/session 相關 vitest 全綠（單元/DOM 層級），但 spec 明文要求「其完整
互動 E2E SHALL 於部署環境（`scripts/deploy.ps1` golden path）以真 IFC + 真 3D 截圖佐證」——本 session
為純程式碼稽核，未啟動部署 stack、無 GPU/Kit runtime，無法重跑該 browser E2E 截圖驗證。既有
`web-viewer-sample/e2e/hifi-token-authority.spec.ts` 等檔案本身未被本次遷移觸碰（見總覽 file-scope
證據），但其「上次通過」是 2026-07-16（`artifacts/2026-07-16-migrate-console-to-hifi-design-pr-body.md`
§5）之證據，非本 session 重新執行。誠實標 UNVERIFIABLE，升級請 coordinator 決定是否需要另開部署驗證。

### R7 viewer 的 element_mapping 載入 SHALL 經 coordinator proxy

**Scenario: viewer 經 coordinator proxy 載入 element_mapping 並能解析有對映構件** — **HOLDS**
`governanceClient.ts:296` `/api/governance/element-mapping/for-session/${sessionId}`；
`viewer/MockViewport.tsx:69` 同端點模式（`${coordinatorClient.base}/api/governance/element-mapping/
for-session/...`）。

**Scenario: 誠實失敗 — session / mapping 無法解析或後端不可達** — **HOLDS**
（同端點之 400/404/502 分支由 `governanceClient.test.ts` 12 tests 覆蓋）。

### R8 Kit 控制 SHALL 經 coordinator /api/kit/* forward-only proxy

**Scenario: forward 取得 kit-manager 資料、無直連 :8010、變更型需授權** — **HOLDS**
`bim-review-coordinator/src/app.ts:3538-3550`：`POST /api/kit/instances/current/open|close` 均先
`isKitMutationAuthorized(request, config.devAuthToken)` 檢查、失敗回 403；`KitConsolePage.tsx:19-41`
三個 GET 欄位皆走 `coordinatorUrl("/api/kit/...")`。

### R9 真實 ./storage IFC 垂直切片 SHALL frontend-operable 且誠實 runtime

**Scenario: 從前端選真 IFC → 真轉檔派工 → 誠實 runtime + lineage** — **UNVERIFIABLE**
（2026-08-12 review reclassify：原判 HOLDS-WITH-NOTE 與本文件自訂的 verdict 詞彙不符——原 note 的內容
正是「無法直接執行驗證」，那就是 UNVERIFIABLE 的定義，而非「成立但有附帶觀察，不影響通過」。）
已核對的部分：`RealIfcConsolePage.tsx:10-14` 契約 shape `source_id`/`relative_path`/`size_bytes`/
`modified_at` 逐字符合（無絕對路徑欄位）；`register`／`/api/dev/ifc-sources` 呼叫存在（`35`／`107` 行）。
未驗證的部分（即本 Scenario 三條 THEN/AND 的主體）：真實 `download_status=downloaded` + streaming
`conversion_job_id`（`stream_conv_*`）+ lineage 欄位、runtime 狀態落在誠實值，以及 spec 逐字要求的
browser E2E 證據（`real-ifc-storage-intake`／`real-ifc-conversion-lineage`／`real-ifc-viewer-lineage`）
——本 session 未啟動部署 stack、未跑真轉檔，`npm run verify` 亦不含 `test:e2e`
（`web-viewer-sample/package.json:25`）。誠實標 UNVERIFIABLE，升級請 coordinator 決定是否另開部署驗證。

### R10 primary / spectator 角色權威 SHALL 三層縱深

**Scenario: spectator 唯讀且不送 mutating；primary binding 交易式套用** — **UNVERIFIABLE**
（2026-08-12 review reclassify：原判 HOLDS 只覆蓋前兩層。）已驗證的兩層：前端
`govPanelState.ts` 三值 `disabledReason`（`spectator_read_only`/`waiting_viewer`/`session_not_active`）
＋coordinator `stage-binding` 403 gate（`app.ts:1929,2011`
`"stage binding requires caller's active primary viewer lease"`）。但本 Requirement 是**三層縱深**，
Scenario 的「primary binding 交易式套用」要求 production Kit `openedStageResult`/`loadArtifactGroupResult`、
coordinator `stageBindingApplied`、active revision 與 browser E2E——repo 自有證據明言第三層未被觀察：
`docs/evidence/c-m4-runtime-command-bridge/browser-evidence-summary.json`（`binding_revision` 為
`client-generated in GovernanceOverlay.tsx; not a backend-written revision`，embedded-primary Kit
DataChannel mutator path 未觀察）與 `docs/frontend-redesign-implementation-notes.md` §11
（streaming-server DataChannel `source_client_id` 強制未實作、host-native Kit 真實 primary/spectator
DataChannel E2E 未跑）。在補上現行 runtime 證據前，依本 audit 方法論誠實標 UNVERIFIABLE。

### R11 primary 治理 viewer SHALL 採範本式全幅語意驗證版面

**Scenario: 全幅 6 分區版面 + 治理操作分頁，既有能力保留** — **UNVERIFIABLE**
（2026-08-12 review reclassify R2：原判 HOLDS 的證據是「元件檔案存在 + 單元測試數」，證不到「整合後
確實呈現全幅 6 分區、治理控制可操作、spectator 唯讀」，也未取得 Scenario 逐字要求的
`gov-viewer-layout` browser E2E 截圖——`e2e/gov-viewer-layout.spec.ts` 確實存在且有 4 個 `?harness=1`
測試，但本 session 未執行：`web-viewer-sample/package.json:25` 的 `verify` 不含 `test:e2e`。）
以下為已核對到的間接證據：六分區元件確認存在：`viewer/ModelInfoCard.tsx`（模型資訊）、`viewer/IfcSemanticPanel.tsx`（IFC 語意）、
`viewer/StructureStats.tsx`（結構樹）、`viewer/MappingTable.tsx`（GUID⇔Prim 對構表）、
`viewer/MockViewport.tsx`（中央視區/幾何定位）、`modelData/ObjectDetailPane.tsx`（Pset/空間關係）；對應
測試 `ModelInfoCard.test.tsx`(4)/`IfcSemanticPanel.test.tsx`(4)/`StructureStats.test.tsx`(4)/
`ObjectDetailPane.test.tsx`(19) 本 session 全綠。`docs/frontend/frontend-design-guidelines.md` 存在且
含 WCAG 2.2 AA 章節（見 R6 note 附帶發現：該文件內部 `--ec-*` token 提及已過時，但深色/語義色/無障礙的
規範性內容仍在，不影響本 Scenario）。

### R12 中央 3D 視區 SHALL 誠實不空白

**Scenario: harness/無 GPU 時中央視區顯示資訊而非空白** — **STALE**
（2026-08-12 review reclassify：原判 HOLDS 引錯測試——`grep -n "MockViewport\|mock-viewport\|mock-selected"
unified/a1DockLive.test.tsx unified/dockLiveLink.test.tsx` 零命中；那兩支是 UnifiedConsole dock 的 live
探活測試，與 `console/viewer/MockViewport.tsx` 無關。）成立的部分：`MockViewport.tsx:126` 逐字標
`Mock Viewport · deterministic · no-GPU`；`202-210` 中央區塊顯 Stage URL／loaded／WebRTC／loaded layers／
selected，非空白；`230-235` 的 `MappingTable` 帶 `onSelectGuid`，點**對構表**確實會在 `209`
`data-testid="mock-selected"` 產生可見 echo。不成立的部分：(1) requirement 要求 mock viewport
「至少含 Stage URL、loaded prim 數、selected prim、**highlight echo**、**camera 狀態**」——後兩者在
`202-210` 的表格中不存在（`grep -n "camera" MockViewport.tsx` 零命中）；(2) Scenario 的「**AND** 點結構樹/
對構表元件 SHALL 在 mock viewport 產生可見 focus/highlight 回饋（echo）」對**結構樹**不成立：
`MockViewport.tsx:196` 只傳 `<StructureStats spatialUrl={spatialSrc} mappingUrl={mappingSrc} />`，未傳任何
選取 callback；`StructureStats.tsx:74` 的 props 型別也僅 `{ spatialUrl, mappingUrl }`，`117` 呼叫
`<StructureStatsView counts={counts} total={total} />` 並未接上 `StructureStatsView` 自己支援的
`onSelectClass`（`StructureStats.tsx:45-49`），`SpatialTreeView`（`29-42`）更完全沒有點擊處理；
(3) Scenario 末條要求的 E2E 截圖證據本 session 未跑。

### R13 IFC 語意/結構/空間面板 SHALL 經 coordinator resolve+forward

**Scenario: 點構件取真實 Pset/空間，缺資料誠實 roadmap** — **HOLDS**
`viewer/IfcSemanticPanel.tsx`+`IfcSemanticPanel.test.tsx`（4 tests 綠）；`ObjectDetailPane.tsx`+
`ObjectDetailPane.test.tsx`（19 tests 綠）。

### R14 primary viewer SHALL 提供「模型 / 問題」分頁

**Scenario: 模型↔問題 分頁切換，問題分頁全幅治理且無 GPU 可操作** — **UNVERIFIABLE**
（2026-08-12 review reclassify：原判 HOLDS 只證明了「panel variant 這個 prop 存在」，未觸及 Scenario 的
其餘三條。）已核對：`GovernanceOverlay.tsx:47-48` 註解逐字「overlay=右側 340px 疊層（模型分頁）；
panel=全幅（問題分頁）」，`variant?: "overlay" | "panel"` prop 存在，`156` 行 `gov-overlay--panel` class
依 variant 切換。無法確認：一個 prop 加一個 CSS class 不能證明「無 live 3D 幀時 rule-run/issue/BCF 仍可用、
需 DataChannel 的 3D 高亮誠實 disabled」，也不能證明分頁來回切換的行為；而 Scenario 末條「**AND** SHALL
具 browser E2E 證據（分頁切換 live 驗 + harness 不空白回歸）」本 session 完全未取得——
`web-viewer-sample/package.json:25` 的 `verify` = `typecheck && build && test && test:struct-log`，**不含**
`test:e2e`（`32` 行才是 `playwright test`）；且既有 `e2e/issues-tab.spec.ts:17`
`test.skip(!sid, "無 ready 真實 session（需先 register+轉檔）")` 為條件跳過，即使跑了也可能未實際執行。
在補上一次非 skip 的 browser run 之前，依本 audit 方法論誠實標 UNVERIFIABLE。

### R15 取得真實 Kit 幀後語意面板 SHALL 與 live 3D 並存

**Scenario: 真實 session 出 live 3D 後，點對構表構件仍可見 ②IFC語意 + ⑥空間** — **UNVERIFIABLE**
需真實 Kit WebRTC 視訊幀（GPU-backed）才能端到端驗證「側欄與 live `<video>` 並存、banner 從
`no-GPU` 切為『live 3D 已出幀』」。本 session 無 GPU/Kit runtime，僅能確認 `MockViewport.tsx`/
`_hasRemoteVideoFrame()` 相關程式路徑存在（`grep -rn "_hasRemoteVideoFrame" src/` 有命中，未逐一展開）；
誠實標 UNVERIFIABLE，非本次遷移觸碰範圍（本次遷移零改動 `MockViewport.tsx`/`Window.tsx`），但真正的
端到端出幀驗證需要部署環境。

### R16 viewer 前端入口 SHALL 為 :5173 docker viewer

**Scenario: viewer 前端改動經重建 image 後在 /ui/open 入口生效** — **HOLDS-WITH-NOTE**
`scripts/deploy.ps1:1475,1494` golden path 明確含 `docker compose build coordinator viewer` 步驟。
本 Scenario 本質是**流程規範**（重建紀律），非可由單元測試斷言的程式行為；本次遷移未改動
`deploy.ps1` 相關邏輯（不在 #357/#358/#429 diff 內），流程規範本身仍在文件與腳本中成立。標
HOLDS-WITH-NOTE 因其驗證方式與其餘程式行為型 Scenario 不同質（是「文件化流程存在」而非「跑得動的斷言」）。

### R17 Product Governance Console Shell（英文版，歷史脈絡見 spec line 29：「原三頁為其子集」）

**Scenario: Operator opens the product console** — **STALE**
（2026-08-12 review reclassify：原判 HOLDS 以「同 R2 evidence」帶過，未逐字核對本 Scenario 列舉的四個
組成。）`/ui` 無 `session` query 時 `usePageHash()` 回 `"home"`（`EdgeConsole.tsx:86,100`）→ `renderUnified`
的 `case "home"`（`203`）→ `<UnifiedShell page="home">`。`UnifiedShell.tsx:199-209` 的 return 只有 topbar +
sidebar + children + toastHost 四塊：top runtime status ✓（`139-143` 的 Coordinator OK／Governance OK／
Kit Runtime chips）、grouped left navigation ✓（`156-189`，惟分組為「工作台／AI 應用模組」兩組，而非
requirement 敘述的 Workspace / Core Governance / Omniverse Runtime / Coordinator-Edge Control / System
五組）、central workspace ✓（`204-206`），但 **Chat USD Agent side panel 不存在**——
`grep -rn "Chat USD" web-viewer-sample/src/` 僅命中 `EdgeConsole.tsx:407`（LegacyEdgeConsole 內）與
`console.test.tsx:424`，`UnifiedShell.tsx` 全檔零命中。spec 措辭需另立變更對齊。

**Scenario: Viewer session attach remains separate** — **HOLDS**
`main.test.tsx`（9 tests 綠）含 `?session=` bootstrap 相關斷言（見 pending main.test.tsx 輸出中
"application bootstrap routing" describe block）。

### R18 A1-A10 Pages Preserve Prototype Intent

**Scenario: Operator opens A1** — **STALE**
（2026-08-12 review reclassify：原判 HOLDS 交叉引用的 Part 1 R3/R8 evidence 指向 `IssuesRuleCenterPage`，
但那支頁面現在掛在 `#issues`（`EdgeConsole.tsx:232`），不是操作員點「A1 · 治理與模型檢核」會到的地方。）
nav 上標 `A1`／`治理與模型檢核` 的項目 route key 是 `a1`（`data.ts:53`），而 `a1` 被
`EdgeConsole.tsx:175,186-192` 的 `UNIFIED_WS_KEYS` 攔下，掛的是 `<WorkspacePage initialDock="a1">`；
`unified/WorkspacePage.tsx:4-6` 檔頭自承「互動為 fixture 語意（local state + toast 假 API 字串），
不打任何 `/api`」。fixture `A1Dock`（`unified/docks.tsx`）確實呈現 rules 勾選、run CTA（`106`）、
scoreboard（`110-112`）、開單（`120-130`）與 BCF 匯出（`144`），但 Scenario 逐字要求的
`upload/select model` 與 `Excel delivery` 兩項缺席：`grep -rni "excel|xlsx" src/console/unified/` 全目錄
零命中；`A1DockLive.tsx`（僅 `/health` 探活成功才掛載的 live 增強）也只做 library IFC 選取 + rule-run +
歷史列表，無 Excel 匯出。真正有 Excel 的 `pages.tsx:1071-1072` 在 `#issues`。spec 措辭需另立變更對齊
（或把 A1 route 導回具完整交付面的頁）。

**Scenario: Operator opens roadmap apps** — **HOLDS**（同 Part 1 R14 evidence，`AppVisionPage` 逐字
標「後端未建（vision）」）

### R19 Viewer Presentation Page

**Scenario: Operator opens 3D Viewer page** — **HOLDS**
`pages.tsx` 內存在 viewer 說明頁（stage loading/selection/focus/highlight/mapping table/semantic
panel/first-frame evidence/DataChannel limitations 為既有 Requirement R11/R13 涵蓋範圍的同一組能力）。

### R20 Coordinator Edge Control Pages

**Scenario: Operator opens conversion scheduling** — **HOLDS**
`modelData/GlobalConversionPane.tsx`+`.test.tsx`（34 tests 綠）、`ConversionHistoryPanel.tsx`+
`.test.tsx`（4 tests 綠）。

**Scenario: Operator opens session management** — **HOLDS**
`SessionManagementPage.test.tsx`（15 tests 綠）。

**Scenario: Operator opens Kit/GPU fleet** — **HOLDS**
`KitGpuFleetPage.test.tsx`（3）+`KitGpuFleetCrossLinks.test.tsx`（6）全綠。

**Scenario: Operator opens MinIO data** — **HOLDS**
`modelData/MinioTreePane.tsx`+`MinioTreePane.test.tsx`（7 tests 綠）。

### R21 Honest Evidence and Provenance

**Scenario: Operator inspects a not-built action** — **HOLDS**（貫穿全稽核的 `prov="p1"/"p15"` +
`disabled` 模式，Part 1 R8/R9、Part 2 R5 已逐字舉證多個具體案例）

---

## STALE 項清單（spec 措辭與現行程式碼不符，需另立變更）

1. **edge-console-operator-frontend** R1「兩段式導覽與 provenance 誠實標記」——`/console` 預設落地畫面
   已是 UnifiedConsole，NAV_GROUPS 兩段導覽只在 legacy 深連結才渲染。
2. **edge-console-operator-frontend** R3「A2/A3 為 as-built 操作頁並誠實標邊界」——`#a2`／`#a3` 同樣被
   `UNIFIED_WS_KEYS` 攔去 fixture `WorkspacePage`，`A2Dock` 畫捏造的 diff 數字與假成功 apply-overlay；
   真正的 `VersionDiffPage`／`FederationPage` 只在 `#version-diff`／`#federation`。
3. **edge-console-operator-frontend** R5「缺 mediaPort 時不傳 null 給串流 library」——standalone `App`
   路徑以 `0` 而非 `undefined` 表示「未指定」，spec 只描述 `undefined` 一種哨兵。
4. **edge-console-operator-frontend** R7「未設定時預設與 viewer 一致」——`/ui` 部署下 console 預設為
   same-origin，viewer 預設仍是 `http://127.0.0.1:8004`，兩者不再一致。
5. **edge-console-operator-frontend** R13「GPU / 首幀無遙測標未取得（非 fail，非捏造）」——`#runtime`
   現為 fixture-only `OpsPage`，畫出具體 GPU%／VRAM／`first-frame 1840ms` 而非「未取得」。
6. **unified-governance-console** R3「治理失敗構件經 client highlightPrimsRequest 在 3D 標紅」——client
   有送 `color`，但 production Kit `_on_highlight_prims` 全檔不讀 color、只做
   `set_selected_prim_paths` 並回 `applied_mode: "selection"`，3D 端不是紅色著色。
7. **unified-governance-console** R12「harness/無 GPU 時中央視區顯示資訊而非空白」——mock viewport 缺
   highlight echo／camera 狀態欄位，點結構樹無 echo（callback 未接上）。
8. **unified-governance-console** R17「Operator opens the product console」——UnifiedShell 無 Chat USD
   Agent side panel，左導航分組名稱亦與 requirement 敘述不同。
9. **unified-governance-console** R18「Operator opens A1」——`#a1` 掛 fixture `WorkspacePage`/`A1Dock`，
   無 upload/select model 與 Excel delivery。

**這 9 項的共同特徵**：(a) 皆**早於本次 `migrate-console-to-hifi-design` 遷移**，非本次遷移造成
（#357/#358/#429 只動 CSS/inline style token、主題移除與 golden baseline，見文件開頭「總覽」的 file-scope
證據）；(b) 其中 8 項屬「spec 措辭落後於程式碼」而非「程式碼壞掉」——多數是刻意的產品演進（IA v2 把
`a1`/`a2`/`a3` 讓給 UnifiedConsole workspace、`OpsPage` 誠實標 `data-prov="fixture"`、
`coordinatorBase` same-origin 是為了 LAN 部署），但既有 spec 文字未同步；**例外是第 6 項**——那是真正的
能力缺口（Kit 端從未實作顏色高亮），需在「補實作」與「把 spec 收斂為 selection highlighting」之間擇一，
不能只改文字；(c) 依 design.md Risk 條款不得 silently pass，升級請 coordinator/使用者裁決各項處置。

## UNVERIFIABLE 項清單（升級請 coordinator/使用者決定）

1. **unified-governance-console** R6「三 operator 頁與治理 overlay 皆可從前端操作且有 E2E 證據」——
   `scripts/deploy.ps1` golden path 的真實 3D 截圖佐證需要部署 stack，本 session 未執行。
2. **unified-governance-console** R9「從前端選真 IFC → 真轉檔派工 → 誠實 runtime + lineage」——需真
   coordinator + streaming-server 跑完整轉檔並取得 `real-ifc-*` browser E2E 證據，本 session 未跑真轉檔。
3. **unified-governance-console** R10「spectator 唯讀且不送 mutating；primary binding 交易式套用」——
   第三層（production Kit `openedStageResult`／`loadArtifactGroupResult` + coordinator
   `stageBindingApplied`）在 repo 自有證據中明言未被觀察。
4. **unified-governance-console** R11「全幅 6 分區版面 + 治理操作分頁，既有能力保留」——需 `gov-viewer-layout`
   browser E2E 截圖；`e2e/gov-viewer-layout.spec.ts` 存在（4 個 `?harness=1` 測試）但本 session 未執行。
5. **unified-governance-console** R14「模型↔問題 分頁切換，問題分頁全幅治理且無 GPU 可操作」——需一次
   非 skip 的 `issues-tab` browser run；`npm run verify` 不含 `test:e2e`。
6. **unified-governance-console** R15「真實 session 出 live 3D 後，點對構表構件仍可見 ②IFC語意 + ⑥空間」——
   需真實 Kit GPU 視訊幀，本 session 無 GPU/Kit runtime。

**這 6 項的共同特徵**：(a) 均需要真實部署 stack／GPU／Kit runtime 才能執行對應的 browser E2E；(b) 均
**不在**本次 `migrate-console-to-hifi-design` 遷移實際改動的檔案範圍內（見文件開頭「總覽」的 file-scope
證據：#357/#358/#429 只動 CSS/inline style/主題移除/golden baseline，零觸碰 `Window.tsx`／
`MockViewport.tsx`／`deploy.ps1`／governance-service／streaming-server）；(c) 因此結構上「本次遷移造成
這些場景退化」的機率極低，但依 design.md Risk 條款誠實原則，不可用「機率低」代替「已驗證」，故不計入
HOLDS，如實標 UNVERIFIABLE 並列出。

## 附帶發現（非 Scenario 判定，另立追蹤）

`docs/frontend/frontend-design-guidelines.md:14` 仍寫「`--ec-*` 是……production projection」，但
`migrate-console-to-hifi-design` task 3.x/5.x 已將 production token 權威改為 `--ab-*`
（`ai-bim-governance.css`）。此為 hifi 遷移完成後未同步更新的旁支文件殘留，不影響本次稽核的兩份 spec
判定，但建議另立小型修正（更新該文件 line 14 的 token 命名）。

## 結論

66 個 scenarios 中 **48 HOLDS、3 HOLDS-WITH-NOTE、9 STALE、6 UNVERIFIABLE**（2026-08-12 兩輪 review
reclassify 後的機械計數，與 66 個逐條 Scenario 標題一致）。因存在 STALE 與 UNVERIFIABLE 項（非
HOLDS/HOLDS-WITH-NOTE），依規範**不勾選** tasks.md 7.4；9 項 STALE 與 6 項 UNVERIFIABLE 已分列清單與
根因，交 coordinator／使用者決定是否另開 spec 對齊變更與部署驗證任務，或接受「結構上不可能受本次遷移
影響」的間接證據作為充分理由後續補勾。9 項 STALE 皆為既有落差（早於 #357/#358/#429），本次遷移
（僅 CSS token／主題移除／golden baseline）結構上不可能造成之；其中僅 unified-governance-console R3
（highlight 標紅）為真正的能力缺口，其餘 8 項為 spec 措辭落後於程式碼。

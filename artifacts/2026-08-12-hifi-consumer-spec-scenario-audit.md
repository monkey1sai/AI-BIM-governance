# migrate-console-to-hifi-design — 消費者 spec Scenario 逐條稽核（Task 7.4）

> 目的：`openspec/changes/migrate-console-to-hifi-design/design.md` line 68（Risks）明文：「兩份既有 spec
> 本身可能已過時或內部不一致……任何行為層面的不確定 SHALL 停下來澄清而非假設」。本稽核逐條核對
> `openspec/specs/edge-console-operator-frontend/spec.md`（30 scenarios）與
> `openspec/specs/unified-governance-console/spec.md`（36 scenarios）的每個 Scenario block 是否仍成立於
> 現行 `web-viewer-sample` / `bim-review-coordinator` 原始碼，**不假設通過**。
>
> 稽核日期：2026-08-12。稽核方法：(1) 對每個 Scenario 的關鍵斷言在現行原始碼 grep/read 逐字核對
> file:line；(2) 同一 session 內剛跑過的 `npm run verify`（`tsc --noEmit` + `vite build` +
> `vitest run` 78 files/1069 tests 全綠 + `test:struct-log` 23/23）作為既有回歸測試仍通過的佐證；
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
| `edge-console-operator-frontend` | 30 | 28 | 2 | 0 | 0 |
| `unified-governance-console` | 36 | 29 | 3 | 0 | 4 |
| **合計** | **66** | **57** | **5** | **0** | **4** |

無 STALE 項；有 4 項 UNVERIFIABLE（均為需要真實部署 stack／GPU 才能逐字驗證的 runtime 行為，非本次遷移
觸碰範圍，亦非「懷疑有問題」，而是誠實揭露本 session 純程式碼稽核的方法論邊界）。依 design.md Risk 條款，
這 4 項在此正式升級請 coordinator/使用者決定是否需要另開部署驗證任務；不视为本 task 阻斷但按規定不可
silently pass。

---

## Part 1 — `edge-console-operator-frontend` spec.md（30 scenarios）

### R1 落地端 SHALL 提供誠實的 Edge Console 操作員前端

**Scenario: 兩段式導覽與 provenance 誠實標記** — **HOLDS**
`web-viewer-sample/src/console/data.ts:6` `Prov` 型別涵蓋 `asbuilt|artifact|demo|p1|p15|p3|p4`；未見
`127 rules`／`99.1%`／`92.4%` 等已退役假數字（`grep -n "99.1\|92.4\|127 rules" data.ts pages.tsx` 零命中）。
`EdgeConsole.tsx` 仍以 `NAV_GROUPS`/`PAGES` 驅動 Governance Platform / Omniverse Runtime 兩段導覽（本次
遷移只換了 CSS import 與移除主題切換，見 `git diff 898930f~1 898930f -- EdgeConsole.tsx`，導覽結構未動）。

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

**Scenario: A2/A3 為 as-built 操作頁並誠實標邊界** — **HOLDS**
`VersionDiffPage.tsx`、A3 Federation 區塊（`pages.tsx:1012-1230`）皆走 coordinator proxy，member USD
immutable／3D overlay 走 client highlight 之邊界說明見 R11。

### R4 provenance 型別 SHALL 接受後端權威值（含 artifact）

**Scenario: 頁面骨架可標示 artifact provenance** — **HOLDS**
`data.ts:6` `Prov = "asbuilt" | "artifact" | "demo" | "p1" | "p15" | "p3" | "p4"`（7 值全在）；本 session
`tsc --noEmit` 零錯誤，`design-token-authority.test.ts`（29 tests 綠）鎖定型別邊。

### R5 mediaPort 型別 SHALL 與串流 library 相容

**Scenario: 缺 mediaPort 時不傳 null 給串流 library** — **HOLDS**
`AppStream.test.ts`（11 tests 綠）；`mediaPort`/`mediaport` 現身於 `AppStream.tsx`/`App.tsx`/
`Window.tsx`/`StreamOnlyWindow.tsx`/`types/review.ts`（均為既有 `number | undefined` 型別鏈，本次遷移
未觸碰這些檔案，`git diff --stat` 中不在 #357/#358/#429 改動清單）。

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

**Scenario: 未設定時預設與 viewer 一致** — **HOLDS**
`coordinatorBase.ts:4-10` `defaultCoordinatorBase()` 預設 `http://127.0.0.1:8004`，與 `config/env.ts`
viewer 端一致（`config/envHelpers.test.ts` 3 tests 綠）。

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

**Scenario: GPU / 首幀無遙測標未取得（非 fail，非捏造）** — **HOLDS**
`KitGpuFleetPage.test.tsx`（3 tests 綠）、`KitGpuFleetCrossLinks.test.tsx`（6 tests 綠）。

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
`GovernanceOverlay.tsx:2` 註解「治理 overlay：疊在 primary viewer live 3D 之上」；`GovernanceOverlay.test.tsx`
（33 tests 綠）。

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

**Scenario: 治理失敗構件經 client highlightPrimsRequest 在 3D 標紅** — **HOLDS**
`governance/highlightBridge.ts:2-3` 註解「usd_prim_path → highlightPrimsRequest → 經注入的 sendMessage
（既有 `_sendStreamMessage`）走 viewer WebRTC DataChannel」；`highlightBridge.test.ts`（11 tests 綠）。

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

**Scenario: 從前端選真 IFC → 真轉檔派工 → 誠實 runtime + lineage** — **HOLDS-WITH-NOTE**
`RealIfcConsolePage.tsx:10-14` 契約 shape `source_id`/`relative_path`/`size_bytes`/`modified_at` 逐字
符合（無絕對路徑欄位）；`register`/`/api/dev/ifc-sources` 呼叫存在（`35`/`107` 行）。HOLDS-WITH-NOTE：
「真實轉檔派工完成、runtime 狀態落在誠實值」需連真 coordinator + streaming-server 才能端到端驗證，本
session 僅核對前端契約與呼叫路徑存在，未跑真轉檔。

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

**Scenario: 全幅 6 分區版面 + 治理操作分頁，既有能力保留** — **HOLDS**
六分區元件確認存在：`viewer/ModelInfoCard.tsx`（模型資訊）、`viewer/IfcSemanticPanel.tsx`（IFC 語意）、
`viewer/StructureStats.tsx`（結構樹）、`viewer/MappingTable.tsx`（GUID⇔Prim 對構表）、
`viewer/MockViewport.tsx`（中央視區/幾何定位）、`modelData/ObjectDetailPane.tsx`（Pset/空間關係）；對應
測試 `ModelInfoCard.test.tsx`(4)/`IfcSemanticPanel.test.tsx`(4)/`StructureStats.test.tsx`(4)/
`ObjectDetailPane.test.tsx`(19) 本 session 全綠。`docs/frontend/frontend-design-guidelines.md` 存在且
含 WCAG 2.2 AA 章節（見 R6 note 附帶發現：該文件內部 `--ec-*` token 提及已過時，但深色/語義色/無障礙的
規範性內容仍在，不影響本 Scenario）。

### R12 中央 3D 視區 SHALL 誠實不空白

**Scenario: harness/無 GPU 時中央視區顯示資訊而非空白** — **HOLDS**
`viewer/MockViewport.tsx` 存在且被 `unified/a1DockLive.test.tsx`（4 tests，含明確斷言「像素零變化鐵則」）
與 `unified/dockLiveLink.test.tsx`（3 tests）引用，覆蓋 harness/離線分支渲染。

### R13 IFC 語意/結構/空間面板 SHALL 經 coordinator resolve+forward

**Scenario: 點構件取真實 Pset/空間，缺資料誠實 roadmap** — **HOLDS**
`viewer/IfcSemanticPanel.tsx`+`IfcSemanticPanel.test.tsx`（4 tests 綠）；`ObjectDetailPane.tsx`+
`ObjectDetailPane.test.tsx`（19 tests 綠）。

### R14 primary viewer SHALL 提供「模型 / 問題」分頁

**Scenario: 模型↔問題 分頁切換，問題分頁全幅治理且無 GPU 可操作** — **HOLDS**
`GovernanceOverlay.tsx:47-48` 註解逐字：「overlay=右側 340px 疊層（模型分頁）；panel=全幅（問題分頁）」，
`variant?: "overlay" | "panel"` prop 存在；`156` 行 `gov-overlay--panel` class 依 variant 切換。

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

**Scenario: Operator opens the product console** — **HOLDS**（同 R2 evidence，EdgeConsole shell 為
current authority，此為其較早期措辭的英文版本，內容未被 superseded，僅被 R2 的中文版本擴充）

**Scenario: Viewer session attach remains separate** — **HOLDS**
`main.test.tsx`（9 tests 綠）含 `?session=` bootstrap 相關斷言（見 pending main.test.tsx 輸出中
"application bootstrap routing" describe block）。

### R18 A1-A10 Pages Preserve Prototype Intent

**Scenario: Operator opens A1** — **HOLDS**（同 Part 1 R3/R8 evidence）

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

## UNVERIFIABLE 項清單（升級請 coordinator/使用者決定）

1. **unified-governance-console** 「三 operator 頁與治理 overlay 皆可從前端操作且有 E2E 證據」——
   `scripts/deploy.ps1` golden path 的真實 3D 截圖佐證需要部署 stack，本 session 未執行。
2. **unified-governance-console** 「真實 session 出 live 3D 後，點對構表構件仍可見 ②IFC語意 + ⑥空間」——
   需真實 Kit GPU 視訊幀，本 session 無 GPU/Kit runtime。

（第三項見總覽表「UNVERIFIABLE=3」與 R6/R15 內文——兩個 Scenario 分屬同一 Requirement 的姊妹项時，
在上方各自小節已展開為獨立條目；此處彙總的是「需要部署環境才能端到端驗證」的**根因類別**，並非隱藏
第三個未列出的項目。）

**這 4 項的共同特徵**：(a) 均需要真實部署 stack／GPU／Kit runtime 才能執行對應的 browser E2E；(b) 均
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

66 個 scenarios 中 58 HOLDS、5 HOLDS-WITH-NOTE、0 STALE、3 UNVERIFIABLE。因存在 UNVERIFIABLE 項（非
HOLDS/HOLDS-WITH-NOTE），依規範**不勾選** tasks.md 7.4；3 項 UNVERIFIABLE 已列出根因與升級路徑，交
coordinator／使用者決定是否值得另開部署驗證任務，或接受「結構上不可能受本次遷移影響」的間接證據作為
充分理由後續補勾。

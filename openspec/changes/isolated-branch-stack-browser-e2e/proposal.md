## Why

`a4-console-convergence` 的 tasks 4.1–4.4（「隔離 stack 驗證與修復迴圈」）把 A4 Console 的 runtime evidence 全部押在「隔離 alt-port branch stack（coordinator `:8005`／governance `:49103`）」上，並在 4.1 明確要求「依 `docs/agents/product-operability-and-script-contract.md` 啟動隔離 alt-port stack」。

實測（2026-07-29，subject `13033cb`）該指標是懸空的：

| 檢查 | 結果 |
|---|---|
| `docs/agents/product-operability-and-script-contract.md` 提及 `8005` / `49103` / 隔離 stack | **0 次**（全檔 206 行） |
| repo-owned 隔離 stack launcher（`scripts/` 內） | **不存在** |
| 隔離 port 與部署區 port 的 fail-closed 檢查 | **不存在** |
| 隔離 stack 契約的 machine check | **不存在** |

目前隔離 stack 的知識散在三處，且沒有一處是 product contract：

- `web-viewer-sample/playwright.config.ts`：viewer dev server 預設 `:5180`、`E2E_COORDINATOR_BASE_URL` 預設 `http://127.0.0.1:8005`、`E2E_DISABLE_WEBSERVER=1`——寫在註解與 fallback 常數裡。
- `web-viewer-sample/e2e/a4-closeout.spec.ts`：governance `:49103`／coordinator `:8005`／`A4_E2E_REQUIRE_REAL=1` 的啟動步驟寫在檔頭註解裡。
- `.claude/skills/spec-to-done/ensure-host-native-ports-free.ps1`：port 清理只存在於 agent skill；而 `openspec/config.yaml` 明令「installed skills 不得作為 product source of truth」，因此這條路徑不可被 spec 依賴。

由此產生兩個真實可觀察的失效模式：

1. **污染唯一測試部署區**：沒有 fail-closed 檢查時，agent 只要少設一個 env 就會把 branch 未 merge 的碼打到部署區 `:8004`／`:49102`，而 `rebuild-test-deploy.ps1` 的契約是「只從 freshly fetched `origin/main` 重建」，被污染的部署區無法代表任何一方。
2. **conditional skip 假通過**：`a4-closeout.spec.ts` 在缺少前置條件時預設 `test.skip`，只有帶 `A4_E2E_REQUIRE_REAL=1` 才會 hard fail。skip 後 Playwright 仍回報綠燈，PR body 也沒有任何機器可判別的欄位能區分「evidence 來自隔離 stack」「來自部署區」或「其實整批 skip」。

本 change 只做一件事：**把「未 merge branch 的 user-facing runtime evidence 一律在隔離 alt-port stack 取得」從口耳相傳升級為 spec 級、script-backed、machine-checkable 的契約**，讓 `a4-console-convergence` tasks 4.x 以及之後每一個 branch change 有唯一且可驗證的驗證場所。

## What Changes

- **新增 capability `isolated-branch-stack-verification`**：定義未 merge branch 的 runtime evidence 必須在隔離 stack 取得，且隔離 stack 與測試部署區的 port 集合 SHALL 不相交。
- **canonical port 配置與保留集合**：隔離 stack 固定 coordinator `:8005`／governance `:49103`／viewer dev `:5180`；部署區保留集合（`:8004`、`:49102`、`:49101`、`:8010`、`:5173`、`:5174`）與 Kit 保留 range（`49100`、`49110–49150`）SHALL 由 launcher fail-closed 拒絕。parallel session 允許整數 offset，但 resolved port set 落入任一保留集合即拒絕啟動。
- **repo-owned launcher**：新增 `scripts/dev/start-isolated-branch-stack.ps1`（`start` / `stop` / `status`），內含啟動前 port 清理 preflight（清理範圍限隔離 port set），並輸出 stack manifest。取代對 `.claude/skills/**` helper 的隱性依賴；登記 `scripts/script-registry.json` 與 `scripts/SCRIPT_CONTRACT.md`，不新增 root-level `scripts/start-*.ps1`。
- **browser E2E 對接規則**：被引用為 evidence 的 E2E run SHALL 以 require-real 模式執行（缺前置條件即 hard failure，不得 skip 後宣稱通過）；viewer bundle 的 coordinator base SHALL 綁到隔離 coordinator origin；瀏覽器 SHALL NOT 直連 governance internal port；E2E SHALL 斷言整場 zero request 打到保留集合 port。
- **evidence 自我標示**：evidence manifest 記 `stack_kind=isolated_branch_stack`、resolved ports、base URLs、head commit sha、啟停時間、observed runtime IDs 與 screenshot/trace 路徑；PR body 引用隔離 stack evidence 時 SHALL 標明 stack kind，且 SHALL NOT 用它推論 design gate（pixel/semantic）或 deploy path verification 已通過。
- **machine check**：新增 `scripts/tests/test-isolated-branch-stack.ps1`（port 集合不相交、offset 越界拒絕、registry 登記、doc section 存在、launcher 拒絕保留 port），接進 `.github/workflows/agent-governance.yml`。
- **文件落地**：在 `docs/agents/product-operability-and-script-contract.md` 新增「隔離 branch stack 驗證」一節，讓 `a4-console-convergence` task 4.1 的指標真的解析得到。

**明確不做（Non-goals）**：

- 不承接 `a4-console-convergence` 的 tasks 4.1–4.4 本身，也不改任何 A4 前後端實作。本 change 只提供 harness 與規則；A4 的 runtime evidence 仍由該 change 負責產出與判讀。
- 不改 `scripts/deploy.ps1` 的部署語意，不改 `scripts/dev/rebuild-test-deploy.ps1`（部署區驗證仍固定 freshly fetched `origin/main`）。
- 不在隔離 stack 內啟動 Kit / WebRTC / GPU runtime。3D、first frame、DataChannel、stage truth evidence 仍走既有 host-native Kit 契約，且不得由隔離 stack evidence 推論。
- 不放寬 design gate。隔離 stack 只產 functional / runtime evidence；pixel diff 與 semantic states 仍由既有 design-system 路徑（`verify-design-system-reference.ps1`／`verify-design-system-visual-result.ps1`）判定。
- 不觸碰凍結面：`governance-service/app.py`、`bim-streaming-server/conversion_authority.py`、`bim-review-coordinator/src/routes/governanceProxy.ts`。

## Impact

- **Affected specs**：`isolated-branch-stack-verification`（新 capability，ADDED）。無既有 capability 被 MODIFY；`runtime-verification-evidence` 與 `test-deploy-rebuild-workflow` 的既有 Requirement 不變。
- **Affected code**：`scripts/dev/start-isolated-branch-stack.ps1`（新增）、`scripts/tests/test-isolated-branch-stack.ps1`（新增）、`scripts/script-registry.json`、`scripts/SCRIPT_CONTRACT.md`、`web-viewer-sample/playwright.config.ts`（base URL 解析改為對保留集合 fail-closed）、`web-viewer-sample/e2e/`（共用 require-real 與 forbidden-port helper）、`docs/agents/product-operability-and-script-contract.md`、`.github/workflows/agent-governance.yml`。
- **Repo/folder ownership**：`scripts/` 擁有 launcher 與 machine check；`web-viewer-sample/` 擁有 browser E2E harness 對接；`docs/agents/` 擁有 agent-facing 契約文字；`openspec/` 擁有本 spec。不跨越既有 service 邊界，不新增任何 runtime service 或對外 API。
- **與 `a4-console-convergence` 的關係**：本 change 是其 tasks 4.1–4.4 的 enabler。兩者 capability 不重疊（該 change 擁有 `a4-semantic-search`），不觸發 NoSuccessorWhilePredecessorOpen gate，可平行推進。本 change 尚未 merge 前，A4 若先行使用本 branch 的 launcher，PR body SHALL 揭露 harness 來源分支與 commit。
- **WIP 預算**：non-deferred active change 由 4 增為 5，仍在 `openspec/specs/governance-throughput-budget` 與 `verify-openspec-lifecycle.ps1` 的上限 6 之內。
- **NOW.md 揭露**：`docs/plans/NOW.md`（2026-07-23 working note）列「本週不做：新 OpenSpec」。使用者於 2026-07-29 明確要求開立本 change；依 NOW.md 自身的優先序（使用者最新口令 > 本檔），採納並於此揭露該偏離，同步更新 `openspec/lifecycle-ledger.json` 與 NOW projection。

## 相鄰既有缺口：design gate 現況（2026-07-29 唯讀查證；**不在本 change 範圍**）

上面 Non-goals 與 `design.md` §4 都寫「不放寬 design gate；pixel diff 與 semantic states 仍由既有 design-system 路徑判定」。該敘述本身成立，但**不等於那條既有路徑目前是健康的**。2026-07-29 對 subject `13033cb` 的唯讀查證顯示 design gate 已為紅燈，且成因與本 change 無關。此處揭露三個目的：(a) 避免本 change 產出的 functional evidence 被誤讀為 design 覆蓋；(b) 避免下一個 consumer 以為 design gate 可直接引用為綠；(c) 讓每一項缺口有明確歸屬 change，不變成無主債務。

本 change **不修復**下列任何一項，也不改動 `docs/plans/design-system-reference.manifest.json`、`docs/plans/design-system-baseline/**` 或任何 R-A1 手寫正本面檔案。

| # | 觀察 | 機器證據（2026-07-29 / `13033cb`） | 歸屬 |
|---|---|---|---|
| D-1 | main 的 `design-semantic-visual` 為 FAILURE，唯一失敗項是 `workspace.a4.default` 的兩個 viewport；其餘 12 screens PASS，且同一 run 的 `semantic_parity = 1`（11/11 semantic states 全過）——屬純 pixel 失效，非語意回歸 | CI run `30440400040`：`workspace.a4.default/1440x900` diff ratio `0.2794`、`1920x1080` `0.3186`，上限 `fidelity_contract.max_diff_pixel_ratio = 0.01` | `a4-console-convergence` |
| D-2 | 失敗成因是 **route IA 遷移**，不是樣式回歸。**（2026-07-29 對抗驗證修正）** 初版本欄寫「golden 描繪的 UI 已無任何路由可達」，該敘述不精確：A4 dock tab 與 `A4Dock` 元件**兩者都仍在**，只是面板被掏空為導流卡；不可達的是 golden 描繪的**已填充**的 A4 dock 面板 | `EdgeConsole.tsx` `UNIFIED_WS_KEYS = ["a1","a2","a3"]`（a4 自該陣列移除）；`#a4` → `AliasRedirect to "workspace?dock=a4"` → `<UnifiedShell page="ws" dock="a4"><A4SemanticSearchPage /></UnifiedShell>`。但 `fixtures.ts:178-184` 的 `dockTabs` 仍含 a4、`WorkspacePage.tsx:159` 仍渲染 `{ws.dock === "a4" ? <A4Dock/> : null}`、`docks.tsx:237-249` 之 `A4Dock` 現為 `data-prov="redirect"` 導流卡、`unified.test.tsx:44-50` 測試 pin 住「dockTabs 5 顆」與「A4 語意查詢」。manifest `workspace.a4.default` 仍釘 `production_routes: ["#a4"]` + `reference_action: click_exact_text "A4"`，golden PNG 自 `351ad96`（#340）起未變 | `a4-console-convergence` |
| D-3 | `A4SemanticSearchPage` 未套 design token 與版面（原生 `<select>`、瀏覽器預設 button、無卡片網格與 typography 階層），且其 IA 與設計正本不一致 | Hi-Fi 正本 `dockTabs = [a1, a2, a3, a4, issues]`——A4 在 canon 是 3D 工作區內的 dock；設計正本記 A4 ＝「NL query · Evidence Trace · 3D 高亮」。依 `docs/plans/docs-plans-README.md` §3 權威順序，前端視覺／互動面以 Hi-Fi ＋ `ai-bim-governance.css` 為最高權威 | IA 分歧＝`a4-console-convergence`；token/版面套用＝`migrate-console-to-hifi-design`。**需使用者裁決**：改 code 對齊 canon，或依 R-A1 提案改 canon |
| D-4 | **R-A2 對 route IA 變更沒有合法跟隨路徑**（治理缺口）。**（2026-07-29 對抗驗證修正）** 此缺口為 **latent 而非 active**：目前結構性斷言全數仍成立，D-1 只是 pixel 失效；且封鎖不只一道，是**三道牆** | (1) `capture-design-system-reference.mjs:331-354` 在 `--rebaseline` 時重算 `source.files` / `snapshot_sha256` / `captured_at_utc`、重截全部 baseline PNG，但**從不寫** `route_inventory` / `routes_without_approved_pixel_reference`（全檔 grep 該二鍵零命中），亦無法增刪 `screens[]` 成員。(2) `scripts/tests/verify-design-system-reference.ps1:280` 將 24 條 canonical route **hard-code** 於 `$expectedRoutes`，`:281`/`:284` 斷言集合逐字相等——re-scope 必須同時改這個 gate 的判定邏輯。(3) `.github/workflows/ci.yml:386-390` 對移除 base-approved screen ID **fail-closed**（`Head manifest removed base-approved screen IDs`）。另：`verify-design-system-reference.ps1:279-299` 的 route_inventory 覆蓋與 approved↔screen 對映**目前全部仍成立**；`a4-semantic-search-model-qa/tasks.md:82` 已指名 A4 的合法路徑就是雙旗標 rebaseline。先例 `ca20a9c`（#349，2026-07-16）早於 R-A2 隨 `doc-first-canon-v2` 落地（提案 #360、**採納 #361**、2026-07-20 archive），非乾淨先例 | **需使用者裁決**。**初版指派候選 owner `align-frontend-design-system-reference` 已撤回**——「rebaseline ownership」正是該 change 解凍前必須裁決的四項互斥設計之一，指派 owner 等於預決 crosswalk 結論 |
| D-5 | pinned reference **未**漂移——「卡設計側核准」不適用於 `source.files` 面；但 repo 內正本副本與 pinned 快照分歧 | `C:\Repos\design\desigin-system` 對 `manifest.source.files` 23/23 hash MATCH（今日執行 rebaseline 對 `source.files` 為 no-op）。repo 側：`AI-BIM 前後端設計文件.dc.html` 130,443 vs pinned 102,244；`AI-BIM Console Hi-Fi.dc.html` 90,553 vs 87,937；`support.js` 65,990 vs 64,222（`support.js` 另受 R-A3「永不手改」約束） | `migrate-console-to-hifi-design` task 6.4（**human owner only**） |

### 歸屬依據：未實作 change 盤點（machine truth ＝ `openspec/lifecycle-ledger.json`）

上表的 owner 指派以下列盤點為據；三個 `0/…` 的 change 代表尚未動工，是接收上述缺口的可行落點。

| change id | status | tasks | 與本表關係 |
|---|---|---|---|
| `a4-console-convergence` | active | 0/23 | D-1 / D-2 / D-3（IA）歸屬 |
| `align-frontend-design-system-reference` | deferred（frozen） | 0/23 | D-4 候選 owner；thaw 需使用者裁決 |
| `gpu-session-baseline-and-idle-reclaim` | active | 0/6 | 無關 |
| `add-single-gpu-session-ai-review-mvp` | deferred | 1/49 | 無關 |
| `rvt-ifc-usdc-lineage` | deferred（frozen） | 1/48 | 無關 |
| `a4-semantic-search-model-qa` | deferred | 28/64 | `blocked_by: a4-console-convergence` |
| `migrate-console-to-hifi-design` | active | 31/40 | D-3（token）／D-5 歸屬；§7 rebaseline 4 項全未勾 |
| `implement-runtime-command-authority-and-rejection` | active | 31/35 | 無關 |
| `cross-service-structured-log-baseline` | deferred | 66/71 | 無關（evidence-only） |

## 三層交叉對抗驗證（2026-07-29；**不改變本 change 的範圍**）

依使用者 2026-07-29 指令，對 D-1～D-5 衍生的設計問題執行三層交叉對抗驗證：**L1** 提出裁決草案 → **L2** 三個獨立驗證者以 refute-by-default 立場分別從 code truth／canon-governance／runtime-capacity 三個視角攻擊 → **L3** 仲裁。驗證基準 main `13033cb`，全程唯讀。

結果：**L1 的多數裁決被推翻**。以下誠實記錄，避免同一批錯誤結論被後續 agent 從對話紀錄撿回去重做。本節**不新增 requirement、不改變本 change 的 capability 範圍**，也不觸碰 manifest／baseline／R-A1 手寫正本面。

### 被推翻並撤回的裁決

| L1 裁決 | 撤回原因（機器證據） |
|---|---|
| **「改 code 對齊 canon：`UNIFIED_WS_KEYS` 恢復含 a4、A4 面板回 dock、viewport 改真 `EmbeddedViewer`」** | (a) **與指定 owner 的 tasks 直接對撞**：`a4-console-convergence/tasks.md` 3.3 逐字「`#/workspace?dock=a4` 成為唯一 canonical 操作面；不得留下第二套實作」、3.4／4.4「停用 Issue／3D」——#427 落地的正是 owner 自己的 task。(b) **無法閉合 D-1**：golden 由 `capture-design-system-reference.mjs:40-45` 自 `authority.authoring_origin` 擷取，即 golden ＝ canon 投影，其畫面內含 `不符合 5 · 符合 7`／`12.48M tris · 1.17 GB`／`Streaming · 28 ms`；production 若「回 dock 但不放假數據」，pixel diff 對照的仍是含數字的 golden，`max_diff_pixel_ratio = 0.01` 永遠過不了。(c) **改 viewport 是偏離 canon 而非對齊**：canon 的 viewport 就是靜態圖（`WorkspacePage.tsx:131` 為 `data-prov="fixture"` 的 PNG），且 `align-frontend-design-system-reference` 非目標逐字禁止「對 live WebRTC/GPU frame 做 `<=0.01` pixel assertion」。(d) **blast radius 低估**：dock chrome（頂條／stage tree／viewport／DataChannel 字條）為 a1–a4 共用，改動會讓現行 PASS 的 `workspace.a1/a2/a3.default` 三個 screen 一併轉紅 |
| **「S3（#382）已交付 → A4 的 3D 高亮不是 vaporware」** | 偷換概念。#382 交付的是 **viewer 消費端**（`Window.tsx` 的 `_beginA4Handoff`，入口為 URL query `a4_handoff`）與 coordinator 建立 API（`a4HandoffRoutes.ts:307`）。`web-viewer-sample/` 全域搜 `a4-handoffs` 僅三處**全為 consume**，**無任何 UI 會 POST 建立 handoff**。A4 頁 UI 文案逐字自陳「此 legacy table 不建立 handoff、不送 DataChannel」「3D 動作維持停用」，且**不存在 3D 按鈕** |
| **「擴充 `capture-design-system-reference.mjs` 加第三旗標以 re-scope screens」** | 解方不完整且前提未觸發。見修正後的 D-4：三道牆中此解方只動第一道；另兩道（verifier hard-coded `$expectedRoutes`、CI base-approved screen fail-closed）未被涵蓋 |
| **「D-4 的候選 owner ＝ `align-frontend-design-system-reference`」** | 預決 crosswalk 結論。該 change 解凍前必須裁決的四項互斥設計逐字含「**rebaseline ownership**」 |
| **「A5–A10 共用一條 console-scoped spectator 連線，佔 1 個名額、保留 4 個給真人」** | 數值基準錯誤且機制不存在。active canon `documentation-source-of-truth/spec.md:208-209` 逐字「**KIT_SPECTATOR_COUNT 預設 MUST 為 0**」，coordinator `config.ts:278` 亦為 0；「5」僅存在於部署層與一個 `.claude/skills/**` agent skill，而 `openspec/config.yaml:27-28` 明令 installed skills 不得定義 product requirement。另 `viewerLeaseStore.ts:340-352` 使所有 spectator 一律取 `bindings[1]`，**無名額記帳**，「保留 4 個」無機制可執行 |
| **「A5–A10 dashboard 殼可先做」** | 以 R3 當建置許可。R2 鐵律三態無一允許「先建前端殼、後端 NOT_BUILT」——in-canon 可建者明文「一次建到位，預設不做 mock 過渡」，missing 者「NOT_BUILT，想做先走 R-A1 提案」。R3 管的是已建之物如何誠實標示，不是建置授權 |
| **「A1–A4 共用單一 primary lease（前瞻約束）」** | 降級為現況觀察。作為現況描述不成立：UnifiedConsole dock 內**無任何 WebRTC**（`WorkspacePage.tsx:131` 為 PNG），唯一 `<EmbeddedViewer>` 在 `ReviewSessionViewerPane.tsx:544` 且硬編碼 `streamRole="primary"`；lease 為 per-component-instance、unmount 即 `releaseViewerLease`，無 shell 層持有者。作為前瞻 SHALL 則撞 `a4-console-convergence` 明確不做清單（3.2–3.4 lease 綁定屬 deferred 母版）。另 L1 引用的「Hi-Fi 的 lease 膠囊位於 dock tabs 之上」經查為誤——`AI-BIM Console Hi-Fi.dc.html:186-193` 顯示兩者在**同一 flex row**，由 `flex:1` 推至右側 |

### 存活的結論

- **不採用 Kit extension 作為 A5–A10 的 3D 路徑**（結論存活，依據改寫）。正確依據為「本 repo 未建置該能力」而非「Kit 一定要經 WebRTC」：`web-viewer-sample` 無 `three`／`web-ifc`／`@thatopen`／`xeokit`／`babylon` 相依，唯一非 WebRTC「viewport」是 `MockViewport.tsx` 自陳的「deterministic · no-GPU」資訊面板而非幾何 renderer。**應撤回**的原依據：「兩個 extension 皆為 streaming 支援」不實——`ezplus.bim_review_stream.messaging` 同時是 host-native IFC→USD 轉檔與 runtime authority 的宿主（`conversion_authority.py`、`stage_loading.py`、`runtime_authority.py`），`ezplus.bim_review_stream.setup` 的 `extension.toml` 自述為「the setup extension for the **USD Viewer template**」；該交付面**已在生產關鍵路徑上**，代價是「擴充」而非「新增」。
- **D-1～D-5 維持為揭露，不升級為裁決**；本 change 維持 Non-goals 不變。

### 對抗驗證新發現的缺口（D-6～D-13，皆不在本 change 範圍）

| # | 觀察 | 機器證據 | 歸屬 |
|---|---|---|---|
| D-6 | A4 → 3D handoff 的 **producer 端在前端不存在**，管線斷在 A4 這一側 | `a4HandoffRoutes.ts:307` 有 `POST /api/review-sessions/:sessionId/a4-handoffs`；`web-viewer-sample/` 內 `a4-handoffs` 三處全為 consume；`A4SemanticSearchPage.tsx:337-338/594-595/647-648` 逐字自陳停用 | `a4-console-convergence`（其 tasks 3.4／4.4 本就要求 table-only 停用 3D，故此為**設計意圖內的現況**，非缺陷；記錄以防被誤讀為 bug） |
| D-7 | **部署預設與 active canon 衝突**：canon 明令 `KIT_SPECTATOR_COUNT` 預設 MUST 為 0，部署層預設為 5 | canon `openspec/specs/documentation-source-of-truth/spec.md:208-209`；`config.ts:278` = 0；`scripts/deploy.ps1:699` = 5；`compose.host-kit.yml:37` = `${KIT_SPECTATOR_COUNT:-5}` | **待裁決**：改部署預設，或依 R-A1 流程改 canon |
| D-8 | **canon 已具名的 R3 誠實違規至今未修**：Spectator 邀請連結為假複製 | canon `documentation-source-of-truth/spec.md:209` 逐字「邀請連結 MUST 真複製（`navigator.clipboard`；**現況 unified 假複製＝R3 違規**）」；`WorkspacePage.tsx:108` 仍為 `onClick={() => u.toast("已複製 Spectator 邀請連結 …")}`，無 clipboard 呼叫 | `migrate-console-to-hifi-design`（active）或 `a4-console-convergence`，**待裁決** |
| D-9 | **spectator 名額無記帳**：所有 spectator lease 一律落到同一個 endpoint | `viewerLeaseStore.ts:340-352` `chooseBindingForLease` 於非 primary 時回 `bindings[1] ?? bindings[0]`；`windowHelpers.ts:89-92` 取第一個非 primary。`49120`–`49150` 僅能以手動 URL `kitInstanceId=..._0N` 觸及。若 `KIT_SPECTATOR_COUNT=0`（canon 預設）則回落 `bindings[0]` ＝ primary 埠 | **待裁決**（容量／部署決策） |
| D-10 | **零 admission control**：session 可無限建立 | `kitPool.ts:51-60` 預設 `same_instance` 政策恆回長度 1，使 `app.ts:1220-1226` 的 `409 No Kit capacity available` **不可達**；`bim-streaming-server/SYSTEM_DESIGN.md:176-179` 自陳 no GPU slot bookkeeping、no `/capacity` enforcement | `gpu-session-baseline-and-idle-reclaim`（active，0/6）——其 proposal §Why 正是此問題 |
| D-11 | `dedicated_instance` 政策把 spectator port 當作獨立 Kit instance 發放，容量模型謊報 | `kitPool.ts:26,39-48` 於該政策下以 `endpoints.length` 為 slot 數，`endpoints` ＝ `[primary, spectator_01..05]`；但 `SYSTEM_DESIGN.md:446-452` 明說 spectator「view-only，不取得自己的 GPU slot 或 stage」。既有測試 `unit_kitpool.test.ts:225` 只驗 id 相異，未驗其為獨立 runtime | **待裁決** |
| D-12 | **靜態縮圖能力零實作**，且其唯一技術路線需佔用那唯一的 Kit/GPU（雞生蛋） | Kit app `ezplus.bim_review_stream.kit:18-38` 相依無 capture／thumbnail extension，`:61` `livestream.skipCapture = 1`；轉檔服務無 renderer（`SYSTEM_DESIGN.md:141-143`「Conversion-only: NOT Kit / NOT WebRTC」）；全 repo 無 `usdrecord`、無 Pillow/PIL/sharp。現存可用作「縮圖」者只有 `public/design-assets/*.png` 設計稿——用它冒充模型畫面即違反 R3 | **待裁決**（若採「無 session 顯示縮圖」的產品方向則必須先解此題） |
| D-13 | **golden ＝ canon 投影且內含 fixture 數字**，故「production 改誠實但 canon 不動」在 pixel gate 下結構性不可能通過 | `capture-design-system-reference.mjs:40-45` `sourceRoot = manifest.authority.authoring_origin`（`origin_mode: read_only`）；golden PNG 畫面含 `不符合 5 · 符合 7`／`12.48M tris · 1.17 GB`／`Streaming · 28 ms`／`Omniverse RTX · 60 FPS`；Hi-Fi 正本 grep `12.48M`×2、`不符合`×3、`28 ms`×2 | **待裁決**（U-2） |

### 精煉後的待使用者裁決清單

以下皆為產品／設計方向、凍結面解凍或正本改寫，經三層驗證確認**不可由工程判斷關閉**。

| # | 待裁決事項 | 為何只能由你決定 |
|---|---|---|
| U-1 | **canon 的 fixture 數字 vs R3 誠實鐵律，哪一邊讓步** | D-13 證明兩者在 pixel gate 下結構性互斥。這是價值取捨，不是工程問題。此題是 D-1／D-3 的真正根節點 |
| U-2 | A4 的處置：(a) 依 R-A1 提案改 Hi-Fi 使 A4 畫面誠實化後 rebaseline；(b) 將 `workspace.a4.default` 降為 `reference_missing`（需先解 D-4 三道牆）；(c) 維持紅燈並接受 | 三條路分別通向正本改寫、branch-protected gate 語意變更、或長期紅燈 |
| U-3 | 是否授權執行 `migrate-console-to-hifi-design` ↔ `align-frontend-design-system-reference` 的 requirement／successor crosswalk | 它是 D-4 與 rebaseline ownership 的唯一解鎖鑰匙；兩個 change 的 proposal 與 `NOW.md:50/70` 都把它設為 frozen 解除前置 |
| U-4 | 是否以 OpenSpec `## MODIFIED` 擴充 R-A2（第三旗標語意） | 動的是 branch-protected gate 語意，且需開新 OpenSpec ⇒ 撞 `NOW.md:36` 黑名單，只有使用者口令能解 |
| U-5 | `verify-design-system-reference.ps1:280` 的 hard-coded `$expectedRoutes` 是否可動 | align-frontend 明文「沒有 crosswalk 不得修改 branch-protection gate」 |
| U-6 | `KIT_SPECTATOR_COUNT` 的權威預設（canon 0 vs 部署 5） | D-7 的 canon-vs-deploy 衝突；且屬容量／部署決策 |
| U-7 | A5–A10 是否可先於後端建置 dashboard 殼 | R2 鐵律預設「不做 mock 過渡」；且屬 `NOW.md` 排程權 |
| U-8 | 「無 active session 顯示靜態縮圖」是否仍為產品方向 | D-12 顯示該能力零實作且有雞生蛋依賴；若保留此方向，需先排 capture 能力 |
| U-9 | A1–A4 的 lease 語意是否固定為單一 primary | `a4-console-convergence` 已把 lease 綁定劃入 deferred 母版範圍 |

## A1–A10 viewer 架構：使用者陳述、已裁決事項與現況落差（2026-07-29）

> 記錄性質。本節**不新增 requirement、不改變本 change 的 capability 範圍**，也不對 A1–A10 授權任何實作。它存在的理由是：本 change 的 harness 明文「不在隔離 stack 內啟動 Kit / WebRTC / GPU runtime」（見 Non-goals），因此**下列 viewer 面全部落在本 harness 的覆蓋邊界之外**——把邊界寫清楚，才不會有人拿隔離 stack 的 functional evidence 去推論 3D／串流已驗證。

### 使用者陳述的目標架構（2026-07-29，逐字）

> 「A1~A4 是 primary 內嵌 webRTC viewer 並可分享 spectator，A5~A10 則是以 dashboard 但 3d viewer 跟 A1~A4 的顯示相似，可以是 nvidia kit webRTC primary 或 nvidia kit extensions 3d viewer editor」

### 使用者已裁決事項

**Q：「A5~A10 的 3d viewer 跟 A1~A4 的顯示相似」相似到哪一層？**
**A（使用者裁決）：只有外殼相似，runtime 分級。** A5–A10 沿用同一套 viewport 框／工具列／狀態列的視覺語言，但**預設不起自己的 Kit session**；有 active session 時以 spectator 唯讀掛入，無 session 時顯示靜態縮圖並誠實停用。

此裁決依 `docs/plans/docs-plans-README.md` §3.1（使用者最新明確指令 > 本目錄一切文件）為最高權威，記錄於此以免遺失。**惟其可行性受下列 C-1～C-6 約束限制，且 D-12（靜態縮圖能力零實作）為其未解前提。**

### 目標 vs 現況落差（唯讀查證，main `13033cb`）

| 使用者陳述 | 現況 | 機器證據 |
|---|---|---|
| 「A1~A4 是 primary 內嵌 webRTC viewer」 | UnifiedConsole 的 A1–A4 dock 內**無任何 WebRTC**；viewport 是 `data-prov="fixture"` 的靜態設計稿 PNG | `WorkspacePage.tsx:131` `design-assets/${VP_BASE[ws.dock]}.png`；`fixtures.ts:321-323`（a4 → `vp-semantic`）；該檔無 `<video>`／`iframe`／`EmbeddedViewer` |
| — | 全 repo 生產路徑唯一的 `<EmbeddedViewer>` 在 `ReviewSessionViewerPane.tsx:544`，且**硬編碼 `streamRole="primary"`**；僅出現於 legacy route `#a1-workbench`／`#gpu`／`#viewer` | `EdgeConsole.tsx:218,221-222`；`EmbeddedViewerProps.streamRole` 型別雖含 `"spectator"`（`EmbeddedViewer.tsx:64`）但生產路徑無人傳它 |
| 「並可分享 spectator」 | dock 上的「+ 邀請 Spectator」是 `u.toast()` **假複製**，無 `navigator.clipboard` 呼叫；canon 已具名此為 R3 誠實違規（見 D-8） | `WorkspacePage.tsx:108`；`openspec/specs/documentation-source-of-truth/spec.md:209` |
| — | 產給真人的 spectator 連結**不帶** `kitInstanceId`，而 lease 分配讓所有 spectator 落到同一 endpoint（見 D-9） | `pages.tsx:1102`；`viewerLeaseStore.ts:340-352`；`windowHelpers.ts:89-92` |
| 「A5~A10 則是以 dashboard」 | 現為靜態概念圖頁，掛 `data-prov="fixture"` ＋「Concept Preview / Roadmap」＋ Roadmap Phase P3（a5）／P4（a6–a10）。無 dashboard、無 KPI、無 3D | `ConceptPage.tsx:38,41,51`；圖源 `fixtures.ts:284-289` `uploads/ai-bim-geo-viewer-A5..A10.png` |
| 「可以是 nvidia kit webRTC primary」 | 全域**只有一個 Kit 進程、一個 stage**；spectator 是 primary 視角的鏡像，非獨立視角，且無自己的 GPU slot 或 stage | `bim-streaming-server/SYSTEM_DESIGN.md:443-452`；`start-all.ps1:194-196` 明禁「多 Kit ＋ spectator」組合 |
| 「或 nvidia kit extensions 3d viewer editor」 | repo **未建置**瀏覽器端非 WebRTC 的 3D viewer 能力 | `web-viewer-sample` 無 `three`／`web-ifc`／`@thatopen`／`xeokit`／`babylon` 相依；唯一非 WebRTC「viewport」是 `MockViewport.tsx` 自陳的「deterministic · no-GPU」資訊面板，非幾何 renderer。`ezplus.bim_review_stream.setup/config/extension.toml` 自述為「the setup extension for the **USD Viewer template**」（Kit 端 viewport setup，非瀏覽器 viewer）；`ezplus.bim_review_stream.messaging` 實為 host-native IFC→USD 轉檔與 runtime authority 宿主 |

### 經三層對抗驗證後仍成立的約束（任何未來實作 SHALL 先滿足）

| # | 約束 | 機器證據 |
|---|---|---|
| C-1 | **spectator 是唯讀鏡像，無法作為 A5–A10 的獨立 3D 視圖**。不能 focus／select／載入 stage，因此「點這條資料 → 3D 定位」在 spectator 路徑上做不到 | `Window.tsx:1763-1768` `if (isSpectatorStreamMode()) return false;`；`viewerLeaseStore.ts:252-254` 非 primary 回 `spectator_readonly`；`a4Handoff.ts:162` spectator 一律 reject |
| C-2 | **跨 session 切換必然重連**，且因全域單一 stage，切到非當前載入 stage 的 session 會顯示**別的模型**而 spectator 無權糾正——那是假畫面，比黑畫面更違反 R3 | lease 硬綁 session：`viewerLeaseStore.ts:229-234` `cross_session_lease`；`EmbeddedViewer.tsx:53-57` 契約明示「切換 session 用 `key={sessionId}` 強制乾淨 remount」；現行實作已照做：`ReviewSessionViewerPane.tsx:546` |
| C-3 | **route 切換會 unmount viewer**。若把真 viewer 放進 dock，`#a1`↔`#a4` 換 route 每次都重建 iframe。要避免必須把 viewer 提升到 `UnifiedShell` 之上或移除 `key={page}`——repo 內無此機制（全 repo `createPortal` 零命中，`UnifiedShell.tsx:205` 為 inline `{children}`） | `EdgeConsole.tsx:190` `<WorkspacePage key={page} …>`；註解 `:171` 自陳「key=page 讓 #a1→#a2 換 dock 時重建 local state」 |
| C-4 | **兩個面各自 claim primary 會 409**；且 lease 為 per-component-instance、unmount 即 `releaseViewerLease`，無 shell 層持有者。「A1–A4 共用單一 primary lease」是**需新建**的結構，不是現況 | `ReviewSessionViewerPane.tsx:177`（component-local state）、`:269-278`（cleanup 即 release）；`viewer-lease-principal.test.ts:287-288` 已驗第二次 claim 回 `409 primary_already_claimed` |
| C-5 | **A5–A10 的 dashboard 資料須依 R2 三態**；三態中無一允許「先建前端殼、後端 NOT_BUILT」 | `docs-plans-README.md` §3.3 R2：in-canon 可建者「一次建到位，預設不做 mock 過渡」；missing 者「NOT_BUILT，想做先走 R-A1 提案」 |
| C-6 | **無 admission control**，session 可無限建立且全部指向同一 kit.exe；容量承諾在 `gpu-session-baseline` 基準報告產出前為硬 gate 禁止事項 | 見 D-10；`openspec/changes/gpu-session-baseline-and-idle-reclaim/specs/gpu-session-baseline/spec.md:37`「無基準報告則 admission 參數 SHALL NOT 上線（硬 gate）」 |

### 本節與本 change 的關係

隔離 branch stack **不啟動 Kit／WebRTC／GPU**，因此上述 A1–A10 viewer 面**全部在本 harness 覆蓋範圍外**。本 change 的 evidence manifest 已規定 `stack_kind=isolated_branch_stack` 且「SHALL NOT 用它推論 design gate（pixel/semantic）或 deploy path verification 已通過」；本節再補一條同等強度的邊界：**SHALL NOT 用隔離 stack evidence 推論任何 A1–A10 的 3D／串流／spectator 行為已驗證**。該類 evidence 仍走既有 host-native Kit 契約。

實作歸屬：A1–A4 面歸 `a4-console-convergence`（active，0/23）；A5–A10 面在 `NOW.md` 黑名單內（「A5–A10 假後端／新 service」「A5–A10 全棧」），**未解禁前不得動工**。C-1～C-6 與 D-12 為使用者裁決落地前必須先處理的前提。

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

本 change 只做一件事：**把「未 merge branch 的 CPU governance／coordinator／browser operability evidence 在隔離 alt-port stack 取得」從口耳相傳升級為 spec 級、script-backed、machine-checkable 的契約**。Kit／WebRTC／GPU evidence 明確不在此總則內，仍由獨立 host-native 契約驗證。

## What Changes

- **新增 capability `isolated-branch-stack-verification`**：定義未 merge branch 的 CPU governance／coordinator／browser operability evidence 必須在隔離 stack 取得，且隔離 stack 與測試部署區的 port 集合 SHALL 不相交。
- **canonical port 配置與保留集合**：隔離 stack 固定 coordinator `:8005`／governance `:49103`／viewer dev `:5180`；parallel session offset 僅允許整數 `0..4`，其他值在 listener/cleanup 前拒絕；通過 domain 後 resolved port set 仍須與部署區及 Kit 保留集合做 fail-closed 交集檢查。
- **repo-owned backend launcher**：新增 `scripts/dev/start-isolated-branch-stack.ps1`（`start` / `stop` / `status`），只管理 governance／coordinator；viewer lifecycle 由 Playwright `webServer` 管理。caller 必須明示 `ChangeId`／`RunId`，每次 run 使用專屬 manifest 路徑且不得覆寫。backend cleanup 僅可停止 manifest PID、精確 launcher entrypoint、creation identity 全部重驗一致的 repo-owned process；未知 listener fail closed。
- **browser E2E 對接規則**：被引用為 evidence 的 E2E run SHALL 以 require-real 模式執行，並以必填 `E2E_STACK_MANIFEST` 綁定本 worktree、change/run ID 與 HEAD；manifest 的 coordinator base 與 viewer port 是 authority，對應 env 只能相同、不得指向另一 offset session；瀏覽器不得直連 governance internal port，且整場 zero request 打到保留集合。harness run 須揭露且不得作為真實控制面證據。
- **evidence 自我標示**：evidence manifest 記 `stack_kind=isolated_branch_stack`、resolved ports、base URLs、head commit sha、啟停時間、observed runtime IDs 與 screenshot/trace 路徑；其證明範圍只限 CPU governance/coordinator/browser operability。PR body SHALL 分開標示 Kit／WebRTC host-native evidence，且不得以隔離 stack 推論 design、deploy、first-frame、stage 或 DataChannel 已通過。
- **machine check**：新增 `scripts/tests/test-isolated-branch-stack.ps1`（port 集合不相交、offset 越界拒絕、registry 登記、doc section 存在、launcher 拒絕保留 port），接進 `.github/workflows/agent-governance.yml`。
- **文件落地**：在 `docs/agents/product-operability-and-script-contract.md` 新增「隔離 branch stack 驗證」一節，讓 `a4-console-convergence` task 4.1 的指標真的解析得到。

**明確不做（Non-goals）**：

- 不承接 `a4-console-convergence` 的 tasks 4.1–4.4 本身，也不改任何 A4 前後端實作。本 change 只提供 harness 與規則；A4 的 runtime evidence 仍由該 change 負責產出與判讀。
- 不改 `scripts/deploy.ps1` 的部署語意，不改 `scripts/dev/rebuild-test-deploy.ps1`（部署區驗證仍固定 freshly fetched `origin/main`）。
- 不在隔離 stack 內啟動 Kit / WebRTC / GPU runtime。3D、first frame、DataChannel、stage truth evidence 仍走既有 host-native Kit 契約，且不得由隔離 stack evidence 推論。
- 不放寬 design gate。隔離 stack 只產 CPU governance／coordinator／browser functional evidence；pixel diff 與 semantic states 仍由既有 design-system 路徑判定，Kit／WebRTC evidence 另走 host-native 契約。
- 不觸碰凍結面：`governance-service/app.py`、`bim-streaming-server/conversion_authority.py`、`bim-review-coordinator/src/routes/governanceProxy.ts`。

## Impact

- **Affected specs**：`isolated-branch-stack-verification`（新 capability，ADDED）。無既有 capability 被 MODIFY；`runtime-verification-evidence` 與 `test-deploy-rebuild-workflow` 的既有 Requirement 不變。
- **Affected code**：`scripts/dev/start-isolated-branch-stack.ps1`（新增）、`scripts/tests/test-isolated-branch-stack.ps1`（新增）、`scripts/script-registry.json`、`scripts/SCRIPT_CONTRACT.md`、`web-viewer-sample/playwright.config.ts`（base URL 解析改為對保留集合 fail-closed）、`web-viewer-sample/e2e/`（共用 require-real 與 forbidden-port helper）、`docs/agents/product-operability-and-script-contract.md`、`.github/workflows/agent-governance.yml`、`scripts/tests/test-ai-coding-metrics.mjs`（本 change 在 ledger 新增第 5 筆 active 會撞其對 `active-change-wip` 的硬編碼期望值，使 required check `agent-governance` 轉紅；已改為由同一份 ledger 推導 `activeChangeCount`。WIP 上限的真正 gate 在 `scripts/tests/verify-openspec-lifecycle.ps1`，未受影響）。
- **Repo/folder ownership**：`scripts/` 擁有 launcher 與 machine check；`web-viewer-sample/` 擁有 browser E2E harness 對接；`docs/agents/` 擁有 agent-facing 契約文字；`openspec/` 擁有本 spec。不跨越既有 service 邊界，不新增任何 runtime service 或對外 API。
- **與 `a4-console-convergence` 的關係**：本 change 是其 tasks 4.1–4.4 的 enabler。兩者 capability 不重疊（該 change 擁有 `a4-semantic-search`），不觸發 NoSuccessorWhilePredecessorOpen gate，可平行推進。本 change 尚未 merge 前，A4 若先行使用本 branch 的 launcher，PR body SHALL 揭露 harness 來源分支與 commit。
- **WIP 預算**：non-deferred active change 由 4 增為 5，仍在 `openspec/specs/governance-throughput-budget` 與 `verify-openspec-lifecycle.ps1` 的上限 6 之內。
- **NOW.md 揭露**：`docs/plans/NOW.md`（2026-07-23 working note）列「本週不做：新 OpenSpec」。使用者於 2026-07-29 明確要求開立本 change；依 NOW.md 自身的優先序（使用者最新口令 > 本檔），採納並於此揭露該偏離，同步更新 `openspec/lifecycle-ledger.json` 與 NOW projection。

## 相鄰既有缺口：design gate 現況（2026-07-29 唯讀查證；**不在本 change 範圍**）

上面 Non-goals 與 `design.md` §4 都寫「不放寬 design gate」。歷史時間線是 `13033cb` 紅燈、#429 `2b9573e` 重核轉綠、`bfcc433` 為當時 success 快照；本 change 的 fresh baseline 是 `deb5af552022c3ee171e3174f59c9f1e3dfb5936`，current status 必須在 PR 當下由實跑 job 重驗，不能從下表推論。表內【】只描述歷史分析快照；本節目的僅是防止 functional evidence 被誤讀為 design 覆蓋。

本 change **不修復**下列任何一項，也不改動 `docs/plans/design-system-reference.manifest.json`、`docs/plans/design-system-baseline/**` 或任何 R-A1 手寫正本面檔案。

| # | 觀察 | 機器證據（2026-07-29 / `13033cb`） | 歸屬 |
|---|---|---|---|
| D-1 | **【已解除，改列歷史】** `design-semantic-visual` 曾於 `13033cb` 為 FAILURE；#429（`2b9573e`）重核後，歷史快照 `bfcc433` 為 success。本表不宣稱 `deb5af5` 或 PR 當下狀態 | 紅燈期 CI run `30440400040`；歷史序列 `3f1edcf` failure → `2b9573e` success → `bfcc433` success；current status 由 PR job 重驗 | 已了結（後續衍生事項見 D-15） |
| D-2 | **【成因已了結，code 觀察仍成立】** 失敗成因是 **route IA 遷移**，不是樣式回歸；#429 之後 golden 已改描繪遷移後的產品面，本條由 live gap 轉為歷史成因紀錄。**（2026-07-29 對抗驗證修正）** 初版本欄寫「golden 描繪的 UI 已無任何路由可達」，該敘述不精確：A4 dock tab 與 `A4Dock` 元件**兩者都仍在**，只是面板被掏空為導流卡；不可達的是 golden 描繪的**已填充**的 A4 dock 面板 | `EdgeConsole.tsx` `UNIFIED_WS_KEYS = ["a1","a2","a3"]`（a4 自該陣列移除）；`#a4` → `AliasRedirect to "workspace?dock=a4"` → `<UnifiedShell page="ws" dock="a4"><A4SemanticSearchPage /></UnifiedShell>`。但 `fixtures.ts:178-184` 的 `dockTabs` 仍含 a4、`WorkspacePage.tsx:159` 仍渲染 `{ws.dock === "a4" ? <A4Dock/> : null}`、`docks.tsx:237-249` 之 `A4Dock` 現為 `data-prov="redirect"` 導流卡、`unified.test.tsx:44-50` 測試 pin 住「dockTabs 5 顆」與「A4 語意查詢」。manifest `workspace.a4.default` 仍釘 `production_routes: ["#a4"]` + `reference_action: click_exact_text "A4"`，golden PNG 自 `351ad96`（#340）起未變 | `a4-console-convergence` |
| D-3 | **【#429 後風險反轉】** `A4SemanticSearchPage` 未套 design token 與版面——此事實不變，但 #429 已把**未套 token 的產品面固化進 approved golden**：pixel gate 現在反過來**保護未設計狀態**，日後套 token（U-11／S4-D 類工作）會使 gate 轉紅，屆時需再走一次明示 rebaseline。原描述：（原生 `<select>`、瀏覽器預設 button、無卡片網格與 typography 階層），且其 IA 與設計正本不一致 | Hi-Fi 正本 `dockTabs = [a1, a2, a3, a4, issues]`——A4 在 canon 是 3D 工作區內的 dock；設計正本記 A4 ＝「NL query · Evidence Trace · 3D 高亮」。依 `docs/plans/docs-plans-README.md` §3 權威順序，前端視覺／互動面以 Hi-Fi ＋ `ai-bim-governance.css` 為最高權威 | IA 分歧＝`a4-console-convergence`。**token/版面套用的 owner 指派已撤回**——`migrate-console-to-hifi-design` 的 tasks 2.1–2.7／3.1–3.6 是列舉式封閉檔案清單，全檔對 `A4SemanticSearchPage` 命中數為 **0**，指派等於擴張該 change 的 scope。**需使用者裁決**：改 code 對齊 canon，或依 R-A1 提案改 canon（見 U-2） |
| D-4 | **R-A2 對 route IA 變更沒有合法跟隨路徑**（治理缺口）。**（2026-07-29 對抗驗證修正）** 此缺口為 **latent 而非 active**：目前結構性斷言全數仍成立，D-1 只是 pixel 失效；且封鎖不只一道，是**三道牆**。⚠ **「latent」是斷言狀態，不是優先序**。**（#429 後更新）** D-4 的緊急度歸零：#429 走的「就地重核 golden」第四條路（不增刪 `screens[]`、只換 bytes＋hash）**不觸發任何一道牆**，U-2(b) 的 re-scope 需求隨紅燈解除而消失。三道牆的斷言本身仍逐字成立（三檔皆未被 `13033cb..bfcc433` 改動），保留為未來 route IA 再變更時的參考 | (1) `capture-design-system-reference.mjs:331-354` 在 `--rebaseline` 時重算 `source.files` / `snapshot_sha256` / `captured_at_utc`、重截全部 baseline PNG，但**從不寫** `route_inventory` / `routes_without_approved_pixel_reference`（全檔 grep 該二鍵零命中），亦無法增刪 `screens[]` 成員。(2) `scripts/tests/verify-design-system-reference.ps1:280` 將 24 條 canonical route **hard-code** 於 `$expectedRoutes`，`:281` 斷言 count 相等、`:284` 斷言 sorted-join 集合相等（兩者合起來才等於逐字相等）——re-scope 必須同時改這個 gate 的判定邏輯。(3) `.github/workflows/ci.yml:386-390` 對移除 base-approved screen ID **fail-closed**（`Head manifest removed base-approved screen IDs`）。另：`verify-design-system-reference.ps1:279-299` 的 route_inventory 覆蓋與 approved↔screen 對映**目前全部仍成立**；`a4-semantic-search-model-qa/tasks.md:82` 已指名 A4 的合法路徑就是雙旗標 rebaseline。先例 `ca20a9c`（#349，2026-07-16）早於 R-A2 隨 `doc-first-canon-v2` 落地（提案 #360、**採納 #361**、2026-07-20 archive），非乾淨先例 | **需使用者裁決**。**初版指派候選 owner `align-frontend-design-system-reference` 已撤回**——「rebaseline ownership」正是該 change 解凍前必須裁決的四項互斥設計之一，指派 owner 等於預決 crosswalk 結論 |
| D-5 | pinned reference **未**漂移——「卡設計側核准」不適用於 `source.files` 面；但 repo 內正本副本與 pinned 快照分歧 | `C:\Repos\design\desigin-system` 對 `manifest.source.files` 23/23 hash MATCH（今日執行 rebaseline 對 `source.files` 為 no-op）。**⚠ 證據級別：此為單機本地查證，CI 無法複驗**——該路徑在 repo 外，且 `.github/workflows/ci.yml:386` 呼叫 `verify-design-system-reference.ps1` 時**未帶** `-VerifyOrigin`。repo 側：`AI-BIM 前後端設計文件.dc.html` 130,443 vs pinned 102,244；`AI-BIM Console Hi-Fi.dc.html` 90,553 vs 87,937；`support.js` 65,990 vs 64,222（`support.js` 另受 R-A3「永不手改」約束） | `migrate-console-to-hifi-design` task 6.4（**human owner only**） |

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
| `cross-service-structured-log-baseline` | deferred | 66/71（ledger 值；**stale**——#422 後 tasks.md 實為 92/93，見 D-17） | 無關（evidence-only） |

## 三層交叉對抗驗證（2026-07-29；**不改變本 change 的範圍**）

依使用者 2026-07-29 指令，對 D-1～D-5 衍生的設計問題執行三層交叉對抗驗證：**L1** 提出裁決草案 → **L2** 三個獨立驗證者以 refute-by-default 立場分別從 code truth／canon-governance／runtime-capacity 三個視角攻擊 → **L3** 仲裁。驗證基準 main `13033cb`，全程唯讀。

結果：**L1 的多數裁決被推翻**。以下誠實記錄，避免同一批錯誤結論被後續 agent 從對話紀錄撿回去重做。本節**不新增 requirement、不改變本 change 的 capability 範圍**，也不觸碰 manifest／baseline／R-A1 手寫正本面。

### 被推翻並撤回的裁決

| L1 裁決 | 撤回原因（機器證據） |
|---|---|
| **「改 code 對齊 canon：`UNIFIED_WS_KEYS` 恢復含 a4、A4 面板回 dock、viewport 改真 `EmbeddedViewer`」** | (a) **與指定 owner 的 tasks 直接對撞**：`a4-console-convergence/tasks.md` 3.3 逐字「`#/workspace?dock=a4` 成為唯一 canonical 操作面；不得留下第二套實作」、3.4／4.4「停用 Issue／3D」——#427 落地的正是 owner 自己的 task。(b) **無法閉合 D-1**：golden 由 `capture-design-system-reference.mjs:43-47` 自 `authority.authoring_origin` 擷取（可由 `DESIGN_SYSTEM_REFERENCE_ROOT` 覆寫，env 優先），即預設情形下 golden ＝ canon 投影，其畫面內含 `不符合 5 · 符合 7`／`12.48M tris · 1.17 GB`／`Streaming · 28 ms`；production 若「回 dock 但不放假數據」，pixel diff 對照的仍是含數字的 golden，`max_diff_pixel_ratio = 0.01` 永遠過不了。(c) **改 viewport 是偏離 canon 而非對齊**：canon 的 viewport 就是靜態圖（`WorkspacePage.tsx:131` 為 `data-prov="fixture"` 的 PNG），且 `align-frontend-design-system-reference` 非目標逐字禁止「對 live WebRTC/GPU frame 做 `<=0.01` pixel assertion」。(d) **blast radius 低估**：dock chrome（頂條／stage tree／viewport／DataChannel 字條）為 a1–a4 共用，改動會讓現行 PASS 的 `workspace.a1/a2/a3.default` 三個 screen 一併轉紅 |
| **「S3（#382）已交付 → A4 的 3D 高亮不是 vaporware」** | 偷換概念。#382 交付的是 **viewer 消費端**（`Window.tsx` 的 `_beginA4Handoff`，入口為 URL query `a4_handoff`）與 coordinator 建立 API（`a4HandoffRoutes.ts:309`）。`web-viewer-sample/` 全域搜 `a4-handoffs` 僅三處**全為 consume**，**無任何 UI 會 POST 建立 handoff**。A4 頁 UI 文案逐字自陳「此 legacy table 不建立 handoff、不送 DataChannel」「3D 動作維持停用」，且**不存在 3D 按鈕** |
| **「擴充 `capture-design-system-reference.mjs` 加第三旗標以 re-scope screens」** | 解方不完整且前提未觸發。見修正後的 D-4：三道牆中此解方只動第一道；另兩道（verifier hard-coded `$expectedRoutes`、CI base-approved screen fail-closed）未被涵蓋 |
| **「D-4 的候選 owner ＝ `align-frontend-design-system-reference`」** | 預決 crosswalk 結論。該 change 解凍前必須裁決的四項互斥設計逐字含「**rebaseline ownership**」 |
| **「A5–A10 共用一條 console-scoped spectator 連線，佔 1 個名額、保留 4 個給真人」** | 數值基準錯誤且機制不存在。active canon `documentation-source-of-truth/spec.md:208-209` 逐字「**KIT_SPECTATOR_COUNT 預設 MUST 為 0**」，coordinator `config.ts:278` 亦為 0；「5」僅存在於部署層（`deploy.ps1:699`、`compose.host-kit.yml:37`）與兩份互為鏡像的 agent skill（`.claude/skills/spec-to-done/ensure-host-native-ports-free.ps1:271` 與 `.codex/` 同名檔），而 `openspec/config.yaml:27-28` 明令 installed skills 不得定義 product requirement。另 `viewerLeaseStore.ts:348-360` 在**未帶 `preferredKitInstanceId`** 時使所有 spectator 落到 `bindings[1]`（`:354-357` 有 preferred 覆寫路徑），**無名額記帳**，「保留 4 個」無機制可執行 |
| **「A5–A10 dashboard 殼可先做」** | 以 R3 當建置許可——R3 管的是已建之物如何誠實標示，不是建置授權。**⚠ 惟原撤回理由「R2 三態無一允許」過度絕對，一併修正**：R2 第三態（設計正本 §08 R2 卡，`AI-BIM 前後端設計文件.dc.html:694-698`）逐字允許「In-canon ＋ 依賴外接引擎 → **不得已才 mock**（掛 ProvTag 誠實標示）」，且 active canon `documentation-source-of-truth/spec.md:183`（R-B5）逐字「**A5/A6/A10 SHALL 依逐元件拆分（in-repo 可建＝全棧；外接依賴＝mock 合法）**」。正確表述為：**in-repo 可建面不得 mock 過渡（「一次建到位」）；外接依賴面 mock 合法但須逐元件拆分並掛 ProvTag**。「整頁 dashboard 殼先做」不符任一態，故撤回結論仍成立，但依據須改用上述逐元件判定 |
| **「A1–A4 共用單一 primary lease（前瞻約束）」** | 降級為現況觀察。作為現況描述不成立：UnifiedConsole dock 內**無任何 WebRTC**（`WorkspacePage.tsx:131` 為 PNG），唯一 `<EmbeddedViewer>` 在 `ReviewSessionViewerPane.tsx:544` 且硬編碼 `streamRole="primary"`；lease 為 per-component-instance、unmount 即 `releaseViewerLease`，無 shell 層持有者。作為前瞻 SHALL 則撞 `a4-console-convergence` 明確不做清單（3.2–3.4 lease 綁定屬 deferred 母版）。另 L1 引用的「Hi-Fi 的 lease 膠囊位於 dock tabs 之上」經查為誤——`AI-BIM Console Hi-Fi.dc.html:186-193` 顯示兩者在**同一 flex row**，由 `flex:1` 推至右側 |

### 存活的結論

- **僅存的是現況陳述，沒有裁決存活。** 初版的「不採用 Kit extension 作為 A5–A10 的 3D 路徑」**亦已撤回**——它是對尚未建置之物做技術選型，屬產品／架構決定；且其依據（「本 repo 未建置該能力」）是**成本陳述而非否決依據**，同一論證可否定任何未建置路徑（含 WebRTC 那條）。選型移入 **U-10**。
  - 可保留的**現況事實**：`web-viewer-sample` 無 `three`／`web-ifc`／`@thatopen`／`xeokit`／`babylon` 相依；唯一非 WebRTC「viewport」是 `MockViewport.tsx` 自陳的「deterministic · no-GPU」資訊面板而非幾何 renderer；`ezplus.bim_review_stream.setup` 的 `extension.toml` 自述為「the setup extension for the **USD Viewer template**」（Kit 端 viewport setup），`ezplus.bim_review_stream.messaging` 實為 host-native IFC→USD 轉檔與 runtime authority 宿主（`conversion_authority.py`、`stage_loading.py`、`runtime_authority.py`）——該交付面**已在生產關鍵路徑上**，故任何採用它的方案代價是「擴充」而非「新增」。
- **D-1～D-13 維持為揭露，不升級為裁決**；本 change 維持 Non-goals 不變。

### 對使用者原始問題的回答（v2，2026-07-29 重跑輪改寫）：紅燈已由 #429 解除；本節 v1 的「無合法捷徑」結論**被實證推翻**

起點問題是「design rebaseline 怎麼辦——卡設計側核准（pinned reference 是唯讀權威）」。**歷史結論**：卡點不在「設計側核准」；pixel 紅燈於 `2b9573e`（#429）解除。當時 CI 序列為 `3f1edcf` failure → `2b9573e` success → `bfcc433` success；`bfcc433` 只代表該輪快照，不是 current main 或本 PR 狀態。

**誠實記錄：本節 v1 曾斷言「沒有『只補 A4 兩張圖就轉綠』的合法捷徑」，該結論錯誤。** #429 做的正是只補 A4 兩張圖。v1 三層論證的失效方式：

1. 「`capture-design-system-reference.mjs` 無 per-screen scope」——對該腳本為真（`web-viewer-sample/scripts/capture-design-system-reference.mjs:31` 只讀雙旗標，至今未變），**但 golden 不必由該腳本產生**。v1 漏看了另一條在 `13033cb` 當下就已存在的路徑：`web-viewer-sample/e2e/design-system-visual.spec.ts:153` 的 `DESIGN_SYSTEM_SCREEN_IDS` **本就支援 per-screen 篩選**——即 v1 論證 #1 在原 baseline 上即可被證偽，屬查證疏漏。
2. 「baseline 從 canon 擷取」——只對雙旗標腳本路徑成立。#429 的 `capture_runner` 是 `design-system-visual.spec.ts`（`page.screenshot()` 截**產品頁**），並在 manifest 寫入 `baseline_provenance.authority = "canonical_product_surface"`。
3. 「canon 未變 → 重截等價」——依附於 2，同時失效。

**留下的真問題**（見 D-15）：#429 的路徑不是 R-A2 的雙旗標路徑（PR body 未附雙旗標證據；`source.files`／`captured_at_utc` 未動），其正當性來自使用者明示授權（依 `docs-plans-README` §3.1 使用者指令＞一切文件，**不是違規**）；但這使 (a) R-A2 的「唯一寫入路徑」出現第二條 de facto 合法路徑待收編，(b) manifest 成為**混合權威**（12 screens 溯 canon、A4 溯產品面），(c) `a4-semantic-search-model-qa/tasks.md:82`「只用雙旗標腳本重新 capture `workspace.a4.default`」的指示與實際採用的路徑不一致，該 task 文字待修正。

### 對抗驗證新發現的缺口（D-6～D-13，皆不在本 change 範圍）

| # | 觀察 | 機器證據 | 歸屬 |
|---|---|---|---|
| D-6 | A4 → 3D handoff 的 **producer 端在前端不存在**，管線斷在 A4 這一側 | `a4HandoffRoutes.ts:309` 有 `POST /api/review-sessions/:sessionId/a4-handoffs`；`web-viewer-sample/` 內 `a4-handoffs` 三處全為 consume；`A4SemanticSearchPage.tsx:337-338/594-595/647-648` 逐字自陳停用 | **待裁決（U-11）**。初版註記「此為設計意圖內的現況，非缺陷」**已撤回**——那是產品裁決。事實是：`a4-console-convergence` tasks 3.4／4.4 逐字要求 table-only 停用 3D，而 D-3 所引設計正本記 A4 ＝「NL query · Evidence Trace · **3D 高亮**」。正本與 active change 的 tasks 直接衝突，是否保留 3D 高亮為交付目標只能由使用者裁決 |
| D-7 | **canon 記述與部署既成預設待對齊**（初版寫「衝突」，經複驗**降級**）：canon 要求正本記述 `KIT_SPECTATOR_COUNT` 預設為 0，部署層既成預設為 5 | canon `openspec/specs/documentation-source-of-truth/spec.md:209` 逐字「KIT_SPECTATOR_COUNT 預設 MUST 為 0**（開啟＝部署決策入部署說明）**」——括號內那句把「開啟」明確劃給部署決策。其父需求 `:197` **R-B6** 本文自陳「實作屬 follow-up `embedded-viewport`，不在本 change」，且 Scenario 的 WHEN 是「**正本記述**…」，規範對象是**正本文字**而非 deploy 層；`AI-BIM 前後端設計文件.dc.html:622` 亦把此政策整列歸在 CH-I／`follow-up embedded-viewport`。實測值：`config.ts:278` = 0；`scripts/deploy.ps1:699` = 5；`compose.host-kit.yml:37` = `${KIT_SPECTATOR_COUNT:-5}` | **待裁決（U-6）**：正本記述與部署預設如何對齊 |
| D-8 | **canon 已具名的 R3 誠實違規至今未修**：邀請連結為假複製，共**三處**（初版只點名一處） | canon `documentation-source-of-truth/spec.md:209` 逐字「邀請連結 **MUST** 真複製（`navigator.clipboard`；**現況 unified 假複製＝R3 違規列入改寫說明**）」——結尾「列入改寫說明」規定了其處置方式，初版漏引。違規處：`unified/WorkspacePage.tsx:108`（Spectator 邀請）、`unified/PipelinePage.tsx:128`（Spectator 邀請）、`unified/PipelinePage.tsx:123`（一般 viewer 連結），三者皆為 `u.toast(...)` 無 clipboard 呼叫。**參考實作已在同 repo**：`pages.tsx:1203` `void navigator.clipboard?.writeText(spectatorUrl)`（`:1216` 註解說明不可用時誠實降級）、`FailureScoreboard.tsx:17-18` 同模式 | **不需使用者裁決**——canon 已是 MUST、參考實作已存在、修法只動 `onClick` 為 **pixel-neutral**（不影響現行 PASS 的 a1/a2/a3 baseline）。缺的只是 owner 指派；**不在本 change 範圍，亦不由本 change 指派** |
| D-9 | **spectator 名額無記帳**：所有 spectator lease 一律落到同一個 endpoint | `viewerLeaseStore.ts:348-360` `chooseBindingForLease` 於非 primary 時回 `bindings[1] ?? bindings[0]`；`windowHelpers.ts:89-92` 取第一個非 primary。`49120`–`49150` 僅能以手動 URL `kitInstanceId=..._0N` 觸及。若 `KIT_SPECTATOR_COUNT=0`（canon 預設）則回落 `bindings[0]` ＝ primary 埠 | **待裁決**（容量／部署決策） |
| D-10 | **零 admission control**：session 可無限建立 | `bim-review-coordinator/src/services/kitPool.ts:51-60` 在**預設 `same_instance` 政策且 caller 未以 `kit_profile` 覆寫 `capacity_slots`** 時恆回長度 1 的 binding 陣列，使 `app.ts:1275-1282` 的 `409 No Kit capacity available` 不可達（`:26-27` 允許覆寫、`:29-31` `effectiveCapacitySlots <= 0` 回 `[]`、`:36-38` `dedicated_instance` 超額回 `[]`——三條路徑下 409 仍可達，故不可宣稱「永遠不可達」）；`bim-streaming-server/SYSTEM_DESIGN.md:176-179` 自陳 no GPU slot bookkeeping、no `/capacity` enforcement | **待裁決（U-12 → 併入 U-6 合併條目）**。初版指派 `gpu-session-baseline-and-idle-reclaim` **已撤回**——該 change 的 `## Impact`「明確不做」逐字列出「primary 佇列」，§Why 逐字「先量測、再談任何 admission／排程承諾」；指派給它等於替一個 active change 加它自己排除的工作 |
| D-11 | `dedicated_instance` 政策把 spectator port 當作獨立 Kit instance 發放，容量模型謊報 | `kitPool.ts:26,39-48` 於該政策下以 `endpoints.length` 為 slot 數，`endpoints` ＝ `[primary, spectator_01..05]`；但 `SYSTEM_DESIGN.md:446-452` 明說 spectator「view-only，不取得自己的 GPU slot 或 stage」。既有測試 `unit_kitpool.test.ts:225` 只驗 `kit_instance_id` 與 `signalingPort` 相異，**未驗其為獨立 runtime** | **待裁決** |
| D-12 | **靜態縮圖能力零實作**，且其唯一技術路線需佔用那唯一的 Kit/GPU（雞生蛋） | Kit app `ezplus.bim_review_stream.kit:18-38` 相依無 capture／thumbnail extension，`:61` `livestream.skipCapture = 1`；轉檔服務無 renderer（`SYSTEM_DESIGN.md:141-142`「Conversion-only: NOT Kit / NOT WebRTC」）；本 proposal 以外 tracked 檔案零命中 `usdrecord`；`sharp` 於所有 package.json／lockfile 零命中。**Pillow/PIL 的範圍須限縮**：四個產品服務目錄（`bim-streaming-server`／`bim-review-coordinator`／`web-viewer-sample`／`governance-service`）＋`scripts`＋`docs` 內零命中；`.claude/skills/omniverse-*/references/**` 與 `.codex/` 鏡像確有 14 處，但依 `openspec/config.yaml:27-28`（installed skills 不得定義 product requirement）不構成 product capability。現存可用作「縮圖」者只有 `public/design-assets/*.png` 設計稿（且該目錄被 `web-viewer-sample/.gitignore:31` 排除、由 `sync-design-assets.mjs` 產生，非 tracked）——用它冒充模型畫面即違反 R3 | **待裁決**（若採「無 session 顯示縮圖」的產品方向則必須先解此題） |
| D-13 | **【#429 後對 A4 已不成立；對其餘 12 screens 仍成立】** 「golden ＝ canon 投影且內含 fixture 數字」——`workspace.a4.default` 已由 #429 改溯**產品面**（manifest 新增 `baseline_provenance.authority = "canonical_product_surface"`、`capture_runner = "web-viewer-sample/e2e/design-system-visual.spec.ts"`，該 spec 以 `page.screenshot()` 截產品頁）；其餘 12 screens 仍由雙旗標腳本自 canon 擷取，原論證對它們仍適用。**衍生**：manifest 現為**混合權威**，且同一 A4 entry 內部不一致——`production_routes` 仍 `["#a4"]`、`reference_action` 仍 `click_exact_text "A4"`，但 `baseline_provenance.canonical_route` 為 `"#workspace?dock=a4"` | 舊路徑證據：`web-viewer-sample/scripts/capture-design-system-reference.mjs:43-47`（三層 fallback、env 優先；`origin_mode: read_only`）；canon-投影 golden 內含 `不符合 5 · 符合 7`／`12.48M tris · 1.17 GB`／`Streaming · 28 ms`／`Omniverse RTX · 60 FPS`；Hi-Fi 正本 grep `12.48M`×2、`不符合`×3、`28 ms`×2 | A4 面已由 #429 實質裁決（產品誠實面勝出）；**混合權威與 entry 不一致 → D-15** |
| D-14 | **harness 證據完整性缺口**（2026-07-29 重跑輪新增）：#422 使 Playwright dev server 注入 `VITE_VIEWER_HARNESS: "1"`（`web-viewer-sample/playwright.config.ts:34`），並新增 `fakeReviewSocket.ts`——假造的是 **coordinator review socket／authority ack 控制面**，在本 spec R5 既有禁止句（Kit/3D/串流）涵蓋範圍之外。閘門為雙重（`harnessConfig.ts:37-43`：build flag **且** `?harness=1` query，#422 反而收緊了閘門、production build 惰性），故實際暴露面＝**使用 `harnessRoute()` 的 E2E run**（9 檔）。design gate 的擷取面也已改走 harness route（`design-system-visual.spec.ts` 之 `page.goto(designHarnessRoute(route))`）——這是刻意的 deterministic 化，非缺陷，但意味 **golden 與 semantic 證據的 subject 頁面運行於 fake 控制面之上**，必須在 evidence 中可辨識。`fakeStreamer.ts` 為 #184 舊物、純協定替身不產像素（無 RTCPeerConnection/canvas；視覺輸出僅一枚文字徽章） | `playwright.config.ts:34`；`harnessConfig.ts:37-43`；`web-viewer-sample/src/harness/fakeReviewSocket.ts`（#422 新增）；`fakeStreamer.ts:65-69`＋`AppStream.tsx:345-353` | 本 change spec **R5** 增補 harness 揭露 Scenario（依治理形式審查改放 evidence 標示家族；見 tasks 3.6）；其餘面待裁決 |
| D-15 | **#429 baseline provenance 切換事件**（2026-07-29 重跑輪新增）：A4 golden 由 canon 投影改為產品面快照。正當性＝使用者明示授權（PR body「explicit user-authorized A4 baseline reapproval」；依 §3.1 使用者指令最高，**非違規**）。但留下四項待收編：(a) R-A2 的「SHALL 只由雙旗標腳本寫入」出現第二條 de facto 合法路徑（#429 未跑雙旗標、未動 `source.files`），建議日後以 R-A2 MODIFIED 收編「使用者授權之產品面重核」為正式路徑；(b) manifest 混合權威（12 canon ＋ 1 product）；(c) A4 entry 內部不一致（`production_routes`/`reference_action` vs `baseline_provenance.canonical_route`）；(d) `a4-semantic-search-model-qa/tasks.md:82` 指名的雙旗標路徑與實際採用路徑不一致 | #429＝`2b9573e`（3 檔：2 PNG＋manifest）；manifest `baseline_provenance` 區塊；CI failure→success 序列（`3f1edcf`→`2b9573e`→`bfcc433`） | **待裁決**（R-A2 收編與 manifest 一致化的排程） |
| D-16 | **spectator 分享安全模型缺口**（2026-07-29 重跑輪新增）：spectator 連結為裸 URL（無 token／期限／收件人識別／撤銷）；`/ui/open` 無 auth middleware 且不檢查 session status（`consoleRoutes.ts:44-70`）；`GET /api/runtime/status` 未認證即可列舉全部 session_id；`streamRole` 只在前端生效，持連結者可 POST `requested_role:"primary"` 於無人佔用時**提權為 primary**；UI 的「Reclaim stale spectator」「Force release」為 hardcoded `disabled`（`pages.tsx:449-450`）。coordinator 預設 bind `127.0.0.1` 但 `compose.host-kit.yml:7,56` 已放 `0.0.0.0`。#422 新增兩道 spectator 阻擋（`Window.tsx:1903`、`:1997-2003`「Structured-log delivery never upgrades a spectator into a primary」）**收窄了 spectator 能力但未觸及此提權路徑** | 連結構成：`pages.tsx:1102` → `coordinatorClient.ts:676`；lease claim 讀 body `requested_role`（`viewerLeaseStore.ts`） | **已依使用者委任裁決**（見 A3）：現階段限可信網段；token＋期限＋撤銷＋`/ui/open` 認證＋阻斷提權＝任何對外分享的前置需求 |
| D-17 | **ledger 對帳漂移**（2026-07-29 重跑輪新增）：`cross-service-structured-log-baseline` 的 `tasks.md` 經 #422 後實為 **92/93**，但 `openspec/lifecycle-ledger.json` 仍記 `66/71`（#422／#429／#430 皆未更新 ledger）。本表 §歸屬依據引用的 66/71 為 stale。不在本 change 內代改（該 change 的 closeout 義務） | `git diff 13033cb..bfcc433 -- openspec/lifecycle-ledger.json` 為空；該 change tasks.md 現況勾選數 | `cross-service-structured-log-baseline` closeout |

### 精煉後的待使用者裁決清單

以下皆為產品／設計方向、凍結面解凍或正本改寫，經三層驗證確認**不可由工程判斷關閉**。

| # | 待裁決事項 | 為何只能由你決定 |
|---|---|---|
| U-1 | **canon 的 fixture 數字 vs R3 誠實鐵律，哪一邊讓步** | D-13 證明兩者在 pixel gate 下結構性互斥。這是價值取捨，不是工程問題。此題是 D-1／D-3 的真正根節點 |
| U-2 **[已由 #429 實質處置—使用者授權；衍生 D-15]** | A4 的處置：(a) 依 R-A1 提案改 Hi-Fi 使 A4 畫面誠實化後 rebaseline；(b) 將 `workspace.a4.default` 降為 `reference_missing`（需先解 D-4 三道牆）；(c) 維持紅燈並接受 | 三條路分別通向正本改寫、CI gate 判定邏輯變更、或長期紅燈 |
| U-3 | 是否授權執行 `migrate-console-to-hifi-design` ↔ `align-frontend-design-system-reference` 的 requirement／successor crosswalk | 它是 D-4 與 rebaseline ownership 的唯一解鎖鑰匙；兩個 change 的 proposal 與 `NOW.md:57/77` 都把它設為 frozen 解除前置 |
| U-4 | 是否以 OpenSpec `## MODIFIED` 擴充 R-A2（第三旗標語意） | 動的是 `design-canon-change-control` 的 spec 語意，且需開新 OpenSpec ⇒ 撞 `NOW.md:37` 黑名單，只有使用者口令能解 |
| U-5 | `verify-design-system-reference.ps1:280` 的 hard-coded `$expectedRoutes` 是否可動 | align-frontend 明文「沒有 crosswalk 不得修改 branch-protection gate」——該條文指的是**未來**要把 design gate 升為 required context 的計畫（其 `tasks.md:24` 逐字「在 current subject gate 可執行且綠燈後，才更新 branch-protection required contexts」），故現在動它同樣落在 crosswalk 前禁區 |
| U-6 **[合併主條目—見 Q&A 節總表；仍待裁決]** | `KIT_SPECTATOR_COUNT` 的權威預設（canon 0 vs 部署 5） | D-7 的 canon-vs-deploy 衝突；且屬容量／部署決策 |
| U-7 **[方向已由 AI-裁決 A4 回答（可推翻）；排程保留]** | A5–A10 的 `ConceptPage` **是否升級為有資料的 dashboard**（殼已存在且已誠實，非「可否先建殼」） | 現況：`EdgeConsole.tsx:176` `UNIFIED_CONCEPT_KEYS = ["a5"…"a10"]` → `ConceptPage`，掛 `data-prov="fixture"` ＋ Roadmap P3/P4、不打任何 `/api`，且有 E2E 釘住。升級屬 R2 三態判定 ＋ `NOW.md` 排程權 |
| U-8 **[已關閉—AI-裁決 A7（可推翻）]** | 「無 active session 顯示靜態縮圖」是否仍為產品方向 | D-12 顯示該能力零實作且有雞生蛋依賴；若保留此方向，需先排 capture 能力 |
| U-9 **[已關閉—事實更正：viewer-viewport approved spec 已定案；實作排程不在此關閉]** | A1–A4 的 lease 語意是否固定為單一 primary（＝ C-4 的規範化） | `a4-console-convergence` 已把 lease 綁定劃入 deferred 母版範圍 |
| U-10 **[部分回答—A2/A5（可推翻）]** | **A5–A10 的 3D 路徑選型**（Kit WebRTC spectator／Kit extension 出圖／其他／暫不選） | 初版曾以「本 repo 未建置該能力」為由裁決「不採用 Kit extension」——該理由是**成本陳述而非否決依據**（同一論證可否定任何未建置路徑），且 A5–A10 在 `NOW.md:37/185` 黑名單內。**該裁決已撤回**，選型退回使用者 |
| U-11 | **A4 是否保留「3D 高亮」為交付目標** | D-3 引用的設計正本記 A4 ＝「NL query · Evidence Trace · **3D 高亮**」，而 D-6 顯示 producer 端不存在且 `a4-console-convergence` tasks 3.4／4.4 逐字要求 table-only 停用 3D。正本與 active change 的 tasks 直接衝突，只能由你裁決哪一邊為準 |
| U-12 **[→ 併入 U-6 合併條目]** | **D-10（零 admission control）的 owner** | 初版曾指派 `gpu-session-baseline-and-idle-reclaim`。該 change 的 `## Impact`「明確不做」逐字列出「**primary 佇列**」，§Why 逐字「先量測、再談任何 admission／排程承諾」——指派給它等於替一個 active change 加它自己排除的工作。**該指派已撤回** |

## 使用者委任 AI 裁決（Q1–Q8 → A1–A8；2026-07-29；三層交叉驗證）

> 本節 A1–A8 為 AI 依使用者 2026-07-29 委任（「指派多 agents＋三層交叉驗證來回復所有問題」，委任紀錄見 `docs/plans/NOW.md` 2026-07-29 變更紀錄）產出之裁決記錄。**非使用者原話；可被使用者單方推翻；不構成 canon／手寫正本；不新增任何 Requirement 或 SHALL。** 效力位階低於使用者任何一句明確指令；與手寫正本或 approved spec 衝突時以後者為準。
> 歷史驗證方法：L1 提案 → L2 雙視角 refute-by-default（事實/spec 一致性＋治理形式）→ L3 仲裁；該輪 baseline origin/main 為 `bfcc433`，不代表目前 baseline。A1/A3/A6/A7/A8 照案通過；A2/A4/A5 依 L2 事實攻擊修正後落地。

### A1 —「editor」＝ canon 既有的 editor lease（視圖控制權），非 USD 編輯器
- **問題**：使用者原話「nvidia kit extensions 3d viewer editer」的 editor 指哪一種？
- **AI-裁決（使用者委任 2026-07-29，可推翻）**：解讀為「持 editor lease 的 primary viewer」——可 focus／highlight／select／載入 stage，不修改模型、不 authoring、不存檔。若日後要真 USD authoring，屬新產品方向須另立 change。
- **依據**：`runtime_authority.py:12-22` `MUTATING_EVENTS` 恰 9 個、全為 stage 載入與視圖操作、目錄封閉（`:242-243` 目錄外一律拒絕）；全 `openspec/specs` grep "editor" 僅 4 處全為 lease 語意；canon 三處 editor（`useViewerRoleState(editor/spectator gate)` 等）皆 lease 角色。
- **對清單的影響**：U-11 的評估基準確定（「3D 高亮」依 editor-lease 語意評估），U-11 本身仍待使用者裁決。

### A2 — A5–A10 不起自己的 primary；原話的「kit webRTC primary」選項退場
- **問題**：原話「可以是 nvidia kit webRTC primary」與其後裁決「預設不起自己的 Kit session」衝突，以何者為準？
- **AI-裁決（可推翻）**：以較晚的使用者裁決為準，primary 選項標記 superseded。A5–A10 需「點資料 → 3D 定位」時走「跳轉 A1–A4 workspace ＋ 既有 handoff」。
- **依據（L2 修正後）**：**注意——spec 字面並不禁止 A5–A10 起 primary**（`viewer-viewport:8` 的單一 primary 條款主詞是 Workspace `#a1..#a4`）；禁令來源是 (a) 使用者裁決逐字「Kit 容量：不新增 primary，只吃 spectator 名額」，(b) 容量物理：Kit 每 signaling endpoint 單 viewer、單卡 8GB、無 admission control（D-10）、二次 claim 409（`app.ts:1823-1826`）。
- **對清單的影響**：U-10 的 primary 選項關閉。

### A3 — spectator 分享限可信網段；token／期限／撤銷列為對外開放前置
- **AI-裁決（可推翻）**：現階段 spectator 連結明文限定同 LAN／可信網段。invite token＋期限＋撤銷＋`/ui/open` 認證＋阻斷 claim 時角色升級，列為任何對外分享情境的前置需求，本輪不實作。
- **依據**：D-16（新 baseline 重驗全數成立）。提權路徑精確描述：`requested_role:"primary"` 於 **primary 空缺或 TTL（45s）過期時**可無憑據取得 primary（有 active primary 時 409）；#422 的 `authorizeActive` 與兩道 spectator 阻擋擋的是 mutating 指令執行，**不擋 claim 時的角色升級**；local-dev auth 接受任意非空 token。
- **對清單的影響**：D-16 處置欄更新為本裁決。

### A4 — dashboard 資料：A5 先行，A6–A10 維持 ConceptPage
- **AI-裁決（可推翻）**：方向＝A5 最先（`spatial-tree/for-session` 已存在：`governanceProxy.ts:321-342`＋governance `/api/spatial-tree` 已實作有測試；感測 feed 依 canon `:775` 為 `external-mock-legit`，mock＋ProvTag 合法）。A6–A10 維持誠實 ConceptPage。啟動時機歸 NOW.md 排程權——本答案定方向，不排程。
- **啟動時須有意識修改的機器牆（L2 修正後）**：(1) `design-system-semantic-cases.ts` 的 concept.a5 case 族（`:723` disabled case、`:697`「本頁為概念稿」、`:696`「Concept Preview / Roadmap」錨點）；(2) **`concept.a5.default` 的 pixel golden**（manifest 13 screens 之一，需明示 rebaseline）。`a9-a10-identity-a4-primary.spec.ts:30` 的 zero-`/api` 牆只綁 `#a9`，屬 A9/A10 啟動時的牆。
- **對清單的影響**：U-7 的方向面已回答；排程面保留。

### A5 — spec 分歧消解：MODIFIED delta 是使用者裁決落地的**必要前提**
- **問題**：使用者裁決「A5–A10 以 spectator 唯讀掛入（內嵌）」與兩份 approved spec 的關係。
- **AI-裁決（L2 修正後，可推翻）**：A1–A4 範圍以 `viewer-viewport` 為準（workspace 內嵌面只有 primary；spectator 邀請一律外開連結）。**A5–A10 的內嵌 spectator 與 `viewer-viewport:24` 字面衝突**——該句「spectator SHALL 不內嵌於 console」的主詞是未限定的 console（僅 Requirement 1 有 `#a1..#a4` scope；此句沒有），A5–A10 頁面屬 console，故在 MODIFIED delta 把該句的 "console" 收窄為「A1–A4 workspace 面」之前，內嵌 spectator 屬 **spec-nonconforming**。MODIFIED delta（同時對 `documentation-source-of-truth` R-B6 澄清條件句語意）是**必要前提**，非事後 formalization。本 PR 只記錄，不下 delta。
- **依據**：`viewer-viewport/spec.md:24` 逐字；`documentation-source-of-truth/spec.md:209` 經完整上下文（`:197-210`）判讀為 R-B6 Scenario 的 THEN 條件句（「若記述內嵌 spectator 則 MUST 用 streamRole=spectator」），非正面授權——初版 E-2 的「矛盾」據此降級為「條件句造成的詞彙張力」。
- **對清單的影響**：U-10 的 spectator 選項附帶前提（先過 MODIFIED delta）。

### A6 — `embedded-viewport` 應開立為 A1–A4 內嵌實作 owner；不在 #428 開
- **AI-裁決（可推翻）**：canon R-B6（`documentation-source-of-truth/spec.md:199`「實作屬 follow-up `embedded-viewport`，不在本 change」）與設計文件 CH-I（`:622`）指名的 change 應該存在——它是使用者陳述 A1–A4 半邊的承接者，現為無主債務。開立動作撞 `NOW.md:37` 黑名單與 WIP=6 上限（現 5），留給使用者口令或下輪排程；本 PR 只記錄。

### A7 — 縮圖＝fixture 佔位（approved spec 既定），非模型算圖
- **AI-裁決（可推翻）**：「無 session 時顯示靜態縮圖」落地為 `viewer-viewport/spec.md:24` 已規定的「啟動前 viewport SHALL 顯示離線示意（fixture）」。D-12 的雞生蛋在此定義下不存在，改為僅在未來有人要求「真實模型算圖」時適用的事實封存。
- **對清單的影響**：U-8 關閉（AI-裁決，可推翻）。

### A8 —「外殼相似」驗收：同一組 viewport 元件視覺；spectator 模式全部 mutating 控制誠實 disabled，僅 fullscreen 可用
- **AI-裁決（可推翻）**：A5–A10 的 3D 區沿用 `viewer-viewport/spec.md:62` 四鈕（`⬒` frame all／`✥` pan／`◫` dual／`⟲` reset）與狀態列視覺，但 spectator 模式下四鈕**一律誠實 disabled**（掛說明），僅 fullscreen（瀏覽器 Fullscreen API，client-local）可用。
- **依據（L2 確認）**：DataChannel 指令目錄無 frame-all 事件，最接近路徑 `focusPrimRequest` 在 `MUTATING_EVENTS` 內、被 server（`spectator_readonly`）＋client（`Window.tsx:1771`）雙重擋下；spectator stream 是同一 Kit process 的鏡像 endpoint，無獨立相機，任何 reframe 都改動共享畫面——**全禁正確**（早前 X3 建議保留 ⬒ 經查為誤）。`◫` 本就對所有角色 disabled 標 Roadmap。
- **對清單的影響**：為 A5–A10 的 pixel／semantic gate 提供可撰寫的驗收定義。

### 清單狀態變動總表

| 條目 | 處置 | 類型 |
|---|---|---|
| U-2 | 已由 #429 實質處置（使用者授權的第四條路；衍生事項 D-15） | 事實更正 |
| U-7 | 方向面已回答（A4：A5 先行）；排程面保留 NOW.md | AI-裁決（可推翻） |
| U-8 | 關閉 | AI-裁決 A7（可推翻） |
| U-9 | 關閉（規範面已由 `viewer-viewport` approved spec 定案；實作排程不在此關閉） | 事實更正 |
| U-10 | 部分回答：primary 選項關閉（A2）；spectator 選項附前提（A5：先過 MODIFIED delta） | AI-裁決（可推翻） |
| U-6＋U-12（參 D-9／D-11） | 合併為 U-6「spectator 容量與 endpoint 模型」單一條目：權威預設（canon 0 vs 部署 5，D-7）＋名額記帳與 **fallback 至 primary endpoint**（D-9）＋`dedicated_instance` 容量謊報（D-11）＋admission control owner（原 U-12／D-10）；E-7 收精為「`multi-artifact-kit-routing` 之下 single-kit multi-viewer evidence 永久無法判 passed」 | 簿記整併；**仍待使用者裁決** |
| U-1／U-3／U-4／U-5／U-11 | 維持待使用者裁決 | — |

## A1–A10 viewer 架構：使用者陳述、已裁決事項與現況落差（2026-07-29；重跑輪補 approved spec 對照）

> **重跑輪關鍵更正（F-1）**：本節初版漏引兩份 **approved active spec**——`openspec/specs/viewer-viewport/spec.md` 與 `openspec/specs/embedded-viewer-bridge/spec.md`（由 `2026-07-21-viewer-redesign`／PR #376 落地）。前者已對使用者陳述的 A1–A4 半邊做出 SHALL 級規定：`#a1..#a4` 共用「單一 IFC → 單一 review session → 單一**內嵌 primary viewport**」、切換不 unmount、editor lease 單佔（`:8`）；啟動前 viewport 顯示離線示意 fixture、**spectator 不內嵌於 console**、邀請一律 `/ui/open` 外開連結（`:24`）；四鈕語意（`:62`）。**A1–A4 半邊因此多屬「已定案待實作」，真正未定的是 A5–A10 半邊**——但 `documentation-source-of-truth/spec.md:209` 又有「內嵌 spectator MUST 用 `streamRole=spectator`」的語彙，與 `viewer-viewport:24` 的「不內嵌」存在分歧（消解見 A5 答案）。canon R-B6 與設計文件 CH-I 指名的承接 change `embedded-viewport` 於 `openspec/changes/` **不存在**＝A1–A4 半邊現為無主債務（見 A6 答案）。

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
| — | 產給真人的 spectator 連結**不帶** `kitInstanceId`，而 lease 分配讓所有 spectator 落到同一 endpoint（見 D-9） | `pages.tsx:1102`；`viewerLeaseStore.ts:348-360`；`windowHelpers.ts:89-92` |
| 「A5~A10 則是以 dashboard」 | 現為靜態概念圖頁，掛 `data-prov="fixture"` ＋「Concept Preview / Roadmap」＋ Roadmap Phase P3（a5）／P4（a6–a10）。無 dashboard、無 KPI、無 3D | `ConceptPage.tsx:38,41,51`；圖源 `fixtures.ts:284-289` `uploads/ai-bim-geo-viewer-A5..A10.png` |
| 「可以是 nvidia kit webRTC primary」 | 全域**只有一個 Kit 進程、一個 stage**；spectator 是 primary 視角的鏡像，非獨立視角，且無自己的 GPU slot 或 stage | `bim-streaming-server/SYSTEM_DESIGN.md:443-452`；`start-all.ps1:194-196` 明禁「多 Kit ＋ spectator」組合 |
| 「或 nvidia kit extensions 3d viewer editor」 | repo **未建置**瀏覽器端非 WebRTC 的 3D viewer 能力 | `web-viewer-sample` 無 `three`／`web-ifc`／`@thatopen`／`xeokit`／`babylon` 相依；唯一非 WebRTC「viewport」是 `MockViewport.tsx` 自陳的「deterministic · no-GPU」資訊面板，非幾何 renderer。`ezplus.bim_review_stream.setup/config/extension.toml` 自述為「the setup extension for the **USD Viewer template**」（Kit 端 viewport setup，非瀏覽器 viewer）；`ezplus.bim_review_stream.messaging` 實為 host-native IFC→USD 轉檔與 runtime authority 宿主 |

### 經三層對抗驗證後仍成立的記錄性限制（非本 change requirement）

| # | 約束 | 機器證據 |
|---|---|---|
| C-1 | **spectator 是唯讀鏡像，無法作為 A5–A10 的獨立 3D 視圖**。不能 focus／select／載入 stage，因此「點這條資料 → 3D 定位」在 spectator 路徑上做不到 | `Window.tsx:1882-1886` `if (isSpectatorStreamMode()) return false;`；`viewerLeaseStore.ts:260-262` 非 primary 回 `spectator_readonly`；`a4Handoff.ts:162` spectator 一律 reject |
| C-2 | **跨 session 切換必然重連**，且因全域單一 stage，切到非當前載入 stage 的 session 會顯示**別的模型**而 spectator 無權糾正——那是假畫面，比黑畫面更違反 R3 | lease 硬綁 session：`viewerLeaseStore.ts:237-242` `cross_session_lease`；`EmbeddedViewer.tsx:53-57` 契約明示「切換 session 用 `key={sessionId}` 強制乾淨 remount」；現行實作以複合鍵落實：`ReviewSessionViewerPane.tsx:546` `key={`${sid}:${activePrimaryLease.lease_id}`}`（符合 embedded-viewer-bridge R3 的 sessionId+leaseId） |
| C-3 | **【重定性：approved spec 要求 vs 現況的落差，非單純約束】** approved spec `openspec/specs/viewer-viewport/spec.md:8` 已 SHALL 要求 unified Workspace（`#a1..#a4`）切換時**同一 DOM 節點不 unmount**、lease 維持同一 `lease_id`（`:13`）；但現況 `key={page}` 使 `#a1`↔`#a4` 換 route 必 unmount 整棵子樹，且 repo 內無 hoist 機制（全 repo `createPortal` 零命中，`UnifiedShell.tsx:205` 為 inline `{children}`）。實作該 spec 者必須把 viewer 提升到 `UnifiedShell` 之上或移除 `key={page}` | spec：`viewer-viewport/spec.md:8,13`。現況：`EdgeConsole.tsx:190` `<WorkspacePage key={page} …>`；註解 `:171` 自陳「key=page 讓 #a1→#a2 換 dock 時重建 local state」 |
| C-4 | **兩個面各自 claim primary 會 409**；且 lease 為 per-component-instance、unmount 即 `releaseViewerLease`，無 shell 層持有者。「A1–A4 共用單一 primary lease」是**需新建**的結構，不是現況 | `ReviewSessionViewerPane.tsx:177`（component-local state）、`:269-278`（cleanup 即 release）；`viewer-lease-principal.test.ts:294-295` 已驗第二次 claim 回 `409 primary_already_claimed` |
| C-5 | **A5–A10 的 dashboard 資料須依 R2 三態**；三態中無一允許「先建前端殼、後端 NOT_BUILT」 | `docs-plans-README.md` §3.3 R2：in-canon 可建者「一次建到位，預設不做 mock 過渡」；missing 者「NOT_BUILT，想做先走 R-A1 提案」 |
| C-6 | **無 admission control**，session 可無限建立且全部指向同一 kit.exe；容量承諾在 `gpu-session-baseline` 基準報告產出前為硬 gate 禁止事項 | 見 D-10；`openspec/changes/gpu-session-baseline-and-idle-reclaim/specs/gpu-session-baseline/spec.md:37`「無基準報告則 admission 參數 SHALL NOT 上線（硬 gate）」 |

### 本節與本 change 的關係

隔離 branch stack **不啟動 Kit／WebRTC／GPU**，因此上述 A1–A10 viewer 面全部在本 harness 覆蓋範圍外。此處只記錄分析限制，不替 A1–A10 新增 requirement；本 change 唯一相關的規範性邊界已在 delta spec 定義：隔離 stack evidence 不得作為任何 3D／串流／spectator 行為的驗證，該類 evidence 仍走既有 host-native Kit 契約。

實作歸屬：A1–A4 面歸 `a4-console-convergence`（active，0/23）；A5–A10 面在 `NOW.md:37/185` 黑名單內（「A5–A10 全棧」「A5–A10 假後端／新 service」），**未解禁前不得動工**。C-1～C-6 與 D-12 為使用者裁決落地前必須先處理的前提。

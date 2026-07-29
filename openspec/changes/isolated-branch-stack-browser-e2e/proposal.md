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
| D-2 | 失敗成因是 **route IA 遷移**，不是樣式回歸。golden 描繪的 UI 已無任何路由可達 | `EdgeConsole.tsx` `UNIFIED_WS_KEYS = ["a1","a2","a3"]`（a4 已移除）；`#a4` → `AliasRedirect to "workspace?dock=a4"` → `<UnifiedShell page="ws" dock="a4"><A4SemanticSearchPage /></UnifiedShell>`。manifest `workspace.a4.default` 仍釘 `production_routes: ["#a4"]` + `reference_action: click_exact_text "A4"`，其 golden PNG 自 `351ad96`（#340）起未變，描繪的是 `WorkspacePage` 的 A4 dock | `a4-console-convergence` |
| D-3 | `A4SemanticSearchPage` 未套 design token 與版面（原生 `<select>`、瀏覽器預設 button、無卡片網格與 typography 階層），且其 IA 與設計正本不一致 | Hi-Fi 正本 `dockTabs = [a1, a2, a3, a4, issues]`——A4 在 canon 是 3D 工作區內的 dock；設計正本記 A4 ＝「NL query · Evidence Trace · 3D 高亮」。依 `docs/plans/docs-plans-README.md` §3 權威順序，前端視覺／互動面以 Hi-Fi ＋ `ai-bim-governance.css` 為最高權威 | IA 分歧＝`a4-console-convergence`；token/版面套用＝`migrate-console-to-hifi-design`。**需使用者裁決**：改 code 對齊 canon，或依 R-A1 提案改 canon |
| D-4 | **R-A2 對 route IA 變更沒有合法跟隨路徑**（治理缺口） | `design-canon-change-control` R-A2 規定機器快照面只能由 `capture-design-system-reference.mjs --rebaseline --confirm-rebaseline` 寫入；但該腳本只重算 `source.files`、`screens[].baselines[].sha256`、`baseline_snapshot_sha256`、`captured_at_utc`（`capture-design-system-reference.mjs:331-354`），**無法增刪 `screens[]` 成員，也無法改 `route_inventory` / `routes_without_approved_pixel_reference` 歸屬**。先例 `ca20a9c`（#349）曾手改 `production_routes`（`pipeline.default` 由 `#conv` 改掛 `#pipeline`），但早於 R-A2 落地的 #360，非乾淨先例 | **需使用者裁決**；候選 owner `align-frontend-design-system-reference`（deferred／frozen、0/23） |
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

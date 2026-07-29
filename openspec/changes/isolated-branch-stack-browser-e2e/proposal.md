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

# unified-console-runtime-truth Slice 2 Implementation Plan

**For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development

**Goal:** 讓 canonical-linux 的 LAN operator 能以 operator token 通過四條 `/api/conversion/*` 控制路由（IP allowlist **或** token，token 路徑限速 10/分鐘），同時在 canonical-linux 以 `ENABLE_DEV_ROUTES=false` 關閉 `/api/dev/*`（整組 404），且依賴 dev routes 的 Edge Console 頁在 404 時誠實顯示「dev routes 已關閉」而非崩潰或假資料。

**Architecture:** 後端在 `bim-review-coordinator/src/app.ts` 的 `createCoordinatorApp` 內以 **per-route wrapper**（新模組 `src/services/conversionControlAuthorization.ts` 提供 `createConversionControlGuard`：IP 允許 → 逐字不變放行；否則 token 路徑：`isOperatorTokenPathEnabled` 判定預設 `dev-token` 即 fail-closed、`SlidingWindowRateLimiter` 每來源 IP 10/分鐘 → 429＋`Retry-After`、`isKitMutationAuthorized` 同型比對）取代四條控制路由上的 `rejectIfIpNotAllowed(...)` 呼叫；`rejectIfIpNotAllowed` 本體不改，lineage source-bundle 路由（deps 注入）與 `/api/external/*` 授權以釘樁測試證明逐字不變。D3 以 `app.use("/api/dev", ...)` prefix gate（讀既有 `devRoutesEnabled()`）讓 `/api/dev/*` 整組 404（含 `routes/devMeta.ts` 的 `test-data-projects`），`compose.host-kit.yml` 透傳 `ENABLE_DEV_ROUTES: ${ENABLE_DEV_ROUTES:-}`，parity guard 沿用 PR #693 模式。前端 `coordinatorClient.jsonGet` 改丟帶 `status` 的 `CoordinatorHttpError`（message 逐字不變），**canonical scenario 明列的兩頁**——`RealIfcConsolePage`（`#demo-control`，`/api/dev/ifc-sources*`）與 `A1GovernanceWorkbenchPage`（A1 workbench local_fs／測試資料清單，`/api/dev/test-data-projects`）——在 404 時渲染「dev routes 已關閉（canonical-linux）」誠實狀態。`/api/dev/conversions` 消費者（`useConversionData`／`GlobalConversionPane`／`ConversionHistoryPanel`／`ConversionPage`，頁面為 `#conv`／`#minio`）**不在本 PR 範圍**：canonical scenario 與 canonical `design.md` §2.4 都只列上述兩頁，Task 9 因此改為 **HELD／待 owner D5 裁決**（證據與裁決選項見 Task 9 節）。

**Tech Stack:** Node 20／TypeScript 5.7／Express 4／vitest 2＋supertest 7（`bim-review-coordinator`）；React 18＋Vite＋vitest（jsdom）＋Playwright（`web-viewer-sample`）；Docker compose（`compose.host-kit.yml`）；GitNexus 1.6.9 CLI；OpenSpec CLI 1.6.0。

---

## 0. 執行者零脈絡導航（先做，再動手）

> **Task 編號對照（coordinator 2026-08-25 合併後）**：原 Task 1、2 → **Task 1**；原 Task 3、4 → **Task 2**；原 Task 5、6 → **Task 3**；原 Task 7、8、10 → **Task 4**；原 Task 11、12 → **Task 5**；原 Task 9 為 HELD 保留稿（Appendix A，不是 task）。文中所有「Task N Step M」引用一律指**原**編號，各子段標題已標「原 Task N」。合併原因：std-implement 每 task 必須至少一個 commit（原 Task 1 無檔案變更），且 run 剩餘 agent 額度不足以支撐 11 個 task。

- worktree 根：`C:/Repos/active/iot/AI-BIM-governance.worktrees/unified-console-runtime-truth-s2`，branch `codex/openspec/unified-console-runtime-truth-s2`（自 `origin/main` `2ef725a`；`af8d34c` 為 slice 2 spec 檔，`064ac40` 為本 plan 檔＝2026-08-25 實測 HEAD）。以下所有相對路徑相對此根；「cwd `bim-review-coordinator`」＝該根下的子目錄。**工作區非全乾淨**：已知有一行 ` M bim-review-coordinator/.env.example`（owner 未提交的宣告行），處置見下方硬規則與 Task 1 Step 1。
- 唯一忠實源：`docs/superpowers/specs/2026-08-25-unified-console-runtime-truth-s2-design.md` 與 `openspec/changes/unified-console-runtime-truth/`（`design.md` §2.1–§2.4、`tasks.md` §0 裁決 0.2／0.3 與 §4、`specs/unified-console-runtime-truth/spec.md` requirement「canonical-linux 上 operator SHALL 能由 UI 觸發既有 MinIO 物件轉檔…」）。衝突時以 change 為準——slice spec 檔第 5 行自己就這樣寫（「本檔只界定切片範圍與執行環境事實，**不新增需求**；衝突時以 change 為準」）。本 plan 已據此裁掉一處落差：slice spec §1 4.4 把「`/api/dev/conversions` 消費者」掛進「A1 workbench」括號內，但 canonical scenario（`spec.md`「dev 路徑不是產品路徑且 canonical-linux 關閉 dev routes」的 AND 子句）與 canonical `design.md` §2.4 都**只列兩頁**：`#demo-control` 與 A1 workbench local_fs 清單 → 判為範圍外加，Task 9 HELD（見該節「D5 owner 裁決點」）。
- GitNexus 導航（cwd 為 worktree 根；index 已於 HEAD `af8d34c` 建好，`npx gitnexus@1.6.9 status` 應回 `up-to-date`）：
  - `npx gitnexus@1.6.9 query "conversion trigger ip allowlist authorization" -r AI-BIM-governance`
  - `npx gitnexus@1.6.9 context isKitMutationAuthorized -r AI-BIM-governance`（預期 `incoming.calls` 只有 `createCoordinatorApp`）
  - `npx gitnexus@1.6.9 context rejectIfIpNotAllowed -f bim-review-coordinator/src/app.ts -r AI-BIM-governance`（不加 `-f` 會回 `ambiguous`：tests/lineage 下有兩個同名 stub）
  - 可並列用 `mcp__codebase-memory-mcp__search_graph` 交叉確認 symbol 清單；只要單一 symbol 原始碼時優先 `mcp__codebase-memory-mcp__get_code_snippet(qualified_name)` 省 token。兩圖譜不一致只供導航，不寫入本 plan 的 symbols。
- 精確定位（行號以 HEAD `af8d34c` 查證；動手前一律 `rg -n` 重新定位）：
  - `bim-review-coordinator/src/app.ts:1601` `rejectIfIpNotAllowed`；呼叫點 `:1616` prioritize、`:1642` retry、`:1678` watch、`:1728` trigger、`:4259` 注入 lineage deps。
  - `app.ts:4531` `isKitMutationAuthorized(request, devToken)`：`request.header("x-dev-token") || request.header("x-operator-token")` 與 `devToken` 嚴格相等。
  - `app.ts:4525` `devRoutesEnabled()`：`process.env.ENABLE_DEV_ROUTES !== "false"`；只有 `/api/dev/ifc-sources`、`/api/dev/ifc-file/:name`、`/api/dev/ifc-sources/:sourceId/register` 三條有逐路由檢查；`/api/dev/conversions*`（`:3612-3640`）與 `routes/devMeta.ts` 的 `/api/dev/test-data-projects`（`:4241` mount）**目前沒有** gate。
  - `src/config.ts:452` `devAuthToken: process.env.DEV_AUTH_TOKEN || "dev-token"`；`:566` production 下預設值 fail-fast；`:467` `externalIntakeIpAllowlist` 預設 loopback＋`172.16.0.0/12`。
  - `src/services/authProvider.ts:102` `export function isIpAllowed`；`IntranetDevAuthProvider.authenticate` 對 IP 不允許丟 `AuthError(403, "caller ip not in allowlist: <ip>")`，由 `app.ts:4309` 全域 error handler 轉 `{ detail: error.message }`。
  - `src/routes/lineageSourceBundleRoutes.ts:523`（preview）、`:573`（confirm）經 `deps.rejectIfIpNotAllowed`。
  - 前端（**本 PR 要改的只有前三項**）：`web-viewer-sample/src/console/coordinatorClient.ts:49` `jsonGet`（Task 7）、`RealIfcConsolePage.tsx`（`#demo-control`，`EdgeConsole.tsx:240`；Task 8）、`A1GovernanceWorkbenchPage.tsx:155-162` 的 `coordinatorClient.getTestDataProjects()`（`coordinatorClient.ts:718` → `/api/dev/test-data-projects`；route `#a1-workbench`，`EdgeConsole.tsx:218`；Task 10）。
  - 前端（**HELD，Task 9 不執行**）：`coordinatorClient.ts:712` `getConversionsHistory`（`/api/dev/conversions`）的消費鏈 `modelData/useConversionData.ts:135` `loadHistory` → `modelData/GlobalConversionPane.tsx:367`／`modelData/ConversionHistoryPanel.tsx`／`ConversionPage.tsx:162`，落在 `#conv`／`#minio` 兩頁。查證（2026-08-25，`grep -rn "getConversionsHistory" web-viewer-sample/src`）：`A1GovernanceWorkbenchPage.tsx` **完全不呼叫** `getConversionsHistory`／`/api/dev/conversions`，故這條鏈不屬 canonical scenario 所列的「A1 workbench local_fs 清單」。
- 硬規則（spec §3／§5）：
  - 不改 `rejectIfIpNotAllowed` 本體、不改 `EXTERNAL_INTAKE_IP_ALLOWLIST` 語意、`/api/external/*` 逐字不變、`/api/dev/*` 不作產品路徑、不動 lineage 後端契約、不新增生產依賴、不新增端點、不改 `openspec/lifecycle-ledger.json`／`docs/plans/NOW.md`。
  - `/ui` 殼層 operator token 輸入與「觸發轉檔」按鈕啟用 **不在本切片**（另切片）。
  - **`.env*` 一律不讀、不改、不繞道**（protect-secrets hook；連 Bash 指令字串出現該檔名都會被擋，所以 `git diff`／`cat`／`rg` 該檔一律**不要嘗試**）。`bim-review-coordinator/.env.example` 加 `ENABLE_DEV_ROUTES=` 是 owner 動作。
  - **coordinator 更新 2026-08-25（覆寫本 plan 其他段落對 ` M bim-review-coordinator/.env.example` 的敘述）**：`ENABLE_DEV_ROUTES=` 宣告行已由 owner 親自追加，並經 owner 明示授權以 commit `ded6901` 進入本分支（agent 未讀、未改該檔）。baseline `git status --short` 應為**完全乾淨**；`git diff --name-only origin/main...HEAD` 出現 `bim-review-coordinator/.env.example` 屬預期。parity「宣告案例」預期**綠**＝(B)，且這個綠同時是 CI 的綠。`.env*` 仍一律不讀、不改。
  - **所有 commit 一律逐檔列舉 `git add <path...>`（本 plan 每個 commit 步驟都已列好）；禁止 `git add -A`／`git add .`／`git add -u`／`git commit -a`**——否則會把該 `.env*` 檔掃進本 PR。
  - **唯一可用的判定管道＝parity 測試本身**（測試碼讀檔，agent 不讀）。「宣告行是否已落地、值是否為空」不得用眼睛確認，只能看 Task 6 Step 2／Step 4 的紅綠與失敗訊息；plan 對 (A) 未落地／(B) 已落地且空值／(C) 已落地但非空 三種狀態都給了預期輸出。**不得為了讓某一種預期成立而動該檔。**
  - **本機綠＝CI 綠（coordinator 更新 2026-08-25）**：宣告行已 commit（`ded6901`），parity 全綠即 CI 綠；4.5 依 slice spec §4 於 Task 12 全量綠後打勾（Edit E），4.4 仍只註記（含 UI 顯示與 canonical env，待 181）。
  - 每個既有 symbol 修改前 `npx gitnexus@1.6.9 impact <Symbol> -d upstream -r AI-BIM-governance`（同名者加 `-f <file>`），HIGH／CRITICAL 先回報停手；commit 前 `git diff --cached --check`；最後 `npx gitnexus@1.6.9 detect-changes --scope compare --base-ref main -r AI-BIM-governance`。
  - Python venv 不在 worktree，本切片不需要。`web-viewer-sample/node_modules` 在 worktree 內**尚未安裝**（Task 1 先 `npm ci`）。

## File structure

| Path | 動作 | 責任 |
|---|---|---|
| `bim-review-coordinator/src/services/conversionControlAuthorization.ts` | Create | `isOperatorTokenPathEnabled`、`SlidingWindowRateLimiter`、`createConversionControlGuard`（純函式／記憶體狀態，無新依賴） |
| `bim-review-coordinator/tests/services/conversionControlAuthorization.test.ts` | Create | limiter 與 token 路徑判定單元測試（注入時鐘） |
| `bim-review-coordinator/tests/lineage/conversion-control-auth-pins.test.ts` | Create | 4.3 釘樁：lineage preview／confirm 與 `/api/external/ifc-ready` 授權回應逐字不變、token 不解鎖 |
| `bim-review-coordinator/tests/conversion-control-auth.test.ts` | Create | 4.2：四條路由 T4 授權（403／429／通過）、allowlist 路徑逐字不變不計速率 |
| `bim-review-coordinator/src/app.ts` | Modify | import 新模組；`createCoordinatorApp` 內建 guard 並替換四條路由的守門呼叫；`/api/dev` prefix gate |
| `bim-review-coordinator/tests/dev-routes-disabled.test.ts` | Create | 4.4 後端：`ENABLE_DEV_ROUTES=false` → `/api/dev/*` 404；未設＝開啟 |
| `bim-review-coordinator/tests/env-example-dev-routes-parity.test.ts` | Create | 4.4 部署面 parity（app.ts 讀取點 ↔ `.env.example` 宣告 ↔ compose 透傳） |
| `compose.host-kit.yml` | Modify | coordinator `environment:` 透傳 `ENABLE_DEV_ROUTES: ${ENABLE_DEV_ROUTES:-}` |
| `web-viewer-sample/src/console/coordinatorClient.ts` | Modify | `CoordinatorHttpError`、`isCoordinatorNotFound`；`jsonGet` 改丟該類 |
| `web-viewer-sample/src/console/coordinatorClient.httpError.test.ts` | Create | 404／503 status 可辨識、message 逐字不變 |
| `web-viewer-sample/src/console/RealIfcConsolePage.tsx` | Modify | `#demo-control` 404 → notice／runtime／註冊鈕 disabled |
| `web-viewer-sample/src/console/RealIfcConsolePage.test.tsx` | Create | 404 誠實狀態；200 空清單維持既有語意 |
| ~~`modelData/useConversionData.ts`／`useConversionData.devRoutes.test.tsx`／`GlobalConversionPane.tsx`／`ConversionHistoryPanel.tsx`／`ConversionHistoryPanel.test.tsx`／`ModelDataPage.test.tsx`／`ObjectDetailPane.test.tsx`／`ConversionPage.tsx`~~ | **HELD — 本 PR 不動** | Task 9（`/api/dev/conversions` 消費者 `historyDisabled`）已判為 canonical 範圍外加，待 owner D5 裁決；**8 個檔一律不進本 PR 的 changed-files** |
| `web-viewer-sample/src/console/A1GovernanceWorkbenchPage.tsx` | Modify | test-data 404 note |
| `web-viewer-sample/src/console/console.test.tsx` | Modify | A1 404 note 案例 |
| `web-viewer-sample/e2e/dev-routes-disabled-operator-token.spec.ts` | Create | browser 垂直切片＋API 契約探針 |
| `openspec/changes/unified-console-runtime-truth/tasks.md` | Modify | 4.1／4.2／4.3 打勾＋註記；4.4／4.5 只註記 |

不建立／不修改：`rejectIfIpNotAllowed` 本體、`src/routes/lineageSourceBundleRoutes.ts`、`src/routes/devMeta.ts`、`src/config.ts`、**任何 `.env*`（宣告行已在 commit `ded6901`，工作區應乾淨；仍不讀、不改）**、`openspec/lifecycle-ledger.json`、`docs/plans/**`、`web-viewer-sample/src/console/unified/**`、**Task 9 那 8 個 `/api/dev/conversions` 消費者檔（HELD）**。

---

### Task 1: 前置 baseline＋釘樁測試（4.1／4.3）

> 本 task 由多個原 task 併成（額度／commit 錨點考量，coordinator 2026-08-25）：各子段（#### nA／nB…）的步驟、驗證與 commit 指令**逐字照做**，每段結尾的 commit 都要做；本 task 所有 commit message 一律以「task#<本 task 在 implementer 提示中的 index>: 」開頭再接原訊息。子段標題括號內的「原 Task N」對應文中所有「Task N Step M」的引用。

#### 1A. 前置：Preflight、baseline 與 4.1 impact 紀錄（原 Task 1；本段無檔案變更、不 commit，commit 在 1B 結尾）

**Files:**
- 無 repo 檔案變更（產物寫到 session scratchpad）。

- [ ] **Step 1: 確認 worktree／branch 乾淨**

```bash
cd "C:/Repos/active/iot/AI-BIM-governance.worktrees/unified-console-runtime-truth-s2" && git status --short && git branch --show-current && git log --oneline -1
```

預期輸出：branch 為 `codex/openspec/unified-console-runtime-truth-s2`；log 第一行為本 plan 的 commit（2026-08-25 實測 `064ac40 plan: unified-console-runtime-truth slice 2 實作計畫`，其下依序 `af8d34c` slice 2 spec 檔、`2ef725a` origin/main；若已有更新 commit，記下 SHA 即可）。

`git status --short` **允許且只允許**下列兩種狀態，其一即通過：

1. 無任何行（完全乾淨）。
2. （coordinator 更新 2026-08-25：宣告行已 commit 為 `ded6901`，預期為狀態 1；本狀態僅為歷史保留）**恰好一行** ` M bim-review-coordinator/.env.example`——若仍出現，代表有人在 `ded6901` 之後又動了該檔：停手回報，不 add／不 restore／不讀。

狀態 2 的處置固定為「原樣不動」：**不 `git add`、不 `git restore`／`git checkout --`、不 `git stash`、不 `git diff` 該檔、不讀該檔**（§0 硬規則；`.env*` 全被 protect-secrets hook 保護，且 restore／checkout 會不可逆地毀掉 owner 未提交的工作）。後續每個 commit 都只用本 plan 逐檔列舉的 `git add <path...>`，因此這一行會原封不動留在工作區直到最後——Task 11 Step 4 與 Task 12 Step 6 的 `git status` 預期都已據此放寬。

**不要嘗試判斷該行的實際內容**（是 `ENABLE_DEV_ROUTES=` 還是 `ENABLE_DEV_ROUTES=false`）。唯一合法的判定管道是 Task 6 的 parity 測試（測試碼讀檔，你不讀），Step 2／Step 4 已對三種可能結果各給預期輸出。

出現任何**其他**檔案的 modified／untracked 行 → 停手回報，不 commit、也不自行清理。

- [ ] **Step 2: 4.1 impact（helper 本體不改的證據）**

```bash
cd "C:/Repos/active/iot/AI-BIM-governance.worktrees/unified-console-runtime-truth-s2" && npx gitnexus@1.6.9 impact rejectIfIpNotAllowed -f bim-review-coordinator/src/app.ts -d upstream -r AI-BIM-governance
```

預期輸出：JSON，`target.filePath` 為 `bim-review-coordinator/src/app.ts`，`risk` 為 `LOW`，`summary.direct` 為 `1`（`createCoordinatorApp`），`impactedCount` 為 `2`。把整段 JSON 存到 scratchpad（例：`<scratchpad>/impact-rejectIfIpNotAllowed.json`），Task 12 貼進 tasks.md 4.1 註記與 PR body。同時人工列出六個呼叫點：

```bash
cd "C:/Repos/active/iot/AI-BIM-governance.worktrees/unified-console-runtime-truth-s2" && rg -n "rejectIfIpNotAllowed" bim-review-coordinator/src
```

預期輸出：`app.ts` 的定義（`function rejectIfIpNotAllowed`）＋四條路由呼叫＋`:4259` 注入行＋`:2062` 註解；`lineageSourceBundleRoutes.ts` 的 `:119` 型別、`:521` 註解、`:523`、`:573`。

- [ ] **Step 3: coordinator baseline（build＋既有相關測試）**

```bash
cd "C:/Repos/active/iot/AI-BIM-governance.worktrees/unified-console-runtime-truth-s2/bim-review-coordinator" && npm run build && npx vitest run tests/conversion-control-routes.test.ts tests/conversion-trigger.test.ts tests/dev-console.test.ts tests/lineage tests/env-example-lineage-parity.test.ts
```

預期輸出：`npm run build`（tsc）無輸出、exit 0；vitest 結尾 `Test Files  N passed (N)`、`Tests  M passed (M)`、無 `failed`。把 N／M 記下（Task 4／5 完成後同一組指令的 pass 數只增不減）。

- [ ] **Step 4: 前端安裝與 baseline**

```bash
cd "C:/Repos/active/iot/AI-BIM-governance.worktrees/unified-console-runtime-truth-s2/web-viewer-sample" && npm ci --no-audit --no-fund && npx tsc --noEmit && npx vitest run src/console/modelData src/console/coordinatorClient.conversions-history.test.ts
```

預期輸出：`npm ci` 結尾 `added <n> packages`；`tsc --noEmit` 無輸出、exit 0；vitest 全 pass。若 `git status --short` 出現任何檔案（coordinator 更新 2026-08-25：`.env.example` 已 commit `ded6901`，工作區應乾淨）（例如 `scripts/sync-design-assets.mjs` 產物），停下回報，不要 commit 它們。

---

#### 1B. 釘樁測試（4.3）— lineage／webhook 授權面 baseline（app.ts 改動前先綠）（原 Task 2）

**Files:**
- Create: `bim-review-coordinator/tests/lineage/conversion-control-auth-pins.test.ts`

- [ ] **Step 1: 寫釘樁測試（此檔在未改 app.ts 的現況就必須全綠＝baseline）**

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createCoordinatorApp, type CoordinatorApp } from "../../src/app.js";
import type { CoordinatorConfig } from "../../src/config.js";

// unified-console-runtime-truth slice 2 task 4.3：釘樁。T4 per-route wrapper 只包四條 /api/conversion/*
// 控制路由；本檔證明 (a) lineage legacy-unmanaged preview／confirm（經 deps 注入 rejectIfIpNotAllowed）
// 與 (b) /api/external/ifc-ready webhook 面的授權回應在變更前後逐字相同，且 operator token 對這些路由
// 「沒有任何效果」。本檔必須在 app.ts 改動前先跑綠（baseline），改動後再跑綠（釘樁成立）。
// supertest 走 loopback：allowlist 設成排除 loopback 的網段即模擬「LAN 來源」。

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const CONTRACT_PATH = path.resolve(TEST_DIR, "..", "..", "..", "tests", "contracts", "ifc_ready_payload.json");
const CONTRACT = JSON.parse(fs.readFileSync(CONTRACT_PATH, "utf-8")) as { example: Record<string, unknown> };

const WEBHOOK_SECRET = "dev-webhook-secret";
const OPERATOR_TOKEN = "operator-secret-for-pins";
const LAN_ONLY_ALLOWLIST = ["10.0.0.0/8"];
const IP_REJECTED_BODY = { detail: "caller ip not in allowlist" };
const PREVIEW_PATH = "/api/lineage/legacy-unmanaged/preview?grouping_key=tenant-a/legacy";
const CONFIRM_PATH = "/api/lineage/legacy-unmanaged/confirm";

let active: CoordinatorApp | null = null;

afterEach(async () => {
  if (!active) return;
  await active.dispose();
  active.io.close();
  await new Promise<void>((resolve) => active?.server.close(() => resolve()));
  active = null;
});

function makeApp(overrides: Partial<CoordinatorConfig> = {}): CoordinatorApp {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bim-coord-auth-pins-"));
  active = createCoordinatorApp({
    sessionStoreDir: path.join(root, "sessions"),
    eventLogDir: path.join(root, "events"),
    callbackOutboxStorePath: path.join(root, "callback-outbox.json"),
    streamingConversionApiBase: "http://127.0.0.1:1",
    corsOrigins: ["http://127.0.0.1:5173"],
    conversionPollEnabled: false,
    externalIntakeWebhookSecret: WEBHOOK_SECRET,
    devAuthToken: OPERATOR_TOKEN,
    ...overrides,
  });
  return active;
}

function webhookHeaders(suffix: string): Record<string, string> {
  return {
    "X-Webhook-Secret": WEBHOOK_SECRET,
    "X-Correlation-Id": `corr_pin_${suffix}`,
    "X-Idempotency-Key": `idem_pin_${suffix}`,
  };
}

describe("釘樁：lineage legacy-unmanaged 路由（deps 注入 rejectIfIpNotAllowed）", () => {
  it("preview：IP 不在 allowlist → 403 逐字 body；帶 operator token 仍 403 同 body", async () => {
    const app = makeApp({ externalIntakeIpAllowlist: LAN_ONLY_ALLOWLIST });
    const bare = await request(app.app).get(PREVIEW_PATH);
    expect(bare.status).toBe(403);
    expect(bare.body).toEqual(IP_REJECTED_BODY);
    const withToken = await request(app.app).get(PREVIEW_PATH).set("x-operator-token", OPERATOR_TOKEN);
    expect(withToken.status).toBe(403);
    expect(withToken.body).toEqual(IP_REJECTED_BODY);
  });

  it("confirm：IP 不在 allowlist → 403 逐字 body；帶 operator token 仍 403 同 body", async () => {
    const app = makeApp({ externalIntakeIpAllowlist: LAN_ONLY_ALLOWLIST });
    const body = { grouping_key: "tenant-a/legacy" };
    const bare = await request(app.app).post(CONFIRM_PATH).send(body);
    expect(bare.status).toBe(403);
    expect(bare.body).toEqual(IP_REJECTED_BODY);
    const withToken = await request(app.app).post(CONFIRM_PATH).set("x-operator-token", OPERATOR_TOKEN).send(body);
    expect(withToken.status).toBe(403);
    expect(withToken.body).toEqual(IP_REJECTED_BODY);
  });

  it("preview／confirm：loopback 在預設 allowlist → 通過 IP 守門，落到 grouping_key 驗證 400（allow 路徑釘樁）", async () => {
    const app = makeApp();
    const preview = await request(app.app).get("/api/lineage/legacy-unmanaged/preview");
    expect(preview.status).toBe(400);
    expect(preview.body).toEqual({ error: "invalid_grouping_key" });
    const confirm = await request(app.app).post(CONFIRM_PATH).send({});
    expect(confirm.status).toBe(400);
    expect(confirm.body).toEqual({ error: "invalid_grouping_key" });
  });
});

describe("釘樁：/api/external/ifc-ready webhook 面授權", () => {
  it("IP 不在 allowlist → 403 `caller ip not in allowlist: <ip>`；operator token 不解鎖 webhook 面", async () => {
    const app = makeApp({ externalIntakeIpAllowlist: LAN_ONLY_ALLOWLIST });
    const bare = await request(app.app).post("/api/external/ifc-ready").set(webhookHeaders("1")).send(structuredClone(CONTRACT.example));
    expect(bare.status).toBe(403);
    expect(bare.body).toEqual({ detail: expect.stringMatching(/^caller ip not in allowlist: (127\.0\.0\.1|::1)$/) });
    const withToken = await request(app.app)
      .post("/api/external/ifc-ready")
      .set({ ...webhookHeaders("2"), "x-operator-token": OPERATOR_TOKEN })
      .send(structuredClone(CONTRACT.example));
    expect(withToken.status).toBe(403);
    expect(withToken.body).toEqual(bare.body);
  });

  it("loopback 允許但缺 X-Webhook-Secret → 401 逐字 body（secret 面不受 operator token 影響）", async () => {
    const app = makeApp();
    const res = await request(app.app)
      .post("/api/external/ifc-ready")
      .set({ "X-Correlation-Id": "corr_pin_3", "X-Idempotency-Key": "idem_pin_3", "x-operator-token": OPERATOR_TOKEN })
      .send(structuredClone(CONTRACT.example));
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ detail: "missing X-Webhook-Secret or X-Webhook-Signature" });
  });
});
```

- [ ] **Step 2: 在未改 app.ts 的現況跑，必須全綠（baseline）**

```bash
cd "C:/Repos/active/iot/AI-BIM-governance.worktrees/unified-console-runtime-truth-s2/bim-review-coordinator" && npx vitest run tests/lineage/conversion-control-auth-pins.test.ts
```

預期輸出：`Test Files  1 passed (1)`、`Tests  5 passed (5)`。若 `caller ip not in allowlist:` 後的 IP 既非 `127.0.0.1` 也非 `::1`，把該測試的 regex 改成實際觀察到的 loopback 字面（釘樁要釘「現況」），不得放寬成任意字串。

- [ ] **Step 3: commit**

```bash
cd "C:/Repos/active/iot/AI-BIM-governance.worktrees/unified-console-runtime-truth-s2" && git add bim-review-coordinator/tests/lineage/conversion-control-auth-pins.test.ts && git diff --cached --check && git commit -m "test(coordinator): slice 2 釘樁 lineage／webhook 授權面（T4 落地前 baseline）"
```

預期輸出：`git diff --cached --check` 無輸出；commit 建立（1 file changed）。commit message 結尾依本 session harness 規則附 `Co-Authored-By` 與 `Claude-Session` trailers（下同）。

---

### Task 2: 授權模組＋四條 conversion 控制路由 per-route guard（4.2）

> 本 task 由多個原 task 併成（額度／commit 錨點考量，coordinator 2026-08-25）：各子段（#### nA／nB…）的步驟、驗證與 commit 指令**逐字照做**，每段結尾的 commit 都要做；本 task 所有 commit message 一律以「task#<本 task 在 implementer 提示中的 index>: 」開頭再接原訊息。子段標題括號內的「原 Task N」對應文中所有「Task N Step M」的引用。

#### 2A. `conversionControlAuthorization` 模組（token 路徑判定＋滑動視窗速率限制＋guard 工廠）（原 Task 3）

**Files:**
- Create: `bim-review-coordinator/src/services/conversionControlAuthorization.ts`
- Test: `bim-review-coordinator/tests/services/conversionControlAuthorization.test.ts`

- [ ] **Step 1: 寫失敗的單元測試**

```ts
import { describe, expect, it } from "vitest";
import {
  isOperatorTokenPathEnabled,
  OPERATOR_TOKEN_RATE_LIMIT,
  OPERATOR_TOKEN_RATE_WINDOW_MS,
  SlidingWindowRateLimiter,
} from "../../src/services/conversionControlAuthorization.js";

// unified-console-runtime-truth slice 2 task 4.2（D2=T4）：token 路徑判定與速率限制的純單元。
// guard 本體（IP allowlist 或 token）的 HTTP 契約由 tests/conversion-control-auth.test.ts 以 supertest 驗。

describe("isOperatorTokenPathEnabled", () => {
  it("預設 dev-token 與空字串視為未啟用（fail-closed：公開預設值不得成為授權）", () => {
    expect(isOperatorTokenPathEnabled("dev-token")).toBe(false);
    expect(isOperatorTokenPathEnabled("")).toBe(false);
  });
  it("非預設值視為啟用", () => {
    expect(isOperatorTokenPathEnabled("operator-secret")).toBe(true);
  });
});

describe("SlidingWindowRateLimiter（每 key 每 60s 10 次）", () => {
  it("常數：limit 10、window 60_000ms", () => {
    expect(OPERATOR_TOKEN_RATE_LIMIT).toBe(10);
    expect(OPERATOR_TOKEN_RATE_WINDOW_MS).toBe(60_000);
  });

  it("同 key 第 11 次拒絕並回 Retry-After 秒數；時間推進後 Retry-After 遞減；窗過後放行", () => {
    let now = 1_000_000;
    const limiter = new SlidingWindowRateLimiter(OPERATOR_TOKEN_RATE_LIMIT, OPERATOR_TOKEN_RATE_WINDOW_MS, () => now);
    for (let i = 0; i < 10; i += 1) expect(limiter.hit("ip-a")).toEqual({ allowed: true, retryAfterSeconds: 0 });
    expect(limiter.hit("ip-a")).toEqual({ allowed: false, retryAfterSeconds: 60 });
    now += 30_000;
    expect(limiter.hit("ip-a")).toEqual({ allowed: false, retryAfterSeconds: 30 });
    now += 30_001;
    expect(limiter.hit("ip-a").allowed).toBe(true);
  });

  it("不同 key 各自計數", () => {
    const limiter = new SlidingWindowRateLimiter(1, 60_000, () => 0);
    expect(limiter.hit("a").allowed).toBe(true);
    expect(limiter.hit("b").allowed).toBe(true);
    expect(limiter.hit("a").allowed).toBe(false);
  });

  it("被拒絕的嘗試不延長視窗（拒絕不寫入 hit）", () => {
    let now = 0;
    const limiter = new SlidingWindowRateLimiter(2, 1_000, () => now);
    limiter.hit("k"); limiter.hit("k");
    now = 500;
    expect(limiter.hit("k").allowed).toBe(false);
    now = 1_001;
    expect(limiter.hit("k").allowed).toBe(true);
  });
});
```

- [ ] **Step 2: 跑，確認因模組不存在而失敗**

```bash
cd "C:/Repos/active/iot/AI-BIM-governance.worktrees/unified-console-runtime-truth-s2/bim-review-coordinator" && npx vitest run tests/services/conversionControlAuthorization.test.ts
```

預期輸出：`Failed to load` / `Cannot find module '../../src/services/conversionControlAuthorization.js'`，`Test Files  1 failed (1)`。

- [ ] **Step 3: 實作模組**

```ts
import type express from "express";

// unified-console-runtime-truth slice 2（owner D2 裁決＝T4，2026-08-25）：四條 /api/conversion/* 控制路由的
// per-route 授權 wrapper 所需的純邏輯。app.ts 只負責把 config／isIpAllowed／isKitMutationAuthorized 注入。
// 不新增生產依賴：滑動視窗以 Map<string, number[]> 記錄每來源 IP 的命中時間戳（in-memory，process 生命週期）。

/** 每來源 IP 每分鐘允許的 token 路徑請求數（owner 裁決 N=10）。 */
export const OPERATOR_TOKEN_RATE_LIMIT = 10;
export const OPERATOR_TOKEN_RATE_WINDOW_MS = 60_000;

/** config.ts 的預設值（DEV_AUTH_TOKEN 未設時）。與 config.ts:452／:566 的字面同步；預設值＝token 路徑未啟用。 */
const DEFAULT_DEV_AUTH_TOKEN = "dev-token";

/** token 路徑只在 devAuthToken 為非空且非原始碼預設值時啟用（fail-closed：公開預設值不得變成授權）。 */
export function isOperatorTokenPathEnabled(devAuthToken: string): boolean {
  return devAuthToken.length > 0 && devAuthToken !== DEFAULT_DEV_AUTH_TOKEN;
}

export interface RateLimitDecision {
  allowed: boolean;
  /** 被拒時距離最舊一筆命中離開視窗的秒數（ceil，至少 1）；放行時 0。 */
  retryAfterSeconds: number;
}

export class SlidingWindowRateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  hit(key: string): RateLimitDecision {
    const at = this.now();
    const floor = at - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((stamp) => stamp > floor);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((recent[0] + this.windowMs - at) / 1000)) };
    }
    recent.push(at);
    this.hits.set(key, recent);
    if (this.hits.size > 1024) this.sweep(floor);
    return { allowed: true, retryAfterSeconds: 0 };
  }

  /** 防止大量來源 IP 讓 Map 無界成長：只在 key 數超過門檻時清掉整個視窗都過期的 key。 */
  private sweep(floor: number): void {
    for (const [key, stamps] of this.hits) {
      const kept = stamps.filter((stamp) => stamp > floor);
      if (kept.length === 0) this.hits.delete(key);
      else this.hits.set(key, kept);
    }
  }
}

export interface ConversionControlGuardDeps {
  /** 與 rejectIfIpNotAllowed 同一判定（空 allowlist＝未啟用 IP 守門＝全放行）。 */
  isCallerIpAllowed: (clientIp: string) => boolean;
  operatorTokenPathEnabled: () => boolean;
  /** 沿用 isKitMutationAuthorized（x-dev-token 或 x-operator-token 與 config.devAuthToken 嚴格相等）。 */
  isOperatorTokenValid: (request: express.Request) => boolean;
  rateLimiter: SlidingWindowRateLimiter;
}

export type ConversionControlGuard = (request: express.Request, response: express.Response) => boolean;

/**
 * 回傳與 rejectIfIpNotAllowed 同型的守門函式：回 true 表示已寫回應並終止。
 * 順序：IP 允許 → 放行（逐字沿用 allowlist 路徑，不計速率）；否則
 *   token 路徑未啟用 → 403 逐字 `caller ip not in allowlist`；
 *   無 token header → 403 逐字（不計速率：沒嘗試 token 路徑）；
 *   速率超額 → 429 + Retry-After；
 *   token 不符 → 403 `operator token invalid (x-operator-token)`；
 *   否則放行。
 */
export function createConversionControlGuard(deps: ConversionControlGuardDeps): ConversionControlGuard {
  return function rejectIfConversionControlUnauthorized(request: express.Request, response: express.Response): boolean {
    const clientIp = request.ip || request.socket.remoteAddress || "";
    if (deps.isCallerIpAllowed(clientIp)) return false;
    const tokenHeaderPresent = Boolean(request.header("x-operator-token") || request.header("x-dev-token"));
    if (!deps.operatorTokenPathEnabled() || !tokenHeaderPresent) {
      response.status(403).json({ detail: "caller ip not in allowlist" });
      return true;
    }
    const decision = deps.rateLimiter.hit(clientIp || "unknown");
    if (!decision.allowed) {
      response.setHeader("Retry-After", String(decision.retryAfterSeconds));
      response.status(429).json({ detail: "operator token rate limit exceeded (10 requests per minute per source ip)" });
      return true;
    }
    if (!deps.isOperatorTokenValid(request)) {
      response.status(403).json({ detail: "operator token invalid (x-operator-token)" });
      return true;
    }
    return false;
  };
}
```

- [ ] **Step 4: 跑單元測試，確認通過；tsc 也要過**

```bash
cd "C:/Repos/active/iot/AI-BIM-governance.worktrees/unified-console-runtime-truth-s2/bim-review-coordinator" && npx vitest run tests/services/conversionControlAuthorization.test.ts && npm run build
```

預期輸出：`Tests  6 passed (6)`；`npm run build` 無輸出、exit 0。

- [ ] **Step 5: commit**

```bash
cd "C:/Repos/active/iot/AI-BIM-governance.worktrees/unified-console-runtime-truth-s2" && git add bim-review-coordinator/src/services/conversionControlAuthorization.ts bim-review-coordinator/tests/services/conversionControlAuthorization.test.ts && git diff --cached --check && git commit -m "feat(coordinator): conversionControlAuthorization 模組（operator token 路徑判定＋滑動視窗速率限制）"
```

預期輸出：2 files changed。

---

#### 2B. 四條 conversion 控制路由接上 per-route guard（4.2）（原 Task 4）

**Files:**
- Modify: `bim-review-coordinator/src/app.ts`（import；`createCoordinatorApp` 內新增 guard 建構；四條路由的守門呼叫替換）
- Test: `bim-review-coordinator/tests/conversion-control-auth.test.ts`

- [ ] **Step 1: impact（修改既有 symbol `createCoordinatorApp` 前必做）**

```bash
cd "C:/Repos/active/iot/AI-BIM-governance.worktrees/unified-console-runtime-truth-s2" && npx gitnexus@1.6.9 impact createCoordinatorApp -d upstream -r AI-BIM-governance --summary-only
```

預期輸出：`risk: "LOW"`，`direct: 1`（`src/index.ts`）。非 LOW／MEDIUM 則停手回報。

- [ ] **Step 2: 寫失敗的 HTTP 契約測試**

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createCoordinatorApp, type CoordinatorApp } from "../src/app.js";
import type { CoordinatorConfig } from "../src/config.js";

// unified-console-runtime-truth slice 2 task 4.2（owner D2 裁決 T4）：四條 conversion 控制路由
// 「IP allowlist 通過 或 operator token 通過」。supertest 走 loopback：allowlist 設成排除 loopback 的
// 網段即模擬「LAN 瀏覽器」；預設 allowlist（含 loopback）即模擬 watcher self-POST／本機 operator。
// 本檔的 app 沒有 MinIO／streaming 設定，故「授權通過」的觀測值是各路由授權之後的第一個判定：
//   prioritize／retry 對不存在 job → 404；watch enabled:true → 422（未配置）；trigger → 503（MinIO 未設定）。
// 這些碼「不是 403／429」，即證明授權已通過且其後行為逐字沿用既有路徑。

const LAN_ONLY_ALLOWLIST = ["10.0.0.0/8"];
const OPERATOR_TOKEN = "operator-secret-s2";
const IP_REJECTED_BODY = { detail: "caller ip not in allowlist" };
const TOKEN_INVALID_BODY = { detail: "operator token invalid (x-operator-token)" };
const RATE_LIMITED_BODY = { detail: "operator token rate limit exceeded (10 requests per minute per source ip)" };

let active: CoordinatorApp | null = null;

afterEach(async () => {
  if (!active) return;
  await active.dispose();
  active.io.close();
  await new Promise<void>((resolve) => active?.server.close(() => resolve()));
  active = null;
});

function makeApp(overrides: Partial<CoordinatorConfig> = {}): CoordinatorApp {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bim-coord-control-auth-"));
  active = createCoordinatorApp({
    sessionStoreDir: path.join(root, "sessions"),
    eventLogDir: path.join(root, "events"),
    callbackOutboxStorePath: path.join(root, "callback-outbox.json"),
    streamingConversionApiBase: "http://127.0.0.1:1",
    corsOrigins: ["http://127.0.0.1:5173"],
    conversionPollEnabled: false,
    ...overrides,
  });
  return active;
}

interface RouteCase {
  name: string;
  send: (app: CoordinatorApp, headers: Record<string, string>) => request.Test;
  /** 授權通過後、本 harness 下的第一個判定碼（非 403／429）。 */
  authorizedStatus: number;
}

const ROUTES: RouteCase[] = [
  {
    name: "POST /api/conversion/jobs/:id/prioritize",
    send: (app, headers) => request(app.app).post("/api/conversion/jobs/ifcready_nope/prioritize").set(headers).send({}),
    authorizedStatus: 404,
  },
  {
    name: "POST /api/conversion/jobs/:id/retry",
    send: (app, headers) => request(app.app).post("/api/conversion/jobs/ifcready_nope/retry").set(headers).send({}),
    authorizedStatus: 404,
  },
  {
    name: "PUT /api/conversion/watch",
    send: (app, headers) => request(app.app).put("/api/conversion/watch").set(headers).send({ enabled: true }),
    authorizedStatus: 422,
  },
  {
    name: "POST /api/conversion/trigger",
    send: (app, headers) => request(app.app).post("/api/conversion/trigger").set(headers).send({ key: "proj/main/uuid/model.ifc" }),
    authorizedStatus: 503,
  },
];

for (const route of ROUTES) {
  describe(`${route.name} — T4 per-route 授權`, () => {
    it("無憑證且非 allowlist → 403 逐字 body（與變更前相同）", async () => {
      const app = makeApp({ externalIntakeIpAllowlist: LAN_ONLY_ALLOWLIST, devAuthToken: OPERATOR_TOKEN });
      const res = await route.send(app, {});
      expect(res.status).toBe(403);
      expect(res.body).toEqual(IP_REJECTED_BODY);
    });

    it("token 路徑未啟用（devAuthToken 仍為預設 dev-token）：即使帶 dev-token 也 403 逐字（fail-closed）", async () => {
      const app = makeApp({ externalIntakeIpAllowlist: LAN_ONLY_ALLOWLIST });
      expect(app.config.devAuthToken).toBe("dev-token");
      const res = await route.send(app, { "x-operator-token": "dev-token" });
      expect(res.status).toBe(403);
      expect(res.body).toEqual(IP_REJECTED_BODY);
    });

    it("錯誤 token → 403 operator token invalid", async () => {
      const app = makeApp({ externalIntakeIpAllowlist: LAN_ONLY_ALLOWLIST, devAuthToken: OPERATOR_TOKEN });
      const res = await route.send(app, { "x-operator-token": "not-the-token" });
      expect(res.status).toBe(403);
      expect(res.body).toEqual(TOKEN_INVALID_BODY);
    });

    it("正確 x-operator-token → 授權通過（落到既有下一判定，非 403／429）", async () => {
      const app = makeApp({ externalIntakeIpAllowlist: LAN_ONLY_ALLOWLIST, devAuthToken: OPERATOR_TOKEN });
      const res = await route.send(app, { "x-operator-token": OPERATOR_TOKEN });
      expect(res.status).toBe(route.authorizedStatus);
    });

    it("相容 x-dev-token → 授權通過", async () => {
      const app = makeApp({ externalIntakeIpAllowlist: LAN_ONLY_ALLOWLIST, devAuthToken: OPERATOR_TOKEN });
      const res = await route.send(app, { "x-dev-token": OPERATOR_TOKEN });
      expect(res.status).toBe(route.authorizedStatus);
    });

    it("allowlist 路徑（預設含 loopback）無 token → 逐字沿用既有行為", async () => {
      const app = makeApp();
      const res = await route.send(app, {});
      expect(res.status).toBe(route.authorizedStatus);
    });
  });
}

describe("token 路徑速率限制（每來源 IP 每分鐘 10 次，只對 token 路徑）", () => {
  it("第 11 次 token 路徑請求 → 429 + Retry-After；錯誤 token 的嘗試也計入", async () => {
    const app = makeApp({ externalIntakeIpAllowlist: LAN_ONLY_ALLOWLIST, devAuthToken: OPERATOR_TOKEN });
    for (let i = 0; i < 9; i += 1) {
      const ok = await request(app.app).post("/api/conversion/jobs/ifcready_nope/prioritize").set("x-operator-token", OPERATOR_TOKEN).send({});
      expect(ok.status).toBe(404);
    }
    const wrong = await request(app.app).post("/api/conversion/jobs/ifcready_nope/prioritize").set("x-operator-token", "nope").send({});
    expect(wrong.status).toBe(403);
    const limited = await request(app.app).post("/api/conversion/jobs/ifcready_nope/retry").set("x-operator-token", OPERATOR_TOKEN).send({});
    expect(limited.status).toBe(429);
    expect(limited.body).toEqual(RATE_LIMITED_BODY);
    const retryAfter = Number(limited.headers["retry-after"]);
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(60);
  });

  it("allowlist 路徑不計速率：loopback 連打 15 次一律通過（無 429）", async () => {
    const app = makeApp();
    for (let i = 0; i < 15; i += 1) {
      const res = await request(app.app).post("/api/conversion/jobs/ifcready_nope/prioritize").send({});
      expect(res.status).toBe(404);
    }
  });

  it("非 allowlist 且無 token header 的請求不計入 token 路徑速率（仍 403 逐字），之後正確 token 仍可用", async () => {
    const app = makeApp({ externalIntakeIpAllowlist: LAN_ONLY_ALLOWLIST, devAuthToken: OPERATOR_TOKEN });
    for (let i = 0; i < 12; i += 1) {
      const res = await request(app.app).post("/api/conversion/jobs/ifcready_nope/prioritize").send({});
      expect(res.status).toBe(403);
      expect(res.body).toEqual(IP_REJECTED_BODY);
    }
    const ok = await request(app.app).post("/api/conversion/jobs/ifcready_nope/prioritize").set("x-operator-token", OPERATOR_TOKEN).send({});
    expect(ok.status).toBe(404);
  });
});

describe("空 allowlist（未啟用 IP 守門）語意不變", () => {
  it("空 allowlist → 一律放行（不看 token、不計速率）", async () => {
    const app = makeApp({ externalIntakeIpAllowlist: [] });
    for (let i = 0; i < 12; i += 1) {
      const res = await request(app.app).post("/api/conversion/jobs/ifcready_nope/prioritize").send({});
      expect(res.status).toBe(404);
    }
  });
});
```

- [ ] **Step 3: 跑，確認失敗（token 路徑尚未接上 → 「正確 token」案例 403、速率案例無 429）**

```bash
cd "C:/Repos/active/iot/AI-BIM-governance.worktrees/unified-console-runtime-truth-s2/bim-review-coordinator" && npx vitest run tests/conversion-control-auth.test.ts
```

預期輸出：`Tests  14 failed | 14 passed (28)`——失敗的是各路由的「錯誤 token」「正確 x-operator-token」「相容 x-dev-token」（3×4）、速率限制第一案例（無 429）與第三案例（結尾正確 token 仍 403）；其餘（逐字 403、token 路徑未啟用、allowlist 路徑、15 次不計速率、空 allowlist）通過。

- [ ] **Step 4: app.ts — 加 import**

以 Edit 把 `bim-review-coordinator/src/app.ts` 的

```ts
import {
  AuthError,
  createAuthProvider,
  createUserAuthProvider,
  isIpAllowed,
  opaqueLocalDevSubject,
} from "./services/authProvider.js";
```

改成

```ts
import {
  AuthError,
  createAuthProvider,
  createUserAuthProvider,
  isIpAllowed,
  opaqueLocalDevSubject,
} from "./services/authProvider.js";
import {
  createConversionControlGuard,
  isOperatorTokenPathEnabled,
  OPERATOR_TOKEN_RATE_LIMIT,
  OPERATOR_TOKEN_RATE_WINDOW_MS,
  SlidingWindowRateLimiter,
} from "./services/conversionControlAuthorization.js";
```

- [ ] **Step 5: app.ts — 在 `rejectIfIpNotAllowed` 定義之後、prioritize 路由之前建構 guard（helper 本體逐字不動）**

以 Edit 把

```ts
      response.status(403).json({ detail: "caller ip not in allowlist" });
      return true;
    }
    return false;
  }

  app.post("/api/conversion/jobs/:id/prioritize", (request, response) => {
    if (rejectIfIpNotAllowed(request, response)) return;
```

改成

```ts
      response.status(403).json({ detail: "caller ip not in allowlist" });
      return true;
    }
    return false;
  }

  // unified-console-runtime-truth slice 2（owner D2 裁決 T4，2026-08-25）：四條 conversion 控制路由的
  // per-route wrapper——「IP allowlist 通過 **或** operator token 通過」。rejectIfIpNotAllowed 本體不改
  //（lineage source-bundle 路由仍經 deps 注入使用它，授權逐字不變；釘樁見 tests/lineage/conversion-control-auth-pins）。
  // allowlist 路徑（含 loopback 的 minio-watcher self-POST）行為逐字不變且不計速率；token 路徑沿用
  // isKitMutationAuthorized 同型比對，config.devAuthToken 仍為預設 "dev-token" 時 token 路徑視為未啟用
  //（fail-closed，只剩 allowlist）；token 路徑每來源 IP 每分鐘 10 次（in-memory 滑動視窗），超額 429＋Retry-After。
  const rejectIfConversionControlUnauthorized = createConversionControlGuard({
    isCallerIpAllowed: (clientIp) =>
      !(config.externalIntakeIpAllowlist.length > 0 && !isIpAllowed(clientIp, config.externalIntakeIpAllowlist)),
    operatorTokenPathEnabled: () => isOperatorTokenPathEnabled(config.devAuthToken),
    isOperatorTokenValid: (request) => isKitMutationAuthorized(request, config.devAuthToken),
    rateLimiter: new SlidingWindowRateLimiter(OPERATOR_TOKEN_RATE_LIMIT, OPERATOR_TOKEN_RATE_WINDOW_MS),
  });

  app.post("/api/conversion/jobs/:id/prioritize", (request, response) => {
    if (rejectIfConversionControlUnauthorized(request, response)) return;
```

- [ ] **Step 6: app.ts — 替換 retry／watch／trigger 三處呼叫（各一個 Edit）**

retry：把

```ts
  app.post("/api/conversion/jobs/:id/retry", (request, response) => {
    if (rejectIfIpNotAllowed(request, response)) return;
```

改成

```ts
  app.post("/api/conversion/jobs/:id/retry", (request, response) => {
    if (rejectIfConversionControlUnauthorized(request, response)) return;
```

watch：把

```ts
    if (rejectIfIpNotAllowed(request, response)) return;                 // CR-A：沿用 IP allowlist 守門
```

改成

```ts
    if (rejectIfConversionControlUnauthorized(request, response)) return; // CR-A：IP allowlist 或 operator token（slice 2 T4）
```

trigger：把

```ts
  app.post("/api/conversion/trigger", async (request, response) => {
    if (rejectIfIpNotAllowed(request, response)) return;
```

改成

```ts
  app.post("/api/conversion/trigger", async (request, response) => {
    if (rejectIfConversionControlUnauthorized(request, response)) return;
```

並確認 helper 本體與 lineage 注入沒被碰到：

```bash
cd "C:/Repos/active/iot/AI-BIM-governance.worktrees/unified-console-runtime-truth-s2" && rg -n "rejectIfIpNotAllowed\(|rejectIfConversionControlUnauthorized\(" bim-review-coordinator/src/app.ts
```

預期輸出：`rejectIfIpNotAllowed(` 只剩定義行（`function rejectIfIpNotAllowed(`）；`rejectIfConversionControlUnauthorized(` 恰 4 條路由呼叫（另有 `createConversionControlGuard({` 建構行不含 `(` 後綴的函式名）。`:4259` 的 `rejectIfIpNotAllowed,` 注入行原樣。

- [ ] **Step 7: 跑新測試＋釘樁＋既有相關測試＋build**

```bash
cd "C:/Repos/active/iot/AI-BIM-governance.worktrees/unified-console-runtime-truth-s2/bim-review-coordinator" && npm run build && npx vitest run tests/conversion-control-auth.test.ts tests/lineage/conversion-control-auth-pins.test.ts tests/conversion-control-routes.test.ts tests/conversion-trigger.test.ts tests/conversion-watch-toggle.test.ts tests/minio-watch-intake-integration.test.ts tests/lineage
```

預期輸出：build 無輸出；vitest 全 pass（`conversion-control-auth` 28 tests、pins 5 tests；既有檔 pass 數與 Task 1 baseline 相同）。任何 lineage 或 trigger 測試變紅＝wrapper 影響到非目標路徑，回頭查 Step 5／6 的替換是否只碰四條路由。

- [ ] **Step 8: commit**

```bash
cd "C:/Repos/active/iot/AI-BIM-governance.worktrees/unified-console-runtime-truth-s2" && git add bim-review-coordinator/src/app.ts bim-review-coordinator/tests/conversion-control-auth.test.ts && git diff --cached --check && git commit -m "feat(coordinator): 四條 conversion 控制路由 per-route operator-token 授權（D2=T4，allowlist 路徑逐字不變）"
```

預期輸出：2 files changed。

---

### Task 3: D3 — `/api/dev` prefix gate＋compose 透傳＋`.env.example` parity guard（4.4 後端與部署面）

> 本 task 由多個原 task 併成（額度／commit 錨點考量，coordinator 2026-08-25）：各子段（#### nA／nB…）的步驟、驗證與 commit 指令**逐字照做**，每段結尾的 commit 都要做；本 task 所有 commit message 一律以「task#<本 task 在 implementer 提示中的 index>: 」開頭再接原訊息。子段標題括號內的「原 Task N」對應文中所有「Task N Step M」的引用。

#### 3A. D3 後端 — `/api/dev` prefix gate（4.4 後端）（原 Task 5）

**Files:**
- Modify: `bim-review-coordinator/src/app.ts`（`createCoordinatorApp` 內、第一條 `/api/dev/*` 路由之前）
- Test: `bim-review-coordinator/tests/dev-routes-disabled.test.ts`

- [ ] **Step 1: 寫失敗測試**

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCoordinatorApp, type CoordinatorApp } from "../src/app.js";

// unified-console-runtime-truth slice 2 task 4.4（owner D3 裁決）：ENABLE_DEV_ROUTES=false 時 /api/dev/*
// 整組 404（含 conversions pass-through、ifc-sources、routes/devMeta.ts 的 test-data-projects）；
// 未設定／空字串＝維持開啟（本機 local-windows／隔離 branch stack 不受影響）。devRoutesEnabled() 於
// request 時讀 process.env，故本檔以 beforeEach/afterEach 設定與還原 env。

let active: CoordinatorApp | null = null;
let previousEnableDevRoutes: string | undefined;

beforeEach(() => {
  previousEnableDevRoutes = process.env.ENABLE_DEV_ROUTES;
});

afterEach(async () => {
  if (previousEnableDevRoutes === undefined) delete process.env.ENABLE_DEV_ROUTES;
  else process.env.ENABLE_DEV_ROUTES = previousEnableDevRoutes;
  if (!active) return;
  await active.dispose();
  active.io.close();
  await new Promise<void>((resolve) => active?.server.close(() => resolve()));
  active = null;
});

function makeApp(): CoordinatorApp {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bim-coord-dev-routes-"));
  active = createCoordinatorApp({
    sessionStoreDir: path.join(root, "sessions"),
    eventLogDir: path.join(root, "events"),
    callbackOutboxStorePath: path.join(root, "callback-outbox.json"),
    streamingConversionApiBase: "http://127.0.0.1:1",
    conversionApiBase: "http://127.0.0.1:1",
    corsOrigins: ["http://127.0.0.1:5173"],
    conversionPollEnabled: false,
    storageRoot: root,
    testDataProjectIds: ["270"],
  });
  return active;
}

const DISABLED_BODY = { detail: "dev routes disabled" };

describe("ENABLE_DEV_ROUTES=false → /api/dev/* 一律 404", () => {
  const cases: ReadonlyArray<readonly ["GET" | "POST", string]> = [
    ["POST", "/api/dev/conversions"],
    ["GET", "/api/dev/conversions"],
    ["GET", "/api/dev/conversions/stream_conv_1/result"],
    ["GET", "/api/dev/conversions/stream_conv_1"],
    ["POST", "/api/dev/conversions/mock"],
    ["GET", "/api/dev/ifc-sources"],
    ["POST", "/api/dev/ifc-sources/ifcsrc_x/register"],
    ["GET", "/api/dev/test-data-projects"],
  ];
  it.each(cases)("%s %s → 404 dev routes disabled", async (method, url) => {
    process.env.ENABLE_DEV_ROUTES = "false";
    const app = makeApp();
    const res = method === "GET" ? await request(app.app).get(url) : await request(app.app).post(url).send({});
    expect(res.status).toBe(404);
    expect(res.body).toEqual(DISABLED_BODY);
  });

  it("非 dev 路由不受影響：GET /api/runtime/status 仍 200", async () => {
    process.env.ENABLE_DEV_ROUTES = "false";
    const app = makeApp();
    const res = await request(app.app).get("/api/runtime/status");
    expect(res.status).toBe(200);
  });
});

describe("ENABLE_DEV_ROUTES 未設定／空字串 → 維持開啟", () => {
  it.each([["unset"], [""]])("(%s) GET /api/dev/test-data-projects → 200 且回 config 清單", async (mode) => {
    if (mode === "unset") delete process.env.ENABLE_DEV_ROUTES;
    else process.env.ENABLE_DEV_ROUTES = "";
    const app = makeApp();
    const res = await request(app.app).get("/api/dev/test-data-projects");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ projects: ["270"] });
  });

  it("(unset) POST /api/dev/conversions 仍走 pass-through（上游不可達 → 502，不是 404）", async () => {
    delete process.env.ENABLE_DEV_ROUTES;
    const app = makeApp();
    const res = await request(app.app).post("/api/dev/conversions").send({});
    expect(res.status).toBe(502);
    expect(res.body.detail).toBe("Conversion API unavailable.");
  });
});
```

- [ ] **Step 2: 跑，確認失敗（conversions／test-data-projects 目前無 gate）**

```bash
cd "C:/Repos/active/iot/AI-BIM-governance.worktrees/unified-console-runtime-truth-s2/bim-review-coordinator" && npx vitest run tests/dev-routes-disabled.test.ts
```

預期輸出：`ifc-sources`／`register` 兩案例通過（既有逐路由 gate），`conversions*`（5 案例）與 `test-data-projects` 失敗（502／200 而非 404）；「未設定」三案例通過。

- [ ] **Step 3: app.ts — 在第一條 `/api/dev/*` 路由前掛 prefix gate**

以 Edit 把

```ts
  app.post("/api/dev/conversions", async (request, response) => {
    await proxyConversionService(response, config.conversionApiBase, "POST", "/api/conversions/ifc-to-usdc", request.body);
  });
```

改成

```ts
  // unified-console-runtime-truth slice 2 task 4.4（owner D3 裁決）：/api/dev/* 整組 prefix gate——
  // ENABLE_DEV_ROUTES=false 時一律 404（含下方 conversions pass-through 與 routes/devMeta.ts 在後面 mount 的
  // test-data-projects；Express 依註冊順序執行，故本 middleware 必須排在所有 /api/dev/* 路由之前）。
  // 既有三條路由內的 devRoutesEnabled() 逐路由檢查保留（防禦縱深，行為等價）。/api/dev/* 不是產品路徑。
  app.use("/api/dev", (_request, response, next) => {
    if (!devRoutesEnabled()) {
      response.status(404).json({ detail: "dev routes disabled" });
      return;
    }
    next();
  });

  app.post("/api/dev/conversions", async (request, response) => {
    await proxyConversionService(response, config.conversionApiBase, "POST", "/api/conversions/ifc-to-usdc", request.body);
  });
```

- [ ] **Step 4: 跑新測試＋既有 dev-console／dev-meta 測試＋build**

```bash
cd "C:/Repos/active/iot/AI-BIM-governance.worktrees/unified-console-runtime-truth-s2/bim-review-coordinator" && npm run build && npx vitest run tests/dev-routes-disabled.test.ts tests/dev-console.test.ts tests/dev-meta.test.ts
```

預期輸出：build 無輸出；`dev-routes-disabled` 12 tests pass；`dev-console`／`dev-meta` pass 數與 baseline 相同（env 未設 → 全開）。

- [ ] **Step 5: commit**

```bash
cd "C:/Repos/active/iot/AI-BIM-governance.worktrees/unified-console-runtime-truth-s2" && git add bim-review-coordinator/src/app.ts bim-review-coordinator/tests/dev-routes-disabled.test.ts && git diff --cached --check && git commit -m "feat(coordinator): ENABLE_DEV_ROUTES=false 時 /api/dev/* 整組 404（D3 後端 prefix gate）"
```

預期輸出：2 files changed。

---

#### 3B. D3 compose 透傳＋ `.env.example` parity guard（4.4 部署面；宣告案例預期綠＝(B)，見 Step 2）（原 Task 6）

**Files:**
- Modify: `compose.host-kit.yml`
- Test: `bim-review-coordinator/tests/env-example-dev-routes-parity.test.ts`

- [ ] **Step 1: 寫 parity 測試（沿用 `tests/env-example-lineage-parity.test.ts` 模式）**

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * unified-console-runtime-truth slice 2 task 4.4（owner D3 裁決）：ENABLE_DEV_ROUTES 的 deploy-time
 * parity guard，沿用 env-example-lineage-parity.test.ts（PR #693）模式。
 *
 * deploy.ps1 Phase 2 的 missing-key merge 以 .env.example 為 key source；compose.host-kit.yml 又是
 * dockerized coordinator 唯一的 env 透傳管道（.env 不掛進容器）。兩處缺任一，canonical-linux 的
 * `ENABLE_DEV_ROUTES=false` 就會靜默失效（容器內未定義＝dev routes 開）。
 *
 * 讀取點 source of truth：src/app.ts 的 `process.env.ENABLE_DEV_ROUTES`（devRoutesEnabled）。
 * owner 動作（AI 不讀不改任何 .env*）：在 .env.example 加 `ENABLE_DEV_ROUTES=`（空＝維持開啟；
 * canonical-linux 私有 env 設 false）。該行落地前，第二個 it 預期為紅——這是誠實訊號，不是要繞過的失敗。
 */
describe(".env.example ↔ compose.host-kit.yml ↔ app.ts ENABLE_DEV_ROUTES parity（IMPORTANT — deploy-time missing-key safety net）", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const envExampleText = readFileSync(path.join(here, "..", ".env.example"), "utf8");
  const appSrc = readFileSync(path.join(here, "..", "src", "app.ts"), "utf8");
  const composeText = readFileSync(path.join(here, "..", "..", "compose.host-kit.yml"), "utf8");

  const envLines = envExampleText.split(/\r?\n/).map((line) => line.trim());
  const declaredKeys = new Set(
    envLines
      .map((line) => {
        const m = /^([A-Z0-9_]+)=/.exec(line);
        return m ? m[1] : null;
      })
      .filter((k): k is string => k !== null),
  );
  const lineValue = (key: string): string | null => {
    const line = envLines.find((candidate) => candidate.startsWith(`${key}=`));
    return line === undefined ? null : line.slice(key.length + 1);
  };
  const appReadKeys = Array.from(new Set(Array.from(appSrc.matchAll(/process\.env\.(ENABLE_DEV_ROUTES)/g)).map((m) => m[1])));

  it("app.ts 恰有一個 ENABLE_DEV_ROUTES 讀取點（devRoutesEnabled）", () => {
    expect(appReadKeys).toEqual(["ENABLE_DEV_ROUTES"]);
    expect(appSrc.match(/process\.env\.ENABLE_DEV_ROUTES/g)).toHaveLength(1);
  });

  it("app.ts 讀取的 ENABLE_DEV_ROUTES 在 .env.example 有 `ENABLE_DEV_ROUTES=` 宣告且為空值（owner 動作；落地前預期紅）", () => {
    for (const key of appReadKeys) {
      expect(declaredKeys.has(key), `${key} 未在 .env.example 宣告（owner 需加 \`${key}=\`）`).toBe(true);
      expect(lineValue(key), `${key} 在 .env.example 必須為空值：帶 false 會被 missing-key merge 寫進所有部署目標`).toBe("");
    }
  });

  it("compose.host-kit.yml coordinator environment 透傳 ENABLE_DEV_ROUTES（未設＝空＝維持開啟）", () => {
    expect(composeText).toContain("ENABLE_DEV_ROUTES: ${ENABLE_DEV_ROUTES:-}");
  });
});
```

- [ ] **Step 2: 跑，確認第二、第三案例紅（第一案例綠）**

```bash
cd "C:/Repos/active/iot/AI-BIM-governance.worktrees/unified-console-runtime-truth-s2/bim-review-coordinator" && npx vitest run tests/env-example-dev-routes-parity.test.ts
```

預期輸出：第一個 it（app.ts 恰一個讀取點）**必綠**；第三個 it（compose `toContain`）此刻**必紅**（compose 尚未透傳）。第二個 it（宣告案例）**預期綠＝(B)**（coordinator 更新 2026-08-25：宣告行已 commit `ded6901`）；(A)／(C) 只保留為異常處置——觀測到 (A) 或 (C) 即停手回報，不改 `.env*`：

- **(A) 宣告未落地** → `Tests  2 failed | 1 passed (3)`；第二個 it 的失敗訊息含 `ENABLE_DEV_ROUTES 未在 .env.example 宣告`。
- **(B) 宣告已落地且值為空** → `Tests  1 failed | 2 passed (3)`；唯一紅是 compose 案例。（依 2026-08-25 baseline 的 ` M .env.example` 觀察，這是最可能的一種。）
- **(C) 宣告已落地但值非空**（例如寫成 `ENABLE_DEV_ROUTES=false`） → `Tests  2 failed | 1 passed (3)`，但第二個 it 的失敗訊息是 `必須為空值：帶 false 會被 missing-key merge 寫進所有部署目標`。**此時停手回報 owner**：值必須改回空字串，否則 `deploy.ps1` Phase 2 的 missing-key merge 會把 `false` 寫進**所有**部署目標（含 local-windows），把「只關 canonical-linux」變成「到處關」。**你不得自行修檔**（`.env*` 不改）。

三種狀態一律**不得**為了讓某個預期成立而改動 `.env*`；紅燈本身就是要交付給 owner 的誠實訊號。

> **實測結果（2026-08-25，implementer 補記）：觀測到 (C)，非 coordinator 預期的 (B)。** 失敗訊息為 `expected 'true' to be ''`。根因是 `.env.example` **重複鍵**而非 owner 寫錯值：L66 `ENABLE_DEV_ROUTES=true`（`e1c3578`／PR #222 舊宣告）排在 L75 `ENABLE_DEV_ROUTES=`（`ded6901` owner 追加的空值）之前，而 `scripts/lib/preflight-env.ps1` 的 `Get-EnvExampleDefaultValue`（首個非註解相符行即 `return`）與本測試同為 first-match-wins。依本 (C) 分支停手：**未改任何 `.env*`**；改為（1）在測試補一個「只宣告一次」的 it，讓紅燈直接指出重複鍵這個真因，（2）把停手發現與 owner 待辦寫進 `openspec/changes/unified-console-runtime-truth/tasks.md` §4.4。owner 刪掉 L66 後，本檔應為 `4 passed (4)`（案例數由 3 增為 4）。此期間 4.4／4.5 不打勾，coordinator `npx vitest run` 全量為紅——刻意且已揭露。

- [ ] **Step 3: compose 透傳（放在 `TEST_DATA_PROJECT_IDS` 之後，同一「compose 透傳」型式）**

以 Edit 把 `compose.host-kit.yml` 的

```yaml
      TEST_DATA_PROJECT_IDS: ${TEST_DATA_PROJECT_IDS:-}
```

改成

```yaml
      TEST_DATA_PROJECT_IDS: ${TEST_DATA_PROJECT_IDS:-}
      # unified-console-runtime-truth（owner D3 裁決 2026-08-25）：/api/dev/* demo 路由開關透傳。
      # 未設定＝空字串＝維持開啟（local-windows／隔離 branch stack 不受影響）；canonical-linux 由 owner
      # 在私有 canonical env 設 ENABLE_DEV_ROUTES=false → 容器內 /api/dev/* 一律 404（coordinator prefix gate）。
      ENABLE_DEV_ROUTES: ${ENABLE_DEV_ROUTES:-}
```

- [ ] **Step 4: 再跑 parity＋compose 靜態守衛＋compose 語法**

```bash
cd "C:/Repos/active/iot/AI-BIM-governance.worktrees/unified-console-runtime-truth-s2/bim-review-coordinator" && npx vitest run tests/env-example-dev-routes-parity.test.ts; cd .. && pwsh -NoProfile -File scripts/tests/test-deploy-governance-static.ps1; echo "static-exit=$?"
```

預期輸出：compose 案例轉綠；`static-exit=0`（守衛只斷言既有字串存在，加行不影響）。vitest 結果承接 Step 2 觀測到的分支：

- Step 2 為 **(A)** → `Tests  1 failed | 2 passed (3)`，**唯一**紅是「.env.example 宣告」案例（owner 動作，刻意保留，已在 tasks.md／PR body 揭露）。
- Step 2 為 **(B)**（預期） → `Tests  3 passed (3)` **全綠**。coordinator 更新 2026-08-25：宣告行已 commit（`ded6901`），這個綠同時是 CI 的綠；Task 12 Step 1 全量預期全綠；4.5 於 Task 12 打勾（Edit E），4.4 仍只註記。
- Step 2 為 **(C)** → 仍 `Tests  1 failed | 2 passed (3)`，紅的是宣告案例的「必須為空值」斷言；照 Step 2 (C) 停手回報，不改 `.env*`。

若 `docker` 可用可再跑 `docker compose -f compose.yml -f compose.host-kit.yml config --quiet`（exit 0）；不可用則記為 skipped gap。

- [ ] **Step 5: commit（(A)／(C) 分支帶著紅測試 commit 是刻意的，已在 tasks.md／PR body 揭露；`git add` 逐檔列舉，絕不掃到 `.env*`）**

```bash
cd "C:/Repos/active/iot/AI-BIM-governance.worktrees/unified-console-runtime-truth-s2" && git add compose.host-kit.yml bim-review-coordinator/tests/env-example-dev-routes-parity.test.ts && git diff --cached --check && git commit -m "chore(compose): 透傳 ENABLE_DEV_ROUTES 並加 .env.example parity guard（D3 部署面；owner 補宣告前 parity 預期紅）"
```

預期輸出：2 files changed。

---

### Task 4: 前端 dev routes 404 誠實狀態（client 可辨識 404＋`#demo-control`＋A1 workbench 測試資料清單）

> 本 task 由多個原 task 併成（額度／commit 錨點考量，coordinator 2026-08-25）：各子段（#### nA／nB…）的步驟、驗證與 commit 指令**逐字照做**，每段結尾的 commit 都要做；本 task 所有 commit message 一律以「task#<本 task 在 implementer 提示中的 index>: 」開頭再接原訊息。子段標題括號內的「原 Task N」對應文中所有「Task N Step M」的引用。

#### 4A. 前端 client — `CoordinatorHttpError`／`isCoordinatorNotFound`（404 可辨識，message 逐字不變）（原 Task 7）

**Files:**
- Modify: `web-viewer-sample/src/console/coordinatorClient.ts`（`jsonGet`）
- Test: `web-viewer-sample/src/console/coordinatorClient.httpError.test.ts`

- [ ] **Step 1: impact**

```bash
cd "C:/Repos/active/iot/AI-BIM-governance.worktrees/unified-console-runtime-truth-s2" && npx gitnexus@1.6.9 impact jsonGet -f web-viewer-sample/src/console/coordinatorClient.ts -d upstream -r AI-BIM-governance --summary-only
```

預期輸出：`risk` 為 `LOW` 或 `MEDIUM`（直接呼叫者為 `coordinatorClient` 物件內的 getter 群）。HIGH／CRITICAL 停手回報。

- [ ] **Step 2: 寫失敗測試**

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoordinatorHttpError, coordinatorClient, isCoordinatorNotFound } from "./coordinatorClient";

// unified-console-runtime-truth slice 2（D3）：消費者要能區分「404＝dev routes 已關閉」與其他失敗，
// 但既有 `coordinator <path> -> <status> <detail>` 訊息格式已被多處 String(e) 顯示依賴——
// 故 jsonGet 改丟帶 status 的 Error 子類，message 逐字不變。

describe("coordinatorClient jsonGet 失敗 → CoordinatorHttpError", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("404 dev routes disabled → status 404、isCoordinatorNotFound=true、message 保留舊格式", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ detail: "dev routes disabled" }), { status: 404, headers: { "content-type": "application/json" } }),
    );
    const error = await coordinatorClient.getTestDataProjects().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CoordinatorHttpError);
    expect((error as CoordinatorHttpError).status).toBe(404);
    expect((error as CoordinatorHttpError).path).toBe("/api/dev/test-data-projects");
    expect((error as Error).message).toBe("coordinator /api/dev/test-data-projects -> 404 dev routes disabled");
    expect(isCoordinatorNotFound(error)).toBe(true);
  });

  it("503 → status 503、isCoordinatorNotFound=false；非 CoordinatorHttpError 一律 false", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ detail: "down" }), { status: 503, headers: { "content-type": "application/json" } }),
    );
    const error = await coordinatorClient.getConversionsHistory().catch((e: unknown) => e);
    expect((error as CoordinatorHttpError).status).toBe(503);
    expect(isCoordinatorNotFound(error)).toBe(false);
    expect(isCoordinatorNotFound(new Error("coordinator /x -> 404 y"))).toBe(false);
    expect(isCoordinatorNotFound(null)).toBe(false);
  });
});
```

- [ ] **Step 3: 跑，確認失敗（export 不存在）**

```bash
cd "C:/Repos/active/iot/AI-BIM-governance.worktrees/unified-console-runtime-truth-s2/web-viewer-sample" && npx vitest run src/console/coordinatorClient.httpError.test.ts
```

預期輸出：`TypeError` / `CoordinatorHttpError is not a constructor` 或 `expected … to be an instance of CoordinatorHttpError`，`Tests  2 failed`。

- [ ] **Step 4: 實作（只動 `jsonGet`；`jsonPost`／`jsonPut`／`jsonPostWithHeaders` 不動）**

以 Edit 把 `web-viewer-sample/src/console/coordinatorClient.ts` 的

```ts
async function jsonGet<T>(path: string): Promise<T> {
```

改成

```ts
// unified-console-runtime-truth slice 2（D3）：呼叫端需要區分「404＝dev routes 已關閉（canonical-linux）」
// 與其他失敗，但既有 `coordinator <path> -> <status> <detail>` 訊息格式已被多處 String(e) 顯示依賴——
// 故以 Error 子類攜帶 status／path，message 逐字不變。目前只有 jsonGet 丟此類（消費者：getTestDataProjects、
// getConversionsHistory）；其他原語維持既有 Error（不在本切片範圍）。
export class CoordinatorHttpError extends Error {
  constructor(readonly path: string, readonly status: number, detail: string) {
    super(`coordinator ${path} -> ${status} ${detail}`);
    this.name = "CoordinatorHttpError";
  }
}

/** 404 專屬判定：/api/dev/* 於 ENABLE_DEV_ROUTES=false 回 404 → 消費者顯示「dev routes 已關閉」而非泛用錯誤。 */
export function isCoordinatorNotFound(error: unknown): boolean {
  return error instanceof CoordinatorHttpError && error.status === 404;
}

async function jsonGet<T>(path: string): Promise<T> {
```

再以 Edit 把（`jsonGet` 內、註解結尾那一行＋throw）

```ts
    // 未配置」等可操作提示吞成無意義的 "404 Not Found"。errorDetail best-effort，無 body 才退 statusText。
    throw new Error(`coordinator ${path} -> ${res.status} ${await errorDetail(res)}`);
```

改成

```ts
    // 未配置」等可操作提示吞成無意義的 "404 Not Found"。errorDetail best-effort，無 body 才退 statusText。
    throw new CoordinatorHttpError(path, res.status, await errorDetail(res));
```

- [ ] **Step 5: 跑測試＋tsc＋既有 client 測試**

```bash
cd "C:/Repos/active/iot/AI-BIM-governance.worktrees/unified-console-runtime-truth-s2/web-viewer-sample" && npx tsc --noEmit && npx vitest run src/console/coordinatorClient.httpError.test.ts src/console/coordinatorClient.test.ts src/console/coordinatorClient.conversions-history.test.ts src/console/clientTimeout.test.ts
```

預期輸出：tsc 無輸出；vitest 全 pass（新檔 2 tests）。

- [ ] **Step 6: commit**

```bash
cd "C:/Repos/active/iot/AI-BIM-governance.worktrees/unified-console-runtime-truth-s2" && git add web-viewer-sample/src/console/coordinatorClient.ts web-viewer-sample/src/console/coordinatorClient.httpError.test.ts && git diff --cached --check && git commit -m "feat(web-viewer): coordinatorClient jsonGet 以 CoordinatorHttpError 攜帶 status（message 逐字不變）"
```

預期輸出：2 files changed。

---

#### 4B. 前端 `#demo-control`（`RealIfcConsolePage`）— dev routes 404 誠實狀態（原 Task 8）

**Files:**
- Modify: `web-viewer-sample/src/console/RealIfcConsolePage.tsx`
- Test: `web-viewer-sample/src/console/RealIfcConsolePage.test.tsx`

- [ ] **Step 1: impact**

```bash
cd "C:/Repos/active/iot/AI-BIM-governance.worktrees/unified-console-runtime-truth-s2" && npx gitnexus@1.6.9 impact RealIfcConsolePage -d upstream -r AI-BIM-governance --summary-only
```

預期輸出：`risk: "LOW"`，`direct: 1`（`EdgeConsole.tsx` `renderBody`）。

- [ ] **Step 2: 寫失敗測試**

```tsx
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RealIfcConsolePage } from "./RealIfcConsolePage";

// unified-console-runtime-truth slice 2 task 4.4（D3）：#demo-control 依賴 /api/dev/ifc-sources；
// canonical-linux ENABLE_DEV_ROUTES=false → 404 時誠實顯示「dev routes 已關閉」，不崩潰、不假資料
//（改前行為：404 body 無 items → 當空清單 → 假報 storage_empty）。測試模式比照 ConversionHistoryPanel.test.tsx。

async function flush(ticks = 6): Promise<void> {
  for (let i = 0; i < ticks; i += 1) await act(async () => { await Promise.resolve(); });
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("RealIfcConsolePage（#demo-control）dev routes 已關閉", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("GET /api/dev/ifc-sources → 404：notice、runtime=dev_routes_disabled、註冊鈕 disabled、不假報 storage_empty", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/api/dev/ifc-sources")) return jsonResponse({ detail: "dev routes disabled" }, 404);
      throw new Error(`unexpected fetch ${url}`);
    });
    await act(async () => { root.render(<RealIfcConsolePage />); });
    await flush();

    expect(container.querySelector('[data-testid="ifc-dev-routes-notice"]')?.textContent).toContain("dev routes 已關閉");
    expect(container.querySelector('[data-testid="ifc-runtime-state"]')?.textContent).toContain("dev_routes_disabled");
    expect(container.querySelector<HTMLButtonElement>('[data-testid="ifc-register-btn"]')?.disabled).toBe(true);
    expect(container.textContent).not.toContain("storage_empty");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("200 且 items 為空 → 維持既有 storage_empty 語意，無 notice，註冊鈕可用", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ root: { exists: true, readable: true, item_count: 0 }, items: [] }, 200));
    await act(async () => { root.render(<RealIfcConsolePage />); });
    await flush();

    expect(container.querySelector('[data-testid="ifc-dev-routes-notice"]')).toBeNull();
    expect(container.querySelector('[data-testid="ifc-runtime-state"]')?.textContent).toContain("storage_empty");
    expect(container.querySelector<HTMLButtonElement>('[data-testid="ifc-register-btn"]')?.disabled).toBe(false);
  });
});
```

- [ ] **Step 3: 跑，確認第一案例失敗（現況假報 storage_empty）**

```bash
cd "C:/Repos/active/iot/AI-BIM-governance.worktrees/unified-console-runtime-truth-s2/web-viewer-sample" && npx vitest run src/console/RealIfcConsolePage.test.tsx
```

預期輸出：`Tests  1 failed | 1 passed (2)`，失敗於 `ifc-dev-routes-notice` 為 `undefined`。

- [ ] **Step 4: 實作（四個 Edit）**

(a) state：把

```tsx
  const [viewerUrl, setViewerUrl] = useState<string>("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
```

改成

```tsx
  const [viewerUrl, setViewerUrl] = useState<string>("");
  // D3（unified-console-runtime-truth 4.4）：canonical-linux 設 ENABLE_DEV_ROUTES=false → /api/dev/ifc-sources 404。
  // 誠實顯示「dev routes 已關閉」，不把 404 body 當空清單（那會假報 storage_empty）。
  const [devRoutesDisabled, setDevRoutesDisabled] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
```

(b) `loadSources`：把

```tsx
      const r = await fetch(coordinatorUrl("/api/dev/ifc-sources"));
      const j = await r.json();
      const items: IfcSource[] = j.items ?? [];
```

改成

```tsx
      const r = await fetch(coordinatorUrl("/api/dev/ifc-sources"));
      if (r.status === 404) {
        setDevRoutesDisabled(true);
        setSources([]);
        setSelected("");
        setRuntime("runtime: dev_routes_disabled (ENABLE_DEV_ROUTES=false on this coordinator; /api/dev/ifc-sources -> 404)");
        return;
      }
      setDevRoutesDisabled(false);
      const j = await r.json();
      const items: IfcSource[] = j.items ?? [];
```

(c) `register`：把

```tsx
  async function register() {
    stop();
    const meta = sources.find((s) => s.source_id === selected);
```

改成

```tsx
  async function register() {
    stop();
    if (devRoutesDisabled) { setRuntime("runtime: dev_routes_disabled (register unavailable)"); return; }
    const meta = sources.find((s) => s.source_id === selected);
```

(d) JSX：把

```tsx
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", margin: "10px 0" }}>
        <label htmlFor="ifcFixtureSelect">IFC fixture</label>
        <select id="ifcFixtureSelect" data-testid="ifc-fixture-select" value={selected} onChange={(e) => setSelected(e.target.value)} style={{ minWidth: 360 }}>
          {sources.length === 0 ? (
            <option value="">（No real IFC files found under ./storage）</option>
          ) : (
```

改成

```tsx
      {devRoutesDisabled && (
        <p className="ec-warn-note" role="status" data-testid="ifc-dev-routes-notice">
          {t("dev routes 已關閉（canonical-linux：ENABLE_DEV_ROUTES=false）。此頁依賴 /api/dev/ifc-sources，於本部署不可用；請改由 #minio 對 bucket 物件觸發轉檔。", "dev routes are disabled (canonical-linux: ENABLE_DEV_ROUTES=false). This page depends on /api/dev/ifc-sources and is unavailable on this deployment; trigger conversions from #minio instead.")}
        </p>
      )}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", margin: "10px 0" }}>
        <label htmlFor="ifcFixtureSelect">IFC fixture</label>
        <select id="ifcFixtureSelect" data-testid="ifc-fixture-select" value={selected} onChange={(e) => setSelected(e.target.value)} style={{ minWidth: 360 }} disabled={devRoutesDisabled}>
          {sources.length === 0 ? (
            <option value="">{devRoutesDisabled ? t("（dev routes 已關閉）", "(dev routes disabled)") : "（No real IFC files found under ./storage）"}</option>
          ) : (
```

以及把

```tsx
        <button data-testid="ifc-register-btn" onClick={() => void register()}>{t("註冊並轉檔（真實）", "Register and convert (real)")}</button>
```

改成

```tsx
        <button data-testid="ifc-register-btn" disabled={devRoutesDisabled} onClick={() => void register()}>{t("註冊並轉檔（真實）", "Register and convert (real)")}</button>
```

- [ ] **Step 5: 跑測試＋tsc＋既有 console 路由測試**

```bash
cd "C:/Repos/active/iot/AI-BIM-governance.worktrees/unified-console-runtime-truth-s2/web-viewer-sample" && npx tsc --noEmit && npx vitest run src/console/RealIfcConsolePage.test.tsx src/console/EdgeConsole.aliasRedirect.test.tsx
```

預期輸出：tsc 無輸出；`RealIfcConsolePage.test.tsx` 2 pass；alias 測試 pass。

- [ ] **Step 6: commit**

```bash
cd "C:/Repos/active/iot/AI-BIM-governance.worktrees/unified-console-runtime-truth-s2" && git add web-viewer-sample/src/console/RealIfcConsolePage.tsx web-viewer-sample/src/console/RealIfcConsolePage.test.tsx && git diff --cached --check && git commit -m "feat(web-viewer): #demo-control 於 /api/dev/ifc-sources 404 誠實顯示 dev routes 已關閉"
```

預期輸出：2 files changed。

---

> **Task 9（`/api/dev/conversions` 消費者）HELD／待 owner D5 裁決——不是本 PR 的 task。** 保留稿移至文末「Appendix A」；執行者做完 Task 8 直接做 Task 10（task 編號刻意留空 9）。

#### 4C. 前端 A1 workbench 測試資料清單 404 誠實 note（原 Task 10）

**Files:**
- Modify: `web-viewer-sample/src/console/A1GovernanceWorkbenchPage.tsx`
- Modify: `web-viewer-sample/src/console/console.test.tsx`（A1 describe 內新增案例）

- [ ] **Step 1: impact**

```bash
cd "C:/Repos/active/iot/AI-BIM-governance.worktrees/unified-console-runtime-truth-s2" && npx gitnexus@1.6.9 impact A1GovernanceWorkbenchPage -d upstream -r AI-BIM-governance --summary-only
```

預期輸出：`risk: "LOW"`，`direct: 1`（`EdgeConsole.tsx` `renderBody`）。

- [ ] **Step 2: 寫失敗測試（插在既有 R8 案例之前，沿用該 describe 的 beforeEach mocks）**

先把 `console.test.tsx` 的 import

```ts
import { coordinatorClient, type RuntimeStatus } from "./coordinatorClient";
```

改成

```ts
import { CoordinatorHttpError, coordinatorClient, type RuntimeStatus } from "./coordinatorClient";
```

再把

```tsx
  it("[R8 測試資料標記] local_fs 選項對 config 清單內專案加〔測試資料〕；MinIO 選項不標", async () => {
```

改成

```tsx
  it("[D3 dev routes 已關閉] getTestDataProjects 404 → 顯示測試資料標記不可用 note；local_fs select 仍在", async () => {
    (coordinatorClient.getTestDataProjects as ReturnType<typeof vi.fn>).mockRejectedValue(
      new CoordinatorHttpError("/api/dev/test-data-projects", 404, "dev routes disabled"),
    );
    const root = createRoot(container);
    await act(async () => { root.render(<A1GovernanceWorkbenchPage />); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    expect(container.querySelector('[data-testid="a1-testdata-devroutes-note"]')?.textContent).toContain("dev routes 已關閉");
    expect(container.querySelector('[data-testid="a1-localfs-select"]')).not.toBeNull();
  });

  it("[R8 測試資料標記] local_fs 選項對 config 清單內專案加〔測試資料〕；MinIO 選項不標", async () => {
```

- [ ] **Step 3: 跑，確認新案例失敗**

```bash
cd "C:/Repos/active/iot/AI-BIM-governance.worktrees/unified-console-runtime-truth-s2/web-viewer-sample" && npx vitest run src/console/console.test.tsx -t "D3 dev routes"
```

預期輸出：`Tests  1 failed`（note 元素為 undefined），其餘 skipped。

- [ ] **Step 4: 實作**

把 `A1GovernanceWorkbenchPage.tsx` 的 import

```ts
import { coordinatorClient, IfcReadyListItem, IfcReadyReviewSessionResponse, RuntimeSessionSummary, RuntimeStatus } from "./coordinatorClient";
```

改成

```ts
import { coordinatorClient, IfcReadyListItem, IfcReadyReviewSessionResponse, isCoordinatorNotFound, RuntimeSessionSummary, RuntimeStatus } from "./coordinatorClient";
```

把

```ts
  const [testDataProjects, setTestDataProjects] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    coordinatorClient.getTestDataProjects()
      .then((r) => { if (alive) setTestDataProjects(r.projects); })
      .catch(() => { /* 取不到就不標；不擋 A1 流程 */ });
    return () => { alive = false; };
  }, []);
```

改成

```ts
  const [testDataProjects, setTestDataProjects] = useState<string[]>([]);
  // D3（unified-console-runtime-truth 4.4）：canonical-linux ENABLE_DEV_ROUTES=false → /api/dev/test-data-projects 404。
  // 誠實標示「測試資料標記不可用」，仍不阻塞 A1 流程；其他失敗維持靜默不標。
  const [testDataDevRoutesDisabled, setTestDataDevRoutesDisabled] = useState(false);
  useEffect(() => {
    let alive = true;
    coordinatorClient.getTestDataProjects()
      .then((r) => { if (alive) { setTestDataProjects(r.projects); setTestDataDevRoutesDisabled(false); } })
      .catch((error: unknown) => { if (alive && isCoordinatorNotFound(error)) setTestDataDevRoutesDisabled(true); /* 其他失敗：不標；不擋 A1 流程 */ });
    return () => { alive = false; };
  }, []);
```

把

```tsx
          {sourceKind === "local_fs" ? (
            <>
              {/* option value = 唯一邏輯鍵 {projectId}/{modelId}/{version.name}（＝modelVersionId）。
```

改成

```tsx
          {sourceKind === "local_fs" ? (
            <>
              {testDataDevRoutesDisabled && (
                <p className="ec-note" data-testid="a1-testdata-devroutes-note">
                  {t("測試資料標記不可用：dev routes 已關閉（canonical-linux：ENABLE_DEV_ROUTES=false，GET /api/dev/test-data-projects 404）。", "Test-data badge unavailable: dev routes are disabled (canonical-linux: ENABLE_DEV_ROUTES=false, GET /api/dev/test-data-projects 404).")}
                </p>
              )}
              {/* option value = 唯一邏輯鍵 {projectId}/{modelId}/{version.name}（＝modelVersionId）。
```

- [ ] **Step 5: 跑 tsc＋console.test.tsx 全檔＋A1 相關測試**

```bash
cd "C:/Repos/active/iot/AI-BIM-governance.worktrees/unified-console-runtime-truth-s2/web-viewer-sample" && npx tsc --noEmit && npx vitest run src/console/console.test.tsx src/console/A1IssueSnapshot.test.tsx src/console/A1CrossLinks.test.tsx
```

預期輸出：tsc 無輸出；全 pass（`console.test.tsx` pass 數＝baseline＋1）。

- [ ] **Step 6: commit**

```bash
cd "C:/Repos/active/iot/AI-BIM-governance.worktrees/unified-console-runtime-truth-s2" && git add web-viewer-sample/src/console/A1GovernanceWorkbenchPage.tsx web-viewer-sample/src/console/console.test.tsx && git diff --cached --check && git commit -m "feat(web-viewer): A1 workbench 測試資料清單 404 誠實 note（dev routes 已關閉）"
```

預期輸出：2 files changed。

---

### Task 5: Browser E2E＋全量驗證（4.5）＋tasks.md 勾選／註記＋openspec validate＋detect-changes

> 本 task 由多個原 task 併成（額度／commit 錨點考量，coordinator 2026-08-25）：各子段（#### nA／nB…）的步驟、驗證與 commit 指令**逐字照做**，每段結尾的 commit 都要做；本 task 所有 commit message 一律以「task#<本 task 在 implementer 提示中的 index>: 」開頭再接原訊息。子段標題括號內的「原 Task N」對應文中所有「Task N Step M」的引用。

#### 5A. Browser E2E（Playwright）— dev routes 已關閉 UI 垂直切片＋T4 API 契約探針（原 Task 11）

**Files:**
- Modify: `web-viewer-sample/e2e/dev-routes-disabled-operator-token.spec.ts`（兩個 UI tests；trace on）
- Create: `web-viewer-sample/e2e/dev-routes-disabled-operator-token.api.spec.ts`（單一 API probe；trace/screenshot/video off）
- 執行環境：branch coordinator `:8005`（本 worktree 最新碼）＋ Playwright webServer 起的 viewer `:5180`（`playwright.config.ts` 既有）。

誠實邊界（寫進 spec 檔頭）：本切片 **沒有** `/ui` 殼層 operator token 輸入（spec §3 out of scope，另切片）——UI 面「LAN 觸發轉檔」仍是 403，屬 NOT BUILT，本 E2E 不假裝可觸發；T4 token 路徑／速率限制／lineage＋webhook 面不變改以 Playwright `request`（server-side）驗；UI 只驗 D3 的 404 誠實狀態。無 skip 偽綠：以 `E2E_REQUIRE_REAL=1` 跑，前置缺失＝fail。credential-bearing API probe 使用獨立 `.api.spec.ts` 檔案與 worker scope，並固定 `trace: "off"`、`screenshot: "off"`、`video: "off"`；兩個 UI tests 留在原檔並明確 `trace: "on"`。

- [ ] **Step 1: 寫 spec**

> **r6 executable correction（2026-08-27）**：下方單檔 code fence 是歷史草稿，不再是可執行 source。現行 source of truth 是上述兩檔：UI 檔只含兩個 browser tests；API 檔只含一個 token probe，並各自 fail closed preflight。正式 discovery 必須精確得到兩檔共 3 tests。

```ts
import { test, expect, type APIRequestContext } from "@playwright/test";

// unified-console-runtime-truth slice 2（§4 coordinator：T4 operator-token per-route 授權＋D3 dev routes 關閉）
// browser 垂直切片。前置：branch coordinator :8005 以下列 env 啟動（plan Task 11 Step 2）：
//   ENABLE_DEV_ROUTES=false  EXTERNAL_INTAKE_IP_ALLOWLIST=10.0.0.0/8
//   DEV_AUTH_TOKEN=<ephemeral test-only value>，並由 E2E_DEV_AUTH_TOKEN 傳同一值；不得落盤到 evidence。
//   MINIO_WATCH_ENABLED=false  CORS_ORIGINS=http://127.0.0.1:5180
// viewer 由 playwright.config.ts webServer 在 :5180 起（VITE_COORDINATOR_API_BASE=E2E_COORDINATOR_BASE_URL）。
// 誠實鐵律：
//   - UI 面：本切片 **沒有** /ui 殼層 operator token 輸入（spec §3 out of scope，另切片）；LAN 瀏覽器觸發轉檔仍 403，
//     屬 NOT BUILT——本 spec 不假裝可觸發，UI 只驗 D3「dev routes 已關閉」誠實狀態，且只驗 canonical scenario
//     明列的兩頁（#demo-control、#a1-workbench）；#conv／#minio 的 /api/dev/conversions 消費者為 HELD（plan Task 9 D5）。
//   - API 面：T4 token 路徑／速率限制／lineage＋webhook 面不變，以 Playwright request（server-side，非瀏覽器）驗。
//   - fail-gate：前置缺失直接 fail（不 skip）；E2E_REQUIRE_REAL=1 reporter 另拒絕任何意外 skip。
const COORDINATOR = process.env.E2E_COORDINATOR_BASE_URL || "http://127.0.0.1:8005";
const OPERATOR_TOKEN = (process.env.E2E_DEV_AUTH_TOKEN ?? "").trim();
const PRIORITIZE_URL = `${COORDINATOR}/api/conversion/jobs/ifcready_nope/prioritize`;

async function preflight(request: APIRequestContext): Promise<string | null> {
  try {
    const health = await request.get(`${COORDINATOR}/health`);
    if (!health.ok()) return `coordinator ${COORDINATOR}/health 非 2xx（${health.status()}）`;
    const dev = await request.get(`${COORDINATOR}/api/dev/ifc-sources`);
    if (dev.status() !== 404) return `coordinator 未以 ENABLE_DEV_ROUTES=false 啟動（GET /api/dev/ifc-sources → ${dev.status()}）`;
    const bare = await request.post(PRIORITIZE_URL, { data: {} });
    if (bare.status() !== 403) return `coordinator allowlist 未排除 loopback（無 token prioritize → ${bare.status()}，預期 403）`;
    return null;
  } catch (error) {
    return `coordinator ${COORDINATOR} 不可達：${String(error)}`;
  }
}

test.describe("slice 2：dev routes 已關閉（UI 誠實）＋ T4 operator token（API）", () => {
  test.setTimeout(150_000);
  let skipReason: string | null = null;

  test.beforeAll(async ({ request }) => { skipReason = await preflight(request); });
  test.beforeEach(() => { test.skip(skipReason !== null, skipReason ?? ""); });

  test("#demo-control：GET /api/dev/ifc-sources 404 → notice、runtime=dev_routes_disabled、註冊鈕 disabled", async ({ page }) => {
    const [devRes] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/dev/ifc-sources"), { timeout: 30_000 }),
      page.goto("/#demo-control"),
    ]);
    expect(devRes.status()).toBe(404);
    await expect(page.getByTestId("ifc-dev-routes-notice")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("ifc-runtime-state")).toContainText("dev_routes_disabled");
    await expect(page.getByTestId("ifc-runtime-state")).not.toContainText("storage_empty");
    await expect(page.getByTestId("ifc-register-btn")).toBeDisabled();
    await page.screenshot({ path: "../artifacts/e2e/dev-routes-disabled-demo-control.png", fullPage: true });
  });

  // Task 9（`/api/dev/conversions` 消費者 → `#conv`／`#minio` 專屬「dev routes 已關閉」字樣）為 HELD——
  // canonical scenario 只列 #demo-control 與 A1 workbench local_fs 清單。故本 spec **不寫** #conv／#minio
  // 案例（`conv-history-dev-routes-disabled` 這個 testid 在本 PR 根本不存在，寫了必紅＝假需求）。
  // 現況殘留行為（誠實揭露，不在此斷言）：兩頁會顯示既有籠統訊息「轉檔歷史更新失敗；保留上一份結果。」
  // owner D5 若裁「納入」，屆時再補本案例與對應 screenshot。

  test("#a1-workbench：GET /api/dev/test-data-projects 404 → 測試資料標記不可用 note（不阻塞 A1）", async ({ page }) => {
    await page.goto("/#a1-workbench");
    await expect(page.getByTestId("a1-testdata-devroutes-note")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("a1-localfs-select")).toBeVisible();
    await page.screenshot({ path: "../artifacts/e2e/dev-routes-disabled-a1-workbench.png", fullPage: true });
  });

  test("API：T4 token 路徑（無 token 403 → 正確 token 通過 → 錯誤 token 403 → 超額 429）＋ lineage 不解鎖 ＋ dev 404", async ({ request }) => {
    const bare = await request.post(PRIORITIZE_URL, { data: {} });
    expect(bare.status()).toBe(403);
    expect(await bare.json()).toEqual({ detail: "caller ip not in allowlist" });

    // 對「一分鐘內重跑」穩健：若一開始就 429，等 Retry-After 再試一次。
    let ok = await request.post(PRIORITIZE_URL, { data: {}, headers: { "x-operator-token": OPERATOR_TOKEN } });
    if (ok.status() === 429) {
      const waitSeconds = Number(ok.headers()["retry-after"] ?? "60");
      await new Promise((resolve) => setTimeout(resolve, (waitSeconds + 1) * 1000));
      ok = await request.post(PRIORITIZE_URL, { data: {}, headers: { "x-operator-token": OPERATOR_TOKEN } });
    }
    expect(ok.status()).toBe(404); // 授權通過 → 落到既有「job 不存在」

    const wrong = await request.post(PRIORITIZE_URL, { data: {}, headers: { "x-operator-token": "wrong-token" } });
    expect(wrong.status()).toBe(403);
    expect(await wrong.json()).toEqual({ detail: "operator token invalid (x-operator-token)" });

    // 速率：同來源 token 路徑每分鐘 10 次；上面已用 2 次，最多再 12 次內必見 429。
    let limitedRetryAfter: string | null = null;
    for (let i = 0; i < 12 && limitedRetryAfter === null; i += 1) {
      const res = await request.post(PRIORITIZE_URL, { data: {}, headers: { "x-operator-token": OPERATOR_TOKEN } });
      if (res.status() === 429) limitedRetryAfter = res.headers()["retry-after"] ?? "missing";
      else expect(res.status()).toBe(404);
    }
    expect(limitedRetryAfter).not.toBeNull();
    expect(Number(limitedRetryAfter)).toBeGreaterThanOrEqual(1);

    // lineage 面不變：token 不解鎖（deps 注入的 rejectIfIpNotAllowed 逐字）。
    const preview = await request.get(`${COORDINATOR}/api/lineage/legacy-unmanaged/preview?grouping_key=tenant-a/legacy`, {
      headers: { "x-operator-token": OPERATOR_TOKEN },
    });
    expect(preview.status()).toBe(403);
    expect(await preview.json()).toEqual({ detail: "caller ip not in allowlist" });

    // D3：/api/dev/* 整組 404。
    expect((await request.post(`${COORDINATOR}/api/dev/conversions`, { data: {} })).status()).toBe(404);
    expect((await request.get(`${COORDINATOR}/api/dev/test-data-projects`)).status()).toBe(404);
  });
});
```

- [ ] **Step 2: 起 branch coordinator :8005（背景；資料目錄全部指到 tmp，不污染 worktree）**

```text
使用本次 run 的 ownership-gated P4 launcher：它在記憶體產生 32-byte ephemeral token，將同一值只注入 branch coordinator 的 `DEV_AUTH_TOKEN` 與 Playwright process 的 `E2E_DEV_AUTH_TOKEN`，建立隔離 runtime stores，並在啟動／停止前後以 entrypoint、listener lineage、creation identity 重驗。launcher 不得把 token 值輸出到 stdout、summary、trace 或 report；缺任一 ownership postcondition 即 fail closed。
```

預期 preflight：`/health=200`、`/api/dev/ifc-sources=404`、無 token prioritize `403`、授權後 nonexistent-job prioritize `404`。若 `:8005` 已被佔用（`address already in use`），不得依裸 PID 強制停止；只可由本次 launcher 以 entrypoint、listener lineage 與 creation identity 重驗後停止其 owned process，無法證明 ownership 即 HELD。也可改用未佔用的 `PORT=8006`，並在 Step 3 覆寫 `E2E_COORDINATOR_BASE_URL=http://127.0.0.1:8006`。

- [ ] **Step 3: 使用 exact-HEAD、ownership-gated runner 取得 E2E 證據**

```powershell
pwsh -NoProfile -NonInteractive -File web-viewer-sample/s2-r6.local/run-p4.ps1
```

r6 的既有證據只綁定 `subjectHead=8081c2a12308adcb2b04b566c87e168d7c77be9c`；上述 ignored runner 對其他 HEAD 會 fail closed，且目前僅保留作 provenance／future template，**不得在新 HEAD 直接重跑**。不得使用 `s2-r5.local/playwright.config.ts` 取代 r6 runner；現行 API spec 的 file-level `test.use` 雖仍關閉 trace／screenshot／video，但該舊 config 不提供 r6 的分離 API project/output、artifact cardinality、exact-head 與 cleanup gates。若新 HEAD 需要重取證據，必須先建立經 security/process review 的新 rN runner，將 `expectedHead` 綁定新 immutable SHA，並重新產生 split UI/API outputs、result JSON 與 summary。預期契約仍為兩檔共 `3 passed`、兩張 UI 截圖、UI output 兩條 trace、API output 0 trace／0 screenshot／0 video；不得移除 `E2E_REQUIRE_REAL` 或為 API probe 開啟 trace。

- [ ] **Step 4: 確認 worktree 未被 runtime 檔污染**

```bash
cd "C:/Repos/active/iot/AI-BIM-governance.worktrees/unified-console-runtime-truth-s2" && git status --short
```

預期輸出只包含本 task 已審核的 tracked paths；gitignored evidence/runtime stores 另由 launcher custody manifest 列舉。若出現未知 tracked/untracked runtime 檔，保留現況並 HELD，回報缺哪個 `*_STORE_PATH` env；不得自行刪除或 clean。

- [ ] **Step 5: 停 coordinator**

```text
由本次 ownership-gated launcher 的 finally/closeout 停止：停止前重新驗證 executable、entrypoint、listener owner 與 creation identity；停止後驗證 run-owned PID 消失、port 無 listener、generated .env 已移除。
```

任一 ownership 證據不一致即拒絕停止並 HELD；不得改用裸 `kill`、`taskkill /F` 或只憑 pidfile／port 的替代流程。

- [ ] **Step 6: commit**

```bash
cd "C:/Repos/active/iot/AI-BIM-governance.worktrees/unified-console-runtime-truth-s2" && git add docs/superpowers/plans/2026-08-25-unified-console-runtime-truth-s2.md openspec/changes/unified-console-runtime-truth/tasks.md web-viewer-sample/e2e/dev-routes-disabled-operator-token.spec.ts web-viewer-sample/src/console/A1GovernanceWorkbenchPage.devRoutes.test.tsx && git diff --cached --check && git commit -m "test(e2e): 防止 operator token 寫入追蹤證據"
```

預期輸出：只包含上述四個 reviewed paths；commit 後 hooks 為 reviewed no-op replacement 且三者正常 exit 0。

---

#### 5B. 全量驗證（4.5）、tasks.md 勾選／註記、openspec validate、detect-changes（原 Task 12）

**Files:**
- Modify: `openspec/changes/unified-console-runtime-truth/tasks.md`

- [ ] **Step 1: coordinator 全量（4.5）**

```bash
cd "C:/Repos/active/iot/AI-BIM-governance.worktrees/unified-console-runtime-truth-s2/bim-review-coordinator" && npm run build && npx vitest run 2>&1 | tail -15
```

預期輸出：build 無輸出；vitest 依 Task 6 Step 2 觀測到的分支二選一：

- Step 2 為 **(A)** 或 **(C)** → `Test Files  1 failed | N passed`、`Tests  1 failed | M passed`，**唯一**失敗必須是 `tests/env-example-dev-routes-parity.test.ts` 的「.env.example 宣告」案例（(A) 是「未宣告」、(C) 是「必須為空值」）。
- Step 2 為 **(B)**（預期） → **全綠**（`Tests  M passed`，0 failed）。coordinator 更新 2026-08-25：宣告行已 commit（`ded6901`），全綠即 CI 綠；4.5 可打勾（Edit E），4.4 仍只註記。

任何**其他**紅燈都要先修再往下。若觀測到的分支與 Step 2 記錄的不一致（例如 Step 2 是 (A)、這裡卻全綠），代表 `.env*` 在期間被改動過——停手回報，不要自行調查該檔內容。

- [ ] **Step 2: 前端受影響檔（4.5）**

```bash
cd "C:/Repos/active/iot/AI-BIM-governance.worktrees/unified-console-runtime-truth-s2/web-viewer-sample" && npx tsc --noEmit && npx vitest run src/console/RealIfcConsolePage.test.tsx src/console/coordinatorClient.httpError.test.ts src/console/coordinatorClient.test.ts src/console/coordinatorClient.conversions-history.test.ts src/console/modelData src/console/ConversionPage.test.tsx src/console/console.test.tsx src/console/A1IssueSnapshot.test.tsx 2>&1 | tail -8
```

預期輸出：tsc 無輸出；vitest 全 pass。（`src/console/modelData`／`ConversionPage.test.tsx` 在本 PR 屬**未改動的回歸檢查**——Task 9 HELD，這些檔一行未動；它們全綠正好證明 `jsonGet` 改丟 `CoordinatorHttpError`（Task 7）沒有波及 `/api/dev/conversions` 消費鏈。）

- [ ] **Step 3: tasks.md 勾選與註記（六個 Edit；4.4／4.5 依誠實鐵律不打勾）**

Edit A（4.1 打勾）：把 `- [ ] 4.1 impact：` 改成 `- [x] 4.1 impact：`。

Edit B（4.1 註記，插在 4.2 之前）：把

```
- [ ] 4.2 依 D2 以 per-route wrapper
```

改成

```
  - 2026-08-25 slice 2：`gitnexus impact rejectIfIpNotAllowed -f bim-review-coordinator/src/app.ts -d upstream` → risk LOW、direct 1（`createCoordinatorApp`）、impacted 2；呼叫點＝`app.ts` prioritize／retry／watch／trigger 四條（本切片改為 `rejectIfConversionControlUnauthorized`）＋`lineageSourceBundleRoutes.ts` preview／confirm（deps 注入，不動）；helper 本體逐字未改。完整 JSON 附 PR body。
- [x] 4.2 依 D2 以 per-route wrapper
```

Edit C（4.2 註記＋4.3 打勾）：把

```
- [ ] 4.3 lineage 釘樁
```

改成

```
  - 驗證指令更正（2026-08-25 slice 2 P0 自檢，非新需求）：`bim-review-coordinator/tests/` 為 vitest（無任何 `.py`／pytest），上列 pytest 指令為工具名誤植；實際驗證 `npx vitest run tests/conversion-control-auth.test.ts tests/services/conversionControlAuthorization.test.ts`（cwd `bim-review-coordinator`）本機綠（含：無憑證且非 allowlist → 403；速率限制 → 429；token 路徑於預設 `dev-token` fail-closed）。
- [x] 4.3 lineage 釘樁
```

Edit D（4.3 註記）：把

```
- [ ] 4.4 D3：
```

改成

```
  - 2026-08-25 slice 2：釘樁 `tests/lineage/conversion-control-auth-pins.test.ts`（app.ts 改動前後皆綠；operator token 對 preview／confirm／`/api/external/ifc-ready` 零效果）；`npx vitest run tests/lineage` 本機綠。
- [ ] 4.4 D3：
```

Edit E（4.4 註記，插在 4.5 之前；4.4 不打勾）：把

```
- [ ] 4.5 coordinator 全量
```

改成

```
  - 驗證指令更正（2026-08-25 slice 2 P0 自檢，非新需求）：實際驗證 `npx vitest run tests/dev-routes-disabled.test.ts tests/env-example-dev-routes-parity.test.ts`（cwd `bim-review-coordinator`），非 pytest。
  - 2026-08-25 slice 2：後端 `/api/dev` prefix gate 與 `compose.host-kit.yml` 透傳本機綠；前端 canonical scenario 明列的兩頁（`#demo-control`、`#a1-workbench` local_fs／測試資料清單）404 誠實狀態本機 vitest＋Playwright（`e2e/dev-routes-disabled-operator-token.spec.ts`）綠；`#conv`／`#minio` 的 `/api/dev/conversions` 消費者**不在本 change scenario 範圍**，本 PR 未改（維持既有誠實訊息「轉檔歷史更新失敗；保留上一份結果。」，不崩潰不假資料），是否納入待 owner D5 裁決（需先更新 canonical scenario）；canonical env `ENABLE_DEV_ROUTES=false` 與 181 `POST /api/dev/conversions` 404 驗證待 owner；`.env.example` 的 `ENABLE_DEV_ROUTES=`（空值）宣告已由 owner 追加並提交（commit `ded6901`），parity 綠。
- [x] 4.5 coordinator 全量
```

Edit F（4.5 註記；4.5 已於 Edit E 打勾——全量全綠）：把

```


## 5. design gate／rebaseline／semantic cases／既有測試
```

改成

```

  - 2026-08-25 slice 2：`npm run build` 綠；`npx vitest run` 全綠（含 `tests/env-example-dev-routes-parity.test.ts`，宣告行已在 commit `ded6901`）；前端 `npx tsc --noEmit` 與受影響 vitest 綠。

## 5. design gate／rebaseline／semantic cases／既有測試
```

- [ ] **Step 4: openspec validate＋docs/plans 未動確認**

```bash
cd "C:/Repos/active/iot/AI-BIM-governance.worktrees/unified-console-runtime-truth-s2" && npx openspec validate unified-console-runtime-truth --strict && git diff --name-only origin/main -- docs/plans openspec/lifecycle-ledger.json
```

預期輸出：`Change 'unified-console-runtime-truth' is valid`；第二行無輸出（`docs/plans/**` 與 ledger 未動，spec §3）。

- [ ] **Step 5: detect-changes（commit 前）**

```bash
cd "C:/Repos/active/iot/AI-BIM-governance.worktrees/unified-console-runtime-truth-s2" && git add openspec/changes/unified-console-runtime-truth/tasks.md && npx gitnexus@1.6.9 detect-changes --scope compare --base-ref main -r AI-BIM-governance
```

預期輸出：changed symbols 只落在 `createCoordinatorApp`（app.ts）、`conversionControlAuthorization.ts` 新 symbols、`jsonGet`／`CoordinatorHttpError`／`isCoordinatorNotFound`（coordinatorClient.ts）、`RealIfcConsolePage`、`A1GovernanceWorkbenchPage` 與測試檔；無 HIGH／CRITICAL。**`useConversionData`／`GlobalConversionPane`／`ConversionHistoryPanel`／`ConversionPage` 不得出現**——它們出現代表 HELD 的 Task 9 被誤做進來，回頭撤掉。`bim-review-coordinator/.env.example` 出現在 changed files 屬預期（owner 宣告行 commit `ded6901`），不是異常。若 linked worktree 讓 detect-changes 看不到 diff（回空或報錯），fallback：`git diff --name-only main...HEAD` 並在 PR body 記 `detectVerdict='fallback'`（spec §5）。

- [ ] **Step 6: commit**

```bash
cd "C:/Repos/active/iot/AI-BIM-governance.worktrees/unified-console-runtime-truth-s2" && git diff --cached --check && git commit -m "docs(openspec): unified-console-runtime-truth §4 slice 2 勾選（4.1／4.2／4.3）與 4.4／4.5 驗證指令更正註記"
```

預期輸出：1 file changed。之後 `git status --short` **應為空**（coordinator 更新 2026-08-25：宣告行已 commit `ded6901`）——出現任何行都要回報。`git log --oneline origin/main..HEAD` ＝ **10 個實作 commit**（Task 2／3／4／5／6／7／8／10／11／12 各一；**Task 9 為 HELD，沒有它的 commit**）＋ Task 1 開工前既有的文件 commit（slice 2 spec 檔 `af8d34c`、本 plan 檔 `064ac40` 及其後續修訂、owner 的 `.env.example` 宣告行 `ded6901`）。實作 commit 若多於 10 個，先確認是不是把 HELD 的 Task 9 做進來了。

---

## 交付與 owner 交接（寫進 PR body）

- 本機綠：coordinator `npm run build`＋`npx vitest run`（parity 全綠，宣告行在 commit `ded6901`）、前端 `npx tsc --noEmit`＋受影響 vitest、Playwright `dev-routes-disabled-operator-token.spec.ts` 3 passed（附 `artifacts/e2e/s2-*.png` 摘要，不入檔）。
- **owner 動作（AI 不得代做）**：
  - (a) ✅ 已完成：`bim-review-coordinator/.env.example` 的 `ENABLE_DEV_ROUTES=`（空值）宣告由 owner 親自追加、經 owner 明示授權以 commit `ded6901` 進入本分支（agent 未讀、未改）。
  - (b) canonical-linux 私有 canonical env 設 `ENABLE_DEV_ROUTES=false` 並確認 `DEV_AUTH_TOKEN` 非預設值（否則 T4 token 路徑不啟用，UI 觸發只剩 allowlist）。
  - (c) 部署後 `curl -i` 三組（無憑證非 allowlist trigger → 403；`/api/external/ifc-ready` 授權回應不變；`POST /api/dev/conversions` → 404）供 tasks 6.4／4.4 勾選。
  - (d) **D5 裁決**：`/api/dev/conversions` 消費者（`#conv`／`#minio` 的轉檔歷史面板）要不要納入本 change 的「dev routes 已關閉」誠實顯示範圍。canonical scenario 與 `design.md` §2.4 只列 `#demo-control` 與 A1 workbench local_fs 清單，本 PR 依此修剪；若要納入，需先更新 canonical scenario 的 AND 子句，再由後續 PR 依 plan Task 9 Step 1–8 執行。
- Known gaps（誠實）：
  - `/ui` 殼層 token 輸入未建（另切片，tasks 2.4／§6.3）。
  - `#conv`／`#minio` 在 dev routes 關閉時只顯示既有籠統訊息「轉檔歷史更新失敗；保留上一份結果。」，沒有 `#demo-control`／A1 那種「dev routes 已關閉（canonical-linux）」專屬字樣——**不崩潰、不假資料**，但不是最誠實的措辭；待 owner D5 裁決（見上 (d)）。
  - `docker compose config` 若本機無 docker 則 skipped。

---

## Appendix A：保留稿（原 Task 9，HELD／D5，本 PR 不執行；不是 task）

### （保留稿，非 task）原 Task 9: 前端轉檔歷史消費者（`useConversionData`／`GlobalConversionPane`／`ConversionHistoryPanel`／`ConversionPage`）— 404 誠實標示

> **⛔ 執行者：跳過整個 Task 9，直接做 Task 10。** 下方 Step 1–8 完整保留，是為了 owner 裁決 D5 若判「納入」時可直接照做，不必重新推導；在裁決落地前**一個檔都不要改、一個 commit 都不要建**。

#### D5 owner 裁決點：`/api/dev/conversions` 消費者是否屬本 change 範圍（2026-08-25 開，未裁）

**落差事實（已查證，非推測）**

| 來源 | 明列的「404 誠實顯示」頁面 |
|---|---|
| canonical `openspec/changes/unified-console-runtime-truth/specs/unified-console-runtime-truth/spec.md`，scenario「dev 路徑不是產品路徑且 canonical-linux 關閉 dev routes」的 AND 子句 | 只有 **`#demo-control`** 與 **A1 workbench local_fs 清單** 兩項 |
| canonical `design.md` §2.4（D3 裁決段） | 只有 **`#demo-control` 的 `/api/dev/ifc-sources*`** 與 **A1 workbench local_fs 清單** 兩項 |
| 本切片 spec `docs/superpowers/specs/2026-08-25-unified-console-runtime-truth-s2-design.md` §1 的 4.4 | 在「A1 workbench local_fs／測試資料清單」的括號內多寫了「`/api/dev/conversions` 消費者」 |

- 程式碼查證（2026-08-25，`grep -rn "getConversionsHistory" web-viewer-sample/src`）：`A1GovernanceWorkbenchPage.tsx` **完全不呼叫** `getConversionsHistory`／`/api/dev/conversions`（它只呼叫 `getTestDataProjects()` 與 `runtimeStatus`／`getMinioObjects`／`listIfcReady`／`conversionRetry` 等非 dev 路由）。`/api/dev/conversions` 的真正消費者是 `useConversionData` → `GlobalConversionPane`／`ConversionHistoryPanel`／`ConversionPage`，呈現在 **`#conv`／`#minio`** 兩頁——這兩頁不在 canonical scenario 的清單裡。
- 因此切片 spec 那句括號屬**誤植式的範圍外加**；而切片 spec 檔第 5 行自己就寫「本檔只界定切片範圍與執行環境事實，**不新增需求**；衝突時以 change 為準」。依該條，canonical 勝出 → 本 PR 的 changed-files 修剪回兩頁。

**修剪後的殘留行為（誠實揭露，不是零影響）**

- 現況 `useConversionData.loadHistory` 的 `catch` 對**任何**失敗（含 404）設 `historyErr=true`，`ConversionHistoryPanel` 渲染「轉檔歷史更新失敗；保留上一份結果。」（`data-testid="conv-history-error"`）。
- 所以 dev routes 關閉時 `#conv`／`#minio` 的表現是「誠實但籠統的錯誤訊息」——**不崩潰、不假資料**，滿足 canonical 對 UnifiedConsole 的誠實底線；只是沒有 `#demo-control`／A1 那種「dev routes 已關閉（canonical-linux）」的專屬字樣。這是本 PR 明知並接受的差距，須寫進 PR body 的 Known gaps。

**owner 三選一（AI 不得自行裁決）**

1. **維持修剪（預設）**：本 PR 只做 `#demo-control`＋A1 workbench 兩頁；`#conv`／`#minio` 維持上述籠統錯誤訊息。
2. **納入**：owner 追認範圍並**更新 canonical spec scenario 的 AND 子句**（加上 `#conv`／`#minio` 的 `/api/dev/conversions` 消費者），再由後續 PR 依下方 Step 1–8 執行——canonical 改動須走 openspec delta，不在本 PR 混做。
3. **另開 change**：把 `/api/dev/conversions` 消費者誠實化獨立成新 change。

在 owner 回覆前，Task 9 一律 **HELD**；不得因為「順手改一下比較完整」就執行。

**Files（HELD，本 PR 一個都不碰）:**
- Modify: `web-viewer-sample/src/console/modelData/useConversionData.ts`
- Modify: `web-viewer-sample/src/console/modelData/GlobalConversionPane.tsx`
- Modify: `web-viewer-sample/src/console/modelData/ConversionHistoryPanel.tsx`
- Modify: `web-viewer-sample/src/console/ConversionPage.tsx`
- Modify: `web-viewer-sample/src/console/modelData/ModelDataPage.test.tsx`、`ObjectDetailPane.test.tsx`（fixture 補欄位）、`ConversionHistoryPanel.test.tsx`（新案例）
- Create: `web-viewer-sample/src/console/modelData/useConversionData.devRoutes.test.tsx`

- [ ] **Step 1: impact（四個既有 symbol）**

```bash
cd "C:/Repos/active/iot/AI-BIM-governance.worktrees/unified-console-runtime-truth-s2" && npx gitnexus@1.6.9 impact useConversionData -f web-viewer-sample/src/console/modelData/useConversionData.ts -d upstream -r AI-BIM-governance --summary-only && npx gitnexus@1.6.9 impact GlobalConversionPane -d upstream -r AI-BIM-governance --summary-only && npx gitnexus@1.6.9 impact ConversionHistoryPanel -f web-viewer-sample/src/console/modelData/ConversionHistoryPanel.tsx -d upstream -r AI-BIM-governance --summary-only && npx gitnexus@1.6.9 impact ConversionPage -f web-viewer-sample/src/console/ConversionPage.tsx -d upstream -r AI-BIM-governance --summary-only
```

預期輸出：四者 `risk` 皆 `LOW`（`useConversionData` impacted 4）。HIGH／CRITICAL 停手回報。

- [ ] **Step 2: 寫失敗測試（三處）**

(a) 新檔 `src/console/modelData/useConversionData.devRoutes.test.tsx`：

```tsx
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CoordinatorHttpError, coordinatorClient } from "../coordinatorClient";
import { useConversionData } from "./useConversionData";

// D3（unified-console-runtime-truth 4.4）：GET /api/dev/conversions 404（dev routes 已關閉）→ historyDisabled=true
// 且 historyErr=false；其他失敗（503）→ historyErr=true、historyDisabled=false。只驗 history 分支，其餘端點 stub。

function Probe() {
  const data = useConversionData();
  return <div data-testid="probe" data-history-disabled={String(data.historyDisabled)} data-history-err={String(data.historyErr)} />;
}

async function flush(ticks = 8): Promise<void> {
  for (let i = 0; i < ticks; i += 1) await act(async () => { await Promise.resolve(); });
}

describe("useConversionData：轉檔歷史 404（dev routes 已關閉）分支", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ items: [], count: 0 } as never);
    vi.spyOn(coordinatorClient, "minioWatchStatus").mockRejectedValue(new Error("offline"));
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ items: [], count: 0 } as never);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  function probeAttr(name: string): string | null {
    return container.querySelector('[data-testid="probe"]')?.getAttribute(name) ?? null;
  }

  it("404 → historyDisabled=true、historyErr=false", async () => {
    vi.spyOn(coordinatorClient, "getConversionsHistory").mockRejectedValue(new CoordinatorHttpError("/api/dev/conversions", 404, "dev routes disabled"));
    await act(async () => { root.render(<Probe />); });
    await flush();
    expect(probeAttr("data-history-disabled")).toBe("true");
    expect(probeAttr("data-history-err")).toBe("false");
  });

  it("503 → historyErr=true、historyDisabled=false", async () => {
    vi.spyOn(coordinatorClient, "getConversionsHistory").mockRejectedValue(new CoordinatorHttpError("/api/dev/conversions", 503, "down"));
    await act(async () => { root.render(<Probe />); });
    await flush();
    expect(probeAttr("data-history-disabled")).toBe("false");
    expect(probeAttr("data-history-err")).toBe("true");
  });
});
```

(b) `ConversionHistoryPanel.test.tsx`：以 Edit 把檔尾

```tsx
    expect(container.querySelector('[data-testid="conv-history-row-stream_conv_snapshot"]')).not.toBeNull();
    expect(container.textContent).toContain("succeeded");
  });
});
```

改成

```tsx
    expect(container.querySelector('[data-testid="conv-history-row-stream_conv_snapshot"]')).not.toBeNull();
    expect(container.textContent).toContain("succeeded");
  });

  it("historyDisabled（D3：GET /api/dev/conversions 404）→ 顯示 dev routes 已關閉，不顯示 loading／error", async () => {
    await act(async () => {
      root.render(<ConversionHistoryPanel history={null} historyErr={false} historyDisabled={true} />);
    });
    expect(container.querySelector('[data-testid="conv-history-dev-routes-disabled"]')?.textContent).toContain("dev routes 已關閉");
    expect(container.querySelector('[data-testid="conv-history-loading"]')).toBeNull();
    expect(container.querySelector('[data-testid="conv-history-error"]')).toBeNull();
  });
});
```

(c) `ModelDataPage.test.tsx`：以 Bash 在檔尾追加（`GlobalConversionPane` 經殼層真掛載）：

```bash
cd "C:/Repos/active/iot/AI-BIM-governance.worktrees/unified-console-runtime-truth-s2/web-viewer-sample" && cat >> src/console/modelData/ModelDataPage.test.tsx <<'EOF'

// D3（unified-console-runtime-truth 4.4）：GET /api/dev/conversions 404 → 右欄 GlobalConversionPane 的
// 轉檔歷史面板誠實標示「dev routes 已關閉」，不顯示泛用「未取得」。
describe("ModelDataPage：dev routes 已關閉（historyDisabled）", () => {
  it("historyDisabled=true → conv-history-dev-routes-disabled 可見", async () => {
    H.conv = makeData({ history: null, historyErr: false, historyDisabled: true });
    render();
    await waitFor(() => {
      expect(container.querySelector('[data-testid="conv-history-dev-routes-disabled"]')?.textContent).toContain("dev routes 已關閉");
    });
  });
});
EOF
```

- [ ] **Step 3: 跑，確認失敗**

```bash
cd "C:/Repos/active/iot/AI-BIM-governance.worktrees/unified-console-runtime-truth-s2/web-viewer-sample" && npx vitest run src/console/modelData/useConversionData.devRoutes.test.tsx src/console/modelData/ConversionHistoryPanel.test.tsx src/console/modelData/ModelDataPage.test.tsx
```

預期輸出：`useConversionData.devRoutes` 兩案例失敗（`data-history-disabled` 為 `"undefined"`）；`ConversionHistoryPanel` 新案例失敗（元素為 null）；`ModelDataPage` 新案例失敗（timeout／null）。

- [ ] **Step 4: 實作 hook**

以 Edit 把 `useConversionData.ts` 的 import

```ts
import {
  coordinatorClient,
  type ConversionRecord,
```

改成

```ts
import {
  coordinatorClient,
  isCoordinatorNotFound,
  type ConversionRecord,
```

把 interface 的

```ts
  history: DevConversionRecord[] | null;
  historyErr: boolean;
  busy: boolean;
```

改成

```ts
  history: DevConversionRecord[] | null;
  historyErr: boolean;
  historyDisabled: boolean; // D3：GET /api/dev/conversions 回 404（dev routes 已關閉，此部署不提供），非錯誤
  busy: boolean;
```

把

```ts
  const [history, setHistory] = useState<DevConversionRecord[] | null>(null);
  const [historyErr, setHistoryErr] = useState(false);
```

改成

```ts
  const [history, setHistory] = useState<DevConversionRecord[] | null>(null);
  const [historyErr, setHistoryErr] = useState(false);
  const [historyDisabled, setHistoryDisabled] = useState(false);
```

把

```ts
        const response = await coordinatorClient.getConversionsHistory();
        setHistory(response.items);
        setHistoryErr(false);
      } catch {
        // 保留上一份成功 snapshot；未知／暫時失敗不能把已看見的 history 擦成空資料。
        setHistoryErr(true);
      }
```

改成

```ts
        const response = await coordinatorClient.getConversionsHistory();
        setHistory(response.items);
        setHistoryErr(false);
        setHistoryDisabled(false);
      } catch (error) {
        // D3（unified-console-runtime-truth 4.4）：404＝dev routes 已關閉（canonical-linux ENABLE_DEV_ROUTES=false），
        // 是「此部署不提供」而非暫時失敗——獨立旗標讓面板誠實標示原因，不與 historyErr 混淆。
        if (isCoordinatorNotFound(error)) {
          setHistoryDisabled(true);
          setHistoryErr(false);
          return;
        }
        // 保留上一份成功 snapshot；未知／暫時失敗不能把已看見的 history 擦成空資料。
        setHistoryDisabled(false);
        setHistoryErr(true);
      }
```

把 return 的

```ts
    history, historyErr,
    busy,
```

改成

```ts
    history, historyErr, historyDisabled,
    busy,
```

- [ ] **Step 5: 實作面板（三個檔）**

`GlobalConversionPane.tsx`：把

```tsx
  const { jobs, jobsErr: err, jobsTruncated, records, recErr, recordsTruncated, mw, mwErr, history, historyErr, busy, load, loadRecords } = data;
```

改成

```tsx
  const { jobs, jobsErr: err, jobsTruncated, records, recErr, recordsTruncated, mw, mwErr, history, historyErr, historyDisabled, busy, load, loadRecords } = data;
```

把

```tsx
        <div data-testid="conv-history-panel">
          {historyErr ? (
```

改成

```tsx
        <div data-testid="conv-history-panel">
          {historyDisabled ? (
            <p className="ec-note" data-testid="conv-history-dev-routes-disabled">{t("dev routes 已關閉（canonical-linux：ENABLE_DEV_ROUTES=false）：GET /api/dev/conversions 回 404，此部署不提供 conversion-service 歷史（非錯誤）。", "dev routes are disabled (canonical-linux: ENABLE_DEV_ROUTES=false): GET /api/dev/conversions returned 404; conversion-service history is not provided on this deployment (not an error).")}</p>
          ) : historyErr ? (
```

`ConversionHistoryPanel.tsx`：把

```tsx
export function ConversionHistoryPanel({
  history,
  historyErr,
}: {
  history: DevConversionRecord[] | null;
  historyErr: boolean;
}): JSX.Element {
  const [results, setResults] = useState<Record<string, ResultState>>({});
```

改成

```tsx
export function ConversionHistoryPanel({
  history,
  historyErr,
  historyDisabled = false,
}: {
  history: DevConversionRecord[] | null;
  historyErr: boolean;
  /** D3：GET /api/dev/conversions 404（dev routes 已關閉）；預設 false 讓既有呼叫端不變。 */
  historyDisabled?: boolean;
}): JSX.Element {
  const [results, setResults] = useState<Record<string, ResultState>>({});
```

並把

```tsx
  if (history == null) {
    return historyErr
```

改成

```tsx
  if (historyDisabled) {
    return <p className="ec-note" data-testid="conv-history-dev-routes-disabled">{t("dev routes 已關閉（canonical-linux：ENABLE_DEV_ROUTES=false）：GET /api/dev/conversions 回 404，此部署不提供 conversion-service 歷史（非錯誤）。", "dev routes are disabled (canonical-linux: ENABLE_DEV_ROUTES=false): GET /api/dev/conversions returned 404; conversion-service history is not provided on this deployment (not an error).")}</p>;
  }
  if (history == null) {
    return historyErr
```

`ConversionPage.tsx`：把

```tsx
        <ConversionHistoryPanel history={data.history} historyErr={data.historyErr} />
```

改成

```tsx
        <ConversionHistoryPanel history={data.history} historyErr={data.historyErr} historyDisabled={data.historyDisabled} />
```

- [ ] **Step 6: fixture 補欄位（兩個測試檔各一個 Edit，讓 `tsc --noEmit` 過）**

`ModelDataPage.test.tsx` 與 `ObjectDetailPane.test.tsx` 各把

```ts
    recordsIncomplete: false, mw: null, mwErr: null, history: null, historyErr: false,
```

改成

```ts
    recordsIncomplete: false, mw: null, mwErr: null, history: null, historyErr: false, historyDisabled: false,
```

- [ ] **Step 7: 跑 tsc＋modelData 全部＋ConversionPage 測試**

```bash
cd "C:/Repos/active/iot/AI-BIM-governance.worktrees/unified-console-runtime-truth-s2/web-viewer-sample" && npx tsc --noEmit && npx vitest run src/console/modelData src/console/ConversionPage.test.tsx
```

預期輸出：tsc 無輸出；vitest 全 pass（含 3 個新案例）。

- [ ] **Step 8: commit**

```bash
cd "C:/Repos/active/iot/AI-BIM-governance.worktrees/unified-console-runtime-truth-s2" && git add web-viewer-sample/src/console/modelData/useConversionData.ts web-viewer-sample/src/console/modelData/useConversionData.devRoutes.test.tsx web-viewer-sample/src/console/modelData/GlobalConversionPane.tsx web-viewer-sample/src/console/modelData/ConversionHistoryPanel.tsx web-viewer-sample/src/console/modelData/ConversionHistoryPanel.test.tsx web-viewer-sample/src/console/modelData/ModelDataPage.test.tsx web-viewer-sample/src/console/modelData/ObjectDetailPane.test.tsx web-viewer-sample/src/console/ConversionPage.tsx && git diff --cached --check && git commit -m "feat(web-viewer): 轉檔歷史面板於 /api/dev/conversions 404 誠實標示 dev routes 已關閉（#minio／#conv）"
```

預期輸出：8 files changed。**（HELD：owner D5 未裁「納入」前不得執行本 commit；這 8 個檔不進本 PR。）**

---

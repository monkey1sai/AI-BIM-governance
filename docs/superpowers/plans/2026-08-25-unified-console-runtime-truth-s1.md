# unified-console-runtime-truth Slice 1 Implementation Plan

**For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development

> **Implementation authorization:** 本 plan 不自帶實作授權；owner 2026-08-25 口令已核准本切片（見 spec Status），執行前仍由 coordinator 明示啟動 subagent-driven-development。Steps 用 checkbox（`- [ ]`）追蹤；plan 內 checkbox 依實際完成勾選，OpenSpec `tasks.md` §1／§5 的 UI task **不得**打勾（只加「本機綠，待 181」子彈，見 Global Constraints）。

**Goal:** 讓 canonical-linux `:8004/ui` 的預設入口（`#home`／`#pipeline`／`#runtime`／頂列 GPU chip／側欄轉檔 badge）只呈現 coordinator `:8004` 十個既有端點的真值或誠實的「未取得／未連線」狀態，經單一共用 poller 讀取，並把設計原型假資料 export 移出 production 顯示路徑，同時把因此翻轉的既有 vitest／semantic case 改為誠實狀態斷言。

**Architecture:** 新增一個模組層單例 `CoordinatorStatusStore`（每端點一條輪詢迴圈：10s 節奏、同端點單一 in-flight、指數退避 ≤60s、`document.hidden` 不發請求），沿用既有 `coordinatorClient`（只做加性擴充：帶 HTTP status 的 `CoordinatorHttpError`＋三個允許清單方法），以 `ConsoleDataProvider` 注入頁面；頁面用 `runtimeTruth.ts` 的純函式把端點切片投影成 `Cell`（`data-state` ∈ live／unavailable／offline／error，永不以 0 佔位）。設計原型的 7 個假資料 export 移到 `__testdata__/`（D1=P），`docks.tsx`／`WorkspacePage.tsx` 仍 import 的 4 個以 ratchet 測試釘住留給 slice 2（§2／§3）。

**Tech Stack:** React 18.3.1（`useSyncExternalStore`）、TypeScript 5（`strict`、`noUnusedLocals`）、Vite、vitest 3（jsdom）、Playwright、既有 `coordinatorClient`／`governanceClient` 型別；不新增生產依賴、不新增 HTTP client、不新增端點。

---

> **Task 編號對照（coordinator 2026-08-25 合併後）**：原 Task 1、2 → **Task 1**；原 Task 3a、3b、3c → **Task 2**；原 Task 4、5 → **Task 3**；原 Task 6、7 → **Task 4**；原 Task 8、9、10 → **Task 5**。文中所有「Task N Step M」引用一律指**原**編號，各子段標題已標「原 Task N」。合併原因：run 剩餘 agent 額度（32）不足以支撐 10 個 task 的 per-task review。

## Global Constraints（來自 spec §1–§5 與 OpenSpec change，逐條遵守）

- **唯一忠實源**：`openspec/changes/unified-console-runtime-truth/`（`proposal.md`、`design.md`、`tasks.md`、`specs/**`）；本 plan 只界定 slice 1 的執行順序與程式細節，與 change 衝突時以 change 為準。
- **範圍**：tasks §1 全部（1.1–1.8）＋ §5 的 5.1／5.2／5.3／5.4／5.6／5.7。**不做** §2（控制項／badge）、§3（A1 視區／A4 頁首）、§4（coordinator 授權／D3）、5.5（rebaseline）、§6（181 驗收）、§7（closeout）。
- **5.5 rebaseline 不是 implementer 步驟**：任何 `--rebaseline`／`--confirm-rebaseline` 一律禁止；P3 完成時 `design-semantic-visual` 的 pixel 比對對 home／pipeline／ops／workspace.a1–a3 六屏**預期為紅**（golden 仍是 fixture 畫面），semantic case 必須全綠。
- **不得觸碰**：`bim-review-coordinator/**`、lineage 契約、`rejectIfIpNotAllowed`、`/api/dev/*`、`docs/plans/*.dc.html`／`docs/plans/*.md`／`docs/plans/ai-bim-governance.css`（R-A1）、`docs/plans/design-system-reference.manifest.json`（含 `required_case_ids`）、`docs/plans/design-system-baseline/**`、`workspace.a4.default` 任何可見面、`openspec/lifecycle-ledger.json`、`docs/plans/NOW.md`、`web-viewer-sample/scripts/capture-design-system-reference.mjs`。
- **勾選規則（避免 P7 ledger_mismatch）**：`tasks.md` §1／§5 的 UI task 維持 `- [ ]`；本 PR 只在對應 task 下方加一行子彈「本機綠，待 181（slice 1，commit `<短 sha>`）」（Task 10）。plan 檔 checkbox 照實勾選。
- **資料誠實鐵律**：`data-prov` 只允許 `asbuilt`／`artifact`／`demo`／`p1`／`p15`／`p3`／`p4`；`data-state` 只允許 `live`／`unavailable`／`offline`／`error`（尚未收到任何回應＝`offline`，不引入第五個值）；只有 `live` 顯示數字；回傳窗截斷（`count > items.length`／`total > entries.length`）一律 `unavailable`，不對子集算數；gate 環境（`/api/**` 503）下「最後更新」固定顯示 `—`。
- **十端點 = 唯一資料來源**（皆已存在，不新增）：`GET /api/runtime/status`、`GET /api/external/ifc-ready`、`GET /api/conversion/records`、`GET /api/callback-outbox/summary`、`GET /api/governance/issues`、`GET /api/governance/rule-runs`、`GET /api/external/minio-watch/status`、`GET /api/minio/objects`、`GET /api/kit/health`、`GET /api/kit/instances/current`。前端**不得**呼叫 `/api/internal/*`、`/api/dev/*`。
- **mock 一律於 `coordinatorClient` 層注入**（`vi.spyOn(coordinatorClient, "<method>")`），不打真網路；production 只注入 live store（無 fixture／preview provider）。
- **測試檔命名照 tasks.md**：`coordinatorStatusStore.test.ts`、`homeLiveBinding.test.tsx`、`pipelineLiveBinding.test.tsx`、`opsLiveBinding.test.tsx`、`topbarGpuChip.test.tsx`、`fixtureNotInProduction.test.ts`（皆在 `web-viewer-sample/src/console/unified/`）。
- **Playwright E2E**：新 spec 放 `web-viewer-sample/e2e/`，檔名不得以 `design-system-` 為前綴；真後端固定 `http://127.0.0.1:8004`（`E2E_COORDINATOR_BASE_URL` 只允許指向本機 stack）；不可達時以 `stack_down:` 前綴 `test.skip`，不得改打其他 host。
- **GitNexus**：worktree 已於 HEAD `analyze --index-only`。每個**既有** symbol 修改前跑 `npx gitnexus@1.6.9 impact <Symbol> -d upstream -r AI-BIM-governance`（cwd＝worktree 根），HIGH／CRITICAL 先回報 coordinator 再動手；commit 前 `npx gitnexus@1.6.9 detect-changes --scope compare --base-ref main`，linked worktree 看不到 staged 時 fallback `git diff --name-only --cached` 並在回報記 `detectVerdict='fallback'`。
- **每個 task 結尾**：`npx tsc --noEmit` 綠、該 task 的目標測試綠、`git diff --cached --check` 無 whitespace 錯誤、獨立 commit（訊息前綴 `task#N:`；Task 3 已拆為 3a／3b／3c，前綴各為 `task#3a:`／`task#3b:`／`task#3c:`，繁中，結尾 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`）。commit 前把本 plan 檔該 task 的 checkbox 勾為 `- [x]`，並把 `docs/superpowers/plans/2026-08-25-unified-console-runtime-truth-s1.md` 一併 `git add`（各 task 的 `git add` 指令未列本檔，執行時自行加上）。

## 執行環境（worktree 事實）

| 項目 | 值 |
|---|---|
| worktree 根（下文 `$W`） | `C:\Repos\active\iot\AI-BIM-governance.worktrees\unified-console-runtime-truth-s1` |
| 前端根（下文 `$F`） | `$W\web-viewer-sample`（已 `npm ci`；React 18.3.1；tsconfig `strict`＋`noUnusedLocals`＋`noUnusedParameters`，`include: ["src"]`，e2e 不進 tsc） |
| branch | `codex/openspec/unified-console-runtime-truth-s1`（自 `origin/main` `2ef725a`） |
| 型別 | `cd $F; npx tsc --noEmit`（vite build 不跑 tsc） |
| 單元 | `cd $F; npx vitest run <相對路徑>`；全量 `npx vitest run` |
| production bundle | `cd $F; npm run build:ui` → `dist-ui/`（ignored artifact） |
| 本機 coordinator（E2E 用） | `:8004` 服務 `CONSOLE_DIST_DIR` 指向的 `dist-ui`（`bim-review-coordinator/src/routes/consoleRoutes.ts`）；改 console 後必須 `npm run build:ui` 再重啟 coordinator（記憶：EdgeConsole 是 /ui 門面） |
| PowerShell 變數 | 每個 shell 區塊先執行：`$W = 'C:\Repos\active\iot\AI-BIM-governance.worktrees\unified-console-runtime-truth-s1'; $F = "$W\web-viewer-sample"` |

## 導航（執行者零脈絡時先跑；只讀）

```powershell
$W = 'C:\Repos\active\iot\AI-BIM-governance.worktrees\unified-console-runtime-truth-s1'; $F = "$W\web-viewer-sample"
Set-Location $W
npx gitnexus@1.6.9 query "coordinator status poller shared status" -r AI-BIM-governance
npx gitnexus@1.6.9 context UnifiedShell -r AI-BIM-governance
npx gitnexus@1.6.9 impact PipelinePage -d upstream -r AI-BIM-governance
npx gitnexus@1.6.9 impact OpsPage -d upstream -r AI-BIM-governance
# HomePage／coordinatorClient 在圖譜中同名有兩個候選（pages.tsx 的 legacy HomePage、Window.tsx 的 App.coordinatorClient）；
# 以 uid 指定 unified 那份：
npx gitnexus@1.6.9 impact "Function:web-viewer-sample/src/console/unified/HomePage.tsx:HomePage" -d upstream -r AI-BIM-governance
npx gitnexus@1.6.9 impact "Const:web-viewer-sample/src/console/coordinatorClient.ts:coordinatorClient" -d upstream -r AI-BIM-governance
```

已於 2026-08-25 對 HEAD `a6e1fa7` 跑過（2026-08-25 plan 作者實跑）：`UnifiedShell`／`PipelinePage`／`OpsPage` 的唯一上游是 `EdgeConsole.tsx:renderUnified`（risk **LOW**，2 impacted）；`HomePage`（unified）LOW（2 impacted）；`coordinatorClient` const LOW（0 impacted：消費端經屬性呼叫，圖譜不計）。執行時重跑一次，結果不同（HIGH／CRITICAL）即停下回報。

Read 確認清單（每個 task 動手前先 Read 對應檔案，不憑記憶改）：

| 檔案（相對 `$F`） | 為何要讀 |
|---|---|
| `src/console/coordinatorClient.ts` | `jsonGet`（:48）錯誤格式、`coordinatorClient` 物件（:602）既有方法：`runtimeStatus`／`kitInstanceCurrent`／`listIfcReady`／`minioWatchStatus`／`getConversionRecords`／`getMinioFolder`／`getCallbackOutboxSummary` |
| `src/console/governanceClient.ts` | `IssueRow`（:426，`status: string`）、`RuleRunHistoryResponse`（:69，`total`／`items`） |
| `src/console/usePolledResource.ts` | 既有輪詢坑（gen-token／watchdog）；本 plan 的 store 是**模組層單例**而非 hook，不重用它（它是 per-component 迴圈，無法做跨頁單一 in-flight） |
| `src/console/SharedStatusProvider.tsx` | 截斷窗→null 的既有誠實模式（`recs.count > recs.items.length`），本 plan 沿用 |
| `src/console/unified/UnifiedShell.tsx`、`HomePage.tsx`、`PipelinePage.tsx`、`OpsPage.tsx`、`fixtures.ts`、`docks.tsx`、`WorkspacePage.tsx` | 被改／被牽動的 production 檔 |
| `src/console/EdgeConsole.sharedstatus.test.tsx`、`src/console/unified/a1DockLive.test.tsx`、`src/console/unified/unified.test.tsx`、`e2e/design-system-semantic-cases.ts` | 5.1–5.4 要翻轉的既有測試 |
| `e2e/design-system-visual.spec.ts:187-205,380-413`、`e2e/unified-console-routes.spec.ts`、`e2e/a1-m1-closeout.spec.ts:1-66` | gate 的 503 stub／clean-tree 要求／結果 JSON；E2E 對真後端的探活＋skip 慣例 |
| `src/console/data.ts:1-30` | `Prov` 七值與 `PROV_LABEL`（`p1`＝後端待建 · P1） |

## 檔案結構（本 slice 全部產出）

| 路徑（相對 `$F`，除註明） | 動作 | 職責 |
|---|---|---|
| `src/console/coordinatorClient.ts` | Modify | `CoordinatorHttpError`（帶 `status`／`path`，message 逐字不變）、`KitHealth` 型別、`kitHealth()`／`governanceIssues()`／`governanceRuleRuns()` |
| `src/console/coordinatorClient.runtimeTruth.test.ts` | Create | 上列擴充的 wire 契約 |
| `src/console/unified/coordinatorStatusStore.ts` | Create | `CoordinatorStatusStore`（單例 `coordinatorStatusStore`）、`liveFetchers`、`classifyFailure`、`useCoordinatorStatus` |
| `src/console/unified/coordinatorStatusStore.test.ts` | Create | 單一 in-flight／退避／hidden／release／分類 |
| `src/console/unified/ConsoleDataProvider.tsx` | Create | `ConsoleDataProvider`＋`useConsoleData(keys)` |
| `src/console/unified/runtimeTruth.ts`＋`runtimeTruth.test.ts` | Create | `Cell`／`cell`／`cellText`／`cellSub`／`healthOf`／pickers／`lastUpdatedText` |
| `src/console/unified/__testdata__/coordinatorMocks.ts` | Create | 十端點閒置真值 payload＋`spyCoordinatorEndpoints()`／`spyCoordinatorEndpointsOffline()`／`idleFetchers()` |
| `src/console/unified/__testdata__/prototypeFixtures.ts` | Create（Task 7） | 自 `fixtures.ts` 搬出的 7 個假資料 export（test-only） |
| `src/console/unified/UnifiedShell.tsx` | Modify | 頂列四 chip 真值、側欄 badge 真值、`ConsoleDataProvider` 注入、`data-uc="page-root"`；Task 7 再縮 provider seeds |
| `src/console/unified/ServiceHealthList.tsx` | Create | 六列服務健康（Home／Ops 共用） |
| `src/console/unified/HomePage.tsx`、`PipelinePage.tsx`、`OpsPage.tsx` | Modify（整檔重寫） | 真值綁定 |
| `src/console/unified/homeLiveBinding.test.tsx`、`pipelineLiveBinding.test.tsx`、`opsLiveBinding.test.tsx`、`topbarGpuChip.test.tsx`、`fixtureNotInProduction.test.ts` | Create | tasks 1.4–1.8 驗證 |
| `src/console/unified/fixtures.ts` | Modify | `Dict` 加 `offline`／`unavailable`／`last_updated`；Task 7 移除 7 個假資料 export |
| `src/console/EdgeConsole.sharedstatus.test.tsx`、`src/console/unified/unified.test.tsx`、`src/console/unified/a1DockLive.test.tsx`、`src/console/EdgeConsole.aliasRedirect.test.tsx`、`src/console/unified/dockLiveLink.test.tsx` | Modify | 5.1（Task 3c）／5.3（Task 4–6）／5.2（Task 7）翻轉；`aliasRedirect`／`dockLiveLink`／`a1DockLive` 於 Task 3a 只補十端點 spy＋store reset、不改斷言（殼層改輪詢後不得打真網路） |
| `src/console/incomingHandoff.test.tsx` | **不改**（Task 3a Step 8 核實） | 該檔不掛 `EdgeConsole`／`UnifiedShell`（`rg -n "EdgeConsole"` 0 命中），共用 poller 不會啟動；補 spy 反而會覆蓋它自身的 `runtimeStatus` mock |
| `e2e/design-system-semantic-cases.ts` | Modify | 5.4：home／pipeline／ops 三屏 11 案改誠實狀態斷言；workspace `warning` badge；`runtime_truth` 分 fixture／truth 兩版；case id 不變 |
| `e2e/unified-console-runtime-truth.spec.ts` | Create | P4 browser evidence（真後端 :8004） |
| `$W/openspec/changes/unified-console-runtime-truth/tasks.md` | Modify（Task 10） | 只加「本機綠，待 181」子彈 |

**不建立、不修改**：`bim-review-coordinator/**`、`docs/plans/**`、`scripts/**`、`openspec/lifecycle-ledger.json`、`openspec/changes/unified-console-runtime-truth/{proposal,design}.md`、`specs/**`、`src/console/unified/docks.tsx`（除 Task 7 不碰）、`src/console/unified/WorkspacePage.tsx`、`src/console/unified/A1DockLive.tsx`、`src/console/unified/ConceptPage.tsx`、任何 golden PNG。

## 十端點欄位 shape 盤點（tasks 1.2；Task 1 貼進 PR body 的定稿表）

以 2026-08-25 `rg -n` 對 `bim-review-coordinator/src/app.ts`／`routes/governanceProxy.ts` 與前端既有型別查證；行號以執行時 `rg -n` 為準。

| # | 端點（handler） | 前端型別（來源） | 本 slice 取用欄位 | 非 live 規則 |
|---|---|---|---|---|
| 1 | `GET /api/runtime/status`（`app.ts:1363`） | `RuntimeStatus`（coordinatorClient.ts:239） | `service.status`、`sessions.active_count`、`sessions.participant_count`、`sessions.items[].session_id/status`、`configured_endpoints.coordinator.port`、`configured_endpoints.conversion_authority.base_url`、`configured_endpoints.kit[].signalingPort` | **無 GPU 欄位**（`rg -n "gpu" app.ts` 只命中註解）→ GPU chip／卡 live 即 `unavailable`；502/503/504→offline |
| 2 | `GET /api/external/ifc-ready?limit=20`（`app.ts:2357`） | `{count, items: IfcReadyListItem[]}` | `count` | 同上 |
| 3 | `GET /api/conversion/records?limit=100`（`app.ts:2374`；`parseListLimit` 上限 100） | `{count, items: ConversionRecord[]}`（:504） | `items[].status`（`detected/queued/converting/ready/failed`）；`count > items.length`→unavailable | 進行中＝`detected/queued/converting`（對齊 SharedStatusProvider `QUEUE_STATUSES`） |
| 4 | `GET /api/callback-outbox/summary?limit=200`（`app.ts:3215`；redacted，無 `payload`／`target_url`） | `CallbackOutboxSummary`（:456） | `total`、`entries[].status/attempts/max_attempts`；`total > entries.length`→unavailable | 三態直查 `/api/internal/*` 永不呼叫 |
| 5 | `GET /api/governance/issues`（`governanceProxy.ts:521`） | `{issues: IssueRow[]}`（governanceClient.ts:426） | `issues[].status`；未結＝`status ∉ {resolved, rejected}`（對齊 pages.tsx:867） | proxy 502→offline |
| 6 | `GET /api/governance/rule-runs?limit=5`（`governanceProxy.ts:223`） | `RuleRunHistoryResponse`（governanceClient.ts:69） | `total` | 可達性亦作 Governance chip／svc-dot |
| 7 | `GET /api/external/minio-watch/status`（`app.ts:2462`） | `MinioWatchStatus`（:345） | `enabled`、`baseline_count`、`seen_count`、`triggered_total` | `enabled:false`→dot degraded＋「watch 停用」 |
| 8 | `GET /api/minio/objects?delimiter=%2F`（`app.ts:2399`） | `MinioFolderListing`（:559） | `folders.length`、`folders[].has_source_ifc`；`note`（MinIO 未設定）→unavailable | 不揭露 `source_rvt` role → RVT 存在與否 `unavailable` |
| 9 | `GET /api/kit/health`（`app.ts:3779`，forward-only proxy → kit-manager `/health`） | `KitHealth`（本 slice 新增，`{status?: string}` 寬鬆） | 只用 HTTP 2xx 判可達 | proxy 502→offline→dot unknown |
| 10 | `GET /api/kit/instances/current`（`app.ts:3785`） | `KitInstanceState`（generated，`Required<>`） | `instance_id`、`status`、`control_status`、`last_command`、`opened_runtime_uris.length` | 404（無 instance）→`error`＋狀態碼 |

## 通用測試慣例（各 task 的測試檔共用）

- 掛載模式仿 `src/console/unified/a1DockLive.test.tsx`：`IS_REACT_ACT_ENVIRONMENT=true`、`createRoot`＋`act`、釘 hash（`prevHash` 還原）、6 次 microtask flush。
- 每個測試 `beforeEach` 先 `coordinatorStatusStore.reset()`（單例跨測試會殘留上一輪快照），`afterEach` 先 `root.unmount()` 再 `vi.restoreAllMocks()`。
- 十端點 mock 用 `__testdata__/coordinatorMocks.ts` 的 `spyCoordinatorEndpoints(overrides)`／`spyCoordinatorEndpointsOffline()`；不 stub `fetch`。

---

### Task 1: coordinatorClient 加性擴充＋共用 poller store（tasks 1.1／1.2／1.3）

> 本 task 由多個原 task 併成（額度／commit 錨點考量，coordinator 2026-08-25）：各子段（#### nA／nB…）的步驟、驗證與 commit 指令**逐字照做**，每段結尾的 commit 都要做；本 task 所有 commit message 一律以「task#<本 task 在 implementer 提示中的 index>: 」開頭再接原訊息。子段標題括號內的「原 Task N」對應文中所有「Task N Step M」的引用。

#### 1A. coordinatorClient 加性擴充（tasks 1.1 impact ＋ 1.2 shape 盤點）（原 Task 1）

**Files:**
- Modify: `web-viewer-sample/src/console/coordinatorClient.ts`（`jsonGet` 錯誤型別；`KitHealth`；`coordinatorClient` 加 3 個方法）
- Test: `web-viewer-sample/src/console/coordinatorClient.runtimeTruth.test.ts`（新）

- [x] **Step 1: impact 分析（tasks 1.1）並記錄** —— coordinator 2026-08-25 追認：`jsonGet` HIGH（16 個同檔 caller、0 process）已於 P1 與 P3 啟動前回報使用者；依 spec-to-done skill「HIGH 不是停下點：回報 blast radius 後續行，PR body 必寫補強」續行，Blocker #9 關閉。六筆 impact 數值見下方註記。

```powershell
$W = 'C:\Repos\active\iot\AI-BIM-governance.worktrees\unified-console-runtime-truth-s1'; Set-Location $W
npx gitnexus@1.6.9 impact jsonGet -d upstream -r AI-BIM-governance
npx gitnexus@1.6.9 impact "Const:web-viewer-sample/src/console/coordinatorClient.ts:coordinatorClient" -d upstream -r AI-BIM-governance
npx gitnexus@1.6.9 impact UnifiedShell -d upstream -r AI-BIM-governance
npx gitnexus@1.6.9 impact "Function:web-viewer-sample/src/console/unified/HomePage.tsx:HomePage" -d upstream -r AI-BIM-governance
npx gitnexus@1.6.9 impact PipelinePage -d upstream -r AI-BIM-governance
npx gitnexus@1.6.9 impact OpsPage -d upstream -r AI-BIM-governance
```

預期：每筆 JSON `"risk": "LOW"`（`jsonGet` 若列出 `Function:...coordinatorClient.ts:jsonGet` 的 callers 為同檔 `coordinatorClient` 方法，屬預期）。把六筆 `risk`／`impactedCount` 抄進 `$W\artifacts\slice1-impact.txt`（ignored 目錄；供 PR body「blast radius」段落）。任一為 HIGH／CRITICAL → 停止並回報 coordinator。

> **實跑偏離（fixer 2026-08-25 補記；待 coordinator 事後追認）**：本步驟六筆實跑中 `jsonGet` 回 `"risk": "HIGH"`／`"impactedCount": 16`（其餘五筆 LOW，與預期一致），已觸發上一段「任一為 HIGH／CRITICAL → 停止並回報 coordinator」的停點，亦適用 repo `CLAUDE.md` GitNexus 政策（`MUST warn the user if impact analysis returns HIGH or CRITICAL risk before proceeding`／`NEVER ignore HIGH or CRITICAL risk warnings`）。當輪 implementer **未停止、亦未回報 coordinator**，逕自於 `artifacts/slice1-impact.txt`（ignored，不入 commit）寫下續行理由後打勾，並完成 Step 2–6（commit `157a4aa`：`CoordinatorHttpError` 落地）。此屬未依 Step 1 指示執行的**流程缺口**，已列為 Blocker #9 交 coordinator 事後追認；追認前，本步驟的 `[x]` 僅代表「六筆 impact 已實跑並抄錄」，**不代表 HIGH 停點已依規履行**。
>
> fixer 於 2026-08-25 重跑 `npx gitnexus@1.6.9 impact jsonGet -d upstream -r AI-BIM-governance` 覆核：仍為 `"risk": "HIGH"`／`"impactedCount": 16`；16 筆 caller 的 `filePath` 全數為 `web-viewer-sample/src/console/coordinatorClient.ts`（同檔既有方法），皆以 `await jsonGet<T>(...)` 消費、未檢查 `error.constructor`／`Object.getPrototypeOf`，`message` 逐字不變；`coordinatorClient.test.ts`(42)＋`coordinatorClient.conversions-history.test.ts`(2)＋`coordinatorClient.runtimeTruth.test.ts`(4)＋`coordinatorStatusStore.test.ts`(8) 共 56 passed、`npx tsc --noEmit` 無錯。**技術面未觀察到退化，不等於流程停點已合規**——是否追認由 coordinator 裁決；fixer 未改動任何 production code。
>
> **第二輪 fixer 覆核＋停點回報（2026-08-25）**：獨立重跑 plan 本步驟指定的**六筆** impact，逐筆結果為 —— `jsonGet` **HIGH／16**、`Const:web-viewer-sample/src/console/coordinatorClient.ts:coordinatorClient` LOW／0、`UnifiedShell` LOW／2、`HomePage` LOW／2、`PipelinePage` LOW／2、`OpsPage` LOW／2；`web-viewer-sample` 下 `coordinatorClient.test.ts`(42)＋`coordinatorClient.conversions-history.test.ts`(2)＋`coordinatorClient.runtimeTruth.test.ts`(4)＋`coordinatorStatusStore.test.ts`(8) 共 **56 passed**、`npx tsc --noEmit` **exit 0**。六筆數值原僅抄入 `artifacts/slice1-impact.txt`，該路徑受 `.gitignore:248`（`artifacts/*.txt`）排除、不隨 PR 留存，故在此留下可 commit 的正本，供 PR body「blast radius」段落逐字引用。停點的**「回報 coordinator」半邊已於本輪 fixer 回報中補行**（含 HIGH 警示與「追認／回退」兩選項）；**「停止」半邊因 Step 2–6 已落地而無法回溯補行**，仍待裁決。本輪並將 Step 1 的 `[x]` 撤回為 `[ ]`（HELD），使勾選狀態與「停點未履行」的事實一致。

- [x] **Step 2: 寫失敗測試**

建立 `web-viewer-sample/src/console/coordinatorClient.runtimeTruth.test.ts`：

```ts
// unified-console-runtime-truth slice 1（tasks 1.2）：coordinatorClient 十端點允許清單擴充的 wire 契約，
// 與「GET 非 2xx 丟帶 status 的 CoordinatorHttpError（message 逐字不變）」。
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoordinatorHttpError, coordinatorClient } from "./coordinatorClient";

function mockRes(status: number, body: unknown) {
  const text = JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, statusText: `HTTP ${status}`, json: async () => body, text: async () => text };
}

describe("coordinatorClient runtime-truth 擴充", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("kitHealth 打 GET /api/kit/health（forward-only proxy）並原樣回 JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockRes(200, { status: "ok" }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(coordinatorClient.kitHealth()).resolves.toEqual({ status: "ok" });
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/kit/health");
  });

  it("governanceIssues 打 GET /api/governance/issues 並回 { issues }", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockRes(200, { issues: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(coordinatorClient.governanceIssues()).resolves.toEqual({ issues: [] });
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/api\/governance\/issues$/);
  });

  it("governanceRuleRuns 打 GET /api/governance/rule-runs?limit=N（預設 5）", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockRes(200, { filters: {}, limit: 5, offset: 0, total: 0, items: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(coordinatorClient.governanceRuleRuns()).resolves.toMatchObject({ total: 0 });
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/governance/rule-runs?limit=5");
  });

  it("GET 非 2xx 丟 CoordinatorHttpError：帶 status／path，message 逐字維持既有格式", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockRes(503, { detail: "design_gate_deterministic_offline" })));
    const err = await coordinatorClient.runtimeStatus().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CoordinatorHttpError);
    expect(err).toMatchObject({ name: "CoordinatorHttpError", status: 503, path: "/api/runtime/status" });
    expect((err as Error).message).toBe("coordinator /api/runtime/status -> 503 design_gate_deterministic_offline");
  });
});
```

- [x] **Step 3: 跑測試確認失敗**

```powershell
$F = 'C:\Repos\active\iot\AI-BIM-governance.worktrees\unified-console-runtime-truth-s1\web-viewer-sample'; Set-Location $F
npx vitest run src/console/coordinatorClient.runtimeTruth.test.ts
```

預期：`Tests  4 failed (4)`；第一筆錯誤含 `coordinatorClient.kitHealth is not a function`，最後一筆含 `expected Error ... to be an instance of CoordinatorHttpError`。

- [x] **Step 4: 最小實作**

`coordinatorClient.ts` 四處編輯（Read 後以精確字串定位）：

(a) `import type { components as kitManagerComponents } from "../generated/kit-manager-api";` 之後加：

```ts
import type { IssueRow, RuleRunHistoryResponse } from "./governanceClient";
```

（type-only import；`governanceClient.ts` 只 import `coordinatorBase`，無循環。）

(b) `async function jsonGet<T>(path: string): Promise<T> {` 之前加：

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
```

（上述 class＋`isCoordinatorNotFound` 與 slice 2 plan 4A **逐字相同**（含註解），兩切片在同一位置加入相同內容，merge 不衝突；`isCoordinatorNotFound` 本切片不使用但**必須一併加入且不得改動**。）

(c) `jsonGet` 內的 `throw new Error(\`coordinator ${path} -> ${res.status} ${await errorDetail(res)}\`);`（只改 `jsonGet` 這一處；`jsonPost`／`jsonPut`／`jsonPostWithHeaders` 不動）改為：

```ts
    throw new CoordinatorHttpError(path, res.status, await errorDetail(res));
```

(d) `export type KitInstanceState = Required<...>;` 之後加型別；`postIssueSnapshot` 方法之後（物件結尾 `};` 之前）加三個方法：

```ts
// unified-console-runtime-truth：GET /api/kit/health 是 coordinator 對 kit-manager /health 的 forward-only proxy
// （app.ts `proxyConversionService`）。body 形狀由 kit-manager 決定；前端只據 HTTP 2xx 判「可達」，不解讀、不捏造。
export interface KitHealth {
  status?: string;
  [k: string]: unknown;
}
```

```ts
  // unified-console-runtime-truth（edge-console-operator-frontend MODIFIED：允許端點清單擴充）。
  // 三者皆為既有 :8004 端點（app.ts:3779、governanceProxy.ts:521,223）；共用 poller 唯一入口，
  // 讓 vitest 一律於 coordinatorClient 層 spy 注入 mock。
  kitHealth: () => jsonGet<KitHealth>("/api/kit/health"),
  governanceIssues: () => jsonGet<{ issues: IssueRow[] }>("/api/governance/issues"),
  governanceRuleRuns: (limit = 5) => jsonGet<RuleRunHistoryResponse>(`/api/governance/rule-runs?limit=${limit}`),
```

- [x] **Step 5: 跑測試確認通過（含既有 client 測試不退化）＋型別**

```powershell
Set-Location $F
npx vitest run src/console/coordinatorClient.runtimeTruth.test.ts src/console/coordinatorClient.test.ts src/console/coordinatorClient.conversions-history.test.ts src/console/SharedStatusProvider.test.tsx
npx tsc --noEmit
```

預期：`Test Files  4 passed (4)`；tsc 無輸出（exit 0）。

- [x] **Step 6: 產出盤點表並 commit**

把本 plan「十端點欄位 shape 盤點」表逐字複製到 `$W\artifacts\slice1-shape-inventory.md`（ignored；Task 10 貼進 PR body），並在表下加一行「行號重定位：`rg -n "api/kit/health|api/kit/instances/current|api/callback-outbox/summary|api/conversion/records|api/external/minio-watch/status|api/minio/objects|api/runtime/status|api/external/ifc-ready\"" bim-review-coordinator/src/app.ts` 與 `rg -n "api/governance/issues|api/governance/rule-runs" bim-review-coordinator/src/routes/governanceProxy.ts` 於 `<今日日期>` 輸出」（貼上實際輸出）。

```powershell
Set-Location $W
git add web-viewer-sample/src/console/coordinatorClient.ts web-viewer-sample/src/console/coordinatorClient.runtimeTruth.test.ts
git diff --cached --check
git commit -m "task#1: coordinatorClient 加性擴充（CoordinatorHttpError、kitHealth／governanceIssues／governanceRuleRuns）" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

預期：`git diff --cached --check` 無輸出；commit 成功（1 file changed + 1 new）。

---

#### 1B. 共用 poller store `CoordinatorStatusStore`＋`ConsoleDataProvider`＋測試 mock（tasks 1.3）（原 Task 2）

**Files:**
- Create: `web-viewer-sample/src/console/unified/coordinatorStatusStore.ts`
- Create: `web-viewer-sample/src/console/unified/ConsoleDataProvider.tsx`
- Create: `web-viewer-sample/src/console/unified/__testdata__/coordinatorMocks.ts`
- Test: `web-viewer-sample/src/console/unified/coordinatorStatusStore.test.ts`

- [x] **Step 1: 建立測試 mock 模組（test-only；production 不得 import，Task 7 的符號測試守門）**

建立 `web-viewer-sample/src/console/unified/__testdata__/coordinatorMocks.ts`：

```ts
// 測試專用：十端點的「閒置真值」payload（形狀對齊 2026-08-25 canonical-linux 同分鐘 API：0 session／issues []／
// kit_local_001 idle）與 coordinatorClient 層 spy helper。production 元件不得 import 本目錄
// （fixtureNotInProduction.test.ts 守門）。
import { vi } from "vitest";
import { CoordinatorHttpError, coordinatorClient } from "../../coordinatorClient";
import type { RuntimeStatus } from "../../coordinatorClient";
import type { EndpointData, EndpointFetchers, EndpointKey } from "../coordinatorStatusStore";

export const RT_IDLE: RuntimeStatus = {
  service: { status: "ok", name: "coordinator", uptime_seconds: 1, generated_at: "2026-08-25T00:00:00Z" },
  configured_endpoints: {
    coordinator: { host: "127.0.0.1", port: 8004, public_host: "127.0.0.1", public_base_url: "http://127.0.0.1:8004" },
    viewer: { browser_url_base: "http://127.0.0.1:5173", handoff_path: "/" },
    conversion_authority: { base_url: "http://127.0.0.1:49101", authority: "bim-streaming-server" },
    kit: [{ id: "kit_local_001", signalingServer: "127.0.0.1", signalingPort: 49100, mediaServer: "127.0.0.1", mediaPort: 47998 }],
  },
  sessions: { count: 0, active_count: 0, participant_count: 0, items: [] },
  kit_instance_bindings: [],
  ifc_ready_jobs: { count: 0, recent: [] },
  observations: { classification: "demo", note: "", web_plane: { coordinator_port: 8004, viewer_port: 5173 }, host_native_plane: { conversion_api_base: "", kit_signal_ports: [49100], kit_media_ports: [47998] } },
};

export const IDLE: EndpointData = {
  runtimeStatus: RT_IDLE,
  ifcReady: { count: 0, items: [] },
  conversionRecords: { count: 0, items: [] },
  outboxSummary: { total: 0, limit: 200, entries: [] },
  issues: { issues: [] },
  ruleRuns: { filters: {}, limit: 5, offset: 0, total: 0, items: [] },
  minioWatch: { enabled: false, note: "watch disabled" },
  minioFolder: { bucket: null, prefix: "", folders: [], objects: [], count: 0 },
  kitHealth: { status: "ok" },
  kitInstance: { instance_id: "kit_local_001", status: "idle", control_status: "not_sent", selected_artifact_ids: [], opened_runtime_uris: [], last_command: null },
};

export const ENDPOINT_PATHS: Record<EndpointKey, string> = {
  runtimeStatus: "/api/runtime/status",
  ifcReady: "/api/external/ifc-ready?limit=20",
  conversionRecords: "/api/conversion/records?limit=100",
  outboxSummary: "/api/callback-outbox/summary?limit=200",
  issues: "/api/governance/issues",
  ruleRuns: "/api/governance/rule-runs?limit=5",
  minioWatch: "/api/external/minio-watch/status",
  minioFolder: "/api/minio/objects?delimiter=%2F",
  kitHealth: "/api/kit/health",
  kitInstance: "/api/kit/instances/current",
};

export function offline503(key: EndpointKey): CoordinatorHttpError {
  return new CoordinatorHttpError(ENDPOINT_PATHS[key], 503, "design_gate_deterministic_offline");
}

/** 直接餵給 CoordinatorStatusStore 建構子的 fetcher 組（不經 coordinatorClient）。 */
export function idleFetchers(overrides: Partial<EndpointData> = {}): EndpointFetchers {
  const data: EndpointData = { ...IDLE, ...overrides };
  return {
    runtimeStatus: async () => data.runtimeStatus,
    ifcReady: async () => data.ifcReady,
    conversionRecords: async () => data.conversionRecords,
    outboxSummary: async () => data.outboxSummary,
    issues: async () => data.issues,
    ruleRuns: async () => data.ruleRuns,
    minioWatch: async () => data.minioWatch,
    minioFolder: async () => data.minioFolder,
    kitHealth: async () => data.kitHealth,
    kitInstance: async () => data.kitInstance,
  };
}

export type EndpointOverrides = Partial<{ [K in EndpointKey]: EndpointData[K] | Error }>;

/** 對 coordinatorClient 十個方法一次 spy：預設閒置真值；overrides 給 payload 或 Error（reject）。 */
export function spyCoordinatorEndpoints(overrides: EndpointOverrides = {}) {
  const pick = <K extends EndpointKey>(key: K): Promise<EndpointData[K]> => {
    const v = overrides[key];
    return v instanceof Error ? Promise.reject(v) : Promise.resolve((v ?? IDLE[key]) as EndpointData[K]);
  };
  return {
    runtimeStatus: vi.spyOn(coordinatorClient, "runtimeStatus").mockImplementation(() => pick("runtimeStatus")),
    listIfcReady: vi.spyOn(coordinatorClient, "listIfcReady").mockImplementation(() => pick("ifcReady")),
    getConversionRecords: vi.spyOn(coordinatorClient, "getConversionRecords").mockImplementation(() => pick("conversionRecords")),
    getCallbackOutboxSummary: vi.spyOn(coordinatorClient, "getCallbackOutboxSummary").mockImplementation(() => pick("outboxSummary")),
    governanceIssues: vi.spyOn(coordinatorClient, "governanceIssues").mockImplementation(() => pick("issues")),
    governanceRuleRuns: vi.spyOn(coordinatorClient, "governanceRuleRuns").mockImplementation(() => pick("ruleRuns")),
    minioWatchStatus: vi.spyOn(coordinatorClient, "minioWatchStatus").mockImplementation(() => pick("minioWatch")),
    getMinioFolder: vi.spyOn(coordinatorClient, "getMinioFolder").mockImplementation(() => pick("minioFolder")),
    kitHealth: vi.spyOn(coordinatorClient, "kitHealth").mockImplementation(() => pick("kitHealth")),
    kitInstanceCurrent: vi.spyOn(coordinatorClient, "kitInstanceCurrent").mockImplementation(() => pick("kitInstance")),
  };
}

/** 十端點全部 503（design gate 環境語意）。 */
export function spyCoordinatorEndpointsOffline() {
  return spyCoordinatorEndpoints({
    runtimeStatus: offline503("runtimeStatus"), ifcReady: offline503("ifcReady"), conversionRecords: offline503("conversionRecords"),
    outboxSummary: offline503("outboxSummary"), issues: offline503("issues"), ruleRuns: offline503("ruleRuns"),
    minioWatch: offline503("minioWatch"), minioFolder: offline503("minioFolder"), kitHealth: offline503("kitHealth"),
    kitInstance: offline503("kitInstance"),
  });
}
```

- [x] **Step 2: 寫失敗測試 `coordinatorStatusStore.test.ts`**

```ts
// unified-console-runtime-truth slice 1（tasks 1.3）：共用 poller 的五條義務——同端點單一 in-flight、
// 10s 節奏、指數退避 ≤60s、document.hidden 不發請求、最後訂閱者離開即停；失敗分類；liveFetchers 走 coordinatorClient。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CoordinatorHttpError, coordinatorClient } from "../coordinatorClient";
import { CoordinatorStatusStore, classifyFailure, liveFetchers } from "./coordinatorStatusStore";
import { IDLE, idleFetchers, offline503 } from "./__testdata__/coordinatorMocks";

describe("CoordinatorStatusStore", () => {
  let hidden = false;
  let store: CoordinatorStatusStore | null = null;
  beforeEach(() => { vi.useFakeTimers(); hidden = false; });
  afterEach(() => { store?.dispose(); store = null; vi.restoreAllMocks(); vi.useRealTimers(); });

  const make = (fetchers = idleFetchers()) => {
    store = new CoordinatorStatusStore(fetchers, { isHidden: () => hidden, now: () => 1_000 });
    return store;
  };

  it("初始快照全部 offline（尚未收到任何回應＝未連線）", () => {
    const s = make();
    expect(s.getSnapshot().runtimeStatus).toEqual({ data: null, state: "offline", httpStatus: null, message: null, lastUpdatedAt: null });
  });

  it("兩個訂閱者同時 retain 同端點 → 只發一個請求；10s 後才發第二個", async () => {
    let resolve!: (v: typeof IDLE.runtimeStatus) => void;
    const runtimeStatus = vi.fn(() => new Promise<typeof IDLE.runtimeStatus>((r) => { resolve = r; }));
    const s = make({ ...idleFetchers(), runtimeStatus });
    s.retain("runtimeStatus"); s.retain("runtimeStatus");
    expect(runtimeStatus).toHaveBeenCalledTimes(1);
    resolve(IDLE.runtimeStatus);
    await vi.advanceTimersByTimeAsync(0);
    expect(s.getSnapshot().runtimeStatus.state).toBe("live");
    expect(s.getSnapshot().runtimeStatus.lastUpdatedAt).toBe(1_000);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(runtimeStatus).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(runtimeStatus).toHaveBeenCalledTimes(2);
  });

  it("連續失敗指數退避 20s→40s→60s（上限 60s），成功後回到 10s", async () => {
    let fail = true;
    const kitHealth = vi.fn(async () => { if (fail) throw offline503("kitHealth"); return IDLE.kitHealth; });
    const s = make({ ...idleFetchers(), kitHealth });
    s.retain("kitHealth");
    await vi.advanceTimersByTimeAsync(0);
    expect(kitHealth).toHaveBeenCalledTimes(1);
    expect(s.getSnapshot().kitHealth).toMatchObject({ state: "offline", httpStatus: 503 });
    await vi.advanceTimersByTimeAsync(20_000); expect(kitHealth).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(40_000); expect(kitHealth).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(60_000); expect(kitHealth).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(60_000); expect(kitHealth).toHaveBeenCalledTimes(5);
    fail = false;
    await vi.advanceTimersByTimeAsync(60_000); expect(kitHealth).toHaveBeenCalledTimes(6);
    expect(s.getSnapshot().kitHealth.state).toBe("live");
    await vi.advanceTimersByTimeAsync(10_000); expect(kitHealth).toHaveBeenCalledTimes(7);
  });

  it("document.hidden：不發請求；轉為可見時立即發一輪", async () => {
    hidden = true;
    const issues = vi.fn(async () => IDLE.issues);
    const s = make({ ...idleFetchers(), issues });
    s.retain("issues");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(issues).not.toHaveBeenCalled();
    hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(issues).toHaveBeenCalledTimes(1);
  });

  it("最後訂閱者 release 後不再排程", async () => {
    const ruleRuns = vi.fn(async () => IDLE.ruleRuns);
    const s = make({ ...idleFetchers(), ruleRuns });
    s.retain("ruleRuns");
    await vi.advanceTimersByTimeAsync(0);
    s.release("ruleRuns");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(ruleRuns).toHaveBeenCalledTimes(1);
    expect(s.refCount("ruleRuns")).toBe(0);
  });

  it("classifyFailure：502/503/504→offline；其他 HTTP→error 帶狀態碼；非 HTTP 錯誤→offline", () => {
    expect(classifyFailure(new CoordinatorHttpError("/x", 503, "d"))).toMatchObject({ state: "offline", httpStatus: 503 });
    expect(classifyFailure(new CoordinatorHttpError("/x", 502, "d"))).toMatchObject({ state: "offline", httpStatus: 502 });
    expect(classifyFailure(new CoordinatorHttpError("/x", 404, "no instance"))).toMatchObject({ state: "error", httpStatus: 404 });
    expect(classifyFailure(new TypeError("fetch failed"))).toMatchObject({ state: "offline", httpStatus: null, message: "fetch failed" });
  });

  it("liveFetchers 在呼叫時才讀 coordinatorClient 屬性（vi.spyOn 可攔截）", async () => {
    const spy = vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue(IDLE.runtimeStatus);
    await expect(liveFetchers.runtimeStatus()).resolves.toBe(IDLE.runtimeStatus);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("reset（測試用）：清回初始快照、refCount 歸零、不再排程", async () => {
    const minioWatch = vi.fn(async () => IDLE.minioWatch);
    const s = make({ ...idleFetchers(), minioWatch });
    s.retain("minioWatch");
    await vi.advanceTimersByTimeAsync(0);
    expect(s.getSnapshot().minioWatch.state).toBe("live");
    s.reset();
    expect(s.refCount("minioWatch")).toBe(0);
    expect(s.getSnapshot().minioWatch.state).toBe("offline");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(minioWatch).toHaveBeenCalledTimes(1);
  });
});
```

- [x] **Step 3: 跑測試確認失敗**

```powershell
Set-Location $F
npx vitest run src/console/unified/coordinatorStatusStore.test.ts
```

預期：`Failed to resolve import "./coordinatorStatusStore"`（模組不存在）。

- [x] **Step 4: 實作 `coordinatorStatusStore.ts`**

```ts
// ═══════════════════════════════════════════════════════════════════════
// UnifiedConsole — 共用 poller store（unified-console-runtime-truth design §3.1）
// 十個 coordinator :8004 既有端點各自一條輪詢迴圈：預設 10 秒節奏、同端點同時最多一個 in-flight、
// 連續失敗指數退避（10s×2^n，上限 60s）、document.hidden 時不發請求；頁面「訂閱」而非各自 fetch。
// 沿用既有 coordinatorClient（不新增 HTTP client／依賴）；vitest 於 coordinatorClient 層 spy 注入 mock。
// 狀態語意（design §3.2）：live＝最近一次 2xx；offline＝502／503／504／網路錯誤／逾時，或尚未收到任何回應；
// error＝其他非 2xx（誠實顯示狀態碼）。「unavailable（200 但欄位缺席／截斷）」由消費端 pick 判定（runtimeTruth.ts）。
// 模組層單例（非 hook）：跨頁／殼層共享同一條迴圈，才能做到同端點單一 in-flight。
// ═══════════════════════════════════════════════════════════════════════
import { useEffect, useSyncExternalStore } from "react";
import { CoordinatorHttpError, coordinatorClient } from "../coordinatorClient";
import type {
  CallbackOutboxSummary, ConversionRecord, IfcReadyListItem, KitHealth, KitInstanceState,
  MinioFolderListing, MinioWatchStatus, RuntimeStatus,
} from "../coordinatorClient";
import type { IssueRow, RuleRunHistoryResponse } from "../governanceClient";

export type TransportState = "live" | "offline" | "error";

export interface EndpointData {
  runtimeStatus: RuntimeStatus;
  ifcReady: { count: number; items: IfcReadyListItem[] };
  conversionRecords: { count: number; items: ConversionRecord[] };
  outboxSummary: CallbackOutboxSummary;
  issues: { issues: IssueRow[] };
  ruleRuns: RuleRunHistoryResponse;
  minioWatch: MinioWatchStatus;
  minioFolder: MinioFolderListing;
  kitHealth: KitHealth;
  kitInstance: KitInstanceState;
}
export type EndpointKey = keyof EndpointData;
export const ENDPOINT_KEYS: readonly EndpointKey[] = [
  "runtimeStatus", "ifcReady", "conversionRecords", "outboxSummary", "issues",
  "ruleRuns", "minioWatch", "minioFolder", "kitHealth", "kitInstance",
];

export interface EndpointSlice<T> {
  /** 最近一次成功 payload；之後失敗不擦除，但消費端只在 state==="live" 時讀值。 */
  data: T | null;
  state: TransportState;
  httpStatus: number | null;
  message: string | null;
  lastUpdatedAt: number | null;
}
export type CoordinatorStatusSnapshot = { [K in EndpointKey]: EndpointSlice<EndpointData[K]> };

export const POLL_INTERVAL_MS = 10_000;
export const BACKOFF_MAX_MS = 60_000;

export type EndpointFetchers = { [K in EndpointKey]: () => Promise<EndpointData[K]> };

/** production 唯一的 fetcher 組：每個都在呼叫時才讀 coordinatorClient 屬性，vi.spyOn 得以攔截。 */
export const liveFetchers: EndpointFetchers = {
  runtimeStatus: () => coordinatorClient.runtimeStatus(),
  ifcReady: () => coordinatorClient.listIfcReady(20),
  conversionRecords: () => coordinatorClient.getConversionRecords(100),
  outboxSummary: () => coordinatorClient.getCallbackOutboxSummary(200),
  issues: () => coordinatorClient.governanceIssues(),
  ruleRuns: () => coordinatorClient.governanceRuleRuns(5),
  minioWatch: () => coordinatorClient.minioWatchStatus(),
  minioFolder: () => coordinatorClient.getMinioFolder(),
  kitHealth: () => coordinatorClient.kitHealth(),
  kitInstance: () => coordinatorClient.kitInstanceCurrent(),
};

const OFFLINE_HTTP: ReadonlySet<number> = new Set([502, 503, 504]);

export function classifyFailure(error: unknown): { state: TransportState; httpStatus: number | null; message: string } {
  if (error instanceof CoordinatorHttpError) {
    return { state: OFFLINE_HTTP.has(error.status) ? "offline" : "error", httpStatus: error.status, message: error.message };
  }
  return { state: "offline", httpStatus: null, message: error instanceof Error ? error.message : String(error) };
}

function emptySlice<T>(): EndpointSlice<T> {
  return { data: null, state: "offline", httpStatus: null, message: null, lastUpdatedAt: null };
}
export function emptySnapshot(): CoordinatorStatusSnapshot {
  return {
    runtimeStatus: emptySlice(), ifcReady: emptySlice(), conversionRecords: emptySlice(), outboxSummary: emptySlice(),
    issues: emptySlice(), ruleRuns: emptySlice(), minioWatch: emptySlice(), minioFolder: emptySlice(),
    kitHealth: emptySlice(), kitInstance: emptySlice(),
  };
}

interface Loop { refs: number; inFlight: boolean; timer: ReturnType<typeof setTimeout> | null; consecutiveErrors: number; }

export interface CoordinatorStatusStoreOptions {
  intervalMs?: number;
  backoffMaxMs?: number;
  now?: () => number;
  isHidden?: () => boolean;
}

export class CoordinatorStatusStore {
  private snapshot: CoordinatorStatusSnapshot = emptySnapshot();
  private readonly listeners = new Set<() => void>();
  private readonly loops: Record<EndpointKey, Loop>;
  private readonly intervalMs: number;
  private readonly backoffMaxMs: number;
  private readonly now: () => number;
  private readonly isHidden: () => boolean;
  private visibilityBound = false;

  constructor(private readonly fetchers: EndpointFetchers, opts: CoordinatorStatusStoreOptions = {}) {
    this.intervalMs = opts.intervalMs ?? POLL_INTERVAL_MS;
    this.backoffMaxMs = opts.backoffMaxMs ?? BACKOFF_MAX_MS;
    this.now = opts.now ?? (() => Date.now());
    this.isHidden = opts.isHidden ?? (() => typeof document !== "undefined" && document.hidden === true);
    const loops = {} as Record<EndpointKey, Loop>;
    for (const key of ENDPOINT_KEYS) loops[key] = { refs: 0, inFlight: false, timer: null, consecutiveErrors: 0 };
    this.loops = loops;
  }

  readonly getSnapshot = (): CoordinatorStatusSnapshot => this.snapshot;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  /** 訂閱端點：第一個訂閱者立即發一輪，之後依節奏輪詢；已有訂閱者則共用同一條迴圈。 */
  retain(key: EndpointKey): void {
    const loop = this.loops[key];
    loop.refs += 1;
    if (loop.refs === 1) {
      this.bindVisibility();
      this.clearTimer(key);
      void this.poll(key);
    }
  }

  /** 最後一個訂閱者離開即停止排程（in-flight 請求自然結束後不再排下一輪）。 */
  release(key: EndpointKey): void {
    const loop = this.loops[key];
    loop.refs = Math.max(0, loop.refs - 1);
    if (loop.refs === 0) this.clearTimer(key);
  }

  refCount(key: EndpointKey): number { return this.loops[key].refs; }

  /** 測試用：清掉所有計時器、refCount 歸零、快照回初始（測試若漏 unmount，殘留元件下次 retain 會重新啟動迴圈）。 */
  reset(): void {
    for (const key of ENDPOINT_KEYS) {
      const loop = this.loops[key];
      this.clearTimer(key);
      loop.refs = 0;
      loop.inFlight = false;
      loop.consecutiveErrors = 0;
    }
    this.snapshot = emptySnapshot();
    this.emit();
  }

  /** 測試用：清掉所有計時器與 visibility 監聽。 */
  dispose(): void {
    for (const key of ENDPOINT_KEYS) { this.clearTimer(key); this.loops[key].refs = 0; }
    if (this.visibilityBound && typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.onVisibility);
      this.visibilityBound = false;
    }
  }

  private readonly onVisibility = (): void => {
    if (this.isHidden()) return;
    for (const key of ENDPOINT_KEYS) {
      const loop = this.loops[key];
      if (loop.refs > 0 && !loop.inFlight) { this.clearTimer(key); void this.poll(key); }
    }
  };

  private bindVisibility(): void {
    if (this.visibilityBound || typeof document === "undefined") return;
    document.addEventListener("visibilitychange", this.onVisibility);
    this.visibilityBound = true;
  }

  private clearTimer(key: EndpointKey): void {
    const loop = this.loops[key];
    if (loop.timer !== null) { clearTimeout(loop.timer); loop.timer = null; }
  }

  private schedule(key: EndpointKey, delayMs: number): void {
    this.clearTimer(key);
    this.loops[key].timer = setTimeout(() => { this.loops[key].timer = null; void this.poll(key); }, delayMs);
  }

  private delayFor(loop: Loop): number {
    if (loop.consecutiveErrors === 0) return this.intervalMs;
    return Math.min(this.intervalMs * Math.pow(2, loop.consecutiveErrors), this.backoffMaxMs);
  }

  private async poll<K extends EndpointKey>(key: K): Promise<void> {
    const loop = this.loops[key];
    if (loop.refs === 0 || loop.inFlight) return; // 同端點單一 in-flight
    if (this.isHidden()) { this.schedule(key, this.intervalMs); return; } // hidden：不發請求，稍後再檢查
    loop.inFlight = true;
    try {
      const data = await this.fetchers[key]();
      loop.consecutiveErrors = 0;
      this.publish(key, { data, state: "live", httpStatus: 200, message: null, lastUpdatedAt: this.now() });
    } catch (error) {
      loop.consecutiveErrors += 1;
      const failure = classifyFailure(error);
      const prev = this.snapshot[key];
      this.publish(key, { data: prev.data, state: failure.state, httpStatus: failure.httpStatus, message: failure.message, lastUpdatedAt: prev.lastUpdatedAt });
    } finally {
      loop.inFlight = false;
      if (loop.refs > 0) this.schedule(key, this.delayFor(loop));
    }
  }

  private publish<K extends EndpointKey>(key: K, slice: EndpointSlice<EndpointData[K]>): void {
    this.snapshot = { ...this.snapshot, [key]: slice } as CoordinatorStatusSnapshot;
    this.emit();
  }

  private emit(): void { for (const listener of this.listeners) listener(); }
}

/** production 單例：只注入 live fetchers（design §1.4：production 只注入 live store）。 */
export const coordinatorStatusStore = new CoordinatorStatusStore(liveFetchers);

/**
 * 訂閱指定端點並回傳整份快照。keys 必須是模組層常數陣列（identity 穩定），否則每次 render 都會 release/retain。
 * 第三參數（server snapshot）讓 renderToString（unified.test.tsx）不丟 getServerSnapshot 缺席錯誤；SSR 無 effect，不會發請求。
 */
export function useCoordinatorStatus(store: CoordinatorStatusStore, keys: readonly EndpointKey[]): CoordinatorStatusSnapshot {
  useEffect(() => {
    for (const key of keys) store.retain(key);
    return () => { for (const key of keys) store.release(key); };
  }, [store, keys]);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
```

- [x] **Step 5: 實作 `ConsoleDataProvider.tsx`**

```tsx
// UnifiedConsole — ConsoleDataProvider（unified-console-runtime-truth design §1.4）：頁面資料來源的單一注入點。
// production 由 UnifiedShell 注入 live 單例 coordinatorStatusStore；vitest 以 coordinatorClient 層 spy 注入 mock；
// 不存在 fixture／preview provider（D1=P）。
import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import { CoordinatorStatusStore, coordinatorStatusStore, useCoordinatorStatus } from "./coordinatorStatusStore";
import type { CoordinatorStatusSnapshot, EndpointKey } from "./coordinatorStatusStore";

const ConsoleDataContext = createContext<CoordinatorStatusStore>(coordinatorStatusStore);

export function ConsoleDataProvider({ store, children }: { store: CoordinatorStatusStore; children: ReactNode }) {
  return <ConsoleDataContext.Provider value={store}>{children}</ConsoleDataContext.Provider>;
}

/** 頁面訂閱端點（keys 為模組層常數）並取得整份快照。 */
export function useConsoleData(keys: readonly EndpointKey[]): CoordinatorStatusSnapshot {
  return useCoordinatorStatus(useContext(ConsoleDataContext), keys);
}
```

- [x] **Step 6: 跑測試確認通過＋型別**

```powershell
Set-Location $F
npx vitest run src/console/unified/coordinatorStatusStore.test.ts
npx tsc --noEmit
```

預期：`Tests  8 passed (8)`；tsc exit 0。若 tsc 對 `__testdata__/coordinatorMocks.ts` 報 `vi` 型別問題，確認檔案在 `src/` 下（tsconfig `types: ["vitest/globals"]` 已含 vitest 型別）。

- [x] **Step 7: Commit**

```powershell
Set-Location $W
git add web-viewer-sample/src/console/unified/coordinatorStatusStore.ts web-viewer-sample/src/console/unified/coordinatorStatusStore.test.ts web-viewer-sample/src/console/unified/ConsoleDataProvider.tsx web-viewer-sample/src/console/unified/__testdata__/coordinatorMocks.ts
git diff --cached --check
git commit -m "task#2: 共用 poller store（單一 in-flight／退避 ≤60s／hidden 暫停）與 ConsoleDataProvider" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

預期：4 files changed（新增）。

---

### Task 2: 真值投影＋殼層 `UnifiedShell` 綁真值＋5.1 翻轉（tasks 1.7、5.1）

> 本 task 由多個原 task 併成（額度／commit 錨點考量，coordinator 2026-08-25）：各子段（#### nA／nB…）的步驟、驗證與 commit 指令**逐字照做**，每段結尾的 commit 都要做；本 task 所有 commit message 一律以「task#<本 task 在 implementer 提示中的 index>: 」開頭再接原訊息。子段標題括號內的「原 Task N」對應文中所有「Task N Step M」的引用。

#### 2A. 既有 unified-mount 測試的前置防護 sweep（三檔逐字 patch；不改任何斷言）（原 Task 3a）

**為何獨立成一個 task：** Task 3c 會讓 `UnifiedShell` 開始經共用 poller 打十端點。凡是「`import EdgeConsole` 且以 `createRoot` 真掛載於 approved 鍵（`#home`／`#pipeline`／`#a1`…）」的既有測試，屆時都會在 jsdom 下打真網路。本 task 先把防護補齊，**不改任何斷言**：語意零變化、sweep 前後全量同綠，因此與「殼層行為改變」分屬兩個 scope、分開 commit。每個檔案改完立刻有自己的單檔檢查點（2–5 分鐘內能把錯誤定位到剛才那一個 patch），不必等殼層改完才發現插錯位置。

**Files:**
- Modify: `web-viewer-sample/src/console/EdgeConsole.aliasRedirect.test.tsx`
- Modify: `web-viewer-sample/src/console/unified/dockLiveLink.test.tsx`
- Modify: `web-viewer-sample/src/console/unified/a1DockLive.test.tsx`
- 核實後**不改**（Step 8 出證據）：`web-viewer-sample/src/console/incomingHandoff.test.tsx`

**前置：** Task 2 已建立 `src/console/unified/coordinatorStatusStore.ts`（含 `coordinatorStatusStore.reset()`）與 `src/console/unified/__testdata__/coordinatorMocks.ts`（含 `spyCoordinatorEndpointsOffline()`）；Task 1 已在 `coordinatorClient` 補上 `kitHealth`／`governanceIssues`／`governanceRuleRuns`（否則 `vi.spyOn` 這三個方法會丟 "does not exist"）。

**逐字 patch 慣例：** 下列每個 patch 給 `old`／`new` 兩段。`old` 是 2026-08-25 的檔案現況逐字片段（含縮排），在該檔內唯一；`new` 是替換後全文。動手前先 Read 該檔確認 `old` 仍逐字存在；不存在就停下回報 coordinator（檔案已漂移，不得猜插入點）。

- [x] **Step 1: 核實「哪些既有測試會掛到 UnifiedShell」（只讀）**

```powershell
Set-Location $F
rg -n "^import EdgeConsole|renderToString\(<EdgeConsole" src/console/EdgeConsole.aliasRedirect.test.tsx src/console/unified/dockLiveLink.test.tsx src/console/unified/a1DockLive.test.tsx src/console/incomingHandoff.test.tsx src/console/unified/unified.test.tsx
```

2026-08-25 實測（plan 作者親跑）：

| 檔案 | 掛載方式 | 殼層會不會輪詢 | 本 task 處置 |
|---|---|---|---|
| `EdgeConsole.aliasRedirect.test.tsx` | `import EdgeConsole` ＋ `createRoot`（`#pipeline`／`#minio`／`#conv`／`#/workspace?dock=a4`…） | 會 | Step 2 patch |
| `unified/dockLiveLink.test.tsx` | `import EdgeConsole` ＋ `createRoot`（`#a1`／`#a2`） | 會 | Step 4 patch |
| `unified/a1DockLive.test.tsx` | `import EdgeConsole` ＋ `createRoot`（`#a1`） | 會 | Step 6 patch |
| `incomingHandoff.test.tsx` | **無 `EdgeConsole`**（直接掛 `A1GovernanceWorkbenchPage`／`ModelDataPage`／`SessionManagementPage`／`KitGpuFleetPage`） | 不會 | Step 8 核實後不改 |
| `unified/unified.test.tsx` | `renderToString(<EdgeConsole/>)` | 不會（SSR 不跑 effect，快照走 `getServerSnapshot`） | 不改（5.3 斷言翻轉屬 Task 4／5／6） |

若執行時 `rg` 結果與上表不同（檔案已漂移），先回報 coordinator 再調整清單，不得自行擴大或縮小 sweep。

- [x] **Step 2: patch `src/console/EdgeConsole.aliasRedirect.test.tsx`（逐字）**

patch (1)：import 區（現況 :10-11）。old：

```ts
import { coordinatorClient } from "./coordinatorClient";
import { governanceClient } from "./governanceClient";
```

new：

```ts
import { coordinatorClient } from "./coordinatorClient";
import { governanceClient } from "./governanceClient";
import { coordinatorStatusStore } from "./unified/coordinatorStatusStore";
import { spyCoordinatorEndpointsOffline } from "./unified/__testdata__/coordinatorMocks";
```

patch (2)：`beforeEach` **開頭**（現況 :20-22）。old：

```ts
  beforeEach(() => {
    prevActEnv = (globalThis as Record<string, unknown>)[actEnvKey];
    (globalThis as Record<string, unknown>)[actEnvKey] = true;
```

new：

```ts
  beforeEach(() => {
    prevActEnv = (globalThis as Record<string, unknown>)[actEnvKey];
    (globalThis as Record<string, unknown>)[actEnvKey] = true;
    // unified-console-runtime-truth（slice 1）：#pipeline／#/workspace 會掛 UnifiedShell，殼層改用共用 poller
    // 後會打十端點。先把十端點釘成 503（離線語意），再讓本檔下方既有的空值 stub 覆蓋它自己關心的方法。
    // 順序不可顛倒：若把這兩行移到既有 vi.spyOn 之後，getMinioFolder／getConversionRecords／listIfcReady／
    // minioWatchStatus／runtimeStatus 會被 503 蓋掉，ModelDataPage 改走錯誤分支（本檔 #intake→#minio 案會退化）。
    coordinatorStatusStore.reset();
    spyCoordinatorEndpointsOffline();
```

**不需要**補 `vi.restoreAllMocks()`：該檔 `afterEach`（現況 :59-61）已有。斷言一律不動。

- [x] **Step 3: 檢查點——單檔 vitest**

```powershell
Set-Location $F
npx vitest run src/console/EdgeConsole.aliasRedirect.test.tsx
```

預期：與 patch 前同綠（`Test Files  1 passed`）。紅燈只可能來自剛才那兩個 patch——最常見是把 patch (2) 插到既有 `vi.spyOn` 之後（見上方註解），或 import 路徑寫成 `./coordinatorStatusStore`（本檔在 `src/console/`，必須是 `./unified/…`）。修正後重跑，不往下走。

- [x] **Step 4: patch `src/console/unified/dockLiveLink.test.tsx`（逐字）**

patch (1)：import 區（現況 :10-11）。old：

```ts
import EdgeConsole from "../EdgeConsole";
import { coordinatorClient, type CoordinatorHealth } from "../coordinatorClient";
```

new：

```ts
import EdgeConsole from "../EdgeConsole";
import { coordinatorClient, type CoordinatorHealth } from "../coordinatorClient";
import { coordinatorStatusStore } from "./coordinatorStatusStore";
import { spyCoordinatorEndpointsOffline } from "./__testdata__/coordinatorMocks";
```

patch (2)：`beforeEach` 末尾（現況 :29-32）。old：

```ts
    container = document.createElement("div");
    document.body.appendChild(container);
    prevHash = window.location.hash;
  });
```

new：

```ts
    container = document.createElement("div");
    document.body.appendChild(container);
    prevHash = window.location.hash;
    coordinatorStatusStore.reset(); // 單例跨測試會殘留上一輪快照
  });
```

patch (3)：案 (b) 首行（現況 :61-62）。old：

```ts
  it("(b) health 成功 stub：fixture dock chip 導向正確；A4 只導向 canonical live surface", async () => {
    const spy = vi.spyOn(coordinatorClient, "health").mockResolvedValue(HEALTH);
```

new：

```ts
  it("(b) health 成功 stub：fixture dock chip 導向正確；A4 只導向 canonical live surface", async () => {
    spyCoordinatorEndpointsOffline(); // 殼層共用 poller：十端點釘 503，不打真網路（不碰 health probe）
    const spy = vi.spyOn(coordinatorClient, "health").mockResolvedValue(HEALTH);
```

patch (4)：案 (c) 首行（現況 :87-88）。old：

```ts
  it("(c) probe 例外（health 同步 throw）：頁面不炸、無 chip", async () => {
    vi.spyOn(coordinatorClient, "health").mockImplementation(() => { throw new Error("boom"); });
```

new：

```ts
  it("(c) probe 例外（health 同步 throw）：頁面不炸、無 chip", async () => {
    spyCoordinatorEndpointsOffline();
    vi.spyOn(coordinatorClient, "health").mockImplementation(() => { throw new Error("boom"); });
```

案 (a)（現況 :51-52）**不加**：它已 `vi.stubGlobal("fetch", vi.fn().mockRejectedValue(...))`，十端點經 `coordinatorClient` 走同一個 `fetch` → 自然全部 reject → store 分類為 offline；再加 spy 反而遮蔽「真離線」語意。

- [x] **Step 5: 檢查點——單檔 vitest**

```powershell
Set-Location $F
npx vitest run src/console/unified/dockLiveLink.test.tsx
```

預期：與 patch 前同綠（3 案）。若案 (b) 的 `expect(spy).toHaveBeenCalledTimes(1)` 變紅，代表 `spyCoordinatorEndpointsOffline()` 誤把 `health` 一起 spy 了——回 Task 2 Step 1 檢查該 helper 的方法清單（它只該覆蓋十端點，不含 `health`）。

- [x] **Step 6: patch `src/console/unified/a1DockLive.test.tsx`（逐字）**

patch (1)：import 區（現況 :11）。old：

```ts
import type { FilesTreeResponse, RuleRunHistoryItem, RuleRunStatus } from "../governanceClient";
```

new：

```ts
import type { FilesTreeResponse, RuleRunHistoryItem, RuleRunStatus } from "../governanceClient";
import { coordinatorStatusStore } from "./coordinatorStatusStore";
import { spyCoordinatorEndpointsOffline } from "./__testdata__/coordinatorMocks";
```

patch (2)：`beforeEach` 末尾（現況 :53-56）。old：

```ts
    container = document.createElement("div");
    document.body.appendChild(container);
    prevHash = window.location.hash;
  });
```

new：

```ts
    container = document.createElement("div");
    document.body.appendChild(container);
    prevHash = window.location.hash;
    coordinatorStatusStore.reset();
  });
```

patch (3)：案 (b) 首行（現況 :82-83）。old：

```ts
  it("(b) health 成功：live 區塊出現（data-prov=asbuilt）、近期 rule-runs 真資料渲染，fixture 區塊不變", async () => {
    vi.spyOn(coordinatorClient, "health").mockResolvedValue(HEALTH);
```

new：

```ts
  it("(b) health 成功：live 區塊出現（data-prov=asbuilt）、近期 rule-runs 真資料渲染，fixture 區塊不變", async () => {
    spyCoordinatorEndpointsOffline(); // 殼層共用 poller：十端點釘 503，不打真網路
    vi.spyOn(coordinatorClient, "health").mockResolvedValue(HEALTH);
```

patch (4)：案 (b2) 首行（現況 :108-109）。old：

```ts
  it("(b2) health 成功但 governance 清單失敗：誠實顯錯，不偽造資料", async () => {
    vi.spyOn(coordinatorClient, "health").mockResolvedValue(HEALTH);
```

new：

```ts
  it("(b2) health 成功但 governance 清單失敗：誠實顯錯，不偽造資料", async () => {
    spyCoordinatorEndpointsOffline();
    vi.spyOn(coordinatorClient, "health").mockResolvedValue(HEALTH);
```

patch (5)：案 (c) 首行（現況 :122-123）。old：

```ts
  it("(c) 選檔 → 執行 → useRuleRun for-library 真跑 → 結果摘要出現、近期清單 refresh", async () => {
    vi.spyOn(coordinatorClient, "health").mockResolvedValue(HEALTH);
```

new：

```ts
  it("(c) 選檔 → 執行 → useRuleRun for-library 真跑 → 結果摘要出現、近期清單 refresh", async () => {
    spyCoordinatorEndpointsOffline();
    vi.spyOn(coordinatorClient, "health").mockResolvedValue(HEALTH);
```

案 (a)（現況 :74-75）**不加**（同 dockLiveLink 案 (a)：已 stub 全域 `fetch` 失敗）。本檔只補 spy、不改斷言；5.2 的「liveBackend 真值取代 fixture」解凍在 Task 7。

- [x] **Step 7: 檢查點——單檔 vitest**

```powershell
Set-Location $F
npx vitest run src/console/unified/a1DockLive.test.tsx
```

預期：與 patch 前同綠（4 案）。

- [x] **Step 8: `incomingHandoff.test.tsx` 核實——本 slice 不改（出證據，不是省略）**

```powershell
Set-Location $F
rg -n "EdgeConsole" src/console/incomingHandoff.test.tsx
```

2026-08-25 實測：**0 命中**。該檔一律直接掛頁面元件（`A1GovernanceWorkbenchPage`／`ModelDataPage`／`SessionManagementPage`／`KitGpuFleetPage`／`SharedStatusProvider`），從不經 `EdgeConsole` → `UnifiedShell`，共用 poller 不會啟動，故**不需要**補 spy，本 task 對該檔零改動。

反例警告（不得照舊指示做）：該檔四個 A1 案（現況 :249／:261／:273／:287）的形狀是

```ts
    vi.spyOn(coordinatorClient, "getMinioObjects").mockResolvedValue(/* … */);
    vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue(status([]));
    window.location.hash = `#a1?source=minio&minio_key=${encodeURIComponent(CN_KEY)}`;
```

若照「在設定 hash 那行之前插 `spyCoordinatorEndpointsOffline();`」動手，會**覆蓋該檔自己的 `runtimeStatus` mock**（改成 503 reject），破壞該檔註解明載的「mock it empty so the effect resolves deterministically」，四案退化。日後該檔若真的改成掛 `EdgeConsole`（Step 8 的 `rg` 有命中），補 spy 必須插在該檔**自身 `vi.spyOn(coordinatorClient, …)` 之前**，語意同 Step 2 patch (2)。

- [x] **Step 9: 型別與全量（sweep 不得改變任何既有結果）**

```powershell
Set-Location $F
npx tsc --noEmit
npx vitest run
```

預期：tsc exit 0；全量 `0 failed`，且**測試檔數與案數與 sweep 前完全相同**（本 task 不新增測試檔、不新增／刪除 `it`）。任何數字變動代表改到了斷言 → 還原重來。

- [x] **Step 10: Commit**

```powershell
Set-Location $W
git add web-viewer-sample/src/console/EdgeConsole.aliasRedirect.test.tsx web-viewer-sample/src/console/unified/dockLiveLink.test.tsx web-viewer-sample/src/console/unified/a1DockLive.test.tsx docs/superpowers/plans/2026-08-25-unified-console-runtime-truth-s1.md
git diff --cached --check
git commit -m "task#3a: 既有 unified-mount 測試補共用 poller 十端點 spy 與 store reset（不改斷言）" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

#### 2B. 真值投影層——`runtimeTruth.ts` 純函式＋狀態文案 key＋測試 mock builders（tasks 1.7 的投影規則）（原 Task 3b）

**Scope（單一）：** 只產出「端點切片 → 畫面 cell」的純函式、它們的單元測試，以及這層要用到的狀態文案 key 與 mock builder。**不動任何 production 元件**（`UnifiedShell.tsx` 在 Task 3c 才改），所以本 task 結尾生產行為零變化、全量測試必綠，紅燈只可能來自本 task 自己的新檔。

**Files:**
- Create: `web-viewer-sample/src/console/unified/runtimeTruth.ts`
- Test: `web-viewer-sample/src/console/unified/runtimeTruth.test.ts`（新）
- Modify: `web-viewer-sample/src/console/unified/__testdata__/coordinatorMocks.ts`（檔尾加 3 個 builder）
- Modify: `web-viewer-sample/src/console/unified/fixtures.ts`（`Dict`＋`getL` 加 3 個 key）

- [x] **Step 1: impact 分析（本 task 只有 `fixtures.ts` 動到既有 symbol）**

```powershell
Set-Location $W
npx gitnexus@1.6.9 impact getL -d upstream -r AI-BIM-governance
```

預期 LOW（`getL` 的 callers 為 unified 五頁＋docks；本 task 只加 key，不改既有 key 的名稱、值或型別）。CRITICAL → 停下回報 coordinator；HIGH → 把 blast radius 記入本步驟註記（供 PR body 補強段）後**續行，不停**（spec-to-done skill：HIGH 非停下點；coordinator 2026-08-25 已追認 `jsonGet` HIGH 的前例）。

- [x] **Step 2: 寫失敗測試 `runtimeTruth.test.ts`**

```ts
// unified-console-runtime-truth slice 1：真值投影純函式（design §3.2 渲染規則＋§3.3 pickers）。
import { describe, expect, it } from "vitest";
import type { IssueRow } from "../governanceClient";
import type { EndpointSlice } from "./coordinatorStatusStore";
import {
  cell, cellSub, cellText, conversionCounts, healthOf, lastUpdatedText, openIssueCount, outboxPending,
} from "./runtimeTruth";
import { conversionRecord, outboxEntries } from "./__testdata__/coordinatorMocks";

const L = { unavailable: "未取得", offline: "未連線" };
const live = <T,>(data: T, at = 1_000): EndpointSlice<T> => ({ data, state: "live", httpStatus: 200, message: null, lastUpdatedAt: at });
const offline: EndpointSlice<never> = { data: null, state: "offline", httpStatus: 503, message: "coordinator /x -> 503 off", lastUpdatedAt: null };
const error: EndpointSlice<never> = { data: null, state: "error", httpStatus: 404, message: "coordinator /x -> 404 no instance", lastUpdatedAt: null };

describe("cell / cellText / cellSub", () => {
  it("live 顯示值；pick 回 null → unavailable（未取得）", () => {
    expect(cellText(cell(live({ n: 7 }), (d) => d.n), L)).toBe("7");
    const c = cell(live({ n: 7 }), () => null);
    expect(c.state).toBe("unavailable");
    expect(cellText(c, L)).toBe("未取得");
    expect(cellSub(c, L, () => "x")).toBe("未取得");
  });
  it("offline → —／未連線；error → 狀態碼／後端訊息；永不回 0", () => {
    const off = cell(offline, () => 0);
    expect(off.state).toBe("offline");
    expect(cellText(off, L)).toBe("—");
    expect(cellSub(off, L, () => "x")).toBe("未連線");
    const err = cell(error, () => 0);
    expect(cellText(err, L)).toBe("404");
    expect(cellSub(err, L, () => "x")).toBe("coordinator /x -> 404 no instance");
  });
});

describe("pickers（截斷窗不對子集算數）", () => {
  it("conversionCounts：非終態＝running；count > items.length → null", () => {
    expect(conversionCounts({ count: 4, items: [conversionRecord("a", "detected"), conversionRecord("b", "queued"), conversionRecord("c", "ready"), conversionRecord("d", "failed")] }))
      .toEqual({ running: 2, ready: 1, failed: 1 });
    expect(conversionCounts({ count: 101, items: [conversionRecord("a", "ready")] })).toBeNull();
  });
  it("outboxPending：pending 計數＋attempts 摘要；total > entries.length → null", () => {
    expect(outboxPending({ total: 36, limit: 200, entries: outboxEntries(36, 0, 5) })).toEqual({ pending: 36, attempts: 0, maxAttempts: 5 });
    expect(outboxPending({ total: 201, limit: 200, entries: outboxEntries(200, 0, 5) })).toBeNull();
  });
  it("openIssueCount：非 resolved／rejected 才算未結", () => {
    const row = (status: string): IssueRow => ({ id: status, kind: "issue", title: "t", status, severity: "high", ifc_guid: null, usd_prim_path: null, source_type: "rule" });
    expect(openIssueCount({ issues: [row("open"), row("in_review"), row("resolved"), row("rejected")] })).toBe(2);
  });
  it("healthOf：live→ok（或 degradedWhen）；error→degraded；offline→unknown", () => {
    expect(healthOf(live({ status: "ok" }))).toBe("ok");
    expect(healthOf(live({ status: "down" }), (d) => d.status !== "ok")).toBe("degraded");
    expect(healthOf(error)).toBe("degraded");
    expect(healthOf(offline)).toBe("unknown");
  });
  it("lastUpdatedText：無 live → —；有 live → 取最新時間（HH:mm:ss）", () => {
    expect(lastUpdatedText([offline, error])).toBe("—");
    expect(lastUpdatedText([live(1, Date.UTC(2026, 7, 25, 1, 2, 3)), offline])).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });
});
```

- [x] **Step 3: 補 `coordinatorMocks.ts` 三個 builder**（檔尾追加）

```ts
export function conversionRecord(key: string, status: ConversionRecord["status"]): ConversionRecord {
  return {
    idempotency_key: key, project_id: "270", project_display_name: "270", category: "building", external_model_version_id: "v1",
    conversion_job_id: null, status, usdc_key: null, coverage_report: null, object_key: null, detected_at: "2026-08-12T00:00:00Z", updated_at: "2026-08-12T00:00:00Z",
  };
}

export function outboxEntries(n: number, attempts: number, maxAttempts: number): CallbackOutboxSummaryEntry[] {
  return Array.from({ length: n }, (_, i) => ({
    outbox_id: `ob_${i}`, event: "conversion-result", status: "pending" as const, attempts, max_attempts: maxAttempts,
    last_error: null, created_at: "2026-08-25T00:00:00Z", delivered_at: null, correlation_id: null, conversion_job_id: null,
  }));
}

export function sessionItem(id: string, status = "active"): RuntimeSessionSummary {
  return {
    session_id: id, status, project_id: "270", model_version_id: "v1", participant_count: 1, expected_stage_url: null,
    conversion_status: "ready", kit_instance_ids: [], created_at: "2026-08-25T00:00:00Z", updated_at: "2026-08-25T00:00:00Z",
  };
}
```

並把該檔 type import 改為：`import type { CallbackOutboxSummaryEntry, ConversionRecord, RuntimeSessionSummary, RuntimeStatus } from "../../coordinatorClient";`。

- [x] **Step 4: 跑測試確認失敗（紅燈）**

```powershell
Set-Location $F
npx vitest run src/console/unified/runtimeTruth.test.ts
```

預期：整檔因 `Failed to resolve import "./runtimeTruth"` 失敗（`Test Files  1 failed`）。若改成「某幾案失敗」而非 import 失敗，代表 `runtimeTruth.ts` 已存在（前一輪殘留）——先 `git status` 確認再決定。

- [x] **Step 5: 實作 `runtimeTruth.ts`**

```ts
// ═══════════════════════════════════════════════════════════════════════
// UnifiedConsole — 真值投影（unified-console-runtime-truth design §3.2／§3.3）
// 把共用 poller 的端點切片投影成畫面 cell：只有 live 才顯示數字；unavailable（200 但欄位缺席／回傳窗截斷）
// 顯示「未取得」；offline（502／503／504／網路錯誤／尚未回應）顯示「—」＋「未連線」；error（其他非 2xx）顯示狀態碼與訊息。
// 永不以 0 作佔位；截斷窗不對子集算數（對齊 SharedStatusProvider 的 recordsIncomplete 模式）。
// ═══════════════════════════════════════════════════════════════════════
import type { CallbackOutboxSummary, ConversionRecord, RuntimeStatus } from "../coordinatorClient";
import type { IssueRow } from "../governanceClient";
import type { EndpointSlice } from "./coordinatorStatusStore";

export type DataState = "live" | "unavailable" | "offline" | "error";
export type HealthState = "ok" | "degraded" | "unknown";

export interface Cell<T> {
  state: DataState;
  value: T | null;
  httpStatus: number | null;
  message: string | null;
}

export interface StateLabels { unavailable: string; offline: string; }

/** pick 回 null ＝ 200 但欄位缺席／不可信（截斷）→ unavailable。 */
export function cell<D, T>(slice: EndpointSlice<D>, pick: (data: D) => T | null): Cell<T> {
  if (slice.state !== "live" || slice.data === null) {
    return { state: slice.state === "live" ? "offline" : slice.state, value: null, httpStatus: slice.httpStatus, message: slice.message };
  }
  const value = pick(slice.data);
  return value === null
    ? { state: "unavailable", value: null, httpStatus: 200, message: null }
    : { state: "live", value, httpStatus: 200, message: null };
}

/** 主值文字：live→format(value)；unavailable→未取得；offline→—；error→狀態碼。 */
export function cellText<T>(c: Cell<T>, L: StateLabels, format: (value: T) => string = (v) => String(v)): string {
  if (c.state === "live" && c.value !== null) return format(c.value);
  if (c.state === "unavailable") return L.unavailable;
  if (c.state === "offline") return "—";
  return c.httpStatus === null ? "error" : String(c.httpStatus);
}

/** 副標：live→liveSub(value)；unavailable→未取得；offline→未連線；error→後端訊息。 */
export function cellSub<T>(c: Cell<T>, L: StateLabels, liveSub: (value: T) => string): string {
  if (c.state === "live" && c.value !== null) return liveSub(c.value);
  if (c.state === "unavailable") return L.unavailable;
  if (c.state === "offline") return L.offline;
  return c.message ?? "error";
}

/** 服務健康：live 且未 degraded→ok；error（可達但非 2xx）→degraded；offline／尚未回應→unknown。 */
export function healthOf<D>(slice: EndpointSlice<D>, degradedWhen: (data: D) => boolean = () => false): HealthState {
  if (slice.state === "live" && slice.data !== null) return degradedWhen(slice.data) ? "degraded" : "ok";
  if (slice.state === "error") return "degraded";
  return "unknown";
}

export const HEALTH_DOT: Record<HealthState, string> = {
  ok: "var(--ab-ok)", degraded: "var(--ab-danger)", unknown: "var(--ab-text-dimmer)",
};

/** 主值色：live 沿用元件預設（undefined）；offline 琥珀、error 紅、unavailable 淡。 */
export function stateColor(state: DataState): string | undefined {
  if (state === "offline") return "var(--ab-warn)";
  if (state === "error") return "var(--ab-danger)";
  if (state === "unavailable") return "var(--ab-text-dim)";
  return undefined;
}

/* ── 端點對映 pickers（design §3.3）── */

/** ledger 非終態＝進行中（對齊 SharedStatusProvider QUEUE_STATUSES）。 */
export const IN_PROGRESS_STATUSES: ReadonlySet<ConversionRecord["status"]> =
  new Set<ConversionRecord["status"]>(["detected", "queued", "converting"]);

export interface ConversionCounts { running: number; ready: number; failed: number; }
export function conversionCounts(r: { count: number; items: ConversionRecord[] }): ConversionCounts | null {
  if (r.count > r.items.length) return null;
  const c: ConversionCounts = { running: 0, ready: 0, failed: 0 };
  for (const it of r.items) {
    if (it.status === "ready") c.ready += 1;
    else if (it.status === "failed") c.failed += 1;
    else if (IN_PROGRESS_STATUSES.has(it.status)) c.running += 1;
  }
  return c;
}

export function activeSessions(rt: RuntimeStatus): number { return rt.sessions.active_count; }

/** 「未結」＝非 resolved／rejected（對齊 pages.tsx IssuesRuleCenterPage 的可 resolve 判斷）。 */
const RESOLVED_ISSUE_STATUSES: ReadonlySet<string> = new Set(["resolved", "rejected"]);
export function openIssueCount(res: { issues: IssueRow[] }): number {
  return res.issues.filter((i) => !RESOLVED_ISSUE_STATUSES.has(i.status)).length;
}

export interface OutboxPending { pending: number; attempts: number; maxAttempts: number; }
export function outboxPending(s: CallbackOutboxSummary): OutboxPending | null {
  if (s.total > s.entries.length) return null;
  const pending = s.entries.filter((e) => e.status === "pending");
  return {
    pending: pending.length,
    attempts: pending.reduce((m, e) => Math.max(m, e.attempts), 0),
    maxAttempts: pending.reduce((m, e) => Math.max(m, e.max_attempts), 0),
  };
}

/** 「最後更新」：所有 live 切片中最新的 lastUpdatedAt；沒有 live→"—"（gate 環境確定性，不含時間戳）。 */
export function lastUpdatedText(slices: ReadonlyArray<EndpointSlice<unknown>>): string {
  let latest: number | null = null;
  for (const s of slices) {
    if (s.state === "live" && s.lastUpdatedAt !== null) latest = latest === null ? s.lastUpdatedAt : Math.max(latest, s.lastUpdatedAt);
  }
  return latest === null ? "—" : new Date(latest).toLocaleTimeString("zh-TW", { hour12: false });
}
```

- [x] **Step 6: `fixtures.ts` 加 3 個字典 key**

`Dict` 介面 `dock_issues: string; outbox: string;` 之後加：

```ts
  /* unified-console-runtime-truth：真值狀態文案 */
  offline: string; unavailable: string; last_updated: string;
```

`getL` zh 物件 `dock_issues: "Issues", outbox: "回拋 Outbox",` 之後加：

```ts
    offline: "未連線", unavailable: "未取得", last_updated: "最後更新",
```

en 物件 `dock_issues: "Issues", outbox: "Deliver Outbox",` 之後加：

```ts
    offline: "offline", unavailable: "not observed", last_updated: "Last updated",
```

- [x] **Step 7: 跑目標測試與全量**

```powershell
Set-Location $F
npx vitest run src/console/unified/runtimeTruth.test.ts
npx tsc --noEmit
npx vitest run
```

預期：`runtimeTruth.test.ts` → `Test Files  1 passed (1)`、`Tests  7 passed`（2 案 cell／cellText／cellSub ＋ 5 案 pickers）；tsc exit 0；全量 `0 failed`，且**既有測試檔的案數與 Task 3a 結束時完全相同**（本 task 沒碰 production 元件，任何既有檔變紅代表 `fixtures.ts` 的 `Dict` 加 key 破壞了型別 → 回 Step 6 核對 zh／en 兩個物件是否都補齊）。

- [x] **Step 8: Commit**

```powershell
Set-Location $W
git add web-viewer-sample/src/console/unified/runtimeTruth.ts web-viewer-sample/src/console/unified/runtimeTruth.test.ts web-viewer-sample/src/console/unified/__testdata__/coordinatorMocks.ts web-viewer-sample/src/console/unified/fixtures.ts docs/superpowers/plans/2026-08-25-unified-console-runtime-truth-s1.md
git diff --cached --check
git commit -m "task#3b: 真值投影純函式 runtimeTruth（cell／pickers／healthOf／lastUpdatedText）＋狀態文案 key＋mock builders" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

#### 2C. 殼層 `UnifiedShell` 綁真值（頂列四 chip、GPU chip 移除 `82%`、側欄 badge、provider 注入）＋ 5.1 同步翻轉（tasks 1.7、5.1）（原 Task 3c）

**Scope（單一）：** 殼層這一次行為改變——「UnifiedConsole 從 fixture-first 改為經共用 poller 讀真值」——以及它自己的回歸護欄。

**為何 5.1 不再拆成另一個 commit：** 現況 `web-viewer-sample/src/console/EdgeConsole.sharedstatus.test.tsx:67` 是 `expect(spy).not.toHaveBeenCalled();`，逐字凍結「UnifiedConsole fixture-first：不打 /api/runtime/status」。殼層一旦改用共用 poller，這一行**當場**變紅；把 5.1 挪到後續 commit 會讓本 commit 帶紅燈，違反 Global Constraints「每個 task 結尾…該 task 的目標測試綠」。5.1 就是本次行為改變的回歸護欄，與殼層同一個 scope，必須同 commit。與此相對，先前版本 Step 10 的「四檔 spy sweep」與本 scope 無關，已抽成 Task 3a；純函式投影層已抽成 Task 3b。

**Files:**
- Modify: `web-viewer-sample/src/console/unified/UnifiedShell.tsx`（整檔重寫；provider seeds 本 task 仍保留，Task 7 再縮）
- Test: `web-viewer-sample/src/console/unified/topbarGpuChip.test.tsx`（新）
- Modify: `web-viewer-sample/src/console/EdgeConsole.sharedstatus.test.tsx`（5.1：整檔重寫）

**前置：** Task 3a（既有測試已補 spy）、Task 3b（`runtimeTruth.ts`、`fixtures.ts` 三個 key、`coordinatorMocks` builders 均已在樹上）。前置未完成就開工，Step 6 的全量會出現與本 task 無關的紅燈，無法定位。

- [x] **Step 1: impact 分析**

```powershell
Set-Location $W
npx gitnexus@1.6.9 impact UnifiedShell -d upstream -r AI-BIM-governance
npx gitnexus@1.6.9 impact UnifiedStateProvider -d upstream -r AI-BIM-governance
```

預期：皆 LOW（唯一上游為 `EdgeConsole.tsx:renderUnified`）。CRITICAL → 停下回報 coordinator；HIGH → 把 blast radius 記入本步驟註記（供 PR body 補強段）後**續行，不停**（spec-to-done skill：HIGH 非停下點；coordinator 2026-08-25 已追認 `jsonGet` HIGH 的前例）。

- [x] **Step 2: 寫失敗測試 `topbarGpuChip.test.tsx`**

```tsx
// unified-console-runtime-truth slice 1（tasks 1.7）：頂列 GPU chip 綁 /api/runtime/status（盤點：無 GPU 欄位→「GPU 未取得」；
// 離線→「GPU —」；其他非 2xx→狀態碼）；Coordinator／Governance／Kit chip 與側欄轉檔 badge 亦為真值；殼層原始碼不含字面 82%。
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EdgeConsole from "../EdgeConsole";
import { CoordinatorHttpError } from "../coordinatorClient";
import { coordinatorStatusStore } from "./coordinatorStatusStore";
import { conversionRecord, spyCoordinatorEndpoints, spyCoordinatorEndpointsOffline } from "./__testdata__/coordinatorMocks";

describe("UnifiedShell 頂列 chips 與側欄 badge（真值）", () => {
  let container: HTMLDivElement;
  let prevHash: string;
  let root: Root | null;
  beforeEach(() => {
    (globalThis as Record<string, unknown>)["IS_REACT_ACT_ENVIRONMENT"] = true;
    container = document.createElement("div"); document.body.appendChild(container);
    prevHash = window.location.hash; root = null;
    coordinatorStatusStore.reset();
  });
  afterEach(async () => {
    if (root) await act(async () => { root!.unmount(); });
    document.body.removeChild(container); vi.restoreAllMocks(); window.location.hash = prevHash;
  });
  async function mountAt(hash: string) {
    window.location.hash = hash;
    root = createRoot(container);
    await act(async () => { root!.render(<EdgeConsole />); });
    for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve(); });
  }
  const uc = (id: string) => container.querySelector<HTMLElement>(`[data-uc="${id}"]`)!;

  it("live：無 GPU 欄位 → 「GPU 未取得」unavailable；三 chip ok；badge＝running+failed", async () => {
    spyCoordinatorEndpoints({ conversionRecords: { count: 3, items: [conversionRecord("a", "converting"), conversionRecord("b", "failed"), conversionRecord("c", "ready")] } });
    await mountAt("#home");
    expect(uc("chip-gpu").textContent).toBe("GPU 未取得");
    expect(uc("chip-gpu").getAttribute("data-state")).toBe("unavailable");
    expect(uc("chip-coordinator").getAttribute("data-health")).toBe("ok");
    expect(uc("chip-coordinator").textContent).toContain("Coordinator OK");
    expect(uc("chip-governance").getAttribute("data-health")).toBe("ok");
    expect(uc("chip-kit").getAttribute("data-health")).toBe("ok");
    expect(uc("nav-pipe-badge").textContent).toBe("2");
    expect(uc("nav-pipe-badge").getAttribute("data-state")).toBe("live");
    expect(container.querySelector('[data-uc="page-root"]')).not.toBeNull();
    expect(container.innerHTML).not.toContain("82%");
  });

  it("offline（十端點 503）：「GPU —」offline；三 chip unknown＋未連線；badge —", async () => {
    spyCoordinatorEndpointsOffline();
    await mountAt("#home");
    expect(uc("chip-gpu").textContent).toBe("GPU —");
    expect(uc("chip-gpu").getAttribute("data-state")).toBe("offline");
    for (const id of ["chip-coordinator", "chip-governance", "chip-kit"]) {
      expect(uc(id).getAttribute("data-health"), id).toBe("unknown");
      expect(uc(id).textContent, id).toContain("未連線");
    }
    expect(uc("nav-pipe-badge").textContent).toBe("—");
    expect(uc("nav-pipe-badge").getAttribute("data-state")).toBe("offline");
  });

  it("error（runtime/status 500）：Coordinator chip degraded 顯示 500；GPU chip「GPU 500」", async () => {
    spyCoordinatorEndpoints({ runtimeStatus: new CoordinatorHttpError("/api/runtime/status", 500, "boom") });
    await mountAt("#home");
    expect(uc("chip-coordinator").getAttribute("data-health")).toBe("degraded");
    expect(uc("chip-coordinator").textContent).toContain("500");
    expect(uc("chip-gpu").textContent).toBe("GPU 500");
    expect(uc("chip-gpu").getAttribute("data-state")).toBe("error");
  });

  it("殼層原始碼不含字面 82%／GPU/Stream", () => {
    const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "UnifiedShell.tsx"), "utf8");
    expect(src).not.toContain("82%");
    expect(src).not.toContain("GPU/Stream");
  });
});
```

- [x] **Step 3: 跑新測試確認失敗（紅燈）**

```powershell
Set-Location $F
npx vitest run src/console/unified/topbarGpuChip.test.tsx
```

預期：四案全失敗——前三案 `chip-gpu` 為 null（`Cannot read properties of null`），第四案原始碼仍含 `82%`。此時 `EdgeConsole.sharedstatus.test.tsx` 尚未動、仍為綠（殼層還沒改）。

- [x] **Step 4: 整檔重寫 `UnifiedShell.tsx`**（provider seeds 暫留；Task 7 再縮）

```tsx
// ═══════════════════════════════════════════════════════════════════════
// UnifiedConsole — 殼層（頂列 + 側欄 + Toast host + state provider）
// 像素級移植正本：scratchpad/design-origin/app.js（topbar / sidebar / toast 區塊）
// unified-console-runtime-truth slice 1：頂列狀態 chips（Coordinator／Governance／Kit Runtime／GPU）與側欄
// 「模型資料與轉檔」badge 改綁 coordinator :8004 真值（共用 poller，ConsoleDataProvider 注入 live 單例）；
// 字面 GPU chip 已移除。導覽一律 window.location.hash 賦值。
// data-uc / data-active / data-state / data-health 屬性為 design gate semantic contract 與 vitest 定位用，像素中性。
// ═══════════════════════════════════════════════════════════════════════
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from "react";
import type { CSSProperties, ReactNode } from "react";
import { setLang, useLang } from "../i18n";
import {
  MONO, getL, navMain, apps, badgeTone, navItem,
  initialIntake, initialConv, initialSessions, initialOutbox, initialIssues, INITIAL_ISSUE_SEQ,
} from "./fixtures";
import type {
  ConceptKey, ConvItem, DockKey, IntakeItem, IssueItem, OutboxItem, PageKey, SessionItem,
} from "./fixtures";
import { ConsoleDataProvider, useConsoleData } from "./ConsoleDataProvider";
import { coordinatorStatusStore } from "./coordinatorStatusStore";
import type { EndpointKey } from "./coordinatorStatusStore";
import { HEALTH_DOT, cell, cellText, conversionCounts, healthOf } from "./runtimeTruth";
import type { HealthState } from "./runtimeTruth";
import "./unified.css";

/* ═══ UnifiedState context（conv/intake/sessions/outbox/issues fixture + toast）═══ */

export interface UnifiedStateShape {
  intake: IntakeItem[];
  conv: ConvItem[];
  sessions: SessionItem[];
  outbox: OutboxItem[];
  issues: IssueItem[];
  issueSeq: number;
}

export interface UnifiedStateApi extends UnifiedStateShape {
  /** setState 類 API：淺合併 patch（對應原型 setState(patch)）。 */
  patch: (p: Partial<UnifiedStateShape>) => void;
  /** 顯示 toast，2600ms 自動消失；重複呼叫重置計時器。 */
  toast: (msg: string) => void;
  toastMsg: string;
}

const UnifiedStateContext = createContext<UnifiedStateApi | null>(null);

export function useUnifiedState(): UnifiedStateApi {
  const v = useContext(UnifiedStateContext);
  if (!v) throw new Error("useUnifiedState must be used within UnifiedStateProvider");
  return v;
}

export function UnifiedStateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<UnifiedStateShape>(() => ({
    intake: [...initialIntake],
    conv: [...initialConv],
    sessions: [...initialSessions],
    outbox: [...initialOutbox],
    issues: [...initialIssues],
    issueSeq: INITIAL_ISSUE_SEQ,
  }));
  const [toastMsg, setToastMsg] = useState("");
  const toastTimer = useRef<number | null>(null);

  const toast = useCallback((msg: string) => {
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    setToastMsg(msg);
    toastTimer.current = window.setTimeout(() => { setToastMsg(""); }, 2600);
  }, []);

  useEffect(() => () => {
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
  }, []);

  const patch = useCallback((p: Partial<UnifiedStateShape>) => {
    setState((s) => ({ ...s, ...p }));
  }, []);

  const value = useMemo<UnifiedStateApi>(
    () => ({ ...state, patch, toast, toastMsg }),
    [state, patch, toast, toastMsg],
  );

  return <UnifiedStateContext.Provider value={value}>{children}</UnifiedStateContext.Provider>;
}

/* ═══ 殼層 ═══ */

export interface UnifiedShellProps {
  /** 當前 hash route 對應的頁面 key（active 判定用）。 */
  page: PageKey;
  /** page="ws" 時的 dock tab（A1–A4 / issues 的 active 判定）。 */
  dock?: DockKey;
  /** page="concept" 時的概念頁 key（A5–A10 的 active 判定）。 */
  concept?: ConceptKey;
  children?: ReactNode;
}

/** 殼層自身訂閱的端點（頂列三 chip、GPU chip、側欄轉檔 badge）。模組層常數：identity 穩定。 */
const SHELL_KEYS: readonly EndpointKey[] = ["runtimeStatus", "ruleRuns", "kitHealth", "conversionRecords"];

export function UnifiedShell(props: UnifiedShellProps) {
  return (
    <ConsoleDataProvider store={coordinatorStatusStore}>
      <UnifiedStateProvider>
        <ShellFrame {...props} />
      </UnifiedStateProvider>
    </ConsoleDataProvider>
  );
}

const chipBase: CSSProperties = { display: "flex", alignItems: "center", gap: 6, padding: "5px 10px", borderRadius: 999, fontSize: 11 };
const chipByHealth: Record<HealthState, CSSProperties> = {
  ok: { ...chipBase, background: "rgba(49,197,109,.10)", border: "1px solid rgba(49,197,109,.25)", color: "var(--ab-ok-text)" },
  degraded: { ...chipBase, background: "rgba(232,97,92,.10)", border: "1px solid rgba(232,97,92,.3)", color: "var(--ab-danger)" },
  unknown: { ...chipBase, background: "rgba(230,178,62,.08)", border: "1px solid rgba(230,178,62,.3)", color: "var(--ab-warn)" },
};
const chipUnavailable: CSSProperties = { ...chipBase, background: "rgba(120,160,210,.06)", border: "1px solid rgba(120,160,210,.14)", color: "var(--ab-text-dim)", fontFamily: MONO };

function ShellFrame({ page, dock, concept, children }: UnifiedShellProps) {
  const lang = useLang();
  const zh = lang === "zh";
  const L = getL(zh);
  const { toastMsg } = useUnifiedState();
  const snap = useConsoleData(SHELL_KEYS);

  /* body.uc-body：html/body 級樣式（背景/overflow/字體）由殼層掛載切換 */
  useEffect(() => {
    document.body.classList.add("uc-body");
    return () => { document.body.classList.remove("uc-body"); };
  }, []);

  const nav = (hash: string) => { window.location.hash = hash; };

  /* ---- 頂列狀態 chips（真值；design §3.3 頂列 GPU chip 列）---- */
  const coordinatorHealth = healthOf(snap.runtimeStatus, (rt) => rt.service.status !== "ok");
  const governanceHealth = healthOf(snap.ruleRuns);
  const kitHealth = healthOf(snap.kitHealth);
  // 盤點（tasks 1.2）：/api/runtime/status 無 GPU 使用率欄位 → live 即「未取得」；不讀任何臆測欄位、不捏造。
  const gpu = cell(snap.runtimeStatus, () => null);
  const healthText = (h: HealthState, httpStatus: number | null) =>
    h === "ok" ? "OK" : h === "degraded" ? (httpStatus === null ? "degraded" : String(httpStatus)) : L.offline;
  const chip = (uc: string, label: string, h: HealthState, httpStatus: number | null) => (
    <div data-uc={uc} data-health={h} style={chipByHealth[h]}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: HEALTH_DOT[h] }} />{label} {healthText(h, httpStatus)}
    </div>
  );
  const gpuText = gpu.state === "unavailable" ? `GPU ${L.unavailable}` : gpu.state === "error" ? `GPU ${gpu.httpStatus ?? "error"}` : "GPU —";
  const gpuStyle: CSSProperties = gpu.state === "unavailable"
    ? chipUnavailable
    : { ...chipByHealth[gpu.state === "error" ? "degraded" : "unknown"], fontFamily: MONO };

  const topbar = (
    <div style={{ display: "flex", alignItems: "center", gap: 14, height: 56, padding: "0 16px", background: "var(--ab-bar)", borderBottom: "1px solid rgba(120,160,210,.12)", flex: "none" }}>
      <div onClick={() => nav("#home")} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
        <div style={{ width: 30, height: 30, borderRadius: 8, background: "radial-gradient(circle at 35% 35%,rgba(65,199,232,.9),rgba(47,123,246,.55) 60%,rgba(10,16,24,.2))", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: MONO, fontWeight: 600, fontSize: 13, color: "var(--ab-on-accent)" }}>⬡</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: ".01em", whiteSpace: "nowrap" }}>AI-BIM-governance</span>
          <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: ".1em", color: "var(--ab-text-dim)", textTransform: "uppercase" }}>{L.sub}</span>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--ab-surface)", border: "1px solid rgba(120,160,210,.12)", borderRadius: 9, padding: "7px 12px", width: 300 }}>
        <span style={{ color: "var(--ab-text-dim)", fontSize: 12 }}>⌕</span>
        <input placeholder={L.search} style={{ background: "none", border: "none", outline: "none", color: "var(--ab-text)", fontSize: "12.5px", fontFamily: "inherit", flex: 1 }} />
        <span style={{ fontFamily: MONO, fontSize: "9.5px", color: "var(--ab-text-dimmer)", border: "1px solid rgba(120,160,210,.14)", borderRadius: 4, padding: "1px 5px" }}>⌘K</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--ab-surface)", border: "1px solid rgba(120,160,210,.12)", borderRadius: 9, padding: "7px 12px", cursor: "pointer" }}>
        <span style={{ fontSize: 11, color: "var(--ab-text-dim)" }}>{L.project}</span>
        <span style={{ fontSize: "12.5px", fontWeight: 500, whiteSpace: "nowrap" }}>Demo Project – A1 Tower</span>
        <span style={{ color: "var(--ab-text-dim)", fontSize: 10 }}>▾</span>
      </div>
      <div style={{ flex: 1 }} />
      <div data-prov="asbuilt" style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {chip("chip-coordinator", "Coordinator", coordinatorHealth, snap.runtimeStatus.httpStatus)}
        {chip("chip-governance", "Governance", governanceHealth, snap.ruleRuns.httpStatus)}
        {chip("chip-kit", "Kit Runtime", kitHealth, snap.kitHealth.httpStatus)}
        <div data-uc="chip-gpu" data-state={gpu.state} style={gpuStyle}>{gpuText}</div>
      </div>
      <div onClick={() => setLang(zh ? "en" : "zh")} style={{ display: "flex", alignItems: "center", gap: 0, border: "1px solid rgba(120,160,210,.16)", borderRadius: 8, overflow: "hidden", cursor: "pointer", fontFamily: MONO, fontSize: "10.5px" }}>
        <span data-uc="lang-zh" data-active={zh ? "true" : "false"} style={zh ? { padding: "4px 9px", background: "rgba(65,199,232,.16)", color: "var(--ab-accent-bright)" } : { padding: "4px 9px", color: "var(--ab-text-dim)" }}>中</span>
        <span data-uc="lang-en" data-active={!zh ? "true" : "false"} style={!zh ? { padding: "4px 9px", background: "rgba(65,199,232,.16)", color: "var(--ab-accent-bright)" } : { padding: "4px 9px", color: "var(--ab-text-dim)" }}>EN</span>
      </div>
      <span style={{ color: "var(--ab-text-muted)", fontSize: 15, cursor: "pointer" }}>◔</span>
      <div style={{ width: 32, height: 32, borderRadius: "50%", background: "linear-gradient(135deg,var(--ab-accent-2),var(--ab-accent))", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11.5px", fontWeight: 700, color: "var(--ab-on-accent)" }}>AD</div>
    </div>
  );

  /* ---- sidebar（導覽設定來自 fixtures；A1–A4 badge 文字仍為 fixture，§2.3 承接；轉檔 badge 為真值）---- */
  const convBadge = cell(snap.conversionRecords, (r) => {
    const c = conversionCounts(r);
    return c === null ? null : c.running + c.failed;
  });
  const sidebar = (
    <div data-prov="fixture" style={{ width: 212, flex: "none", background: "var(--ab-bar)", borderRight: "1px solid rgba(120,160,210,.10)", padding: "14px 10px 10px", display: "flex", flexDirection: "column", gap: 16, overflow: "auto" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: ".12em", color: "var(--ab-text-dimmer)", textTransform: "uppercase", padding: "0 10px 6px" }}>{L.g_work}</span>
        {navMain.map((n) => (
          <div key={n.id} className="hv-bg" data-uc={"nav-" + n.id} data-active={page === n.id ? "true" : "false"} style={navItem(page === n.id)} onClick={() => nav(n.hash)}>
            <span style={{ width: 16, textAlign: "center", fontSize: 12, opacity: 0.85 }}>{n.icon}</span>
            <span style={{ flex: 1, fontSize: "12.5px" }}>{L[n.labelKey]}</span>
            {n.id === "pipe" ? <span data-uc="nav-pipe-badge" data-prov="asbuilt" data-state={convBadge.state} style={badgeTone("warn")}>{cellText(convBadge, L)}</span> : null}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: ".12em", color: "var(--ab-text-dimmer)", textTransform: "uppercase", padding: "0 10px 6px" }}>{L.g_apps}</span>
        {apps.map((a) => {
          const active = (page === "ws" && dock === a.code.toLowerCase()) || (page === "concept" && concept === a.code.toLowerCase());
          return (
            <div key={a.code} className="hv-bg" data-uc={"app-" + a.code.toLowerCase()} data-active={active ? "true" : "false"} style={navItem(active)} onClick={() => nav(a.hash)}>
              <span style={{ width: 26, fontFamily: MONO, fontSize: 10, color: "var(--ab-text-code)" }}>{a.code}</span>
              <span style={{ flex: 1, fontSize: 12 }}>{zh ? a.labelZh : a.labelEn}</span>
              <span style={badgeTone(a.tone)}>{a.badge}</span>
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
        {/* href 佔位（正本 design-doc.html 不隨產品打包；baseline 只驗外觀） */}
        <a href="#" target="_blank" rel="noreferrer" className="hv-doc" style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 10px", border: "1px solid rgba(120,160,210,.14)", borderRadius: 9, fontSize: "11.5px", color: "var(--ab-text-muted)", textDecoration: "none" }}>
          <span>▦</span><span>{L.designdoc}</span><span style={{ marginLeft: "auto", fontSize: 10 }}>↗</span>
        </a>
        <div data-uc="runtime-note" style={{ fontFamily: MONO, fontSize: "8.5px", color: "var(--ab-text-ghost)", padding: "0 4px" }}>:8004/ui · UnifiedConsole</div>
      </div>
    </div>
  );

  /* ---- toast host ---- */
  const toastHost = toastMsg ? (
    <div data-uc="toast" style={{ position: "fixed", bottom: 26, left: "50%", transform: "translateX(-50%)", background: "var(--ab-raised)", border: "1px solid rgba(65,199,232,.4)", borderRadius: 10, padding: "10px 18px", fontSize: "12.5px", color: "var(--ab-text)", boxShadow: "0 12px 40px rgba(0,0,0,.5)", animation: "tup .18s ease-out", display: "flex", alignItems: "center", gap: 9, zIndex: 99 }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--ab-accent)" }} />
      <span style={{ fontFamily: MONO, fontSize: "11.5px" }}>{toastMsg}</span>
    </div>
  ) : null;

  return (
    <div className="uc-root" style={{ display: "flex", flexDirection: "column", height: "100vh", minWidth: 1360, color: "var(--ab-text)", fontSize: 14, background: "var(--ab-bg)" }}>
      {topbar}
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {sidebar}
        <div data-uc="page-root" style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
          {children}
        </div>
      </div>
      {toastHost}
    </div>
  );
}
```

> **實跑偏離（implementer 2026-08-25 補記；待 coordinator 事後追認）**：上列 `coordinatorHealth` 一行逐字實作後，全量 vitest 在本 Step 全量檢查點出現 1 個既有測試回歸——`EdgeConsole.aliasRedirect.test.tsx`「malformed higher-priority session values do not erase a valid stored session」（該案以 `vi.mocked(coordinatorClient.runtimeStatus).mockResolvedValue({ sessions: {...} } as never)` 故意餵入缺 `service` 欄位的簡化 payload 測試 session/hash 邏輯，與本 task 的 chip 綁定無關；該檔在 Task 3a 只被列管兩處逐字 patch，此案不在列管清單內）。經 `healthOf(snap.runtimeStatus, (rt) => rt.service.status !== "ok")` 讀取 `rt.service.status` 時因 `rt.service` 為 `undefined` 而 throw `TypeError`，`ShellFrame` 整棵樹炸掉。已改為防禦性讀取 `rt.service?.status !== "ok"`（產出程式碼區塊已反映此版本；差異只在該行加 `?.` 與其上方三行註解）。`RuntimeStatus.service` 型別本身非 optional（後端契約保證必存在），故此為容錯既有測試的簡化 mock，不改變任何真實／完整 payload 的健康判定。**同樣的 `d.service.status`（無 `?.`）模式亦逐字出現於本 plan 檔 Task 3（HomePage 重寫，`grep -n "service.status"` 命中該行）**——若該處沿用相同 unguarded 寫法，遇到同類「缺 service 的簡化 mock＋approved 路由掛載」測試會重現同一崩潰；已於本次 StructuredOutput 的 concerns 提醒 coordinator，供指派 Task 3 時參考（是否要求 Task 3 同步防禦或改測試 mock，由 coordinator 裁決）。全量 vitest 於此修正後綠（85 files／1156 tests，與 Step 6 預期的 Task 3b＋1 file／＋4 tests 完全吻合）。

- [x] **Step 5: 5.1 翻轉——整檔重寫 `EdgeConsole.sharedstatus.test.tsx`**（Step 4 完成後立刻做，同一個 commit）

```tsx
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EdgeConsole from "./EdgeConsole";
import { coordinatorClient } from "./coordinatorClient";
import { coordinatorStatusStore } from "./unified/coordinatorStatusStore";
import { RT_IDLE, spyCoordinatorEndpoints } from "./unified/__testdata__/coordinatorMocks";

// IA v2 雙殼：SharedStatusRail（含 SharedStatusProvider 的 5000ms 輪詢）是 legacy 殼專屬；
// approved 鍵 {home,a1..a10,pipeline,runtime} 走 UnifiedShell。
// unified-console-runtime-truth（5.1）：UnifiedShell 不再 fixture-first——#home 經共用 poller 呼叫 runtimeStatus，
// 殼層與 HomePage 同訂閱同一端點時仍只有一個 in-flight（同一輪恰一個請求）。
describe("EdgeConsole shared status polling（legacy rail 一次；unified 共用 poller 單一 in-flight）", () => {
  let container: HTMLDivElement;
  let prevHash: string;
  beforeEach(() => {
    (globalThis as Record<string, unknown>)["IS_REACT_ACT_ENVIRONMENT"] = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    prevHash = window.location.hash;
    coordinatorStatusStore.reset();
  });
  afterEach(() => {
    document.body.removeChild(container);
    vi.restoreAllMocks();
    window.location.hash = prevHash;
  });

  it("legacy 路由（#sessions）：renders the rail and polls runtimeStatus once for the whole console", async () => {
    window.location.hash = "#sessions";
    const spy = vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue(RT_IDLE);
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 0, items: [] });
    const root = createRoot(container);
    await act(async () => { root.render(<EdgeConsole />); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(container.querySelector('[data-testid="shared-status-rail"]')).not.toBeNull();
    // SessionManagementPage also fetches runtimeStatus once on mount; the provider adds exactly one
    // more. The rail must not multiply polling per page — assert provider poll count stays bounded
    // (<= 2: page mount + provider).
    expect(spy.mock.calls.length).toBeLessThanOrEqual(2);

    await act(async () => { root.unmount(); });
  });

  it("approved 路由（#home）：UnifiedShell 不渲染 rail；runtimeStatus 經共用 poller 恰呼叫一次（殼層＋Home 同訂閱＝單一 in-flight）", async () => {
    window.location.hash = "#home";
    const spies = spyCoordinatorEndpoints();
    const root = createRoot(container);
    await act(async () => { root.render(<EdgeConsole />); });
    for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve(); });

    // 確認真的渲染了 UnifiedShell（非空白誤判）：側欄 footer 簽名存在。
    expect(container.innerHTML).toContain(":8004/ui · UnifiedConsole");
    // approved 鍵不掛 SharedStatusRail（rail 是 legacy 殼專屬）。
    expect(container.querySelector('[data-testid="shared-status-rail"]')).toBeNull();
    // 共用 poller：同端點同一輪只有一個請求（殼層 SHELL_KEYS 與 HomePage 都訂閱 runtimeStatus）。
    expect(spies.runtimeStatus).toHaveBeenCalledTimes(1);
    expect(spies.getConversionRecords).toHaveBeenCalledTimes(1);
    expect(spies.getConversionRecords).toHaveBeenCalledWith(100);
    expect(spies.getCallbackOutboxSummary).toHaveBeenCalledWith(200);

    await act(async () => { root.unmount(); });
  });
});
```

（本 task 時 HomePage 尚未訂閱 store，第二案的 `getCallbackOutboxSummary` 斷言會失敗——**Task 4 完成後才綠**；本 task 結尾只要求前兩個 `expect` 與 `runtimeStatus` 恰一次成立。為避免 Task 3c commit 帶紅燈，本 task 先把 `getCallbackOutboxSummary` 那行寫成 `expect(spies.getCallbackOutboxSummary).toHaveBeenCalledTimes(0);` 並加註 `// Task 4 改為 toHaveBeenCalledWith(200)`，Task 4 Step 6 再改回。）

- [x] **Step 6: 跑目標測試與全量**

```powershell
Set-Location $F
npx vitest run src/console/unified/topbarGpuChip.test.tsx src/console/EdgeConsole.sharedstatus.test.tsx
npx tsc --noEmit
npx vitest run
```

預期：兩檔 `Test Files  2 passed (2)`、`Tests  6 passed`（topbarGpuChip 4 案＋sharedstatus 2 案）；tsc exit 0；全量 `0 failed`，測試檔數 = Task 3b 結束時 ＋1（`topbarGpuChip.test.tsx`）。

定位提示（紅燈時先看是哪一類，不要亂改）：

| 症狀 | 最可能原因 | 處置 |
|---|---|---|
| `unified.test.tsx` 或其他 SSR 測試出現 `getServerSnapshot` 相關錯誤 | `useCoordinatorStatus` 第三參數漏傳 | 回 Task 2 Step 4 核對 |
| `dockLiveLink`／`a1DockLive`／`aliasRedirect` 變紅或噴真網路錯誤 | Task 3a 的 sweep 沒做完或 patch 插錯位置 | 回 Task 3a 對應 Step 的檢查點，不要在本 task 內改那三個檔 |
| `sharedstatus` 第二案 `runtimeStatus` 不是恰一次 | 殼層與頁面各自建 store（未走 `ConsoleDataProvider` 單例） | 回 Step 4 核對 `UnifiedShell` 是否以 `coordinatorStatusStore` 注入 |

- [x] **Step 7: Commit**

```powershell
Set-Location $W
git add web-viewer-sample/src/console/unified/UnifiedShell.tsx web-viewer-sample/src/console/unified/topbarGpuChip.test.tsx web-viewer-sample/src/console/EdgeConsole.sharedstatus.test.tsx docs/superpowers/plans/2026-08-25-unified-console-runtime-truth-s1.md
git diff --cached --check
git commit -m "task#3c: UnifiedShell 頂列 chips／GPU chip／側欄 badge 綁真值（移除字面 82%），注入共用 poller；5.1 同步翻轉" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---


---

### Task 3: `#home`＋`#pipeline` 真值綁定（tasks 1.4、1.5＋5.3）

> 本 task 由多個原 task 併成（額度／commit 錨點考量，coordinator 2026-08-25）：各子段（#### nA／nB…）的步驟、驗證與 commit 指令**逐字照做**，每段結尾的 commit 都要做；本 task 所有 commit message 一律以「task#<本 task 在 implementer 提示中的 index>: 」開頭再接原訊息。子段標題括號內的「原 Task N」對應文中所有「Task N Step M」的引用。

#### 3A. `#home` 四 KPI＋六 svc-dot 真值綁定（tasks 1.4）＋ 5.3 的 home 斷言（原 Task 4）

**Files:**
- Create: `web-viewer-sample/src/console/unified/ServiceHealthList.tsx`（Home／Ops 共用）
- Modify: `web-viewer-sample/src/console/unified/HomePage.tsx`（整檔重寫）
- Test: `web-viewer-sample/src/console/unified/homeLiveBinding.test.tsx`（新）
- Modify: `web-viewer-sample/src/console/unified/unified.test.tsx`（`#home` 案＋誠實標記契約案）
- Modify: `web-viewer-sample/src/console/EdgeConsole.sharedstatus.test.tsx`（改回 `toHaveBeenCalledWith(200)`）

- [ ] **Step 1: impact 分析**

```powershell
Set-Location $W
npx gitnexus@1.6.9 impact "Function:web-viewer-sample/src/console/unified/HomePage.tsx:HomePage" -d upstream -r AI-BIM-governance
```

預期 LOW（caller 只有 `renderUnified`）。

- [ ] **Step 2: 寫失敗測試 `homeLiveBinding.test.tsx`**

```tsx
// unified-console-runtime-truth slice 1（tasks 1.4）：#home 四 KPI＋六 svc-dot 綁真值；live／offline／unavailable／error 四態；
// KPI 卡為 data-action="nav"；fixture 固定值不得出現。
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EdgeConsole from "../EdgeConsole";
import { CoordinatorHttpError } from "../coordinatorClient";
import { coordinatorStatusStore } from "./coordinatorStatusStore";
import { RT_IDLE, conversionRecord, outboxEntries, spyCoordinatorEndpoints, spyCoordinatorEndpointsOffline } from "./__testdata__/coordinatorMocks";

describe("HomePage 真值綁定", () => {
  let container: HTMLDivElement;
  let prevHash: string;
  let root: Root | null;
  beforeEach(() => {
    (globalThis as Record<string, unknown>)["IS_REACT_ACT_ENVIRONMENT"] = true;
    container = document.createElement("div"); document.body.appendChild(container);
    prevHash = window.location.hash; root = null;
    coordinatorStatusStore.reset();
  });
  afterEach(async () => {
    if (root) await act(async () => { root!.unmount(); });
    document.body.removeChild(container); vi.restoreAllMocks(); window.location.hash = prevHash;
  });
  async function mountHome() {
    window.location.hash = "#home";
    root = createRoot(container);
    await act(async () => { root!.render(<EdgeConsole />); });
    for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve(); });
  }
  const uc = (id: string) => container.querySelector<HTMLElement>(`[data-uc="${id}"]`)!;
  const FIXTURE_LITERALS = ["990_model.ifc", "62%", "S-240601", "rule-run #88", "2026-07-14", "OB-201", "editor lease 1"];

  it("live（spec scenario「Home KPI 與 API 對照」）：0／0／0／36，皆 asbuilt＋live；attempts 0/5；svc-dot ×6；無 fixture 固定值", async () => {
    spyCoordinatorEndpoints({
      runtimeStatus: { ...RT_IDLE, sessions: { count: 0, active_count: 0, participant_count: 0, items: [] } },
      conversionRecords: { count: 12, items: Array.from({ length: 12 }, (_, i) => conversionRecord(`k${i}`, "ready")) },
      issues: { issues: [] },
      outboxSummary: { total: 36, limit: 200, entries: outboxEntries(36, 0, 5) },
      minioWatch: { enabled: true, bucket: "bim-control", baseline_count: 12, seen_count: 12, triggered_total: 0 },
    });
    await mountHome();
    for (const [id, text] of [["kpi-conv-val", "0"], ["kpi-sess-val", "0"], ["kpi-issue-val", "0"], ["kpi-outbox-val", "36"]] as const) {
      expect(uc(id).textContent, id).toBe(text);
      expect(uc(id).getAttribute("data-prov"), id).toBe("asbuilt");
      expect(uc(id).getAttribute("data-state"), id).toBe("live");
    }
    expect(uc("kpi-conv-sub").textContent).toBe("ready 12 · failed 0");
    expect(uc("kpi-outbox-sub").textContent).toBe("attempts 0/5");
    expect(container.querySelectorAll('[data-uc="svc-dot"]').length).toBe(6);
    expect(container.querySelectorAll('[data-uc="svc-dot"][data-health="ok"]').length).toBe(4); // coordinator／governance／kit-manager／MinIO watch
    expect(container.querySelectorAll('[data-uc="svc-dot"][data-health="unknown"]').length).toBe(2); // conversion authority／Kit signaling：無探測端點
    expect(uc("last-updated").textContent).toMatch(/最後更新 \d{2}:\d{2}:\d{2}/);
    for (const lit of FIXTURE_LITERALS) expect(container.innerHTML, lit).not.toContain(lit);
  });

  it("offline（十端點 503；spec scenario「後端不可達時誠實未連線」）：KPI 皆 —／offline／未連線；最後更新 —；svc-dot 全 unknown", async () => {
    spyCoordinatorEndpointsOffline();
    await mountHome();
    for (const id of ["kpi-conv", "kpi-sess", "kpi-issue", "kpi-outbox"]) {
      expect(uc(id + "-val").textContent, id).toBe("—");
      expect(uc(id + "-val").getAttribute("data-state"), id).toBe("offline");
      expect(uc(id + "-sub").textContent, id).toBe("未連線");
    }
    expect(uc("last-updated").textContent).toBe("最後更新 —");
    expect(container.querySelectorAll('[data-uc="svc-dot"][data-health="unknown"]').length).toBe(6);
    expect(container.innerHTML).not.toContain('data-state="live"');
  });

  it("unavailable：conversion records 回傳窗截斷（count > items.length）→「未取得」，不對子集算數", async () => {
    spyCoordinatorEndpoints({ conversionRecords: { count: 101, items: Array.from({ length: 100 }, (_, i) => conversionRecord(`k${i}`, "ready")) } });
    await mountHome();
    expect(uc("kpi-conv-val").textContent).toBe("未取得");
    expect(uc("kpi-conv-val").getAttribute("data-state")).toBe("unavailable");
  });

  it("error：governance issues 500 → KPI 顯示狀態碼 500＋後端訊息，不顯示 0", async () => {
    spyCoordinatorEndpoints({ issues: new CoordinatorHttpError("/api/governance/issues", 500, "governance_unreachable") });
    await mountHome();
    expect(uc("kpi-issue-val").textContent).toBe("500");
    expect(uc("kpi-issue-val").getAttribute("data-state")).toBe("error");
    expect(uc("kpi-issue-sub").textContent).toContain("governance_unreachable");
  });

  it("KPI 卡為 data-action=nav：點「活躍 Sessions」導向 #sessions", async () => {
    spyCoordinatorEndpoints();
    await mountHome();
    expect(uc("kpi-sess").getAttribute("data-action")).toBe("nav");
    await act(async () => { uc("kpi-sess").dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(window.location.hash).toBe("#sessions");
  });
});
```

- [ ] **Step 3: 跑測試確認失敗**

```powershell
Set-Location $F
npx vitest run src/console/unified/homeLiveBinding.test.tsx
```

預期：`Tests  5 failed (5)`（`kpi-conv-val` 存在但文字為 fixture `1`；`kpi-conv-sub` 為 null 等）。

- [ ] **Step 4: 建立 `ServiceHealthList.tsx`**

```tsx
// ═══════════════════════════════════════════════════════════════════════
// UnifiedConsole — 服務健康六列（unified-console-runtime-truth design §3.3 svc-dot）
// 只由 /api/runtime/status、/api/kit/health、/api/external/minio-watch/status、/api/governance/rule-runs 的
// 可達性推導 ok／degraded／unknown；沒有探測端點的服務（conversion authority、Kit signaling）誠實標 unknown＋
// 「無探測端點 · 未取得」，port／base_url 只在 runtime/status live 時由 configured_endpoints 顯示，不寫死。
// ═══════════════════════════════════════════════════════════════════════
import { MONO } from "./fixtures";
import type { CoordinatorStatusSnapshot } from "./coordinatorStatusStore";
import { HEALTH_DOT, healthOf } from "./runtimeTruth";
import type { HealthState } from "./runtimeTruth";

export interface ServiceRow { id: string; name: string; detail: string; health: HealthState; }

export function deriveServiceRows(snap: CoordinatorStatusSnapshot, zh: boolean): ServiceRow[] {
  const rt = snap.runtimeStatus.state === "live" ? snap.runtimeStatus.data : null;
  const watch = snap.minioWatch.state === "live" ? snap.minioWatch.data : null;
  const noProbe = zh ? "無探測端點 · 未取得" : "no probe endpoint · not observed";
  return [
    {
      id: "coordinator", name: "bim-review-coordinator",
      detail: rt ? `:${rt.configured_endpoints.coordinator.port}` : "—",
      health: healthOf(snap.runtimeStatus, (d) => d.service.status !== "ok"),
    },
    { id: "governance", name: "governance-service", detail: "/api/governance/* proxy", health: healthOf(snap.ruleRuns) },
    {
      id: "conversion", name: "conversion authority",
      detail: rt && rt.configured_endpoints.conversion_authority.base_url ? `${rt.configured_endpoints.conversion_authority.base_url} · ${noProbe}` : noProbe,
      health: "unknown",
    },
    {
      id: "kit", name: "Kit signaling / WebRTC",
      detail: rt && rt.configured_endpoints.kit.length > 0 ? `signaling :${rt.configured_endpoints.kit[0].signalingPort} · ${noProbe}` : noProbe,
      health: "unknown",
    },
    { id: "kitmgr", name: "kit-manager-api", detail: "/api/kit/health proxy", health: healthOf(snap.kitHealth) },
    {
      id: "minio", name: "MinIO watch",
      detail: watch ? (watch.enabled ? (zh ? "watch 啟用" : "watch enabled") : (zh ? "watch 停用" : "watch disabled")) : "—",
      health: healthOf(snap.minioWatch, (d) => d.enabled !== true),
    },
  ];
}

export function ServiceHealthList({ snap, zh }: { snap: CoordinatorStatusSnapshot; zh: boolean }) {
  return (
    <>
      {deriveServiceRows(snap, zh).map((sv) => (
        <div key={sv.id} data-uc="svc-row" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span data-uc="svc-dot" data-health={sv.health} style={{ width: 7, height: 7, borderRadius: "50%", background: HEALTH_DOT[sv.health], flex: "none" }} />
          <span style={{ fontSize: "11.5px", color: "var(--ab-text-2)", flex: 1 }}>{sv.name}</span>
          <span style={{ fontFamily: MONO, fontSize: 10, color: "var(--ab-text-dim)" }}>{sv.detail}</span>
        </div>
      ))}
    </>
  );
}
```

- [ ] **Step 5: 整檔重寫 `HomePage.tsx`**

```tsx
// ═══════════════════════════════════════════════════════════════════════
// UnifiedConsole — Home（總覽 · Mission Control）
// unified-console-runtime-truth slice 1（tasks 1.4）：四 KPI＋六 svc-dot 綁 coordinator :8004 既有端點（共用 poller）；
// 每值附 data-prov="asbuilt"＋data-state；offline 顯示 —／未連線；無遙測顯示未取得；永不以 0 佔位。
// 版面沿用設計原型（inline style 不改）；KPI 卡為 data-action="nav" 導向真頁；導覽設定／i18n／style helper 仍來自 ./fixtures。
// 應用啟動器的 A1–A4 badge 文字仍為 fixture（tasks §2.3 承接），該區塊維持 data-prov="fixture" 誠實標記。
// ═══════════════════════════════════════════════════════════════════════
import { useLang } from "../i18n";
import { MONO, SHOW_CONCEPT_APPS, getL, apps, appEn, badgeTone, chipBox } from "./fixtures";
import { useConsoleData } from "./ConsoleDataProvider";
import type { EndpointKey } from "./coordinatorStatusStore";
import { ServiceHealthList } from "./ServiceHealthList";
import {
  activeSessions, cell, cellSub, cellText, conversionCounts, lastUpdatedText, openIssueCount, outboxPending, stateColor,
} from "./runtimeTruth";
import type { DataState } from "./runtimeTruth";

const HOME_KEYS: readonly EndpointKey[] = ["runtimeStatus", "ifcReady", "conversionRecords", "issues", "outboxSummary", "ruleRuns", "kitHealth", "minioWatch"];

export function HomePage() {
  const lang = useLang();
  const zh = lang === "zh";
  const L = getL(zh);
  const snap = useConsoleData(HOME_KEYS);

  const nav = (hash: string) => { window.location.hash = hash; };

  /* ---- 真值投影（design §3.3）---- */
  const conv = cell(snap.conversionRecords, conversionCounts);
  const sess = cell(snap.runtimeStatus, (rt) => ({ active: activeSessions(rt), participants: rt.sessions.participant_count }));
  const issue = cell(snap.issues, openIssueCount);
  const outbox = cell(snap.outboxSummary, outboxPending);
  const intake = cell(snap.ifcReady, (r) => r.count);
  const updated = lastUpdatedText([snap.runtimeStatus, snap.conversionRecords, snap.issues, snap.outboxSummary]);

  /* ---- KPI 卡（版面 1:1 原型 kpi(actId,label,val,sub,valColor)；值／副標／data-state 為真值）---- */
  const kpi = (hash: string, label: string, uc: string, state: DataState, val: string, sub: string) => (
    <div className="hv-accent-border" data-uc={uc} data-action="nav" role="link" onClick={() => nav(hash)} style={{ ...chipBox, padding: 16, display: "flex", flexDirection: "column", gap: 6, cursor: "pointer" }}>
      <span style={{ fontFamily: MONO, fontSize: "9.5px", letterSpacing: ".1em", color: "var(--ab-text-dim)", textTransform: "uppercase" }}>{label}</span>
      <span data-uc={uc + "-val"} data-prov="asbuilt" data-state={state} style={{ fontSize: 26, fontWeight: 700, fontFamily: MONO, color: stateColor(state) }}>{val}</span>
      <span data-uc={uc + "-sub"} style={{ fontSize: 11, color: "var(--ab-text-muted)" }}>{sub}</span>
    </div>
  );

  /* ---- pipeSnap 4 步（① INTAKE → ② CONVERT → ③ SESSION → ⑤ OUTBOX；同一份真值）---- */
  const pipeSnap = [
    { step: "① INTAKE", uc: "snap-intake", state: intake.state, n: cellText(intake, L), label: "ifc-ready", arrow: true },
    { step: "② CONVERT", uc: "snap-convert", state: conv.state, n: cellText(conv, L, (c) => String(c.running)), label: zh ? "轉檔中" : "running", arrow: true },
    { step: "③ SESSION", uc: "snap-session", state: sess.state, n: cellText(sess, L, (s) => String(s.active)), label: zh ? "活躍" : "active", arrow: true },
    { step: "⑤ OUTBOX", uc: "snap-outbox", state: outbox.state, n: cellText(outbox, L, (o) => String(o.pending)), label: zh ? "待送" : "pending", arrow: false },
  ];

  const launcherApps = apps.filter((a) => SHOW_CONCEPT_APPS || a.tone === "live");

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "22px 26px", display: "flex", flexDirection: "column", gap: 18 }}>
      {/* ---- 標題列：最後更新（只有 live 才有時間；否則 —，gate 環境確定性）---- */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <span style={{ fontSize: 20, fontWeight: 700 }}>{L.home_title}</span>
        <span data-uc="last-updated" style={{ fontFamily: MONO, fontSize: "10.5px", color: "var(--ab-text-dim)" }}>{L.last_updated} {updated}</span>
      </div>
      {/* ---- KPI 卡 ×4（真值）---- */}
      <div data-prov="asbuilt" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12 }}>
        {kpi("#conv", L.kpi_conv, "kpi-conv", conv.state, cellText(conv, L, (c) => String(c.running)), cellSub(conv, L, (c) => `ready ${c.ready} · failed ${c.failed}`))}
        {kpi("#sessions", L.kpi_sess, "kpi-sess", sess.state, cellText(sess, L, (s) => String(s.active)), cellSub(sess, L, (s) => `participants ${s.participants}`))}
        {kpi("#issues", L.kpi_issue, "kpi-issue", issue.state, cellText(issue, L), cellSub(issue, L, () => (zh ? "非 resolved／rejected" : "not resolved/rejected")))}
        {kpi("#pipeline", L.kpi_outbox, "kpi-outbox", outbox.state, cellText(outbox, L, (o) => String(o.pending)), cellSub(outbox, L, (o) => `attempts ${o.attempts}/${o.maxAttempts}`))}
      </div>
      {/* ---- 資料生產線快照 + 服務健康 ---- */}
      <div style={{ display: "grid", gridTemplateColumns: "1.7fr 1fr", gap: 12 }}>
        <div data-prov="asbuilt" style={{ ...chipBox, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: "13.5px", fontWeight: 700 }}>{L.pipe_snap}</span>
            <span data-uc="enter-pipeline" data-action="nav" role="link" onClick={() => nav("#pipeline")} style={{ marginLeft: "auto", fontSize: 11, color: "var(--ab-accent)", cursor: "pointer" }}>{L.enter} →</span>
          </div>
          <div style={{ display: "flex", alignItems: "stretch", gap: 0 }}>
            {pipeSnap.map((p) => (
              <div key={p.step} style={{ flex: 1, display: "flex", alignItems: "center", gap: 0, minWidth: 0 }}>
                <div className="hv-accent-border-strong" data-action="nav" role="link" onClick={() => nav("#pipeline")} style={{ flex: 1, background: "var(--ab-inset)", border: "1px solid rgba(120,160,210,.14)", borderRadius: 10, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 3, cursor: "pointer" }}>
                  <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: ".08em", color: "var(--ab-text-code)" }}>{p.step}</span>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}><span data-uc={p.uc} data-prov="asbuilt" data-state={p.state} style={{ fontSize: 19, fontWeight: 700, fontFamily: MONO, color: stateColor(p.state) }}>{p.n}</span><span style={{ fontSize: 11, color: "var(--ab-text-muted)" }}>{p.label}</span></div>
                </div>
                {p.arrow ? <span style={{ color: "var(--ab-text-faint)", padding: "0 6px", fontFamily: MONO }}>→</span> : null}
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 11, color: "var(--ab-text-dim)" }}>
            <span style={{ fontFamily: MONO, fontSize: "9.5px", letterSpacing: ".08em", textTransform: "uppercase" }}>F1</span>
            <span>{L.f1_desc}</span>
          </div>
        </div>
        <div data-prov="asbuilt" style={{ ...chipBox, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          <span style={{ fontSize: "13.5px", fontWeight: 700 }}>{L.svc_health}</span>
          <ServiceHealthList snap={snap} zh={zh} />
        </div>
      </div>
      {/* ---- 應用啟動器（導覽設定；A1–A4 badge 文字仍為 fixture，tasks §2.3 承接）---- */}
      <div data-prov="fixture" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <span style={{ fontSize: "13.5px", fontWeight: 700 }}>{L.launcher}</span>
          <span style={{ fontSize: 11, color: "var(--ab-text-dim)" }}>A1–A4 live · A5–A10 Concept Preview</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 10 }}>
          {launcherApps.map((a) => (
            <div
              key={a.code}
              className="hv-card"
              onClick={() => nav(a.hash)}
              style={a.tone === "live"
                ? { background: "var(--ab-surface)", border: "1px solid rgba(120,160,210,.16)", borderRadius: 12, padding: "13px 14px", display: "flex", flexDirection: "column", gap: 5, cursor: "pointer", transition: "all .15s" }
                : { background: "var(--ab-surface)", border: "1px solid rgba(120,160,210,.09)", borderRadius: 12, padding: "13px 14px", display: "flex", flexDirection: "column", gap: 5, cursor: "pointer", transition: "all .15s", opacity: 0.75 }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 600, color: "var(--ab-text-code)" }}>{a.code}</span>
                <span style={badgeTone(a.tone)}>{a.badge}</span>
              </div>
              <span style={{ fontSize: "12.5px", fontWeight: 500, color: "var(--ab-text)" }}>{zh ? a.labelZh : a.labelEn}</span>
              <span style={{ fontSize: 10, color: "var(--ab-text-dim)" }}>{appEn[a.code]}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: 更新 `unified.test.tsx` 的 `#home` 案與誠實標記契約案；`sharedstatus` 改回 outbox 斷言**

`unified.test.tsx`：

(a) `#home` 案（`it("#home 渲染 UnifiedShell：…")`）在 `expect(html).toContain("Outbox 待送"); // kpi_outbox` 之後追加：

```ts
    // unified-console-runtime-truth：KPI 為真值 cell（SSR 快照＝尚未連線 → — / offline），fixture 固定值不得出現。
    expect(html).toContain('data-uc="kpi-conv-val" data-prov="asbuilt" data-state="offline"');
    expect(html).toContain("最後更新 —");
    for (const lit of ["2026-07-14", "990_model.ifc", "S-240601", "rule-run #88", "OB-201"]) expect(html, lit).not.toContain(lit);
```

(b) 把最後一案 `it("誠實標記契約：每個 approved 路由的 fixture 面板帶 data-prov=\"fixture\"", …)` 整段換成：

```ts
  it("誠實標記契約：fixture 殼（#a1/#a3/#a5）帶 data-prov=\"fixture\"；真值頁（#home）page-root 內帶 asbuilt", () => {
    for (const hash of ["#a1", "#a3", "#a5"]) {
      expect(renderAtHash(hash), hash).toContain('data-prov="fixture"');
    }
    for (const hash of ["#home"]) {
      const html = renderAtHash(hash);
      const pageRoot = html.slice(html.indexOf('data-uc="page-root"'));
      expect(pageRoot, hash).toContain('data-prov="asbuilt"');
      expect(pageRoot, hash).not.toContain('data-prov="fixture" style="display:grid'); // 舊 KPI grid 的 fixture 標記已移除
    }
  });
```

`EdgeConsole.sharedstatus.test.tsx`：把 Task 3c 暫寫的 `expect(spies.getCallbackOutboxSummary).toHaveBeenCalledTimes(0);`（含註解）改回 `expect(spies.getCallbackOutboxSummary).toHaveBeenCalledWith(200);`。

- [ ] **Step 7: 跑測試確認通過＋型別**

```powershell
Set-Location $F
npx vitest run src/console/unified/homeLiveBinding.test.tsx src/console/unified/unified.test.tsx src/console/EdgeConsole.sharedstatus.test.tsx src/console/unified/topbarGpuChip.test.tsx
npx tsc --noEmit
```

預期：`Test Files  4 passed (4)`；tsc exit 0（若報 `'ReactNode' is declared but never used` 之類，依訊息刪除未用 import；`noUnusedLocals` 為硬規則）。

- [ ] **Step 8: Commit**

```powershell
Set-Location $W
git add web-viewer-sample/src/console/unified/ServiceHealthList.tsx web-viewer-sample/src/console/unified/HomePage.tsx web-viewer-sample/src/console/unified/homeLiveBinding.test.tsx web-viewer-sample/src/console/unified/unified.test.tsx web-viewer-sample/src/console/EdgeConsole.sharedstatus.test.tsx
git diff --cached --check
git commit -m "task#4: #home 四 KPI＋六 svc-dot 綁 coordinator 真值（asbuilt／data-state），移除 fixture 固定值" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

#### 3B. `#pipeline` 五段＋治理／報表列真值綁定（tasks 1.5）＋ 5.3 的 pipeline 斷言（原 Task 5）

**Files:**
- Modify: `web-viewer-sample/src/console/unified/PipelinePage.tsx`（整檔重寫）
- Test: `web-viewer-sample/src/console/unified/pipelineLiveBinding.test.tsx`（新）
- Modify: `web-viewer-sample/src/console/unified/unified.test.tsx`（`#pipeline` 案＋誠實標記契約案）

- [ ] **Step 1: impact 分析**

```powershell
Set-Location $W
npx gitnexus@1.6.9 impact PipelinePage -d upstream -r AI-BIM-governance
```

預期 LOW。

- [ ] **Step 2: 寫失敗測試 `pipelineLiveBinding.test.tsx`**

```tsx
// unified-console-runtime-truth slice 1（tasks 1.5）：#pipeline 五段＋治理／報表列綁真值（spec scenario「Pipeline 五段對照」）；
// outbox 只用 /api/callback-outbox/summary；3D handoff 為 anchor（非 iframe）；RVT 段退役標示；觸發轉檔 disabled＋原因（D2 於 slice 2）。
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EdgeConsole from "../EdgeConsole";
import { coordinatorStatusStore } from "./coordinatorStatusStore";
import { RT_IDLE, conversionRecord, outboxEntries, sessionItem, spyCoordinatorEndpoints, spyCoordinatorEndpointsOffline } from "./__testdata__/coordinatorMocks";

describe("PipelinePage 真值綁定", () => {
  let container: HTMLDivElement;
  let prevHash: string;
  let root: Root | null;
  beforeEach(() => {
    (globalThis as Record<string, unknown>)["IS_REACT_ACT_ENVIRONMENT"] = true;
    container = document.createElement("div"); document.body.appendChild(container);
    prevHash = window.location.hash; root = null;
    coordinatorStatusStore.reset();
  });
  afterEach(async () => {
    if (root) await act(async () => { root!.unmount(); });
    document.body.removeChild(container); vi.restoreAllMocks(); window.location.hash = prevHash;
  });
  async function mountPipeline() {
    window.location.hash = "#pipeline";
    root = createRoot(container);
    await act(async () => { root!.render(<EdgeConsole />); });
    for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve(); });
  }
  const uc = (id: string) => container.querySelector<HTMLElement>(`[data-uc="${id}"]`)!;
  const folders = (n: number, withIfc: number) => Array.from({ length: n }, (_, i) => ({ prefix: `p${i}/`, has_source_ifc: i < withIfc }));

  it("live（spec scenario）：ifc-ready 0、bucket 7／3、watch on 12/12/0、ready 12 running 0、kit_local_001 idle、session 0、無可 handoff session、pending 36（attempts 0/5）、治理列", async () => {
    const spies = spyCoordinatorEndpoints({
      ifcReady: { count: 0, items: [] },
      minioFolder: { bucket: "bim-control", prefix: "", folders: folders(7, 3), objects: [], count: 7 },
      minioWatch: { enabled: true, bucket: "bim-control", baseline_count: 12, seen_count: 12, triggered_total: 0 },
      conversionRecords: { count: 12, items: Array.from({ length: 12 }, (_, i) => conversionRecord(`k${i}`, "ready")) },
      outboxSummary: { total: 36, limit: 200, entries: outboxEntries(36, 0, 5) },
      ruleRuns: { filters: {}, limit: 5, offset: 0, total: 3, items: [] },
    });
    await mountPipeline();
    const expectVal = (id: string, text: string) => {
      expect(uc(id).textContent, id).toBe(text);
      expect(uc(id).getAttribute("data-prov"), id).toBe("asbuilt");
      expect(uc(id).getAttribute("data-state"), id).toBe("live");
    };
    expectVal("intake-ifc-ready-val", "0");
    expectVal("intake-bucket-val", "7／3");
    expectVal("intake-watch-val", "on · baseline 12 · seen 12 · triggered 0");
    expectVal("conv-ready-val", "12");
    expectVal("conv-running-val", "0");
    expectVal("conv-failed-val", "0");
    expectVal("sess-active-val", "0");
    expectVal("kit-instance-val", "kit_local_001 idle");
    expect(uc("handoff-none").textContent).toBe("無可 handoff session");
    expect(container.querySelectorAll('[data-uc="handoff-link"]').length).toBe(0);
    expectVal("outbox-pending-val", "36");
    expect(uc("outbox-attempts").textContent).toContain("attempts 0/5");
    expectVal("gov-rule-runs-val", "3");
    expectVal("gov-open-issues-val", "0");
    expect(uc("to-issues").getAttribute("href")).toBe("#issues");
    expect(uc("to-reports").getAttribute("href")).toBe("#reports");
    // outbox 只走 redacted 摘要（limit 200）；不存在任何 /api/internal 呼叫（coordinatorClient 沒有這種方法，此處鎖 wire）。
    expect(spies.getCallbackOutboxSummary).toHaveBeenCalledWith(200);
    expect(container.innerHTML).not.toContain("payload");
    expect(container.innerHTML).not.toContain("target_url");
    // RVT 段退役標示、無 RVT 轉檔按鈕；觸發轉檔 disabled＋原因。
    expect(uc("rvt-retired").textContent).toContain("已退役");
    expect(container.innerHTML).not.toContain("RVT 轉檔");
    expect(uc("trigger-conv").getAttribute("aria-disabled")).toBe("true");
    expect(uc("trigger-conv").getAttribute("data-action")).toBe("disabled");
    expect(uc("trigger-conv").getAttribute("data-prov")).toBe("p1");
    expect(uc("trigger-conv").getAttribute("aria-describedby")).toBe("trigger-conv-reason");
    expect(container.querySelector("#trigger-conv-reason")!.textContent).toContain("allowlist");
    // fixture 固定值不得出現。
    for (const lit of ["demo_lib_2026.ifc", "990_model.ifc", "cj_0116", "S-240601", "OB-201", "bucket/incoming"]) expect(container.innerHTML, lit).not.toContain(lit);
  });

  it("有 review session：3D handoff 段列出 anchor（target=_blank，href=/ui/open?session=<id>），不內嵌 iframe", async () => {
    spyCoordinatorEndpoints({ runtimeStatus: { ...RT_IDLE, sessions: { count: 1, active_count: 1, participant_count: 1, items: [sessionItem("review_session_a")] } } });
    await mountPipeline();
    const links = container.querySelectorAll<HTMLAnchorElement>('[data-uc="handoff-link"]');
    expect(links.length).toBe(1);
    expect(links[0].getAttribute("href")).toContain("/ui/open?session=review_session_a");
    expect(links[0].getAttribute("target")).toBe("_blank");
    expect(links[0].getAttribute("rel")).toContain("noopener");
    expect(container.querySelector("iframe")).toBeNull();
    expect(uc("sess-active-val").textContent).toBe("1");
  });

  it("MinIO 未設定（note）→ bucket 摘要「未取得」而非 0／0；kit instance 404 → 顯示 404（error）", async () => {
    spyCoordinatorEndpoints({
      minioFolder: { bucket: null, prefix: "", folders: [], objects: [], count: 0, note: "MinIO not configured" },
      kitInstance: Object.assign(new Error("coordinator /api/kit/instances/current -> 404 no current instance"), { name: "CoordinatorHttpError", status: 404, path: "/api/kit/instances/current" }),
    });
    await mountPipeline();
    expect(uc("intake-bucket-val").textContent).toBe("未取得");
    expect(uc("intake-bucket-val").getAttribute("data-state")).toBe("unavailable");
    // 非 CoordinatorHttpError 實例（plain Error 冒名）一律歸 offline：這是 classifyFailure 的 instanceof 守門。
    expect(uc("kit-instance-val").getAttribute("data-state")).toBe("offline");
  });

  it("offline（十端點 503）：五段主值皆 —／offline；handoff 段顯示未連線；最後更新 —", async () => {
    spyCoordinatorEndpointsOffline();
    await mountPipeline();
    for (const id of ["intake-ifc-ready-val", "intake-bucket-val", "intake-watch-val", "conv-ready-val", "conv-running-val", "conv-failed-val", "sess-active-val", "kit-instance-val", "outbox-pending-val", "gov-rule-runs-val", "gov-open-issues-val"]) {
      expect(uc(id).textContent, id).toBe("—");
      expect(uc(id).getAttribute("data-state"), id).toBe("offline");
    }
    expect(uc("handoff-state").textContent).toBe("未連線");
    expect(uc("last-updated").textContent).toBe("最後更新 —");
    expect(container.querySelector('[data-uc="toast"]')).toBeNull();
  });
});
```

- [ ] **Step 3: 跑測試確認失敗**

```powershell
Set-Location $F
npx vitest run src/console/unified/pipelineLiveBinding.test.tsx
```

預期：`Tests  4 failed (4)`（`intake-ifc-ready-val` 為 null）。

- [ ] **Step 4: 整檔重寫 `PipelinePage.tsx`**

```tsx
// ═══════════════════════════════════════════════════════════════════════
// UnifiedConsole — Pipeline 頁（模型資料與轉檔生產線）
// unified-console-runtime-truth slice 1（tasks 1.5）：五段（進件／轉檔／Session／3D handoff／回拋）＋治理／報表列綁
// coordinator :8004 既有端點（共用 poller）。outbox 只用 GET /api/callback-outbox/summary（redacted 投影，不打 /api/internal/*）。
// RVT 段固定標示外部產製／已退役（PR #63）、無 RVT 轉檔按鈕。
// 「觸發轉檔」：瀏覽器授權（D2＝T4 operator token）於 slice 2（tasks §4.2／§2.4）落地前為 disabled＋原因（data-prov="p1"）。
// 3D handoff 為 anchor（target=_blank）指向 /ui/open?session=<id>：不內嵌 iframe、不自動 claim。
// 版面沿用設計原型；導覽一律 window.location.hash 賦值。
// ═══════════════════════════════════════════════════════════════════════
import type { CSSProperties, ReactNode } from "react";
import { useLang } from "../i18n";
import { coordinatorClient } from "../coordinatorClient";
import type { MinioWatchStatus } from "../coordinatorClient";
import { MONO, chipBox, getL, innerBox } from "./fixtures";
import { useConsoleData } from "./ConsoleDataProvider";
import type { EndpointKey } from "./coordinatorStatusStore";
import {
  activeSessions, cell, cellSub, cellText, conversionCounts, lastUpdatedText, openIssueCount, outboxPending, stateColor,
} from "./runtimeTruth";
import type { Cell } from "./runtimeTruth";

const PIPELINE_KEYS: readonly EndpointKey[] = [
  "ifcReady", "minioFolder", "minioWatch", "conversionRecords", "runtimeStatus", "kitInstance", "outboxSummary", "issues", "ruleRuns",
];

const col: CSSProperties = { ...chipBox, padding: 14, display: "flex", flexDirection: "column", gap: 10 };
const navLink: CSSProperties = { fontSize: 11, color: "var(--ab-accent)", cursor: "pointer", textDecoration: "none" };
const disabledBtn: CSSProperties = { textAlign: "center", fontSize: 11, color: "var(--ab-text-dimmer)", border: "1px solid rgba(120,160,210,.14)", borderRadius: 7, padding: 6, cursor: "not-allowed", fontWeight: 700 };
const reasonText: CSSProperties = { fontSize: "9.5px", color: "var(--ab-text-dim)", lineHeight: 1.4 };
const handoffBtn: CSSProperties = { textAlign: "center", fontSize: "10.5px", color: "var(--ab-on-accent)", background: "linear-gradient(135deg,var(--ab-accent),var(--ab-accent-2))", borderRadius: 7, padding: 5, fontWeight: 700, textDecoration: "none" };

export function PipelinePage() {
  const lang = useLang();
  const zh = lang === "zh";
  const L = getL(zh);
  const snap = useConsoleData(PIPELINE_KEYS);
  const nav = (hash: string) => { window.location.hash = hash; };

  /* ---- 真值投影（design §3.3 pipeline 各列）---- */
  const ifcReady = cell(snap.ifcReady, (r) => r.count);
  // note＝MinIO 未設定（app.ts 未設定分支回 200＋note）→ 未取得，不是 0／0。
  const bucket = cell(snap.minioFolder, (f) => (f.note ? null : { folders: f.folders.length, withIfc: f.folders.filter((x) => x.has_source_ifc).length }));
  const watch = cell(snap.minioWatch, (w) => w);
  const conv = cell(snap.conversionRecords, conversionCounts);
  const sess = cell(snap.runtimeStatus, (rt) => ({ active: activeSessions(rt), items: rt.sessions.items }));
  const kit = cell(snap.kitInstance, (k) => `${k.instance_id} ${k.status}`);
  const outbox = cell(snap.outboxSummary, outboxPending);
  const issues = cell(snap.issues, openIssueCount);
  const ruleRuns = cell(snap.ruleRuns, (r) => r.total);
  const updated = lastUpdatedText([
    snap.ifcReady, snap.minioFolder, snap.minioWatch, snap.conversionRecords, snap.runtimeStatus, snap.kitInstance, snap.outboxSummary, snap.issues, snap.ruleRuns,
  ]);
  const watchText = (w: MinioWatchStatus) => (w.enabled
    ? `on · baseline ${w.baseline_count ?? L.unavailable} · seen ${w.seen_count ?? L.unavailable} · triggered ${w.triggered_total ?? L.unavailable}`
    : "off");

  /* colHead（1:1 對應原型 colHead(title, right)）*/
  const colHead = (title: string, right: ReactNode) => (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ fontFamily: MONO, fontSize: "9.5px", letterSpacing: ".1em", color: "var(--ab-text-code)", textTransform: "uppercase" }}>{title}</span>
      <span style={{ marginLeft: "auto", fontFamily: MONO, fontSize: 10, color: "var(--ab-text-muted)" }}>{right}</span>
    </div>
  );
  /** 一列真值：主值（data-uc／data-prov／data-state）＋標籤 */
  const stat = <T,>(uc: string, c: Cell<T>, format: (v: T) => string, label: string) => (
    <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
      <span data-uc={uc} data-prov="asbuilt" data-state={c.state} style={{ fontFamily: MONO, fontSize: 19, fontWeight: 700, color: stateColor(c.state) }}>{cellText(c, L, format)}</span>
      <span style={{ fontSize: 11, color: "var(--ab-text-muted)" }}>{label}</span>
    </div>
  );
  const link = (uc: string, hash: string, label: string) => (
    <a data-uc={uc} data-action="nav" href={hash} onClick={(e) => { e.preventDefault(); nav(hash); }} className="hv-text" style={navLink}>{label}</a>
  );

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "22px 26px", display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <span style={{ fontSize: 20, fontWeight: 700 }}>{L.pipe_title}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: MONO, fontSize: 10, color: "var(--ab-text-code)" }}>
          <span style={{ color: "var(--ab-accent-text)" }}>{"① " + L.st_intake}</span><span style={{ color: "var(--ab-text-faint)" }}>→</span>
          <span style={{ color: "var(--ab-accent-text)" }}>{"② " + L.st_conv}</span><span style={{ color: "var(--ab-text-faint)" }}>→</span>
          <span style={{ color: "var(--ab-accent-text)" }}>③ Session</span><span style={{ color: "var(--ab-text-faint)" }}>→</span>
          <span style={{ color: "var(--ab-accent-text)" }}>④ 3D Handoff</span><span style={{ color: "var(--ab-text-faint)" }}>→</span>
          <span style={{ color: "var(--ab-accent-text)" }}>{"⑤ " + L.st_callback}</span>
        </div>
        <span data-uc="last-updated" style={{ marginLeft: "auto", fontFamily: MONO, fontSize: 10, color: "var(--ab-text-dimmer)" }}>{L.last_updated} {updated}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 12, alignItems: "start" }}>
        {/* ① 進件：ifc-ready 計數、bucket 資料夾／含 source IFC、MinIO watch 狀態 */}
        <div data-prov="asbuilt" style={col}>
          {colHead("① " + L.st_intake, link("to-minio", "#minio", zh ? "MinIO 物件 →" : "MinIO objects →"))}
          {stat("intake-ifc-ready-val", ifcReady, String, "ifc-ready")}
          {stat("intake-bucket-val", bucket, (b) => `${b.folders}／${b.withIfc}`, zh ? "資料夾／含 source IFC" : "folders / with source IFC")}
          <div style={{ ...innerBox, padding: 10, display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontFamily: MONO, fontSize: 9, color: "var(--ab-text-dimmer)" }}>MinIO watch</span>
            <span data-uc="intake-watch-val" data-prov="asbuilt" data-state={watch.state} style={{ fontFamily: MONO, fontSize: 10, color: stateColor(watch.state) ?? "var(--ab-text)" }}>{cellText(watch, L, watchText)}</span>
          </div>
        </div>
        {/* ② 轉檔：ledger 三組計數、RVT 退役、觸發轉檔（disabled 附原因） */}
        <div data-prov="asbuilt" style={col}>
          {colHead("② " + L.st_conv, link("to-conv", "#conv", zh ? "轉檔排程 →" : "queue →"))}
          {stat("conv-ready-val", conv, (c) => String(c.ready), "ready")}
          {stat("conv-running-val", conv, (c) => String(c.running), "running")}
          {stat("conv-failed-val", conv, (c) => String(c.failed), "failed")}
          <span
            data-uc="trigger-conv" role="button" aria-disabled="true" tabIndex={-1}
            data-action="disabled" data-prov="p1" aria-describedby="trigger-conv-reason"
            style={disabledBtn}
          >{L.trigger}</span>
          <span id="trigger-conv-reason" data-uc="trigger-conv-reason" style={reasonText}>{zh
            ? "需 allowlist 來源：瀏覽器授權（D2＝T4 operator token，tasks §4.2）落地前停用；請至 #minio 由 allowlist 來源觸發。"
            : "Requires an allowlisted origin: disabled until browser authorization (D2=T4 operator token, tasks §4.2) lands; trigger from #minio on an allowlisted host."}</span>
          <span data-uc="rvt-retired" data-prov="asbuilt" data-state="unavailable" style={reasonText}>{zh
            ? "RVT：外部產製／已退役（PR #63），不可由本站轉檔；source_rvt 存在與否未取得（/api/minio/objects 不揭露 rvt role）。"
            : "RVT: produced externally / retired (PR #63); not convertible here. source_rvt presence not observed (/api/minio/objects exposes no rvt role)."}</span>
        </div>
        {/* ③ Session：active 計數＋Kit instance */}
        <div data-prov="asbuilt" style={col}>
          {colHead("③ Review Sessions", link("to-sessions", "#sessions", zh ? "Session 管理 →" : "sessions →"))}
          {stat("sess-active-val", sess, (s) => String(s.active), zh ? "活躍" : "active")}
          <div style={{ ...innerBox, padding: 10, display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontFamily: MONO, fontSize: 9, color: "var(--ab-text-dimmer)" }}>Kit instance</span>
            <span data-uc="kit-instance-val" data-prov="asbuilt" data-state={kit.state} style={{ fontFamily: MONO, fontSize: 11, color: stateColor(kit.state) ?? "var(--ab-text)" }}>{cellText(kit, L)}</span>
          </div>
        </div>
        {/* ④ 3D handoff：review session → /ui/open?session=<id> anchor（新分頁，非 iframe，不自動 claim） */}
        <div data-prov="asbuilt" style={col}>
          {colHead("④ 3D Handoff", <span data-uc="handoff-count" data-state={sess.state}>{cellText(sess, L, (s) => String(s.items.length))}</span>)}
          {sess.state === "live" && sess.value !== null
            ? (sess.value.items.length === 0
              ? <span data-uc="handoff-none" style={{ fontSize: 11, color: "var(--ab-text-dimmer)", textAlign: "center", padding: "8px 0" }}>{zh ? "無可 handoff session" : "no session to hand off"}</span>
              : sess.value.items.map((s) => (
                <div key={s.session_id} style={{ ...innerBox, padding: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={{ fontFamily: MONO, fontSize: 10, color: "var(--ab-accent-text)", wordBreak: "break-all" }}>{s.session_id} · {s.status}</span>
                  <a data-uc="handoff-link" data-action="nav" href={coordinatorClient.openInViewerUrl(s.session_id)} target="_blank" rel="noopener noreferrer" className="hv-bright" style={handoffBtn}>{zh ? "開啟即時視圖（新分頁）" : "Open live view (new tab)"}</a>
                </div>
              )))
            : <span data-uc="handoff-state" data-state={sess.state} style={{ fontSize: 11, color: stateColor(sess.state), textAlign: "center", padding: "8px 0" }}>{cellSub(sess, L, () => "")}</span>}
        </div>
        {/* ⑤ 回拋：redacted 摘要（pending＋attempts） */}
        <div data-prov="asbuilt" style={col}>
          {colHead("⑤ Callback Outbox", <span style={{ fontFamily: MONO, fontSize: 9, color: "var(--ab-text-dimmer)" }}>GET /api/callback-outbox/summary</span>)}
          {stat("outbox-pending-val", outbox, (o) => String(o.pending), L.pending)}
          <span data-uc="outbox-attempts" style={{ fontSize: "9.5px", color: "var(--ab-text-dim)" }}>{cellSub(outbox, L, (o) => `attempts ${o.attempts}/${o.maxAttempts} · metadata-only`)}</span>
        </div>
      </div>
      {/* 治理／報表列 */}
      <div data-prov="asbuilt" style={{ ...chipBox, padding: 16, display: "flex", alignItems: "center", gap: 24 }}>
        <span style={{ fontSize: "13.5px", fontWeight: 700 }}>{zh ? "治理／報表" : "Governance / Reports"}</span>
        {stat("gov-rule-runs-val", ruleRuns, String, "rule-runs")}
        {stat("gov-open-issues-val", issues, String, zh ? "未結 issue" : "open issues")}
        <span style={{ marginLeft: "auto", display: "flex", gap: 14 }}>
          {link("to-issues", "#issues", "Issues →")}
          {link("to-reports", "#reports", zh ? "報表 →" : "Reports →")}
        </span>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: 更新 `unified.test.tsx` 的 `#pipeline` 案與誠實標記契約案**

(a) `#pipeline` 案（`it("#pipeline 渲染 PipelinePage：…")`）最後一行 `expect(html).toContain("⑤ Callback Outbox");` 之後追加：

```ts
    expect(html).toContain("④ 3D Handoff");
    // 真值 cell（SSR＝尚未連線 → —）與 RVT 退役標示；fixture 固定值不得出現。
    expect(html).toContain('data-uc="conv-ready-val" data-prov="asbuilt" data-state="offline"');
    expect(html).toContain("已退役");
    for (const lit of ["demo_lib_2026.ifc", "990_model.ifc", "cj_0116", "S-240601", "OB-201"]) expect(html, lit).not.toContain(lit);
```

(b) 誠實標記契約案的 `for (const hash of ["#home"]) {` 改為 `for (const hash of ["#home", "#pipeline"]) {`。

- [ ] **Step 6: 跑測試確認通過＋型別**

```powershell
Set-Location $F
npx vitest run src/console/unified/pipelineLiveBinding.test.tsx src/console/unified/unified.test.tsx src/console/EdgeConsole.aliasRedirect.test.tsx
npx tsc --noEmit
```

預期：`Test Files  3 passed (3)`；tsc exit 0。

- [ ] **Step 7: Commit**

```powershell
Set-Location $W
git add web-viewer-sample/src/console/unified/PipelinePage.tsx web-viewer-sample/src/console/unified/pipelineLiveBinding.test.tsx web-viewer-sample/src/console/unified/unified.test.tsx
git diff --cached --check
git commit -m "task#5: #pipeline 五段＋治理／報表列綁真值；outbox 只用 redacted 摘要；RVT 退役標示；觸發轉檔 disabled 附原因" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: `#runtime` 真值 OpsPage＋假資料 export 退出 production（tasks 1.6、1.8、5.2）

> 本 task 由多個原 task 併成（額度／commit 錨點考量，coordinator 2026-08-25）：各子段（#### nA／nB…）的步驟、驗證與 commit 指令**逐字照做**，每段結尾的 commit 都要做；本 task 所有 commit message 一律以「task#<本 task 在 implementer 提示中的 index>: 」開頭再接原訊息。子段標題括號內的「原 Task N」對應文中所有「Task N Step M」的引用。

#### 4A. `#runtime` 真值 OpsPage（tasks 1.6）＋ 5.3 的 runtime 斷言＋ `82%` 全面歸零（原 Task 6）

**Files:**
- Modify: `web-viewer-sample/src/console/unified/OpsPage.tsx`（整檔重寫）
- Test: `web-viewer-sample/src/console/unified/opsLiveBinding.test.tsx`（新）
- Modify: `web-viewer-sample/src/console/unified/unified.test.tsx`（`#runtime` 案＋誠實標記契約案）

- [ ] **Step 1: impact 分析**

```powershell
Set-Location $W
npx gitnexus@1.6.9 impact OpsPage -d upstream -r AI-BIM-governance
```

預期 LOW（caller 只有 `renderUnified`；`gpuBar` 為檔內私有函式，隨重寫刪除）。

- [ ] **Step 2: 寫失敗測試 `opsLiveBinding.test.tsx`**

```tsx
// unified-console-runtime-truth slice 1（tasks 1.6）：#runtime 真值 OpsPage——Kit instance（GET /api/kit/instances/current）、
// GPU「未取得」（spec scenario「GPU 遙測未取得」）、服務健康六列、事件列誠實停用；不渲染任何固定 GPU／VRAM 數字。
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EdgeConsole from "../EdgeConsole";
import { CoordinatorHttpError } from "../coordinatorClient";
import { coordinatorStatusStore } from "./coordinatorStatusStore";
import { spyCoordinatorEndpoints, spyCoordinatorEndpointsOffline } from "./__testdata__/coordinatorMocks";

describe("OpsPage 真值綁定", () => {
  let container: HTMLDivElement;
  let prevHash: string;
  let root: Root | null;
  beforeEach(() => {
    (globalThis as Record<string, unknown>)["IS_REACT_ACT_ENVIRONMENT"] = true;
    container = document.createElement("div"); document.body.appendChild(container);
    prevHash = window.location.hash; root = null;
    coordinatorStatusStore.reset();
  });
  afterEach(async () => {
    if (root) await act(async () => { root!.unmount(); });
    document.body.removeChild(container); vi.restoreAllMocks(); window.location.hash = prevHash;
  });
  async function mountRuntime() {
    window.location.hash = "#runtime";
    root = createRoot(container);
    await act(async () => { root!.render(<EdgeConsole />); });
    for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve(); });
  }
  const uc = (id: string) => container.querySelector<HTMLElement>(`[data-uc="${id}"]`)!;
  const pageRoot = () => container.querySelector<HTMLElement>('[data-uc="page-root"]')!;

  it("live：kit_local_001 idle；GPU 未取得（unavailable，非錯誤）；六 svc-dot；事件列 disabled＋原因；無固定數字", async () => {
    spyCoordinatorEndpoints();
    await mountRuntime();
    expect(uc("kit-instance-id").textContent).toBe("kit_local_001");
    expect(uc("kit-instance-id").getAttribute("data-state")).toBe("live");
    expect(uc("kit-instance-state").textContent).toBe("idle");
    expect(uc("kit-instance-detail").textContent).toBe("control not_sent · last — · opened 0");
    expect(uc("gpu-val").textContent).toBe("未取得");
    expect(uc("gpu-val").getAttribute("data-state")).toBe("unavailable");
    expect(uc("gpu-val").getAttribute("data-prov")).toBe("asbuilt");
    expect(uc("gpu-sub").textContent).toContain("GPU 使用率欄位");
    expect(container.querySelectorAll('[data-uc="svc-dot"]').length).toBe(6);
    expect(uc("events-disabled").getAttribute("aria-disabled")).toBe("true");
    expect(uc("events-disabled").getAttribute("data-action")).toBe("disabled");
    expect(uc("events-disabled").getAttribute("data-prov")).toBe("p1");
    expect(uc("events-disabled").getAttribute("aria-describedby")).toBe("events-reason");
    expect(container.querySelector("#events-reason")!.textContent).toContain("#instances");
    expect(uc("to-instances").getAttribute("href")).toBe("#instances");
    expect(uc("to-gpu").getAttribute("href")).toBe("#gpu");
    for (const lit of ["82%", "24%", "14.6/24 GB", "S-240601", "lease_8812", "OB-201", "cj_0117", "usd_viewer.kit"]) expect(pageRoot().innerHTML, lit).not.toContain(lit);
    expect(pageRoot().querySelector('[data-prov="fixture"]')).toBeNull();
  });

  it("offline（十端點 503）：Kit／GPU 皆 —／offline；svc-dot 全 unknown；無 toast", async () => {
    spyCoordinatorEndpointsOffline();
    await mountRuntime();
    expect(uc("kit-instance-id").textContent).toBe("—");
    expect(uc("kit-instance-id").getAttribute("data-state")).toBe("offline");
    expect(uc("gpu-val").textContent).toBe("—");
    expect(uc("gpu-val").getAttribute("data-state")).toBe("offline");
    expect(container.querySelectorAll('[data-uc="svc-dot"][data-health="unknown"]').length).toBe(6);
    expect(container.querySelector('[data-uc="toast"]')).toBeNull();
  });

  it("error：kit instance 404 → 顯示 404（error）與後端訊息，不顯示 running／固定 stage", async () => {
    spyCoordinatorEndpoints({ kitInstance: new CoordinatorHttpError("/api/kit/instances/current", 404, "no current instance") });
    await mountRuntime();
    expect(uc("kit-instance-id").textContent).toBe("404");
    expect(uc("kit-instance-id").getAttribute("data-state")).toBe("error");
    expect(uc("kit-instance-detail").textContent).toContain("no current instance");
    expect(pageRoot().innerHTML).not.toContain("running");
  });
});
```

- [ ] **Step 3: 跑測試確認失敗**

```powershell
Set-Location $F
npx vitest run src/console/unified/opsLiveBinding.test.tsx
```

預期：`Tests  3 failed (3)`（`kit-instance-id` 為 null）。

- [ ] **Step 4: 整檔重寫 `OpsPage.tsx`**（卡片標題保留「GPU Fleet」，`e2e/unified-console-routes.spec.ts:34` 以該字串定位）

```tsx
// ═══════════════════════════════════════════════════════════════════════
// UnifiedConsole — Ops 頁（Runtime / Kit · GPU 營運）
// unified-console-runtime-truth slice 1（tasks 1.6）：Kit instance 卡（GET /api/kit/instances/current）、GPU 卡
// （/api/runtime/status 與 kit instance 皆無 GPU 使用率欄位 → 誠實「未取得」，不渲染任何數值）、服務健康六列、
// 事件列誠實停用（coordinator 無事件端點；導向 #instances）。控制項只有 nav 或 disabled＋原因；不打任何 mutation。
// 版面沿用設計原型；須在 UnifiedShell（ConsoleDataProvider）內渲染。
// ═══════════════════════════════════════════════════════════════════════
import type { CSSProperties } from "react";
import { useLang } from "../i18n";
import { MONO, chipBox, getL } from "./fixtures";
import { useConsoleData } from "./ConsoleDataProvider";
import type { EndpointKey } from "./coordinatorStatusStore";
import { ServiceHealthList } from "./ServiceHealthList";
import { cell, cellSub, cellText, stateColor } from "./runtimeTruth";

const OPS_KEYS: readonly EndpointKey[] = ["kitInstance", "runtimeStatus", "kitHealth", "minioWatch", "ruleRuns"];

const cardBase: CSSProperties = { ...chipBox, padding: 16, display: "flex", flexDirection: "column" };
const navBtn: CSSProperties = { flex: 1, textAlign: "center", fontSize: 11, color: "var(--ab-accent-text)", border: "1px solid rgba(65,199,232,.3)", borderRadius: 7, padding: 6, cursor: "pointer", textDecoration: "none" };
const disabledBtn: CSSProperties = { textAlign: "center", fontSize: 11, color: "var(--ab-text-dimmer)", border: "1px solid rgba(120,160,210,.14)", borderRadius: 7, padding: "3px 9px", cursor: "not-allowed" };
const mono10: CSSProperties = { fontFamily: MONO, fontSize: "10.5px", color: "var(--ab-text-muted)" };

export function OpsPage() {
  const lang = useLang();
  const zh = lang === "zh";
  const L = getL(zh);
  const snap = useConsoleData(OPS_KEYS);
  const nav = (hash: string) => { window.location.hash = hash; };

  const kit = cell(snap.kitInstance, (k) => k);
  // 盤點（tasks 1.2）：/api/runtime/status 與 /api/kit/instances/current 皆無 GPU 使用率欄位 → live 即「未取得」，不捏造。
  const gpu = cell(snap.runtimeStatus, () => null);
  const link = (uc: string, hash: string, label: string) => (
    <a data-uc={uc} data-action="nav" href={hash} onClick={(e) => { e.preventDefault(); nav(hash); }} className="hv-accent-bg" style={navBtn}>{label}</a>
  );

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "22px 26px", display: "flex", flexDirection: "column", gap: 16 }}>
      <span style={{ fontSize: 20, fontWeight: 700 }}>{L.ops_title}</span>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
        {/* ── Kit Instance（GET /api/kit/instances/current）── */}
        <div data-prov="asbuilt" style={{ ...cardBase, gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>Kit Instance</span>
            <span data-uc="kit-instance-state" data-state={kit.state} style={{ marginLeft: "auto", fontSize: 10, fontFamily: MONO, color: stateColor(kit.state) ?? "var(--ab-ok-text)", background: "rgba(120,160,210,.06)", border: "1px solid rgba(120,160,210,.14)", borderRadius: 4, padding: "1px 6px" }}>{cellText(kit, L, (k) => k.status)}</span>
          </div>
          <div style={{ ...mono10, display: "flex", flexDirection: "column", gap: 4 }}>
            <span data-uc="kit-instance-id" data-prov="asbuilt" data-state={kit.state} style={{ color: stateColor(kit.state) ?? "var(--ab-text)" }}>{cellText(kit, L, (k) => k.instance_id)}</span>
            <span data-uc="kit-instance-detail">{cellSub(kit, L, (k) => `control ${k.control_status} · last ${k.last_command ?? "—"} · opened ${k.opened_runtime_uris.length}`)}</span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {link("to-instances", "#instances", zh ? "Kit / GPU 機隊 →" : "Kit / GPU fleet →")}
            {link("to-sessions", "#sessions", zh ? "Session 管理 →" : "Sessions →")}
          </div>
        </div>
        {/* ── GPU Fleet（無遙測來源 → 未取得）── */}
        <div data-prov="asbuilt" style={{ ...cardBase, gap: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>GPU Fleet</span>
          <span data-uc="gpu-val" data-prov="asbuilt" data-state={gpu.state} style={{ fontSize: 22, fontWeight: 700, fontFamily: MONO, color: stateColor(gpu.state) }}>{cellText(gpu, L)}</span>
          <span data-uc="gpu-sub" style={{ fontFamily: MONO, fontSize: "9.5px", color: "var(--ab-text-dimmer)" }}>
            {cellSub(gpu, L, () => "")}
            {gpu.state === "unavailable" ? (zh ? "：/api/runtime/status 與 /api/kit/instances/current 皆無 GPU 使用率欄位" : ": no GPU utilization field on /api/runtime/status or /api/kit/instances/current") : ""}
          </span>
          <div style={{ display: "flex", gap: 8 }}>{link("to-gpu", "#gpu", zh ? "GPU 審查室 →" : "GPU review room →")}</div>
        </div>
        {/* ── 服務健康 ── */}
        <div data-prov="asbuilt" style={{ ...cardBase, gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>{L.svc_health}</span>
          <ServiceHealthList snap={snap} zh={zh} />
        </div>
      </div>
      {/* ── 事件（coordinator 無事件端點 → 誠實停用，導向 #instances）── */}
      <div data-prov="asbuilt" style={{ ...cardBase, gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>{`structLog · ${L.recent}`}</span>
          <span data-uc="events-disabled" role="button" aria-disabled="true" tabIndex={-1} data-action="disabled" data-prov="p1" aria-describedby="events-reason" style={{ ...disabledBtn, marginLeft: "auto" }}>{zh ? "事件流" : "event stream"}</span>
        </div>
        <span id="events-reason" data-uc="events-reason" style={{ fontSize: "10.5px", color: "var(--ab-text-dim)" }}>{zh
          ? "事件流未提供（coordinator 無事件端點，不捏造事件列表）；請見 #instances。"
          : "No event stream endpoint on coordinator; no fabricated event list. See #instances."}</span>
        <div style={{ display: "flex", gap: 8 }}>{link("to-instances-events", "#instances", zh ? "Kit / GPU 機隊 →" : "Kit / GPU fleet →")}</div>
      </div>
    </div>
  );
}

export default OpsPage;
```

- [ ] **Step 5: 更新 `unified.test.tsx` 的 `#runtime` 案與誠實標記契約案**

(a) `#runtime` 案在六列名稱 `for` 迴圈之後追加：

```ts
    // 真值 cell（SSR＝尚未連線 → —）；固定 GPU／VRAM／structLog 值不得出現。
    expect(html).toContain('data-uc="gpu-val" data-prov="asbuilt" data-state="offline"');
    expect(html).toContain("GPU Fleet"); // e2e/unified-console-routes.spec.ts:34 以此定位
    for (const lit of ["82%", "24%", "14.6/24 GB", "S-240601", "lease_8812", "cj_0117"]) expect(html, lit).not.toContain(lit);
```

(b) 誠實標記契約案的 `for (const hash of ["#home", "#pipeline"]) {` 改為 `for (const hash of ["#home", "#pipeline", "#runtime"]) {`。

- [ ] **Step 6: 跑測試、型別、`82%` 歸零檢查**

```powershell
Set-Location $F
npx vitest run src/console/unified/opsLiveBinding.test.tsx src/console/unified/unified.test.tsx src/console/unified/topbarGpuChip.test.tsx
npx tsc --noEmit
rg -n "82%" src/console/unified; if ($LASTEXITCODE -eq 1) { "OK: no 82% under src/console/unified" }
```

預期：`Test Files  3 passed (3)`；tsc exit 0；`rg` 無命中並印出 `OK: no 82% under src/console/unified`（tasks 1.7 驗證條件）。

- [ ] **Step 7: Commit**

```powershell
Set-Location $W
git add web-viewer-sample/src/console/unified/OpsPage.tsx web-viewer-sample/src/console/unified/opsLiveBinding.test.tsx web-viewer-sample/src/console/unified/unified.test.tsx
git diff --cached --check
git commit -m "task#6: #runtime 真值 OpsPage（Kit instance／GPU 未取得／服務健康／事件誠實停用），固定 GPU 數值歸零" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

#### 4B. 假資料 export 退出 production 顯示路徑（tasks 1.8，D1=P → test-only）＋ 5.2 解凍＋bundle 掃描（原 Task 7）

**Files:**
- Create: `web-viewer-sample/src/console/unified/__testdata__/prototypeFixtures.ts`
- Modify: `web-viewer-sample/src/console/unified/fixtures.ts`（移除 7 個假資料 export 與其 2 個介面）
- Modify: `web-viewer-sample/src/console/unified/UnifiedShell.tsx`（provider seeds 縮為 issues／outbox／issueSeq）
- Test: `web-viewer-sample/src/console/unified/fixtureNotInProduction.test.ts`（新）
- Modify: `web-viewer-sample/src/console/unified/a1DockLive.test.tsx`（5.2 解凍）

**範圍誠實揭露**：tasks 1.8 列 11 個 export；其中 `failDefs`／`diffDefs`／`fedMembers`（`docks.tsx`）與 `stageTree`（`WorkspacePage.tsx`）的消費者屬 spec §3 明示「out of scope」的 §2／§3 面（A1–A3 dock 互動、A1 視區），本 slice **不改 `docks.tsx`／`WorkspacePage.tsx`**，該 4 個 export 暫留 `fixtures.ts`，由 `fixtureNotInProduction.test.ts` 的 `SLICE2_DEBT` ratchet 釘住「只能縮、不能擴、不得新增 importer」；其餘 7 個（`initialIntake`／`initialConv`／`initialSessions`／`initialOutbox`／`initialIssues`／`alerts`／`services`）本 task 移到 test-only。此決定已在 plan 回傳中列為 blocker 交 coordinator 裁決（擴大 slice 1 或留 slice 2）。

- [ ] **Step 1: impact 分析**

```powershell
Set-Location $W
npx gitnexus@1.6.9 impact UnifiedStateProvider -d upstream -r AI-BIM-governance
npx gitnexus@1.6.9 impact useUnifiedState -d upstream -r AI-BIM-governance
```

預期 LOW；`useUnifiedState` callers＝`ShellFrame`、`WorkspacePage`、docks 五個元件（皆只用 `issues`／`outbox`／`issueSeq`／`patch`／`toast`，不用 `intake`／`conv`／`sessions`——執行時以 `rg -n "u\.(intake|conv|sessions)|{ intake| conv,| sessions" web-viewer-sample/src/console/unified/docks.tsx web-viewer-sample/src/console/unified/WorkspacePage.tsx` 確認為零命中）。

- [ ] **Step 2: 寫失敗測試 `fixtureNotInProduction.test.ts`**

```ts
// unified-console-runtime-truth slice 1（tasks 1.8；spec scenario「fixture 假值不在 production 顯示路徑（符號層驗證）」）：
// (1) import graph：production 元件不得 import 假資料 export；docks／WorkspacePage 的 4 個 slice-2 欠帳以 ratchet 釘住。
// (2) fixtures.ts 不再 export 已搬走的 7 個名稱。(3) src 下非測試檔不得 import __testdata__。
// (4) 渲染層負向 oracle：#home／#pipeline／#runtime 的 SSR 輸出不含任何原型固定值字串。
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import EdgeConsole from "../EdgeConsole";
import { getLang, setLang } from "../i18n";
import { alerts, initialConv, initialIntake, initialIssues, initialOutbox, initialSessions } from "./__testdata__/prototypeFixtures";

const here = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(here, "..", "..");

const FORBIDDEN = [
  "initialIntake", "initialConv", "initialSessions", "initialOutbox", "initialIssues", "alerts", "services",
  "failDefs", "diffDefs", "fedMembers", "stageTree",
] as const;
const RELOCATED = ["initialIntake", "initialConv", "initialSessions", "initialOutbox", "initialIssues", "alerts", "services"] as const;
const PRODUCTION = ["HomePage.tsx", "PipelinePage.tsx", "OpsPage.tsx", "UnifiedShell.tsx", "docks.tsx", "WorkspacePage.tsx", "A1DockLive.tsx", "ConceptPage.tsx", "ServiceHealthList.tsx"] as const;
/** slice 1 誠實欠帳（spec §3 out of scope：§2 dock 互動／§3 A1 視區）；只能縮、不能擴。 */
const SLICE2_DEBT: Record<string, readonly string[]> = {
  "docks.tsx": ["diffDefs", "failDefs", "fedMembers"],
  "WorkspacePage.tsx": ["stageTree"],
};

function importedNamesFromFixtures(source: string): string[] {
  const names: string[] = [];
  const re = /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*"\.\/fixtures"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    for (const raw of m[1].split(",")) {
      const name = raw.trim().split(/\s+as\s+/)[0].trim();
      if (name) names.push(name);
    }
  }
  return names;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe("fixture 假資料不在 production 顯示路徑", () => {
  it("(1) production 元件 import 自 ./fixtures 的名稱與禁用清單交集＝slice-2 欠帳表（ratchet）", () => {
    for (const file of PRODUCTION) {
      const names = importedNamesFromFixtures(readFileSync(path.join(here, file), "utf8"));
      const forbidden = names.filter((n) => (FORBIDDEN as readonly string[]).includes(n)).sort();
      expect(forbidden, file).toEqual([...(SLICE2_DEBT[file] ?? [])].sort());
    }
  });

  it("(2) fixtures.ts 不再 export 已搬走的 7 個假資料名稱", () => {
    const src = readFileSync(path.join(here, "fixtures.ts"), "utf8");
    for (const name of RELOCATED) expect(src, name).not.toMatch(new RegExp(`export\\s+const\\s+${name}\\b`));
    expect(src).not.toContain("export interface AlertDef");
    expect(src).not.toContain("export interface ServiceDef");
  });

  it("(3) src 下非測試檔不得 import __testdata__", () => {
    const offenders = walk(srcRoot)
      .filter((f) => !/\.(test|spec)\.tsx?$/.test(f) && !f.includes(`${path.sep}__testdata__${path.sep}`))
      .filter((f) => /__testdata__\//.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(srcRoot, f));
    expect(offenders).toEqual([]);
  });

  describe("(4) 渲染層負向 oracle", () => {
    let prevLang: ReturnType<typeof getLang>;
    beforeEach(() => { prevLang = getLang(); setLang("zh"); });
    afterEach(() => { setLang(prevLang); });
    const literals = [
      ...initialIntake.map((x) => x.file), ...initialConv.map((x) => x.file), ...initialSessions.map((x) => x.id),
      ...initialOutbox.map((x) => x.id), ...initialIssues.map((x) => x.id), ...initialIssues.map((x) => x.title), ...alerts.map((x) => x.msgZh),
    ];
    for (const hash of ["#home", "#pipeline", "#runtime"]) {
      it(`${hash} 不含任何原型固定值（${literals.length} 個字串）`, () => {
        const prevHash = window.location.hash;
        try {
          window.location.hash = hash;
          const html = renderToString(createElement(EdgeConsole)); // .ts 檔（tasks.md 指定檔名）不用 JSX
          for (const lit of literals) expect(html, lit).not.toContain(lit);
        } finally {
          window.location.hash = prevHash;
        }
      });
    }
  });
});
```

- [ ] **Step 3: 跑測試確認失敗**

```powershell
Set-Location $F
npx vitest run src/console/unified/fixtureNotInProduction.test.ts
```

預期：`Failed to resolve import "./__testdata__/prototypeFixtures"`。

- [ ] **Step 4: 建立 `__testdata__/prototypeFixtures.ts`**（內容自 `fixtures.ts` 逐字搬移，含兩個介面）

```ts
// 設計原型（scratchpad/design-origin/app.js）的假資料 export——unified-console-runtime-truth slice 1（D1=P）自
// production 的 ./fixtures 搬出，只供測試作負向 oracle（fixtureNotInProduction.test.ts：畫面不得出現這些固定值）。
// production 元件不得 import 本檔（同一測試守門）。
import type { ConvItem, IntakeItem, IssueItem, OutboxItem, SessionItem } from "../fixtures";

export const initialIntake: IntakeItem[] = [
  { file: "demo_lib_2026.ifc", src: "MinIO bucket/incoming" },
  { file: "松風庵_v3.ifc", src: "MinIO bucket/incoming" },
];

export const initialConv: ConvItem[] = [
  { file: "990_model.ifc", st: "running" },
  { file: "fixture-bytes.ifc", st: "failed" },
  { file: "許良宇圖書館建築_2026.ifc", st: "done", metrics: "12.4M tris · 98%" },
];

export const initialSessions: SessionItem[] = [
  { id: "S-240601", lease: "editor lease", stage: "/Review/A1_Tower_fed.usd" },
];

export const initialOutbox: OutboxItem[] = [
  { id: "OB-201", kind: "conversion-result", st: "待送" },
  { id: "OB-202", kind: "issue-snapshot", st: "待送" },
  { id: "OB-200", kind: "conversion-result", st: "已送" },
];

export const initialIssues: IssueItem[] = [
  { id: "ISS-101", title: "FD-4F-02 防火時效不足(30min < 60min)", st: "open", src: "rule-run #87" },
  { id: "ISS-098", title: "B-3F-12 樑位移 +42mm 超容差", st: "in-review", src: "diff v11→v12" },
];

/* ── ops 服務健康 6 項（原型固定 ok:true）── */
export interface ServiceDef { name: string; port: string; ok: boolean; }
export const services: ServiceDef[] = [
  { name: "bim-review-coordinator", port: ":8004", ok: true },
  { name: "governance-service", port: ":49102", ok: true },
  { name: "conversion authority", port: ":49101", ok: true },
  { name: "Kit signaling / WebRTC", port: ":49100 / :47998", ok: true },
  { name: "kit-manager-api", port: ":8010", ok: true },
  { name: "MinIO watch", port: "s3 events", ok: true },
];

/* ── home 警示 / 事件 4 項 ── */
export interface AlertDef { msgZh: string; msgEn: string; t: string; c: string; }
export const alerts: AlertDef[] = [
  { msgZh: "rule-run #88 完成:嚴重 18 項", msgEn: "rule-run #88 done: 18 critical", t: "10:53", c: "var(--ab-danger)" },
  { msgZh: "990_model.ifc 轉檔完成,品質 98%", msgEn: "990_model.ifc converted, quality 98%", t: "10:20", c: "var(--ab-ok)" },
  { msgZh: "Outbox OB-201 重試 ×2", msgEn: "Outbox OB-201 retry ×2", t: "10:41", c: "var(--ab-warn)" },
  { msgZh: "S-240601 first-frame 1.84s", msgEn: "S-240601 first-frame 1.84s", t: "10:53", c: "var(--ab-accent)" },
];
```

- [ ] **Step 5: `fixtures.ts` 移除 7 個 export 與 2 個介面**

刪除下列區塊（Read 後逐字定位）：`export const initialIntake…];`、`export const initialConv…];`、`export const initialSessions…];`、`export const initialOutbox…];`、`export const initialIssues…];`、`/* ── ops 服務健康 6 項 ── */` 起至 `services` 陣列結尾、`/* ── home 警示 / 事件 4 項 ── */` 起至 `alerts` 陣列結尾。保留：`INITIAL_ISSUE_SEQ`、`initialRuleOn`、`initialFlags`、`INITIAL_DC_LOG`（WorkspacePage）、`ruleDefs`（docks；不在禁用清單）、`failDefs`／`diffDefs`／`fedMembers`／`stageTree`（slice-2 欠帳，見上）、所有型別、i18n、導覽、style helper。檔頭第 5 行註解 `// 本檔只含 fixture 資料與 style helper，不打任何 /api。` 改為 `// 本檔含 i18n 字典、導覽設定、style helper 與 A1–A3 dock 仍使用的原型資料（slice 2 承接）；home／pipeline／ops 的假資料已移至 __testdata__/prototypeFixtures.ts。`

- [ ] **Step 6: `UnifiedShell.tsx` provider seeds 縮為 issues／outbox／issueSeq**

(a) import 改為：

```ts
import {
  MONO, getL, navMain, apps, badgeTone, navItem, INITIAL_ISSUE_SEQ,
} from "./fixtures";
import type {
  ConceptKey, DockKey, IssueItem, OutboxItem, PageKey,
} from "./fixtures";
```

(b) `UnifiedStateShape` 與 provider 初值改為：

```ts
/* ═══ UnifiedState context（docks／WorkspacePage 的 issues/outbox local state + toast；intake/conv/sessions 已由共用 poller 取代）═══ */

export interface UnifiedStateShape {
  issues: IssueItem[];
  outbox: OutboxItem[];
  issueSeq: number;
}
```

```ts
  const [state, setState] = useState<UnifiedStateShape>(() => ({
    issues: [],
    outbox: [],
    issueSeq: INITIAL_ISSUE_SEQ,
  }));
```

（`docks.tsx` 的 `IssuesDock` 因此初始為空列表；其 `+ 10 open` 字面與 BCF／deliver 假 toast 屬 tasks §2.2／§2.3，本 slice 不動。）

- [ ] **Step 7: 5.2 解凍——`a1DockLive.test.tsx` 案 (b)**

把案 (b) 末段：

```ts
    // fixture 區塊維持原樣：dock 根仍 data-prov="fixture"、fixture CTA / 檔案列仍在。
    expect(container.querySelector('[data-uc="dock-cta"]')).not.toBeNull();
    expect(container.innerHTML).toContain("A1_Tower_v12.ifc");
    const dockRoot = container.querySelector('[data-prov="fixture"]');
    expect(dockRoot).not.toBeNull();
```

改為：

```ts
    // unified-console-runtime-truth（5.2）：不再凍結 fixture 區塊（A1_Tower_v12.ifc／data-prov="fixture" 根）；
    // 「liveBackend 時 fixture 互動由真值與真頁導向取代」的正向斷言隨 slice 2（tasks §2.2／§3.1）落地。
    expect(container.querySelector('[data-uc="dock-cta"]')).not.toBeNull();
```

案名 `"(b) health 成功：live 區塊出現（data-prov=asbuilt）、近期 rule-runs 真資料渲染，fixture 區塊不變"` 改為 `"(b) health 成功：live 區塊出現（data-prov=asbuilt）、近期 rule-runs 真資料渲染"`。

- [ ] **Step 8: 跑測試、型別、全量**

```powershell
Set-Location $F
npx vitest run src/console/unified/fixtureNotInProduction.test.ts src/console/unified/a1DockLive.test.tsx src/console/unified/unified.test.tsx
npx tsc --noEmit
npx vitest run
```

預期：三檔 `passed`；tsc exit 0（若 `docks.tsx` 或 `WorkspacePage.tsx` 因 `UnifiedStateShape` 縮減報型別錯，代表它們有讀 `intake`／`conv`／`sessions`——回 Step 1 的 `rg` 確認；2026-08-25 查證為零命中）；全量 0 failed。

- [ ] **Step 9: production bundle 掃描（tasks 1.8 驗證條件）**

```powershell
Set-Location $F
npm run build:ui
rg -c "GPU/Stream 82%" dist-ui; if ($LASTEXITCODE -eq 1) { "OK: bundle has no 'GPU/Stream 82%'" }
rg -c "990_model.ifc|S-240601|OB-201|rule-run #88" dist-ui; if ($LASTEXITCODE -eq 1) { "OK: bundle has no home/pipeline/ops prototype literals" }
```

預期：`vite build` 成功（`dist-ui/index.html` 存在）；兩個 `rg` 皆無命中並印出 OK 行。（`A1_Tower_v12.ifc`／`/Models/ARCH/A1_Tower.usd` 等 docks／WorkspacePage 字面仍在 bundle，屬 slice-2 欠帳，不在本步驟斷言。）

- [ ] **Step 10: Commit**

```powershell
Set-Location $W
git add web-viewer-sample/src/console/unified/__testdata__/prototypeFixtures.ts web-viewer-sample/src/console/unified/fixtures.ts web-viewer-sample/src/console/unified/UnifiedShell.tsx web-viewer-sample/src/console/unified/fixtureNotInProduction.test.ts web-viewer-sample/src/console/unified/a1DockLive.test.tsx
git diff --cached --check
git commit -m "task#7: 假資料 export 移至 test-only（D1=P），provider seeds 縮減，符號層守門測試；5.2 解凍" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: semantic cases＋Playwright E2E＋收官（tasks 5.4、5.6、5.7）

> 本 task 由多個原 task 併成（額度／commit 錨點考量，coordinator 2026-08-25）：各子段（#### nA／nB…）的步驟、驗證與 commit 指令**逐字照做**，每段結尾的 commit 都要做；本 task 所有 commit message 一律以「task#<本 task 在 implementer 提示中的 index>: 」開頭再接原訊息。子段標題括號內的「原 Task N」對應文中所有「Task N Step M」的引用。

#### 5A. design-system semantic cases 改為誠實狀態斷言（tasks 5.4；case id 一律保留）（原 Task 8）

**Files:**
- Modify: `web-viewer-sample/e2e/design-system-semantic-cases.ts`（`homeCases`／`pipelineCases`／`opsCases` 三函式整段重寫；`workspaceCases` 的 `warning` 一案；`runtimeTruthCase` 拆成 fixture／truth 兩版）

**不動**：`docs/plans/design-system-reference.manifest.json`（`required_case_ids`／`implemented_case_ids` 皆維持 11 個）、`a4Cases`、`conceptCases`、`design-system-visual.spec.ts`、任何 golden。**機制面分類事實**（2026-08-25 查證）：`scripts/lib/self-referential-bootstrap.ps1` 的 `Get-SelfReferentialMechanismPaths` 未列 `web-viewer-sample/e2e/**`（只列 `web-viewer-sample/scripts/verify-design-system-pixels.mjs` 與 `scripts/lib/png-preflight.mjs`），故本檔修改不觸發 bootstrap ledger 義務，PR body 填 `Self-referential bootstrap: no`；tasks 5.4 的「登記 bootstrap ledger」字句與機器分類不一致，已列入 plan 回傳 blocker 交 coordinator 裁決。

gate 環境事實（`design-system-visual.spec.ts:199`）：`**/api/**` 一律 503 → 三屏所有真值 cell 為 `—`／`data-state="offline"`、svc-dot 全 `unknown`、chip 全 `unknown`、badge `—`、「最後更新 —」；`[data-uc="toast"]` 不會出現（本 slice 三頁沒有任何 toast 動作）。

- [ ] **Step 1: 拆 `runtimeTruthCase`**

把既有：

```ts
/** runtime_truth：data-prov="fixture" 揭露屬性存在 + 殼層 UnifiedConsole 註記。 */
const runtimeTruthCase = (): SemanticCaseDefinition => ({
  prepare: gotoFreshRoute,
  assertions: [
    { id: "fixture-provenance-marker", locator: '[data-prov="fixture"] >> nth=0', expectation: "visible" },
    { id: "console-runtime-note", locator: '[data-uc="runtime-note"]', expectation: "text_contains", expected: RUNTIME_NOTE },
  ],
});
```

改為：

```ts
/** runtime_truth（fixture 殼：workspace.a1–a3／concept）：data-prov="fixture" 揭露屬性存在 + 殼層 UnifiedConsole 註記。 */
const runtimeTruthCase = (): SemanticCaseDefinition => ({
  prepare: gotoFreshRoute,
  assertions: [
    { id: "fixture-provenance-marker", locator: '[data-prov="fixture"] >> nth=0', expectation: "visible" },
    { id: "console-runtime-note", locator: '[data-uc="runtime-note"]', expectation: "text_contains", expected: RUNTIME_NOTE },
  ],
});

/** runtime_truth（真值頁：home／pipeline／ops；unified-console-runtime-truth）：page-root 內帶 data-prov="asbuilt"、
    主值 cell 於 gate 503 環境為 offline、「最後更新 —」（無時間戳，確定性）+ 殼層註記。 */
const truthRuntimeTruthCase = (primaryValueUc: string): SemanticCaseDefinition => ({
  prepare: gotoFreshRoute,
  assertions: [
    { id: "asbuilt-provenance-marker", locator: '[data-uc="page-root"] [data-prov="asbuilt"] >> nth=0', expectation: "visible" },
    { id: "primary-value-offline-state", locator: `[data-uc="${primaryValueUc}"]`, expectation: "attribute_equals", attribute: "data-state", expected: "offline" },
    { id: "last-updated-deterministic-dash", locator: '[data-uc="last-updated"]', expectation: "text_contains", expected: "—" },
    { id: "console-runtime-note", locator: '[data-uc="runtime-note"]', expectation: "text_contains", expected: RUNTIME_NOTE },
  ],
});
```

（ops 頁沒有 `last-updated`，Step 4 的 `opsCases.runtime_truth` 用自己的三條斷言，不呼叫 `truthRuntimeTruthCase`。）

- [ ] **Step 2: 整段重寫 `homeCases()`**

```ts
/* ═══ console.home.default（#home）— 真值頁：gate 503 → 全部誠實 offline ═══ */

function homeCases(): ScreenCases {
  return {
    navigation: {
      prepare: gotoRoute,
      assertions: [
        { id: "sidebar-nav-home-active", locator: '[data-uc="nav-home"]', expectation: "attribute_equals", attribute: "data-active", expected: "true" },
        { id: "sidebar-workspace-group-label", locator: 'text="工作台"', expectation: "visible" },
      ],
    },
    primary_actions: {
      prepare: gotoRoute,
      assertions: [
        { id: "enter-pipeline-cta-visible", locator: '[data-uc="enter-pipeline"]', expectation: "visible" },
        { id: "enter-pipeline-cta-enabled", locator: '[data-uc="enter-pipeline"]', expectation: "enabled" },
        { id: "enter-pipeline-cta-label", locator: '[data-uc="enter-pipeline"]', expectation: "text_equals", expected: "進入生產線 →" },
        { id: "enter-pipeline-cta-is-nav", locator: '[data-uc="enter-pipeline"]', expectation: "attribute_equals", attribute: "data-action", expected: "nav" },
      ],
    },
    loading: {
      // 進行中狀態的誠實表面：「轉檔中」KPI 在後端不可達時不得顯示任何數字（— + offline），不宣稱有進行中轉檔。
      prepare: gotoRoute,
      assertions: [
        { id: "kpi-converting-count", locator: '[data-uc="kpi-conv-val"]', expectation: "text_equals", expected: "—" },
        { id: "kpi-converting-offline-state", locator: '[data-uc="kpi-conv-val"]', expectation: "attribute_equals", attribute: "data-state", expected: "offline" },
      ],
    },
    empty: {
      // 可達空狀態：home 無 toast 動作 → toast host 不渲染；服務健康列表存在但無任何 ok 宣稱。
      prepare: gotoRoute,
      assertions: [
        { id: "toast-host-empty", locator: '[data-uc="toast"]', expectation: "count_equals", expected: 0 },
        { id: "service-dots-present", locator: '[data-uc="svc-dot"]', expectation: "count_equals", expected: 6 },
      ],
    },
    success: {
      // 成功表面（綠點）機制存在；gate 環境不可達 → 不得有任何綠點（誠實：0 個 ok）。
      prepare: gotoRoute,
      assertions: [
        { id: "no-ok-service-dots-offline", locator: '[data-uc="svc-dot"][data-health="ok"]', expectation: "count_equals", expected: 0 },
      ],
    },
    warning: {
      // 琥珀狀態：Outbox 待送 KPI 與 Coordinator chip 誠實標未連線（琥珀）。
      prepare: gotoRoute,
      assertions: [
        { id: "kpi-outbox-pending-count", locator: '[data-uc="kpi-outbox-val"]', expectation: "text_equals", expected: "—" },
        { id: "coordinator-chip-unknown", locator: '[data-uc="chip-coordinator"]', expectation: "attribute_equals", attribute: "data-health", expected: "unknown" },
      ],
    },
    failure: {
      // 紅色表面：既無捏造的「1 失敗」紅字，也無紅點（不可達 ≠ 失敗）。
      prepare: gotoRoute,
      assertions: [
        { id: "kpi-conv-failed-red-text", locator: "text=1 失敗", expectation: "count_equals", expected: 0 },
        { id: "no-degraded-service-dots-offline", locator: '[data-uc="svc-dot"][data-health="degraded"]', expectation: "count_equals", expected: 0 },
      ],
    },
    disabled: {
      // 誠實對映：home 沒有可停用的控制項（KPI 卡與快照皆為 nav）；aria-disabled="true" 計數 0。
      prepare: gotoRoute,
      assertions: [
        { id: "no-disabled-controls-on-home", locator: '[aria-disabled="true"]', expectation: "count_equals", expected: 0 },
      ],
    },
    confirmation: {
      // 主 CTA 的確認回饋 = 點「進入生產線」後生產線頁標題出現（導覽，非假 toast）。
      prepare: async (context) => {
        await gotoRoute(context);
        await clickFirst(context.page, '[data-uc="enter-pipeline"]');
      },
      assertions: [
        { id: "pipeline-page-opened", locator: "text=模型資料與轉檔生產線", expectation: "visible" },
      ],
    },
    i18n_zh_tw: {
      prepare: gotoRoute,
      assertions: [
        { id: "zh-home-title", locator: "text=總覽 · Mission Control", expectation: "visible" },
        { id: "zh-offline-label", locator: '[data-uc="kpi-conv-sub"]', expectation: "text_equals", expected: "未連線" },
        langZhActive,
      ],
    },
    runtime_truth: truthRuntimeTruthCase("kpi-conv-val"),
  };
}
```

- [ ] **Step 3: `workspaceCases` 的 `warning` 一案**

把：

```ts
    warning: {
      // 琥珀狀態：側欄「模型資料與轉檔」的 warn badge = 未完成轉檔數 2（running+failed）。
      prepare: gotoRoute,
      assertions: [
        { id: "nav-pipe-warn-badge-visible", locator: '[data-uc="nav-pipe-badge"]', expectation: "visible" },
        { id: "nav-pipe-warn-badge-count", locator: '[data-uc="nav-pipe-badge"]', expectation: "text_equals", expected: "2" },
      ],
    },
```

改為：

```ts
    warning: {
      // 琥珀狀態：側欄「模型資料與轉檔」badge 為真值（running+failed）；gate 503 → 誠實顯示 —（offline），不捏造數字。
      prepare: gotoRoute,
      assertions: [
        { id: "nav-pipe-warn-badge-visible", locator: '[data-uc="nav-pipe-badge"]', expectation: "visible" },
        { id: "nav-pipe-warn-badge-count", locator: '[data-uc="nav-pipe-badge"]', expectation: "text_equals", expected: "—" },
      ],
    },
```

- [ ] **Step 4: 整段重寫 `pipelineCases()` 與 `opsCases()`**

```ts
/* ═══ pipeline.default（#pipeline）— 真值頁 ═══ */

function pipelineCases(): ScreenCases {
  return {
    navigation: {
      prepare: gotoRoute,
      assertions: [
        { id: "sidebar-nav-pipe-active", locator: '[data-uc="nav-pipe"]', expectation: "attribute_equals", attribute: "data-active", expected: "true" },
        { id: "nav-pipe-badge-initial", locator: '[data-uc="nav-pipe-badge"]', expectation: "text_equals", expected: "—" },
      ],
    },
    primary_actions: {
      // 主要動作面：「觸發轉檔」存在但誠實停用（D2 授權於 slice 2）；真頁導向連結可用。
      prepare: gotoRoute,
      assertions: [
        { id: "trigger-conv-visible", locator: '[data-uc="trigger-conv"]', expectation: "visible" },
        { id: "trigger-conv-honest-disabled", locator: '[data-uc="trigger-conv"]', expectation: "attribute_equals", attribute: "data-action", expected: "disabled" },
        { id: "trigger-conv-label", locator: '[data-uc="trigger-conv"]', expectation: "text_equals", expected: "觸發轉檔" },
        { id: "to-minio-nav-enabled", locator: '[data-uc="to-minio"]', expectation: "enabled" },
      ],
    },
    loading: {
      // 進行中狀態：running 計數在不可達時為 — / offline，不宣稱任何進行中轉檔。
      prepare: gotoRoute,
      assertions: [
        { id: "converting-count-offline", locator: '[data-uc="conv-running-val"]', expectation: "text_equals", expected: "—" },
        { id: "converting-offline-state", locator: '[data-uc="conv-running-val"]', expectation: "attribute_equals", attribute: "data-state", expected: "offline" },
      ],
    },
    empty: {
      // 可達空狀態：3D handoff 段無 session anchor（不可達時不渲染任何 /ui/open 連結，亦無 iframe）。
      prepare: gotoRoute,
      assertions: [
        { id: "no-handoff-links", locator: '[data-uc="handoff-link"]', expectation: "count_equals", expected: 0 },
        { id: "no-live-iframe", locator: "iframe", expectation: "count_equals", expected: 0 },
      ],
    },
    success: {
      // 完成表面：ready 計數 cell 存在，不可達時不得顯示任何完成數字。
      prepare: gotoRoute,
      assertions: [
        { id: "ready-count-offline", locator: '[data-uc="conv-ready-val"]', expectation: "text_equals", expected: "—" },
      ],
    },
    warning: {
      // 琥珀狀態：Outbox 待送與 MinIO watch 皆誠實 —（offline）。
      prepare: gotoRoute,
      assertions: [
        { id: "outbox-pending-offline", locator: '[data-uc="outbox-pending-val"]', expectation: "text_equals", expected: "—" },
        { id: "watch-status-offline", locator: '[data-uc="intake-watch-val"]', expectation: "attribute_equals", attribute: "data-state", expected: "offline" },
      ],
    },
    failure: {
      // 紅色表面：failed 計數不可達為 —；無捏造的重試鈕。
      prepare: gotoRoute,
      assertions: [
        { id: "failed-count-offline", locator: '[data-uc="conv-failed-val"]', expectation: "text_equals", expected: "—" },
        { id: "no-fake-retry-button", locator: "text=重試", expectation: "count_equals", expected: 0 },
      ],
    },
    disabled: {
      // 誠實停用：觸發轉檔 aria-disabled + 原因（aria-describedby）。
      prepare: gotoRoute,
      assertions: [
        { id: "trigger-aria-disabled", locator: '[data-uc="trigger-conv"]', expectation: "attribute_equals", attribute: "aria-disabled", expected: "true" },
        { id: "trigger-disabled-state", locator: '[data-uc="trigger-conv"]', expectation: "disabled" },
        { id: "trigger-reason-visible", locator: '[data-uc="trigger-conv-reason"]', expectation: "visible" },
      ],
    },
    confirmation: {
      // 點停用的觸發鈕 → 不得出現任何成功回饋（無 toast）。
      prepare: async (context) => {
        await gotoRoute(context);
        await context.page.locator('[data-uc="trigger-conv"]').first().click({ force: true });
      },
      assertions: [
        { id: "no-fake-success-toast", locator: '[data-uc="toast"]', expectation: "count_equals", expected: 0 },
      ],
    },
    i18n_zh_tw: {
      prepare: gotoRoute,
      assertions: [
        { id: "zh-pipeline-title", locator: "text=模型資料與轉檔生產線", expectation: "visible" },
        { id: "zh-rvt-retired", locator: '[data-uc="rvt-retired"]', expectation: "text_contains", expected: "已退役" },
        langZhActive,
      ],
    },
    runtime_truth: truthRuntimeTruthCase("conv-ready-val"),
  };
}

/* ═══ runtime.ops.default（#runtime）— 真值頁 ═══ */

function opsCases(): ScreenCases {
  return {
    navigation: {
      prepare: gotoRoute,
      assertions: [
        { id: "sidebar-nav-ops-active", locator: '[data-uc="nav-ops"]', expectation: "attribute_equals", attribute: "data-active", expected: "true" },
        { id: "sidebar-nav-home-inactive", locator: '[data-uc="nav-home"]', expectation: "attribute_equals", attribute: "data-active", expected: "false" },
      ],
    },
    primary_actions: {
      prepare: gotoRoute,
      assertions: [
        { id: "to-instances-visible", locator: '[data-uc="to-instances"]', expectation: "visible" },
        { id: "to-instances-enabled", locator: '[data-uc="to-instances"]', expectation: "enabled" },
        { id: "to-instances-is-nav", locator: '[data-uc="to-instances"]', expectation: "attribute_equals", attribute: "data-action", expected: "nav" },
      ],
    },
    loading: {
      // 進行中狀態：Kit instance 不可達 → — / offline（不宣稱 running）。
      prepare: gotoRoute,
      assertions: [
        { id: "kit-instance-offline", locator: '[data-uc="kit-instance-id"]', expectation: "text_equals", expected: "—" },
        { id: "kit-instance-offline-state", locator: '[data-uc="kit-instance-id"]', expectation: "attribute_equals", attribute: "data-state", expected: "offline" },
      ],
    },
    empty: {
      prepare: gotoRoute,
      assertions: [
        { id: "toast-host-empty", locator: '[data-uc="toast"]', expectation: "count_equals", expected: 0 },
      ],
    },
    success: {
      // 六顆服務點存在；不可達 → 0 個 ok（不捏造全綠）。
      prepare: gotoRoute,
      assertions: [
        { id: "service-dots-total", locator: '[data-uc="svc-dot"]', expectation: "count_equals", expected: 6 },
        { id: "no-ok-service-dots-offline", locator: '[data-uc="svc-dot"][data-health="ok"]', expectation: "count_equals", expected: 0 },
      ],
    },
    warning: {
      // 琥珀狀態：Kit Runtime chip 未連線；GPU 卡 —。
      prepare: gotoRoute,
      assertions: [
        { id: "kit-chip-unknown", locator: '[data-uc="chip-kit"]', expectation: "attribute_equals", attribute: "data-health", expected: "unknown" },
        { id: "gpu-card-offline", locator: '[data-uc="gpu-val"]', expectation: "text_equals", expected: "—" },
      ],
    },
    failure: {
      // 紅色表面：紅點機制存在，不可達 ≠ 失敗 → 0 個 degraded。
      prepare: gotoRoute,
      assertions: [
        { id: "failed-service-dots-count", locator: '[data-uc="svc-dot"][data-health="degraded"]', expectation: "count_equals", expected: 0 },
      ],
    },
    disabled: {
      // 誠實停用：事件流控制項 aria-disabled + 原因。
      prepare: gotoRoute,
      assertions: [
        { id: "events-aria-disabled", locator: '[data-uc="events-disabled"]', expectation: "attribute_equals", attribute: "aria-disabled", expected: "true" },
        { id: "events-disabled-state", locator: '[data-uc="events-disabled"]', expectation: "disabled" },
        { id: "events-reason-visible", locator: '[data-uc="events-reason"]', expectation: "visible" },
      ],
    },
    confirmation: {
      // 點停用的事件流控制項 → 無任何成功回饋（無 toast）。
      prepare: async (context) => {
        await gotoRoute(context);
        await context.page.locator('[data-uc="events-disabled"]').first().click({ force: true });
      },
      assertions: [
        { id: "no-fake-success-toast", locator: '[data-uc="toast"]', expectation: "count_equals", expected: 0 },
      ],
    },
    i18n_zh_tw: {
      prepare: gotoRoute,
      assertions: [
        { id: "zh-service-health-label", locator: 'text="服務健康"', expectation: "visible" },
        langZhActive,
      ],
    },
    runtime_truth: {
      prepare: gotoFreshRoute,
      assertions: [
        { id: "asbuilt-provenance-marker", locator: '[data-uc="page-root"] [data-prov="asbuilt"] >> nth=0', expectation: "visible" },
        { id: "gpu-offline-state-no-number", locator: '[data-uc="gpu-val"]', expectation: "attribute_equals", attribute: "data-state", expected: "offline" },
        { id: "no-fixed-gpu-percent", locator: "text=82%", expectation: "count_equals", expected: 0 },
        { id: "console-runtime-note", locator: '[data-uc="runtime-note"]', expectation: "text_contains", expected: RUNTIME_NOTE },
      ],
    },
  };
}
```

檔頭的「誠實原則」註解（`// - runtime_truth 一律斷言 data-prov="fixture" 揭露屬性與…`）改為：`// - runtime_truth：fixture 殼（workspace.a1–a3／concept）斷言 data-prov="fixture"；真值頁（home／pipeline／ops，unified-console-runtime-truth）斷言 page-root 內 data-prov="asbuilt" 且主值 cell 為 offline（gate 503 環境）。`

- [ ] **Step 5: 乾淨工作樹後跑四屏 design gate（semantic 必綠；pixel 預期紅）**

先 commit（gate 要求工作樹乾淨，`design-system-visual.spec.ts:187`）：

```powershell
Set-Location $W
git add web-viewer-sample/e2e/design-system-semantic-cases.ts
git diff --cached --check
git commit -m "task#8: design-system semantic cases 改為誠實狀態斷言（home／pipeline／ops 三屏＋workspace badge），case id 不變" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git status --porcelain=v1 --untracked-files=all
```

預期最後一行無輸出（乾淨）。再跑：

```powershell
Set-Location $F
$env:DESIGN_SYSTEM_SCREEN_IDS = 'console.home.default,pipeline.default,runtime.ops.default,workspace.a1.default'
npm run test:visual:design-system
Remove-Item Env:DESIGN_SYSTEM_SCREEN_IDS
Set-Location $W
node -e "const r=require('./artifacts/e2e/design-system-visual-result.json'); for (const s of r.screens) console.log(s.id, 'semantic_parity=' + s.semantic_parity, 'failed_cases=' + JSON.stringify(Object.entries(s.semantic_states).filter(([,v])=>!v).map(([k])=>k))); console.log('non-pixel failures:', JSON.stringify(r.failures.filter(f=>!/diff ratio/.test(f))));"
```

預期：Playwright 本身回報 **failed**（pixel diff ratio > 0.01 於 home／pipeline／ops／workspace.a1 四屏——golden 仍是 fixture 畫面，spec §2 明示預期紅，5.5 rebaseline 由 coordinator 於 owner 明示後執行）；但 node 摘要必須為：四屏 `semantic_parity=1`、`failed_cases=[]`、`non-pixel failures: []`。任何 semantic case 失敗 → 修 case 或頁面後重 commit 再跑（不得改 manifest、不得 rebaseline）。把 node 摘要輸出存到 `$W\artifacts\slice1-design-gate-summary.txt`（PR body 用）。

---

#### 5B. Playwright E2E（P4 browser evidence：真後端 `:8004` 的 vertical slice）（原 Task 9）

**Files:**
- Create: `web-viewer-sample/e2e/unified-console-runtime-truth.spec.ts`
- Evidence: `artifacts/e2e/unified-console-runtime-truth-{home,pipeline,runtime,offline}.png`（`.gitignore` 擋 png → `git add -f`；內容只含 127.0.0.1 本機資料，無 LAN IP／主機名／bucket key）

前置（乾淨環境必做；同 `e2e/a1-m1-closeout.spec.ts` 檔頭）：

```powershell
Set-Location $F
npm run build:ui
# 重啟服務 :8004 的 coordinator，使其 CONSOLE_DIST_DIR 指向上面的 dist-ui（docker 佔 :8004 時須重建容器；見記憶「EdgeConsole 是 /ui 門面」）。
# 啟動前先清 host-native port（scripts/dev/ensure-host-native-ports-free.ps1，若存在）。
```

- [ ] **Step 1: 建立 spec**

```ts
import { test, expect, type APIRequestContext, type Page, type Request } from "@playwright/test";

// unified-console-runtime-truth slice 1 — P4 browser evidence（真後端：本機 coordinator :8004 服務的 dist-ui）。
// *** 前置（同 a1-m1-closeout.spec.ts 檔頭）：
//   1. cd web-viewer-sample && npm run build:ui        # 用本 branch 的碼重 build dist-ui
//   2. 重啟服務 :8004 的 coordinator（CONSOLE_DIST_DIR 指向該 dist-ui；docker 佔 :8004 時須重建容器）
//   3. coordinator 跑別的 port 只允許用 E2E_COORDINATOR_BASE_URL 指向「本機」stack；不得改打其他 host。
// 不可達 → test.skip 訊息前綴 `stack_down:`（E2E_REQUIRE_REAL=1 時 forbid-skipped reporter 視 skip 為失敗，不假綠）。
// 執行：$env:E2E_DISABLE_WEBSERVER='1'; npx playwright test e2e/unified-console-runtime-truth.spec.ts --reporter=list
const COORDINATOR = process.env.E2E_COORDINATOR_BASE_URL || "http://127.0.0.1:8004";
const SHOT = (name: string) => `../artifacts/e2e/unified-console-runtime-truth-${name}.png`;
const OFFLINE_HTTP = new Set([502, 503, 504]);
const IN_PROGRESS = new Set(["detected", "queued", "converting"]);

type Json = Record<string, unknown>;
async function api(request: APIRequestContext, path: string): Promise<{ status: number; body: Json | null }> {
  try {
    const res = await request.get(`${COORDINATOR}${path}`, { timeout: 10_000 });
    let body: Json | null = null;
    try { body = (await res.json()) as Json; } catch { body = null; }
    return { status: res.status(), body };
  } catch {
    return { status: 0, body: null };
  }
}
/** 前端渲染規則（runtimeTruth.ts cellText）的鏡像：2xx→format(body)；502/503/504／網路→「—」；其他非 2xx→狀態碼。 */
function expectedText(r: { status: number; body: Json | null }, format: (b: Json) => string): string {
  if (r.status >= 200 && r.status < 300 && r.body) return format(r.body);
  if (r.status === 0 || OFFLINE_HTTP.has(r.status)) return "—";
  return String(r.status);
}
const uc = (page: Page, id: string) => page.locator(`[data-uc="${id}"]`);
/** 一律先過 about:blank 造成 full document load（hash-only goto 是 same-document navigation，store 單例會存活）。 */
async function fresh(page: Page, hash: string): Promise<void> {
  await page.goto("about:blank");
  await page.goto(`${COORDINATOR}/ui${hash}`);
  await page.locator('[data-uc="page-root"]').waitFor({ state: "visible", timeout: 15_000 });
}

test.describe("unified-console-runtime-truth slice 1：/ui 預設入口真值（真後端 :8004）", () => {
  test.setTimeout(120_000);

  test.beforeEach(async ({ request, page }) => {
    const probe = await api(request, "/api/runtime/status");
    test.skip(probe.status === 0, "stack_down: coordinator :8004 不可達（需本機 coordinator 啟動；不得改打其他 host）");
    let uiOk = false;
    try {
      await page.goto(`${COORDINATOR}/ui#home`);
      await page.locator('[data-uc="kpi-conv-val"]').waitFor({ state: "visible", timeout: 15_000 });
      uiOk = true;
    } catch {
      uiOk = false;
    }
    test.skip(!uiOk, "stack_down: :8004 服務的 dist-ui 非本 branch（#home 缺 kpi-conv-val）：npm run build:ui 後重啟 coordinator");
  });

  test("#home 四 KPI 與同分鐘 API JSON 一致；值帶 asbuilt＋四值 data-state；無 fixture 固定值", async ({ page, request }) => {
    await fresh(page, "#home");
    await expect.poll(async () => {
      const [rt, recs, issues, outbox] = await Promise.all([
        api(request, "/api/runtime/status"),
        api(request, "/api/conversion/records?limit=100"),
        api(request, "/api/governance/issues"),
        api(request, "/api/callback-outbox/summary?limit=200"),
      ]);
      const expected = {
        sess: expectedText(rt, (b) => String((b.sessions as Json).active_count)),
        conv: expectedText(recs, (b) => {
          const items = b.items as Json[];
          return (b.count as number) > items.length ? "未取得" : String(items.filter((r) => IN_PROGRESS.has(r.status as string)).length);
        }),
        issue: expectedText(issues, (b) => String((b.issues as Json[]).filter((i) => !["resolved", "rejected"].includes(i.status as string)).length)),
        outbox: expectedText(outbox, (b) => {
          const entries = b.entries as Json[];
          return (b.total as number) > entries.length ? "未取得" : String(entries.filter((e) => e.status === "pending").length);
        }),
      };
      const ui = {
        sess: await uc(page, "kpi-sess-val").textContent(),
        conv: await uc(page, "kpi-conv-val").textContent(),
        issue: await uc(page, "kpi-issue-val").textContent(),
        outbox: await uc(page, "kpi-outbox-val").textContent(),
      };
      return JSON.stringify(ui) === JSON.stringify(expected) ? "match" : `ui=${JSON.stringify(ui)} api=${JSON.stringify(expected)}`;
    }, { timeout: 30_000, intervals: [1_000] }).toBe("match");
    for (const id of ["kpi-conv-val", "kpi-sess-val", "kpi-issue-val", "kpi-outbox-val"]) {
      await expect(uc(page, id)).toHaveAttribute("data-prov", "asbuilt");
      await expect(uc(page, id)).toHaveAttribute("data-state", /^(live|unavailable|offline|error)$/);
    }
    await expect(page.locator('[data-uc="svc-dot"]')).toHaveCount(6);
    await expect(page.locator('[data-uc="page-root"]')).not.toContainText("2026-07-14");
    await expect(page.locator('[data-uc="page-root"]')).not.toContainText("990_model.ifc");
    await page.screenshot({ path: SHOT("home"), fullPage: true });
  });

  test("#home KPI 卡為 nav：點「活躍 Sessions」導向 #sessions（legacy 真頁，無 page-root）", async ({ page }) => {
    await fresh(page, "#home");
    await expect(uc(page, "kpi-sess")).toHaveAttribute("data-action", "nav");
    await uc(page, "kpi-sess").click();
    await expect(page).toHaveURL(/#\/?sessions$/);
    await expect(page.locator('[data-uc="page-root"]')).toHaveCount(0);
  });

  test("#pipeline 五段真值＋runtime ID（Kit instance／session handoff）；不打 /api/internal、/api/dev；觸發轉檔 disabled 不發請求", async ({ page, request }) => {
    const urls: string[] = [];
    page.on("request", (req: Request) => { urls.push(req.url()); });
    await fresh(page, "#pipeline");
    const kit = await api(request, "/api/kit/instances/current");
    await expect(uc(page, "kit-instance-val")).toHaveText(expectedText(kit, (b) => `${b.instance_id} ${b.status}`), { timeout: 20_000 });
    const rt = await api(request, "/api/runtime/status");
    if (rt.status === 200 && rt.body) {
      const sessions = rt.body.sessions as Json;
      const items = sessions.items as Json[];
      await expect(uc(page, "sess-active-val")).toHaveText(String(sessions.active_count));
      if (items.length === 0) {
        await expect(uc(page, "handoff-none")).toBeVisible();
      } else {
        await expect(page.locator('[data-uc="handoff-link"]')).toHaveCount(items.length);
        await expect(page.locator('[data-uc="handoff-link"]').first()).toHaveAttribute("href", new RegExp(`/ui/open\\?session=${String(items[0].session_id)}`));
        await expect(page.locator('[data-uc="handoff-link"]').first()).toHaveAttribute("target", "_blank");
      }
    } else {
      await expect(uc(page, "handoff-state")).toBeVisible();
    }
    await expect(page.locator("iframe")).toHaveCount(0);
    await expect(uc(page, "rvt-retired")).toContainText("已退役");
    await expect(uc(page, "trigger-conv")).toHaveAttribute("aria-disabled", "true");
    await uc(page, "trigger-conv").click({ force: true });
    await page.waitForTimeout(1_000);
    expect(urls.filter((u) => u.includes("/api/conversion/trigger"))).toEqual([]);
    expect(urls.filter((u) => u.includes("/api/internal/") || u.includes("/api/dev/"))).toEqual([]);
    expect(urls.filter((u) => u.includes("/api/callback-outbox/summary")).length).toBeGreaterThan(0);
    await page.screenshot({ path: SHOT("pipeline"), fullPage: true });
  });

  test("#runtime：GPU 未取得（unavailable，非數字）、Kit instance 真值、六 svc-dot、事件列 disabled", async ({ page, request }) => {
    await fresh(page, "#runtime");
    const rt = await api(request, "/api/runtime/status");
    const kit = await api(request, "/api/kit/instances/current");
    await expect(uc(page, "kit-instance-id")).toHaveText(expectedText(kit, (b) => String(b.instance_id)), { timeout: 20_000 });
    await expect(uc(page, "gpu-val")).toHaveText(expectedText(rt, () => "未取得"));
    await expect(uc(page, "gpu-val")).toHaveAttribute("data-state", rt.status === 200 ? "unavailable" : /^(offline|error)$/);
    await expect(page.locator('[data-uc="svc-dot"]')).toHaveCount(6);
    for (const dot of await page.locator('[data-uc="svc-dot"]').all()) {
      expect(await dot.getAttribute("data-health")).toMatch(/^(ok|degraded|unknown)$/);
    }
    await expect(uc(page, "events-disabled")).toHaveAttribute("aria-disabled", "true");
    await expect(page.locator('[data-uc="page-root"]')).not.toContainText("82%");
    await expect(page.locator('[data-uc="page-root"]')).not.toContainText("14.6/24 GB");
    await page.screenshot({ path: SHOT("runtime"), fullPage: true });
  });

  test("failure → retry：/api/** 503 時 KPI 顯示 —／未連線；解除後於退避上限內恢復 live", async ({ page }) => {
    await page.route("**/api/**", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "e2e_offline" }) }));
    await fresh(page, "#home");
    await expect(uc(page, "kpi-sess-val")).toHaveText("—");
    await expect(uc(page, "kpi-sess-val")).toHaveAttribute("data-state", "offline");
    await expect(uc(page, "kpi-sess-sub")).toHaveText("未連線");
    await expect(uc(page, "last-updated")).toContainText("—");
    await expect(uc(page, "chip-coordinator")).toHaveAttribute("data-health", "unknown");
    await page.screenshot({ path: SHOT("offline"), fullPage: true });
    await page.unroute("**/api/**");
    // 退避：10s→20s→40s（上限 60s）；解除 stub 後最遲於下一輪（≤60s）恢復。
    await expect(uc(page, "kpi-sess-val")).toHaveAttribute("data-state", "live", { timeout: 75_000 });
    await expect(uc(page, "last-updated")).toHaveText(/最後更新 \d{2}:\d{2}:\d{2}/);
  });

  test("loading：API 延遲時先顯示 —（永不以 0 佔位），回應後轉 live", async ({ page }) => {
    await page.route("**/api/runtime/status", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2_500));
      await route.continue();
    });
    await fresh(page, "#home");
    await expect(uc(page, "kpi-sess-val")).toHaveText("—");
    await expect(uc(page, "kpi-sess-val")).toHaveAttribute("data-state", "offline");
    await expect(uc(page, "kpi-sess-val")).toHaveAttribute("data-state", /^(live|error)$/, { timeout: 20_000 });
    await page.unroute("**/api/runtime/status");
  });

  test("共用 poller：#pipeline（殼層與頁面同訂閱 /api/runtime/status）10.5s 內同端點請求 ≤ 2（初次＋一輪）", async ({ page }) => {
    const hits: number[] = [];
    page.on("request", (req: Request) => { if (req.url().includes("/api/runtime/status")) hits.push(Date.now()); });
    await fresh(page, "#pipeline");
    await page.waitForTimeout(10_500);
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits.length).toBeLessThanOrEqual(2);
  });
});
```

- [ ] **Step 2: 執行（真後端）**

```powershell
Set-Location $F
$env:E2E_DISABLE_WEBSERVER = '1'
npx playwright test e2e/unified-console-runtime-truth.spec.ts --reporter=list
Remove-Item Env:E2E_DISABLE_WEBSERVER
```

預期：`7 passed`；若前置未備妥則每案 `skipped` 且訊息以 `stack_down:` 開頭（**不是 pass**；不得以 skip 交差——備妥 stack 後重跑）。四張截圖落在 `$W\artifacts\e2e\unified-console-runtime-truth-*.png`。

- [ ] **Step 3: Commit（截圖 `git add -f`）**

```powershell
Set-Location $W
git add web-viewer-sample/e2e/unified-console-runtime-truth.spec.ts
git add -f artifacts/e2e/unified-console-runtime-truth-home.png artifacts/e2e/unified-console-runtime-truth-pipeline.png artifacts/e2e/unified-console-runtime-truth-runtime.png artifacts/e2e/unified-console-runtime-truth-offline.png
git diff --cached --check
git commit -m "task#9: Playwright E2E——/ui 預設入口真值 vertical slice（真後端 :8004；KPI↔API 對照、handoff anchor、offline→retry、loading、單一 in-flight）" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

#### 5C. 收官——全量 gate（5.6／5.7）、detect-changes、tasks.md 子彈、PR 證據包（原 Task 10）

**Files:**
- Modify: `openspec/changes/unified-console-runtime-truth/tasks.md`（只加子彈，不打勾）
- Modify: `docs/superpowers/plans/2026-08-25-unified-console-runtime-truth-s1.md`（勾選）
- 產出（ignored，供 coordinator 組 PR body）：`$W\artifacts\slice1-impact.txt`、`slice1-shape-inventory.md`、`slice1-design-gate-summary.txt`、`slice1-gates.txt`

- [ ] **Step 1: 前端全量（5.7）＋ lint baseline**

```powershell
Set-Location $F
npx tsc --noEmit
npx vitest run
npm run lint:baseline
npm run build:ui
```

預期：tsc exit 0；vitest 0 failed（新增 9 個測試檔皆綠）；`lint:baseline` 不得回報超出既有 baseline 的新錯誤（若新檔有 lint 錯誤，只修新檔）；build 成功。把四個指令的最後結果行貼進 `$W\artifacts\slice1-gates.txt`。

- [ ] **Step 2: 乾淨工作樹跑兩道 required gate（5.6）**

```powershell
Set-Location $W
git status --porcelain=v1 --untracked-files=all   # 必須無輸出；有輸出先 commit 或還原
Set-Location $F
Remove-Item Env:DESIGN_SYSTEM_SCREEN_IDS -ErrorAction SilentlyContinue
npm run test:visual:design-system
Set-Location $W
node -e "const r=require('./artifacts/e2e/design-system-visual-result.json'); console.log('status', r.status, 'subject', r.subject_commit); for (const s of r.screens) console.log(s.id, 'semantic_parity=' + s.semantic_parity, 'diff=' + s.viewports.map(v=>v.diff_pixel_ratio.toFixed(4)).join('/')); console.log('non-pixel failures:', JSON.stringify(r.failures.filter(f=>!/diff ratio/.test(f))));" | Tee-Object -FilePath artifacts/slice1-design-gate-summary.txt
pwsh -NoProfile -File .\scripts\tests\verify-design-system-reference.ps1 -VerifyOrigin
Set-Location $F
npm run test:functional-runtime
```

預期：design gate `status failed`（**預期**：`console.home.default`／`pipeline.default`／`runtime.ops.default`／`workspace.a1.default`／`workspace.a2.default`／`workspace.a3.default` 六屏 `diff > 0.01`——golden 仍為 fixture 畫面，5.5 rebaseline 由 coordinator 於 owner 明示後執行），13 屏 `semantic_parity=1`，`non-pixel failures: []`，`workspace.a4.default` 與 `concept.a5–a10` 的 diff ≤ 0.01；`verify-design-system-reference.ps1 -VerifyOrigin` 通過（`workspace.a4.default` digest 未動）；`functional-runtime-conv` 需本機 stack——通過則記 result 路徑 `artifacts/e2e/functional-runtime/functional-runtime-result.json`，stack 不可用則在 `slice1-gates.txt` 記 `functional-runtime-conv: stack_down（未跑，非 pass）`。

- [ ] **Step 3: GitNexus detect-changes**

```powershell
Set-Location $W
npx gitnexus@1.6.9 detect-changes --scope compare --base-ref main
```

預期：列出的變更 symbol 只在 `web-viewer-sample/src/console/coordinatorClient.ts`（`jsonGet`、`coordinatorClient`、`CoordinatorHttpError`）、`src/console/unified/**`（`UnifiedShell`／`ShellFrame`／`UnifiedStateProvider`／`HomePage`／`PipelinePage`／`OpsPage`／新模組）、測試檔與 `e2e/**`。linked worktree 看不到 staged／commit 時：`git diff --name-only main...HEAD` 並在 `slice1-gates.txt` 記 `detectVerdict='fallback'`。任何 `bim-review-coordinator/**` 或 `docs/plans/**` 出現在清單 → 立即停下（超出 slice 範圍）。

- [ ] **Step 4: `tasks.md` 只加子彈（不打勾）**

```powershell
Set-Location $W
$sha = git rev-parse --short HEAD
```

在 `openspec/changes/unified-console-runtime-truth/tasks.md` 下列 task 行的**下一行**各加一個縮排子彈（`  - `），逐字：

| task 行 | 子彈內容 |
|---|---|
| `- [ ] 1.1 impact 分析…` | `  - 本機完成：六 symbol 皆 LOW（artifacts/slice1-impact.txt，PR body 附），待 181 隨 slice 1 勾選（commit \`<sha>\`）` |
| `- [ ] 1.2 端點欄位 shape 盤點…` | `  - 本機完成：盤點表附於 PR body（十端點皆存在，無新增），待 181 隨 slice 1 勾選（commit \`<sha>\`）` |
| `- [ ] 1.3 共用 poller store…` | `  - 本機綠，待 181（slice 1，commit \`<sha>\`）` |
| `- [ ] 1.4 \`#home\`…` | `  - 本機綠，待 181（slice 1，commit \`<sha>\`）` |
| `- [ ] 1.5 \`#pipeline\`…` | `  - 本機綠，待 181（slice 1，commit \`<sha>\`；has_source_ifc 逐物件觸發列表隨 D2 授權於 §4.2／§2.4 落地，本 slice 為 disabled＋原因）` |
| `- [ ] 1.6 \`#runtime\`…` | `  - 本機綠，待 181（slice 1，commit \`<sha>\`）` |
| `- [ ] 1.7 頂列 GPU chip…` | `  - 本機綠，待 181（slice 1，commit \`<sha>\`；\`rg -n "82%" web-viewer-sample/src/console/unified\` 為空）` |
| `- [ ] 1.8 假資料 export…` | `  - 本機綠，待 181（slice 1，commit \`<sha>\`；7 個 export 已移 test-only，\`failDefs\`／\`diffDefs\`／\`fedMembers\`／\`stageTree\` 由 docks／WorkspacePage 續用，以 fixtureNotInProduction.test.ts ratchet 釘住，§2／§3 切片承接）` |
| `- [ ] 5.1 更新 \`src/console/EdgeConsole.sharedstatus.test.tsx…\`` | `  - 本機綠，待 181（slice 1，commit \`<sha>\`）` |
| `- [ ] 5.2 更新 \`src/console/unified/a1DockLive.test.tsx…\`` | `  - 本機綠（解凍 fixture 斷言），待 181；「真值取代」正向斷言隨 §2.2／§3.1 落地（slice 1，commit \`<sha>\`）` |
| `- [ ] 5.3 更新 \`src/console/unified/unified.test.tsx\`…` | `  - 本機綠，待 181（slice 1，commit \`<sha>\`）` |
| `- [ ] 5.4 更新 \`web-viewer-sample/e2e/design-system-semantic-cases.ts\`…` | `  - 本機：13 屏 semantic_parity=1；pixel 六屏預期紅（待 5.5 owner rebaseline）；\`web-viewer-sample/e2e/**\` 非 \`Get-SelfReferentialMechanismPaths\` 機制面，bootstrap ledger 未登記（PR body \`Self-referential bootstrap: no\`），待 181（slice 1，commit \`<sha>\`）` |
| `- [ ] 5.6 乾淨工作樹跑兩道 required gate…` | `  - 本機：design-semantic-visual semantic 全綠、pixel 六屏預期紅；functional-runtime-conv 結果見 PR body（slice 1，commit \`<sha>\`）` |
| `- [ ] 5.7 前端全量…` | `  - 本機綠，待 181（slice 1，commit \`<sha>\`）` |

（`<sha>` 以 `$sha` 實際值取代；所有 `- [ ]` 維持未勾。）

- [ ] **Step 5: 最終 commit 與回報**

```powershell
Set-Location $W
git add openspec/changes/unified-console-runtime-truth/tasks.md docs/superpowers/plans/2026-08-25-unified-console-runtime-truth-s1.md
git diff --cached --check
git commit -m "task#10: tasks.md 註記本機綠待 181；plan 勾選收官" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git log --oneline main..HEAD
```

預期：`main..HEAD` 顯示 `task#1`、`task#2`、`task#3a`、`task#3b`、`task#3c`、`task#4`…`task#10` 共十二個 commit（加上本 plan 的 `plan:` commit 與既有 `docs(spec-to-done)` commit）。push 與開 PR（tasks 7.5：`Design gate status` 逐字＝機器算出值、bootstrap 三欄、frontend Known gaps 表、`kit_gpu` 表＋Actions URL）由 coordinator 執行；`scripts/dev/check-pr-local-preflight.ps1 -PrNumber <PR 號>` 於 PR 開立後由 coordinator 跑。回報 coordinator 時附：`artifacts/slice1-*.txt`／`.md` 四檔、四張截圖路徑、design gate 六屏預期紅的 diff ratio、`detectVerdict`。

---

## Blocker／裁決點（plan 作者回傳 coordinator；未裁前依本 plan 的保守處置執行）

> **coordinator 裁決（2026-08-25，依 owner 授權）**：#1 維持保守處置——4 個 export 留 §2／§3 切片、ratchet 釘住，tasks 1.8 子彈如實寫「7/11」。#2 依機器真相不登記；`Self-referential bootstrap` 欄位由 coordinator 於 P6 依 checker 實際規則定案，implementer 不撰寫 PR body。#3 接受（5.2 只解凍）。#4 rebaseline 由 coordinator 於 P3 完成後親自執行（owner 已明示授權），implementer 不得執行任何 `--rebaseline`。#5、#6、#8 接受。#7 維持不打勾 1.1／1.2（`task_ledger` 6/43 不變）。

1. **tasks 1.8 的 docks／WorkspacePage 部分與 spec §3「§2／§3 out of scope」衝突**：`failDefs`／`diffDefs`／`fedMembers`（`docks.tsx`）與 `stageTree`（`WorkspacePage.tsx`）的唯一消費者是 A1–A3 dock 互動與 A1 視區（§2.2／§2.3／§3.1）。本 plan 只搬 7 個、以 `fixtureNotInProduction.test.ts` ratchet 釘住 4 個欠帳；`tasks.md` 1.8 子彈如實揭露。需裁決：擴大 slice 1 納入 docks／WorkspacePage 的資料移除，或維持留 slice 2。
2. **tasks 5.4／spec「登記 bootstrap ledger」與機器分類不一致**：`Get-SelfReferentialMechanismPaths` 未列 `web-viewer-sample/e2e/**`（只列 `verify-design-system-pixels.mjs`／`png-preflight.mjs`），且 ledger 現有 open entry（`autonomous-linux-delivery-contracts`, PR #557）會擋新 entry。本 plan 依機器真相不登記、PR body 填 `Self-referential bootstrap: no`。需裁決是否改機制清單（那屬 mechanism-surface 修改，另開 successor）。
3. **5.2 只能「解凍」**：docks 未改前無法斷言「liveBackend 時 fixture 由真值取代」；正向斷言隨 §2.2／§3.1 落地。
4. **pixel 預期紅**：home／pipeline／ops／workspace.a1–a3 六屏 golden 仍為 fixture；5.5 雙旗標 rebaseline 只能由 coordinator 於 owner 明示後執行（本 plan 無此步驟）。PR body `Design gate status` 由機器算出（`mixed`），不得手填。
5. **`#home` 應用啟動器仍帶 `data-prov="fixture"`**：A1–A4 `LIVE` badge 文字屬 §2.3；本 slice 保留該區塊誠實標記，故 semantic `runtime_truth` 改以 `page-root` 內 `asbuilt` 存在＋主值 offline 斷言，而非「無 fixture 標記」。
6. **頂列「Demo Project – A1 Tower」與 `#pipeline` 的「觸發轉檔」按鈕**：前者不在 1.8 的 11 個 export 清單內（殼層字面），本 slice 未動；後者依 design §4 以 `disabled`＋`data-prov="p1"`＋原因呈現，逐物件 `has_source_ifc` 觸發列表隨 D2（§4.2／§2.4）落地。
7. **tasks 1.1／1.2 不打勾**：雖非 UI task，但 `task_ledger` 需維持 6/43（spec §3），本 plan 只加子彈；是否可於本 PR 勾選 1.1／1.2 由 coordinator 依 `openspec/lifecycle-ledger.json` 對帳規則裁決。
8. **`unified-console-routes.spec.ts:34` 依賴「GPU Fleet」字串**：本 plan 保留卡片標題以免該既有 e2e 退化；若 owner 要改標題，需同步該 spec。
9. **Task 1A Step 1 的 HIGH 停點未履行（fixer 2026-08-25 補報；本項未裁，待事後追認）**：`jsonGet` 實跑 `"risk": "HIGH"`／`"impactedCount": 16`（plan 預期 LOW），依 1A Step 1「任一為 HIGH／CRITICAL → 停止並回報 coordinator」與 repo `CLAUDE.md` GitNexus 政策（`MUST warn ... if impact analysis returns HIGH or CRITICAL`／`NEVER ignore HIGH or CRITICAL risk warnings`）應停止並回報；當輪 implementer 未停止、未回報，於 ignored 的 `artifacts/slice1-impact.txt` 自記續行理由後打勾，並完成 Step 2–6、commit `157a4aa`（`CoordinatorHttpError` 落地）。需裁決：(a) 事後追認該 HIGH 續行、維持現行程式碼，或 (b) 要求回退／改以其他形式攜帶 `status`／`path`。未裁前程式碼維持現狀（fixer 未改任何 production code），PR body「blast radius」段須如實揭露 `jsonGet = HIGH(16)` 與本項未裁狀態，不得只列 LOW。覆核證據見 1A Step 1 下方「實跑偏離」註記。 **第二輪 fixer 處置（2026-08-25）**：六筆 impact 全數獨立重跑覆核（`jsonGet` HIGH／16；其餘五筆 LOW，`impactedCount` 依序 0／2／2／2／2），56 tests passed、`tsc --noEmit` exit 0，數值已補入 1A Step 1 下方註記成為可 commit 的正本；停點的「回報 coordinator」半邊已補行回報，Step 1 勾選已撤回為 `[ ]`（HELD）。**本項仍未裁**——追認後由 coordinator 勾回 Step 1，要求回退則另開回退 task；production code 至今未因本項更動。 → **coordinator 裁決（2026-08-25）：(a) 追認續行、維持現行程式碼；本項關閉。** 理由：spec-to-done skill 明定 HIGH 非停下點（回報 blast radius 後續行），且已於 P1 回報使用者；補強策略（message 逐字不變＋既有 16 個 caller 的測試全綠）寫入 PR body。task#0 的 quality review 因本輪 hold 未執行，交 P5 對抗複驗覆蓋（registry 帶入）。

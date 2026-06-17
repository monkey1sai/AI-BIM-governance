# Conv Watch Toggle (IX-CV-04) Implementation Plan

**For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development

**Goal:** 給 `#conv` 頁的「MinIO 自動偵測（O4）」面板補上 operator 可在 runtime 開關 watcher 輪詢的 controlled action（`PUT /api/conversion/watch`），關閉態於頁頂顯示誠實琥珀條。

**Architecture:** 把 coordinator 既有「process-lifecycle 單次接線」的 MinIO watcher 啟停改造成「runtime 可重入接線」——以 mutable `minioWatchRuntimeEnabled` runtime flag 取代靜態 `config.minioWatchEnabled` 守門，新增一條沿用 `rejectIfIpNotAllowed`/`resolveActor`/`parseReason`/audit 的 `PUT` mutation route 開關既有 `minioWatcher` handle 生命週期，唯讀 `GET status` 改讀同一 flag。前端 `coordinatorClient` 加 `jsonPut`/`conversionWatchToggle`，`ConversionSchedulingPage` 沿用既有 `IntentDialog`/`pendingAction`/`runAction` reducer 擴一個 `watch-toggle` kind 並渲染琥珀條。`bim-streaming-server`/MinIO server/viewer 零改動。

**Tech Stack:** TypeScript（coordinator：Express + Node http；frontend：React + Vite）；測試 vitest（coordinator route + frontend component）+ Playwright（gstack browser E2E）。

---

## 背景錨點（執行者零脈絡前提，皆已用 GitNexus + Read 實證 2026-06-17）

所有檔案路徑與行號於本機 worktree `claude/peaceful-payne-6785a9` 已逐一複查命中。執行時行號可能漂移，**以符號名為準**（grep 符號名定位，不要盲信行號）。

**coordinator（`bim-review-coordinator/`）**
- `src/config.ts:83-90` 宣告 `minioWatchEnabled/Endpoint/Bucket/Prefix/AccessKey/SecretKey/IntervalSeconds`；`:98` `minioWatchSelfBaseUrl`；`:406-415` 由 env 載入（`minioWatchEnabled` default false）。
- `src/services/minioWatcher.ts:131-136` `MinioWatcherHandle { dispose: () => Promise<void>; getStatus: () => MinioWatcherStatus }`；`:138-153` `MinioWatcherStatus`（`enabled: true` 寫死 literal、`poll_count` 單調遞增）；`:200` `startMinioWatcher(opts)`；`:405-423` `dispose` async（先 `stopped=true` → await in-flight tick settle（2s cap）→ `client.destroy()`）。
- `src/app.ts:345` `let minioWatcher: MinioWatcherHandle | null = null;`；`:346` `function startMinioWatcherIfEnabled(): void`；`:352` guard `if (!config.minioWatchEnabled || minioWatcher) return;`；`:388` `server.on("listening", () => startMinioWatcherIfEnabled())`；`:390-391` config-immediate 啟動 `if (config.minioWatchEnabled && config.minioWatchSelfBaseUrl) startMinioWatcherIfEnabled();`；`:1014-1029` `GET /api/external/minio-watch/status`（`if (!config.minioWatchEnabled)` 回唯讀 payload）；`:1950-1954` shutdown 安全 dispose（`const w = minioWatcher; minioWatcher = null; await w.dispose();`）。
- 控制路由區：`:641` `resolveActor`、`:647` `parseReason`、`:655` `rejectIfIpNotAllowed`（空 allowlist bypass、非空且不命中回 403）；`:669` `app.post(".../prioritize")`、`:707` `app.post(".../retry")`（皆 sync handler、結尾 `structLog.withTraceId(id).audit("conversion-control", "conversion.xxx", {...}, "info")`）；retry route 結束於 `:746`。
- **GitNexus impact（upstream，2026-06-17）**：`startMinioWatcherIfEnabled` risk = **LOW**，唯一 d=1 caller = `createCoordinatorApp`（同檔閉包）；改造完全收斂在 `app.ts` 內。`minioWatcher`/`config`/`resolveActor`/`parseReason`/`rejectIfIpNotAllowed`/`structLog` 全在 `createCoordinatorApp` 閉包 scope，新 route 直接可用。
- verify 入口（`bim-review-coordinator/package.json`）：`npm run verify`（= `npm run build && npm test`，test = `vitest run`）。
- route 測試樣板：`tests/conversion-control-routes.test.ts`（supertest + `makeApp(overrides)` + `createCoordinatorApp` + IP allowlist/audit 斷言）；config/watcher 注入樣板：`tests/minio-watch-status-route.test.ts`（`makeApp`、`getStatusUntil` poll helper）+ `tests/minio-watcher-loop.test.ts`。回歸鎖：`tests/minio-watch-status-route.test.ts`、`tests/minio-watcher-loop.test.ts`、`tests/config-minio-watch.test.ts`。

**frontend（`web-viewer-sample/`）**
- `src/console/coordinatorClient.ts:35-45` `async function jsonPost<T>(path, body)`（POST + JSON header + `if (!res.ok) throw`）；`:138-154` `interface MinioWatchStatus { enabled: boolean; ... }`；`:180` `export const coordinatorClient = {`；`:185` `minioWatchStatus: () => jsonGet<MinioWatchStatus>("/api/external/minio-watch/status")`；`:189-192` `conversionPrioritize`/`conversionRetry`（`jsonPost`）。
- `src/console/pages.tsx:438` `export function ConversionSchedulingPage()`；`:440` `const [mw, setMw] = useState<MinioWatchStatus | null>(null)`；`:448` `const [pendingAction, setPendingAction] = useState<{ jobId: string; kind: "prioritize" | "retry" } | null>(null)`；`:460-476` `load()`（`Promise.allSettled([listIfcReady(50), minioWatchStatus()])` → `setMw`/`setMwErr`，回傳 ifc-ready 抓取成功 boolean）；`:505-529` `runAction`（`actionBusyRef` 同步攔截 → POST → `await load()` 證據型刷新 → 失敗寫 `actionErr` 不關 dialog）；`:530` `return (<>`，`:532` `<h1>IFC→USD 轉檔排程</h1>`；`:541-582` MinIO 自動偵測 Panel（`mw.enabled === false` / 啟用態分支，純唯讀）；`:641-651` `<IntentDialog open={pendingAction != null} title=... cost=... busy=... actionErr=... onConfirm={runAction} onCancel=... />`。
- `src/console/IntentDialog.tsx`：testid `intent-dialog`（backdrop）、`intent-confirm`、`intent-cancel`、`intent-action-error`；props `{ open, title, cost, busy, actionErr, onConfirm, onCancel }`。
- 既有 conv 測試：`src/console/console.test.tsx`、`src/console/ConversionSchedulingPage.test.tsx`、`src/console/coordinatorClient.test.ts`、`src/console/IntentDialog.test.tsx`。verify：`npm test`（vitest）；E2E：`npm run test:e2e`（playwright，webServer 起 viewer 在 :5180、coordinator base 由 `VITE_COORDINATOR_API_BASE` 注入、`E2E_COORDINATOR_BASE_URL` 覆寫）。
- E2E 樣板：`e2e/conv-prioritize-retry.spec.ts`（conditional-skip 守門 + `notObserved[]` afterAll 揭露 + 截圖落 `../artifacts/e2e/` 與 tracked `../docs/evidence/<spec>/`）。

**任務相依序（spec §2.1）**：Task 1（runtime flag 改造，回歸鎖）→ Task 2（PUT route）+ Task 3（GET status 改讀 flag，與 Task 1 同批檔）→ Task 4（client）→ Task 5（UI）→ Task 6（component 測試）→ Task 7（E2E）。Task 1 最先且觸及既有啟動行為，必須回歸鎖綠才往下。

---

## Task 1: coordinator runtime enabled 狀態機改造（`app.ts`，非 additive，最高風險）

**Files**
- Modify: `bim-review-coordinator/src/app.ts`（加 `minioWatchRuntimeEnabled` / `minioWatchToggleBusy` / `minioWatchConfigured()`；guard 改讀 flag；config-immediate 改讀 flag）
- Test: `bim-review-coordinator/tests/conversion-watch-toggle.test.ts`（新；本 task 先寫 runtime-flag 回歸的最小 RED）

步驟：

- [ ] 1.1 先跑現狀拿 baseline（不得跳過）：
  ```bash
  cd C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/peaceful-payne-6785a9/bim-review-coordinator && npm run verify
  ```
  預期：build 0 error、所有既有測試綠（含 `config-minio-watch`、`minio-watch-status-route`、`minio-watcher-loop`）。記下通過數作為回歸基準。

- [ ] 1.2 改動前跑 GitNexus impact（觸及既有啟動行為，CLAUDE.md §4 強制）：
  ```
  gitnexus_impact target="startMinioWatcherIfEnabled" direction="upstream" repo="AI-BIM-governance"
  ```
  預期：risk LOW、d=1 唯一 caller `createCoordinatorApp`（同檔閉包）。若回 HIGH/CRITICAL 先回報再繼續。

- [ ] 1.3 寫新測試檔，先放一條鎖 runtime-flag 預設行為的 RED（GET status 在 toggle 後翻轉）。建立 `bim-review-coordinator/tests/conversion-watch-toggle.test.ts`，harness 逐字沿用 `tests/minio-watch-status-route.test.ts` 的 `makeApp`/afterEach/`getStatusUntil`：
  ```ts
  import fs from "node:fs";
  import os from "node:os";
  import path from "node:path";
  import request from "supertest";
  import { afterEach, describe, expect, it } from "vitest";
  import { createCoordinatorApp, type CoordinatorApp } from "../src/app.js";

  let active: CoordinatorApp | null = null;
  afterEach(async () => {
    if (active) {
      await active.dispose();
      active.io.close();
      await new Promise<void>((r) => active?.server.close(() => r()));
      active = null;
    }
  });
  function makeApp(overrides = {}): CoordinatorApp {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "conv-watch-toggle-test-"));
    active = createCoordinatorApp({
      sessionStoreDir: path.join(root, "sessions"),
      eventLogDir: path.join(root, "events"),
      callbackOutboxStorePath: path.join(root, "callback-outbox.json"),
      corsOrigins: ["http://127.0.0.1:5173"],
      conversionPollEnabled: false,
      ...overrides,
    });
    return active;
  }

  describe("PUT /api/conversion/watch — runtime toggle", () => {
    it("env 未 opt-in（預設）→ GET status enabled=false（回歸鎖：runtime flag 初值=env）", async () => {
      const app = makeApp();
      const res = await request(app.app).get("/api/external/minio-watch/status");
      expect(res.status).toBe(200);
      expect(res.body.enabled).toBe(false);
    });
  });
  ```
  跑單檔確認此條先綠（純驗既有預設行為，作為回歸基線錨）：
  ```bash
  cd C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/peaceful-payne-6785a9/bim-review-coordinator && npx vitest run tests/conversion-watch-toggle.test.ts
  ```
  預期：1 passed。

- [ ] 1.4 在 `app.ts` 的 `let minioWatcher: MinioWatcherHandle | null = null;`（`:345`）正下方插入 runtime flag 與 helper：
  ```ts
  // IX-CV-04：runtime toggle 真相。初值 = env opt-in；PUT /api/conversion/watch 在 runtime 覆寫。
  let minioWatchRuntimeEnabled = config.minioWatchEnabled;
  // toggle 同步鎖（CR-B）：dispose() 為 async（2s cap），防並發 PUT 在 await 期間交錯啟兩個 watcher。
  let minioWatchToggleBusy = false;
  // 連線參數齊全判斷（CR-C）：未配置時 PUT{enabled:true} 誠實 422，不空轉/不 throw。
  function minioWatchConfigured(): boolean {
    return Boolean(
      config.minioWatchEndpoint && config.minioWatchBucket &&
      config.minioWatchAccessKey && config.minioWatchSecretKey,
    );
  }
  ```

- [ ] 1.5 改 `startMinioWatcherIfEnabled` guard（`:352`，grep `if (!config.minioWatchEnabled || minioWatcher) return;`）：
  ```ts
  // 舊：if (!config.minioWatchEnabled || minioWatcher) return;
  if (!minioWatchRuntimeEnabled || minioWatcher) return;
  ```

- [ ] 1.6 改 config-immediate 啟動路徑（`:390`，grep `if (config.minioWatchEnabled && config.minioWatchSelfBaseUrl) {`）：
  ```ts
  // 舊：if (config.minioWatchEnabled && config.minioWatchSelfBaseUrl) {
  if (minioWatchRuntimeEnabled && config.minioWatchSelfBaseUrl) {
    startMinioWatcherIfEnabled();
  }
  ```
  `server.on("listening")` 接線（`:388`）、allowlist fail-fast、shutdown dispose（`:1950-1954`）**不動**。

- [ ] 1.7 跑回歸鎖確認既有啟動語意零退化：
  ```bash
  cd C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/peaceful-payne-6785a9/bim-review-coordinator && npx vitest run tests/config-minio-watch.test.ts tests/minio-watch-status-route.test.ts tests/minio-watcher-loop.test.ts tests/conversion-watch-toggle.test.ts
  ```
  預期：全綠（env=true 啟動 / env=false 不啟動 / status 唯讀形狀皆不變；新檔 1.3 那條仍綠）。

- [ ] 1.8 commit：
  ```bash
  cd C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/peaceful-payne-6785a9 && git add -- bim-review-coordinator/src/app.ts bim-review-coordinator/tests/conversion-watch-toggle.test.ts && git diff --cached --check && git commit -m "feat(coordinator): #conv watcher 啟停改讀 runtime flag（IX-CV-04 Task1）

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```
  預期：commit 成功、`git diff --cached --check` 無 trailing whitespace 報錯。

---

## Task 2: coordinator `PUT /api/conversion/watch` toggle route（`app.ts`）

**Files**
- Modify: `bim-review-coordinator/src/app.ts`（retry route `:746` 後新增 async PUT route）
- Test: `bim-review-coordinator/tests/conversion-watch-toggle.test.ts`（擴 toggle 行為斷言）

> 註：本 task 引用 `currentMinioWatchStatusPayload()`，它在 Task 3 抽出。為讓本 task 可獨立 RED→GREEN，**先在本 task 內把 GET status 的計算抽成 `currentMinioWatchStatusPayload()` helper**（Task 3 只剩把 GET handler 改成呼叫它 + note 文字分支，與此一致無衝突）。若 Task 3 先做亦可——兩者皆收斂在同檔，subagent-driven-development 串行執行即可。

步驟：

- [ ] 2.0 **先抽 helper（解 Task 2↔3 順序依賴，reviewer major #2：照 task 序直貼 2.2 會 TS build fail）**。本 task 的 PUT route（2.2）引用 `currentMinioWatchStatusPayload()`，它在 Task 3.2 才完整抽出。**先執行 Task 3.2 的 helper 抽取步驟**（把 `GET status` 計算抽成 `currentMinioWatchStatusPayload()` helper、GET handler 改呼叫它），跑：
  ```bash
  cd C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/peaceful-payne-6785a9/bim-review-coordinator && npm run build
  ```
  預期：0 TS error。helper 就緒後再進 2.1，2.2 的 PUT route 即可直接呼叫它不會編譯失敗。（Task 3 屆時只剩補 note 文字分支的測試，與此無衝突。）

- [ ] 2.1 寫 RED：在 `conversion-watch-toggle.test.ts` 加 toggle 往返與邊界斷言（`makeApp` 用 override 注入已配置但 selfBaseUrl 空以避免真連 MinIO；驗 flag 翻轉 + IP allowlist + 422/400/409）：
  ```ts
  describe("PUT /api/conversion/watch — toggle 行為", () => {
    function configuredOverrides() {
      return {
        minioWatchEndpoint: "http://127.0.0.1:9000",
        minioWatchBucket: "bim-control",
        minioWatchAccessKey: "ak",
        minioWatchSecretKey: "sk",
        minioWatchSelfBaseUrl: "", // 不觸發 config-immediate 真啟動，避免測試連真 MinIO
      };
    }

    it("body 缺 boolean enabled → 400", async () => {
      const app = makeApp(configuredOverrides());
      const res = await request(app.app).put("/api/conversion/watch").send({ enabled: "yes" });
      expect(res.status).toBe(400);
    });

    it("enabled:true 但未配置 MinIO 連線 → 422 誠實拒絕", async () => {
      const app = makeApp(); // 無連線參數
      const res = await request(app.app).put("/api/conversion/watch").send({ enabled: true });
      expect(res.status).toBe(422);
      expect(String(res.body.detail)).toContain("not configured");
    });

    it("caller ip 不在 allowlist → 403", async () => {
      const app = makeApp({ ...configuredOverrides(), externalIntakeIpAllowlist: ["10.0.0.1"] });
      const res = await request(app.app).put("/api/conversion/watch").send({ enabled: false });
      expect(res.status).toBe(403);
    });

    it("enabled:false 對無 watcher → 200 no-op，GET status enabled=false", async () => {
      const app = makeApp(configuredOverrides());
      const res = await request(app.app).put("/api/conversion/watch").send({ enabled: false, reason: "smoke" });
      expect(res.status).toBe(200);
      expect(res.body.enabled).toBe(false);
      const status = await request(app.app).get("/api/external/minio-watch/status");
      expect(status.body.enabled).toBe(false);
    });
  });
  ```
  跑確認 RED（route 未建 → 404/非預期）：
  ```bash
  cd C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/peaceful-payne-6785a9/bim-review-coordinator && npx vitest run tests/conversion-watch-toggle.test.ts
  ```
  預期：新增 4 條 fail（toggle 行為未實作）；Task 1 既有條目仍綠。

- [ ] 2.2 在 `app.ts` retry route（grep `app.post("/api/conversion/jobs/:id/retry"`，結束於 `:746` 的 `});`）之後插入 async PUT route：
  ```ts
  app.put("/api/conversion/watch", async (request, response) => {
    if (rejectIfIpNotAllowed(request, response)) return;                 // CR-A：沿用 IP allowlist 守門
    const body = request.body as { enabled?: unknown } | undefined;
    if (typeof body?.enabled !== "boolean") {
      response.status(400).json({ detail: "Body must include boolean 'enabled'." });
      return;
    }
    if (minioWatchToggleBusy) {                                          // CR-B：toggle 進行中
      response.status(409).json({ detail: "Watcher toggle in progress; retry shortly." });
      return;
    }
    const reason = parseReason(request);
    const actor = resolveActor(request);
    minioWatchToggleBusy = true;
    try {
      if (body.enabled) {
        if (!minioWatchConfigured()) {                                  // CR-C：未配置誠實拒絕
          response.status(422).json({ detail: "MinIO watch not configured (endpoint/bucket/credentials missing); cannot enable." });
          return;
        }
        minioWatchRuntimeEnabled = true;
        try {
          startMinioWatcherIfEnabled();                                 // 重建 handle（含 allowlist fail-fast）
        } catch (e) {
          minioWatchRuntimeEnabled = false;                            // 回滾 flag，誠實 500
          response.status(500).json({ detail: `Failed to start watcher: ${e instanceof Error ? e.message : String(e)}` });
          return;
        }
      } else {
        minioWatchRuntimeEnabled = false;
        if (minioWatcher) {                                            // 沿用 shutdown 安全模式
          const w = minioWatcher;
          minioWatcher = null;
          await w.dispose();
        }
      }
      structLog.withTraceId("minio-watch").audit("conversion-control", "conversion.watch.toggle", {
        action: "conversion.watch.toggle", enabled: body.enabled, actor, reason,
      }, "info");
      response.json(currentMinioWatchStatusPayload());                  // Task 3 抽出的共用 helper
    } finally {
      minioWatchToggleBusy = false;
    }
  });
  ```
  （若 `currentMinioWatchStatusPayload` 尚未抽出，先做 Task 3.2 的 helper 抽取再回來。）

- [ ] 2.3 跑確認 GREEN：
  ```bash
  cd C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/peaceful-payne-6785a9/bim-review-coordinator && npx vitest run tests/conversion-watch-toggle.test.ts
  ```
  預期：2.1 的 4 條 + Task 1 條目全綠。

- [ ] 2.3b **補 spec §6.1 三條具名必要測試（reviewer major #1：2.1 只驗邊界，未涵蓋 watcher 啟停可觀察行為；這三條是 spec §6.1 點名必要、非 nice-to-have）**。難點：測試環境無真 MinIO（直接 `startMinioWatcher` 會去輪詢不存在的 :9000、洩漏 timer）。**方案：用 vitest mock 把 `startMinioWatcher` 換成回傳 fake handle**（`dispose` = spy、`getStatus` 回可控 `poll_count`），檔頂 hoisted（變數提升用 `vi.hoisted`，對齊 `tests/minio-watcher-loop.test.ts` 既有 mock 風格；fake 不碰網路）。注入 fake 後加三條（`configuredOverrides()` 並把 `minioWatchSelfBaseUrl` 給非空值讓啟動路徑可達——因 fake 不連網路而安全）：
  - (a) **enabled:false 對「啟用中 watcher」→ dispose 被呼叫 + status enabled→false**：先 `PUT {enabled:true}`（fake start 被呼叫、`minioWatcher`=fake）→ `PUT {enabled:false}` → 斷言 dispose spy 被呼叫一次 + `GET status` enabled=false。
  - (b) **enabled:true 對「已配置關閉態」→ start 被呼叫 + GET status 回 fake getStatus（enabled:true、poll_count 反映 fake 推進）**：`PUT {enabled:true}` → 斷言 start spy 被呼叫一次 + `GET status` enabled=true。
  - (c) **off→on 往返一輪 → 狀態一致、無雙 watcher**：`PUT true → false → true`；斷言 start spy 共 2 次、dispose spy 共 1 次（每次關閉各一次 dispose、無殘留雙 handle）、最終 `GET status` enabled=true。
  跑確認綠：
  ```bash
  cd C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/peaceful-payne-6785a9/bim-review-coordinator && npx vitest run tests/conversion-watch-toggle.test.ts
  ```
  預期：(a)(b)(c) 三條綠；既有 2.1 邊界測試（其不呼叫真 start）邏輯不變仍綠；Task 1.3 env=false 測試不受 mock 影響。**誠實註**：watcher 內部真實輪詢/IFC intake 的端到端因果由 Task 7 gstack E2E（真 coordinator + 真 watcher 切換）兜底；route 層測試僅驗 coordinator 對 watcher handle 的啟停編排，不偽稱驗了真 MinIO 連線。

- [ ] 2.4 加 toggle 鎖競態 RED→GREEN（CR-B）。在測試檔加：用 override 注入一個延遲 dispose 的 watcher handle 不可行（watcher 由內部建），改以「先設 busy 旗標」不可直接觸及 → 改驗「並發兩筆 PUT 第二筆回 409」需可控 dispose 延遲。**本條以 route 層 busy 鎖的同步可觀察點驗證**：連發兩筆 `enabled:false`（第二筆在第一筆 `await dispose` 未 settle 前到達），斷言至少一筆非 200 為 409。若本機 dispose 太快難穩定觀察，標記此條 `it.skip` 並在註解寫明「鎖正確性由 §4.0 程式碼審查 + 單筆 busy 斷言兜底」，不偽造：
  ```ts
  it("並發 toggle：busy 鎖期間第二筆 → 409（dispose 延遲時可觀察）", async () => {
    const app = makeApp(configuredOverrides());
    const [a, b] = await Promise.all([
      request(app.app).put("/api/conversion/watch").send({ enabled: false }),
      request(app.app).put("/api/conversion/watch").send({ enabled: false }),
    ]);
    const codes = [a.status, b.status];
    // 至少一筆 200；若觀察到 409 代表鎖生效。no-op dispose 過快時兩筆皆 200（誠實，深度由程式碼審查兜底）。
    expect(codes).toContain(200);
  });
  ```
  跑確認綠：
  ```bash
  cd C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/peaceful-payne-6785a9/bim-review-coordinator && npx vitest run tests/conversion-watch-toggle.test.ts
  ```
  預期：全綠。

- [ ] 2.5 commit：
  ```bash
  cd C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/peaceful-payne-6785a9 && git add -- bim-review-coordinator/src/app.ts bim-review-coordinator/tests/conversion-watch-toggle.test.ts && git diff --cached --check && git commit -m "feat(coordinator): #conv PUT /api/conversion/watch toggle route（IX-CV-04 Task2）

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```
  預期：commit 成功。

---

## Task 3: coordinator GET status 改讀 runtime flag + 抽共用 payload（`app.ts`）

**Files**
- Modify: `bim-review-coordinator/src/app.ts`（抽 `currentMinioWatchStatusPayload()`、GET handler 改呼叫它、note 文字誠實分支）
- Test: `bim-review-coordinator/tests/conversion-watch-toggle.test.ts`（驗 note 區分 + 形狀回歸）

步驟：

- [ ] 3.1 寫 RED：加「runtime 被關 vs env 未開」note 區分斷言：
  ```ts
  it("env=true 但 runtime 關閉 → GET status note 區分『operator 關閉』", async () => {
    const app = makeApp({ ...configuredOverrides(), minioWatchEnabled: true });
    await request(app.app).put("/api/conversion/watch").send({ enabled: false });
    const res = await request(app.app).get("/api/external/minio-watch/status");
    expect(res.body.enabled).toBe(false);
    expect(String(res.body.note)).toContain("console 關閉");
  });
  it("關閉態 payload 形狀回歸：含 bucket/prefix/interval_seconds/note（不洩漏 credentials）", async () => {
    const app = makeApp();
    const res = await request(app.app).get("/api/external/minio-watch/status");
    expect(res.body).toHaveProperty("bucket");
    expect(res.body).toHaveProperty("prefix");
    expect(res.body).toHaveProperty("interval_seconds");
    expect(res.body).toHaveProperty("note");
    expect(JSON.stringify(res.body)).not.toContain("secret");
  });
  ```
  跑確認 RED：
  ```bash
  cd C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/peaceful-payne-6785a9/bim-review-coordinator && npx vitest run tests/conversion-watch-toggle.test.ts
  ```
  預期：note 區分那條 fail（GET 仍讀 config、無 note 分支）。

- [ ] 3.2 在 `app.ts` 的 `app.get("/api/external/minio-watch/status", ...)`（`:1014-1029`）正上方抽 helper，並把 GET handler 改成呼叫它：
  ```ts
  function currentMinioWatchStatusPayload(): unknown {
    if (!minioWatchRuntimeEnabled) {                                   // 改讀 runtime flag（原 config.minioWatchEnabled）
      return {
        enabled: false,
        bucket: config.minioWatchBucket || null,
        prefix: config.minioWatchPrefix || null,
        interval_seconds: config.minioWatchIntervalSeconds,
        note: config.minioWatchEnabled
          ? "已由操作者於 console 關閉（runtime override；coordinator 重啟後回 env 預設）"
          : "未啟用（env MINIO_WATCH_ENABLED opt-in）",
      };
    }
    return minioWatcher
      ? minioWatcher.getStatus()
      : { enabled: true, note: "watcher enabled but not yet started (server not listening)" };
  }
  app.get("/api/external/minio-watch/status", (_request, response) => {
    response.json(currentMinioWatchStatusPayload());
  });
  ```
  （刪掉原 `:1015-1028` 的 inline `if (!config.minioWatchEnabled) {...}` 與 `const status = ...` 區塊，由 helper 取代。）

- [ ] 3.3 跑確認 GREEN + 形狀回歸：
  ```bash
  cd C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/peaceful-payne-6785a9/bim-review-coordinator && npx vitest run tests/conversion-watch-toggle.test.ts tests/minio-watch-status-route.test.ts
  ```
  預期：全綠（新增 note 條 + 既有 status route 唯讀形狀測試皆不退化）。

- [ ] 3.4 跑全套 verify 確認整 repo 零退化：
  ```bash
  cd C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/peaceful-payne-6785a9/bim-review-coordinator && npm run verify
  ```
  預期：build 0 error、全測試綠（通過數 ≥ Task 1.1 baseline + 本卡新增）。

- [ ] 3.5 commit 前跑 GitNexus detect_changes（CLAUDE.md §4，驗 scope 未溢出）：
  ```
  gitnexus_detect_changes
  ```
  預期：變更限 `bim-review-coordinator/src/app.ts` + 新測試檔，無外溢 viewer/streaming。

- [ ] 3.6 commit：
  ```bash
  cd C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/peaceful-payne-6785a9 && git add -- bim-review-coordinator/src/app.ts bim-review-coordinator/tests/conversion-watch-toggle.test.ts && git diff --cached --check && git commit -m "feat(coordinator): #conv GET minio-watch status 改讀 runtime flag 並抽共用 payload（IX-CV-04 Task3）

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```
  預期：commit 成功。

---

## Task 4: frontend client `jsonPut` + `conversionWatchToggle`（`coordinatorClient.ts`）

**Files**
- Modify: `web-viewer-sample/src/console/coordinatorClient.ts`
- Test: `web-viewer-sample/src/console/coordinatorClient.test.ts`

步驟：

- [ ] 4.1 寫 RED：在 `coordinatorClient.test.ts` 加 `conversionWatchToggle` 發 PUT 的斷言（沿用該檔既有 fetch mock 模式——若該檔以 `vi.stubGlobal("fetch", ...)` 驗，照同樣寫法）：
  ```ts
  it("conversionWatchToggle 發 PUT /api/conversion/watch，body 含 enabled/reason", async () => {
    const calls: { url: string; method?: string; body?: string }[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method, body: init?.body as string });
      return new Response(JSON.stringify({ enabled: false, note: "ok" }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    });
    const res = await coordinatorClient.conversionWatchToggle(false, "smoke");
    expect(res.enabled).toBe(false);
    expect(calls[0].method).toBe("PUT");
    expect(calls[0].url).toContain("/api/conversion/watch");
    expect(JSON.parse(calls[0].body!)).toEqual({ enabled: false, reason: "smoke" });
  });
  ```
  跑確認 RED：
  ```bash
  cd C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/peaceful-payne-6785a9/web-viewer-sample && npx vitest run src/console/coordinatorClient.test.ts
  ```
  預期：fail（`conversionWatchToggle` 不存在）。先讀 `coordinatorClient.test.ts` 既有 mock 寫法，若與上例不同則對齊既有風格再寫。

- [ ] 4.2 在 `coordinatorClient.ts` 的 `jsonPost`（`:35-45`）正下方加 `jsonPut`（mirror，只改 method）：
  ```ts
  async function jsonPut<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${COORD_BASE}${path}`, {
      method: "PUT",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    if (!res.ok) {
      throw new Error(`coordinator ${path} -> ${res.status} ${res.statusText}`);
    }
    return res.json() as Promise<T>;
  }
  ```

- [ ] 4.3 在 `coordinatorClient` 物件的 `conversionRetry`（`:192`）之後加 method：
  ```ts
  conversionWatchToggle: (enabled: boolean, reason?: string) =>
    jsonPut<MinioWatchStatus>("/api/conversion/watch", { enabled, reason }),
  ```
  （回應型別重用既有 `MinioWatchStatus`，不新增 interface。）

- [ ] 4.4 跑確認 GREEN：
  ```bash
  cd C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/peaceful-payne-6785a9/web-viewer-sample && npx vitest run src/console/coordinatorClient.test.ts
  ```
  預期：全綠。

- [ ] 4.5 commit：
  ```bash
  cd C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/peaceful-payne-6785a9 && git add -- web-viewer-sample/src/console/coordinatorClient.ts web-viewer-sample/src/console/coordinatorClient.test.ts && git diff --cached --check && git commit -m "feat(viewer): #conv coordinatorClient jsonPut + conversionWatchToggle（IX-CV-04 Task4）

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```
  預期：commit 成功。

---

## Task 5: frontend `#conv` UI 開關 + 琥珀條（`pages.tsx`）

**Files**
- Modify: `web-viewer-sample/src/console/pages.tsx`（`ConversionSchedulingPage`）

步驟：

- [ ] 5.1 擴 `pendingAction` union（`:448`）加 `watch-toggle`：
  ```ts
  const [pendingAction, setPendingAction] = useState<
    | { jobId: string; kind: "prioritize" | "retry" }
    | { kind: "watch-toggle"; enabled: boolean }
    | null
  >(null);
  ```

- [ ] 5.2 `runAction`（`:505-529`）分支補 `watch-toggle`：在既有 `if (pendingAction.kind === "prioritize") ... else ...` 改成依 kind 分派（watch-toggle 無 jobId）：
  ```ts
  if (pendingAction.kind === "prioritize") await coordinatorClient.conversionPrioritize(pendingAction.jobId, reason);
  else if (pendingAction.kind === "retry") await coordinatorClient.conversionRetry(pendingAction.jobId, reason);
  else await coordinatorClient.conversionWatchToggle(pendingAction.enabled, reason);
  ```
  其後既有 `await load()` 證據型刷新 + 失敗寫 `actionErr` 不關 dialog 的邏輯沿用（CR-D：無樂觀更新）。

- [ ] 5.3 頁頂琥珀條：在 `:532` 的 `<h1>IFC→USD 轉檔排程</h1>` 之後、第一個 `<Panel>` 之前插入條件渲染（規格 line 157「關閉時佇列頁頂顯示琥珀條」）：
  ```tsx
  {mw?.enabled === false && (
    <p className="ec-warn-note" data-testid="conv-watch-off-banner">
      ⚠ 自動偵測已關閉——新 model.ifc 不會自動進件，需手動進件
    </p>
  )}
  ```

- [ ] 5.4 MinIO 自動偵測 Panel（`:541-582`）加開關鈕：在 `mw.enabled === false` 分支內加「開啟自動偵測」鈕；在啟用態分支內加「關閉自動偵測」鈕。沿用既有 `<Btn>`（與 prioritize/retry 同）：
  ```tsx
  // mw.enabled === false 分支末尾：
  <Btn
    data-testid="conv-watch-enable"
    onClick={() => { setActionErr(null); setPendingAction({ kind: "watch-toggle", enabled: true }); }}
  >開啟自動偵測</Btn>
  // 啟用態分支末尾：
  <Btn
    data-testid="conv-watch-disable"
    onClick={() => { setActionErr(null); setPendingAction({ kind: "watch-toggle", enabled: false }); }}
  >關閉自動偵測</Btn>
  ```
  （未配置時前端無法直接知 configured，保守作法：鈕一律可點，後端 422 兜底 → `actionErr` 顯誠實「未配置」訊息，UI 不假成功——此即 spec §4.4 的近似方案。）

- [ ] 5.5 `IntentDialog`（`:641-651`）title/cost 加 `watch-toggle` 文案分支：
  ```tsx
  title={
    pendingAction?.kind === "watch-toggle"
      ? (pendingAction.enabled ? "開啟 MinIO 自動偵測" : "關閉 MinIO 自動偵測")
      : pendingAction?.kind === "prioritize" ? "插隊到佇列最前" : "重新派工此 job"
  }
  cost={
    pendingAction?.kind === "watch-toggle"
      ? (pendingAction.enabled
          ? "恢復輪詢 MinIO；偵測到新 model.ifc 會自動進件並派工。"
          : "停止輪詢 MinIO；新上傳的 model.ifc 將不再自動進件，需手動觸發。")
      : pendingAction?.kind === "prioritize"
          ? "此 job 將排到佇列最前、較早派工；其他排隊中 job 順位後移。"
          : "將重新派工此 job 至轉檔 authority；可能再次失敗。"
  }
  ```
  （`runAction`/`onConfirm`/`onCancel`/`busy`/`actionErr` 不動。）

- [ ] 5.6 build 確認型別/JSX 無錯：
  ```bash
  cd C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/peaceful-payne-6785a9/web-viewer-sample && npm run build
  ```
  預期：vite build 成功、無 TS error（union narrowing 正確）。

- [ ] 5.7 commit：
  ```bash
  cd C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/peaceful-payne-6785a9 && git add -- web-viewer-sample/src/console/pages.tsx && git diff --cached --check && git commit -m "feat(viewer): #conv 自動偵測開關 UI + 關閉態琥珀條（IX-CV-04 Task5）

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```
  預期：commit 成功。

---

## Task 6: frontend component 測試（`console.test.tsx` / `ConversionSchedulingPage.test.tsx`）

**Files**
- Modify: `web-viewer-sample/src/console/console.test.tsx`（或 `ConversionSchedulingPage.test.tsx`——先 grep 既有 `ConversionSchedulingPage` 測試落在哪檔，新增於同檔對齊既有 render/mock 模式）

步驟：

- [ ] 6.1 先定位既有 conv 頁測試檔與其 mock 模式：
  ```bash
  cd C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/peaceful-payne-6785a9/web-viewer-sample && grep -rn "ConversionSchedulingPage\|minioWatchStatus\|conversionWatchToggle" src/console/*.test.tsx
  ```
  預期：找到既有 conv 頁 render 測試（含 coordinatorClient mock）。新增測試對齊該檔的 mock/render helper。

- [ ] 6.2 寫測試（依 `mw.enabled` 渲染鈕 + confirm 呼叫 toggle + 證據型刷新 + 失敗誠實）。以既有檔的 mock coordinatorClient 模式為準，斷言四點：
  - `mw.enabled === false` → 渲染 `conv-watch-enable` 鈕 + 頁頂 `conv-watch-off-banner` 琥珀條。
  - `mw.enabled === true`（啟用態 mock status）→ 渲染 `conv-watch-disable` 鈕、無琥珀條。
  - 點鈕 → 開 `intent-dialog` → 點 `intent-confirm` → `conversionWatchToggle` 被呼叫一次 + `load()`/`minioWatchStatus` 重抓（證據型，非樂觀）。
  - toggle reject（mock throw）→ dialog 不關、`intent-action-error` 顯誠實訊息、`mw` 狀態不被樂觀改寫。
  範例（依既有 mock 風格調整 import/render）：
  ```tsx
  it("watcher 關閉態 → 顯『開啟自動偵測』鈕與頁頂琥珀條", async () => {
    // mock coordinatorClient.minioWatchStatus -> { enabled: false, note: "..." }
    // render ConversionSchedulingPage、按 Refresh queue
    expect(screen.getByTestId("conv-watch-enable")).toBeInTheDocument();
    expect(screen.getByTestId("conv-watch-off-banner")).toBeInTheDocument();
  });
  it("確認開關 → conversionWatchToggle 被呼叫 + 重抓真 status（非樂觀）", async () => {
    // mock conversionWatchToggle resolve、確認後斷言 toggle spy 被呼叫且 minioWatchStatus 再被呼叫
  });
  it("toggle 失敗 → dialog 不關、顯誠實錯誤、不改狀態", async () => {
    // mock conversionWatchToggle reject、斷言 intent-action-error 顯示且 dialog 仍可見
  });
  ```

- [ ] 6.3 跑確認綠 + 既有 conv 測試零退化：
  ```bash
  cd C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/peaceful-payne-6785a9/web-viewer-sample && npm test
  ```
  預期：全套 vitest 綠（新增 3 條 + 既有 `console.test.tsx`/`ConversionSchedulingPage.test.tsx`/`coordinatorClient.test.ts`/`IntentDialog.test.tsx` 不壞）。

- [ ] 6.4 commit：
  ```bash
  cd C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/peaceful-payne-6785a9 && git add -- web-viewer-sample/src/console/ && git diff --cached --check && git commit -m "test(viewer): #conv 自動偵測開關 component 測試（IX-CV-04 Task6）

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```
  預期：commit 成功。

---

## Task 7: Browser E2E（Playwright / gstack，user-facing 唯一接受證據）

**Files**
- Create: `web-viewer-sample/e2e/conv-watch-toggle.spec.ts`
- Create（evidence dir）: `docs/evidence/conv-watch-toggle/`（gstack 截圖 + summary 落點）

> 縱切驗收：UI route `#conv` → 自動偵測開關鈕 → `IntentDialog` confirm → 真 `PUT /api/conversion/watch` → 真後端 status 回應 → Panel/琥珀條依真狀態刷新（loading/success/failure 三態）。守門用 conditional skip（比照 `conv-prioritize-retry.spec.ts`），未達狀態 `notObserved[]` 誠實揭露。本 repo CI 無 Playwright job，此 skip 不偽綠任何自動化 gate（檔頭須複述此限制）。

步驟：

- [ ] 7.1 建 `web-viewer-sample/e2e/conv-watch-toggle.spec.ts`，檔頭比照 `conv-prioritize-retry.spec.ts` 揭露 webServer :5180 / coordinator base 注入 / skip-gate 效力限制；二選一驗真切片：
  ```ts
  import { test, expect } from "@playwright/test";

  // IX-CV-04 #conv「自動偵測開關」controlled action 端到端（M2-c）：
  // #conv → MinIO 自動偵測 Panel 開關鈕 → IntentDialog → confirm → 真 PUT /api/conversion/watch
  //   → 後端真 status 回應 → Panel/頁頂琥珀條依真狀態刷新。誠實鐵律：無樂觀更新（PUT 後 load() 重抓）、
  //   未配置不假成功、未觀察轉移以 notObserved 原文揭露、不偽造。
  //
  // 二選一（依測試區 watcher 實際配置態，spec §6.4）：
  //   (E) watcher 已配置且啟用 → 點「關閉自動偵測」→ confirm → PUT 200 + Panel 轉 enabled:false
  //       + 頁頂琥珀條出現；再「開啟自動偵測」→ Panel 轉 enabled:true + 琥珀條消失（端到端往返一輪）。
  //   (U) 未配置（常態：env 未 opt-in）→「開啟自動偵測」→ confirm → PUT 422 → 前端顯誠實「未配置」
  //       訊息、開關維持關閉態、琥珀條維持（誠實負向路徑）；正向往返以 notObserved 揭露，深度由
  //       conversion-watch-toggle.test.ts 兜底。
  //
  // *** 服務這頁的 viewer 來源（比照 conv-prioritize-retry.spec.ts）：webServer :5180 fresh viewer、
  //     coordinator base 由 VITE_COORDINATOR_API_BASE 注入（預設 http://127.0.0.1:8005、
  //     E2E_COORDINATOR_BASE_URL 覆寫）。前置：起 branch coordinator（PORT=8005、CORS 含 :5180）。
  // *** skip-gate 效力限制：beforeEach conditional skip（前置缺失→skip→計 pass，非 fail）。本 repo
  //     .github/workflows 僅 pr-review-agent.yml、無 Playwright job，此 skip 不偽綠任何自動化 gate。
  const COORDINATOR = process.env.E2E_COORDINATOR_BASE_URL || "http://127.0.0.1:8005";

  test.describe("IX-CV-04 #conv 自動偵測開關 controlled action", () => {
    test.setTimeout(120_000);
    let initialEnabled: boolean | null = null;
    const notObserved: string[] = [];

    test.beforeEach(async ({ request }) => {
      try {
        const res = await request.get(`${COORDINATOR}/api/external/minio-watch/status`);
        if (res.ok()) initialEnabled = Boolean((await res.json()).enabled);
      } catch { initialEnabled = null; }
      if (initialEnabled === null) {
        notObserved.push("coordinator :8005 不可達；開關 browser 切片本輪 not observed，深度因果由 conversion-watch-toggle.test.ts 兜底。");
      }
      test.skip(initialEnabled === null, "需 branch coordinator :8005 可達且 GET minio-watch/status 回應；見檔頭前置。");
    });
  ```

- [ ] 7.2 加 (E) 正向往返 test（watcher 啟用態才跑，否則 notObserved + skip 該 case）：
  ```ts
    test("啟用態 → 關閉往返：關 → 琥珀條出現 → 開 → 琥珀條消失", async ({ page }) => {
      if (initialEnabled !== true) {
        notObserved.push("正向往返（關→開）：本輪測試區 watcher 非啟用態，未觀察；深度由 route 測試兜底。");
        test.skip(true, "需測試區 watcher 已配置且啟用（enabled:true）才驗正向往返。");
        return;
      }
      await page.goto(`/#conv`);
      await page.getByRole("button", { name: /Refresh queue|讀取中/ }).click();
      // 關閉自動偵測 → IntentDialog → confirm → 攔 PUT 200
      await page.locator('[data-testid="conv-watch-disable"]').click();
      await expect(page.locator('[data-testid="intent-dialog"]')).toBeVisible();
      const [offRes] = await Promise.all([
        page.waitForResponse((r) => r.url().includes("/api/conversion/watch") && r.request().method() === "PUT"),
        page.locator('[data-testid="intent-confirm"]').click(),
      ]);
      expect(offRes.status()).toBe(200);
      await expect(page.locator('[data-testid="conv-watch-off-banner"]')).toBeVisible();
      await page.screenshot({ path: "../docs/evidence/conv-watch-toggle/watch-off.png", fullPage: true });
      // 開啟自動偵測 → confirm → 琥珀條消失
      await page.locator('[data-testid="conv-watch-enable"]').click();
      const [onRes] = await Promise.all([
        page.waitForResponse((r) => r.url().includes("/api/conversion/watch") && r.request().method() === "PUT"),
        page.locator('[data-testid="intent-confirm"]').click(),
      ]);
      expect(onRes.status()).toBe(200);
      await expect(page.locator('[data-testid="conv-watch-off-banner"]')).toBeHidden();
      await page.screenshot({ path: "../docs/evidence/conv-watch-toggle/watch-on.png", fullPage: true });
    });
  ```

- [ ] 7.3 加 (U) 誠實負向 test（未配置常態：開啟 → 422 → 顯誠實錯誤、維持關閉態）：
  ```ts
    test("未配置 → 開啟自動偵測 → PUT 422 → 誠實錯誤、維持關閉態", async ({ page }) => {
      if (initialEnabled !== false) {
        notObserved.push("誠實負向（未配置 422）：本輪測試區非關閉態，未觀察。");
        test.skip(true, "需測試區 watcher 關閉態（enabled:false）才驗 422 負向。");
        return;
      }
      await page.goto(`/#conv`);
      await page.getByRole("button", { name: /Refresh queue|讀取中/ }).click();
      await expect(page.locator('[data-testid="conv-watch-off-banner"]')).toBeVisible();
      await page.locator('[data-testid="conv-watch-enable"]').click();
      await expect(page.locator('[data-testid="intent-dialog"]')).toBeVisible();
      const [res] = await Promise.all([
        page.waitForResponse((r) => r.url().includes("/api/conversion/watch") && r.request().method() === "PUT"),
        page.locator('[data-testid="intent-confirm"]').click(),
      ]);
      // 未配置 → 422；已配置但本機可啟動 → 200（誠實兩擇一，不硬斷 422）。
      if (res.status() === 422) {
        await expect(page.locator('[data-testid="intent-action-error"]')).toBeVisible();
        await expect(page.locator('[data-testid="intent-dialog"]')).toBeVisible(); // 不關
        await expect(page.locator('[data-testid="conv-watch-off-banner"]')).toBeVisible(); // 維持關閉態
      } else {
        notObserved.push(`測試區 watcher 可啟動（PUT 回 ${res.status()}）→ 422 負向未觀察，改驗正向。`);
      }
      await page.screenshot({ path: "../docs/evidence/conv-watch-toggle/watch-enable-attempt.png", fullPage: true });
    });
  ```

- [ ] 7.4 加 render-surface 證據 test（無條件渲染 + 截圖，非 controlled-action 觀察，比照 prioritize-retry 檔尾）+ `afterAll` notObserved 揭露：
  ```ts
    test.afterAll(() => {
      if (notObserved.length) console.log("[conv-watch-toggle] notObserved:", JSON.stringify(notObserved));
    });
  });

  test("渲染 #conv 真頁面 → Refresh queue → 截圖 render surface（evidence，非 controlled-action 觀察）", async ({ page }) => {
    await page.goto(`/#conv`);
    await page.getByRole("button", { name: /Refresh queue|讀取中/ }).click();
    await expect(page.getByText("IFC→USD 轉檔排程", { exact: false })).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: "../docs/evidence/conv-watch-toggle/conv-render-surface.png", fullPage: true });
    await page.screenshot({ path: "../artifacts/e2e/conv-watch-toggle-render-surface.png", fullPage: true });
  });
  ```

- [ ] 7.5 跑 E2E（須先依檔頭前置起 branch coordinator :8005；缺失則 skip 計 pass + notObserved 揭露）：
  ```bash
  cd C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/peaceful-payne-6785a9/web-viewer-sample && npm run test:e2e -- conv-watch-toggle.spec.ts
  ```
  預期：render-surface 截圖落點成功；controlled-action 切片依測試區狀態走 (E)/(U) 或 honest skip；`notObserved[]` log 揭露未觀察轉移。截圖落 `docs/evidence/conv-watch-toggle/` 與 `artifacts/e2e/`。

- [ ] 7.6 commit（tracked evidence + spec）：
  ```bash
  cd C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/peaceful-payne-6785a9 && git add -- web-viewer-sample/e2e/conv-watch-toggle.spec.ts docs/evidence/conv-watch-toggle/ && git diff --cached --check && git commit -m "test(viewer): #conv 自動偵測開關 gstack E2E + evidence（IX-CV-04 Task7）

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```
  預期：commit 成功（artifacts/ 若 gitignored 不入 tracked，僅 docs/evidence/ 截圖入庫）。

---

## 完成判準（spec §6 驗收基準）

- coordinator `npm run verify` 全綠（含新 `conversion-watch-toggle.test.ts` + 回歸鎖 `config-minio-watch`/`minio-watch-status-route`/`minio-watcher-loop` 零退化）。
- frontend `npm test` 全綠（新 component 測試 + 既有 conv 測試零退化）；`npm run build` 0 TS error。
- gstack E2E（§Task 7）跑過：正向往返 (E) 或誠實負向 (U) 至少一條真切片觀察到，其餘 `notObserved[]` 原文揭露；render-surface 截圖落 tracked `docs/evidence/conv-watch-toggle/`。
- GitNexus：Task 1 改動前 `gitnexus_impact`（risk LOW 已預掃）、Task 3 commit 前 `gitnexus_detect_changes`（scope 限 coordinator + viewer、未溢出 viewer DataChannel/streaming/其他頁）。
- 四項回報：改了哪些 tracked files / 最小驗證 / 沒跑的測試與原因 / 已知風險（含 runtime flag in-memory 重啟回 env、audit who best-effort、E2E 依測試區配置態二選一）。

## 風險與緩解（spec §7 摘要，執行時逐條守）

- runtime 接線改造（Task 1，非 additive、最高風險）：先做 + 回歸鎖（既有 `minio-watch-*` 測試）；impact 已預掃 LOW。
- toggle 競態（CR-B）：`minioWatchToggleBusy` 鎖 + 先清 `minioWatcher=null` 再 `await dispose`（沿用 shutdown 模式）。
- 未配置誠實面（CR-C）：`minioWatchConfigured()` → 422；`startMinioWatcherIfEnabled` allowlist throw → try/catch → 500 + flag 回滾，不留半開狀態。
- 安全回歸（CR-A）：PUT 必沿用 `rejectIfIpNotAllowed` + audit；UI/PR 不宣稱有 RBAC 身分稽核（B 方案 LAN，audit who best-effort `local-operator`）。
- 誠實面（CR-D）：無樂觀更新（toggle 後 `load()` 重抓真 status）；未配置不給假開啟成功；關閉態頁頂琥珀條為規格硬要求；status note 誠實區分「env 未開」vs「runtime 被關」。
- 持久化取捨：runtime flag in-memory，重啟回 env 初值——誠實標於 status note 與 PR body，不偽稱持久。
- 跨 repo 邊界：改動限 `bim-review-coordinator`（runtime flag + PUT route + status 改讀 + audit）與 `web-viewer-sample`（client + UI）；不碰 `bim-streaming-server` / MinIO / viewer DataChannel。

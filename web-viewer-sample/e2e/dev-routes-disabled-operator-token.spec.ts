import { test, expect, type APIResponse } from "@playwright/test";

// unified-console-runtime-truth slice 2 §5A（原 Task 11）：dev routes 已關閉的 UI 垂直切片
// ＋ D2=T4 operator token API 契約探針。
//
// *** 服務這頁的 viewer 來源（比照 conv-prioritize-retry.spec.ts）：
//     本 spec 走 playwright.config.ts webServer 在 :5180 起的 fresh viewer（本 branch 最新碼），
//     coordinator client base 由 VITE_COORDINATOR_API_BASE 注入（預設 http://127.0.0.1:8005，
//     可用 E2E_COORDINATOR_BASE_URL 覆寫）。前置（見 plan Task 11 Step 2 一行指令）：branch
//     coordinator 須以 PORT=8005、ENABLE_DEV_ROUTES=false、
//     EXTERNAL_INTAKE_IP_ALLOWLIST=10.0.0.0/8（排除 loopback，token 路徑才有事可驗）、
//     DEV_AUTH_TOKEN=e2e-operator-token、CORS_ORIGINS=http://127.0.0.1:5180 起。
//
// 三個 test：
//   1. #demo-control：/api/dev/ifc-sources 404 → 誠實 notice ＋ 選檔／註冊鈕 disabled。
//   2. #a1-workbench：/api/dev/test-data-projects 404 → 誠實測試資料標記不可用 note。
//   3. API 契約探針（非 browser render）：四條 conversion 控制路由 T4 token 路徑（無憑證 403／
//      錯 token 403／速率限制 429）、lineage legacy-unmanaged 兩路由不因 token 解鎖、
//      dev routes 整組 404 且 token 對此 prefix 無效。
// 深度因果已由 bim-review-coordinator 的 conversion-control-auth.test.ts／
// conversion-control-auth-pins.test.ts／dev-routes-disabled.test.ts 兜底；本檔只證明
// 「真 process 起、真 HTTP、行為與單元測試一致」這條 browser／HTTP 垂直切片。
//
// *** 前置守門設計與 E2E_REQUIRE_REAL 的誠實揭露（task#4 修復補記，2026-08-25）***
//   plan（docs/superpowers/plans/2026-08-25-unified-console-runtime-truth-s2.md:1580、1616-1631）的
//   逐字稿守門是「preflight → test.skip；再靠 E2E_REQUIRE_REAL=1 讓 skip 變 fail」（reporter：
//   e2e/support/forbid-skipped-when-real.ts）。本 worktree 無法照該組合執行：
//     playwright.config.ts:6 一律呼叫 loadIsolatedStackConfig()，而 e2e/support/isolated-stack.ts:245-246
//     在 E2E_REQUIRE_REAL=1 且未給 E2E_STACK_MANIFEST 時直接 throw
//     「E2E_STACK_MANIFEST is required in require-real mode」——config 載入階段即中止，跑不到任何 test；
//     該守衛早於本 change（commit 45e78b7 / PR #684），且即使備妥 manifest，isolated 模式的 testMatch
//     （playwright.config.ts:56）只收 a3／a4 兩支 spec，本檔仍不會被選中。
//   故本檔改採「preflight 前置缺失＝直接 fail（不 skip）」：比 skip + reporter 更強（不存在
//   「conditional skip 計為 pass」的縫，比照 conversion-artifact-id-sanitize.spec.ts:26-35 的先例揭露），
//   且不依賴一個在本 worktree 設不起來的旗標。實際可重現指令（**不帶** E2E_REQUIRE_REAL=1）：
//     cd web-viewer-sample
//     E2E_COORDINATOR_BASE_URL=http://127.0.0.1:8005 npx playwright test e2e/dev-routes-disabled-operator-token.spec.ts
//   另一項與 plan 逐字稿的差異：本檔的 testid 取自 task#3 實際落地的 UI（ifc-dev-routes-notice、
//   a1-testdata-devroutes-note、ifc-fixture-select、ifc-register-btn、ifc-refresh-btn、a1-localfs-select，
//   以及既有的 ifc-runtime-state）；plan 草稿裡的 dev-routes-disabled-notice／a1-test-data-dev-routes-disabled
//   在本 branch 不存在，照抄必紅。（P4 attempt 1 修正：早先此段誤稱 ifc-runtime-state 不存在，實則
//   RealIfcConsolePage.tsx 一直渲染它；現已用它斷言 runtime 行為 dev_routes_disabled、而非 storage_empty。）
//
// *** 速率視窗是共用外部狀態：本 spec 必須可重複執行（task#4 quality 修復，2026-08-25）***
//   operator token 的速率限制由 bim-review-coordinator/src/services/conversionControlAuthorization.ts
//   的 SlidingWindowRateLimiter 實作：key 只有來源 IP、視窗跨四條 conversion 控制路由共用、
//   實例在 app.ts 建立一次並活在 coordinator process 生命週期內、**沒有 reset hook**。
//   branch coordinator 是長生命週期行程（不隨每次 playwright run 重啟），因此「視窗殘量」對本 spec
//   而言是無法獨佔、也無法從外部唯讀查詢的狀態。
//   初版本檔假設視窗一定是空的（寫死「第 1 次錯 token、第 2–5 次四路由、第 6–10 次補滿、第 11 次 429」），
//   實測會讓上方那條「可重現指令」在 60 秒內重跑時假紅：第一發帶 token 的請求就被前一次執行的殘量
//   擋成 429，斷在 expect(403)，看起來像 regression 其實只是視窗沒過期（已於修復前實測重現）。
//   修法（本檔現況）：
//     (1) 語意斷言（錯 token 403／四路由授權通過）一律經 withRateWindowRetry() 送出——遇 429 就依
//         Retry-After 等到殘量離開視窗後重試，等待次數與總時長皆有上限，逾限**直接 fail 並說明原因**
//         （不吞、不 skip，維持本檔「前置不齊備就大聲失敗」的一致設計）。
//     (2) 速率限制本身改成「連打到 429 為止」（上限 OPERATOR_TOKEN_RATE_LIMIT+1 次，視窗全空時必收斂），
//         不再斷言「剛好第 11 次」這個絕對次數。
//   結果：上方那條指令連續重跑皆為 3 passed；視窗乾淨時零額外等待，60 秒內重跑則自動等一次視窗到期。

const COORDINATOR = process.env.E2E_COORDINATOR_BASE_URL || "http://127.0.0.1:8005";
const OPERATOR_TOKEN = process.env.E2E_DEV_AUTH_TOKEN || "e2e-operator-token";

const PRIORITIZE_PATH = "/api/conversion/jobs/ifcready_nope/prioritize";

const PREFLIGHT_TIMEOUT_MS = 10_000;

/** 與 conversionControlAuthorization.ts:8-9 的 OPERATOR_TOKEN_RATE_LIMIT／_WINDOW_MS 同步。 */
const OPERATOR_TOKEN_RATE_LIMIT = 10;
const OPERATOR_TOKEN_RATE_WINDOW_SECONDS = 60;

/** 等待視窗到期時多給的邊際：涵蓋 Retry-After 的 ceil 誤差與前一次執行那串命中的時間跨度（實測 <0.3s）。 */
const RATE_WINDOW_WAIT_MARGIN_MS = 1_500;
/** 整個 test 允許等待視窗到期的總次數上限（正常情況 0 次；60 秒內重跑 1 次即可清空）。 */
const RATE_WINDOW_MAX_WAITS = 2;

let rateWindowWaitsUsed = 0;

function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(PREFLIGHT_TIMEOUT_MS) });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 送出一次帶 operator token 的 conversion 控制路由請求，並吸收「前一次執行殘留在滑動視窗裡的名額」
 * 造成的 429（見檔頭「速率視窗是共用外部狀態」）。
 *
 * 這裡的 429 不是待驗的產品行為，而是本 spec 無法獨佔的外部狀態；真正要驗速率限制的那段刻意
 * **不**經本函式（直接用 request.*），以免把要斷言的行為重試掉。
 *
 * 等待次數用光仍為 429 → 直接 throw 一則說得出原因的錯誤，而不是讓 429 流到 expect(403) 變成
 * 看起來像 regression 的假紅。
 */
async function withRateWindowRetry(label: string, call: () => Promise<APIResponse>): Promise<APIResponse> {
  for (;;) {
    const response = await call();
    if (response.status() !== 429) return response;
    if (rateWindowWaitsUsed >= RATE_WINDOW_MAX_WAITS) {
      throw new Error(
        `${label}：operator token 速率視窗在等待 ${rateWindowWaitsUsed} 次後仍為 429。` +
          "該視窗以來源 IP 為 key、由 coordinator process 共用且無 reset hook，" +
          `請確認沒有其他程序同時在打 ${COORDINATOR}/api/conversion/* 的 token 路徑，` +
          `或等 ${OPERATOR_TOKEN_RATE_WINDOW_SECONDS} 秒後重跑。`,
      );
    }
    rateWindowWaitsUsed += 1;
    const retryAfter = Number(response.headers()["retry-after"]);
    const waitSeconds =
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : OPERATOR_TOKEN_RATE_WINDOW_SECONDS;
    await sleep(waitSeconds * 1000 + RATE_WINDOW_WAIT_MARGIN_MS);
  }
}

/**
 * 前置盤查：回 null 代表前置齊備；否則回「缺哪一項」的人類可讀原因。
 * 三項對應 plan Task 11 Step 2 起 coordinator 的三個關鍵 env：
 *   /health 可達、ENABLE_DEV_ROUTES=false（dev prefix 404）、
 *   EXTERNAL_INTAKE_IP_ALLOWLIST 排除 loopback（無 token prioritize → 403）。
 * 注意：這裡的無 token POST 在 guard 內於讀 token header 前就短路（見
 * bim-review-coordinator/src/services/conversionControlAuthorization.ts:81-86），不計入速率視窗，
 * 因此 preflight 本身不會消耗下方 API 探針 test 要用的 token 名額（每次執行都跑 preflight，
 * 若它會計數，光是重跑就會提早吃掉視窗）。
 */
async function preflight(): Promise<string | null> {
  try {
    const health = await fetchWithTimeout(`${COORDINATOR}/health`);
    if (!health.ok) return `coordinator ${COORDINATOR}/health 非 2xx（${health.status}）`;
    const dev = await fetchWithTimeout(`${COORDINATOR}/api/dev/ifc-sources`);
    if (dev.status !== 404) {
      return `coordinator 未以 ENABLE_DEV_ROUTES=false 啟動（GET /api/dev/ifc-sources → ${dev.status}，預期 404）`;
    }
    const bare = await fetchWithTimeout(`${COORDINATOR}${PRIORITIZE_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    if (bare.status !== 403) {
      return `coordinator allowlist 未排除 loopback（無 token prioritize → ${bare.status}，預期 403）`;
    }
    return null;
  } catch (error) {
    return `coordinator ${COORDINATOR} 不可達：${String(error)}`;
  }
}

let preflightReason: string | null = null;

test.beforeAll(async () => {
  preflightReason = await preflight();
});

// 前置缺失＝fail（不 skip）：Playwright 語意裡 skip 會被計為 pass，那是假信心。
test.beforeEach(() => {
  if (preflightReason === null) return;
  throw new Error(
    `前置不齊備，本 spec 直接 fail（刻意不 skip）：${preflightReason}。` +
      "請先依 plan Task 11 Step 2 起 branch coordinator（PORT=8005、ENABLE_DEV_ROUTES=false、" +
      "EXTERNAL_INTAKE_IP_ALLOWLIST=10.0.0.0/8、DEV_AUTH_TOKEN=e2e-operator-token、" +
      "CORS_ORIGINS=http://127.0.0.1:5180）後重跑。",
  );
});

test.describe("dev routes 已關閉：UI 垂直切片誠實狀態", () => {
  test("#demo-control：/api/dev/ifc-sources 404 → notice ＋ 選檔／註冊鈕 disabled", async ({ page }) => {
    // 綁定真後端回應：notice 必須是由瀏覽器實際收到的 404 {detail:"dev routes disabled"} 觸發，
    // 而非任何其他 404（P4 attempt 1 gap e1）。
    const devSourcesResponse = page.waitForResponse(
      (response) => response.url().includes("/api/dev/ifc-sources") && response.request().method() === "GET",
      { timeout: 20_000 },
    );
    await page.goto("/#demo-control");
    const panel = page.getByTestId("real-ifc-demo-control");
    await expect(panel).toBeVisible({ timeout: 20_000 });
    const devSources = await devSourcesResponse;
    expect(devSources.status()).toBe(404);
    expect(await devSources.json()).toEqual({ detail: "dev routes disabled" });

    const notice = page.getByTestId("ifc-dev-routes-notice");
    await expect(notice).toBeVisible({ timeout: 20_000 });
    await expect(notice).toContainText("dev routes 已關閉");
    await expect(notice).toContainText("ENABLE_DEV_ROUTES=false");

    await expect(page.getByTestId("ifc-fixture-select")).toBeDisabled();
    await expect(page.getByTestId("ifc-register-btn")).toBeDisabled();

    // runtime 行必須是 dev_routes_disabled，不得退回 storage_empty 假空狀態（P4 attempt 1 gap e4）。
    const runtimeState = page.getByTestId("ifc-runtime-state");
    await expect(runtimeState).toContainText("runtime: dev_routes_disabled");
    await expect(runtimeState).not.toContainText("storage_empty");

    // 重新整理清單會再打一次 /api/dev/ifc-sources（仍 404）：notice／disabled／runtime 行必須維持（P4 attempt 1 gap e5）。
    const refreshResponse = page.waitForResponse(
      (response) => response.url().includes("/api/dev/ifc-sources") && response.request().method() === "GET",
      { timeout: 20_000 },
    );
    await page.getByTestId("ifc-refresh-btn").click();
    expect((await refreshResponse).status()).toBe(404);
    await expect(notice).toBeVisible();
    await expect(page.getByTestId("ifc-register-btn")).toBeDisabled();
    await expect(runtimeState).toContainText("runtime: dev_routes_disabled");

    await page.screenshot({ path: "../artifacts/e2e/dev-routes-disabled-demo-control.png", fullPage: true });
  });

  test("#a1-workbench：/api/dev/test-data-projects 404 → 測試資料標記不可用 note", async ({ page }) => {
    await page.goto("/#a1-workbench");
    // 預設 executable source 即 local_fs（A1GovernanceWorkbenchPage 初始 state），note 掛在
    // sourceKind==="local_fs" 分支下，故不需切換分頁即可觀察到。
    const localSelect = page.getByTestId("a1-localfs-select");
    await expect(localSelect).toBeVisible({ timeout: 20_000 });

    const note = page.getByTestId("a1-testdata-devroutes-note");
    await expect(note).toBeVisible({ timeout: 20_000 });
    await expect(note).toContainText("dev routes 已關閉");
    await expect(note).toContainText("ENABLE_DEV_ROUTES=false");

    await page.screenshot({ path: "../artifacts/e2e/dev-routes-disabled-a1-workbench.png", fullPage: true });
  });
});

test.describe("D2=T4 operator token API 契約探針（真 process、真 HTTP）", () => {
  // 視窗乾淨時整個 test 約 0.1s；預算要涵蓋最壞情況：RATE_WINDOW_MAX_WAITS 次「等整個
  // 速率視窗到期」的等待（各 ≤ OPERATOR_TOKEN_RATE_WINDOW_SECONDS + 邊際）。
  test.setTimeout(
    90_000 + RATE_WINDOW_MAX_WAITS * (OPERATOR_TOKEN_RATE_WINDOW_SECONDS * 1000 + RATE_WINDOW_WAIT_MARGIN_MS),
  );

  const RETRY_PATH = "/api/conversion/jobs/ifcready_nope/retry";
  const WATCH_PATH = "/api/conversion/watch";
  const TRIGGER_PATH = "/api/conversion/trigger";
  const IP_REJECTED_BODY = { detail: "caller ip not in allowlist" };
  const TOKEN_INVALID_BODY = { detail: "operator token invalid (x-operator-token)" };
  const RATE_LIMITED_BODY = {
    detail: "operator token rate limit exceeded (10 requests per minute per source ip)",
  };

  test("dev routes 404（token 不解鎖）＋ lineage 不因 token 解鎖 ＋ 四路由 T4 授權 ＋ 速率限制 429", async ({
    request,
  }) => {
    // --- dev routes：ENABLE_DEV_ROUTES=false 整組 404，operator token 對此 prefix 沒有任何效果 ---
    const devBare = await request.get(`${COORDINATOR}/api/dev/ifc-sources`);
    expect(devBare.status()).toBe(404);
    const devWithToken = await request.get(`${COORDINATOR}/api/dev/ifc-sources`, {
      headers: { "x-operator-token": OPERATOR_TOKEN },
    });
    expect(devWithToken.status()).toBe(404);

    // --- lineage legacy-unmanaged：經 deps 注入的仍是同一個 rejectIfIpNotAllowed（逐字
    //     "caller ip not in allowlist"，與 conversion-control guard 的 IP_REJECTED_BODY 同型——
    //     兩者本就是同一段判斷邏輯的兩份呼叫點）。operator token 對這兩條路由沒有解鎖效果。
    const previewPath = `/api/lineage/legacy-unmanaged/preview?grouping_key=${encodeURIComponent("tenant-a/legacy")}`;
    const previewBare = await request.get(`${COORDINATOR}${previewPath}`);
    expect(previewBare.status()).toBe(403);
    expect(await previewBare.json()).toEqual(IP_REJECTED_BODY);
    const previewWithToken = await request.get(`${COORDINATOR}${previewPath}`, {
      headers: { "x-operator-token": OPERATOR_TOKEN },
    });
    expect(previewWithToken.status()).toBe(403);
    expect(await previewWithToken.json()).toEqual(IP_REJECTED_BODY);

    const confirmWithToken = await request.post(`${COORDINATOR}/api/lineage/legacy-unmanaged/confirm`, {
      headers: { "x-operator-token": OPERATOR_TOKEN },
      data: { grouping_key: "tenant-a/legacy" },
    });
    expect(confirmWithToken.status()).toBe(403);
    expect(await confirmWithToken.json()).toEqual(IP_REJECTED_BODY);

    // --- 四條 conversion 控制路由：T4 per-route guard ---
    // 無憑證且非 allowlist IP（EXTERNAL_INTAKE_IP_ALLOWLIST=10.0.0.0/8 排除 loopback）
    // → 403 逐字（guard 在讀到 token header 前就短路，不計速率）。
    const bare = await request.post(`${COORDINATOR}${PRIORITIZE_PATH}`, { data: {} });
    expect(bare.status()).toBe(403);
    expect(await bare.json()).toEqual(IP_REJECTED_BODY);

    // 以下開始為「帶 token header ＝ 計入速率視窗」的語意斷言。視窗是 coordinator process 共用、
    // 本 spec 無法獨佔的外部狀態（見檔頭），故一律經 withRateWindowRetry 送出：遇 429 先等殘量
    // 到期再重試，而不是把它當成待驗行為。
    // 錯誤 token → 403 operator token invalid。
    const wrongToken = await withRateWindowRetry("錯誤 token → 403", () =>
      request.post(`${COORDINATOR}${PRIORITIZE_PATH}`, {
        headers: { "x-operator-token": "not-the-real-token" },
        data: {},
      }),
    );
    expect(wrongToken.status()).toBe(403);
    expect(await wrongToken.json()).toEqual(TOKEN_INVALID_BODY);

    // 正確 token → 四條路由皆授權通過（落到既有下一判定，非 403／429）。
    const prioritizeOk = await withRateWindowRetry("prioritize 授權通過", () =>
      request.post(`${COORDINATOR}${PRIORITIZE_PATH}`, {
        headers: { "x-operator-token": OPERATOR_TOKEN },
        data: {},
      }),
    );
    expect(prioritizeOk.status()).toBe(404); // job 不存在（授權通過後的下一判定）

    const retryOk = await withRateWindowRetry("retry 授權通過", () =>
      request.post(`${COORDINATOR}${RETRY_PATH}`, {
        headers: { "x-operator-token": OPERATOR_TOKEN },
        data: {},
      }),
    );
    expect(retryOk.status()).toBe(404);

    const watchOk = await withRateWindowRetry("watch 授權通過", () =>
      request.put(`${COORDINATOR}${WATCH_PATH}`, {
        headers: { "x-operator-token": OPERATOR_TOKEN },
        data: { enabled: true },
      }),
    );
    expect(watchOk.status()).toBe(422); // MinIO watch 未配置（本環境未設 MINIO_WATCH_* 憑證）

    const triggerOk = await withRateWindowRetry("trigger 授權通過", () =>
      request.post(`${COORDINATOR}${TRIGGER_PATH}`, {
        headers: { "x-operator-token": OPERATOR_TOKEN },
        data: { key: "e2e/probe/model.ifc" },
      }),
    );
    expect(triggerOk.status()).toBe(503); // MinIO 未設定，短路於 key 驗證之前，無 I/O 副作用

    // --- 速率限制：同來源 IP 每分鐘 OPERATOR_TOKEN_RATE_LIMIT 次（四路由共用同一滑動視窗）---
    // 刻意不斷言「剛好第 11 次」這個絕對次數：視窗殘量是外部狀態（上面幾發已計入，且可能還有
    // 前一次執行未到期的命中），寫死次數就是把「本 spec 獨佔 coordinator」當成前提。改為連打到
    // 429 為止；上限 LIMIT+1 次——即使視窗全空，第 LIMIT+1 次也必定被擋，故迴圈必然收斂。
    let limited: APIResponse | null = null;
    for (let i = 0; i < OPERATOR_TOKEN_RATE_LIMIT + 1; i += 1) {
      const res = await request.post(`${COORDINATOR}${PRIORITIZE_PATH}`, {
        headers: { "x-operator-token": OPERATOR_TOKEN },
        data: {},
      });
      if (res.status() === 429) {
        limited = res;
        break;
      }
      expect(res.status()).toBe(404); // 未被擋下時必為授權通過後的下一判定
    }
    if (limited === null) {
      throw new Error(
        `連打 ${OPERATOR_TOKEN_RATE_LIMIT + 1} 次帶正確 token 的 prioritize 仍未觸發 429：` +
          `速率限制未生效（預期每來源 IP 每 ${OPERATOR_TOKEN_RATE_WINDOW_SECONDS} 秒 ${OPERATOR_TOKEN_RATE_LIMIT} 次）。`,
      );
    }
    expect(await limited.json()).toEqual(RATE_LIMITED_BODY);
    const retryAfter = Number(limited.headers()["retry-after"]);
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(OPERATOR_TOKEN_RATE_WINDOW_SECONDS);
  });
});

import { test, expect, type APIResponse } from "@playwright/test";

// unified-console-runtime-truth slice 2 §5A：credential-bearing API contract probe。
// 獨立檔案與 worker scope 確保 credential 不會進入 UI trace；本檔不產 trace、screenshot 或 video。
const COORDINATOR = process.env.E2E_COORDINATOR_BASE_URL || "http://127.0.0.1:8005";
const OPERATOR_TOKEN = (process.env.E2E_DEV_AUTH_TOKEN ?? "").trim();

test.use({ trace: "off", screenshot: "off", video: "off" });

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
  if (!OPERATOR_TOKEN) {
    return "E2E_DEV_AUTH_TOKEN 未設定；拒絕執行會送出 operator token header 的 API 探針";
  }
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
      "請先依 plan Task 5A Step 2 起 branch coordinator，並讓 DEV_AUTH_TOKEN 與 E2E_DEV_AUTH_TOKEN 使用同一個 ephemeral test-only 值後重跑。",
  );
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

  test(
    "dev routes 404（token 不解鎖）＋ lineage 不因 token 解鎖 ＋ 四路由 T4 授權 ＋ 速率限制 429",
    async ({ request }) => {
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
        data: {},
      }),
    );
    expect(watchOk.status()).toBe(400); // 授權通過後落到 body validation，未觸發 watcher lifecycle。
    expect([403, 429]).not.toContain(watchOk.status());

    const triggerOk = await withRateWindowRetry("trigger 授權通過", () =>
      request.post(`${COORDINATOR}${TRIGGER_PATH}`, {
        headers: { "x-operator-token": OPERATOR_TOKEN },
        data: {},
      }),
    );
    // 未配置時先回 503；已配置時缺 key 回 400。兩條都只證明授權已通過，不建立 intake job。
    expect([403, 429]).not.toContain(triggerOk.status());
    expect([400, 503]).toContain(triggerOk.status());

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
    },
  );
});

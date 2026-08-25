import { test, expect } from "@playwright/test";

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

const COORDINATOR = process.env.E2E_COORDINATOR_BASE_URL || "http://127.0.0.1:8005";
const OPERATOR_TOKEN = process.env.E2E_DEV_AUTH_TOKEN || "e2e-operator-token";

test.describe("dev routes 已關閉：UI 垂直切片誠實狀態", () => {
  test("#demo-control：/api/dev/ifc-sources 404 → notice ＋ 選檔／註冊鈕 disabled", async ({ page }) => {
    await page.goto("/#demo-control");
    const panel = page.getByTestId("real-ifc-demo-control");
    await expect(panel).toBeVisible({ timeout: 20_000 });

    const notice = page.getByTestId("ifc-dev-routes-notice");
    await expect(notice).toBeVisible({ timeout: 20_000 });
    await expect(notice).toContainText("dev routes 已關閉");
    await expect(notice).toContainText("ENABLE_DEV_ROUTES=false");

    await expect(page.getByTestId("ifc-fixture-select")).toBeDisabled();
    await expect(page.getByTestId("ifc-register-btn")).toBeDisabled();

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
  test.setTimeout(90_000);

  const PRIORITIZE_PATH = "/api/conversion/jobs/ifcready_nope/prioritize";
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

    // 錯誤 token → 403 operator token invalid（token header 存在即計入速率，第 1 次）。
    const wrongToken = await request.post(`${COORDINATOR}${PRIORITIZE_PATH}`, {
      headers: { "x-operator-token": "not-the-real-token" },
      data: {},
    });
    expect(wrongToken.status()).toBe(403);
    expect(await wrongToken.json()).toEqual(TOKEN_INVALID_BODY);

    // 正確 token → 四條路由皆授權通過（落到既有下一判定，非 403／429；第 2–5 次）。
    const prioritizeOk = await request.post(`${COORDINATOR}${PRIORITIZE_PATH}`, {
      headers: { "x-operator-token": OPERATOR_TOKEN },
      data: {},
    });
    expect(prioritizeOk.status()).toBe(404); // job 不存在（授權通過後的下一判定）

    const retryOk = await request.post(`${COORDINATOR}${RETRY_PATH}`, {
      headers: { "x-operator-token": OPERATOR_TOKEN },
      data: {},
    });
    expect(retryOk.status()).toBe(404);

    const watchOk = await request.put(`${COORDINATOR}${WATCH_PATH}`, {
      headers: { "x-operator-token": OPERATOR_TOKEN },
      data: { enabled: true },
    });
    expect(watchOk.status()).toBe(422); // MinIO watch 未配置（本環境未設 MINIO_WATCH_* 憑證）

    const triggerOk = await request.post(`${COORDINATOR}${TRIGGER_PATH}`, {
      headers: { "x-operator-token": OPERATOR_TOKEN },
      data: { key: "e2e/probe/model.ifc" },
    });
    expect(triggerOk.status()).toBe(503); // MinIO 未設定，短路於 key 驗證之前，無 I/O 副作用

    // --- 速率限制：同來源 IP 每分鐘 10 次（四路由共用同一滑動視窗）；上面已計 5 次，補到第 10 次 ---
    for (let i = 0; i < 5; i += 1) {
      const res = await request.post(`${COORDINATOR}${PRIORITIZE_PATH}`, {
        headers: { "x-operator-token": OPERATOR_TOKEN },
        data: {},
      });
      expect(res.status()).toBe(404);
    }
    const limited = await request.post(`${COORDINATOR}${PRIORITIZE_PATH}`, {
      headers: { "x-operator-token": OPERATOR_TOKEN },
      data: {},
    });
    expect(limited.status()).toBe(429);
    expect(await limited.json()).toEqual(RATE_LIMITED_BODY);
    const retryAfter = Number(limited.headers()["retry-after"]);
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(60);
  });
});

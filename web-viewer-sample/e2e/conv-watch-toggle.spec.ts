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
  // 原始 watcher 態快照（首次成功 GET 時鎖定，後續測試不覆寫），供 afterEach 還原。
  // 防 cross-test 汙染：啟用態往返測試（test 1）若在「關→開」中途失敗會把 watcher 留在關閉態，
  // 導致 test 2 的 beforeEach 重抓誤判 enabled:false 而走 enable-attempt 路徑、PUT 回 200 靜默誤過。
  let originalEnabled: boolean | null = null;
  const notObserved: string[] = [];

  test.beforeEach(async ({ request }) => {
    try {
      const res = await request.get(`${COORDINATOR}/api/external/minio-watch/status`);
      if (res.ok()) initialEnabled = Boolean((await res.json()).enabled);
    } catch { initialEnabled = null; }
    if (originalEnabled === null && initialEnabled !== null) originalEnabled = initialEnabled;
    if (initialEnabled === null) {
      notObserved.push("coordinator :8005 不可達；開關 browser 切片本輪 not observed，深度因果由 conversion-watch-toggle.test.ts 兜底。");
    }
    test.skip(initialEnabled === null, "需 branch coordinator :8005 可達且 GET minio-watch/status 回應；見檔頭前置。");
  });

  // 還原 watcher 至原始態：若任一測試（尤其 test 1 往返中途失敗）把 runtime flag 留在非原始態，
  // 透過真 PUT /api/conversion/watch 復原，避免後測讀到被汙染的態。failure-tolerant，不影響測試判定。
  test.afterEach(async ({ request }) => {
    if (originalEnabled === null) return;
    try {
      const res = await request.get(`${COORDINATOR}/api/external/minio-watch/status`);
      if (!res.ok()) return;
      const current = Boolean((await res.json()).enabled);
      if (current !== originalEnabled) {
        await request.put(`${COORDINATOR}/api/conversion/watch`, { data: { enabled: originalEnabled } });
      }
    } catch {
      /* 還原盡力而為；coordinator 不可達時不阻斷測試判定 */
    }
  });

  test("啟用態 → 關閉往返：關 → 琥珀條出現 → 開 → 琥珀條消失", async ({ page }) => {
    if (initialEnabled !== true) {
      notObserved.push("正向往返（關→開）：本輪測試區 watcher 非啟用態，未觀察；深度由 route 測試兜底。");
      test.skip(true, "需測試區 watcher 已配置且啟用（enabled:true）才驗正向往返。");
      return;
    }
    await page.goto(`/#conv`);
    const refreshOff = page.getByTestId("conv-refresh"); // #303 後 #/conv 的 refresh 是「重新整理」
    await refreshOff.waitFor({ state: "visible", timeout: 30_000 });
    await refreshOff.click();
    // 關閉自動偵測 → IntentDialog → confirm → 攔 PUT 200
    await page.locator('[data-testid="conv-watch-disable"]').click();
    await expect(page.locator('[data-testid="intent-dialog"]')).toBeVisible();
    const [offRes] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/conversion/watch") && r.request().method() === "PUT", { timeout: 30_000 }),
      page.locator('[data-testid="intent-confirm"]').click(),
    ]);
    expect(offRes.status()).toBe(200);
    await expect(page.locator('[data-testid="conv-watch-off-banner"]')).toBeVisible();
    await page.screenshot({ path: "../docs/evidence/conv-watch-toggle/watch-off.png", fullPage: true });
    // 開啟自動偵測 → confirm → 琥珀條消失
    await page.locator('[data-testid="conv-watch-enable"]').click();
    await expect(page.locator('[data-testid="intent-dialog"]')).toBeVisible();
    const [onRes] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/conversion/watch") && r.request().method() === "PUT", { timeout: 30_000 }),
      page.locator('[data-testid="intent-confirm"]').click(),
    ]);
    expect(onRes.status()).toBe(200);
    await expect(page.locator('[data-testid="conv-watch-off-banner"]')).toBeHidden();
    await page.screenshot({ path: "../docs/evidence/conv-watch-toggle/watch-on.png", fullPage: true });
  });

  test("未配置 → 開啟自動偵測 → PUT 422 → 誠實錯誤、維持關閉態", async ({ page }) => {
    if (initialEnabled !== false) {
      notObserved.push("誠實負向（未配置 422）：本輪測試區非關閉態，未觀察。");
      test.skip(true, "需測試區 watcher 關閉態（enabled:false）才驗 422 負向。");
      return;
    }
    await page.goto(`/#conv`);
    const refreshEnable = page.getByTestId("conv-refresh"); // #303 後 #/conv 的 refresh 是「重新整理」
    await refreshEnable.waitFor({ state: "visible", timeout: 30_000 });
    await refreshEnable.click();
    await expect(page.locator('[data-testid="conv-watch-off-banner"]')).toBeVisible();
    await page.locator('[data-testid="conv-watch-enable"]').click();
    await expect(page.locator('[data-testid="intent-dialog"]')).toBeVisible();
    const [res] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/conversion/watch") && r.request().method() === "PUT", { timeout: 30_000 }),
      page.locator('[data-testid="intent-confirm"]').click(),
    ]);
    // 未配置 → 422；已配置但本機可啟動 → 200（誠實兩擇一，不硬斷 422）。
    // 誠實鐵律：僅 200 / 422 為合法兩擇一；503 / 401 等後端錯誤路徑不得被 else 靜默吞掉 → 先硬斷後分支。
    expect([200, 422], `PUT /api/conversion/watch 預期 200(可啟動) 或 422(未配置)，實得 ${res.status()}`).toContain(res.status());
    if (res.status() === 422) {
      await expect(page.locator('[data-testid="intent-action-error"]')).toBeVisible();
      await expect(page.locator('[data-testid="intent-dialog"]')).toBeVisible(); // 不關
      await expect(page.locator('[data-testid="conv-watch-off-banner"]')).toBeVisible(); // 維持關閉態
    } else {
      notObserved.push(`測試區 watcher 可啟動（PUT 回 ${res.status()}）→ 422 負向未觀察，改驗正向。`);
    }
    await page.screenshot({ path: "../docs/evidence/conv-watch-toggle/watch-enable-attempt.png", fullPage: true });
  });

  test.afterAll(() => {
    if (notObserved.length) console.log("[conv-watch-toggle] notObserved:", JSON.stringify(notObserved));
  });
});

test("渲染 #conv 真頁面 → Refresh queue → 截圖 render surface（evidence，非 controlled-action 觀察）", async ({ page }) => {
  await page.goto(`/#conv`);
  const refreshRender = page.getByTestId("conv-refresh"); // #303 後 #/conv 的 refresh 是「重新整理」
  await refreshRender.waitFor({ state: "visible", timeout: 30_000 });
  await refreshRender.click();
  await expect(page.getByText("IFC→USD 轉檔排程", { exact: false })).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: "../docs/evidence/conv-watch-toggle/conv-render-surface.png", fullPage: true });
  await page.screenshot({ path: "../artifacts/e2e/conv-watch-toggle-render-surface.png", fullPage: true });
});

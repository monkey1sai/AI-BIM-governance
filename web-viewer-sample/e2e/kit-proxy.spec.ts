import { test, expect } from "@playwright/test";

// CH-D：Kit Manager 經 coordinator /api/kit/* forward-only proxy。
// 驗證：瀏覽器一律打 :8004 /api/kit/*（forward → kit-manager :8010 loopback），且「不直連 :8010」（守邊界 RK1）。
const COORDINATOR = process.env.E2E_COORDINATOR_BASE_URL || "http://127.0.0.1:8004";

test.describe("CH-D：Kit Manager 經 /api/kit proxy（forward-only，無直連 :8010）", () => {
  test("點 Kit 狀態 → 經 coordinator /api/kit/* 取得 kit-manager 資料，且瀏覽器無直連 :8010", async ({ page }) => {
    const requests: string[] = [];
    page.on("request", (r) => requests.push(r.url()));

    await page.goto(`${COORDINATOR}/ui#/kit`);
    await expect(page.getByTestId("kit-proxy-panel")).toBeVisible({ timeout: 20_000 });

    await page.getByTestId("kit-status-btn").click();

    // 三個欄位都應由 coordinator /api/kit/* forward 回 kit-manager 真實資料（HTTP 200）。
    await expect
      .poll(async () => (await page.getByTestId("kit-health").textContent()) || "", { timeout: 20_000 })
      .toMatch(/^200/);
    await expect(page.getByTestId("kit-instance")).toContainText("200");
    await expect(page.getByTestId("kit-usdc-count")).toContainText("count=");

    // 邊界：瀏覽器所有 kit 請求走 :8004 /api/kit/*，且「絕不」直連 :8010。
    const direct8010 = requests.filter((u) => /:8010(\/|$|\?)/.test(u));
    expect(direct8010, `browser must NOT call :8010 directly: ${direct8010.join(", ")}`).toHaveLength(0);
    const kitProxyCalls = requests.filter((u) => /\/api\/kit\//.test(u));
    expect(kitProxyCalls.length, "browser should call coordinator /api/kit/*").toBeGreaterThan(0);

    // 變更型 /api/kit/* 需 operator/dev 授權（PR #184 風險修正）：無 token → 403；有 dev token → 非 403（轉發）。
    const noAuth = await page.request.post(`${COORDINATOR}/api/kit/instances/current/open`, { data: {}, failOnStatusCode: false });
    expect(noAuth.status(), "mutating kit without auth must be 403").toBe(403);
    const withAuth = await page.request.post(`${COORDINATOR}/api/kit/instances/current/open`, {
      data: {},
      headers: { "x-dev-token": "dev-token" },
      failOnStatusCode: false,
    });
    expect(withAuth.status(), "mutating kit with dev token must be forwarded (not 403)").not.toBe(403);

    await page.screenshot({ path: "../artifacts/e2e/kit-proxy.png", fullPage: true });
    console.log("CH-D kit-proxy calls:", kitProxyCalls.length, "| direct :8010:", direct8010.length, "| mutating noAuth:", noAuth.status(), "withAuth:", withAuth.status());
  });
});

import { test, expect } from "@playwright/test";

// CH-E：coordinator :8004/ui 服務 React UnifiedConsole（vite base=/ui/，gated on CONSOLE_DIST_DIR）。
// 驗六個 hash 路由各自掛對應 operator 頁，且 nav 點擊可切換。/ui/console 301、/ui/open 302 凍結由
// ui-open-regression.spec 另行覆蓋；本 spec 專注「六頁可達 + nav 切換」這條前端可操作鏈。
const COORDINATOR = process.env.E2E_COORDINATOR_BASE_URL || "http://127.0.0.1:8004";

test.describe("CH-E：統一治理控制台六路由（:8004/ui React console）", () => {
  test("/ui 直接導航：六 hash 路由各渲染對應 operator 頁（含 #/kit、#/demo-control）", async ({ page }) => {
    // /ui 無 hash → 預設 coordinator 頁；nav 六鍵皆在（前端真實可見入口）。
    await page.goto(`${COORDINATOR}/ui`);
    await expect(page.getByTestId("op-page")).toBeVisible({ timeout: 20_000 });
    for (const k of ["coordinator", "intake", "demo-control", "review", "runtime", "kit"]) {
      await expect(page.getByTestId(`op-nav-${k}`)).toBeVisible();
    }
    await expect(page.getByRole("heading", { name: /Coordinator Console/ })).toBeVisible();

    // #/kit → Kit 模型台（/api/kit proxy 面板）。
    await page.goto(`${COORDINATOR}/ui#/kit`);
    await expect(page.getByTestId("kit-proxy-panel")).toBeVisible({ timeout: 15_000 });

    // #/demo-control → 真實 IFC 進件垂直切片。
    await page.goto(`${COORDINATOR}/ui#/demo-control`);
    await expect(page.getByTestId("real-ifc-demo-control")).toBeVisible({ timeout: 15_000 });

    // #/review → Review Room（審查室）。
    await page.goto(`${COORDINATOR}/ui#/review`);
    await expect(page.getByRole("heading", { name: /審查室/ })).toBeVisible({ timeout: 15_000 });

    // #/intake → 模型進件（選取現成模型）。
    await page.goto(`${COORDINATOR}/ui#/intake`);
    await expect(page.getByRole("heading", { name: /模型進件/ })).toBeVisible({ timeout: 15_000 });

    // #/runtime → Runtime Dashboard。
    await page.goto(`${COORDINATOR}/ui#/runtime`);
    await expect(page.getByRole("heading", { name: /Runtime Dashboard/ })).toBeVisible({ timeout: 15_000 });

    await page.screenshot({ path: "../artifacts/e2e/unified-console-routes.png", fullPage: true });
  });

  test("nav 點擊切換頁面（hash 更新 + 內容切換，零依賴 hash 路由）", async ({ page }) => {
    await page.goto(`${COORDINATOR}/ui#/coordinator`);
    await expect(page.getByTestId("op-page")).toBeVisible({ timeout: 20_000 });

    await page.getByTestId("op-nav-kit").click();
    await expect(page).toHaveURL(/#\/kit$/);
    await expect(page.getByTestId("kit-proxy-panel")).toBeVisible();

    await page.getByTestId("op-nav-demo-control").click();
    await expect(page).toHaveURL(/#\/demo-control$/);
    await expect(page.getByTestId("real-ifc-demo-control")).toBeVisible();

    await page.getByTestId("op-nav-review").click();
    await expect(page).toHaveURL(/#\/review$/);
    await expect(page.getByRole("heading", { name: /審查室/ })).toBeVisible();

    await page.screenshot({ path: "../artifacts/e2e/unified-console-nav.png", fullPage: true });
  });
});

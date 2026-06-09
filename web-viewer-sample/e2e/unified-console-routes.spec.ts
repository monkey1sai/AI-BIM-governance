import { test, expect } from "@playwright/test";

// B 方案：coordinator :8004/ui 改掛 EdgeConsole 產品操作台（取代 OperatorConsole 六頁）。
// 本 spec 專注「EdgeConsole 殼層可達 + 換台後仍保留的 operator-tool 路由（#/kit、#/demo-control）」。
// 完整 prototype 頁（home /「今天要做什麼」、#/a1、#/viewer、#/conv、#/sessions、#/instances、#/minio）
// 由 product-console-integration.spec.ts 覆蓋。/ui/console 301、/ui/open 302 凍結由 ui-open-regression.spec 覆蓋。
const COORDINATOR = process.env.E2E_COORDINATOR_BASE_URL || "http://127.0.0.1:8004";

test.describe("B 操作台：:8004/ui EdgeConsole 路由 + 保留 operator-tool 路由", () => {
  test("/ui 掛 EdgeConsole 殼層；保留 #/kit、#/demo-control、#/review、#/runtime 可達", async ({ page }) => {
    // /ui 無 hash → EdgeConsole HomePage（今天要做什麼）。
    await page.goto(`${COORDINATOR}/ui`);
    await expect(page.getByRole("heading", { name: /今天要做什麼/ })).toBeVisible({ timeout: 20_000 });

    // #/kit → Kit 模型台（/api/kit proxy 面板）——換 EdgeConsole 後仍保留（非 silently 砍）。
    await page.goto(`${COORDINATOR}/ui#/kit`);
    await expect(page.getByTestId("kit-proxy-panel")).toBeVisible({ timeout: 15_000 });

    // #/demo-control → 真實 IFC 進件垂直切片——保留（真實 IFC E2E 入口）。
    await page.goto(`${COORDINATOR}/ui#/demo-control`);
    await expect(page.getByTestId("real-ifc-demo-control")).toBeVisible({ timeout: 15_000 });

    // #/review → Review Room（審查室）。
    await page.goto(`${COORDINATOR}/ui#/review`);
    await expect(page.getByRole("heading", { name: /審查室/ })).toBeVisible({ timeout: 15_000 });

    // #/runtime → Runtime 監控。
    await page.goto(`${COORDINATOR}/ui#/runtime`);
    await expect(page.getByRole("heading", { name: /Runtime/ })).toBeVisible({ timeout: 15_000 });

    await page.screenshot({ path: "../artifacts/e2e/unified-console-routes.png", fullPage: true });
  });

  test("EdgeConsole nav 點擊切換頁面（hash 更新 + 內容切換，零依賴 hash 路由）", async ({ page }) => {
    await page.goto(`${COORDINATOR}/ui#/a1`);
    await expect(page.getByRole("heading", { name: /A1 · 治理與模型檢核/ })).toBeVisible({ timeout: 20_000 });

    // 點 nav 切到 A2 版本差異（core 治理 group 內的另一頁）。
    await page.getByRole("button", { name: /Version Diff/ }).first().click();
    await expect(page).toHaveURL(/#\/?a2$/);
    await expect(page.getByRole("heading", { name: /版本差異/ })).toBeVisible({ timeout: 15_000 });

    await page.screenshot({ path: "../artifacts/e2e/unified-console-nav.png", fullPage: true });
  });
});

import { expect, test } from "@playwright/test";

const COORDINATOR = process.env.E2E_COORDINATOR_BASE_URL || "http://127.0.0.1:8004";

test.describe("Product AI-BIM Governance console integration", () => {
  test("operator can navigate prototype-derived product console pages", async ({ page }) => {
    const severeConsole: string[] = [];
    page.on("console", (msg) => {
      if (["error"].includes(msg.type())) severeConsole.push(msg.text());
    });
    page.on("pageerror", (err) => severeConsole.push(err.message));

    await page.goto(`${COORDINATOR}/ui`);
    await expect(page.getByRole("heading", { name: /今天要做什麼/ })).toBeVisible();
    await expect(page.getByText("核心治理")).toBeVisible();
    await expect(page.getByText("OMNIVERSE RUNTIME")).toBeVisible();
    await expect(page.getByText("落地端控制台")).toBeVisible();
    await expect(page.getByText("Chat USD Agent")).toBeVisible();

    await page.goto(`${COORDINATOR}/ui#/a1`);
    await expect(page.getByRole("heading", { name: /A1/ })).toBeVisible();
    await expect(page.getByText("A1 五步引導式流程")).toBeVisible();
    await expect(page.locator("main").getByText("governance-service :49102", { exact: true })).toBeVisible();

    await page.goto(`${COORDINATOR}/ui#/viewer`);
    await expect(page.getByRole("heading", { name: /3D Viewer/ })).toBeVisible();
    await expect(page.locator("main").getByText("DataChannel", { exact: true }).first()).toBeVisible();
    await expect(page.locator("main").getByText("highlightPrimsRequest", { exact: true }).first()).toBeVisible();

    await page.goto(`${COORDINATOR}/ui#/conv`);
    await expect(page.getByRole("heading", { name: /IFC→USD/ })).toBeVisible();
    await expect(page.locator("main").getByText("mapping coverage", { exact: true }).first()).toBeVisible();

    await page.goto(`${COORDINATOR}/ui#/sessions`);
    await expect(page.getByRole("heading", { name: /Session 管理/ })).toBeVisible();
    await expect(page.locator("main").getByText(/first frame/i).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Reclaim stale spectator/ })).toBeVisible();

    await page.goto(`${COORDINATOR}/ui#/instances`);
    await expect(page.getByRole("heading", { name: /Kit \/ GPU 機隊/ })).toBeVisible();
    await expect(page.locator("main").getByText("1 GPU = 1 Kit stream", { exact: true }).first()).toBeVisible();

    await page.goto(`${COORDINATOR}/ui#/minio`);
    await expect(page.getByRole("heading", { name: /MinIO 資料/ })).toBeVisible();
    await expect(page.locator("main .ec-tree").getByText("bim-control/", { exact: true })).toBeVisible();
    await expect(page.locator("main .ec-tree").getByText("model.usdc", { exact: true })).toBeVisible();

    await page.screenshot({ path: "../artifacts/e2e/product-governance-console-integration.png", fullPage: true });
    expect(severeConsole).toEqual([]);
  });
});

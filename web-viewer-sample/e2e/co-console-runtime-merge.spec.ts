import { expect, test } from "@playwright/test";

const COORDINATOR = process.env.E2E_COORDINATOR_BASE_URL || "http://127.0.0.1:8004";

test.describe("co-console-runtime-merge", () => {
  test("left nav removes CO, #runtime owns Coordinator runtime console, FlowBar routes to runtime", async ({ page }) => {
    await page.goto(`${COORDINATOR}/ui#/home`);

    await expect(page.getByText("落地端控制台", { exact: false }).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: /審查控制台/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /IFC→USD 轉檔排程/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /MinIO 資料/ })).toBeVisible();
    await page.screenshot({ path: "../artifacts/e2e/co-merge-nav-no-co.png", fullPage: true });

    await page.getByRole("button", { name: /建立審查會議/ }).first().click();
    await expect(page).toHaveURL(/#\/?runtime$/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: /Coordinator Console/ })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("tab", { name: /A Classic Dashboard/ })).toBeVisible();

    await page.getByRole("button", { name: /紀錄回寫雲端/ }).first().click();
    await expect(page).toHaveURL(/#\/?runtime$/, { timeout: 15_000 });
    await page.screenshot({ path: "../artifacts/e2e/co-merge-flow-runtime.png", fullPage: true });
  });

  test("#runtime shows runtime duty label, Coordinator tabs, and read-only ATC actions", async ({ page }) => {
    const runtimeStatusRequest = page.waitForRequest(
      (request) => request.url().includes("/api/runtime/status"),
      { timeout: 20_000 },
    );

    await page.goto(`${COORDINATOR}/ui#/runtime`);
    await runtimeStatusRequest;

    await expect(page.getByRole("button", { name: /Runtime 觀測值班台/ })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: /串流執行狀態/ })).toHaveCount(0);
    await expect(page.getByRole("tab", { name: /A Classic Dashboard/ })).toBeVisible();
    await expect(page.getByRole("tab", { name: /B ATC Tower/ })).toBeVisible();
    await expect(page.getByRole("tab", { name: /C Lifecycle Flow/ })).toBeVisible();
    await expect(page.getByRole("tab", { name: /D Terminal \/ Debug/ })).toBeVisible();
    await page.screenshot({ path: "../artifacts/e2e/co-merge-runtime-four-tabs.png", fullPage: true });

    await page.getByRole("tab", { name: /B ATC Tower/ }).click();
    await expect(page.getByText("Controlled Actions", { exact: false }).first()).toBeVisible({ timeout: 15_000 });
    const openPrimary = page.getByRole("button", { name: /Open primary URL/ });
    await expect(openPrimary).toBeVisible();
    await expect(openPrimary).toBeDisabled();
    await page.screenshot({ path: "../artifacts/e2e/co-merge-runtime-readonly.png", fullPage: true });
  });

  test("Terminal/Debug keeps StreamConfigReader reachable and validates session ids", async ({ page }) => {
    await page.goto(`${COORDINATOR}/ui#/runtime`);
    await page.getByRole("tab", { name: /D Terminal \/ Debug/ }).click();

    const input = page.getByPlaceholder("review_session_id");
    const readButton = page.getByRole("button", { name: /讀取 stream-config/ });
    await expect(input).toBeVisible({ timeout: 15_000 });
    await expect(readButton).toBeVisible();

    await input.fill("abc");
    await expect(readButton).toBeDisabled();
    await expect(page.getByText(/session id 不符格式/)).toBeVisible();

    const streamConfigRequest = page.waitForRequest(
      (request) => request.url().includes("/api/review-sessions/review_session_x/stream-config"),
      { timeout: 20_000 },
    );
    await input.fill("review_session_x");
    await expect(readButton).toBeEnabled();
    await readButton.click();
    await streamConfigRequest;
    await page.screenshot({ path: "../artifacts/e2e/co-merge-streamconfig-reachable.png", fullPage: true });
  });
});

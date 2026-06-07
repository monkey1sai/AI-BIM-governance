import { test, expect } from "@playwright/test";

// CH-B 證據：左側 USD/BIM 語意樹點選 → 相機聚焦該元件。
// 真實前端互動（_onSelectUSDPrims → selectPrimsRequest + focusPrimRequest）跑在可決定性假 Kit 上。
test.describe("viewer USD 語意樹 → 相機聚焦（CH-B，deterministic harness）", () => {
  test("點樹節點 Building → 送 focusPrimRequest（harness viewport 顯示 focus: 該 prim path）", async ({ page }) => {
    await page.goto("/?harness=1");

    const label = page.getByTestId("harness-viewport-label");
    await expect(label).toBeVisible({ timeout: 25_000 });
    // 先等 stage 載入（openStage 完成），樹才會由 getChildrenResponse 填出根節點。
    await expect(label).toContainText("stage:", { timeout: 15_000 });

    // USDStage 在 stage 載入後出現根節點（Building / Site）。
    const buildingNode = page.getByText("Building", { exact: true });
    await expect(buildingNode).toBeVisible({ timeout: 15_000 });

    await buildingNode.click();

    // 點節點 → 相機聚焦該 prim：假 Kit 收到 focusPrimRequest 後，harness viewport label 更新為 focus: <prim path>。
    await expect(label).toContainText("focus: /World/Building", { timeout: 10_000 });

    await page.screenshot({ path: "../artifacts/e2e/viewer-tree-focus.png", fullPage: true });
  });
});

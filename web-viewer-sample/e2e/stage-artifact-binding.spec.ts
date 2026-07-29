import { test, expect } from "@playwright/test";
import { harnessRoute } from "./harnessRoute";

// CH-F：Stage / Artifact Binding —— 選 1..N ready USDC、指定唯一 primary、調 load_order、交易式套用 → 重組 stage。
// 用 deterministic harness 的 ready USDC fixtures；apply → composeStageRequest → 假 Kit 回 bindingApplied → active revision。
test.describe("CH-F：Stage / Artifact Binding（primary 交易式套用）", () => {
  test("選 N 個 ready USDC → 指定 primary → 調 load_order → 套用 → active binding revision 出現", async ({ page }) => {
    await page.goto(harnessRoute());

    const label = page.getByTestId("harness-viewport-label");
    await expect(label).toBeVisible({ timeout: 25_000 });
    await expect(label).toContainText("stage:", { timeout: 15_000 });
    await page.getByTestId("nav-issues").click();
    await expect(page.getByTestId("nav-issues")).toHaveAttribute("aria-current", "page");

    // BindingComposer 列出 harness 的 3 個 ready USDC artifact。
    const table = page.getByTestId("binding-table");
    await expect(table).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("binding-row")).toHaveCount(3);

    // 選 2 個 → 指定 building 為唯一 primary → 調 levels load_order。
    await page.getByTestId("binding-select-artifact_h_building").check();
    await page.getByTestId("binding-select-artifact_h_levels").check();
    await page.getByTestId("binding-primary-artifact_h_building").check();
    await page.getByTestId("binding-loadorder-artifact_h_levels").fill("5");

    // 交易式套用（composeStageRequest）。
    await page.getByTestId("binding-apply").click();

    // 假 Kit 回 bindingApplied → active binding revision 出現（誠實：確認才宣告）。
    await expect(page.getByTestId("binding-active-revision")).toContainText("binding_rev_", { timeout: 10_000 });

    await page.screenshot({ path: "../artifacts/e2e/stage-artifact-binding.png", fullPage: true });
  });
});

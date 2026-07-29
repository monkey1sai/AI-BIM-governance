import { test, expect } from "@playwright/test";
import { harnessRoute } from "./harnessRoute";

// primary / spectator 業務權限（NVIDIA streaming 角色之上的 app 授權）。
// primary：可操作 binding（mutating）；spectator：同樣控制可見但 disabled + 誠實理由 banner，不送 mutating 指令。
test.describe("primary / spectator authority", () => {
  test("primary：binding-apply enabled，套用後出現 active binding revision", async ({ page }) => {
    await page.goto(harnessRoute());
    await expect(page.getByTestId("harness-viewport-label")).toContainText("stage:", { timeout: 25_000 });
    await page.getByTestId("nav-issues").click();
    await expect(page.getByTestId("nav-issues")).toHaveAttribute("aria-current", "page");

    const apply = page.getByTestId("binding-apply");
    await expect(apply).toBeEnabled();

    await page.getByTestId("binding-select-artifact_h_building").check();
    await page.getByTestId("binding-primary-artifact_h_building").check();
    await apply.click();

    await expect(page.getByTestId("binding-active-revision")).toContainText("binding_rev_", { timeout: 10_000 });
  });

  test("spectator：控制可見但 disabled + 誠實 readonly banner（不送 mutating）", async ({ page }) => {
    await page.goto(harnessRoute({ streamRole: "spectator" }));
    await page.getByTestId("nav-issues").click();
    await expect(page.getByTestId("nav-issues")).toHaveAttribute("aria-current", "page");

    // spectator overlay 仍渲染（沿用 primary 串流），但唯讀。誠實 reason banner 出現。
    await expect(page.getByTestId("gov-readonly-banner")).toBeVisible({ timeout: 25_000 });

    // 同一批控制可見但 disabled（aria-disabled / disabled）。
    const apply = page.getByTestId("binding-apply");
    await expect(apply).toBeVisible();
    await expect(apply).toBeDisabled();
    await expect(page.getByTestId("gov-run-rulecheck")).toBeDisabled();
    await expect(page.getByTestId("gov-clear")).toBeDisabled();

    await page.screenshot({ path: "../artifacts/e2e/primary-spectator-authority.png", fullPage: true });
  });
});

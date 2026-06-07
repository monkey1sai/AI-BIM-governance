import { test, expect } from "@playwright/test";

// CH-0 基礎證據：可決定性 harness 讓 viewer 在「無真實 Kit / WebRTC」下也能開機到 streamReady。
// 不假造前端狀態機 —— Window/AppStream 的真實邏輯照跑，只有 transport + Kit 回應被 FakeAppStreamer 取代。
test.describe("viewer harness 開機（deterministic，無真實 Kit）", () => {
  test("?harness=1 → streamReady → 顯示 HARNESS VIEWPORT 佔位", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    await page.goto("/?harness=1");

    const label = page.getByTestId("harness-viewport-label");
    await expect(label).toBeVisible({ timeout: 25_000 });
    await expect(label).toContainText("HARNESS VIEWPORT");

    // 等 openStage 指令真的流過假 Kit（label 由「stream ready」更新為「stage: …」），
    // 證明 viewer 的真實載入狀態機（openStageRequest → openedStageResult → completeStageLoad）有跑。
    await expect(label).toContainText("stage:", { timeout: 15_000 });

    await page.screenshot({ path: "../artifacts/e2e/viewer-harness-boot.png", fullPage: true });

    // 誠實檢查：harness 開機不應噴出未捕捉的 console error（容許串流相關的良性警告，故只看 error）。
    expect(consoleErrors, `unexpected console errors: ${consoleErrors.join("\n")}`).toEqual([]);
  });
});

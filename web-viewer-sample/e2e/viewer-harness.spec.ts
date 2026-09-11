import { test, expect } from "@playwright/test";
import { harnessRoute } from "./harnessRoute";

// CH-0 基礎證據：可決定性 harness 讓 viewer 在「無真實 Kit / WebRTC」下也能開機到 streamReady。
// 不假造前端狀態機 —— Window/AppStream 的真實邏輯照跑，只有 transport + Kit 回應被 FakeAppStreamer 取代。
test.describe("viewer harness 開機（deterministic，無真實 Kit）", () => {
  test("?harness=1 → streamReady → 顯示 HARNESS VIEWPORT 佔位", async ({ page }) => {
    await page.route("https://fonts.googleapis.com/**", (route) => route.fulfill({
      status: 200,
      contentType: "text/css",
      body: "",
    }));
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    await page.goto(harnessRoute());

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

  test("DataChannel command dispatch records acknowledged viewer activity", async ({ page }) => {
    await page.route("https://fonts.googleapis.com/**", (route) => route.fulfill({
      status: 200,
      contentType: "text/css",
      body: "",
    }));
    await page.goto(`${harnessRoute()}&debug=1`);
    await expect(page.getByTestId("harness-viewport-label")).toContainText("stage:", { timeout: 25_000 });
    // FakeAppStreamer has no media track. Provide a synthetic frame through the
    // production loadeddata callback so the fake socket can acknowledge activity.
    // This fixture is not evidence of a real Kit/WebRTC frame.
    await page.locator("#remote-video").evaluate((element) => {
      const video = element as HTMLVideoElement;
      Object.defineProperties(video, {
        readyState: { configurable: true, get: () => HTMLMediaElement.HAVE_CURRENT_DATA },
        videoWidth: { configurable: true, get: () => 1280 },
        videoHeight: { configurable: true, get: () => 720 },
      });
      video.dispatchEvent(new Event("loadeddata"));
    });
    // Startup loads are automatic activity. Exercise an explicit user command
    // before requiring an activity ACK, then verify another dispatch after debounce.
    const command = page.locator("button").filter({ hasText: "載入可審查 3D 模型" }).first();
    await command.evaluate((element) => (element as HTMLButtonElement).click());
    await expect(page.locator("body")).toContainText("Socket.IO userActivity 已確認", { timeout: 10_000 });
    const acknowledgedCount = async () => (
      (await page.locator("body").textContent())?.match(/Socket\.IO userActivity 已確認/g) ?? []
    ).length;
    const acknowledgedBefore = await acknowledgedCount();
    await page.waitForTimeout(5_100);

    await command.evaluate((element) => (element as HTMLButtonElement).click());

    await expect(page.getByTestId("demo-outgoing-log")).toContainText("loadingStateQuery");
    await expect.poll(
      acknowledgedCount,
      { timeout: 10_000 },
    ).toBeGreaterThan(acknowledgedBefore);
  });
});

import { test, expect } from "@playwright/test";

// CH-H1：中央 3D 視區「不再空白」。harness（無 GPU）下，原本中央是空白 <video>；現以資訊濃密 mock viewport
// 取代——明標 deterministic·no-GPU（非壞掉），含範本①模型資訊卡 + ④對構表（誠實空狀態）+ loaded layers + 選取 echo。
// 截圖證明「不空白、友善」。真實 ①④ 資料 + live 3D 由 real-ifc 路徑驗。
test.describe("CH-H1 semantic viewer · mock viewport（harness 不空白）", () => {
  test("?harness=1 中央顯資訊濃密 mock viewport（banner/stage/model-info/mapping/layers），非空白", async ({ page }) => {
    await page.goto("/?harness=1");

    const mv = page.getByTestId("mock-viewport");
    await expect(mv).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("geo-viewer-left-model")).toBeVisible();
    await expect(page.getByTestId("geo-viewer-center-stage")).toBeVisible();
    await expect(page.getByTestId("geo-viewer-right-semantic")).toBeVisible();
    await expect(page.getByTestId("geo-viewer-bottom-mapping")).toBeVisible();
    await expect(page.getByTestId("geo-viewer-runtime-evidence")).toContainText(/primary|spectator|session/i);

    // 明標非壞掉
    await expect(page.getByTestId("mock-viewport-banner")).toContainText(/no-GPU|deterministic/);

    // 範本①模型資訊卡 + ④對構表 都在中央（不再只有空白視區）
    await expect(page.getByTestId("model-info-card")).toBeVisible();
    await expect(page.getByTestId("mapping-table")).toBeVisible();

    // harness 無 mapping_url → 誠實空狀態（不捏造對構），而非假資料
    await expect(page.getByTestId("mapping-empty")).toBeVisible();

    // 資訊濃密證據：harness 三圖層（Building Shell / Levels / MEP）
    await expect(page.getByTestId("mock-layer-count")).toHaveText(/[1-9]/);
    await expect(page.getByTestId("mock-layers")).toBeVisible();

    // viewport 狀態區（stage / selected echo）存在
    await expect(page.getByTestId("mock-stage-url")).toBeVisible();
    await expect(page.getByTestId("mock-selected")).toBeVisible();

    // CH-H1b：範本式 section nav（模型 active；批註等 roadmap 誠實 disabled）
    await expect(page.getByTestId("gv-nav")).toBeVisible();
    await expect(page.getByTestId("nav-model")).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("nav-批註")).toBeDisabled();
    const outerScroll = await page.evaluate(() => ({
      documentOverflows: document.documentElement.scrollHeight > document.documentElement.clientHeight + 1,
      bodyOverflows: document.body.scrollHeight > window.innerHeight + 1,
      documentScrollHeight: document.documentElement.scrollHeight,
      documentClientHeight: document.documentElement.clientHeight,
      bodyScrollHeight: document.body.scrollHeight,
      windowInnerHeight: window.innerHeight,
    }));
    expect(outerScroll.documentOverflows, JSON.stringify(outerScroll)).toBe(false);
    expect(outerScroll.bodyOverflows, JSON.stringify(outerScroll)).toBe(false);
    await expect(page.locator(".stage-truth-panel")).toHaveCount(0);
    await expect(page.getByText("DERIVED ready")).toHaveCount(0);
    await expect(page.getByTestId("gov-run-rulecheck")).toHaveCount(0);

    await page.screenshot({ path: "../artifacts/e2e/gov-viewer-layout.png", fullPage: true });
  });

  test("?harness=1 窄視窗七軸 rail 不溢出，且 model tab 不顯示治理/debug 面板", async ({ page }) => {
    await page.setViewportSize({ width: 820, height: 900 });
    await page.goto("/?harness=1");

    const mv = page.getByTestId("mock-viewport");
    await expect(mv).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("viewer-seven-axis-rail")).toBeVisible();
    await expect(page.getByTestId("mapping-table")).toBeVisible();

    const viewportBox = await mv.boundingBox();
    const railBox = await page.getByTestId("viewer-seven-axis-rail").boundingBox();
    expect(viewportBox).not.toBeNull();
    expect(railBox).not.toBeNull();
    expect((railBox?.x ?? 0) + (railBox?.width ?? 0)).toBeLessThanOrEqual((viewportBox?.x ?? 0) + (viewportBox?.width ?? 0) + 1);

    const bridge = page.getByTestId("viewer-session-bridge");
    await expect(bridge).toContainText("role");
    await expect(bridge).toContainText("session");
    await expect(bridge).toContainText("stream");
    await expect(bridge).toContainText("File");
    await expect(bridge).toContainText("Runtime");
    await expect(bridge).toContainText("Semantic");
    await expect(page.getByTestId("viewer-seven-axis-rail")).toContainText("A1 疊加");
    await expect(page.getByTestId("viewer-seven-axis-rail")).toContainText("反向定位");
    await expect(page.getByTestId("mock-stage")).not.toContainText("Stage truth");
    await expect(bridge).not.toContainText("Command evidence");
    await expect(bridge).not.toContainText("Review Room");
    await expect(bridge).not.toContainText("mutating commands gated open");

    await page.screenshot({ path: "../artifacts/e2e/gov-viewer-layout-narrow.png", fullPage: true });
  });
});

import { test, expect } from "@playwright/test";

// 硬性需求：從 :8004/ui 前端選「真實 ./storage/*.ifc」→ 真 coordinator ifc-ready（self-loopback 真下載）
// → 真 streaming-server 轉檔派工 → 誠實 runtime 狀態 + 完整 lineage。不可只用 mock ready artifact。
// 誠實鐵律：轉檔慢/阻塞時顯示 conversion_failed / runtime_blocked / conversion_timeout，不偽造成功。
const COORDINATOR = process.env.E2E_COORDINATOR_BASE_URL || "http://127.0.0.1:8004";

test.describe("真實 IFC fixture 垂直切片（real coordinator + streaming，honest runtime）", () => {
  test.setTimeout(240_000);

  test("前端選真實 ./storage IFC → 註冊 → 真下載 + 真轉檔派工 + 誠實狀態 + lineage", async ({ page }) => {
    await page.goto(`${COORDINATOR}/ui#/demo-control`);

    const panel = page.getByTestId("real-ifc-demo-control");
    await expect(panel).toBeVisible({ timeout: 20_000 });

    const select = page.getByTestId("ifc-fixture-select");
    // 下拉須由真 coordinator GET /api/dev/ifc-sources 填出真實 ./storage *.ifc。
    await expect
      .poll(async () => select.locator("option").count(), { timeout: 15_000 })
      .toBeGreaterThan(0);

    const options = await select.locator("option").evaluateAll((opts) =>
      opts.map((o) => ({ value: (o as HTMLOptionElement).value, text: o.textContent || "" })),
    );
    // 優先選指定 fixture 許良宇圖書館建築_2026.ifc（非 轉檔測試 變體）；fallback demo_lib / 任一真實 .ifc。
    const pick =
      options.find((o) => o.text.includes("許良宇圖書館建築_2026.ifc") && !o.text.includes("測試")) ||
      options.find((o) => o.text.includes("demo_lib_2026.ifc")) ||
      options.find((o) => o.text.includes(".ifc"));
    expect(pick, "需有真實 ./storage *.ifc fixture 可選").toBeTruthy();
    await select.selectOption(pick!.value);

    await page.getByTestId("ifc-register-btn").click();

    // 真實派工證據（~10-15s 內出現）：download 真實成功 + streaming authority 真實 conversion_job_id。
    await expect
      .poll(async () => (await page.getByTestId("lin-download-status").textContent()) || "", { timeout: 60_000 })
      .toContain("downloaded");
    await expect
      .poll(async () => (await page.getByTestId("lin-conversion-job").textContent()) || "", { timeout: 90_000 })
      .toContain("stream_conv_");

    // lineage 欄位須為真實值（非 —）。
    await expect(page.getByTestId("lin-source-path")).toContainText("/api/dev/ifc-file/");
    await expect(page.getByTestId("lin-source-filename")).toContainText(".ifc");
    await expect(page.getByTestId("lin-job-id")).toContainText("ifcready_");
    await expect(page.getByTestId("lin-model-version")).toContainText("mv_realifc");

    // runtime 狀態須為誠實值（converting / ready / runtime_blocked / conversion_timeout），不可停在 idle/registering。
    const stateEl = page.getByTestId("ifc-runtime-state");
    await expect
      .poll(async () => (await stateEl.textContent()) || "", { timeout: 30_000 })
      .toMatch(/runtime: (converting|ready|runtime_blocked|conversion_timeout|conversion_failed)/);

    // 機會式 happy-path：若在窗口內轉檔完成，順帶驗證 viewer_url（/ui/open handoff）。
    const reachedReady = await stateEl
      .filter({ hasText: "ready" })
      .first()
      .isVisible()
      .catch(() => false);
    if (reachedReady) {
      await expect(page.getByTestId("lin-viewer-url")).toContainText("/ui/open?session=");
    }

    await page.screenshot({ path: "../artifacts/e2e/real-ifc-intake.png", fullPage: true });

    const finalState = (await stateEl.textContent()) || "";
    const convStatus = (await page.getByTestId("lin-conversion-status").textContent()) || "";
    console.log("REAL-IFC fixture:", pick!.text, "| runtime:", finalState, "| conversion_status:", convStatus);
  });
});

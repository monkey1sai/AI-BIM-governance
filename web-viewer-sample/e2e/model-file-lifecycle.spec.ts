import { expect, test } from "@playwright/test";
import { readyModelId, startReadyReviewFixture } from "./support/ready-review-fixture";

// 契約 §5：清單→建立審查→#sessions 結束→已封存移除→清理預覽→移除紀錄；coordinator 為行程內真實實例，
// 轉檔權威為合成 fixture（不宣稱 Kit／GPU）。
test.describe.serial("Model file lifecycle console flow", () => {
  let fixture: Awaited<ReturnType<typeof startReadyReviewFixture>>;
  test.beforeAll(async () => { fixture = await startReadyReviewFixture(); });
  test.afterAll(async () => { await fixture?.stop(); });

  test("list, create, close, purge, cleanup preview, remove record", async ({ page, request }, testInfo) => {
    await page.goto(`${fixture.base}/ui/#a1-workbench`);
    const row = page.getByTestId(`model-file-row-${readyModelId}`);
    await expect(row).toContainText("Session contract fixture · architecture · 版本 v1");
    await expect(page.getByTestId(`model-file-open-${readyModelId}`)).toBeDisabled();

    const created = page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith(`/api/conversion/records/${readyModelId}/review-session`));
    await page.getByTestId(`model-file-create-${readyModelId}`).click();
    const { review_session_id: sessionId } = await (await created).json();
    await expect(page.getByTestId("a1-session-select")).toHaveValue(sessionId);
    // 建立成功後清單自行重載：不按重新整理，列上就要看到新審查且移除鈕停用。
    await expect(row).toContainText("進行中 1");
    await expect(page.getByTestId(`model-file-remove-${readyModelId}`)).toBeDisabled();
    await expect(page.getByTestId(`model-file-open-${readyModelId}`)).toBeEnabled();
    await page.getByTestId("model-file-refresh").click();
    await expect(row).toContainText("進行中 1");
    await expect(page.getByTestId(`model-file-remove-${readyModelId}`)).toBeDisabled();
    await page.screenshot({ path: testInfo.outputPath("model-file-list.png"), fullPage: true });

    await page.goto(`${fixture.base}/ui/#sessions`);
    await page.getByTestId(`session-terminate-${sessionId}`).click();
    const closed = page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith(`/api/review-sessions/${sessionId}/close`));
    await page.getByTestId("intent-confirm").click();
    expect((await closed).ok()).toBeTruthy();
    await expect(page.getByTestId(`closed-session-row-${sessionId}`)).toBeVisible();
    await expect(page.getByTestId(`closed-session-file-${sessionId}`)).toContainText("來源未知");

    await page.getByTestId(`session-purge-${sessionId}`).click();
    const purged = page.waitForResponse((r) => r.request().method() === "DELETE" && r.url().includes(`/api/review-sessions/${sessionId}`));
    await page.getByTestId("intent-confirm").click();
    expect((await purged).status()).toBe(200);
    await expect(page.getByTestId(`closed-session-row-${sessionId}`)).toHaveCount(0);
    expect((await request.get(`${fixture.base}/api/review-sessions/${sessionId}`)).status()).toBe(404);

    await page.getByTestId("cleanup-open").click();
    await page.getByTestId("cleanup-days").fill("1");
    await page.getByTestId("cleanup-preview").click();
    await expect(page.getByTestId("cleanup-group-records")).toContainText("0");
    await expect(page.getByTestId("cleanup-confirm")).toBeDisabled();
    await page.getByTestId("cleanup-cancel").click();
    await page.screenshot({ path: testInfo.outputPath("sessions-after-purge.png"), fullPage: true });

    await page.goto(`${fixture.base}/ui/#a1-workbench`);
    await page.getByTestId(`model-file-remove-${readyModelId}`).click();
    const removed = page.waitForResponse((r) => r.request().method() === "DELETE" && r.url().endsWith(`/api/conversion/records/${readyModelId}`));
    await page.getByTestId("intent-confirm").click();
    expect((await removed).status()).toBe(200);
    await expect(page.getByTestId(`model-file-row-${readyModelId}`)).toHaveCount(0);
    const hidden = await (await request.get(`${fixture.base}/api/conversion/records`)).json();
    expect(hidden.count).toBe(0);
    const shown = await (await request.get(`${fixture.base}/api/conversion/records?include_removed=1`)).json();
    expect(shown.items[0]).toMatchObject({ idempotency_key: readyModelId, status: "removed" });
  });
});

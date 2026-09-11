import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { readyModelId, startReadyReviewFixture } from "./support/ready-review-fixture";

test.describe.serial("Ready review intent HTTP contract", () => {
  let fixture: Awaited<ReturnType<typeof startReadyReviewFixture>>;
  test.beforeAll(async () => { fixture = await startReadyReviewFixture(); });
  test.afterAll(async () => { await fixture?.stop(); });

  test("explicit create, lost response retry after reload, named open and closed lineage", async ({ page, request }, testInfo) => {
    const route = `${fixture.base}/api/conversion/records/${readyModelId}/review-session`;
    let claims = 0;
    page.on("request", req => { if (req.url().includes("/viewer-leases/claim")) claims++; });
    await page.goto(`${fixture.base}/ui/#a1-workbench`);
    await expect.poll(() => fixture.governanceRequests.length).toBeGreaterThan(0);
    const logFile = fixture.coordinator.structLog.currentFile();
    expect(path.relative(fixture.root, logFile)).toMatch(/^logs[\\/]/);
    expect(fs.existsSync(logFile)).toBe(true);
    await page.getByTestId("ready-review-model").selectOption(readyModelId);
    const firstResponse = page.waitForResponse(r => r.url() === route && r.request().method() === "POST");
    await page.getByTestId("ready-review-create").click();
    const first = await (await firstResponse).json();
    await expect(page.getByTestId("a1-session-select")).toHaveValue(first.review_session_id);
    expect(first.session_status).toBe("created");
    await expect(page.getByTestId("a1-inline-session-preparing")).toHaveCount(0);

    let lostId = "";
    await page.route(route, async intercepted => {
      // The real server commits first; only the browser response is lost.
      const response = await intercepted.fetch();
      lostId = (await response.json()).review_session_id;
      await intercepted.abort("failed");
    }, { times: 1 });
    await page.getByTestId("ready-review-create").click();
    await expect(page.getByTestId("ready-review-error")).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("ready-review-retry")).toBeVisible();
    const replayResponse = page.waitForResponse(r => r.url() === route && r.request().method() === "POST");
    await page.getByTestId("ready-review-retry").click();
    const replay = await (await replayResponse).json();
    expect(replay.review_session_id).toBe(lostId);
    expect(replay.review_session_id).not.toBe(first.review_session_id);
    expect(replay.session_replay).toBe(true);
    await expect(page.getByTestId("a1-session-select")).toHaveValue(lostId);

    await page.getByTestId("ready-review-model").selectOption(readyModelId);
    await page.getByTestId("ready-review-existing").selectOption(first.review_session_id);
    await page.getByTestId("ready-review-open").click();
    await expect(page.getByTestId("a1-session-select")).toHaveValue(first.review_session_id);
    await page.screenshot({ path: testInfo.outputPath("ready-review-selected.png"), fullPage: true });
    for (const id of [first.review_session_id, lostId]) {
      const session = await (await request.get(`${fixture.base}/api/review-sessions/${id}`)).json();
      expect(session.status).toBe("created");
      expect(session.kit_instance_bindings).toEqual([]);
      expect((await request.post(`${fixture.base}/api/review-sessions/${id}/close`, { data: {} })).ok()).toBeTruthy();
    }
    await page.reload();
    await page.getByTestId(`closed-session-recreate-${first.review_session_id}`).click();
    const recreateResponse = page.waitForResponse(r => r.url().endsWith(`/${first.review_session_id}/recreate`));
    await page.getByTestId("closed-session-confirm-action").click();
    const recreated = await (await recreateResponse).json();
    expect(recreated.session_id).not.toBe(first.review_session_id);
    expect(recreated.recreated_from_session_id).toBe(first.review_session_id);
    expect(recreated.activation_state).toBe("not_requested");
    await expect(page.getByTestId("a1-session-select")).toHaveValue(recreated.session_id);
    await expect(page.getByTestId("a1-inline-manual-start")).toBeVisible();
    expect(claims).toBe(0);
    const source = await (await request.get(`${fixture.base}/api/review-sessions/${first.review_session_id}`)).json();
    expect(source.status).toBe("closed");
    const events = fixture.coordinator.eventLog.list(recreated.session_id);
    expect(events.some(event => event.type === "viewerLeaseClaimed")).toBe(false);
    await page.screenshot({ path: testInfo.outputPath("ready-review-recreated.png"), fullPage: true });
    await testInfo.attach("session-identities", { body: JSON.stringify({ first, replay, recreated, claims }), contentType: "application/json" });
  });
});

import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

// S3 / S3.1 acceptance against a REAL local stack (coordinator :8004 + conversion service + Kit + viewer).
// Prerequisites (not fabricated here): a review session whose model is converted, and a CFD run that is
// ready for that model — both created through the coordinator API by scratch tooling or the operator, and
// passed in via env. The browser then does exactly what a user does: open the workspace on that session,
// start 3D, open the wind panel, show the overlay for one direction, and we record 10 s of the WebRTC stream.
//
//   E2E_DISABLE_WEBSERVER=1 E2E_COORDINATOR_BASE_URL=http://127.0.0.1:8004 \
//   CFD_E2E_SESSION_ID=<review_session_id> CFD_E2E_RUN_ID=<run_id> \
//   npx playwright test e2e/cfd-wind-overlay-real.spec.ts --project=chromium
//
// Honest rules: skip (not pass) when the stack or ids are missing; "applied" is asserted from the panel's
// Kit-confirmed state (stage_binding_result with the overlay in applied_secondary_layers), never from a click.

const COORD = process.env.E2E_COORDINATOR_BASE_URL || "http://127.0.0.1:8004";
const SESSION_ID = process.env.CFD_E2E_SESSION_ID || "";
const RUN_ID = process.env.CFD_E2E_RUN_ID || "";
const OUT_DIR = path.resolve(process.cwd(), "..", "artifacts", "e2e", "cfd-s3-1");

// Kit streams H.264: Playwright's bundled Chromium has no proprietary codecs, so the first frame never
// arrives there. Use the installed Google Chrome channel (same as the recorded first-frame evidence).
test.use({ channel: "chrome", video: { mode: "on", size: { width: 1600, height: 900 } }, viewport: { width: 1600, height: 900 } });

test.describe("CFD wind overlay on the real stack (S3 + S3.1 acceptance)", () => {
  test.setTimeout(420_000);

  test("open workspace → start 3D → show overlay → Kit confirms layer → 10 s of live stream", async ({ page, request }, testInfo) => {
    let health = false;
    try { health = (await request.get(`${COORD}/health`, { timeout: 10_000 })).ok(); } catch { health = false; }
    test.skip(!health, `coordinator not reachable at ${COORD}`);
    test.skip(!SESSION_ID || !RUN_ID, "CFD_E2E_SESSION_ID / CFD_E2E_RUN_ID not provided (create them through the coordinator API first)");

    const runDetail = await (await request.get(`${COORD}/api/cfd/runs/${encodeURIComponent(RUN_ID)}`)).json();
    test.skip(runDetail?.status?.status !== "ready", `CFD run ${RUN_ID} is not ready (${runDetail?.status?.status ?? runDetail?.ledger?.status})`);
    fs.mkdirSync(OUT_DIR, { recursive: true });

    const stageBindingResponses: unknown[] = [];
    page.on("response", async (response) => {
      if (/\/api\/review-sessions\/[^/]+\/(stage-binding|cfd-overlays)$/.test(new URL(response.url()).pathname) && response.request().method() === "POST") {
        try { stageBindingResponses.push({ url: new URL(response.url()).pathname, status: response.status(), body: await response.json() }); } catch { /* non-json */ }
      }
    });

    // Unified console on the coordinator (/ui), A1 dock. Session selection is the user's A1 session picker.
    await page.goto(`${COORD}/ui/#a1`, { waitUntil: "domcontentloaded" });
    // The manual session picker lives in the collapsed "進階" disclosure; open it the way a user would.
    const advanced = page.getByTestId("a1-review-advanced");
    await expect(advanced).toBeVisible({ timeout: 60_000 });
    if (!(await advanced.evaluate((el) => (el as HTMLDetailsElement).open))) await advanced.locator("summary").first().click();
    const sessionSelect = page.getByTestId("a1-session-select");
    await expect(sessionSelect).toBeVisible({ timeout: 60_000 });
    await expect(sessionSelect.locator(`option[value="${SESSION_ID}"]`)).toHaveCount(1, { timeout: 60_000 });
    await sessionSelect.selectOption(SESSION_ID);

    // Start 3D when the pane asks for a manual start; otherwise the lease is claimed automatically.
    const manualStart = page.locator("[data-testid$='-manual-start']").first();
    if (await manualStart.isVisible({ timeout: 5_000 }).catch(() => false)) await manualStart.click();

    const viewport = page.locator("[data-uc='viewport'][data-prov='asbuilt']");
    await expect(viewport).toBeVisible({ timeout: 90_000 });

    // Wind panel: the overlay button is enabled only when the viewer command gate is open
    // (first frame + DataChannel + stage proof), so waiting for it is the readiness assertion.
    await page.locator("details[data-uc='ws-wind'] > summary").click();
    const panel = page.getByTestId("wind-panel");
    await expect(panel).toBeVisible();
    await expect(panel.getByTestId("wind-purpose")).toContainText("設計比較用");
    const runSelect = panel.getByTestId("wind-run-select");
    await expect(runSelect).toBeVisible({ timeout: 60_000 });
    await runSelect.selectOption(RUN_ID);
    await expect(panel.getByTestId("wind-run-status")).toHaveAttribute("data-status", "ready", { timeout: 60_000 });
    await expect(panel.getByTestId("wind-result")).toBeVisible({ timeout: 60_000 });
    await expect(panel.getByTestId("wind-legend-u")).toContainText("m/s");
    const showOverlay = panel.getByTestId("wind-overlay-on-0");
    await expect(showOverlay).toBeEnabled({ timeout: 180_000 });
    await page.screenshot({ path: path.join(OUT_DIR, "01-first-frame-before-overlay.png") });

    await showOverlay.click();
    const overlayStatus = panel.getByTestId("wind-overlay-status");
    await expect(overlayStatus).toHaveAttribute("data-state", "applied", { timeout: 150_000 });
    await expect(overlayStatus).toContainText("Kit 已確認載入疊圖");
    await page.screenshot({ path: path.join(OUT_DIR, "02-overlay-applied.png") });

    // 10 s of the live WebRTC stream with the overlay (recorded by Playwright video), plus mid-way stills.
    for (const second of [3, 6, 10]) {
      await page.waitForTimeout(second === 3 ? 3_000 : second === 6 ? 3_000 : 4_000);
      await page.screenshot({ path: path.join(OUT_DIR, `03-overlay-live-t${second}s.png`) });
    }

    const streamConfig = await (await request.get(`${COORD}/api/review-sessions/${encodeURIComponent(SESSION_ID)}/stream-config`)).json();
    const evidence = {
      schema: "cfd-s3-1-browser-e2e/v1",
      coordinator: COORD,
      session_id: SESSION_ID,
      run_id: RUN_ID,
      overlay_status_text: await overlayStatus.textContent(),
      overlay_bindings: (streamConfig.artifact_bindings as Array<{ artifact_id: string; artifact_role: string }>).filter((b) => b.artifact_role === "overlay").map((b) => b.artifact_id),
      stage_binding_responses: stageBindingResponses,
      video: testInfo.outputDir,
      recorded_utc: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(OUT_DIR, "browser-e2e.json"), JSON.stringify(evidence, null, 2), "utf-8");
    expect(evidence.overlay_bindings.length).toBeGreaterThan(0);
  });
});

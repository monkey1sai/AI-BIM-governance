import { test, expect } from "@playwright/test";

// S4-B compatibility evidence for the legacy #semantic-search route.
// This is intentionally NOT the canonical/full A4 S4-D workflow: the only
// enabled source is a server-resolved IFC-ready job, and Issue/3D/session
// actions remain visibly fail-closed.
//
// Branch-isolated real stack:
//   1. build dist-ui with VITE_COORDINATOR_API_BASE=http://127.0.0.1:8005
//   2. run governance :49103 and coordinator :8005 with at least one downloaded
//      IFC-ready job whose host path is readable by governance
//   3. E2E_DISABLE_WEBSERVER=1 E2E_COORDINATOR_BASE_URL=http://127.0.0.1:8005
//      A4_E2E_REQUIRE_REAL=1 [A4_E2E_IFC_READY_JOB_ID=ifcready_...] \
//      npx playwright test e2e/a4-closeout.spec.ts
//
// A4_E2E_REQUIRE_REAL=1 turns every missing precondition into a hard failure;
// without it this opt-in host fixture test may skip and MUST NOT be cited as a
// passing operability gate.
const COORDINATOR = process.env.E2E_COORDINATOR_BASE_URL || "http://127.0.0.1:8005";
const REQUIRED_JOB_ID = process.env.A4_E2E_IFC_READY_JOB_ID || "";
const REQUIRE_REAL = process.env.A4_E2E_REQUIRE_REAL === "1";
const VIEWPORTS = [
  { label: "1440x900", width: 1440, height: 900 },
  { label: "1920x1080", width: 1920, height: 1080 },
] as const;

type IfcReadyJob = {
  ifc_ready_job_id: string;
  download_status?: string | null;
};

function unavailable(message: string): void {
  if (REQUIRE_REAL) throw new Error(message);
  test.skip(true, message);
}

for (const viewport of VIEWPORTS) {
test.describe(`A4 S4-B compatibility: scoped IFC-ready table (${viewport.label} DPR1)`, () => {
  test.setTimeout(180_000);
  test.use({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
  });
  let jobId = "";

  test.beforeEach(async ({ request, page }) => {
    let apiOk = false;
    try {
      const status = await request.get(`${COORDINATOR}/api/governance/search/llm-status`, { timeout: 10_000 });
      apiOk = status.ok();
    } catch {
      apiOk = false;
    }
    if (!apiOk) {
      unavailable("branch governance search proxy is unavailable on the isolated coordinator");
      return;
    }

    const listResponse = await request.get(`${COORDINATOR}/api/external/ifc-ready?limit=50`, { timeout: 10_000 });
    if (!listResponse.ok()) {
      unavailable(`IFC-ready list failed with HTTP ${listResponse.status()}`);
      return;
    }
    const list = await listResponse.json() as { items?: IfcReadyJob[] };
    const downloaded = list.items?.filter((item) => item.download_status === "downloaded") ?? [];
    const selected = REQUIRED_JOB_ID
      ? downloaded.find((item) => item.ifc_ready_job_id === REQUIRED_JOB_ID)
      : downloaded[0];
    if (!selected) {
      unavailable(REQUIRED_JOB_ID
        ? `required downloaded IFC-ready job was not found: ${REQUIRED_JOB_ID}`
        : "no downloaded IFC-ready job is available for real A4 evidence");
      return;
    }
    jobId = selected.ifc_ready_job_id;

    await page.goto(`${COORDINATOR}/ui/#semantic-search`);
    const pageRoot = page.getByTestId("a4-semantic-search-page");
    try {
      await pageRoot.waitFor({ state: "visible", timeout: 15_000 });
      await page.getByTestId("a4-job-select").selectOption(jobId);
    } catch {
      unavailable("branch dist-ui does not expose the S4-B #semantic-search compatibility surface");
    }
    expect(page.viewportSize()).toEqual({ width: viewport.width, height: viewport.height });
    expect(await page.evaluate(() => window.devicePixelRatio)).toBe(1);
  });

  test("downloaded job -> scoped deterministic search -> table-only result with actions disabled", async ({ page }) => {
    const forbiddenCalls: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (
        url.port === "49102"
        || url.port === "8004"
        || url.pathname === "/api/governance/search/model"
      ) forbiddenCalls.push(request.url());
    });

    await expect(page.getByTestId("a4-source-path")).toHaveCount(0);
    await expect(page.getByTestId("a4-path-input")).toHaveCount(0);
    await expect(page.getByTestId("a4-source-session")).toBeDisabled();
    await expect(page.getByTestId("a4-source-scope-note")).toContainText("ifc_ready_table_only");

    await page.getByTestId("a4-mode-deterministic").click();
    await page.getByTestId("a4-query-input").fill("IfcDoor");
    const scopedRequest = page.waitForRequest((request) =>
      request.method() === "POST"
      && new URL(request.url()).pathname === `/api/governance/search/model/for-ifc-ready/${jobId}`,
    );
    await page.getByTestId("a4-run").click();

    const request = await scopedRequest;
    expect(request.headers()["x-user-token"]).toBeTruthy();
    expect(request.postDataJSON()).toEqual({ query: "IfcDoor", interpret_mode: "deterministic" });
    expect(request.url()).not.toContain("ifc_source_path");

    const resultRows = page.getByTestId("a4-results-table").locator("tbody tr");
    await expect(resultRows.first().locator("td").nth(1)).toHaveText("IfcDoor", { timeout: 120_000 });
    await expect(page.getByTestId("a4-results-table").locator("tbody")).not.toContainText("無列");
    await expect(page.getByTestId("a4-run-err")).toHaveCount(0);
    const scopeField = page.getByText("search_scope", { exact: true }).first().locator("..").locator(".ec-v");
    await expect.poll(() => scopeField.evaluate((element) => element.firstChild?.textContent?.trim()))
      .toBe("ifc_ready_table_only");
    const completionField = page.getByText("completion_scope", { exact: true }).first().locator("..").locator(".ec-v");
    await expect.poll(() => completionField.evaluate((element) => element.firstChild?.textContent?.trim()))
      .toBe("table_only");
    const resultScanField = page.getByText("result_scan_scope", { exact: true }).first().locator("..").locator(".ec-v");
    await expect.poll(() => resultScanField.evaluate((element) => element.firstChild?.textContent?.trim()))
      .toBe("complete_table");
    await expect(page.getByText("deterministic_grammar").first()).toBeVisible();
    await expect(page.getByTestId("a4-create-issues")).toBeDisabled();
    await expect(page.getByTestId("a4-actions-unavailable")).toContainText("signed-proof");
    expect(forbiddenCalls, "must not call direct/internal ports or the generic host-path route").toEqual([]);

    await page.getByTestId("a4-results-table").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `../artifacts/e2e/a4-trace/a4-s4b-ifc-ready-table-${viewport.label}.png`,
      fullPage: true,
    });
  });

  test("empty match stays explicit and does not enable legacy actions", async ({ page }) => {
    await page.getByTestId("a4-mode-deterministic").click();
    await page.getByTestId("a4-query-input").fill("IfcSpaceHeater");
    await page.getByTestId("a4-run").click();

    await expect(page.getByTestId("a4-run-err")).toBeVisible({ timeout: 120_000 });
    await expect(page.getByTestId("a4-results-table")).toContainText("無列");
    await expect(page.getByTestId("a4-create-issues")).toBeDisabled();
    await page.screenshot({
      path: `../artifacts/e2e/a4-trace/a4-s4b-empty-honest-${viewport.label}.png`,
      fullPage: true,
    });
  });
});
}

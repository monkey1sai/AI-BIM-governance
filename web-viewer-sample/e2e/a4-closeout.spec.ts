import { expect, test, type Page, type Route, type TestInfo } from "@playwright/test";
import {
  classifyHarnessUse,
  loadIsolatedStackConfig,
  requireReal,
  watchForbiddenRequests,
  writeIsolatedEvidenceManifest,
} from "./support/isolated-stack";

const isolated = loadIsolatedStackConfig();
const COORDINATOR = isolated?.coordinatorBaseUrl ?? "";
const REQUIRED_JOB_ID = process.env.A4_E2E_IFC_READY_JOB_ID ?? "";
const VIEWPORTS = [
  { label: "1440x900", width: 1440, height: 900 },
  { label: "1920x1080", width: 1920, height: 1080 },
] as const;

type IfcReadyJob = {
  ifc_ready_job_id: string;
  download_status?: string | null;
  status?: string | null;
  conversion_status?: string | null;
};

type ModelSearchResponse = {
  status?: string;
  error_code?: string;
  results?: unknown[];
};

// Keep this in sync with governance-service/search/interpreter.py's supported
// deterministic IFC classes. No one class is required to be present in every
// real IFC, so preflight proves an actual job/query pair before browser work.
const DETERMINISTIC_CLASS_CANDIDATES = [
  "IfcDoor",
  "IfcColumn",
  "IfcWall",
  "IfcBeam",
  "IfcSlab",
  "IfcWindow",
  "IfcSpace",
  "IfcBuildingElementProxy",
] as const;
const PREFLIGHT_PRINCIPAL = "a4-e2e-preflight";
const SAFE_A4_DIAGNOSTIC = /^[a-z0-9_]{1,96}$/i;
const MAX_PREFLIGHT_DIAGNOSTICS = 8;

function safeA4Diagnostic(value: unknown): string | null {
  return typeof value === "string" && SAFE_A4_DIAGNOSTIC.test(value) ? value : null;
}

for (const viewport of VIEWPORTS) {
  test.describe(`A4 require-real scoped search (${viewport.label} DPR1)`, () => {
    test.skip(!isolated, "A4 isolated evidence requires E2E_REQUIRE_REAL=1");
    if (!isolated) return;
    test.setTimeout(180_000);
    test.use({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: 1,
    });

    let forbiddenGuard: ReturnType<typeof watchForbiddenRequests> | undefined;
    let genericSearchRequests: string[] = [];
    let jobId = "";
    let searchQuery = "";
    let tracePath = "";
    let traceActive = false;
    let pendingEvidence: null | { testId: string; visibleStates: string[]; backendApi: string } = null;

    async function finishEvidence(
      page: Page,
      testInfo: TestInfo,
      testId: string,
      visibleStates: string[],
      backendApi: string,
    ): Promise<void> {
      void page; void testInfo;
      pendingEvidence = { testId, visibleStates, backendApi };
    }

    test.beforeEach(async ({ page, request }, testInfo) => {
      forbiddenGuard = watchForbiddenRequests(page);
      genericSearchRequests = [];
      pendingEvidence = null;
      page.on("request", requestEvent => {
        if (new URL(requestEvent.url()).pathname === "/api/governance/search/model") {
          genericSearchRequests.push(requestEvent.url());
        }
      });
      tracePath = testInfo.outputPath(`${testInfo.title.replace(/[^A-Za-z0-9_-]+/g, "-")}-trace.zip`);
      await page.context().tracing.start({ screenshots: true, snapshots: true, sources: true });
      traceActive = true;

      const health = await request.get(`${COORDINATOR}/health`);
      requireReal(health.ok(), `coordinator health failed: ${health.status()}`);
      const proxy = await request.get(`${COORDINATOR}/api/governance/search/llm-status`);
      requireReal(proxy.ok(), `governance search proxy failed: ${proxy.status()}`);
      const listResponse = await request.get(`${COORDINATOR}/api/external/ifc-ready?limit=100`);
      requireReal(listResponse.ok(), `IFC-ready list failed: ${listResponse.status()}`);
      const list = await listResponse.json() as { items?: IfcReadyJob[] };
      const downloaded = (list.items ?? []).filter(item => item.download_status === "downloaded");
      const preferred = downloaded.find(item => item.conversion_status === "ready" || item.status === "ready");
      const orderedJobs = REQUIRED_JOB_ID
        ? downloaded.filter(item => item.ifc_ready_job_id === REQUIRED_JOB_ID)
        : [preferred, ...downloaded.filter(item => item !== preferred)].filter((item): item is IfcReadyJob => Boolean(item));
      requireReal(
        orderedJobs.length > 0,
        REQUIRED_JOB_ID
          ? `required downloaded job is missing: ${REQUIRED_JOB_ID}`
          : "no downloaded IFC-ready job is available",
      );

      jobId = "";
      searchQuery = "";
      const preflightDiagnostics: string[] = [];
      const recordPreflightDiagnostic = (httpStatus: number, body: ModelSearchResponse | null) => {
        if (preflightDiagnostics.length >= MAX_PREFLIGHT_DIAGNOSTICS) return;
        const facts = [`HTTP ${httpStatus}`];
        const status = safeA4Diagnostic(body?.status);
        const errorCode = safeA4Diagnostic(body?.error_code);
        if (status) facts.push(`status=${status}`);
        if (errorCode) facts.push(`error_code=${errorCode}`);
        if (httpStatus >= 200 && httpStatus < 300 && body?.status === "ok" && Array.isArray(body.results) && body.results.length === 0) {
          facts.push("empty_results");
        }
        preflightDiagnostics.push(facts.join(" "));
      };
      for (const job of orderedJobs) {
        for (const query of DETERMINISTIC_CLASS_CANDIDATES) {
          const search = await request.post(
            `${COORDINATOR}/api/governance/search/model/for-ifc-ready/${encodeURIComponent(job.ifc_ready_job_id)}`,
            {
              headers: { "X-User-Token": PREFLIGHT_PRINCIPAL },
              data: { query, interpret_mode: "deterministic" },
            },
          );
          let body: ModelSearchResponse | null = null;
          try {
            body = await search.json() as ModelSearchResponse;
          } catch {
            // The failure report intentionally records only HTTP status when
            // the response is not safe structured JSON.
          }
          if (!search.ok()) {
            recordPreflightDiagnostic(search.status(), body);
            continue;
          }
          if (body?.status === "ok" && Array.isArray(body.results) && body.results.length > 0) {
            jobId = job.ifc_ready_job_id;
            searchQuery = query;
            break;
          }
          recordPreflightDiagnostic(search.status(), body);
        }
        if (jobId) break;
      }
      requireReal(
        jobId && searchQuery,
        `no downloaded IFC-ready job produced deterministic A4 search results for supported class candidates; diagnostics=${preflightDiagnostics.join("; ") || "none"}`,
      );
    });

    test.afterEach(async ({ page }, testInfo) => {
      try {
        let screenshotPath: string | null = null;
        if (pendingEvidence) {
          screenshotPath = testInfo.outputPath(`${pendingEvidence.testId}.png`);
          await page.screenshot({ path: screenshotPath, fullPage: true });
        }
        if (traceActive) { await page.context().tracing.stop({ path: tracePath }); traceActive = false; }
        forbiddenGuard?.assertClean();
        expect(genericSearchRequests, "must not call the generic host-path A4 route").toEqual([]);
        if (pendingEvidence && screenshotPath) {
          const harness = classifyHarnessUse({ buildFlag: isolated.harnessBuildFlag, queryFlag: new URL(page.url()).searchParams.get("harness") === "1" });
          requireReal(harness.realControlPlaneEligible, "harness build+query fake control plane is not real evidence");
          await writeIsolatedEvidenceManifest(isolated, {
            testId: pendingEvidence.testId, route: "#semantic-search", mainButtons: ["a4-refresh-sources", "a4-run"],
            fixture: `downloaded IFC-ready job preflighted against the real coordinator with deterministic query=${searchQuery}`,
            backendApi: pendingEvidence.backendApi, observedRuntimeIds: { ifc_ready_job_id: jobId },
            visibleStates: pendingEvidence.visibleStates, screenshotPaths: [screenshotPath], tracePath, harness,
          });
        }
      } finally {
        if (traceActive) {
          await page.context().tracing.stop({ path: tracePath });
          traceActive = false;
        }
      }
    });

    test("shows real IFC-ready loading state", async ({ page }, testInfo) => {
      const listPattern = "**/api/external/ifc-ready**";
      let released = false;
      let resolveList!: () => void;
      const listGate = new Promise<void>(resolve => { resolveList = resolve; });
      const releaseList = () => {
        if (!released) {
          released = true;
          resolveList();
        }
      };
      const waitForRealList = async (route: Route) => {
        await listGate;
        await route.continue();
      };
      await page.route(listPattern, waitForRealList);
      try {
        await page.goto("/#semantic-search");
        await expect(page.getByTestId("a4-semantic-search-page")).toBeVisible();
        await expect(page.getByTestId("a4-source-loading")).toBeVisible();
        await expect(page.getByTestId("a4-run")).toBeDisabled();
        releaseList();
      } finally {
        releaseList();
        await page.unroute(listPattern, waitForRealList);
      }
      await page.getByTestId("a4-job-select").selectOption(jobId);
      await expect(page.getByTestId("a4-job-select")).toHaveValue(jobId);
      await finishEvidence(page, testInfo, `a4-real-loading-${viewport.label}`, ["loading"], "GET /api/external/ifc-ready?limit=100");
    });

    test("shows list failure then retries the real API", async ({ page }, testInfo) => {
      const listPattern = "**/api/external/ifc-ready**";
      let firstList = true;
      const failFirstList = async (route: Route) => {
        if (firstList) {
          firstList = false;
          await route.abort("failed");
          return;
        }
        await route.continue();
      };
      await page.route(listPattern, failFirstList);
      try {
        await page.goto("/#semantic-search");
        await expect(page.getByTestId("a4-load-err")).toBeVisible();
      } finally {
        await page.unroute(listPattern, failFirstList);
      }
      await page.getByTestId("a4-refresh-sources").click();
      await page.getByTestId("a4-job-select").selectOption(jobId);
      await expect(page.getByTestId("a4-job-select")).toHaveValue(jobId);
      await expect(page.getByTestId("a4-run")).toBeEnabled();
      await finishEvidence(page, testInfo, `a4-real-failure-retry-${viewport.label}`, ["failure", "retry"], "GET /api/external/ifc-ready?limit=100");
    });

    test("runs A4 against the real coordinator", async ({ page }, testInfo) => {
      await page.goto("/#semantic-search");
      await page.getByTestId("a4-job-select").selectOption(jobId);
      await expect(page.getByTestId("a4-job-select")).toHaveValue(jobId);
      await page.getByTestId("a4-mode-deterministic").click();
      await page.getByTestId("a4-query-input").fill(searchQuery);
      const searchPattern = "**/api/governance/search/model/for-ifc-ready/**";
      let released = false;
      let resolveSearch!: () => void;
      const searchGate = new Promise<void>(resolve => { resolveSearch = resolve; });
      const releaseSearch = () => {
        if (!released) {
          released = true;
          resolveSearch();
        }
      };
      const waitForRealSearch = async (route: Route) => {
        await searchGate;
        await route.continue();
      };
      await page.route(searchPattern, waitForRealSearch);
      try {
        const responsePromise = page.waitForResponse(response =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname === `/api/governance/search/model/for-ifc-ready/${jobId}`,
        );
        await page.getByTestId("a4-run").click();
        await expect(page.getByTestId("a4-run")).toContainText("執行中");
        releaseSearch();
        const response = await responsePromise;
        requireReal(response.ok(), `A4 search failed: ${response.status()}`);
      } finally {
        releaseSearch();
        await page.unroute(searchPattern, waitForRealSearch);
      }
      await expect(page.getByTestId("a4-results-table")).toBeVisible();
      await expect(page.getByTestId("a4-results-table").locator("tbody tr").first().locator("td").nth(1)).toHaveText(searchQuery);
      await expect(page.getByTestId("a4-job-select")).toHaveValue(jobId);
      await finishEvidence(page, testInfo, `a4-real-success-${viewport.label}`, ["success"], `POST /api/governance/search/model/for-ifc-ready/${jobId}`);
    });
  });
}

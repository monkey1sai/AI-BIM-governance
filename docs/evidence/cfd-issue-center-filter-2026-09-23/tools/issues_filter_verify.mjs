// Pre-merge browser verification of the Issue Center filter against the real 181 data: open the deployed /ui/#issues,
// but serve /ui/ static files from this branch's local build (dist-ui) via Playwright routing. API calls stay on 181
// (same origin, read-only GETs). Writes DOM facts to JSON and one screenshot of the Issue Center panel with the CFD filter.
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const COORD = process.env.E2E_COORDINATOR_BASE_URL;
if (!COORD) throw new Error("set E2E_COORDINATOR_BASE_URL");
const DIST = path.resolve(process.env.DIST_UI || "dist-ui");
const OUT = path.resolve(process.env.VERIFY_OUT || "../artifacts/e2e/issues-filter-verify");
fs.mkdirSync(OUT, { recursive: true });
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".woff2": "font/woff2", ".woff": "font/woff", ".ico": "image/x-icon" };

const facts = { schema: "issues-filter-verify/v1", served_from_local_build: [], api_requests: [] };
// The document is fulfilled by Playwright routing, so Chrome cannot place it in the private address space and its
// Private Network Access checks would block the page's own same-origin API calls to the private coordinator IP.
// The deployed page is served from that private IP and is not affected; disable the checks for this harness only.
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--disable-features=BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights,PrivateNetworkAccessRespectPreflightResults,LocalNetworkAccessChecks"] });
facts.harness_note = "document and static assets served from the branch build via Playwright routing; Chrome Private Network Access checks disabled for this harness; API calls are real read-only GETs to the coordinator";
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.route(`${COORD}/ui/**`, async (route) => {
  const url = new URL(route.request().url());
  let rel = decodeURIComponent(url.pathname.replace(/^\/ui\/?/, ""));
  if (!rel) rel = "index.html";
  const file = path.join(DIST, rel);
  if (file.startsWith(DIST) && fs.existsSync(file) && fs.statSync(file).isFile()) {
    facts.served_from_local_build.push(rel);
    await route.fulfill({ status: 200, body: fs.readFileSync(file), contentType: TYPES[path.extname(file)] ?? "application/octet-stream" });
  } else {
    await route.continue();
  }
});
// Every API call the page makes (method + path), to show the page itself only reads.
page.on("request", (request) => {
  const url = new URL(request.url());
  if (url.pathname.startsWith("/api/")) facts.api_requests.push(`${request.method()} ${url.host === new URL(COORD).host ? "<coordinator>" : url.host}${url.pathname}`);
});
facts.api_responses = [];
page.on("response", async (response) => {
  const url = new URL(response.url());
  if (!url.pathname.startsWith("/api/governance/issues")) return;
  let size = null;
  try { size = (await response.body()).length; } catch { /* streamed */ }
  facts.api_responses.push({ status: response.status(), size, acao: response.headers()["access-control-allow-origin"] ?? null, fromServiceWorker: response.fromServiceWorker() });
});
page.on("requestfailed", (request) => {
  if (new URL(request.url()).pathname.startsWith("/api/governance/issues")) facts.api_responses.push({ failed: request.failure()?.errorText ?? "failed" });
});
page.on("console", (msg) => { if (msg.type() === "error") (facts.console_errors ??= []).push(msg.text().slice(0, 200)); });
try {
  await page.goto(`${COORD}/ui/#issues`, { waitUntil: "domcontentloaded" });
  const filter = page.getByTestId("issues-filter");
  await filter.waitFor({ timeout: 60_000 });
  const count = page.getByTestId("issues-count");
  await page.waitForFunction((el) => el?.getAttribute("data-state") !== "loading", await count.elementHandle(), { timeout: 60_000 });
  facts.load_state = await count.getAttribute("data-state");
  const rows = () => page.locator('[data-testid="issues-table"] tbody tr').evaluateAll((trs) => trs.map((tr) => ({ kind: tr.children[0]?.textContent, title: tr.children[4]?.textContent })));
  const all = await rows();
  facts.all = { count_text: await count.textContent(), rows_shown: all.length, cfd_rows_shown: all.filter((r) => (r.title ?? "").startsWith("CFD 風環境")).length };
  const allText = await count.textContent();
  await filter.selectOption("cfd");
  await page.waitForFunction(([el, before]) => (el?.textContent ?? "") !== before, [await count.elementHandle(), allText], { timeout: 10_000 });
  const cfd = await rows();
  facts.cfd = { count_text: await count.textContent(), rows: cfd };
  const panel = page.locator("section, div").filter({ has: page.getByTestId("issues-filter") }).filter({ hasText: "Issue Center" }).last();
  await panel.screenshot({ path: path.join(OUT, "issue-center-cfd-filter.png") });
  await filter.selectOption("issue");
  facts.issue = { count_text: await count.textContent() };
  await filter.selectOption("annotation");
  facts.annotation = { count_text: await count.textContent() };
  facts.api_methods = [...new Set(facts.api_requests.map((line) => line.split(" ")[0]))];
  facts.recorded_utc = new Date().toISOString();
  fs.writeFileSync(path.join(OUT, "issues-filter-verify.json"), JSON.stringify(facts, null, 2));
  console.log(JSON.stringify({ ...facts, served_from_local_build: facts.served_from_local_build.length }, null, 2));
} catch (error) {
  console.error("verify failed:", error.message.split("\n")[0]);
  process.exitCode = 1;
} finally {
  await browser.close();
}

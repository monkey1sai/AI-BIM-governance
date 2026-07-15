import { expect, request as pwRequest, test } from "@playwright/test";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const viewerDir = path.resolve(TEST_DIR, "..");
const repoRoot = path.resolve(viewerDir, "..");
const coordinatorDir = path.join(repoRoot, "bim-review-coordinator");
const consoleDistDir = path.join(viewerDir, "dist-ui");
const coordinatorPort = Number.parseInt(process.env.FUNCTIONAL_COORDINATOR_PORT ?? "8005", 10);
const coordinatorBase = `http://127.0.0.1:${coordinatorPort}`;
const webhookSecret = "dev-webhook-secret";

const artifactDir = path.join(repoRoot, "artifacts", "e2e", "functional-runtime");
const screenshotPath = path.join(artifactDir, "conv-history.png");
const tracePath = path.join(artifactDir, "conv-history-trace.zip");
const resultPath = path.join(artifactDir, "functional-runtime-result.json");

let coordinatorProc: ChildProcess | null = null;
let conversionStub: http.Server | null = null;
let ifcSourceStub: http.Server | null = null;
let tmpRoot = "";
let resultAttempts = 0;
let sourcePort = 0;

function sha256(filePath: string): string {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function relativeArtifact(filePath: string): string {
  return path.relative(repoRoot, filePath).replaceAll("\\", "/");
}

async function listenOnRandomPort(server: http.Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected a TCP stub port.");
  return address.port;
}

async function requireCoordinatorPortAvailable(): Promise<void> {
  const probe = http.createServer();
  await new Promise<void>((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(coordinatorPort, "127.0.0.1", () => probe.close(() => resolve()));
  }).catch((error) => {
    throw new Error(`Functional coordinator port ${coordinatorPort} is unavailable; refusing to reuse or stop an unknown process: ${String(error)}`);
  });
}

function sendJson(response: http.ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

async function startStubs(): Promise<number> {
  conversionStub = http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://stub.local");
    if (request.method === "POST" && url.pathname === "/api/conversions/ifc-to-usdc") {
      request.resume();
      sendJson(response, 202, {
        conversion_job_id: "stream_conv_fixture_001",
        status: "queued",
        authority: "bim-streaming-server",
      });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/conversions") {
      setTimeout(() => sendJson(response, 200, {
        count: 1,
        items: [{
          conversion_job_id: "stream_conv_fixture_001",
          status: "succeeded",
          source_ifc_filename: "library.ifc",
        }],
      }), 150);
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/conversions/stream_conv_fixture_001/result") {
      resultAttempts += 1;
      if (resultAttempts === 1) {
        sendJson(response, 503, { detail: "fixture result temporarily unavailable" });
        return;
      }
      sendJson(response, 200, {
        conversion_job_id: "stream_conv_fixture_001",
        status: "succeeded",
        ready: true,
        artifacts: {
          model_usdc: { role: "model_usdc", url: "/artifacts/stream_conv_fixture_001/model.usdc" },
          element_mapping: { role: "element_mapping", url: "/artifacts/stream_conv_fixture_001/element_mapping.json" },
        },
      });
      return;
    }
    sendJson(response, 404, { detail: "stub route not found" });
  });

  ifcSourceStub = http.createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "application/octet-stream" });
    response.end("ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n");
  });

  const conversionPort = await listenOnRandomPort(conversionStub);
  sourcePort = await listenOnRandomPort(ifcSourceStub);
  return conversionPort;
}

async function stopCoordinator(proc: ChildProcess): Promise<void> {
  const pid = proc.pid;
  if (pid && process.platform === "win32") {
    await new Promise<void>((resolve) => {
      const killer = spawn("taskkill", ["/F", "/T", "/PID", String(pid)], { stdio: "ignore" });
      killer.on("exit", () => resolve());
      killer.on("error", () => {
        try { proc.kill("SIGKILL"); } catch { /* already stopped */ }
        resolve();
      });
    });
    return;
  }
  await new Promise<void>((resolve) => {
    const cap = setTimeout(resolve, 3000);
    proc.once("exit", () => { clearTimeout(cap); resolve(); });
    try { proc.kill("SIGTERM"); } catch { clearTimeout(cap); resolve(); }
  });
}

async function waitForHealth(earlyExit: () => string | null, timeoutMs = 60_000): Promise<void> {
  const api = await pwRequest.newContext();
  const started = Date.now();
  try {
    while (Date.now() - started < timeoutMs) {
      const failure = earlyExit();
      if (failure) throw new Error(failure);
      try {
        const response = await api.get(`${coordinatorBase}/health`, { timeout: 2000 });
        if (response.ok()) return;
      } catch {
        // Retry until the branch coordinator is ready or exits.
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`coordinator /health not ready within ${timeoutMs}ms at ${coordinatorBase}`);
  } finally {
    await api.dispose();
  }
}

async function seedIfcReadyJob(): Promise<string> {
  const api = await pwRequest.newContext();
  try {
    const response = await api.post(`${coordinatorBase}/api/external/ifc-ready`, {
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Secret": webhookSecret,
        "X-Correlation-Id": "corr_conv_history_001",
        "X-Idempotency-Key": "idem_conv_history_001",
      },
      data: {
        event: "ifc_ready",
        event_id: "evt_conv_history_001",
        correlation_id: "corr_conv_history_001",
        idempotency_key: "idem_conv_history_001",
        tenant_id: "tenant_fixture_001",
        project_id: "project_fixture_001",
        external_model_version_id: "version_fixture_001",
        source_ifc: {
          ref: `http://127.0.0.1:${sourcePort}/library.ifc`,
          etag: `sha256:${"e".repeat(64)}`,
          filename: "library.ifc",
          format: "ifc",
        },
        requested_outputs: ["usdc", "element_mapping", "entity_index", "metadata"],
      },
    });
    expect(response.status()).toBe(202);
    const body = await response.json();
    return String(body.ifc_ready_job_id);
  } finally {
    await api.dispose();
  }
}

test.describe("#conv functional gate (real coordinator + stub external conversion)", () => {
  test.setTimeout(180_000);

  test.beforeAll(async () => {
    if (!fs.existsSync(path.join(consoleDistDir, "index.html"))) {
      throw new Error("dist-ui is required; run `npm run build:ui` before the functional gate.");
    }
    await requireCoordinatorPortAvailable();
    resultAttempts = 0;
    const conversionPort = await startStubs();
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "conv-history-functional-"));

    let coordinatorExited: number | null = null;
    let stderrTail = "";
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(coordinatorPort),
      PUBLIC_HOST: "127.0.0.1",
      STREAMING_CONVERSION_API_BASE: `http://127.0.0.1:${conversionPort}`,
      CONSOLE_DIST_DIR: consoleDistDir,
      CONVERSION_POLL_ENABLED: "false",
      IFC_DOWNLOAD_STRICT: "false",
      EXTERNAL_INTAKE_WEBHOOK_SECRET: webhookSecret,
      SESSION_STORE_DIR: path.join(tmpRoot, "sessions"),
      EVENT_LOG_DIR: path.join(tmpRoot, "events"),
      CALLBACK_OUTBOX_STORE_PATH: path.join(tmpRoot, "callback-outbox.json"),
      STORAGE_ROOT: path.join(tmpRoot, "storage"),
      LOG_ROOT: path.join(tmpRoot, "logs"),
    };
    const tsxBin = path.join(coordinatorDir, "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");
    coordinatorProc = spawn(tsxBin, ["src/index.ts"], {
      cwd: coordinatorDir,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    });
    coordinatorProc.on("exit", (code) => { coordinatorExited = code ?? -1; });
    coordinatorProc.stdout?.on("data", (data) => process.stdout.write(`[coordinator] ${data}`));
    coordinatorProc.stderr?.on("data", (data) => {
      const chunk = String(data);
      stderrTail = `${stderrTail}${chunk}`.slice(-4000);
      process.stderr.write(`[coordinator:err] ${chunk}`);
    });
    await waitForHealth(() => coordinatorExited == null
      ? null
      : `branch coordinator exited before health (code=${coordinatorExited}); port 8005 may be occupied. stderr:\n${stderrTail}`);
  });

  test.afterAll(async () => {
    if (coordinatorProc) await stopCoordinator(coordinatorProc);
    coordinatorProc = null;
    for (const server of [conversionStub, ifcSourceStub]) {
      if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    conversionStub = null;
    ifcSourceStub = null;
    if (tmpRoot && fs.existsSync(tmpRoot)) fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  test("emits commit-bound coordinator evidence without browser API mocks", async ({ page, context }) => {
    fs.mkdirSync(artifactDir, { recursive: true });
    const ifcReadyJobId = await seedIfcReadyJob();
    const directRuntimeRequests: string[] = [];
    const offOriginApiRequests: string[] = [];
    const observedResponses: Array<{ method: string; path: string; response_status: number }> = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (/:(49100|49101)(?:\/|$)/.test(request.url())) directRuntimeRequests.push(request.url());
      if (url.pathname.startsWith("/api/") && url.origin !== coordinatorBase) offOriginApiRequests.push(request.url());
    });
    page.on("response", (response) => {
      const url = new URL(response.url());
      if (url.pathname.startsWith("/api/")) {
        observedResponses.push({ method: response.request().method(), path: url.pathname, response_status: response.status() });
      }
    });
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });

    let passed = false;
    try {
      await page.goto(`${coordinatorBase}/ui#conv`);
      const loadingObserved = await page.getByTestId("conv-history-loading").isVisible();
      await expect(page).toHaveURL(/\/ui#conv$/);
      await expect(page.getByRole("heading", { name: "IFC→USD 轉檔歷史" })).toBeVisible();
      await expect(page.getByText(ifcReadyJobId)).toBeVisible();
      await expect(page.getByText("library.ifc")).toBeVisible();
      await expect(page.getByTestId("conv-metrics").getByText("未取得", { exact: true })).toBeVisible();
      await expect(page.getByText("GPU runtime · 狀態未由 coordinator 提供；未觀測", { exact: true })).toBeVisible();
      await expect(page.getByTestId("conv-coverage-selfref-note")).toBeVisible();
      await expect(page.getByText("觸發轉檔")).toHaveCount(0);

      await page.getByTestId("conv-history-result-stream_conv_fixture_001").click();
      await expect(page.getByText(/結果未取得/)).toBeVisible();
      const failureObserved = true;
      await page.getByTestId("conv-history-result-stream_conv_fixture_001").click();
      const retryObserved = true;
      await expect(page.getByText("/artifacts/stream_conv_fixture_001/model.usdc")).toBeVisible();
      await expect(page.getByText("/artifacts/stream_conv_fixture_001/element_mapping.json")).toBeVisible();
      const successObserved = true;
      expect(directRuntimeRequests).toEqual([]);
      expect(offOriginApiRequests).toEqual([]);

      await page.screenshot({ path: screenshotPath, fullPage: true });
      await context.tracing.stop({ path: tracePath });

      const subjectCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
      const workspaceClean = execFileSync("git", ["status", "--porcelain"], { cwd: repoRoot, encoding: "utf8" }).trim() === "";
      const result = {
        schema_version: 1,
        kind: "ai-bim-functional-runtime-result",
        status: "passed",
        generated_at_utc: new Date().toISOString(),
        subject_commit: subjectCommit,
        workspace_clean: workspaceClean,
        skipped: false,
        blocked: false,
        route: "#conv",
        scope: "history_result_only",
        full_route_coverage: false,
        known_gaps: [
          "watch payload and resulting status are not browser-verified",
          "prioritize and existing-job retry are not browser-verified",
          "coverage drawer interaction is not browser-verified",
          "six-value history enum is covered by unit tests only",
        ],
        main_buttons_tested: ["查看結果", "重試結果"],
        fixture: "conversion-history.real-coordinator.stub-external-conversion",
        backend_api: { requests: observedResponses, browser_direct_runtime_port_requests: directRuntimeRequests.length },
        runtime_actions: [{ action: "load conversion result", runtime_id_type: "conversion_job_id", runtime_id: "stream_conv_fixture_001" }],
        runtime_boundary: { coordinator: "real", conversion_authority: "stub_external_conversion", live_gpu: "not_observed" },
        visible_states: {
          loading: { observed: loadingObserved },
          success: { observed: successObserved },
          failure: { observed: failureObserved },
          retry: { observed: retryObserved },
        },
        e2e_command: "npm run build:ui && npm run test:functional-runtime (Playwright; CI coordinator port 8005)",
        artifacts: [
          { role: "screenshot", path: relativeArtifact(screenshotPath), sha256: sha256(screenshotPath) },
          { role: "trace", path: relativeArtifact(tracePath), sha256: sha256(tracePath) },
        ],
        kit_runtime: null,
      };
      fs.writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
      passed = true;
    } finally {
      if (!passed) {
        try { await context.tracing.stop({ path: tracePath }); } catch { /* preserve original failure */ }
      }
    }
  });
});

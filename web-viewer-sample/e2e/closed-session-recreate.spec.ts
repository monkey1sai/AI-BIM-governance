import { expect, test } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const viewerDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const coordinatorDir = path.resolve(viewerDir, "..", "bim-review-coordinator");
const tsxCli = path.join(coordinatorDir, "node_modules", "tsx", "dist", "cli.mjs");

let coordinator: ChildProcess | null = null;
let artifactServer: http.Server | null = null;
let coordinatorBase = "";
let artifactBase = "";
let tempRoot = "";

async function listen(server: http.Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("expected TCP address");
  return address.port;
}

async function freePort(): Promise<number> {
  const server = http.createServer();
  const port = await listen(server);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

async function waitForHealth(base: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}/health`);
      if (response.ok) return;
    } catch { /* retry until owned coordinator is ready */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`coordinator health did not become ready at ${base}`);
}

test.describe.serial("Closed Review Session recreation", () => {
  test.setTimeout(120_000);

  test.beforeAll(async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "closed-session-recreate-e2e-"));
    artifactServer = http.createServer((request, response) => {
      if (request.url?.startsWith("/artifacts/") && (request.method === "HEAD" || request.method === "GET")) {
        response.writeHead(200, { "Content-Type": "application/octet-stream" });
        response.end(request.method === "HEAD" ? undefined : "fixture");
        return;
      }
      response.writeHead(404).end("not found");
    });
    artifactBase = `http://127.0.0.1:${await listen(artifactServer)}`;
    const port = await freePort();
    coordinatorBase = `http://127.0.0.1:${port}`;
    coordinator = spawn(process.execPath, [tsxCli, "src/index.ts"], {
      cwd: coordinatorDir,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        PORT: String(port),
        PUBLIC_HOST: "127.0.0.1",
        SESSION_STORE_DIR: path.join(tempRoot, "sessions"),
        EVENT_LOG_DIR: path.join(tempRoot, "events"),
        CALLBACK_OUTBOX_STORE_PATH: path.join(tempRoot, "callback-outbox.json"),
        CONSOLE_DIST_DIR: path.join(viewerDir, "dist-ui"),
        STREAMING_CONVERSION_API_BASE: artifactBase,
        ENABLE_SOURCE_BUNDLE_RECONCILIATION: "false",
      },
    });
    let stderr = "";
    coordinator.stderr?.on("data", (chunk) => { stderr = `${stderr}${String(chunk)}`.slice(-4000); });
    coordinator.once("exit", (code) => {
      if (code && code !== 0) process.stderr.write(`[closed-session-recreate] coordinator exit ${code}: ${stderr}\n`);
    });
    await waitForHealth(coordinatorBase);
  });

  test.afterAll(async () => {
    coordinator?.kill("SIGTERM");
    coordinator = null;
    if (artifactServer) await new Promise<void>((resolve) => artifactServer!.close(() => resolve()));
    artifactServer = null;
    if (tempRoot && fs.existsSync(tempRoot)) fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test("A1 recreates a new ID, preserves the closed source, and terminal close stays in Session Management", async ({ page, request }, testInfo) => {
    const created = await request.post(`${coordinatorBase}/api/review-sessions`, {
      data: {
        project_id: "e2e-project",
        model_version_id: "e2e-model-v1",
        artifact_bindings: [{
          artifact_group_id: "e2e-group",
          artifact_id: "e2e-usdc",
          artifact_role: "derived",
          url: `${artifactBase}/artifacts/e2e/model.usdc`,
          mapping_url: `${artifactBase}/artifacts/e2e/element_mapping.json`,
          load_order: 0,
          ready_status: "ready",
          conversion_authority: "bim-streaming-server",
        }],
      },
    });
    expect(created.ok()).toBeTruthy();
    const source = await created.json() as { session_id: string };
    const closed = await request.post(`${coordinatorBase}/api/review-sessions/${source.session_id}/close`, { data: { reason: "e2e source close" } });
    expect(closed.ok()).toBeTruthy();

    await page.goto(`${coordinatorBase}/ui/#a1-workbench`);
    await expect(page.locator("[data-testid='a1-no-session']")).toBeVisible();
    const recreateButton = page.locator(`[data-testid='closed-session-recreate-${source.session_id}']`);
    await expect(recreateButton).toBeEnabled();
    await recreateButton.click();
    await expect(page.locator("[data-testid='closed-session-confirm']")).toContainText("原 Session 保持 closed");
    const recreateResponsePromise = page.waitForResponse((response) => (
      response.request().method() === "POST"
      && response.url().endsWith(`/api/review-sessions/${source.session_id}/recreate`)
    ));
    await page.locator("[data-testid='closed-session-confirm-action']").click();
    const recreateResponse = await recreateResponsePromise;
    expect(recreateResponse.status()).toBe(201);
    const recreated = await recreateResponse.json() as { session_id: string; recreated_from_session_id: string };
    expect(recreated.session_id).not.toBe(source.session_id);
    expect(recreated.recreated_from_session_id).toBe(source.session_id);
    await expect(page.locator("[data-testid='a1-session-select']")).toHaveValue(recreated.session_id);
    await expect(page.locator("[data-testid='a1-inline-manual-start']")).toContainText("啟動 A1 3D Session");
    await expect(page.locator("[data-testid='a1-inline-gpu-unavailable']")).toContainText("重新檢查 Kit 狀態");
    await page.screenshot({ path: testInfo.outputPath("a1-recreated-session.png"), fullPage: true });

    const sourceAfter = await request.get(`${coordinatorBase}/api/review-sessions/${source.session_id}`);
    expect((await sourceAfter.json()).status).toBe("closed");
    const newAfter = await request.get(`${coordinatorBase}/api/review-sessions/${recreated.session_id}`);
    expect((await newAfter.json()).recreated_from_session_id).toBe(source.session_id);
    const runtimeAfter = await request.get(`${coordinatorBase}/api/runtime/status`);
    expect((await runtimeAfter.json()).ifc_ready_jobs).toEqual({ count: 0, recent: [] });

    await page.goto(`${coordinatorBase}/ui/#sessions`);
    await expect(page.locator(`[data-testid='session-terminate-${recreated.session_id}']`)).toContainText("結束 Review Session");
    await expect(page.locator(`[data-testid='closed-session-row-${source.session_id}']`)).toBeVisible();
    await page.locator(`[data-testid='session-terminate-${recreated.session_id}']`).click();
    await expect(page.locator("[data-testid='intent-dialog']")).toContainText("永久結束 Session");
    const closeResponsePromise = page.waitForResponse((response) => (
      response.request().method() === "POST"
      && response.url().endsWith(`/api/review-sessions/${recreated.session_id}/close`)
    ));
    await page.locator("[data-testid='intent-confirm']").click();
    expect((await closeResponsePromise).ok()).toBeTruthy();
    await expect(page.locator(`[data-testid='session-row-${recreated.session_id}']`)).toHaveCount(0);

    await page.screenshot({ path: testInfo.outputPath("closed-session-recreate.png"), fullPage: true });
  });
});

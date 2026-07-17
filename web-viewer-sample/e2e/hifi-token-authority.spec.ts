import { expect, request as pwRequest, test } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// migrate-console-to-hifi-design 遷移契約垂直切片（真 coordinator、無瀏覽器 API mock）：
// route → 操作 → 真實 backend API → runtime ID（ifc_ready_job_id）→ loading/success/failure/retry，
// 外加 design token 權威斷言（--ab-* 生效、--ec- 絕跡、主題切換退場）。
const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const viewerDir = path.resolve(TEST_DIR, "..");
const repoRoot = path.resolve(viewerDir, "..");
const coordinatorDir = path.join(repoRoot, "bim-review-coordinator");
const consoleDistDir = path.join(viewerDir, "dist-ui");
const coordinatorPort = Number.parseInt(process.env.HIFI_E2E_COORDINATOR_PORT ?? "8017", 10);
const coordinatorBase = `http://127.0.0.1:${coordinatorPort}`;
const webhookSecret = "dev-webhook-secret";
const artifactDir = path.join(repoRoot, "artifacts", "e2e", "hifi-token-authority");

let coordinatorProc: ChildProcess | null = null;
let ifcSourceStub: http.Server | null = null;
let conversionStub: http.Server | null = null;
let tmpRoot = "";
let sourcePort = 0;

async function listenOnRandomPort(server: http.Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("stub bind failed");
  return address.port;
}

// coordinator 埠前置守門（依 conv-history.spec.ts 既有慣例）：spawn 前先自己 bind 一次目標埠。
// bind 失敗＝有未知程序占用 coordinatorPort（最常見：前一輪本機執行被 Ctrl+C／除錯器中止，afterAll
// taskkill 未跑完，殘留舊 coordinator 仍佔埠）。此時 fail-fast，避免新 spawn 撞 EADDRINUSE 崩潰、而
// waitForHealth 首輪輪詢卻先打中殘留舊程序回綠——導致整組測試悄悄對舊 build 跑出假綠燈。
async function requireCoordinatorPortAvailable(): Promise<void> {
  const probe = http.createServer();
  await new Promise<void>((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(coordinatorPort, "127.0.0.1", () => probe.close(() => resolve()));
  }).catch((error) => {
    throw new Error(`coordinator 埠 ${coordinatorPort} 已被占用；拒絕重用或停止未知程序：${String(error)}`);
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
      } catch { /* retry until ready */ }
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
        "X-Correlation-Id": "corr_hifi_token_001",
        "X-Idempotency-Key": "idem_hifi_token_001",
      },
      data: {
        event: "ifc_ready",
        event_id: "evt_hifi_token_001",
        correlation_id: "corr_hifi_token_001",
        idempotency_key: "idem_hifi_token_001",
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

test.describe("hifi token authority：遷移契約垂直切片（真 coordinator）", () => {
  test.setTimeout(180_000);

  test.beforeAll(async () => {
    if (!fs.existsSync(path.join(consoleDistDir, "index.html"))) {
      throw new Error("dist-ui is required; run `npm run build:ui` before this gate.");
    }
    await requireCoordinatorPortAvailable(); // spawn 前守門：殘留舊 coordinator 佔埠即 fail-fast，杜絕頂替假綠
    ifcSourceStub = http.createServer((_request, response) => {
      response.writeHead(200, { "Content-Type": "application/octet-stream" });
      response.end("ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n");
    });
    sourcePort = await listenOnRandomPort(ifcSourceStub);
    conversionStub = http.createServer((_request, response) => {
      response.writeHead(404, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ detail: "conversion API not exercised by this gate" }));
    });
    const conversionPort = await listenOnRandomPort(conversionStub);
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hifi-token-authority-"));
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
    coordinatorProc.stderr?.on("data", (data) => { stderrTail = `${stderrTail}${String(data)}`.slice(-4000); });
    await waitForHealth(() => (coordinatorExited == null
      ? null
      : `coordinator exited before health (code=${coordinatorExited}); stderr:\n${stderrTail}`));
  });

  test.afterAll(async () => {
    if (coordinatorProc?.pid && process.platform === "win32") {
      await new Promise<void>((resolve) => {
        const killer = spawn("taskkill", ["/F", "/T", "/PID", String(coordinatorProc!.pid)], { stdio: "ignore" });
        killer.on("exit", () => resolve());
        killer.on("error", () => { try { coordinatorProc?.kill("SIGKILL"); } catch { /* stopped */ } resolve(); });
      });
    } else if (coordinatorProc) {
      coordinatorProc.kill("SIGTERM");
    }
    coordinatorProc = null;
    for (const server of [ifcSourceStub, conversionStub]) {
      if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    ifcSourceStub = null;
    conversionStub = null;
    if (tmpRoot && fs.existsSync(tmpRoot)) fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  test("unified home：--ab token 生效、主題鍵不寫入", async ({ page }) => {
    fs.mkdirSync(artifactDir, { recursive: true });
    await page.goto(`${coordinatorBase}/ui`);
    await expect(page.getByText("總覽 · Mission Control")).toBeVisible({ timeout: 20_000 });
    const facts = await page.evaluate(() => ({
      bodyBg: getComputedStyle(document.body).backgroundColor,
      abAccent: getComputedStyle(document.documentElement).getPropertyValue("--ab-accent").trim(),
      themeKey: localStorage.getItem("aibim:ec-theme"),
    }));
    expect(facts.bodyBg).toBe("rgb(6, 10, 16)"); // var(--ab-bg) #060a10
    expect(facts.abAccent).toBe("#41c7e8");
    expect(facts.themeKey).toBeNull(); // 主題持久化已退場
    await page.screenshot({ path: path.join(artifactDir, "unified-home.png"), fullPage: false });
  });

  test("legacy #conv 垂直切片：loading/success/failure/retry + 品牌青 + --ec- 絕跡 + 無主題鈕", async ({ page }) => {
    const jobId = await seedIfcReadyJob(); // 真實 runtime ID（coordinator 核發）

    // failure：先攔斷佇列 API（GET /api/external/ifc-ready）→ 頁面誠實顯示錯誤狀態
    await page.route("**/api/external/ifc-ready**", (route) => route.abort());
    await page.goto(`${coordinatorBase}/ui#conv`);
    await expect(page.getByTestId("conv-queue-error")).toBeVisible({ timeout: 20_000 });

    // retry：解除攔截，改掛「延遲放行」路由（仍打真實 coordinator，只延後回應以留出 loading 觀測窗），
    // 再由使用者點「重新整理」鈕（conv-refresh，onClick → refresh() → data.load() → GET /api/external/ifc-ready）
    // 觸發佇列層重試——此鈕與被測佇列同一條 fetch，語意相符，spec §9「UI route → 按鈕」要求由此鈕滿足。
    // per-job conv-prioritize-*/conv-retry-* 屬單筆排序／重試（語意不同）故不採；conv-refresh 才是佇列層重試入口。
    await page.unroute("**/api/external/ifc-ready**");
    await page.route("**/api/external/ifc-ready**", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 800));
      await route.continue();
    });
    const responsePromise = page.waitForResponse((r) => r.url().includes("/api/external/ifc-ready") && r.ok());
    const refreshBtn = page.getByTestId("conv-refresh");
    await expect(refreshBtn).toBeEnabled({ timeout: 20_000 }); // 前一輪失敗已 settle（data.busy=false），鈕可點
    await refreshBtn.click();
    // loading：與被測佇列同一條 /api/external/ifc-ready fetch 的載入態——鈕轉 disabled 且顯「載入中…」
    //（data.busy=true）。綁對被測資料流，並以 expect 硬斷言（非僅 console.log 觀測）。
    await expect(refreshBtn).toBeDisabled();
    await expect(refreshBtn).toContainText("載入中");
    const listResponse = await responsePromise; // 真實 backend API 成功
    expect(listResponse.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "IFC→USD 轉檔歷史" })).toBeVisible();
    await expect(page.getByText(jobId)).toBeVisible({ timeout: 20_000 }); // runtime ID 上桌（success）
    await expect(refreshBtn).toBeEnabled({ timeout: 20_000 }); // loading 退場：載入結束鈕回到可點
    await page.unroute("**/api/external/ifc-ready**"); // 清理延遲路由，避免污染後續 5s 輪詢的 token 觀測

    // 遷移契約：品牌青、--ec- 絕跡、主題鈕退場、淺色 class 絕跡
    const facts = await page.evaluate(() => {
      const brand = document.querySelector(".ec-brand");
      const root = document.querySelector(".ec-root");
      return {
        brandColor: brand ? getComputedStyle(brand).color : null,
        ecGrn: root ? getComputedStyle(root).getPropertyValue("--ec-grn").trim() : "unmounted",
        themeLight: document.querySelector(".theme-light") != null,
        themeKey: localStorage.getItem("aibim:ec-theme"),
      };
    });
    expect(facts.brandColor).toBe("rgb(65, 199, 232)"); // var(--ab-accent)
    expect(facts.ecGrn).toBe(""); // --ec-* token 已不存在
    expect(facts.themeLight).toBe(false);
    expect(facts.themeKey).toBeNull();
    await expect(page.getByRole("button", { name: "切換亮暗主題" })).toHaveCount(0);
    await page.screenshot({ path: path.join(artifactDir, "legacy-conv.png"), fullPage: false });
  });

  test("legacy #/demo-control 與 #/kit 仍可達（遷移未砍 operator-tool 路由）", async ({ page }) => {
    await page.goto(`${coordinatorBase}/ui#/demo-control`);
    await expect(page.getByTestId("real-ifc-demo-control")).toBeVisible({ timeout: 15_000 });
    // demo-control 頁證據——拍在導往 #/kit 之前，確保檔名與畫面一致（證物誠信）。
    await page.screenshot({ path: path.join(artifactDir, "legacy-demo-control.png"), fullPage: false });
    await page.goto(`${coordinatorBase}/ui#/kit`);
    await expect(page.getByTestId("kit-proxy-panel")).toBeVisible({ timeout: 15_000 });
    // kit 頁證據——對應本 test 第二條可達性斷言的畫面。
    await page.screenshot({ path: path.join(artifactDir, "legacy-kit.png"), fullPage: false });
  });
});

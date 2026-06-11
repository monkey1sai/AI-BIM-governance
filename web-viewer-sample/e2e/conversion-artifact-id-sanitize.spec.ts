import { spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect, request as pwRequest, type APIRequestContext } from "@playwright/test";

// conversion-artifact-id-sanitize（spec 2026-06-11）：user-facing vertical slice。
// #/conv → Refresh queue → 真 coordinator GET /api/external/ifc-ready → 真實 ifcready_* ID
// → 中文 external_model_version_id 不再 dispatch_failed；另造必失敗 job 驗 dispatch_error 明細可見。
//
// *** 誠實標記決策：採 (B) STUB CONVERSION API ***
//   真 conversion API（:8010 / streaming）太重、需 host-native GPU runtime，不在本機 E2E 起。
//   本 spec 起一個與 conversion 端 SAFE_ID_RE 同規則的 Node `http` stub（spec §7 允許），
//   coordinator 的 streamingConversionApiBase 指向它。單元/整合層（Task 1，
//   bim-review-coordinator/tests/external-ifc-ready.test.ts「中文 external_model_version_id…」）
//   已用真 SAFE_ID_RE 鎖死；本 E2E 只負責 user-facing vertical slice（前端可操作 + 證據可見）。
//   截圖落 artifacts/e2e/conversion-artifact-id-sanitize-*；evidence summary 標 STUB CONVERSION API。
//
// 為求 dispatch 終態確定可重現，本 spec 自起一台「本 branch 碼」的 coordinator（tsx src/index.ts），
// 服務本 branch build 出的 dist-ui（CONSOLE_DIST_DIR），並把 conversion base 指向 in-test stub。
// 前端由 coordinator 同源 /ui 服務 → coordinatorClient 走 same-origin → 完全打到本 stub 化的 coordinator。
// playwright 仍會 auto-start :5180 viewer，但本 spec 一律 page.goto 到本 coordinator /ui，:5180 與本 spec 無關。

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const VIEWER_REPO_DIR = path.resolve(TEST_DIR, ".."); // web-viewer-sample/
const COORDINATOR_REPO_DIR = path.resolve(VIEWER_REPO_DIR, "..", "bim-review-coordinator");
const CONSOLE_DIST_DIR = path.resolve(VIEWER_REPO_DIR, "dist-ui");

const WEBHOOK_SECRET = "dev-webhook-secret"; // = config 預設（EXTERNAL_INTAKE_WEBHOOK_SECRET）
// conversion 端逐字同款規則（spec §7；bim-streaming-server SAFE_ID_RE）。
const SAFE_ID_RE = /^[A-Za-z0-9_.-]+$/;
// 必失敗哨兵：artifact_id 含此字串時 stub 回 400（製造 dispatch_failed + dispatch_error）。
const FORCE_FAIL_MARKER = "forcefail";

let coordinatorBase = "";
let coordinatorProc: ChildProcess | null = null;
let convStub: http.Server | null = null;
let ifcSourceStub: http.Server | null = null;
let tmpRoot = "";

// authHeaders：比照 bim-review-coordinator/tests/external-ifc-ready.test.ts。
// 正常 intake 路徑用「靜態 X-Webhook-Secret」(非 HMAC)，外加 X-Correlation-Id / X-Idempotency-Key。
function authHeaders(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-Webhook-Secret": WEBHOOK_SECRET,
    "X-Correlation-Id": "corr_e2e_001",
    "X-Idempotency-Key": "idem_e2e_001",
    ...overrides,
  };
}

async function listenOnRandomPort(server: http.Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected stub server to listen on a TCP port.");
  }
  return address.port;
}

// STUB CONVERSION API：與 conversion 端 SAFE_ID_RE 同款規則驗 ifc_artifact.artifact_id。
// 哨兵 forcefail → 400（製造 dispatch_failed）；非 safe → 400（防回歸：sanitize 失效時會紅）；
// 其餘 → 200 queued。
async function startConversionStub(): Promise<void> {
  convStub = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.method !== "POST" || req.url !== "/api/conversions/ifc-to-usdc") {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ detail: "not found" }));
        return;
      }
      let artifactId = "";
      try {
        artifactId = (JSON.parse(body || "{}")?.ifc_artifact?.artifact_id as string) ?? "";
      } catch {
        artifactId = "";
      }
      if (artifactId.includes(FORCE_FAIL_MARKER)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ detail: `STUB forced failure for artifact_id: ${artifactId}` }));
        return;
      }
      if (!SAFE_ID_RE.test(artifactId)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ detail: `Invalid ifc_artifact_id: ${artifactId}` }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({ conversion_job_id: "stream_conv_e2e", status: "queued", authority: "bim-streaming-server" }),
      );
    });
  });
}

// IFC source stub：回最小 IFC bytes，讓 coordinator non-strict 同步下載成功（不卡在 download failed）。
async function startIfcSourceStub(): Promise<void> {
  ifcSourceStub = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/octet-stream" });
    res.end("ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n");
  });
}

async function waitForHealth(base: string, timeoutMs = 60_000): Promise<void> {
  const api = await pwRequest.newContext();
  const start = Date.now();
  try {
    while (Date.now() - start < timeoutMs) {
      try {
        const res = await api.get(`${base}/health`, { timeout: 2000 });
        if (res.ok()) return;
      } catch {
        // not up yet
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`coordinator /health not ready within ${timeoutMs}ms at ${base}`);
  } finally {
    await api.dispose();
  }
}

test.describe("中文 model_version_id 派工修復 + dispatch_error 可見（STUB CONVERSION API）", () => {
  test.setTimeout(180_000);

  test.beforeAll(async () => {
    // dist-ui 必須先 build（npm run build:ui）；缺檔則 skip（誠實：環境未對齊不假裝跑過）。
    test.skip(
      !fs.existsSync(path.join(CONSOLE_DIST_DIR, "index.html")),
      "dist-ui 未 build；先跑 `cd web-viewer-sample && npm run build:ui` 再執行本 spec。",
    );

    await startConversionStub();
    await startIfcSourceStub();
    const convPort = await listenOnRandomPort(convStub!);
    const ifcPort = await listenOnRandomPort(ifcSourceStub!);
    (globalThis as Record<string, unknown>).__ifcSourcePort = ifcPort;

    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "conv-id-sanitize-e2e-"));

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: "0", // 由 OS 配 free port，避免撞既有 :8004 docker coordinator
      PUBLIC_HOST: "127.0.0.1",
      STREAMING_CONVERSION_API_BASE: `http://127.0.0.1:${convPort}`,
      CONSOLE_DIST_DIR: CONSOLE_DIST_DIR,
      CONVERSION_POLL_ENABLED: "false", // 不自動 poll；dispatch 終態即 assert 目標
      IFC_DOWNLOAD_STRICT: "false", // non-strict：stub source 下載成功
      EXTERNAL_INTAKE_WEBHOOK_SECRET: WEBHOOK_SECRET,
      SESSION_STORE_DIR: path.join(tmpRoot, "sessions"),
      EVENT_LOG_DIR: path.join(tmpRoot, "events"),
      CALLBACK_OUTBOX_STORE_PATH: path.join(tmpRoot, "callback-outbox.json"),
      STORAGE_ROOT: path.join(tmpRoot, "storage"),
      LOG_ROOT: path.join(tmpRoot, "logs"),
    };

    // PORT=0 時 src/index.ts 的 log 不含我們要的實際 port；改成固定 free port 較可控。
    // 用 net 取一個 free port 寫回 env（PORT=0 在 express 會配隨機，但拿不到值）。
    const freePort = await new Promise<number>((resolve, reject) => {
      const srv = http.createServer();
      srv.listen(0, "127.0.0.1", () => {
        const addr = srv.address();
        if (!addr || typeof addr === "string") {
          reject(new Error("could not allocate free port"));
          return;
        }
        const p = addr.port;
        srv.close(() => resolve(p));
      });
    });
    env.PORT = String(freePort);
    coordinatorBase = `http://127.0.0.1:${freePort}`;

    const tsxBin = path.join(COORDINATOR_REPO_DIR, "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");
    coordinatorProc = spawn(tsxBin, ["src/index.ts"], {
      cwd: COORDINATOR_REPO_DIR,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    });
    coordinatorProc.stdout?.on("data", (d) => process.stdout.write(`[coordinator] ${d}`));
    coordinatorProc.stderr?.on("data", (d) => process.stderr.write(`[coordinator:err] ${d}`));

    await waitForHealth(coordinatorBase);
  });

  test.afterAll(async () => {
    if (coordinatorProc) {
      coordinatorProc.kill("SIGTERM");
      coordinatorProc = null;
    }
    if (convStub) {
      await new Promise<void>((r) => convStub?.close(() => r()));
      convStub = null;
    }
    if (ifcSourceStub) {
      await new Promise<void>((r) => ifcSourceStub?.close(() => r()));
      ifcSourceStub = null;
    }
    if (tmpRoot && fs.existsSync(tmpRoot)) {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  // 比照 external-ifc-ready.test.ts 正常 intake 路徑：靜態 X-Webhook-Secret（非 HMAC）+
  // source_ifc.ref 走可控本機 HTTP stub（non-strict 真下載成功）。回 202，回傳 ifc_ready_job_id。
  async function postIfcReady(
    api: APIRequestContext,
    opts: { externalModelVersionId: string; correlation: string },
  ): Promise<string> {
    const ifcPort = (globalThis as Record<string, unknown>).__ifcSourcePort as number;
    const ref = `http://127.0.0.1:${ifcPort}/edge/${encodeURIComponent(opts.externalModelVersionId)}.ifc`;
    const res = await api.post(`${coordinatorBase}/api/external/ifc-ready`, {
      headers: authHeaders({
        "X-Correlation-Id": opts.correlation,
        "X-Idempotency-Key": opts.correlation.replace("corr_", "idem_"),
      }),
      data: {
        event: "ifc_ready",
        event_id: `evt_${opts.correlation}`,
        correlation_id: opts.correlation,
        idempotency_key: opts.correlation.replace("corr_", "idem_"),
        tenant_id: "tenant_e2e_001",
        project_id: "project_e2e_001",
        external_model_version_id: opts.externalModelVersionId,
        source_ifc: {
          ref,
          etag: `sha256:${"e".repeat(64)}`,
          filename: "model.ifc",
          format: "ifc",
        },
        requested_outputs: ["usdc", "element_mapping", "entity_index", "metadata"],
      },
    });
    expect(res.status(), `POST ifc-ready (${opts.externalModelVersionId}) 應 202`).toBe(202);
    const body = await res.json();
    expect(String(body.ifc_ready_job_id)).toMatch(/^ifcready_/);
    return body.ifc_ready_job_id as string;
  }

  // 等 coordinator 把 job 推進到 dispatch 終態（dispatched / dispatch_failed）。
  async function waitForDispatchEnd(api: APIRequestContext, jobId: string): Promise<Record<string, unknown>> {
    const start = Date.now();
    while (Date.now() - start < 30_000) {
      const res = await api.get(`${coordinatorBase}/api/external/ifc-ready/${jobId}`);
      if (res.ok()) {
        const body = await res.json();
        if (["dispatched", "dispatch_failed", "failed"].includes(String(body.status))) {
          return body as Record<string, unknown>;
        }
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(`Job ${jobId} did not reach dispatch end within 30s`);
  }

  function rowOf(page: import("@playwright/test").Page, jobId: string) {
    // #/conv「Ifc-ready jobs」表第一欄 td = ifc_ready_job_id（pages.tsx ConversionSchedulingPage）。
    return page.locator("table.ec-table tbody tr").filter({ has: page.locator("td", { hasText: jobId }) });
  }

  test("POST 中文 ifc-ready → #/conv 該 job 非 dispatch_failed；必失敗 job 顯 dispatch_error", async ({ page }) => {
    const api = await pwRequest.newContext();
    try {
      // 1) 中文 external_model_version_id 的成功路徑：sanitize 後 artifact_id 為 safe，stub 回 200 → dispatched。
      const cjkJobId = await postIfcReady(api, {
        externalModelVersionId: "271_pieple_管線",
        correlation: "corr_cjk_001",
      });
      // 2) 必失敗 job：artifact_id 含 forcefail 哨兵 → stub 回 400 → dispatch_failed + dispatch_error。
      const failJobId = await postIfcReady(api, {
        externalModelVersionId: `${FORCE_FAIL_MARKER}_demo`,
        correlation: "corr_fail_001",
      });

      // backend 真實狀態先驗（user-facing 之前確認 coordinator 確實達成兩種終態）。
      const cjkDetail = await waitForDispatchEnd(api, cjkJobId);
      expect(cjkDetail.status, "中文 id job 應 dispatched（非 dispatch_failed）").toBe("dispatched");
      expect(cjkDetail.dispatch_error, "中文 id job dispatch_error 應為 null").toBeNull();
      const failDetail = await waitForDispatchEnd(api, failJobId);
      expect(failDetail.status, "forcefail job 應 dispatch_failed").toBe("dispatch_failed");
      expect(String(failDetail.dispatch_error), "forcefail job 應帶 dispatch_error 明細").toContain("400");

      // 3) 前端：開 #/conv（由本 coordinator 同源 /ui 服務）→ 按 Refresh queue → 列表渲染。
      await page.goto(`${coordinatorBase}/ui#/conv`);
      await page.getByRole("button", { name: /Refresh queue|讀取中/ }).click();
      const table = page.locator("table.ec-table");
      await expect(table).toBeVisible({ timeout: 20_000 });

      // 4) 中文 id 的 job：dispatch 欄（td.nth(3)）不得是 dispatch_failed 的 error；conversion 欄（td.nth(2)）為 queued。
      const cjkRow = rowOf(page, cjkJobId);
      await expect(cjkRow).toBeVisible({ timeout: 20_000 });
      // 中文 id job 不應有 dispatch-error 節點（沒被 conversion 端 400 擋下）。
      await expect(page.getByTestId(`conv-dispatch-error-${cjkJobId}`)).toHaveCount(0);
      await expect(cjkRow.locator("td").nth(2)).toHaveText("queued");

      // 5) 必失敗 job：dispatch_error 節點可見，title 含完整錯誤字串（明細可見）。
      const failError = page.getByTestId(`conv-dispatch-error-${failJobId}`);
      await expect(failError).toBeVisible({ timeout: 20_000 });
      await expect(failError).toHaveAttribute("title", /400/);

      await page.screenshot({ path: "../artifacts/e2e/conversion-artifact-id-sanitize-conv.png", fullPage: true });
    } finally {
      await api.dispose();
    }
  });
});

import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import http from "node:http";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createCoordinatorApp, type CoordinatorApp } from "../src/app.js";

let active: CoordinatorApp | null = null;
let activeConversionServer: http.Server | null = null;

afterEach(async () => {
  if (activeConversionServer) {
    await new Promise<void>((resolve) => activeConversionServer?.close(() => resolve()));
    activeConversionServer = null;
  }
  if (active) {
    active.io.close();
    await new Promise<void>((resolve) => active?.server.close(() => resolve()));
    active = null;
  }
});

function makeApp(): CoordinatorApp {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bim-review-coordinator-dev-console-test-"));
  active = createCoordinatorApp({
    sessionStoreDir: path.join(root, "sessions"),
    eventLogDir: path.join(root, "events"),
    callbackOutboxStorePath: path.join(root, "callback-outbox.json"),
    bimControlApiBase: "http://127.0.0.1:1",
    corsOrigins: ["http://127.0.0.1:5173"],
  });
  return active;
}

describe("coordinator dev console", () => {
  it("serves the dev console from /ui and /dev-console", async () => {
    const app = makeApp();

    const ui = await request(app.app).get("/ui");
    const consolePage = await request(app.app).get("/dev-console");

    expect(ui.status).toBe(200);
    expect(ui.text).toContain("審查協調 (Review Coordinator)");
    expect(ui.text).toContain("閉環 Runtime Dashboard");
    expect(ui.text).toContain("/api/runtime/status");
    expect(ui.text).toContain("Kit / WebRTC");
    expect(ui.text).toContain("expected stage URL");
    expect(ui.text).toContain("sourceFileInput");
    expect(ui.text).toContain("/api/dev/conversions/mock");
    expect(ui.text).toContain("/api/external/ifc-ready");
    expect(ui.text).toContain("getLatestConversionReviewPayload");
    expect(ui.text).toContain("互動效果實驗室");
    // remove-conflict-review-from-fast-mvp:衝突檢討(guidedHighlightIssue / guidedAnnotation / guidedConversion)已自 fast MVP 移除
    expect(ui.text).not.toContain("guidedHighlightIssue");
    expect(ui.text).not.toContain("guidedAnnotation");
    expect(ui.text).not.toContain("emitHighlight()");
    expect(ui.text).toContain("步驟 ③ / 3");
    expect(ui.text).toContain("工程參數與 Raw API / Socket controls");
    expect(consolePage.status).toBe(200);
    expect(consolePage.text).toContain("/api/review-sessions");
  });

  // coordinator-ui-tri-ready-and-queue:Edge BIM Data Server Console 區段
  it("exposes Edge BIM Data Server Console tri-ready + dispatch queue + step rename", async () => {
    const app = makeApp();
    const ui = await request(app.app).get("/ui");
    expect(ui.status).toBe(200);

    // Edge Console section + step rename(4 個 step header literal)
    expect(ui.text).toContain("Edge BIM Data Server Console");
    expect(ui.text).toContain("① 接收 IFC-ready webhook");
    expect(ui.text).toContain("② 產生本機 USDC 資料包");
    expect(ui.text).toContain("③ 啟動 Kit / WebRTC 串流");
    expect(ui.text).toContain("④ 驗證 BIM 語意對照");

    // 三段 ready data-testid + dispatch queue section + legacy disclaimer
    expect(ui.text).toContain('data-testid="tri-ready-badges"');
    expect(ui.text).toContain('data-testid="dispatch-queue-section"');
    expect(ui.text).toContain('data-testid="legacy-assets-disclaimer"');

    // inline JS:tri-ready compute functions + C1 / C4 field 引用
    expect(ui.text).toContain("function computeFileReady");
    expect(ui.text).toContain("function computeRuntimeReady");
    expect(ui.text).toContain("function computeSemanticReady");
    expect(ui.text).toContain("semantic_mapping_fidelity");
    expect(ui.text).toContain("mapping_has_ifc_type");
    expect(ui.text).toContain("mapping_has_ifc_name");
    expect(ui.text).toContain("queued_for_conversion");
    expect(ui.text).toContain("dropped_on_restart");

    // legacy disclaimer 文案
    expect(ui.text).toContain("不代表 當前 session model");
  });

  it("serves the dev console script", async () => {
    const app = makeApp();

    const response = await request(app.app).get("/dev-console-assets/dev-console.js");

    expect(response.status).toBe(200);
    expect(response.text).toContain("joinSession");
    expect(response.text).toContain("bim_review_primary_viewer");
  });

  it("proxies dev mock conversion requests to the conversion service", async () => {
    let receivedBody = "";
    let receivedMethod = "";
    let receivedUrl = "";
    activeConversionServer = http.createServer((req, res) => {
      receivedMethod = req.method || "";
      receivedUrl = req.url || "";
      req.on("data", (chunk) => {
        receivedBody += chunk.toString("utf8");
      });
      req.on("end", () => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ job_id: "conv_dev_mock_001", status: "succeeded", mock: true }));
      });
    });
    await new Promise<void>((resolve) => {
      activeConversionServer?.listen(0, "127.0.0.1", () => resolve());
    });
    const address = activeConversionServer.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected conversion test server to listen on a TCP port.");
    }
    const app = makeApp();
    app.config.conversionApiBase = `http://127.0.0.1:${address.port}`;

    const response = await request(app.app)
      .post("/api/dev/conversions/mock")
      .send({ project_id: "project_demo_001", model_version_id: "version_demo_001" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ job_id: "conv_dev_mock_001", status: "succeeded", mock: true });
    expect(receivedMethod).toBe("POST");
    expect(receivedUrl).toBe("/api/dev/mock-conversion-result");
    expect(JSON.parse(receivedBody).project_id).toBe("project_demo_001");
  });

  it("proxies dev real conversion requests to the host-native conversion endpoint", async () => {
    let receivedUrl = "";
    activeConversionServer = http.createServer((req, res) => {
      receivedUrl = req.url || "";
      res.writeHead(202, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ conversion_job_id: "stream_conv_dev_001", status: "queued" }));
    });
    await new Promise<void>((resolve) => {
      activeConversionServer?.listen(0, "127.0.0.1", () => resolve());
    });
    const address = activeConversionServer.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected conversion test server to listen on a TCP port.");
    }
    const app = makeApp();
    app.config.conversionApiBase = `http://127.0.0.1:${address.port}`;

    const response = await request(app.app)
      .post("/api/dev/conversions")
      .send({ event_type: "ifc_ready", ifc_artifact: { artifact_id: "ifc_1", format: "ifc", url: "edge-local://storage/model.ifc" } });

    expect(response.status).toBe(202);
    expect(response.body.conversion_job_id).toBe("stream_conv_dev_001");
    expect(receivedUrl).toBe("/api/conversions/ifc-to-usdc");
  });

  it("proxies dev conversion list queries to the host-native conversion endpoint", async () => {
    let receivedUrl = "";
    activeConversionServer = http.createServer((req, res) => {
      receivedUrl = req.url || "";
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          count: 2,
          items: [
            { conversion_job_id: "stream_conv_dev_002", model_version_id: "version_demo_001", ready: true },
            { conversion_job_id: "stream_conv_dev_001", model_version_id: "version_demo_001", ready: true },
          ],
        }),
      );
    });
    await new Promise<void>((resolve) => {
      activeConversionServer?.listen(0, "127.0.0.1", () => resolve());
    });
    const address = activeConversionServer.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected conversion test server to listen on a TCP port.");
    }
    const app = makeApp();
    app.config.conversionApiBase = `http://127.0.0.1:${address.port}`;

    const response = await request(app.app).get("/api/dev/conversions?model_version_id=version_demo_001&status=succeeded&ready=true");

    expect(response.status).toBe(200);
    expect(response.body.count).toBe(2);
    expect(receivedUrl).toBe("/api/conversions?model_version_id=version_demo_001&status=succeeded&ready=true");
  });
});

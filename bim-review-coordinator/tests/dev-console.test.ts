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
    expect(ui.text).toContain("sourceFileInput");
    expect(ui.text).toContain("/api/dev/conversions/mock");
    expect(ui.text).toContain("互動效果實驗室");
    expect(ui.text).toContain("guidedHighlightIssue");
    expect(ui.text).toContain("工程參數與 Raw API / Socket controls");
    expect(consolePage.status).toBe(200);
    expect(consolePage.text).toContain("/api/review-sessions");
  });

  it("serves the dev console script", async () => {
    const app = makeApp();

    const response = await request(app.app).get("/dev-console-assets/dev-console.js");

    expect(response.status).toBe(200);
    expect(response.text).toContain("joinSession");
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
});

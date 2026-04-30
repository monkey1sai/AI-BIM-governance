import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createCoordinatorApp, type CoordinatorApp } from "../src/app.js";

let active: CoordinatorApp | null = null;

afterEach(async () => {
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
    expect(ui.text).toContain("BIM Review Coordinator Dev Console");
    expect(consolePage.status).toBe(200);
    expect(consolePage.text).toContain("/api/review-sessions");
  });

  it("serves the dev console script", async () => {
    const app = makeApp();

    const response = await request(app.app).get("/dev-console-assets/dev-console.js");

    expect(response.status).toBe(200);
    expect(response.text).toContain("joinSession");
  });
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCoordinatorApp, type CoordinatorApp } from "../src/app.js";

// unified-console-runtime-truth slice 2 task 4.4(owner D3 裁決):ENABLE_DEV_ROUTES=false 時 /api/dev/*
// 整組 404(含 conversions pass-through、ifc-sources、routes/devMeta.ts 的 test-data-projects);
// 未設定/空字串=維持開啟(本機 local-windows/隔離 branch stack 不受影響)。devRoutesEnabled() 於
// request 時讀 process.env,故本檔以 beforeEach/afterEach 設定與還原 env。

let active: CoordinatorApp | null = null;
let previousEnableDevRoutes: string | undefined;

beforeEach(() => {
  previousEnableDevRoutes = process.env.ENABLE_DEV_ROUTES;
});

afterEach(async () => {
  if (previousEnableDevRoutes === undefined) delete process.env.ENABLE_DEV_ROUTES;
  else process.env.ENABLE_DEV_ROUTES = previousEnableDevRoutes;
  if (!active) return;
  await active.dispose();
  active.io.close();
  await new Promise<void>((resolve) => active?.server.close(() => resolve()));
  active = null;
});

function makeApp(): CoordinatorApp {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bim-coord-dev-routes-"));
  active = createCoordinatorApp({
    sessionStoreDir: path.join(root, "sessions"),
    eventLogDir: path.join(root, "events"),
    callbackOutboxStorePath: path.join(root, "callback-outbox.json"),
    streamingConversionApiBase: "http://127.0.0.1:1",
    conversionApiBase: "http://127.0.0.1:1",
    corsOrigins: ["http://127.0.0.1:5173"],
    conversionPollEnabled: false,
    storageRoot: root,
    testDataProjectIds: ["270"],
  });
  return active;
}

const DISABLED_BODY = { detail: "dev routes disabled" };

describe("ENABLE_DEV_ROUTES=false → /api/dev/* 一律 404", () => {
  const cases: ReadonlyArray<readonly ["GET" | "POST", string]> = [
    ["POST", "/api/dev/conversions"],
    ["GET", "/api/dev/conversions"],
    ["GET", "/api/dev/conversions/stream_conv_1/result"],
    ["GET", "/api/dev/conversions/stream_conv_1"],
    ["POST", "/api/dev/conversions/mock"],
    ["GET", "/api/dev/ifc-sources"],
    ["POST", "/api/dev/ifc-sources/ifcsrc_x/register"],
    ["GET", "/api/dev/test-data-projects"],
    ["GET", "/api/dev/ifc-file/sample.ifc"],
  ];
  it.each(cases)("%s %s → 404 dev routes disabled", async (method, url) => {
    process.env.ENABLE_DEV_ROUTES = "false";
    const app = makeApp();
    const res = method === "GET" ? await request(app.app).get(url) : await request(app.app).post(url).send({});
    expect(res.status).toBe(404);
    expect(res.body).toEqual(DISABLED_BODY);
  });

  it("非 dev 路由不受影響:GET /api/runtime/status 仍 200", async () => {
    process.env.ENABLE_DEV_ROUTES = "false";
    const app = makeApp();
    const res = await request(app.app).get("/api/runtime/status");
    expect(res.status).toBe(200);
  });
});

describe("ENABLE_DEV_ROUTES 未設定/空字串 → 維持開啟", () => {
  it.each([["unset"], [""]])("(%s) GET /api/dev/test-data-projects → 200 且回 config 清單", async (mode) => {
    if (mode === "unset") delete process.env.ENABLE_DEV_ROUTES;
    else process.env.ENABLE_DEV_ROUTES = "";
    const app = makeApp();
    const res = await request(app.app).get("/api/dev/test-data-projects");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ projects: ["270"] });
  });

  it("(unset) POST /api/dev/conversions 仍走 pass-through(上游不可達 → 502,不是 404)", async () => {
    delete process.env.ENABLE_DEV_ROUTES;
    const app = makeApp();
    const res = await request(app.app).post("/api/dev/conversions").send({});
    expect(res.status).toBe(502);
    expect(res.body.detail).toBe("Conversion API unavailable.");
  });
});

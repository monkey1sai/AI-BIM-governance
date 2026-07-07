// bim-review-coordinator/tests/no-generic-operations-endpoint.test.ts
// 回歸守衛（C M4 Task4 邊界）：coordinator 不得引入通用 runtime operations endpoint。
// spec §「Preserve Coordinator Boundary」要求 runtime mutator 只能走 Kit 端 DataChannel + 授權閘門，
// 不得在 coordinator 開一條通用 /operations 代理路由繞過該邊界。
// 先前此邊界只有 plan 內一次性手動 rg 掃描（P5 finding f4：無 committed 回歸測試 → 未來新增此類
// 路由不會有任何測試變紅）。本測試把該邊界寫成 CI 可執行的斷言。
import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createCoordinatorApp, type CoordinatorApp } from "../src/app.js";

let active: CoordinatorApp | null = null;
let root: string | null = null;

function makeApp(): CoordinatorApp {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "no-ops-endpoint-"));
  active = createCoordinatorApp({
    sessionStoreDir: path.join(root, "sessions"),
    eventLogDir: path.join(root, "events"),
    callbackOutboxStorePath: path.join(root, "callback-outbox.json"),
    corsOrigins: ["http://127.0.0.1:5173"],
    conversionPollEnabled: false,
  });
  return active;
}

afterEach(async () => {
  if (active) {
    await active.dispose();
    active.io.close();
    await new Promise<void>((r) => active?.server.close(() => r()));
    active = null;
  }
  if (root) {
    fs.rmSync(root, { recursive: true, force: true });
    root = null;
  }
});

// 通用 runtime operations 代理路由的候選命名（Task4 Step1 手動掃描用的同一組樣式）。
const GENERIC_OPERATION_PATHS = [
  "/operations",
  "/api/operations",
  "/viewer-operations",
  "/api/viewer-operations",
  "/operation-log",
  "/api/operation-log",
  "/api/runtime/operations",
];

describe("coordinator 邊界：不得有通用 runtime operations endpoint（C M4 Task4 回歸守衛）", () => {
  it.each(GENERIC_OPERATION_PATHS)("GET %s 未註冊（回 404）", async (routePath) => {
    const res = await request(makeApp().app).get(routePath);
    expect(res.status, `${routePath} 不應被路由到；若此測試變紅代表有人新增了通用 operations endpoint，違反 coordinator 邊界`).toBe(404);
  });

  it.each(GENERIC_OPERATION_PATHS)("POST %s 未註冊（回 404）", async (routePath) => {
    const res = await request(makeApp().app).post(routePath).send({});
    expect(res.status, `${routePath} 不應被路由到；runtime mutator 必須走 Kit 端 DataChannel + 授權閘門`).toBe(404);
  });

  it("對照組：既有合法路由 /health 仍為 200（確認斷言不是因 app 整個壞掉才回 404）", async () => {
    const res = await request(makeApp().app).get("/health");
    expect(res.status).toBe(200);
  });
});

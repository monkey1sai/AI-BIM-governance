import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createCoordinatorApp, type CoordinatorApp } from "../src/app.js";

let active: CoordinatorApp | null = null;
afterEach(async () => {
  if (active) {
    await active.dispose();
    active.io.close();
    await new Promise<void>((r) => active?.server.close(() => r()));
    active = null;
  }
});
function makeApp(overrides = {}): CoordinatorApp {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "conv-watch-toggle-test-"));
  active = createCoordinatorApp({
    sessionStoreDir: path.join(root, "sessions"),
    eventLogDir: path.join(root, "events"),
    callbackOutboxStorePath: path.join(root, "callback-outbox.json"),
    corsOrigins: ["http://127.0.0.1:5173"],
    conversionPollEnabled: false,
    ...overrides,
  });
  return active;
}

// IX-CV-04：GET status 改讀 minioWatchRuntimeEnabled（初值 = env opt-in，
// 之後可被 PUT /api/conversion/watch 在 runtime 覆寫；PUT 本身屬 Task 2，本檔
// 不測 toggle 動作）。此處鎖定 status 路由「讀 runtime flag 初值」這條回歸基線：
// 兩個初始狀態（env 未 opt-in → enabled=false、env opt-in → enabled=true）都
// 必須由 status 路由如實回報，確保 status 不讀已分歧的 config.minioWatchEnabled。
describe("GET /api/external/minio-watch/status — runtime flag 初值（IX-CV-04 回歸鎖）", () => {
  it("env 未 opt-in（預設）→ runtime flag 初值=false → status enabled=false", async () => {
    const app = makeApp();
    const res = await request(app.app).get("/api/external/minio-watch/status");
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(false);
  });

  it("env opt-in（MINIO_WATCH_ENABLED=true）→ runtime flag 初值=true → status enabled=true", async () => {
    const app = makeApp({
      minioWatchEnabled: true,
      minioWatchEndpoint: "http://127.0.0.1:1",
      minioWatchBucket: "bim-control",
      minioWatchAccessKey: "ak",
      minioWatchSecretKey: "sk",
      minioWatchIntervalSeconds: 10,
      // 測試 seam：避免 watcher 真打外網 intake
      minioWatchSelfBaseUrl: "http://127.0.0.1:1",
      // loopback 守衛 pass path：allowlist 非空但含 127.0.0.1 → 不 fail-fast
      externalIntakeIpAllowlist: ["10.0.0.0/8", "127.0.0.1"],
    });
    const res = await request(app.app).get("/api/external/minio-watch/status");
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(true);
    // status 讀 runtime flag、不讀 config 靜態值；credentials 不得洩漏
    expect(res.body.secret_key).toBeUndefined();
    expect(res.body.access_key).toBeUndefined();
  });
});

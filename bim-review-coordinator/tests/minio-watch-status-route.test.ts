import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createCoordinatorApp, type CoordinatorApp } from "../src/app.js";

let active: CoordinatorApp | null = null;

afterEach(async () => {
  if (active) {
    // dispose 為 async（watcher 存在時 await in-flight tick settle）。必須先 await
    // 完成才 io.close / server.close，與 shutdown.test.ts 不變式一致（dispose 先收斂
    // 再關閉），避免 fire-and-forget 讓 timer/socket 洩漏到下一個測試。
    await active.dispose();
    active.io.close();
    await new Promise<void>((r) => active?.server.close(() => r()));
    active = null;
  }
});

function makeApp(overrides = {}): CoordinatorApp {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "minio-watch-status-test-"));
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

describe("GET /api/external/minio-watch/status", () => {
  it("watcher 關閉（預設）→ enabled=false，不洩漏 credentials", async () => {
    const app = makeApp();
    const res = await request(app.app).get("/api/external/minio-watch/status");
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(false);
    // 誠實：關閉時不偽稱在跑
    expect(JSON.stringify(res.body)).not.toContain("secret");
    expect(JSON.stringify(res.body)).not.toContain("MINIO_WATCH_SECRET");
    expect(res.body.access_key).toBeUndefined();
    expect(res.body.secret_key).toBeUndefined();
  });

  it("watcher 啟用但 endpoint 不可達 → enabled=true 且 status 形狀完整（含 last_error 欄位）", async () => {
    const app = makeApp({
      minioWatchEnabled: true,
      minioWatchEndpoint: "http://127.0.0.1:1",
      minioWatchBucket: "bim-control",
      minioWatchAccessKey: "ak",
      minioWatchSecretKey: "sk",
      minioWatchIntervalSeconds: 10,
      // 測試 seam：避免 watcher 真打外網 intake
      minioWatchSelfBaseUrl: "http://127.0.0.1:1",
    });
    const res = await request(app.app).get("/api/external/minio-watch/status");
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(true);
    expect(res.body.bucket).toBe("bim-control");
    expect(res.body).toHaveProperty("last_poll_at");
    expect(res.body).toHaveProperty("last_error");
    expect(res.body).toHaveProperty("triggered_total");
    expect(res.body).toHaveProperty("skipped_malformed_total");
    // credentials 仍不得出現
    expect(res.body.secret_key).toBeUndefined();
    expect(res.body.access_key).toBeUndefined();
  });
});

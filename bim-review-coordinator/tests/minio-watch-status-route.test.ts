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

  // spec §4.2 誠實 note 回歸鎖：env 從未 opt-in（config.minioWatchEnabled=false）時，
  // note 必須是「env opt-in」字串、不得誤報為「operator runtime 關閉」。此鎖確保
  // Task 2 的 runtime toggle-off 分支（config.minioWatchEnabled=true → 另一句 note）
  // 引入後，env=false 這條基線不被回歸破壞。
  it("env 從未 opt-in（預設）→ note 為 env opt-in 字串，非 runtime override", async () => {
    const app = makeApp();
    const res = await request(app.app).get("/api/external/minio-watch/status");
    expect(res.status).toBe(200);
    expect(res.body.note).toBe("未啟用（env MINIO_WATCH_ENABLED opt-in）");
    expect(String(res.body.note)).not.toContain("操作者");
  });

  it("env opt-in 但 MinIO credentials 未完整設定 → 不啟 watcher，status 誠實回 not configured", async () => {
    const app = makeApp({
      minioWatchEnabled: true,
      minioWatchEndpoint: "http://192.168.20.234:9000",
      minioWatchBucket: "bim-control",
      minioWatchAccessKey: "",
      minioWatchSecretKey: "",
    });
    const res = await request(app.app).get("/api/external/minio-watch/status");
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(false);
    expect(String(res.body.note)).toContain("endpoint/bucket/credentials");
    expect(JSON.stringify(res.body)).not.toContain("secret");
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
      // loopback 守衛 pass path：allowlist 非空但含 127.0.0.1 → 不 fail-fast（與下方
      // 「不含 loopback → throw」測試成對）。
      externalIntakeIpAllowlist: ["10.0.0.0/8", "127.0.0.1"],
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

    // 真正證明 last_error 是「被捕捉到的錯誤」而非僅存在欄位：pollNow 確定性跑完一輪
    // （list 對不可達 127.0.0.1:1 失敗）後同步斷言其值含 ECONNREFUSED。舊版需輪詢
    // status endpoint 等 setTimeout 首輪的競態類別在 pollNow 介面下不存在。
    await app.minioWatchSurface.pollNow();
    const errRes = await request(app.app).get("/api/external/minio-watch/status");
    expect(String(errRes.body.last_error)).toMatch(/ECONNREFUSED/);
    // 即使 tick 失敗，仍不得洩漏 credentials
    expect(errRes.body.secret_key).toBeUndefined();
    expect(errRes.body.access_key).toBeUndefined();
  });

  it("watcher 啟用但 EXTERNAL_INTAKE_IP_ALLOWLIST 不含 loopback → 啟動 fail-fast（防永久 403 靜默空轉）", () => {
    // Codex review P2 鎖定：硬化部署把 allowlist 鎖 edge CIDR 漏掉 loopback 時，watcher
    // 的 self-POST 在 secret 檢查前就被 authProvider 403。127.0.0.1/::1 雙雙不在名單
    // ⇒ 必然永久失敗，啟動即拒而非每輪靜默 403。
    expect(() =>
      makeApp({
        minioWatchEnabled: true,
        minioWatchEndpoint: "http://127.0.0.1:1",
        minioWatchBucket: "bim-control",
        minioWatchAccessKey: "ak",
        minioWatchSecretKey: "sk",
        minioWatchIntervalSeconds: 10,
        minioWatchSelfBaseUrl: "http://127.0.0.1:1", // 立即啟動路徑 → 同步 throw 可被捕捉
        externalIntakeIpAllowlist: ["10.0.0.0/8", "192.168.20.0/24"],
      }),
    ).toThrow(/loopback|127\.0\.0\.1/);
    // throw 時 createCoordinatorApp 未完成、active 未被賦值 → 無需清理。
    // pass path（allowlist 含 loopback / 空 allowlist 不啟檢查）由上方
    // 「watcher 啟用但 endpoint 不可達」測試以自訂 allowlist 覆蓋驗證（單一 app 生命週期，
    // 不在本測試開第二個 app 以免覆蓋 active 洩漏 watcher）。
  });
});

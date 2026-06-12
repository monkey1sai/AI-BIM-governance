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

// 輪詢 status endpoint 直到 predicate 成立（或逾時 throw）。watcher 首輪是
// setTimeout(runTick, 0)，請求可能早於首輪 tick 完成；用此等到 tick 真的跑過、
// 把錯誤寫進 last_error 後再斷言，否則 toHaveProperty 在 last_error 仍為 null 時
// 同樣通過（只驗 key 存在不驗非空值），無法證明錯誤已被 watcher 捕捉。
async function getStatusUntil(
  app: CoordinatorApp,
  predicate: (body: Record<string, unknown>) => boolean,
  ms = 3000,
): Promise<request.Response> {
  const end = Date.now() + ms;
  let last: request.Response | null = null;
  while (Date.now() < end) {
    last = await request(app.app).get("/api/external/minio-watch/status");
    if (predicate(last.body as Record<string, unknown>)) return last;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(
    `getStatusUntil timeout; last body = ${JSON.stringify(last?.body)}`,
  );
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

    // 真正證明 last_error 是「被捕捉到的錯誤」而非僅存在欄位：等到首輪 tick（list
    // 對不可達 127.0.0.1:1）失敗把錯誤寫進 last_error，再斷言其值含 ECONNREFUSED。
    // 不加此輪詢時，請求可能早於 setTimeout(runTick, 0) 完成，last_error 仍為 null，
    // 上面的 toHaveProperty 仍會通過——這正是先前的 test lie。
    const errRes = await getStatusUntil(
      app,
      (body) => body.last_error != null,
    );
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

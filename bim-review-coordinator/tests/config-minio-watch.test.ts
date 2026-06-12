import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const MINIO_KEYS = [
  "MINIO_WATCH_ENABLED",
  "MINIO_WATCH_ENDPOINT",
  "MINIO_WATCH_BUCKET",
  "MINIO_WATCH_PREFIX",
  "MINIO_WATCH_ACCESS_KEY",
  "MINIO_WATCH_SECRET_KEY",
  "MINIO_WATCH_INTERVAL_SECONDS",
  "MINIO_WATCH_INTERVAL_FLOOR_SECONDS",
  "MINIO_WATCH_KEY_SUFFIX",
  "MINIO_WATCH_TENANT_ID",
  "MINIO_WATCH_SELF_BASE_URL",
];

// config.ts 頂層執行 dotenv.config()，vitest 首次 import 即把本地 .env 注入 process.env。
// 只靠 afterEach 不夠：若某台機器的 .env 補了 MINIO_WATCH_*，第一個 case 仍會被污染。
// 每個 case 跑前先 delete 一次，確保每個 case 從乾淨環境自行設值。
beforeEach(() => {
  for (const k of MINIO_KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of MINIO_KEYS) delete process.env[k];
});

describe("loadConfig MinIO watch fields", () => {
  it("預設關閉且欄位有安全預設（不需任何 env）", () => {
    const c = loadConfig();
    expect(c.minioWatchEnabled).toBe(false);
    expect(c.minioWatchEndpoint).toBe("");
    expect(c.minioWatchBucket).toBe("");
    expect(c.minioWatchPrefix).toBe("");
    expect(c.minioWatchAccessKey).toBe("");
    expect(c.minioWatchSecretKey).toBe("");
    expect(c.minioWatchIntervalSeconds).toBe(60);
    expect(c.minioWatchKeySuffix).toBe("/model.ifc");
    expect(c.minioWatchTenantId).toBe("tenant_demo_001"); // 預設維持現行為
    expect(c.minioWatchSelfBaseUrl).toBe("");
  });

  it("env 覆寫被讀入；interval 低於 10 夾為 10", () => {
    process.env.MINIO_WATCH_ENABLED = "true";
    process.env.MINIO_WATCH_ENDPOINT = "http://192.168.20.234:9000";
    process.env.MINIO_WATCH_BUCKET = "bim-control";
    process.env.MINIO_WATCH_PREFIX = "tenant_a/";
    process.env.MINIO_WATCH_ACCESS_KEY = "ak";
    process.env.MINIO_WATCH_SECRET_KEY = "sk";
    process.env.MINIO_WATCH_INTERVAL_SECONDS = "3";
    process.env.MINIO_WATCH_KEY_SUFFIX = "/scene.ifc";
    process.env.MINIO_WATCH_TENANT_ID = "tenant_acme_042";
    const c = loadConfig();
    expect(c.minioWatchEnabled).toBe(true);
    expect(c.minioWatchEndpoint).toBe("http://192.168.20.234:9000");
    expect(c.minioWatchBucket).toBe("bim-control");
    expect(c.minioWatchPrefix).toBe("tenant_a/");
    expect(c.minioWatchAccessKey).toBe("ak");
    expect(c.minioWatchSecretKey).toBe("sk");
    expect(c.minioWatchIntervalSeconds).toBe(10); // 下限夾住
    expect(c.minioWatchKeySuffix).toBe("/scene.ifc");
    expect(c.minioWatchTenantId).toBe("tenant_acme_042");
  });

  it("MINIO_WATCH_INTERVAL_FLOOR_SECONDS 降檔下限：E2E 可設 1s 輪詢（不設＝floor 10 不變）", () => {
    process.env.MINIO_WATCH_INTERVAL_SECONDS = "1";
    process.env.MINIO_WATCH_INTERVAL_FLOOR_SECONDS = "1";
    const c = loadConfig();
    expect(c.minioWatchIntervalSeconds).toBe(1); // floor 被降到 1，1s 輪詢生效

    // floor 仍夾住低於它的 interval：interval=0 但 floor=1 → 夾為 1
    process.env.MINIO_WATCH_INTERVAL_SECONDS = "0";
    process.env.MINIO_WATCH_INTERVAL_FLOOR_SECONDS = "1";
    expect(loadConfig().minioWatchIntervalSeconds).toBe(1);
  });

  it("FLOOR=0 不得讓 interval 降到 0（防 setTimeout(…,0) event-loop 忙迴圈連打 MinIO）", () => {
    // floor 守衛意圖是「防忙迴圈」；FLOOR=0 搭 INTERVAL=0 時，舊 Math.max(0,…) 會讓
    // minioWatchIntervalSeconds=0 → minioWatcher setTimeout(runTick, 0) 每輪 tick 完成立即重排，
    // 形成 Node event-loop 忙迴圈對 ListObjectsV2 不停打請求。下限必須 ≥1s。
    process.env.MINIO_WATCH_INTERVAL_SECONDS = "0";
    process.env.MINIO_WATCH_INTERVAL_FLOOR_SECONDS = "0";
    expect(loadConfig().minioWatchIntervalSeconds).toBeGreaterThanOrEqual(1);
  });

  it("overrides 的 interval 仍被 floor 夾住（floor 經 env 降檔後以降檔值為準）", () => {
    process.env.MINIO_WATCH_INTERVAL_FLOOR_SECONDS = "2";
    // override 給 0.05（整合測試風格），但 env floor=2 → 夾為 2（floor 在 overrides 合併後仍生效）
    expect(loadConfig({ minioWatchIntervalSeconds: 0.05 }).minioWatchIntervalSeconds).toBe(2);
  });

  it("MINIO_WATCH_SELF_BASE_URL env 被讀入 minioWatchSelfBaseUrl（整合測試注入 loopback 的 seam）", () => {
    process.env.MINIO_WATCH_SELF_BASE_URL = "http://127.0.0.1:9999";
    const c = loadConfig();
    expect(c.minioWatchSelfBaseUrl).toBe("http://127.0.0.1:9999");
  });

  it("overrides 直接設值優先於 env 預設", () => {
    const c = loadConfig({ minioWatchEnabled: true, minioWatchBucket: "ov-bucket" });
    expect(c.minioWatchEnabled).toBe(true);
    expect(c.minioWatchBucket).toBe("ov-bucket");
  });
});

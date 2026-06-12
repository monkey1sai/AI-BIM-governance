import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const MINIO_KEYS = [
  "MINIO_WATCH_ENABLED",
  "MINIO_WATCH_ENDPOINT",
  "MINIO_WATCH_BUCKET",
  "MINIO_WATCH_PREFIX",
  "MINIO_WATCH_ACCESS_KEY",
  "MINIO_WATCH_SECRET_KEY",
  "MINIO_WATCH_INTERVAL_SECONDS",
  "MINIO_WATCH_KEY_SUFFIX",
  "MINIO_WATCH_SELF_BASE_URL",
];

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
    const c = loadConfig();
    expect(c.minioWatchEnabled).toBe(true);
    expect(c.minioWatchEndpoint).toBe("http://192.168.20.234:9000");
    expect(c.minioWatchBucket).toBe("bim-control");
    expect(c.minioWatchPrefix).toBe("tenant_a/");
    expect(c.minioWatchAccessKey).toBe("ak");
    expect(c.minioWatchSecretKey).toBe("sk");
    expect(c.minioWatchIntervalSeconds).toBe(10); // 下限夾住
    expect(c.minioWatchKeySuffix).toBe("/scene.ifc");
  });

  it("overrides 直接設值優先於 env 預設", () => {
    const c = loadConfig({ minioWatchEnabled: true, minioWatchBucket: "ov-bucket" });
    expect(c.minioWatchEnabled).toBe(true);
    expect(c.minioWatchBucket).toBe("ov-bucket");
  });
});

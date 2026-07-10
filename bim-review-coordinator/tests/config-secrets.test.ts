// F2（2026-07-10）：預設機密是原始碼常數（dev-token / dev-internal-token / dev-webhook-secret）——
// production 漏設 env 會靜默回退已知字串。本檔鎖定：NODE_ENV=production 且任一機密仍為
// 已知預設值 → loadConfig fail-fast（訊息列出缺的 env 名）；dev 模式維持原預設行為。
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const SAVED = ["NODE_ENV", "DEV_AUTH_TOKEN", "INTERNAL_API_AUTH_TOKEN", "EXTERNAL_INTAKE_WEBHOOK_SECRET"] as const;
const original: Record<string, string | undefined> = {};
for (const k of SAVED) original[k] = process.env[k];

afterEach(() => {
  for (const k of SAVED) {
    if (original[k] === undefined) delete process.env[k];
    else process.env[k] = original[k];
  }
});

describe("production 預設機密 fail-fast（F2）", () => {
  it("NODE_ENV=production 且機密未設 → throw 並列出 env 名", () => {
    process.env.NODE_ENV = "production";
    delete process.env.DEV_AUTH_TOKEN;
    delete process.env.INTERNAL_API_AUTH_TOKEN;
    delete process.env.EXTERNAL_INTAKE_WEBHOOK_SECRET;
    expect(() => loadConfig()).toThrow(/DEV_AUTH_TOKEN.*INTERNAL_API_AUTH_TOKEN.*EXTERNAL_INTAKE_WEBHOOK_SECRET/s);
  });

  it("NODE_ENV=production 且三機密皆自訂 → 正常載入", () => {
    process.env.NODE_ENV = "production";
    process.env.DEV_AUTH_TOKEN = "real-op-token";
    process.env.INTERNAL_API_AUTH_TOKEN = "real-internal-token";
    process.env.EXTERNAL_INTAKE_WEBHOOK_SECRET = "real-webhook-secret";
    expect(loadConfig().devAuthToken).toBe("real-op-token");
  });

  it("dev（NODE_ENV 未設）→ 沿用預設不 throw（現行行為不變）", () => {
    delete process.env.NODE_ENV;
    delete process.env.DEV_AUTH_TOKEN;
    expect(loadConfig().devAuthToken).toBe("dev-token");
  });
});

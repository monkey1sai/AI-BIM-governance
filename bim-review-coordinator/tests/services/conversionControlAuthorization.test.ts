import { describe, expect, it } from "vitest";
import {
  isOperatorTokenPathEnabled,
  OPERATOR_TOKEN_RATE_LIMIT,
  OPERATOR_TOKEN_RATE_WINDOW_MS,
  SlidingWindowRateLimiter,
} from "../../src/services/conversionControlAuthorization.js";

// unified-console-runtime-truth slice 2 task 4.2（D2=T4）：token 路徑判定與速率限制的純單元。
// guard 本體（IP allowlist 或 token）的 HTTP 契約由 tests/conversion-control-auth.test.ts 以 supertest 驗。

describe("isOperatorTokenPathEnabled", () => {
  it("預設 dev-token 與空字串視為未啟用（fail-closed：公開預設值不得成為授權）", () => {
    expect(isOperatorTokenPathEnabled("dev-token")).toBe(false);
    expect(isOperatorTokenPathEnabled("")).toBe(false);
  });
  it("非預設值視為啟用", () => {
    expect(isOperatorTokenPathEnabled("operator-secret")).toBe(true);
  });
});

describe("SlidingWindowRateLimiter（每 key 每 60s 10 次）", () => {
  it("常數：limit 10、window 60_000ms", () => {
    expect(OPERATOR_TOKEN_RATE_LIMIT).toBe(10);
    expect(OPERATOR_TOKEN_RATE_WINDOW_MS).toBe(60_000);
  });

  it("同 key 第 11 次拒絕並回 Retry-After 秒數；時間推進後 Retry-After 遞減；窗過後放行", () => {
    let now = 1_000_000;
    const limiter = new SlidingWindowRateLimiter(OPERATOR_TOKEN_RATE_LIMIT, OPERATOR_TOKEN_RATE_WINDOW_MS, () => now);
    for (let i = 0; i < 10; i += 1) expect(limiter.hit("ip-a")).toEqual({ allowed: true, retryAfterSeconds: 0 });
    expect(limiter.hit("ip-a")).toEqual({ allowed: false, retryAfterSeconds: 60 });
    now += 30_000;
    expect(limiter.hit("ip-a")).toEqual({ allowed: false, retryAfterSeconds: 30 });
    now += 30_001;
    expect(limiter.hit("ip-a").allowed).toBe(true);
  });

  it("不同 key 各自計數", () => {
    const limiter = new SlidingWindowRateLimiter(1, 60_000, () => 0);
    expect(limiter.hit("a").allowed).toBe(true);
    expect(limiter.hit("b").allowed).toBe(true);
    expect(limiter.hit("a").allowed).toBe(false);
  });

  it("被拒絕的嘗試不延長視窗（拒絕不寫入 hit）", () => {
    let now = 0;
    const limiter = new SlidingWindowRateLimiter(2, 1_000, () => now);
    limiter.hit("k"); limiter.hit("k");
    now = 500;
    expect(limiter.hit("k").allowed).toBe(false);
    now = 1_001;
    expect(limiter.hit("k").allowed).toBe(true);
  });
});

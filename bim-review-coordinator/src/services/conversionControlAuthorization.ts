import type express from "express";

// unified-console-runtime-truth slice 2（owner D2 裁決＝T4，2026-08-25）：四條 /api/conversion/* 控制路由的
// per-route 授權 wrapper 所需的純邏輯。app.ts 只負責把 config／isIpAllowed／isKitMutationAuthorized 注入。
// 不新增生產依賴：滑動視窗以 Map<string, number[]> 記錄每來源 IP 的命中時間戳（in-memory，process 生命週期）。

/** 每來源 IP 每分鐘允許的 token 路徑請求數（owner 裁決 N=10）。 */
export const OPERATOR_TOKEN_RATE_LIMIT = 10;
export const OPERATOR_TOKEN_RATE_WINDOW_MS = 60_000;

/** config.ts 的預設值（DEV_AUTH_TOKEN 未設時）。與 config.ts:452／:566 的字面同步；預設值＝token 路徑未啟用。 */
const DEFAULT_DEV_AUTH_TOKEN = "dev-token";

/** token 路徑只在 devAuthToken 為非空且非原始碼預設值時啟用（fail-closed：公開預設值不得變成授權）。 */
export function isOperatorTokenPathEnabled(devAuthToken: string): boolean {
  return devAuthToken.length > 0 && devAuthToken !== DEFAULT_DEV_AUTH_TOKEN;
}

export interface RateLimitDecision {
  allowed: boolean;
  /** 被拒時距離最舊一筆命中離開視窗的秒數（ceil，至少 1）；放行時 0。 */
  retryAfterSeconds: number;
}

export class SlidingWindowRateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  hit(key: string): RateLimitDecision {
    const at = this.now();
    const floor = at - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((stamp) => stamp > floor);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((recent[0] + this.windowMs - at) / 1000)) };
    }
    recent.push(at);
    this.hits.set(key, recent);
    if (this.hits.size > 1024) this.sweep(floor);
    return { allowed: true, retryAfterSeconds: 0 };
  }

  /** 防止大量來源 IP 讓 Map 無界成長：只在 key 數超過門檻時清掉整個視窗都過期的 key。 */
  private sweep(floor: number): void {
    for (const [key, stamps] of this.hits) {
      const kept = stamps.filter((stamp) => stamp > floor);
      if (kept.length === 0) this.hits.delete(key);
      else this.hits.set(key, kept);
    }
  }
}

export interface ConversionControlGuardDeps {
  /** 與 rejectIfIpNotAllowed 同一判定（空 allowlist＝未啟用 IP 守門＝全放行）。 */
  isCallerIpAllowed: (clientIp: string) => boolean;
  operatorTokenPathEnabled: () => boolean;
  /** 沿用 isKitMutationAuthorized（x-dev-token 或 x-operator-token 與 config.devAuthToken 嚴格相等）。 */
  isOperatorTokenValid: (request: express.Request) => boolean;
  rateLimiter: SlidingWindowRateLimiter;
}

export type ConversionControlGuard = (request: express.Request, response: express.Response) => boolean;

/**
 * 回傳與 rejectIfIpNotAllowed 同型的守門函式：回 true 表示已寫回應並終止。
 * 順序：IP 允許 → 放行（逐字沿用 allowlist 路徑，不計速率）；否則
 *   token 路徑未啟用 → 403 逐字 `caller ip not in allowlist`；
 *   無 token header → 403 逐字（不計速率：沒嘗試 token 路徑）；
 *   速率超額 → 429 + Retry-After；
 *   token 不符 → 403 `operator token invalid (x-operator-token)`；
 *   否則放行。
 */
export function createConversionControlGuard(deps: ConversionControlGuardDeps): ConversionControlGuard {
  return function rejectIfConversionControlUnauthorized(request: express.Request, response: express.Response): boolean {
    const clientIp = request.ip || request.socket.remoteAddress || "";
    if (deps.isCallerIpAllowed(clientIp)) return false;
    const tokenHeaderPresent = Boolean(request.header("x-operator-token") || request.header("x-dev-token"));
    if (!deps.operatorTokenPathEnabled() || !tokenHeaderPresent) {
      response.status(403).json({ detail: "caller ip not in allowlist" });
      return true;
    }
    const decision = deps.rateLimiter.hit(clientIp || "unknown");
    if (!decision.allowed) {
      response.setHeader("Retry-After", String(decision.retryAfterSeconds));
      response.status(429).json({ detail: "operator token rate limit exceeded (10 requests per minute per source ip)" });
      return true;
    }
    if (!deps.isOperatorTokenValid(request)) {
      response.status(403).json({ detail: "operator token invalid (x-operator-token)" });
      return true;
    }
    return false;
  };
}

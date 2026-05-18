import crypto from "node:crypto";
import type { CoordinatorConfig } from "../config.js";

/**
 * B-scheme（local-coordinator-ifc-ready-intake-boundary T3 §4.2）。
 *
 * 對外 IFC-ready intake 以「可替換的 AuthProvider」做 machine-to-machine 驗證，
 * 不綁死使用者 SSO。初始 `intranet-dev` provider = IP allowlist + 共享密鑰
 * （或 HMAC 簽章），並要求 correlation_id / idempotency_key /
 * tenant_id / project_id / external_model_version_id。
 *
 * 未來新增 `sso-token-introspection` / `machine-token` / `mTLS` 時，
 * 只需實作同一 `AuthProvider` 介面，對外契約與既有 caller 不需重設計。
 */

export interface AuthRequest {
  clientIp: string;
  headers: Record<string, string | undefined>;
  /** 原始 request body（用於 HMAC 簽章驗證），不可由 parsed JSON 重組 */
  rawBody: string;
  payloadIdentity: {
    tenant_id?: unknown;
    project_id?: unknown;
    external_model_version_id?: unknown;
  };
}

export interface AuthContext {
  provider: string;
  correlationId: string;
  idempotencyKey: string;
  tenantId: string;
  projectId: string;
  externalModelVersionId: string;
}

export class AuthError extends Error {
  constructor(
    public readonly statusCode: 401 | 403,
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export interface AuthProvider {
  readonly name: string;
  authenticate(request: AuthRequest): AuthContext;
}

function requiredHeader(headers: Record<string, string | undefined>, name: string): string {
  const value = headers[name.toLowerCase()];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new AuthError(401, `missing required header: ${name}`);
  }
  return value.trim();
}

function requiredIdentity(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new AuthError(401, `missing required identity: ${field}`);
  }
  return value.trim();
}

function timingSafeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function normalizeIp(ip: string): string {
  // Express may report IPv4-mapped IPv6 (::ffff:127.0.0.1) or bare IPv6.
  return ip.replace(/^::ffff:/, "");
}

function ipv4ToInt(ip: string): number | null {
  const parts = normalizeIp(ip).split(".");
  if (parts.length !== 4) return null;
  const bytes = parts.map((part) => Number.parseInt(part, 10));
  if (bytes.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }
  return (((bytes[0] * 2 ** 24) + (bytes[1] * 2 ** 16) + (bytes[2] * 2 ** 8) + bytes[3]) >>> 0);
}

function cidrContains(cidr: string, ip: string): boolean {
  const [base, prefixText] = cidr.split("/");
  const prefix = Number.parseInt(prefixText || "", 10);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false;
  const baseInt = ipv4ToInt(base);
  const ipInt = ipv4ToInt(ip);
  if (baseInt === null || ipInt === null) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (baseInt & mask) === (ipInt & mask);
}

function isIpAllowed(clientIp: string, allowlist: string[]): boolean {
  const normalized = normalizeIp(clientIp || "");
  return allowlist.some((entry) => {
    const rule = entry.trim();
    if (rule.length === 0) return false;
    if (rule.includes("/")) return cidrContains(rule, normalized);
    return normalizeIp(rule) === normalized;
  });
}

/**
 * intranet-dev：IP allowlist + `X-Webhook-Secret`（共享密鑰）或
 * `X-Webhook-Signature`（HMAC-SHA256(rawBody, secret)）二擇一。
 */
export class IntranetDevAuthProvider implements AuthProvider {
  readonly name = "intranet-dev";

  constructor(
    private readonly webhookSecret: string,
    private readonly ipAllowlist: string[],
  ) {}

  authenticate(request: AuthRequest): AuthContext {
    const clientIp = normalizeIp(request.clientIp || "");
    if (this.ipAllowlist.length > 0 && !isIpAllowed(clientIp, this.ipAllowlist)) {
      throw new AuthError(403, `caller ip not in allowlist: ${clientIp || "unknown"}`);
    }

    const signature = request.headers["x-webhook-signature"];
    const sharedSecret = request.headers["x-webhook-secret"];
    if (typeof signature === "string" && signature.trim().length > 0) {
      const expected = crypto
        .createHmac("sha256", this.webhookSecret)
        .update(request.rawBody)
        .digest("hex");
      if (!timingSafeEqual(signature.trim(), expected)) {
        throw new AuthError(401, "invalid X-Webhook-Signature");
      }
    } else if (typeof sharedSecret === "string" && sharedSecret.trim().length > 0) {
      if (!timingSafeEqual(sharedSecret.trim(), this.webhookSecret)) {
        throw new AuthError(401, "invalid X-Webhook-Secret");
      }
    } else {
      throw new AuthError(401, "missing X-Webhook-Secret or X-Webhook-Signature");
    }

    const correlationId = requiredHeader(request.headers, "X-Correlation-Id");
    const idempotencyKey = requiredHeader(request.headers, "X-Idempotency-Key");
    const tenantId = requiredIdentity(request.payloadIdentity.tenant_id, "tenant_id");
    const projectId = requiredIdentity(request.payloadIdentity.project_id, "project_id");
    const externalModelVersionId = requiredIdentity(
      request.payloadIdentity.external_model_version_id,
      "external_model_version_id",
    );

    return {
      provider: this.name,
      correlationId,
      idempotencyKey,
      tenantId,
      projectId,
      externalModelVersionId,
    };
  }
}

export function createAuthProvider(config: CoordinatorConfig): AuthProvider {
  switch (config.externalIntakeAuthProvider) {
    case "intranet-dev":
      return new IntranetDevAuthProvider(
        config.externalIntakeWebhookSecret,
        config.externalIntakeIpAllowlist,
      );
    default:
      throw new Error(`Unsupported EXTERNAL_INTAKE_AUTH_PROVIDER: ${config.externalIntakeAuthProvider}`);
  }
}

/**
 * B-scheme T7 §8.2：**使用者** auth（browser / local web view），與 §T3 的
 * machine-to-machine Service auth 分開。現階段用可替換 provider，**不做死
 * EZPLUS SSO**；未來 `sso-token-introspection` 同介面替換，local web view ↔
 * 公司 SSO 真實銜接待 OQ5（§8.3）。
 */
export interface UserAuthContext {
  provider: string;
  userId: string;
  ssoBinding: "pending_oq5" | "bound";
}

export interface UserAuthProvider {
  readonly name: string;
  authenticate(request: { headers: Record<string, string | undefined> }): UserAuthContext;
}

/**
 * local-dev：接受 `Authorization: Bearer <token>` 或 `X-User-Token` 任一非空
 * 作為開發使用者；不驗證真實 SSO（OQ5 待外部平台確認）。介面化讓未來換成
 * SSO introspection 不需改 local web view 契約。
 */
export class LocalDevUserAuthProvider implements UserAuthProvider {
  readonly name = "local-dev";

  authenticate(request: { headers: Record<string, string | undefined> }): UserAuthContext {
    const bearer = request.headers["authorization"];
    const userToken = request.headers["x-user-token"];
    let token = "";
    if (typeof bearer === "string" && bearer.toLowerCase().startsWith("bearer ")) {
      token = bearer.slice(7).trim();
    } else if (typeof userToken === "string") {
      token = userToken.trim();
    }
    if (token.length === 0) {
      throw new AuthError(401, "missing user token (Authorization: Bearer / X-User-Token)");
    }
    // 開發階段：token 即視為 user id。真實 SSO introspection 為 OQ5。
    return { provider: this.name, userId: token, ssoBinding: "pending_oq5" };
  }
}

export function createUserAuthProvider(config: CoordinatorConfig): UserAuthProvider {
  switch (config.userAuthProvider) {
    case "local-dev":
      return new LocalDevUserAuthProvider();
    default:
      throw new Error(`Unsupported USER_AUTH_PROVIDER: ${config.userAuthProvider}`);
  }
}

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
  /** 原始 request body（用於 HMAC 簽章驗證），已序列化字串 */
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
    const allowed = this.ipAllowlist.map(normalizeIp);
    if (allowed.length > 0 && !allowed.includes(clientIp)) {
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
    default:
      return new IntranetDevAuthProvider(
        config.externalIntakeWebhookSecret,
        config.externalIntakeIpAllowlist,
      );
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
    default:
      return new LocalDevUserAuthProvider();
  }
}

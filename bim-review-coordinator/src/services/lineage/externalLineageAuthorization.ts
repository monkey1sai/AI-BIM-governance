// External control-plane authorization seam for governed lineage mutations.
//
// This module deliberately contains no local RBAC table, JWT/JWKS parser, shared-secret
// fallback, or cached decision. The external control plane owns capability decisions; a
// deployment adapter must authenticate the request principal and verify the opaque decision
// against the exact request binding. Until such an adapter is supplied, routes fail closed.

import { isUtcTimestamp, utcTimestampToMicros } from "./minioLocator.js";

export const EXTERNAL_LINEAGE_DECISION_HEADER = "x-lineage-authorization-decision";
export const EXTERNAL_LINEAGE_CREDENTIAL_HEADER_MAX_LENGTH = 16_384;
export const EXTERNAL_LINEAGE_DECISION_HEADER_MAX_LENGTH = 65_536;

export type LineageCapability =
  | "bundle.read"
  | "bundle.publish"
  | "artifact.download"
  | "alignment.read"
  | "result.compare"
  | "result.promote"
  | "result.rollback";

export interface ExternalLineagePrincipal {
  subject: string;
  actor_kind: "operator" | "service_account";
  /** Redacted provenance reference only; never a bearer/session credential. */
  authentication_ref: string;
}

export interface ExternalLineageRequestContext {
  method: string;
  path: string;
  remote_address: string | null;
  /** Raw caller credential. Only the injected adapter may inspect it; routes never persist/log it. */
  authorization: string | null;
  /** Optional sender-constraining proof. Only the injected adapter may inspect it. */
  dpop: string | null;
}

export type ExternalLineageResourceBinding =
  | {
      kind: "result_compare";
      pipeline_job_id: string;
      /** Canonical lexical order prevents left/right token substitution. */
      result_ids: [string, string];
    }
  | {
      /** Pre-authorization before the server creates the nonce-bound confirm intent. */
      kind: "result_activation_intent";
      pipeline_job_id: string;
      target_result_id: string;
      expected_active_result_id: string;
      transition: "promote" | "rollback";
      correlation_id: string;
    }
  | {
      kind: "result_activation_confirm";
      intent_id: string;
      intent_nonce_sha256: string;
      pipeline_job_id: string;
      target_result_id: string;
      expected_active_result_id: string;
      transition: "promote" | "rollback";
      correlation_id: string;
    }
  | {
      kind: "pipeline_job_results";
      pipeline_job_id: string;
    }
  | {
      kind: "pipeline_result";
      pipeline_job_id: string;
      result_id: string;
    }
  | {
      kind: "pipeline_job_audit";
      pipeline_job_id: string;
    }
  | {
      kind: "legacy_bundle_enrollment";
      grouping_key: string;
    }
  | {
      kind: "artifact_download";
      pipeline_job_id: string;
      result_id: string;
      artifact_id: string;
    };

export interface ExpectedExternalLineageDecision {
  capability: LineageCapability;
  principal_subject: string;
  method: string;
  path: string;
  resource: ExternalLineageResourceBinding;
}

export interface VerifiedExternalLineageDecision {
  authorization_decision_ref: string;
  issuer: string;
  audience: string;
  subject: string;
  capability: LineageCapability;
  /** Raw issuer id is handed directly to the store, which persists only a domain-separated hash. */
  jti: string;
  issued_at: string;
  not_before: string;
  expires_at: string;
  verified_at: string;
}

export interface ExternalLineageAuthorizationPort {
  resolvePrincipal(input: {
    request: ExternalLineageRequestContext;
    now: string;
  }): Promise<ExternalLineagePrincipal>;

  verifyDecision(input: {
    opaque_decision: string;
    request: ExternalLineageRequestContext;
    expected: ExpectedExternalLineageDecision;
    principal: ExternalLineagePrincipal;
    now: string;
  }): Promise<VerifiedExternalLineageDecision>;
}

export class LineageAuthorizationUnavailableError extends Error {
  readonly code = "authorization_unavailable";
  readonly httpStatus = 503;

  constructor(detail = "external lineage authorization verifier is unavailable") {
    super(detail);
    this.name = "LineageAuthorizationUnavailableError";
  }
}

export class LineageAuthorizationDeniedError extends Error {
  readonly code = "stale_or_missing_authorization_decision";
  readonly httpStatus = 403;

  constructor(detail = "external lineage authorization decision was denied") {
    super(detail);
    this.name = "LineageAuthorizationDeniedError";
  }
}

function isCanonicalBoundedString(value: unknown, maxLength = 500): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    value === value.trim() &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

export type ExternalLineageSensitiveHeaderName =
  | "authorization"
  | "dpop"
  | typeof EXTERNAL_LINEAGE_DECISION_HEADER;

/**
 * Extract one security-sensitive HTTP header without relying on Node's duplicate-header merge.
 * Callers pass rawHeaders plus the framework fallback so this helper remains Express-independent.
 */
export function readSingleExternalLineageHeader(input: {
  raw_headers: readonly string[];
  header_name: ExternalLineageSensitiveHeaderName;
  fallback: string | null;
}): string | null {
  const expectedName = input.header_name.toLowerCase();
  const maxLength =
    expectedName === EXTERNAL_LINEAGE_DECISION_HEADER
      ? EXTERNAL_LINEAGE_DECISION_HEADER_MAX_LENGTH
      : EXTERNAL_LINEAGE_CREDENTIAL_HEADER_MAX_LENGTH;
  let count = 0;
  let rawValue: string | null = null;
  for (let index = 0; index + 1 < input.raw_headers.length; index += 2) {
    if (input.raw_headers[index].toLowerCase() !== expectedName) continue;
    count += 1;
    rawValue = input.raw_headers[index + 1];
  }
  if (count > 1) {
    throw new LineageAuthorizationDeniedError("security-sensitive header must be singular");
  }
  const value = count === 1 ? rawValue : input.fallback;
  if (value === null) return null;
  if (!isCanonicalBoundedString(value, maxLength)) {
    throw new LineageAuthorizationDeniedError("security-sensitive header is not canonical");
  }
  return value;
}

/**
 * Defense-in-depth validation for the normalized output of the external verifier.
 * Signature, issuer/audience allowlists, sender binding and exact request binding remain the
 * adapter's responsibility; routes re-check the claims that can be verified locally.
 */
export function assertNormalizedExternalLineageDecision(
  verified: VerifiedExternalLineageDecision,
  input: {
    principal: ExternalLineagePrincipal;
    expected: ExpectedExternalLineageDecision;
    now: string;
  },
): void {
  if (
    verified.subject !== input.principal.subject ||
    verified.subject !== input.expected.principal_subject ||
    input.expected.principal_subject !== input.principal.subject ||
    verified.capability !== input.expected.capability ||
    !isCanonicalBoundedString(verified.authorization_decision_ref) ||
    !isCanonicalBoundedString(verified.issuer) ||
    !isCanonicalBoundedString(verified.audience) ||
    !isCanonicalBoundedString(verified.jti) ||
    !isUtcTimestamp(verified.issued_at) ||
    !isUtcTimestamp(verified.not_before) ||
    !isUtcTimestamp(verified.expires_at) ||
    !isUtcTimestamp(verified.verified_at) ||
    !isUtcTimestamp(input.now) ||
    verified.verified_at !== input.now
  ) {
    throw new LineageAuthorizationDeniedError("verified decision binding or validity mismatch");
  }
  const issuedAt = utcTimestampToMicros(verified.issued_at);
  const notBefore = utcTimestampToMicros(verified.not_before);
  const expiresAt = utcTimestampToMicros(verified.expires_at);
  const now = utcTimestampToMicros(input.now);
  if (issuedAt > now || notBefore > now || expiresAt <= now) {
    throw new LineageAuthorizationDeniedError("verified decision binding or validity mismatch");
  }
}

export async function resolveExternalLineagePrincipal(input: {
  authorization: ExternalLineageAuthorizationPort | null;
  request: ExternalLineageRequestContext;
  now: string;
}): Promise<ExternalLineagePrincipal> {
  if (!input.authorization) throw new LineageAuthorizationUnavailableError();
  let principal: ExternalLineagePrincipal;
  try {
    principal = await input.authorization.resolvePrincipal({
      request: input.request,
      now: input.now,
    });
  } catch (error) {
    if (
      error instanceof LineageAuthorizationDeniedError ||
      error instanceof LineageAuthorizationUnavailableError
    ) {
      throw error;
    }
    throw new LineageAuthorizationUnavailableError();
  }
  if (
    !isCanonicalBoundedString(principal.subject, 200) ||
    (principal.actor_kind !== "operator" && principal.actor_kind !== "service_account") ||
    !isCanonicalBoundedString(principal.authentication_ref, 500)
  ) {
    throw new LineageAuthorizationDeniedError("request principal is not verifiable");
  }
  return principal;
}

export async function verifyExternalLineageDecision(input: {
  authorization: ExternalLineageAuthorizationPort | null;
  request: ExternalLineageRequestContext;
  opaque_decision: string | null;
  principal: ExternalLineagePrincipal;
  expected: ExpectedExternalLineageDecision;
  now: string;
}): Promise<VerifiedExternalLineageDecision> {
  if (!input.authorization) throw new LineageAuthorizationUnavailableError();
  if (!isCanonicalBoundedString(input.opaque_decision, EXTERNAL_LINEAGE_DECISION_HEADER_MAX_LENGTH)) {
    throw new LineageAuthorizationDeniedError();
  }
  let verified: VerifiedExternalLineageDecision;
  try {
    verified = await input.authorization.verifyDecision({
      opaque_decision: input.opaque_decision,
      request: input.request,
      expected: input.expected,
      principal: input.principal,
      now: input.now,
    });
  } catch (error) {
    if (
      error instanceof LineageAuthorizationDeniedError ||
      error instanceof LineageAuthorizationUnavailableError
    ) {
      throw error;
    }
    throw new LineageAuthorizationUnavailableError();
  }
  assertNormalizedExternalLineageDecision(verified, {
    principal: input.principal,
    expected: input.expected,
    now: input.now,
  });
  return verified;
}

import { describe, expect, it } from "vitest";
import {
  LineageAuthorizationDeniedError,
  LineageAuthorizationUnavailableError,
  readSingleExternalLineageHeader,
  resolveExternalLineagePrincipal,
  verifyExternalLineageDecision,
  type ExpectedExternalLineageDecision,
  type ExternalLineageAuthorizationPort,
  type ExternalLineagePrincipal,
  type ExternalLineageRequestContext,
  type VerifiedExternalLineageDecision,
} from "../../src/services/lineage/externalLineageAuthorization.js";

const NOW = "2026-07-16T08:51:00.000001Z";
const REQUEST: ExternalLineageRequestContext = {
  method: "POST",
  path: "/api/lineage/legacy-unmanaged/confirm",
  remote_address: "127.0.0.1",
  authorization: "Bearer opaque-test-value",
  dpop: null,
};
const PRINCIPAL: ExternalLineagePrincipal = {
  subject: "operator-test-01",
  actor_kind: "operator",
  authentication_ref: "principal-ref-test-01",
};
const EXPECTED: ExpectedExternalLineageDecision = {
  capability: "bundle.publish",
  principal_subject: PRINCIPAL.subject,
  method: "POST",
  path: REQUEST.path,
  resource: { kind: "legacy_bundle_enrollment", grouping_key: "tenant-a/legacy" },
};

function decision(overrides: Partial<VerifiedExternalLineageDecision> = {}) {
  return {
    authorization_decision_ref: "decision-ref-test-01",
    issuer: "https://control-plane.test/",
    audience: "urn:ai-bim:edge-lineage",
    subject: PRINCIPAL.subject,
    capability: EXPECTED.capability,
    jti: "jti-test-01",
    issued_at: "2026-07-16T08:51:00.000000Z",
    not_before: "2026-07-16T08:51:00.000000Z",
    expires_at: "2026-07-16T08:52:00.000000Z",
    verified_at: NOW,
    ...overrides,
  } satisfies VerifiedExternalLineageDecision;
}

function port(input: {
  principal?: ExternalLineagePrincipal;
  decision?: VerifiedExternalLineageDecision;
  resolveError?: Error;
  verifyError?: Error;
} = {}): ExternalLineageAuthorizationPort {
  return {
    async resolvePrincipal() {
      if (input.resolveError) throw input.resolveError;
      return input.principal ?? PRINCIPAL;
    },
    async verifyDecision() {
      if (input.verifyError) throw input.verifyError;
      return input.decision ?? decision();
    },
  };
}

describe("external lineage authorization boundary", () => {
  it("accepts one canonical sensitive header and rejects duplicate or ambiguous values", () => {
    expect(
      readSingleExternalLineageHeader({
        raw_headers: ["Authorization", "Bearer opaque-test-value"],
        header_name: "authorization",
        fallback: "framework-fallback-must-not-win",
      }),
    ).toBe("Bearer opaque-test-value");
    expect(() =>
      readSingleExternalLineageHeader({
        raw_headers: ["DPoP", "proof-1", "dpop", "proof-2"],
        header_name: "dpop",
        fallback: "proof-1, proof-2",
      }),
    ).toThrow(LineageAuthorizationDeniedError);
    expect(() =>
      readSingleExternalLineageHeader({
        raw_headers: [],
        header_name: "authorization",
        fallback: " Bearer ambiguous",
      }),
    ).toThrow(LineageAuthorizationDeniedError);
    expect(() =>
      readSingleExternalLineageHeader({
        raw_headers: [],
        header_name: "x-lineage-authorization-decision",
        fallback: "x".repeat(65_537),
      }),
    ).toThrow(LineageAuthorizationDeniedError);
  });

  it("maps unclassified adapter failures to generic unavailable", async () => {
    await expect(
      resolveExternalLineagePrincipal({
        authorization: port({ resolveError: new Error("transport detail must not escape") }),
        request: REQUEST,
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(LineageAuthorizationUnavailableError);
    await expect(
      verifyExternalLineageDecision({
        authorization: port({ verifyError: new Error("timeout detail must not escape") }),
        request: REQUEST,
        opaque_decision: "opaque-decision",
        principal: PRINCIPAL,
        expected: EXPECTED,
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(LineageAuthorizationUnavailableError);
  });

  it.each([
    ["leading whitespace", " operator-test-01"],
    ["trailing whitespace", "operator-test-01 "],
    ["control character", "operator-test-01\u0000"],
  ])("rejects a non-canonical principal subject (%s)", async (_name, subject) => {
    await expect(
      resolveExternalLineagePrincipal({
        authorization: port({ principal: { ...PRINCIPAL, subject } }),
        request: REQUEST,
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(LineageAuthorizationDeniedError);
  });

  it.each([
    ["jti leading whitespace", { jti: " jti-test-01" }],
    ["decision ref trailing whitespace", { authorization_decision_ref: "decision-ref-test-01 " }],
    ["issuer control character", { issuer: "https://control-plane.test/\u007f" }],
    ["wrong capability", { capability: "bundle.read" as "bundle.publish" }],
    ["expired by one microsecond", { expires_at: "2026-07-16T08:51:00.000000Z" }],
  ])("rejects invalid normalized claims (%s)", async (_name, overrides) => {
    await expect(
      verifyExternalLineageDecision({
        authorization: port({ decision: decision(overrides) }),
        request: REQUEST,
        opaque_decision: "opaque-decision",
        principal: PRINCIPAL,
        expected: EXPECTED,
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(LineageAuthorizationDeniedError);
  });
});

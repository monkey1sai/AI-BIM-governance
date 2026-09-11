import { describe, expect, it } from "vitest";
import type { ReadyRenderBundle } from "../src/types.js";
import { parseReadyReviewIntent, identifyReadyReviewRequest, readyReviewSourceSnapshot, fingerprintReadyReviewSource } from "../src/services/readyReviewIntent.js";

const bundle: ReadyRenderBundle = {
  readyModelId: "mw_0123456789abcdef", conversionJobId: "stream_conv_fixture",
  correlationId: "correlation_fixture", rootTraceId: "ifcready_fixture",
  tenantId: "tenant-test", projectId: "project-test", modelVersionId: "v1",
  model: { url: "https://fixture.invalid/artifacts/stream_conv_fixture/model.usdc", sha256: "a".repeat(64) },
  mapping: { url: "https://fixture.invalid/artifacts/stream_conv_fixture/element_mapping.json", sha256: "b".repeat(64) },
};
const identify = (value: ReadyRenderBundle, key = "request-1") => identifyReadyReviewRequest(value, key);

describe("ready review intent contract", () => {
it("uses the same source fingerprint for durable snapshots and request identity", () => {
  const snapshot = readyReviewSourceSnapshot(bundle);
  expect(fingerprintReadyReviewSource(snapshot)).toBe(identifyReadyReviewRequest(bundle, "parity").fingerprint);
  const changed = {...snapshot, model: {...snapshot.model, sha256: "c".repeat(64)}};
  expect(fingerprintReadyReviewSource(changed)).not.toBe(fingerprintReadyReviewSource(snapshot));
  expect(snapshot).not.toHaveProperty("qualitySummary");
});

  it("accepts the maximum request ID length without normalizing it", () => {
    const request_id = "x".repeat(128);
    expect(parseReadyReviewIntent({ mode: "create_new", request_id }))
      .toEqual({ mode: "create_new", request_id });
  });
  it.each(["request-1\n", "request-1\r", " request-1", "", "x".repeat(129)])(
    "rejects invalid identity keys %j", (key) => {
      expect(() => identify(bundle, key)).toThrow();
      expect(() => parseReadyReviewIntent({ mode: "create_new", request_id: key })).toThrow();
    },
  );
  it("rejects non-JSON empty objects and session IDs with trailing whitespace", () => {
    expect(() => parseReadyReviewIntent(new Date())).toThrow();
    expect(() => parseReadyReviewIntent({ mode: "open_existing", session_id: "review_session_one\n" })).toThrow();
  });
  it.each([
    { ...bundle, mapping: { ...bundle.mapping, sha256: "d".repeat(64) } },
    { ...bundle, model: { ...bundle.model, url: "https://fixture.invalid/other/model.usdc" } },
    { ...bundle, rootTraceId: "another-root" },
  ])("detects source changes without changing the request scope", (changed) => {
    expect(identify(changed).scopeDigest).toBe(identify(bundle).scopeDigest);
    expect(identify(changed).fingerprint).not.toBe(identify(bundle).fingerprint);
  });
  it("preserves the empty-body compatibility branch", () => {
    expect(parseReadyReviewIntent({})).toEqual({ mode: "legacy" });
  });
  it("accepts explicit independent creation", () => {
    expect(parseReadyReviewIntent({ mode: "create_new", request_id: "request-1" }))
      .toEqual({ mode: "create_new", request_id: "request-1" });
  });
  it("requires a selected session when opening existing", () => {
    expect(parseReadyReviewIntent({ mode: "open_existing", session_id: "review_session_one" }))
      .toEqual({ mode: "open_existing", session_id: "review_session_one" });
  });
  it.each([
    { mode: "create_new" }, { mode: "create_new", request_id: "" },
    { mode: "create_new", request_id: " leading" },
    { mode: "create_new", request_id: "x".repeat(129) },
    { mode: "create_new", request_id: "ok", tenant_id: "forged" },
    { mode: "open_existing", session_id: "../file" },
    { mode: "legacy" }, { mode: "unknown" }, [], null,
  ])("rejects malformed or authority-bearing input %j", (body) => {
    expect(() => parseReadyReviewIntent(body)).toThrow();
  });
  it("is stable across repeated resolution", () => {
    expect(identify(structuredClone(bundle))).toEqual(identify(bundle));
  });
  it("different requests have different scope", () => {
    expect(identify(bundle, "request-2").scopeDigest).not.toBe(identify(bundle).scopeDigest);
  });
  it("same key changing source preserves scope but conflicts by fingerprint", () => {
    const changed = identify({ ...bundle, modelVersionId: "v2", readyModelId: "mw_fedcba9876543210" });
    expect(changed.scopeDigest).toBe(identify(bundle).scopeDigest);
    expect(changed.fingerprint).not.toBe(identify(bundle).fingerprint);
  });
  it("separates server tenant and project scopes", () => {
    expect(identify({ ...bundle, tenantId: "other" }).scopeDigest).not.toBe(identify(bundle).scopeDigest);
    expect(identify({ ...bundle, projectId: "other" }).scopeDigest).not.toBe(identify(bundle).scopeDigest);
  });
  it("artifact mutation conflicts while quality enrichment does not", () => {
    expect(identify({ ...bundle, model: { ...bundle.model, sha256: "c".repeat(64) } }).fingerprint)
      .not.toBe(identify(bundle).fingerprint);
    expect(identify({ ...bundle, qualitySummary: { coverage_status: "pass" } })).toEqual(identify(bundle));
  });
});

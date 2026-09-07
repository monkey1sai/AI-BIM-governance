import { describe, expect, it, vi } from "vitest";
import { resolveReadyRenderBundle } from "../src/services/readyModelResolver.js";
import type { ConversionLedgerRecord } from "../src/services/conversionLedger.js";
import type { StreamingConversionResult } from "../src/services/streamingConversionClient.js";

function fixture() {
  const origin = "http://127.0.0.1:49101";
  const jobId = "stream_conv_test_001";
  const model = `${origin}/artifacts/${jobId}/model.usdc`;
  const mapping = `${origin}/artifacts/${jobId}/element_mapping.json`;
  const record: ConversionLedgerRecord = {
    idempotency_key: "mw_0123456789abcdef", correlation_id: "minio-watch-01234567",
    project_id: "project-test", project_display_name: "test", category: "architecture",
    external_model_version_id: "v1", object_key: null, bucket: null,
    conversion_job_id: jobId, status: "ready", coverage_report: null, usdc_key: model,
    detected_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:01Z",
  };
  const result: StreamingConversionResult = {
    conversion_job_id: jobId, status: "succeeded", ready: true,
    usdc_ref: model, element_mapping_ref: mapping,
    raw: {
      conversion_job_id: jobId, status: "succeeded", ready: true,
      authority: "bim-streaming-server", tenant_id: "tenant-test", project_id: "project-test",
      model_version_id: "v1", correlation_id: record.correlation_id, trace_id: "ifcready_original_001",
      usdc_url: model, mapping_url: mapping,
      artifacts: {
        model_usdc: { url: model, checksum_sha256: "a".repeat(64) },
        element_mapping: { url: mapping, checksum_sha256: "b".repeat(64) },
      },
      quality_metrics: { coverage_ratio: 0.998, coverage_status: "warn", semantic_mapping_fidelity: "guid_exact",
        mapping_has_ifc_type: true, phase_timings: { conversion_total: { duration_seconds: 12.5 } } },
    },
  };
  const fetchResult = vi.fn(async () => result);
  return { record, result, input: { record, configuredTenantId: "tenant-test", conversionOrigin: origin, fetchResult } };
}

describe("ready render resolution without volatile intake", () => {
  it("reuses a persisted descriptor without fetching terminal metadata again", async () => {
    const { input } = fixture();
    const first = await resolveReadyRenderBundle(input);
    if (!first.ok) throw new Error("Fixture failed");
    input.record.ready_render_bundle = first.bundle;
    input.fetchResult.mockClear();
    const second = await resolveReadyRenderBundle(input);
    expect(second.ok && second.cached).toBe(true);
    expect(second.ok ? second.bundle : null).toEqual(first.bundle);
    expect(first.cached).toBe(false);
    expect(input.fetchResult).not.toHaveBeenCalled();
  });
  it("carries the sanitized quality summary through the persisted descriptor on the cached path", async () => {
    const { input } = fixture();
    const first = await resolveReadyRenderBundle(input);
    if (!first.ok) throw new Error("Fixture failed");
    expect(first.qualitySummary).toMatchObject({ coverage_ratio: 0.998, coverage_status: "warn",
      semantic_mapping_fidelity: "guid_exact", mapping_has_ifc_type: true, conversion_duration_seconds: 12.5 });
    expect(first.bundle.qualitySummary).toEqual(first.qualitySummary);
    input.record.ready_render_bundle = structuredClone(first.bundle);
    const cached = await resolveReadyRenderBundle(input);
    expect(cached.ok && cached.cached).toBe(true);
    expect(cached.ok ? cached.qualitySummary : null).toEqual(first.qualitySummary);
  });
  it("re-sanitizes a persisted quality summary and tolerates descriptors written without one", async () => {
    const { input } = fixture();
    const first = await resolveReadyRenderBundle(input);
    if (!first.ok) throw new Error("Fixture failed");
    const tampered = structuredClone(first.bundle) as unknown as Record<string, unknown>;
    tampered.qualitySummary = { coverage_ratio: "not-a-number", semantic_mapping_fidelity: "guid_exact", injected: true };
    input.record.ready_render_bundle = tampered as never;
    const sanitized = await resolveReadyRenderBundle(input);
    if (!sanitized.ok) throw new Error("Cached resolution failed");
    expect(sanitized.qualitySummary).toMatchObject({ coverage_ratio: null, semantic_mapping_fidelity: "guid_exact" });
    expect(sanitized.qualitySummary).not.toHaveProperty("injected");
    const legacy = structuredClone(first.bundle) as unknown as Record<string, unknown>;
    delete legacy.qualitySummary;
    input.record.ready_render_bundle = legacy as never;
    const withoutSummary = await resolveReadyRenderBundle(input);
    expect(withoutSummary.ok && withoutSummary.cached).toBe(true);
    expect(withoutSummary.ok ? withoutSummary.qualitySummary : undefined).toBeNull();
  });
  it("accepts artifacts published under the trusted public origin when the API base is internal", async () => {
    const { input } = fixture();
    const internalOnly = await resolveReadyRenderBundle({ ...input, conversionOrigin: "http://host.docker.internal:49101" });
    expect(internalOnly).toEqual({ ok: false, reason: "artifact_invalid" });
    const withPublicOrigin = await resolveReadyRenderBundle({ ...input, conversionOrigin: "http://host.docker.internal:49101", publicArtifactOrigin: input.conversionOrigin });
    expect(withPublicOrigin.ok).toBe(true);
    const wrongPublicOrigin = await resolveReadyRenderBundle({ ...input, conversionOrigin: "http://host.docker.internal:49101", publicArtifactOrigin: "http://other.invalid:49101" });
    expect(wrongPublicOrigin).toEqual({ ok: false, reason: "artifact_invalid" });
  });
  it("requires the public origin once it is configured, even when the result matches the internal origin", async () => {
    const { input } = fixture();
    // Fixture artifacts are published under input.conversionOrigin; configuring a different public
    // origin makes that internal-origin result stale/misconfigured rather than acceptable.
    const internalPublished = await resolveReadyRenderBundle({ ...input, publicArtifactOrigin: "http://192.168.10.105:49101" });
    expect(internalPublished).toEqual({ ok: false, reason: "artifact_invalid" });
    const first = await resolveReadyRenderBundle(input);
    if (!first.ok) throw new Error("Fixture failed");
    input.record.ready_render_bundle = first.bundle;
    input.fetchResult.mockClear();
    const cachedInternal = await resolveReadyRenderBundle({ ...input, publicArtifactOrigin: "http://192.168.10.105:49101" });
    expect(cachedInternal).toEqual({ ok: false, reason: "artifact_invalid" });
    expect(input.fetchResult).not.toHaveBeenCalled();
  });
  it.each(["tenant", "correlation", "origin", "checksum"])("rejects persisted %s drift without refreshing away the mismatch", async field => {
    const { input } = fixture();
    const first = await resolveReadyRenderBundle(input);
    if (!first.ok) throw new Error("Fixture failed");
    input.record.ready_render_bundle = first.bundle;
    if (field === "tenant") input.configuredTenantId = "other";
    if (field === "correlation") input.record.correlation_id = "other";
    if (field === "origin") input.conversionOrigin = "http://other.invalid";
    if (field === "checksum") first.bundle.model.sha256 = "invalid";
    input.fetchResult.mockClear();
    expect(await resolveReadyRenderBundle(input)).toEqual({ ok: false, reason: "artifact_invalid" });
    expect(input.fetchResult).not.toHaveBeenCalled();
  });
  it("resolves terminal metadata without an IFC-ready store or any mutation port", async () => {
    const { input } = fixture();
    const resolved = await resolveReadyRenderBundle(input);
    expect(resolved).toMatchObject({ ok: true, bundle: { readyModelId: input.record.idempotency_key, rootTraceId: "ifcready_original_001" } });
    expect(input.fetchResult).toHaveBeenCalledTimes(1);
    expect(input.fetchResult).toHaveBeenCalledWith(input.record.conversion_job_id);
  });

  it.each(["queued", "converting", "failed"] as const)("never fetches a %s record", async status => {
    const { input } = fixture(); input.record.status = status;
    expect(await resolveReadyRenderBundle(input)).toEqual({ ok: false, reason: "record_not_ready" });
    expect(input.fetchResult).not.toHaveBeenCalled();
  });

  it.each(["conversion_job_id", "authority", "tenant_id", "project_id", "model_version_id", "correlation_id", "trace_id"])("rejects missing or mismatched %s", async field => {
    for (const value of [undefined, "wrong"]) {
      const { input, result } = fixture(); result.raw[field] = value;
      expect(await resolveReadyRenderBundle(input)).toEqual({ ok: false, reason: "result_identity_mismatch" });
    }
  });

  it("rejects a normalized client job ID when raw authority omitted it", async () => {
    const { input, result } = fixture(); delete result.raw.conversion_job_id;
    expect(await resolveReadyRenderBundle(input)).toEqual({ ok: false, reason: "result_identity_mismatch" });
  });

  it.each(["ifcready_ifcready_nested", "ifcready_rev_nested", `ifcready_${"a".repeat(201)}`])("uses the session trace contract", async trace => {
    const { input, result } = fixture(); result.raw.trace_id = trace;
    expect(await resolveReadyRenderBundle(input)).toEqual({ ok: false, reason: "result_identity_mismatch" });
  });

  it.each(["failed", "running", "cancelled"])("rejects conflicting terminal status %s", async status => {
    const { input, result } = fixture(); result.raw.status = status;
    expect(await resolveReadyRenderBundle(input)).toEqual({ ok: false, reason: "result_identity_mismatch" });
  });

  it.each([
    "http://other.invalid/artifacts/stream_conv_test_001/model.usdc",
    "http://127.0.0.1:49101/artifacts/other/model.usdc",
    "http://127.0.0.1:49101/artifacts/stream_conv_test_001/model.usdc?signature=private",
    "http://user:secret@127.0.0.1:49101/artifacts/stream_conv_test_001/model.usdc",
    "http://127.0.0.1:49101/artifacts/other/../stream_conv_test_001/model.usdc",
  ])("rejects noncanonical artifact reference without requesting it", async url => {
    const { input, result } = fixture();
    (result.raw.artifacts as any).model_usdc.url = url;
    expect(await resolveReadyRenderBundle(input)).toEqual({ ok: false, reason: "artifact_invalid" });
    expect(input.fetchResult).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, "", "fake", "a".repeat(63)])("requires an actual SHA256 metadata field", async checksum => {
    const { input, result } = fixture();
    (result.raw.artifacts as any).element_mapping.checksum_sha256 = checksum;
    expect(await resolveReadyRenderBundle(input)).toEqual({ ok: false, reason: "artifact_invalid" });
  });

  it("does not leak upstream errors", async () => {
    const { input } = fixture(); input.fetchResult.mockRejectedValue(new Error("private upstream data"));
    expect(await resolveReadyRenderBundle(input)).toEqual({ ok: false, reason: "result_unavailable" });
  });

  it("rejects a conflicting failed nested model even when top-level ready is true", async () => {
    const { input, result } = fixture(); result.raw.model = { status: "failed" };
    expect(await resolveReadyRenderBundle(input)).toEqual({ ok: false, reason: "result_identity_mismatch" });
  });

  it("does not accept ledger mutation during an asynchronous read", async () => {
    const { input, result } = fixture();
    input.fetchResult.mockImplementation(async () => { input.record.project_id = "changed"; return result; });
    expect(await resolveReadyRenderBundle(input)).toMatchObject({ ok: true, bundle: { projectId: "project-test" } });
  });
});

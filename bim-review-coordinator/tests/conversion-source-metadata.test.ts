import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { readConversionSourceMetadata } from "../src/services/conversionSourceMetadata.js";
import type { StreamingConversionResult } from "../src/services/streamingConversionClient.js";

const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function fixture() {
  const binding = { conversionJobId: "job_1", correlationId: "trace_1",
    tenantId: "tenant_1", projectId: "project_1", modelVersionId: "version_1" };
  const document: Record<string, any> = { source_fingerprint: {
    schema_version: "ifc-source-fingerprint/v1", sha256: "a".repeat(64),
    size_bytes: 13, model_version_id: "version_1", observation: "before_after_match",
  }, private_path: "must-not-escape" };
  const bytes = () => Buffer.from(JSON.stringify(document));
  const descriptors = {
    metadata: { url: "https://publisher.test/artifacts/job_1/metadata.json", checksum_sha256: hash(bytes()) },
    model_usdc: { url: "https://publisher.test/artifacts/job_1/model.usdc", checksum_sha256: "b".repeat(64) },
    element_mapping: { url: "https://publisher.test/artifacts/job_1/element_mapping.json", checksum_sha256: "c".repeat(64) },
  };
  const raw: Record<string, any> = { conversion_job_id: "job_1", correlation_id: "trace_1",
    tenant_id: "tenant_1", project_id: "project_1", model_version_id: "version_1",
    authority: "bim-streaming-server", ready: true, status: "succeeded", artifacts: descriptors };
  const result: StreamingConversionResult = { conversion_job_id: "job_1", correlation_id: "trace_1",
    ready: true, status: "succeeded", manifest_ref: descriptors.metadata.url,
    usdc_ref: descriptors.model_usdc.url, element_mapping_ref: descriptors.element_mapping.url, raw };
  const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => new Response(bytes()));
  const input = { binding, result, conversionOrigin: "http://127.0.0.1:49101",
    publicArtifactOrigin: "https://publisher.test", fetchImpl };
  function refresh() { descriptors.metadata.checksum_sha256 = hash(bytes()); }
  return { input, raw, document, descriptors, fetchImpl, refresh };
}
describe("conversion source metadata reader", () => {
  it.each(["none", "source", "usdc", "mapping", "version", "denominator", "schema"])(
    "binds actual streaming checks to exact artifact and source identities: %s", async change => {
      const f = fixture();
      const validation = {
        schemaVersion: "conversion-validation-facts/v1", validatorVersion: "conversion-facts-validator/v1",
        validatedAt: "2026-09-12T00:00:00Z", sourceSha256: "a".repeat(64),
        sourceName: "fixture.ifc", modelVersionId: "version_1",
        artifacts: { usdcSha256: "b".repeat(64), mappingSha256: "c".repeat(64) },
        inventory: { observation: "observed", expectedRenderable: 0, convertedRenderable: 0, missing: [], excluded: [] },
        expectedElements: [], byClass: [], correspondence: [],
        units: { ifcLengthScaleM: null, usdMetersPerUnit: null, upAxis: null },
        checks: [{ id: "inventory_completeness", state: "fail", reasonCodes: ["no_renderable_source"] }],
      };
      if (change === "source") validation.sourceSha256 = "e".repeat(64);
      if (change === "usdc") validation.artifacts.usdcSha256 = "e".repeat(64);
      if (change === "mapping") validation.artifacts.mappingSha256 = "e".repeat(64);
      if (change === "version") validation.modelVersionId = "other";
      if (change === "denominator") validation.inventory.expectedRenderable = 1;
      if (change === "schema") validation.schemaVersion = "future-schema";
      f.document.conversion_validation = validation; f.refresh();
      const result = await readConversionSourceMetadata(f.input);
      if (change === "none") {
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.facts.validation).toEqual(validation);
      } else expect(result).toEqual({ ok: false, reason: "metadata_invalid" });
    });
  it("rejects a non-string job binding rather than coercing it to a path", async () => {
    const f = fixture();
    (f.input.binding as any).conversionJobId = undefined;
    expect(await readConversionSourceMetadata(f.input)).toEqual({ ok: false, reason: "binding_invalid" });
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });
  it("bounds pending body reads and cancels the stream on timeout", async () => {
    const f = fixture(); let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
    f.fetchImpl.mockResolvedValue(new Response(stream));
    expect(await readConversionSourceMetadata(f.input)).toEqual({ ok: false, reason: "metadata_unavailable" });
    expect(cancelled).toBe(true);
  }, 15_000);
  it("rejects a missing response body", async () => {
    const f = fixture(); f.fetchImpl.mockResolvedValue(new Response(null));
    expect(await readConversionSourceMetadata(f.input)).toEqual({ ok: false, reason: "metadata_unavailable" });
  });
  it("accepts the configured internal publisher only when no public publisher is configured", async () => {
    const f = fixture();
    delete (f.input as { publicArtifactOrigin?: string }).publicArtifactOrigin;
    for (const entry of Object.values(f.descriptors)) {
      entry.url = entry.url.replace("https://publisher.test", f.input.conversionOrigin);
    }
    const result = await readConversionSourceMetadata(f.input);
    expect(result.ok).toBe(true);
  });
  it("hashes actual metadata and returns only bounded facts, not artifact-byte proof", async () => {
    const f = fixture();
    const result = await readConversionSourceMetadata(f.input);
    expect(result).toEqual({ ok: true, facts: {
      sourceSha256: "a".repeat(64), sourceSizeBytes: 13, modelVersionId: "version_1",
      metadataSha256: f.descriptors.metadata.checksum_sha256,
      declaredUsdcSha256: "b".repeat(64), declaredMappingSha256: "c".repeat(64),
      converterVersion: null, observation: "before_after_match",
    } });
    expect(f.fetchImpl).toHaveBeenCalledTimes(1);
    expect(f.fetchImpl.mock.calls[0][0]).toBe("http://127.0.0.1:49101/artifacts/job_1/metadata.json");
    expect(f.fetchImpl.mock.calls[0][1]).toMatchObject({
      redirect: "error", headers: { Accept: "application/json" },
    });
  });
  it.each(["tenant_id", "project_id", "model_version_id", "correlation_id", "conversion_job_id", "authority"])(
    "rejects mismatched %s before network I/O", async field => {
      const f = fixture(); f.raw[field] = "other";
      expect(await readConversionSourceMetadata(f.input)).toEqual({ ok: false, reason: "result_identity_mismatch" });
      expect(f.fetchImpl).not.toHaveBeenCalled();
    });
  it.each(["failed", "cancelled", "queued"])("rejects %s", async status => {
    const f = fixture(); f.raw.status = status; f.input.result.status = status;
    expect(await readConversionSourceMetadata(f.input)).toEqual({ ok: false, reason: "result_identity_mismatch" });
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });
  it.each([
    "https://evil.test/artifacts/job_1/metadata.json",
    "https://user:secret@publisher.test/artifacts/job_1/metadata.json",
    "https://publisher.test/artifacts/job_1/metadata.json?secret=x",
    "https://publisher.test/artifacts/job_1/metadata.json#x",
    "https://publisher.test/artifacts/job_2/metadata.json",
    "https://publisher.test/artifacts/job_1/../job_1/metadata.json",
    "https://publisher.test/artifacts/job_1%2fmetadata.json",
  ])("rejects noncanonical artifact URL %s", async url => {
    const f = fixture(); f.descriptors.metadata.url = url;
    expect(await readConversionSourceMetadata(f.input)).toEqual({ ok: false, reason: "artifact_invalid" });
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });
  it.each([
    ["schema_version", "other"], ["observation", "unknown"],
    ["sha256", "ETag"], ["model_version_id", "version_2"],
    ["size_bytes", -1], ["size_bytes", 1.1], ["size_bytes", Number.MAX_SAFE_INTEGER + 1],
  ])("rejects invalid fingerprint %s", async (field, value) => {
    const f = fixture(); f.document.source_fingerprint[field] = value; f.refresh();
    expect(await readConversionSourceMetadata(f.input)).toEqual({ ok: false, reason: "metadata_invalid" });
  });
  it.each(["", 1, "x".repeat(257)])("rejects invalid reported converter version", async value => {
    const f = fixture(); f.document.converter_version = value; f.refresh();
    expect(await readConversionSourceMetadata(f.input)).toEqual({ ok: false, reason: "metadata_invalid" });
  });
  it("keeps an observed converter version", async () => {
    const f = fixture(); f.document.converter_version = "converter-1"; f.refresh();
    const result = await readConversionSourceMetadata(f.input);
    expect(result.ok && result.facts.converterVersion).toBe("converter-1");
  });
  it("rejects changed bytes even if JSON remains valid", async () => {
    const f = fixture(); f.document.source_fingerprint.sha256 = "d".repeat(64);
    expect(await readConversionSourceMetadata(f.input)).toEqual({ ok: false, reason: "metadata_checksum_mismatch" });
  });
  it.each([Buffer.from([0xff]), Buffer.from("{"), Buffer.from("[]"), Buffer.from("{}")])(
    "rejects malformed metadata bytes after digest verification", async bytes => {
      const f = fixture(); f.descriptors.metadata.checksum_sha256 = hash(bytes);
      f.fetchImpl.mockResolvedValue(new Response(bytes));
      expect(await readConversionSourceMetadata(f.input)).toEqual({ ok: false, reason: "metadata_invalid" });
    });
  it.each([302, 404, 500])("rejects HTTP %i without body disclosure", async status => {
    const f = fixture(); f.fetchImpl.mockResolvedValue(new Response("private", { status }));
    expect(await readConversionSourceMetadata(f.input)).toEqual({ ok: false, reason: "metadata_unavailable" });
  });
  it("rejects a failed transport with a fixed reason", async () => {
    const f = fixture(); f.fetchImpl.mockRejectedValue(new Error("secret-url"));
    expect(await readConversionSourceMetadata(f.input)).toEqual({ ok: false, reason: "metadata_unavailable" });
  });
  it("rejects oversized declared body", async () => {
    const f = fixture();
    f.fetchImpl.mockResolvedValue(new Response("{}", { headers: { "Content-Length": "4194305" } }));
    expect(await readConversionSourceMetadata(f.input)).toEqual({ ok: false, reason: "metadata_too_large" });
  });
  it("limits actual streamed bytes and cancels without awaiting untrusted cancellation", async () => {
    const f = fixture(); let cancelled = false;
    const stream = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(4194305)); },
      cancel() { cancelled = true; return new Promise<void>(() => {}); } });
    f.fetchImpl.mockResolvedValue(new Response(stream));
    expect(await readConversionSourceMetadata(f.input)).toEqual({ ok: false, reason: "metadata_too_large" });
    expect(cancelled).toBe(true);
  });
  it("uses a detached identity snapshot across the await", async () => {
    const f = fixture();
    f.fetchImpl.mockImplementation(async () => {
      f.input.binding.modelVersionId = "changed"; f.raw.model_version_id = "changed";
      return new Response(JSON.stringify(f.document));
    });
    const result = await readConversionSourceMetadata(f.input);
    expect(result.ok && result.facts.modelVersionId).toBe("version_1");
  });
});

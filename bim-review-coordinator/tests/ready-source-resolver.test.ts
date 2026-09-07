import { describe, expect, it, vi } from "vitest";
import { resolveReadySourceIdentity } from "../src/services/readySourceResolver.js";
import { idempotencyKeyFor } from "../src/services/minioWatcher.js";
import type { ConversionLedgerRecord } from "../src/services/conversionLedger.js";

function fixture() {
  const bucket = "fixture-bucket";
  const key = "scope/project/architecture/v1/model.ifc";
  const etag = "abc123-7"; // multipart ETag is an opaque identity, not a content MD5.
  const record: ConversionLedgerRecord = {
    idempotency_key: idempotencyKeyFor(bucket, key, etag), correlation_id: "fixture-correlation",
    project_id: "project", project_display_name: "project", category: "architecture",
    external_model_version_id: "v1", object_key: null, bucket: null, conversion_job_id: "stream_conv_fixture",
    status: "ready", coverage_report: null, usdc_key: null, detected_at: "2026-01-01", updated_at: "2026-01-01",
  };
  return { record, tenantId: "tenant-fixture", bucket, prefix: "scope/", keySuffix: "/model.ifc",
    store: { listObjects: vi.fn(async () => [{ key, etag: `"${etag}"` }]), headEtag: vi.fn(async (): Promise<string | null> => etag) } };
}

describe("ready source identity", () => {
  it("resolves a legacy row without bucket/key using the exact current object hash", async () => {
    const input = fixture();
    expect(await resolveReadySourceIdentity(input)).toMatchObject({ ok: true, source: {
      readyModelId: input.record.idempotency_key, tenantId: "tenant-fixture", etag: "abc123-7",
    } });
    expect(input.store.listObjects).toHaveBeenCalledWith("scope/");
    expect(input.store.headEtag).toHaveBeenCalledTimes(1);
  });
  it("does not substitute another object with the same project/version", async () => {
    const input = fixture();
    input.store.listObjects.mockResolvedValue([{ key: "scope/project/other/architecture/v1/model.ifc", etag: "abc123-7" }]);
    expect(await resolveReadySourceIdentity(input)).toEqual({ ok: false, reason: "source_not_found" });
    expect(input.store.headEtag).not.toHaveBeenCalled();
  });
  it("rejects duplicate raw rows instead of selecting the first", async () => {
    const input = fixture();
    const [row] = await input.store.listObjects();
    input.store.listObjects.mockResolvedValue([row, row]);
    expect(await resolveReadySourceIdentity(input)).toEqual({ ok: false, reason: "source_ambiguous" });
  });
  it.each(["different", null])("rejects object replacement or deletion between list and HEAD", async etag => {
    const input = fixture(); input.store.headEtag.mockResolvedValue(etag);
    expect(await resolveReadySourceIdentity(input)).toEqual({ ok: false, reason: "source_changed" });
  });
  it.each(["project_id", "category", "external_model_version_id", "object_key", "bucket"] as const)("rejects ledger %s drift", async field => {
    const input = fixture(); input.record[field] = "different";
    expect(await resolveReadySourceIdentity(input)).toEqual({ ok: false, reason: "source_scope_invalid" });
  });
  it("does not use a manual-trigger key-as-ETag identity as an actual object ETag", async () => {
    const input = fixture(); const [row] = await input.store.listObjects();
    input.record.idempotency_key = idempotencyKeyFor(input.bucket, row.key, row.key);
    expect(await resolveReadySourceIdentity(input)).toEqual({ ok: false, reason: "source_not_found" });
  });
  it("returns only a safe error token on SDK failure", async () => {
    const input = fixture(); input.store.headEtag.mockRejectedValue(new Error("private endpoint and object key"));
    expect(await resolveReadySourceIdentity(input)).toEqual({ ok: false, reason: "source_unavailable" });
  });
});

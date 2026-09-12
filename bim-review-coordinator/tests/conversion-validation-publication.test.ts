import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExternalIfcReadyStore } from "../src/services/externalIfcReadyStore.js";
import { ConversionLedger } from "../src/services/conversionLedger.js";
import type { ConversionSourceReadResult } from "../src/services/conversionSourceMetadata.js";
import type { StreamingConversionResult } from "../src/services/streamingConversionClient.js";
import { publishConversionValidation } from "../src/services/conversionValidationPublication.js";

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
const key = "mw_publication", time = "2026-09-09T00:00:00Z";
function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "validation-publication-")); roots.push(root);
  const store = new ExternalIfcReadyStore(path.join(root, "jobs.json"));
  const file = path.join(root, "ledger.json"), ledger = new ConversionLedger(file);
  const job = store.create({ event: "ifc_ready", tenant_id: "tenant_1", project_id: "project_1",
    external_model_version_id: "version_1", source_ifc: { ref: "https://source.test/private?signature=sentinel", etag: "etag_1" } },
    { correlationId: "trace_1", idempotencyKey: key, tenantId: "tenant_1", projectId: "project_1", externalModelVersionId: "version_1" });
  store.markDispatched(job.ifc_ready_job_id, "job_1", "queued");
  store.recordConversionOutcome(job.ifc_ready_job_id, "ready", "callback_1");
  ledger.upsert({ idempotency_key: key, correlation_id: "trace_1", project_id: "project_1",
    project_display_name: "Project", category: "M", external_model_version_id: "version_1",
    conversion_job_id: "job_1", status: "ready" }, time);
  ledger.recordCallbackOutcome(key, { status: "ready", usdc_key: "https://publisher.test/artifacts/job_1/model.usdc" }, time);
  const result: StreamingConversionResult = { conversion_job_id: "job_1", correlation_id: "trace_1",
    ready: true, status: "succeeded", usdc_ref: "https://publisher.test/artifacts/job_1/model.usdc", raw: {} };
  const metadata: ConversionSourceReadResult = { ok: true, facts: { sourceSha256: "a".repeat(64),
    sourceSizeBytes: 13, modelVersionId: "version_1", metadataSha256: "d".repeat(64),
    declaredUsdcSha256: "b".repeat(64), declaredMappingSha256: "c".repeat(64),
    converterVersion: null, observation: "before_after_match" } };
  const input = { store, ledger, jobId: job.ifc_ready_job_id, result,
    conversionOrigin: "http://127.0.0.1:49101", readMetadata: async () => metadata, now: () => time };
  return { input, job, file, ledger, metadata };
}
describe("conversion validation publication", () => {
  it("persists producer observations and scope versions without replacing historical evidence", async () => {
    const f = setup(); if (!f.metadata.ok) throw new Error("fixture");
    const observedAt = "2026-09-11T23:00:00Z";
    f.metadata.facts.validation = {
      schemaVersion: "conversion-validation-facts/v1", validatorVersion: "fixture-validator/v1",
      validatedAt: observedAt, sourceName: "fixture.ifc", sourceSha256: "a".repeat(64), modelVersionId: "version_1",
      artifacts: { usdcSha256: "b".repeat(64), mappingSha256: "c".repeat(64) },
      inventory: { observation: "observed", expectedRenderable: 0, convertedRenderable: 0, missing: [], excluded: [] },
      expectedElements: [], byClass: [], correspondence: [],
      units: { ifcLengthScaleM: null, usdMetersPerUnit: null, upAxis: null },
      checks: [{ id: "inventory_completeness", state: "fail", reasonCodes: ["no_renderable_source"] }],
    };
    const approvedScopes = [{ id: "test-scope", version: "1", purpose: "view_3d" as const,
      sourceSha256: "a".repeat(64), modelVersionId: "version_1", tenantId: "tenant_1", projectId: "project_1", requiredGuids: ["required"] }];
    expect((await publishConversionValidation({ ...f.input, approvedScopes })).status).toBe("stored");
    const saved = new ConversionLedger(f.file).listValidationRecords(key)[0];
    expect(saved.validatedAt).toBe(observedAt);
    expect(saved.evidence).toEqual(f.metadata.facts.validation);
    expect(saved.evaluations.find(e => e.purpose === "view_3d")?.outcome).toBe("not_usable");
    expect((await publishConversionValidation({ ...f.input, approvedScopes, now: () => "2026-09-13T00:00:00Z" })).status).toBe("replayed");
    approvedScopes[0].version = "2";
    expect((await publishConversionValidation({ ...f.input, approvedScopes })).status).toBe("stored");
    const history = new ConversionLedger(f.file).listValidationRecords(key);
    expect(history).toHaveLength(2); expect(history[0]).toEqual(saved);
    expect(history[1].approvedScopes?.[0].version).toBe("2");
  });
  it("stores only provenance facts and replays concurrently and after reload without changing first observation", async () => {
    const f = setup();
    const results = await Promise.all([publishConversionValidation(f.input), publishConversionValidation(f.input)]);
    expect(results.map(r => r.status)).toEqual(["stored", "replayed"]);
    const saved = f.ledger.listValidationRecords(key)[0];
    expect(saved.recordId).toMatch(/^validation_[a-f0-9]{64}$/);
    expect(saved.validatedAt).toBe(time);
    expect(saved.source).toEqual({ name: "來源名稱未提供", sha256: "a".repeat(64) });
    expect(saved.converterVersion).toBeNull(); expect(saved.correspondence).toBeNull();
    expect(saved.inventory).toEqual({ observation: "not_run", expectedRenderable: null, convertedRenderable: null, missing: [], excluded: [] });
    expect(saved.evaluations.map(e => e.outcome)).toEqual(Array(4).fill("not_validated"));
    const before = fs.readFileSync(f.file, "utf8");
    expect(await publishConversionValidation({ ...f.input, ledger: new ConversionLedger(f.file),
      now: () => "2026-09-10T00:00:00Z" })).toEqual({ status: "replayed", recordId: saved.recordId });
    expect(fs.readFileSync(f.file, "utf8")).toBe(before);
    expect(JSON.stringify(saved)).not.toContain("sentinel");
  });
  it("keeps previous records immutable when new metadata arrives", async () => {
    const f = setup(); await publishConversionValidation(f.input);
    const old = f.ledger.listValidationRecords(key)[0];
    if (!f.metadata.ok) throw new Error("fixture");
    f.metadata.facts.metadataSha256 = "e".repeat(64);
    expect((await publishConversionValidation(f.input)).status).toBe("stored");
    const records = new ConversionLedger(f.file).listValidationRecords(key);
    expect(records).toHaveLength(2); expect(records[0]).toEqual(old); expect(records[1].recordId).not.toBe(old.recordId);
  });
  it.each(["tenant_id", "project_id", "external_model_version_id", "conversion_job_id",
    "correlation_id", "idempotency_key", "source_ifc_ref", "source_ifc_etag", "conversion_authority", "conversion_status"] as const)(
    "rechecks current job %s after metadata even for an existing record", async field => {
      const f = setup(); await publishConversionValidation(f.input);
      let resolve!: (r: ConversionSourceReadResult) => void;
      const pending = publishConversionValidation({ ...f.input, readMetadata: () => new Promise(r => { resolve = r; }) });
      Object.assign(f.job, { [field]: "changed" }); resolve(f.metadata);
      expect(await pending).toEqual({ status: "not_recorded", reason: "source_changed" });
      expect(new ConversionLedger(f.file).listValidationRecords(key)).toHaveLength(1);
    });
  it.each(["project_id", "external_model_version_id", "conversion_job_id", "correlation_id", "status", "usdc_key"] as const)(
    "rechecks current ledger %s after metadata", async field => {
      const f = setup(); let resolve!: (r: ConversionSourceReadResult) => void;
      const pending = publishConversionValidation({ ...f.input, readMetadata: () => new Promise(r => { resolve = r; }) });
      const current = f.ledger.get(key)!;
      if (field === "usdc_key") f.ledger.recordCallbackOutcome(key, { status: "ready", usdc_key: "changed" }, time);
      else f.ledger.upsert({ ...current, [field]: field === "status" ? "failed" : "changed" }, time);
      resolve(f.metadata);
      expect(await pending).toEqual({ status: "not_recorded", reason: "source_changed" });
      expect(f.ledger.listValidationRecords(key)).toEqual([]);
    });
  it("ignores harmless updated_at changes and snapshots the caller result", async () => {
    const f = setup(); let resolve!: (r: ConversionSourceReadResult) => void;
    const pending = publishConversionValidation({ ...f.input, readMetadata: () => new Promise(r => { resolve = r; }) });
    f.job.updated_at = "2026-09-10T00:00:00Z"; f.input.result.usdc_ref = "changed";
    resolve(f.metadata); expect((await pending).status).toBe("stored");
  });
  it.each(["conversion_authority", "conversion_job_id", "conversion_status"] as const)(
    "does not read metadata for a non-ready binding: %s", async field => {
      const f = setup(); Object.assign(f.job, { [field]: "other" });
      expect(await publishConversionValidation({ ...f.input, readMetadata: async () => { throw new Error("must not read"); } }))
        .toEqual({ status: "not_recorded", reason: "source_not_ready" });
      expect(f.ledger.listValidationRecords(key)).toEqual([]);
    });
  it("does not publish unavailable metadata or expose upstream errors", async () => {
    const f = setup();
    for (const readMetadata of [async (): Promise<ConversionSourceReadResult> => ({ ok: false, reason: "metadata_checksum_mismatch" }),
      async (): Promise<ConversionSourceReadResult> => { throw new Error("private sentinel"); }]) {
      expect(await publishConversionValidation({ ...f.input, readMetadata })).toEqual({ status: "not_recorded", reason: "metadata_unavailable" });
    }
    expect(f.ledger.listValidationRecords(key)).toEqual([]);
  });
  it("rejects unsafe display text and invalid identities without sanitizing into another scope", async () => {
    const f = setup(); if (!f.metadata.ok) throw new Error("fixture");
    f.metadata.facts.converterVersion = "Bearer private-sentinel";
    expect(await publishConversionValidation(f.input)).toEqual({ status: "not_recorded", reason: "record_invalid" });
    f.metadata.facts.converterVersion = null; f.job.tenant_id = "invalid/tenant";
    expect(await publishConversionValidation(f.input)).toEqual({ status: "not_recorded", reason: "record_invalid" });
    expect(f.ledger.listValidationRecords(key)).toEqual([]);
  });
  it("rolls back a failed rename and permits a durable retry", async () => {
    const f = setup(), before = fs.readFileSync(f.file, "utf8");
    vi.spyOn(fs, "renameSync").mockImplementationOnce(() => { throw new Error("private path"); });
    expect(await publishConversionValidation(f.input)).toEqual({ status: "not_recorded", reason: "persistence_failed" });
    expect(f.ledger.listValidationRecords(key)).toEqual([]); expect(fs.readFileSync(f.file, "utf8")).toBe(before);
    vi.restoreAllMocks();
    expect((await publishConversionValidation(f.input)).status).toBe("stored");
    expect(new ConversionLedger(f.file).listValidationRecords(key)).toHaveLength(1);
  });
});

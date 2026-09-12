import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IfcReadyConversionPipeline } from "../src/services/ifcReadyConversionPipeline.js";
import { ExternalIfcReadyStore } from "../src/services/externalIfcReadyStore.js";
import { ConversionLedger } from "../src/services/conversionLedger.js";
import { ConversionDispatchQueue } from "../src/services/conversionDispatchQueue.js";
import { CallbackOutbox } from "../src/services/callbackOutbox.js";
import { publishConversionValidation } from "../src/services/conversionValidationPublication.js";
import type { ConversionSourceReadResult } from "../src/services/conversionSourceMetadata.js";
import type { StreamingConversionClient, StreamingConversionResult } from "../src/services/streamingConversionClient.js";
import { sanitizeArtifactIdPart } from "../src/services/streamingConversionClient.js";
import type { StructLogger } from "../src/lib/structLog.js";

const roots: string[] = [], pipelines: IfcReadyConversionPipeline[] = [];
const time = "2026-09-12T00:00:00Z";
afterEach(() => {
  pipelines.splice(0).forEach(p => p.dispose()); vi.useRealTimers(); vi.restoreAllMocks();
  roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true }));
});
function setup(correlationId = "trace_1") {
  vi.useFakeTimers();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "validation-recovery-")); roots.push(root);
  const jobsFile = path.join(root, "jobs.json"), ledgerFile = path.join(root, "ledger.json");
  const store = new ExternalIfcReadyStore(jobsFile), ledger = new ConversionLedger(ledgerFile);
  const job = store.create({ event: "ifc_ready", tenant_id: "tenant_1", project_id: "project_1",
    external_model_version_id: "version_1", source_ifc: { ref: "https://private.test/a?secret=sentinel", etag: "etag_1" } },
    { correlationId, idempotencyKey: "worker:project::version::task", tenantId: "tenant_1",
      projectId: "project_1", externalModelVersionId: "version_1" });
  store.markDispatched(job.ifc_ready_job_id, "job_1", "queued");
  store.recordConversionOutcome(job.ifc_ready_job_id, "ready", "callback_1");
  ledger.upsert({ idempotency_key: job.idempotency_key, correlation_id: correlationId, project_id: "project_1",
    project_display_name: "Project", category: "M", external_model_version_id: "version_1",
    conversion_job_id: "job_1", status: "ready" }, time);
  ledger.recordCallbackOutcome(job.idempotency_key, { status: "ready", usdc_key: "https://publisher.test/artifacts/job_1/model.usdc" }, time);
  const result: StreamingConversionResult = { conversion_job_id: "job_1", correlation_id: sanitizeArtifactIdPart(correlationId),
    ready: true, status: "succeeded", usdc_ref: "https://publisher.test/artifacts/job_1/model.usdc", raw: {} };
  const metadata: ConversionSourceReadResult = { ok: true, facts: { sourceSha256: "a".repeat(64), sourceSizeBytes: 13,
    modelVersionId: "version_1", metadataSha256: "d".repeat(64), declaredUsdcSha256: "b".repeat(64),
    declaredMappingSha256: "c".repeat(64), converterVersion: null, observation: "before_after_match" } };
  const readMetadata = vi.fn(async (): Promise<ConversionSourceReadResult> => metadata);
  const fetchResult = vi.fn(async () => result);
  const outbox = new CallbackOutbox(), observer = vi.fn(), anomaly = vi.fn();
  const make = (currentStore = store, currentLedger = ledger) => {
    const publishValidation = vi.fn((job, result) => publishConversionValidation({ store: currentStore,
      ledger: currentLedger, jobId: job.ifc_ready_job_id, result, conversionOrigin: "http://127.0.0.1:49101", readMetadata }));
    const pipeline = new IfcReadyConversionPipeline({ store: currentStore, ledger: currentLedger,
      streamingClient: { fetchConversionResult: fetchResult } as unknown as StreamingConversionClient,
      queue: new ConversionDispatchQueue(), outbox, publishValidation, onConversionTerminal: observer,
      structLog: { withTraceId: () => ({ anomaly }) } as unknown as StructLogger,
      config: { storageRoot: root, ifcDownloadTimeoutSeconds: 1, ifcDownloadStrict: true,
        conversionPollEnabled: false, conversionPollIntervalSeconds: 1, conversionPollMaxAttempts: 3,
        cloudCallbackBaseUrl: "" } });
    pipelines.push(pipeline); return { pipeline, publishValidation };
  };
  return { ...make(), make, store, ledger, job, result, metadata, readMetadata, fetchResult,
    jobsFile, ledgerFile, outbox, observer, anomaly };
}

describe("validation-only recovery", () => {
  it("recovers an opaque correlation using the canonical Streaming normalization", async () => {
    const f = setup("trace:1"); f.readMetadata.mockRejectedValueOnce(new Error("transient"));
    const first = await f.pipeline.ingestStreamingResult("job_1", { result: f.result, source: "auto-poll" });
    expect(first.ok && first.validation_record.status).toBe("not_recorded");
    await vi.runAllTimersAsync();
    expect(f.ledger.listValidationRecords(f.job.idempotency_key)).toHaveLength(1);
    expect(f.outbox.list()).toHaveLength(1); expect(f.observer).toHaveBeenCalledTimes(1);
  });
  it("rejects a fetched result for another normalized correlation", async () => {
    const f = setup("trace:1"); f.pipeline.resumeValidationPublications();
    f.result.correlation_id = "trace_other";
    await vi.runAllTimersAsync();
    expect(f.publishValidation).not.toHaveBeenCalled(); expect(f.outbox.list()).toEqual([]);
    expect(f.ledger.listValidationRecords(f.job.idempotency_key)).toEqual([]);
  });
  it.each(["metadata", "persistence"])("recovers a transient %s failure without repeating terminal side effects", async failure => {
    const f = setup();
    if (failure === "metadata") f.readMetadata.mockRejectedValueOnce(new Error("private sentinel"));
    else vi.spyOn(f.ledger, "appendValidationRecord").mockImplementationOnce(() => { throw new Error("private sentinel"); });
    const first = await f.pipeline.ingestStreamingResult("job_1", { result: f.result, source: "auto-poll" });
    expect(first.ok && first.validation_record.status).toBe("not_recorded");
    const beforeJob = structuredClone(f.job), beforeOutbox = structuredClone(f.outbox.list());
    expect(f.observer).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(new ConversionLedger(f.ledgerFile).listValidationRecords(f.job.idempotency_key)).toHaveLength(1);
    expect(f.outbox.list()).toEqual(beforeOutbox); expect(f.job).toEqual(beforeJob);
    expect(f.observer).toHaveBeenCalledTimes(1); expect(f.fetchResult).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(f.anomaly.mock.calls)).not.toContain("sentinel");
  });
  it("recovers persisted ready jobs on restart and skips an already recorded conversion", async () => {
    const f = setup(); f.pipeline.dispose();
    const recovered = f.make(new ExternalIfcReadyStore(f.jobsFile), new ConversionLedger(f.ledgerFile));
    expect(recovered.pipeline.resumeValidationPublications()).toEqual([f.job.ifc_ready_job_id]);
    expect(recovered.pipeline.resumeValidationPublications()).toEqual([]);
    await vi.advanceTimersByTimeAsync(5_000);
    recovered.pipeline.dispose();
    const again = f.make(new ExternalIfcReadyStore(f.jobsFile), new ConversionLedger(f.ledgerFile));
    expect(again.pipeline.resumeValidationPublications()).toEqual([]);
    expect(f.fetchResult).toHaveBeenCalledTimes(1); expect(f.outbox.list()).toEqual([]);
    expect(f.observer).not.toHaveBeenCalled();
  });
  it("does not let old conversion history suppress publication for a new conversion", async () => {
    const f = setup(); await f.publishValidation(f.job, f.result);
    f.store.markDispatched(f.job.ifc_ready_job_id, "job_2", "queued");
    f.store.recordConversionOutcome(f.job.ifc_ready_job_id, "ready", "callback_2");
    f.ledger.upsert({ ...f.ledger.get(f.job.idempotency_key)!, conversion_job_id: "job_2" }, time);
    f.result.conversion_job_id = "job_2";
    expect(f.pipeline.resumeValidationPublications()).toEqual([f.job.ifc_ready_job_id]);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(f.ledger.listValidationRecords(f.job.idempotency_key).map(r => r.conversionJobId)).toEqual(["job_1", "job_2"]);
    expect(f.outbox.list()).toEqual([]); expect(f.observer).not.toHaveBeenCalled();
  });
  it.each(["before_fetch", "during_fetch"])("rejects binding drift %s", async phase => {
    const f = setup(); f.pipeline.resumeValidationPublications();
    if (phase === "before_fetch") f.job.source_ifc_etag = "changed";
    else f.fetchResult.mockImplementationOnce(async () => { f.job.source_ifc_etag = "changed"; return f.result; });
    await vi.runAllTimersAsync();
    expect(f.publishValidation).not.toHaveBeenCalled();
    expect(f.ledger.listValidationRecords(f.job.idempotency_key)).toEqual([]);
    expect(f.outbox.list()).toEqual([]); expect(f.observer).not.toHaveBeenCalled();
  });
  it("limits retries to three per process, reports exhaustion and can resume after restart", async () => {
    const f = setup(); f.fetchResult.mockRejectedValue(new Error("https://private.test/?secret=sentinel"));
    f.pipeline.resumeValidationPublications();
    await vi.advanceTimersByTimeAsync(4_999); expect(f.fetchResult).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(f.fetchResult).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10_000); expect(f.fetchResult).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(20_000); expect(f.fetchResult).toHaveBeenCalledTimes(3);
    expect(f.pipeline.resumeValidationPublications()).toEqual([]); await vi.runAllTimersAsync();
    expect(f.fetchResult).toHaveBeenCalledTimes(3);
    expect(f.anomaly.mock.calls.some(call => call[2].reason === "validation_retry_exhausted" && call[2].attempt === 3)).toBe(true);
    expect(JSON.stringify(f.anomaly.mock.calls)).not.toContain("sentinel");
    f.pipeline.dispose(); f.fetchResult.mockResolvedValue(f.result);
    const recovered = f.make(new ExternalIfcReadyStore(f.jobsFile), new ConversionLedger(f.ledgerFile));
    recovered.pipeline.resumeValidationPublications(); await vi.runAllTimersAsync();
    expect(new ConversionLedger(f.ledgerFile).listValidationRecords(f.job.idempotency_key)).toHaveLength(1);
  });
  it.each(["queued", "fetching"])("does not publish after disposal while %s", async phase => {
    const f = setup(); f.pipeline.resumeValidationPublications();
    if (phase === "queued") f.pipeline.dispose();
    else f.fetchResult.mockImplementationOnce(async () => { f.pipeline.dispose(); return f.result; });
    await vi.runAllTimersAsync();
    expect(f.publishValidation).not.toHaveBeenCalled(); expect(f.outbox.list()).toEqual([]);
    expect(f.pipeline.resumeValidationPublications()).toEqual([]);
  });
  it("deduplicates the initial publication and recovery while metadata is pending", async () => {
    const f = setup(); let resolve!: (result: ConversionSourceReadResult) => void;
    f.readMetadata.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    f.pipeline.resumeValidationPublications();
    const initial = f.pipeline.ingestStreamingResult("job_1", { result: f.result, source: "auto-poll" });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(f.publishValidation).toHaveBeenCalledTimes(1);
    resolve(f.metadata); await initial; await vi.runAllTimersAsync();
    expect(f.publishValidation).toHaveBeenCalledTimes(1);
    expect(f.ledger.listValidationRecords(f.job.idempotency_key)).toHaveLength(1);
    expect(f.observer).toHaveBeenCalledTimes(1); expect(f.outbox.list()).toHaveLength(1);
  });
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IfcReadyConversionPipeline } from "../src/services/ifcReadyConversionPipeline.js";
import { ExternalIfcReadyStore } from "../src/services/externalIfcReadyStore.js";
import { ConversionLedger } from "../src/services/conversionLedger.js";
import { ConversionDispatchQueue } from "../src/services/conversionDispatchQueue.js";
import { CallbackOutbox } from "../src/services/callbackOutbox.js";
import {
  toInternalIfcReadyEvent,
  type StreamingConversionBinding,
  type StreamingConversionClient,
  type StreamingConversionResult,
} from "../src/services/streamingConversionClient.js";
import type { ExternalIfcReadyEvent, IfcReadyIntakeJob } from "../src/types.js";

const roots: string[] = [];
const pipelines: IfcReadyConversionPipeline[] = [];
afterEach(() => {
  pipelines.splice(0).forEach((pipeline) => pipeline.dispose());
  roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true }));
});

const EVENT: ExternalIfcReadyEvent = {
  event: "ifc_ready",
  tenant_id: "tenant_1",
  project_id: "project_1",
  external_model_version_id: "version_1",
  source_ifc: { ref: "http://minio.internal:9000/bim-control/899/main/p1/model.ifc", etag: "etag_1", format: "ifc" },
};

const SCHEDULE = {
  artifact_id: "schedule_0123456789abcdef",
  format: "csv" as const,
  filename: "schedule.csv",
  checksum_sha256: "a".repeat(64),
  size_bytes: 10,
  etag: "etag_s",
  local_path: "/workspace/storage/ifc-cache/j/schedule.csv",
  host_local_path: "D:\\storage/ifc-cache/j/schedule.csv",
};

function setup(hooks: {
  fetchCompanionFiles?: (job: IfcReadyIntakeJob) => Promise<unknown>;
  dispatchExtras?: (job: IfcReadyIntakeJob) => Pick<StreamingConversionBinding, "scheduleArtifact" | "lineageReport">;
  onConversionReady?: (job: IfcReadyIntakeJob, result: StreamingConversionResult) => void;
}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lineage-hooks-"));
  roots.push(root);
  const store = new ExternalIfcReadyStore(path.join(root, "jobs.json"));
  const ledger = new ConversionLedger(path.join(root, "ledger.json"));
  const bindings: StreamingConversionBinding[] = [];
  const order: string[] = [];
  const streamingClient = {
    createConversionJob: vi.fn(async (_event: ExternalIfcReadyEvent, binding: StreamingConversionBinding) => {
      order.push("dispatch");
      bindings.push(binding);
      return { conversion_job_id: "stream_conv_1", status: "queued" };
    }),
  } as unknown as StreamingConversionClient;
  const pipeline = new IfcReadyConversionPipeline({
    store,
    ledger,
    streamingClient,
    queue: new ConversionDispatchQueue(),
    outbox: new CallbackOutbox(),
    download: async (_ref, jobId) => ({
      ok: true,
      local_path: `/workspace/storage/ifc-cache/${jobId}/source.ifc`,
      host_local_path: `D:\\storage/ifc-cache/${jobId}/source.ifc`,
      size_bytes: 1,
    }) as never,
    onAfterDownload: () => {
      order.push("after_download");
    },
    fetchCompanionFiles: hooks.fetchCompanionFiles
      ? async (job) => {
          order.push("companion");
          return hooks.fetchCompanionFiles!(job);
        }
      : undefined,
    dispatchExtras: hooks.dispatchExtras,
    onConversionReady: hooks.onConversionReady,
    config: {
      storageRoot: root,
      ifcDownloadTimeoutSeconds: 1,
      ifcDownloadStrict: true,
      conversionPollEnabled: false,
      conversionPollIntervalSeconds: 1,
      conversionPollMaxAttempts: 1,
      cloudCallbackBaseUrl: "",
    },
  });
  pipelines.push(pipeline);
  const accept = () =>
    pipeline.accept({
      event: EVENT,
      correlationId: "corr_1",
      idempotencyKey: "mw_0123456789abcdef",
      tenantId: "tenant_1",
      projectId: "project_1",
      externalModelVersionId: "version_1",
      intakeSource: "minio_watch",
    });
  return { pipeline, store, bindings, order, accept, jobsFile: path.join(root, "jobs.json") };
}

describe("lineage report pipeline hooks", () => {
  it("IFC 下載後先抓 companion 檔，dispatch 帶上 schedule_artifact 與報表身分", async () => {
    const seen: IfcReadyIntakeJob[] = [];
    const f = setup({
      fetchCompanionFiles: async (job) => {
        seen.push(job);
      },
      dispatchExtras: (job) => ({
        scheduleArtifact: SCHEDULE,
        lineageReport: { source_bundle_id: job.idempotency_key, pipeline_job_id: job.ifc_ready_job_id },
      }),
    });

    const accepted = await f.accept();
    expect(accepted.kind).toBe("accepted");
    await vi.waitFor(() => expect(f.bindings).toHaveLength(1));

    expect(seen[0]?.local_path).toMatch(/source\.ifc$/);
    expect(f.order).toEqual(["companion", "after_download", "dispatch"]);
    const jobId = accepted.kind === "accepted" ? accepted.job.ifc_ready_job_id : "";
    expect(f.bindings[0]).toMatchObject({
      scheduleArtifact: SCHEDULE,
      lineageReport: { source_bundle_id: "mw_0123456789abcdef", pipeline_job_id: jobId },
      localPath: `/workspace/storage/ifc-cache/${jobId}/source.ifc`,
    });
  });

  it("抓 companion 檔期間重啟時，job 仍算下載中，重送會重新收件而不是卡住", async () => {
    let release: (() => void) | undefined;
    const f = setup({
      fetchCompanionFiles: () => new Promise<void>((resolve) => { release = resolve; }),
    });
    const pending = f.accept();
    await vi.waitFor(() => expect(release).toBeDefined());

    const [job] = f.store.list();
    expect(job?.download_status).toBe("downloading");
    const reloaded = new ExternalIfcReadyStore(f.jobsFile);
    expect(reloaded.get(job!.ifc_ready_job_id)?.download_status).toBe("failed");

    release!();
    expect((await pending).kind).toBe("accepted");
  });

  it("companion 檔或 dispatch extras 失敗都不影響轉檔派工", async () => {
    const f = setup({
      fetchCompanionFiles: async () => {
        throw new Error("minio down");
      },
      dispatchExtras: () => {
        throw new Error("sidecar unreadable");
      },
    });
    expect((await f.accept()).kind).toBe("accepted");
    await vi.waitFor(() => expect(f.bindings).toHaveLength(1));
    expect(f.bindings[0]).not.toHaveProperty("scheduleArtifact");
    expect(f.bindings[0]).not.toHaveProperty("lineageReport");
  });

  it("轉檔 ready 後通知報表收集；失敗的轉檔不通知；通知出錯不影響 ingest", async () => {
    const ready = vi.fn();
    const f = setup({ onConversionReady: ready });
    await f.accept();
    await vi.waitFor(() => expect(f.bindings).toHaveLength(1));
    const result: StreamingConversionResult = {
      conversion_job_id: "stream_conv_1",
      correlation_id: "corr_1",
      status: "succeeded",
      ready: true,
      raw: { lineage_alignment: { status: "generated" } },
    };
    const outcome = await f.pipeline.ingestStreamingResult("stream_conv_1", { result, source: "auto-poll" });
    expect(outcome.ok).toBe(true);
    expect(ready).toHaveBeenCalledTimes(1);
    expect(ready.mock.calls[0]![0]).toMatchObject({ conversion_job_id: "stream_conv_1", conversion_status: "ready" });
    expect(ready.mock.calls[0]![1]).toBe(result);

    const failing = setup({
      onConversionReady: () => {
        throw new Error("collector crashed");
      },
    });
    await failing.accept();
    await vi.waitFor(() => expect(failing.bindings).toHaveLength(1));
    const ok = await failing.pipeline.ingestStreamingResult("stream_conv_1", { result, source: "auto-poll" });
    expect(ok.ok).toBe(true);
  });

  it("轉檔失敗時不通知報表收集", async () => {
    const ready = vi.fn();
    const f = setup({ onConversionReady: ready });
    await f.accept();
    await vi.waitFor(() => expect(f.bindings).toHaveLength(1));
    await f.pipeline.ingestStreamingResult("stream_conv_1", {
      result: { conversion_job_id: "stream_conv_1", correlation_id: "corr_1", status: "failed", ready: false, reason: "boom", raw: {} },
      source: "auto-poll",
    });
    expect(ready).not.toHaveBeenCalled();
  });
});

describe("toInternalIfcReadyEvent lineage fields", () => {
  it("只有 binding 帶值時才加入 schedule_artifact 與 lineage_report", () => {
    const bare = toInternalIfcReadyEvent(EVENT, { correlationId: "corr_1", externalModelVersionId: "version_1" });
    expect(bare).not.toHaveProperty("schedule_artifact");
    expect(bare).not.toHaveProperty("lineage_report");

    const payload = toInternalIfcReadyEvent(EVENT, {
      correlationId: "corr_1",
      externalModelVersionId: "version_1",
      scheduleArtifact: SCHEDULE,
      lineageReport: { source_bundle_id: "mw_0123456789abcdef", pipeline_job_id: "ifcready_1" },
    });
    expect(payload.schedule_artifact).toEqual(SCHEDULE);
    expect(payload.lineage_report).toEqual({ source_bundle_id: "mw_0123456789abcdef", pipeline_job_id: "ifcready_1" });
  });
});

/**
 * IfcReadyConversionPipeline — deep module owning IFC-ready accept through
 * conversion terminal (see root CONTEXT.md + openspec deepen-ifc-ready-conversion-pipeline).
 *
 * Owns: accept (create/replay/download/enqueue), serial dispatch context,
 * in-process poller registry, ingest (job terminal + outbox + ledger),
 * retryDispatch / prioritize, dispose / hasPendingDispatch.
 *
 * Does NOT own: Review Session, kitPool, EventLog, ArtifactHealthLedger.
 * Auto-session and similar observers hang off onConversionTerminal only.
 */

import type { StructLogger } from "../lib/structLog.js";
import type {
  ConversionQualityMetricsSummary,
  ExternalIfcReadyEvent,
  IfcReadyIntakeJob,
} from "../types.js";
import type { CallbackOutbox, CallbackOutboxEntry } from "./callbackOutbox.js";
import type { ConversionDispatchQueue } from "./conversionDispatchQueue.js";
import type { ConversionLedger } from "./conversionLedger.js";
import type { ExternalIfcReadyStore } from "./externalIfcReadyStore.js";
import {
  downloadIfcToSharedVolume,
  type IfcDownloadResult,
} from "./ifcDownloader.js";
import { maskPresignedRef, stableHttpRefIdentity } from "./presignedRef.js";
import {
  buildQualityMetricsSummary,
  isTerminalConversionResult,
  type PollerHandle,
  type StreamingConversionClient,
  type StreamingConversionResult,
} from "./streamingConversionClient.js";

/** Already-authenticated, normalized domain input for accept (CONTEXT.md). */
export type IntakeCommand = {
  event: ExternalIfcReadyEvent;
  correlationId: string;
  idempotencyKey: string;
  tenantId: string;
  projectId: string;
  externalModelVersionId: string;
};

export type ConversionResultReport = {
  correlation_id: string;
  conversion_job_id?: string | null;
  status: "ready" | "succeeded" | "failed";
  artifacts?: {
    usdc_ref?: string | null;
    element_mapping_ref?: string | null;
    manifest_ref?: string | null;
  };
  artifact_summary?: Record<string, unknown>;
  reason?: string | null;
  retryable?: boolean;
};

/** Conversion terminal payload for onConversionTerminal (ready | failed only). */
export type ConversionTerminalEvent = {
  status: "ready" | "failed";
  job: IfcReadyIntakeJob;
  conversionJobId: string | null;
  artifacts: {
    usdc_ref?: string | null;
    element_mapping_ref?: string | null;
    manifest_ref?: string | null;
  };
  qualitySummary: ConversionQualityMetricsSummary | null;
  report: ConversionResultReport;
};

export type AcceptResult =
  | { kind: "replay"; job: IfcReadyIntakeJob }
  | {
      kind: "conflict";
      ifc_ready_job_id: string;
      reason: "source_ifc_ref_mismatch";
    }
  | {
      kind: "download_failed";
      ifc_ready_job_id: string;
      reason: string;
      message: string;
      download_status: "failed";
    }
  | { kind: "accepted"; job: IfcReadyIntakeJob };

/** Pipeline-layer ingest result — observer output stays bound to this ingest call. */
export type IngestResult<TTerminalObserverResult = void> =
  | {
      ok: true;
      ifc_ready_job: IfcReadyIntakeJob | undefined;
      callback: CallbackOutboxEntry;
      terminal_observer_result: TTerminalObserverResult | undefined;
    }
  | { ok: false; status: number; detail: string };

export type StreamingIngestResult<TTerminalObserverResult = void> =
  | {
      ok: true;
      outcome: Extract<IngestResult<TTerminalObserverResult>, { ok: true }>;
      conversion_status: "ready" | "failed";
      failed: boolean;
    }
  | {
      ok: false;
      status: number;
      detail: string;
      conversion_job_id?: string;
      conversion_status?: string;
    };

export type RetryDispatchResult =
  | { ok: true; queue_position: number }
  | {
      ok: false;
      code: "not_found" | "not_retryable" | "context_lost";
      status: 404 | 409 | 422;
      detail: string;
      job?: IfcReadyIntakeJob;
    };

export type PrioritizeResult =
  | {
      ok: true;
      queued_order: string[];
      status: string;
      queue_position: number | null;
    }
  | {
      ok: false;
      code: "not_found" | "not_prioritizable" | "not_in_queue";
      status: 404 | 409;
      detail: string;
      job?: IfcReadyIntakeJob;
    };

type PendingDispatchEvent = {
  event: ExternalIfcReadyEvent;
  correlationId: string;
  externalModelVersionId: string;
  localPath: string;
  hostLocalPath: string;
};

export type IfcReadyConversionPipelineConfig = {
  storageRoot: string;
  storageHostRoot?: string | null;
  ifcDownloadTimeoutSeconds: number;
  ifcDownloadStrict: boolean;
  conversionPollEnabled: boolean;
  conversionPollIntervalSeconds: number;
  conversionPollMaxAttempts: number;
  cloudCallbackBaseUrl: string;
  conversionProfile?: string;
};

export type IfcReadyConversionPipelineDeps<TTerminalObserverResult = void> = {
  store: ExternalIfcReadyStore;
  streamingClient: StreamingConversionClient;
  queue: ConversionDispatchQueue;
  outbox: CallbackOutbox;
  ledger: ConversionLedger;
  download?: (
    sourceRef: string,
    jobId: string,
    options: {
      storageRoot: string;
      storageHostRoot?: string | null;
      timeoutMs?: number;
      fallbackOnFetchError?: boolean;
    },
  ) => Promise<IfcDownloadResult>;
  config: IfcReadyConversionPipelineConfig;
  /**
   * Sync observer after job terminal + outbox + ledger at conversion terminal.
   * Its return value is carried by the same ingest result so adapters need no
   * cross-request mutable slot. Failures must not affect ingest/outbox. Not
   * called for download_failed / dispatch_failed.
   */
  onConversionTerminal?: (event: ConversionTerminalEvent) => TTerminalObserverResult;
  /**
   * Best-effort after successful download, before enqueue (artifact health first cut stays app-owned).
   * Return value is ignored.
   */
  onAfterDownload?: (job: IfcReadyIntakeJob) => unknown;
  structLog?: StructLogger;
};

const DEFAULT_CONVERSION_PROFILE = "ifcopenshell_openusd_identity";

function normalizeConversionReportStatus(
  status: "ready" | "succeeded" | "failed",
): "ready" | "failed" {
  return status === "failed" ? "failed" : "ready";
}

export class IfcReadyConversionPipeline<TTerminalObserverResult = void> {
  private readonly store: ExternalIfcReadyStore;
  private readonly streamingClient: StreamingConversionClient;
  private readonly queue: ConversionDispatchQueue;
  private readonly outbox: CallbackOutbox;
  private readonly ledger: ConversionLedger;
  private readonly download: NonNullable<
    IfcReadyConversionPipelineDeps<TTerminalObserverResult>["download"]
  >;
  private readonly config: IfcReadyConversionPipelineConfig;
  private readonly onConversionTerminal:
    | ((event: ConversionTerminalEvent) => TTerminalObserverResult)
    | undefined;
  private readonly onAfterDownload: (job: IfcReadyIntakeJob) => unknown;
  private readonly structLog: StructLogger | undefined;
  private readonly conversionProfile: string;

  private readonly pendingDispatchEvents = new Map<string, PendingDispatchEvent>();
  private readonly pollerRegistry = new Map<string, PollerHandle>();
  private disposed = false;

  constructor(deps: IfcReadyConversionPipelineDeps<TTerminalObserverResult>) {
    this.store = deps.store;
    this.streamingClient = deps.streamingClient;
    this.queue = deps.queue;
    this.outbox = deps.outbox;
    this.ledger = deps.ledger;
    this.download = deps.download ?? downloadIfcToSharedVolume;
    this.config = deps.config;
    this.onConversionTerminal = deps.onConversionTerminal;
    this.onAfterDownload = deps.onAfterDownload ?? (() => undefined);
    this.structLog = deps.structLog;
    this.conversionProfile =
      deps.config.conversionProfile ?? DEFAULT_CONVERSION_PROFILE;

    // Wire serial dispatcher once at construction (before any enqueue).
    this.queue.setDispatcher(async (jobId) => {
      await this.dispatchJob(jobId);
    });
  }

  // ---------------------------------------------------------------------------
  // Accept (J2)
  // ---------------------------------------------------------------------------

  async accept(command: IntakeCommand): Promise<AcceptResult> {
    const { event } = command;

    const existing = this.store.findExisting(
      command.idempotencyKey,
      command.correlationId,
    );
    let job: IfcReadyIntakeJob;
    if (existing) {
      if (
        stableHttpRefIdentity(existing.source_ifc_ref) !==
        stableHttpRefIdentity(event.source_ifc.ref)
      ) {
        return {
          kind: "conflict",
          ifc_ready_job_id: existing.ifc_ready_job_id,
          reason: "source_ifc_ref_mismatch",
        };
      }
      const resumed =
        this.ledger.get(existing.idempotency_key) === null
          ? this.store.resumeRestartInterruptedDownload(
              existing.ifc_ready_job_id,
              event,
              {
                correlationId: command.correlationId,
                idempotencyKey: command.idempotencyKey,
                tenantId: command.tenantId,
                projectId: command.projectId,
                externalModelVersionId: command.externalModelVersionId,
              },
            )
          : undefined;
      if (!resumed) {
        const replayed =
          this.store.markIdempotentReplay(existing.ifc_ready_job_id) ?? existing;
        return { kind: "replay", job: replayed };
      }
      job = resumed;
    } else {
      job = this.store.create(event, {
        correlationId: command.correlationId,
        idempotencyKey: command.idempotencyKey,
        tenantId: command.tenantId,
        projectId: command.projectId,
        externalModelVersionId: command.externalModelVersionId,
      });
      this.store.markDownloading(job.ifc_ready_job_id);
    }

    const downloadResult = await this.download(
      event.source_ifc.ref,
      job.ifc_ready_job_id,
      {
        storageRoot: this.config.storageRoot,
        storageHostRoot: this.config.storageHostRoot,
        timeoutMs: this.config.ifcDownloadTimeoutSeconds * 1000,
        fallbackOnFetchError: !this.config.ifcDownloadStrict,
      },
    );
    if (!downloadResult.ok) {
      this.store.markDownloadFailed(
        job.ifc_ready_job_id,
        `${downloadResult.reason}: ${downloadResult.message}`,
      );
      return {
        kind: "download_failed",
        ifc_ready_job_id: job.ifc_ready_job_id,
        reason: downloadResult.reason,
        message: downloadResult.message,
        download_status: "failed",
      };
    }

    this.store.markDownloaded(
      job.ifc_ready_job_id,
      downloadResult.local_path,
      downloadResult.host_local_path,
    );
    const downloadedJob = this.store.get(job.ifc_ready_job_id) ?? job;
    try {
      await this.onAfterDownload(downloadedJob);
    } catch {
      /* artifact-health / observer failures must not block enqueue */
    }

    // INVARIANT: pending.set MUST be synchronous before enqueue — no await between.
    this.pendingDispatchEvents.set(job.ifc_ready_job_id, {
      event,
      correlationId: command.correlationId,
      externalModelVersionId: command.externalModelVersionId,
      localPath: downloadResult.local_path,
      hostLocalPath: downloadResult.host_local_path,
    });
    this.queue.enqueue(job.ifc_ready_job_id);
    const queuePosition = this.queue.getQueuePosition(job.ifc_ready_job_id);
    this.store.markQueuedForConversion(
      job.ifc_ready_job_id,
      queuePosition ?? 0,
    );

    // ConversionLedger queued — best-effort; failures must not block intake.
    try {
      this.ledger.upsert(
        {
          idempotency_key: job.idempotency_key,
          correlation_id: command.correlationId ?? null,
          project_id: event.project_id,
          project_display_name: event.project_display_name ?? event.project_id,
          category: event.model_category ?? "",
          external_model_version_id: event.external_model_version_id ?? "",
          conversion_job_id: job.conversion_job_id ?? null,
          status: "queued",
        },
        new Date().toISOString(),
      );
    } catch {
      /* ledger 失敗不卡 intake */
    }

    const finalJob = this.store.get(job.ifc_ready_job_id) ?? job;
    return { kind: "accepted", job: finalJob };
  }

  // ---------------------------------------------------------------------------
  // Ingest / poller
  // ---------------------------------------------------------------------------

  ingest(
    report: ConversionResultReport,
    qualitySummary: ConversionQualityMetricsSummary | null = null,
  ): IngestResult<TTerminalObserverResult> {
    const normalizedStatus = normalizeConversionReportStatus(report.status);
    const job = this.store.getByCorrelation(
      report.correlation_id,
      report.conversion_job_id ?? null,
    );
    if (!job) {
      return { ok: false, status: 404, detail: "No IFC-ready job for correlation_id." };
    }
    const conversionJobId =
      report.conversion_job_id || job.conversion_job_id || null;
    const targetUrl = job.callback_url || this.config.cloudCallbackBaseUrl || null;

    let payload: Record<string, unknown>;
    let event: "conversion_result_ready" | "conversion_failed";
    if (normalizedStatus === "ready") {
      event = "conversion_result_ready";
      payload = {
        event,
        trace_id: job.ifc_ready_job_id,
        tenant_id: job.tenant_id,
        project_id: job.project_id,
        external_model_version_id: job.external_model_version_id,
        external_conversion_task_id: job.external_conversion_task_id ?? null,
        conversion_job_id: conversionJobId,
        correlation_id: job.correlation_id,
        status: "ready",
        source_ifc: {
          ref: maskPresignedRef(job.source_ifc_ref),
          etag: job.source_ifc_etag,
        },
        artifacts: {
          usdc_ref: report.artifacts?.usdc_ref ?? null,
          element_mapping_ref: report.artifacts?.element_mapping_ref ?? null,
          manifest_ref: report.artifacts?.manifest_ref ?? null,
        },
        artifact_summary: report.artifact_summary ?? {},
      };
    } else {
      event = "conversion_failed";
      payload = {
        event,
        trace_id: job.ifc_ready_job_id,
        tenant_id: job.tenant_id,
        project_id: job.project_id,
        external_model_version_id: job.external_model_version_id,
        conversion_job_id: conversionJobId,
        correlation_id: job.correlation_id,
        status: "failed",
        reason: report.reason || "conversion_failed",
        retryable: report.retryable ?? false,
      };
    }

    // Crash-window recovery: outbox persistence happens before the job can
    // durably link callback_outbox_id.  A restarted poller may therefore
    // ingest the same terminal result again.  Reuse the already-persisted
    // terminal entry by its authority binding instead of emitting a duplicate
    // cloud callback.  Keep the first entry's target/payload as the durable
    // authority for this terminal event.
    const entry = this.outbox.list().find((candidate) =>
      candidate.event === event &&
      candidate.correlation_id === job.correlation_id &&
      candidate.external_model_version_id === job.external_model_version_id &&
      candidate.conversion_job_id === conversionJobId
    ) ?? this.outbox.enqueue({
      event,
      targetUrl,
      correlationId: job.correlation_id,
      externalModelVersionId: job.external_model_version_id,
      conversionJobId,
      payload,
    });
    const updatedJob = this.store.recordConversionOutcome(
      job.ifc_ready_job_id,
      normalizedStatus,
      entry.outbox_id,
      report.artifacts?.manifest_ref ?? null,
      normalizedStatus === "failed"
        ? report.reason || "conversion_failed"
        : null,
    );

    try {
      const ledgerStatus = normalizedStatus === "ready" ? "ready" : "failed";
      const ledgerNow = new Date().toISOString();
      this.ledger.upsert(
        {
          idempotency_key: job.idempotency_key,
          correlation_id: job.correlation_id,
          project_id: job.project_id,
          project_display_name: job.project_display_name ?? job.project_id,
          category: job.category ?? "",
          external_model_version_id: job.external_model_version_id ?? "",
          conversion_job_id: conversionJobId,
          status: ledgerStatus,
        },
        ledgerNow,
      );
      this.ledger.recordCallbackOutcome(
        job.idempotency_key,
        {
          status: ledgerStatus,
          ...(normalizedStatus === "ready"
            ? { usdc_key: report.artifacts?.usdc_ref ?? null }
            : {}),
          coverage_report: qualitySummary ?? report.artifact_summary ?? null,
        },
        ledgerNow,
      );
    } catch {
      /* ledger 回填失敗不卡 conversion result ingest / callback outbox */
    }

    const terminalJob =
      this.store.get(job.ifc_ready_job_id) ?? updatedJob ?? job;

    // Conversion terminal only (ready|failed). download_failed / dispatch_failed never reach here.
    let terminalObserverResult: TTerminalObserverResult | undefined;
    try {
      terminalObserverResult = this.onConversionTerminal?.({
        status: normalizedStatus,
        job: terminalJob,
        conversionJobId,
        artifacts: {
          usdc_ref: report.artifacts?.usdc_ref ?? null,
          element_mapping_ref: report.artifacts?.element_mapping_ref ?? null,
          manifest_ref: report.artifacts?.manifest_ref ?? null,
        },
        qualitySummary,
        report,
      });
    } catch (error) {
      // Observer failure is deliberately non-fatal, but it must remain
      // diagnosable without logging a potentially sensitive error message.
      this.structLog
        ?.withTraceId(job.ifc_ready_job_id)
        .anomaly(
          "ifcReadyConversionPipeline",
          "onConversionTerminal observer failed",
          {
            anomaly_kind: "unexpected_state",
            reason: "on_conversion_terminal_failed",
            error_name: error instanceof Error ? error.name : typeof error,
            ifc_ready_job_id: job.ifc_ready_job_id,
            conversion_job_id: conversionJobId,
            conversion_status: normalizedStatus,
          },
        );
    }

    return {
      ok: true,
      ifc_ready_job: this.store.get(job.ifc_ready_job_id) ?? updatedJob,
      callback: entry,
      terminal_observer_result: terminalObserverResult,
    };
  }

  async ingestStreamingResult(
    conversionJobId: string,
    options: {
      result?: StreamingConversionResult;
      source: "manual" | "auto-poll";
    } = { source: "manual" },
  ): Promise<StreamingIngestResult<TTerminalObserverResult>> {
    // Manual endpoint cancels auto-poller first to avoid double ingest.
    if (options.source === "manual") {
      this.cancelPoller(conversionJobId);
    }

    const result =
      options.result ??
      (await this.streamingClient.fetchConversionResult(conversionJobId));
    const correlationId = result.correlation_id;
    if (!correlationId) {
      return {
        ok: false,
        status: 422,
        detail: "streaming conversion result has no correlation_id",
      };
    }
    const { terminal, failed } = isTerminalConversionResult(result);
    if (!terminal) {
      return {
        ok: false,
        status: 409,
        detail: "conversion result is not terminal yet",
        conversion_job_id: conversionJobId,
        conversion_status: result.model_status ?? result.status ?? "unknown",
      };
    }
    const report: ConversionResultReport = {
      correlation_id: correlationId,
      conversion_job_id: result.conversion_job_id,
      status: failed ? "failed" : "ready",
      artifacts: {
        usdc_ref: result.usdc_ref ?? null,
        element_mapping_ref: result.element_mapping_ref ?? null,
        manifest_ref: result.manifest_ref ?? null,
      },
      reason: failed ? result.reason || "conversion_failed" : undefined,
      retryable: false,
    };
    const qualitySummary = buildQualityMetricsSummary(result);
    const outcome = this.ingest(report, qualitySummary);
    if (!outcome.ok) {
      return { ok: false, status: outcome.status, detail: outcome.detail };
    }
    return {
      ok: true,
      outcome,
      conversion_status: failed ? "failed" : "ready",
      failed,
    };
  }

  cancelPoller(conversionJobId: string): void {
    const existing = this.pollerRegistry.get(conversionJobId);
    if (existing) {
      existing.cancel();
      this.pollerRegistry.delete(conversionJobId);
    }
  }

  // ---------------------------------------------------------------------------
  // Operator recovery
  // ---------------------------------------------------------------------------

  prioritize(ifcReadyJobId: string): PrioritizeResult {
    const job = this.store.get(ifcReadyJobId);
    if (!job) {
      return {
        ok: false,
        code: "not_found",
        status: 404,
        detail: "Ifc-ready job not found.",
      };
    }
    if (job.status !== "queued_for_conversion") {
      return {
        ok: false,
        code: "not_prioritizable",
        status: 409,
        detail: `Job not prioritizable in status '${job.status}'.`,
        job,
      };
    }
    if (!this.queue.prioritize(ifcReadyJobId)) {
      return {
        ok: false,
        code: "not_in_queue",
        status: 409,
        detail: "Job is in-flight or not in the queue.",
        job,
      };
    }
    const queuedOrder = this.queue.getQueuedJobIds();
    queuedOrder.forEach((qid, idx) =>
      this.store.markQueuedForConversion(qid, idx + 1),
    );
    const updated = this.store.get(ifcReadyJobId);
    return {
      ok: true,
      queued_order: queuedOrder,
      status: updated?.status ?? "queued_for_conversion",
      queue_position: updated?.queue_position ?? null,
    };
  }

  retryDispatch(ifcReadyJobId: string): RetryDispatchResult {
    const job = this.store.get(ifcReadyJobId);
    if (!job) {
      return {
        ok: false,
        code: "not_found",
        status: 404,
        detail: "Ifc-ready job not found.",
      };
    }
    if (!["dispatch_failed", "dropped_on_restart"].includes(job.status)) {
      return {
        ok: false,
        code: "not_retryable",
        status: 409,
        detail: `Job not retryable in status '${job.status}'.`,
        job,
      };
    }
    if (!this.pendingDispatchEvents.has(ifcReadyJobId)) {
      const rebuilt = this.rebuildPendingDispatchFromDownloadedJob(job);
      if (!rebuilt) {
        return {
          ok: false,
          code: "context_lost",
          status: 422,
          detail:
            "Dispatch context lost (coordinator restart/drain); please re-POST the ifc-ready job.",
          job,
        };
      }
      this.pendingDispatchEvents.set(ifcReadyJobId, rebuilt);
    }
    const pos = this.queue.requeue(ifcReadyJobId);
    this.store.markQueuedForConversion(ifcReadyJobId, pos);
    return { ok: true, queue_position: pos };
  }

  // ---------------------------------------------------------------------------
  // Lifecycle / test observation
  // ---------------------------------------------------------------------------

  /**
   * Cancel pollers, drain undischarged queue (dropped_on_restart), clear pending.
   * Idempotent.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const handle of this.pollerRegistry.values()) {
      handle.cancel();
    }
    this.pollerRegistry.clear();
    const droppedJobIds = this.queue.drain();
    for (const jobId of droppedJobIds) {
      this.store.markDroppedOnRestart(jobId);
      this.pendingDispatchEvents.delete(jobId);
    }
    // dispose 語義是 process lifecycle 結束 → 全清最安全（含 dispatch_failed 殘留）。
    this.pendingDispatchEvents.clear();
  }

  /** @internal test-only: whether enqueue-time dispatch context still exists for jobId. */
  hasPendingDispatch(jobId: string): boolean {
    return this.pendingDispatchEvents.has(jobId);
  }

  /**
   * Recreate only the in-process pollers whose durable jobs prove a dispatched,
   * non-terminal conversion. Must be called after the terminal observer is
   * wired so an immediately available result follows the normal ingest path.
   */
  resumePersistedPollers(): number {
    if (this.disposed || !this.config.conversionPollEnabled) return 0;
    let resumed = 0;
    for (const job of this.store.list()) {
      const conversionJobId = job.conversion_job_id;
      if (
        job.status !== "dispatched" ||
        !conversionJobId ||
        job.callback_outbox_id ||
        this.pollerRegistry.has(conversionJobId)
      ) {
        continue;
      }
      this.schedulePollerForConversion(conversionJobId, job.ifc_ready_job_id);
      resumed += 1;
    }
    return resumed;
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private async dispatchJob(jobId: string): Promise<void> {
    const pending = this.pendingDispatchEvents.get(jobId);
    if (!pending) {
      this.store.markDispatchFailed(
        jobId,
        "pending dispatch event lost before worker pickup",
      );
      return;
    }
    try {
      const rootTraceId = jobId;
      const dispatch = await this.streamingClient.createConversionJob(
        pending.event,
        {
          correlationId: pending.correlationId,
          externalModelVersionId: pending.externalModelVersionId,
          localPath: pending.localPath,
          hostLocalPath: pending.hostLocalPath,
          conversionProfile: this.conversionProfile,
        },
        rootTraceId,
      );
      this.structLog
        ?.withTraceId(rootTraceId)
        .network("ifcReadyDispatch", "conversion dispatched", {
          direction: "outbound",
          protocol: "http",
          peer: "streaming-server",
          status: dispatch.status,
          path: "/api/conversions/ifc-to-usdc",
        });
      this.store.markDispatched(
        jobId,
        dispatch.conversion_job_id,
        dispatch.status,
      );
      // delete-on-success：僅派工成功才刪 pending，使 dispatch_failed job 可被 retry 重派。
      this.pendingDispatchEvents.delete(jobId);
      if (
        !this.disposed &&
        this.config.conversionPollEnabled &&
        !this.pollerRegistry.has(dispatch.conversion_job_id)
      ) {
        this.schedulePollerForConversion(dispatch.conversion_job_id, rootTraceId);
      }
    } catch (dispatchError) {
      // 失敗保留 pending 脈絡供 retry requeue。
      this.store.markDispatchFailed(
        jobId,
        dispatchError instanceof Error
          ? dispatchError.message
          : String(dispatchError),
      );
    }
  }

  private schedulePollerForConversion(
    conversionJobId: string,
    rootTraceId: string,
  ): void {
    const handle = this.streamingClient.pollConversionResult(conversionJobId, {
      intervalMs: this.config.conversionPollIntervalSeconds * 1000,
      maxAttempts: this.config.conversionPollMaxAttempts,
      onTerminal: async (result) => {
        try {
          const persistedCorrelation =
            result.reason === "poll_timeout" && !result.correlation_id
              ? this.store.get(rootTraceId)?.correlation_id
              : undefined;
          await this.ingestStreamingResult(conversionJobId, {
            result: persistedCorrelation
              ? { ...result, correlation_id: persistedCorrelation }
              : result,
            source: "auto-poll",
          });
        } catch (err) {
          this.structLog
            ?.withTraceId(rootTraceId)
            .anomaly("autoPoll", "auto-poll ingest failed", {
              anomaly_kind: "unexpected_state",
              reason: err instanceof Error ? err.message : String(err),
              conversion_job_id: conversionJobId,
            });
        } finally {
          this.pollerRegistry.delete(conversionJobId);
        }
      },
      onError: (err, attempt) => {
        this.structLog
          ?.withTraceId(rootTraceId)
          .anomaly("autoPoll", "auto-poll fetch error", {
            anomaly_kind: "retry",
            reason: err instanceof Error ? err.message : String(err),
            conversion_job_id: conversionJobId,
            attempt,
          });
      },
    });
    this.pollerRegistry.set(conversionJobId, handle);
  }

  private rebuildPendingDispatchFromDownloadedJob(
    job: IfcReadyIntakeJob,
  ): PendingDispatchEvent | null {
    if (
      job.download_status !== "downloaded" ||
      !job.local_path ||
      !job.host_local_path
    ) {
      return null;
    }
    return {
      event: {
        event: "ifc_ready",
        tenant_id: job.tenant_id,
        project_id: job.project_id,
        external_model_version_id: job.external_model_version_id,
        project_display_name: job.project_display_name,
        model_category: job.category,
        external_conversion_task_id: job.external_conversion_task_id,
        source_ifc: {
          ref: job.source_ifc_ref,
          etag: job.source_ifc_etag || job.idempotency_key,
          filename: "model.ifc",
          format: "ifc",
        },
        callback_url: job.callback_url,
      },
      correlationId: job.correlation_id,
      externalModelVersionId: job.external_model_version_id,
      localPath: job.local_path,
      hostLocalPath: job.host_local_path,
    };
  }
}

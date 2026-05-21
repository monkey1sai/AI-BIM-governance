import crypto from "node:crypto";
import type { ExternalIfcReadyEvent, IfcReadyIntakeJob, ShadowMetadata } from "../types.js";

/**
 * B-scheme（local-coordinator-ifc-ready-intake-boundary T3 §4.3）。
 *
 * 對外 IFC-ready intake 的 idempotency + 本地 conversion job 狀態。
 * 以 `idempotency_key` 為主鍵去重（並對 `correlation_id` 做次要去重），
 * 每個 job 綁定 `external_model_version_id` 供後續雲端 callback 關聯（T5）。
 *
 * 最小本地 shadow（in-memory；非 mirror 公司 MySQL）。長期投遞保證屬
 * T5 callback outbox，不在本 store 範圍。
 */
export class ExternalIfcReadyStore {
  private readonly jobsById = new Map<string, IfcReadyIntakeJob>();
  private readonly idempotencyIndex = new Map<string, string>();
  private readonly correlationIndex = new Map<string, string>();

  /** 依 idempotency_key（或 correlation_id）回傳既有 job（idempotent replay）。 */
  findExisting(idempotencyKey: string, correlationId: string): IfcReadyIntakeJob | undefined {
    const byIdem = this.idempotencyIndex.get(idempotencyKey);
    if (byIdem) return this.jobsById.get(byIdem);
    const byCorr = this.correlationIndex.get(correlationId);
    if (byCorr) return this.jobsById.get(byCorr);
    return undefined;
  }

  create(
    event: ExternalIfcReadyEvent,
    binding: {
      correlationId: string;
      idempotencyKey: string;
      tenantId: string;
      projectId: string;
      externalModelVersionId: string;
    },
  ): IfcReadyIntakeJob {
    const now = new Date().toISOString();
    const jobId = `ifcready_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
    const job: IfcReadyIntakeJob = {
      ifc_ready_job_id: jobId,
      status: "accepted",
      idempotent_replay: false,
      correlation_id: binding.correlationId,
      idempotency_key: binding.idempotencyKey,
      tenant_id: binding.tenantId,
      project_id: binding.projectId,
      external_model_version_id: binding.externalModelVersionId,
      external_conversion_task_id: event.external_conversion_task_id ?? null,
      source_ifc_ref: event.source_ifc.ref,
      source_ifc_etag: event.source_ifc.etag,
      callback_url: event.callback_url ?? null,
      conversion_job_id: null,
      conversion_status: null,
      conversion_authority: null,
      dispatch_error: null,
      created_at: now,
      updated_at: now,
    };
    this.jobsById.set(jobId, job);
    this.idempotencyIndex.set(binding.idempotencyKey, jobId);
    this.correlationIndex.set(binding.correlationId, jobId);
    return job;
  }

  markDispatched(jobId: string, conversionJobId: string, conversionStatus: string): IfcReadyIntakeJob | undefined {
    const job = this.jobsById.get(jobId);
    if (!job) return undefined;
    job.status = "dispatched";
    job.conversion_job_id = conversionJobId;
    job.conversion_status = conversionStatus;
    job.conversion_authority = "bim-streaming-server";
    job.dispatch_error = null;
    job.updated_at = new Date().toISOString();
    return job;
  }

  markDispatchFailed(jobId: string, error: string): IfcReadyIntakeJob | undefined {
    const job = this.jobsById.get(jobId);
    if (!job) return undefined;
    // ifc-ready 已被接受並落地（local job + binding 已建立）；轉檔派工失敗
    // 為可重試狀態（重試/補派屬 T4/T5），不否定 intake 本身。
    job.status = "dispatch_failed";
    job.conversion_status = "dispatch_failed";
    job.dispatch_error = error;
    job.updated_at = new Date().toISOString();
    return job;
  }

  getByCorrelation(correlationId: string): IfcReadyIntakeJob | undefined {
    const id = this.correlationIndex.get(correlationId);
    return id ? this.jobsById.get(id) : undefined;
  }

  /**
   * backfill-coordinator-webhook-and-auto-session §2 (D10/D11)：
   * 寫入 conversion-ready ingestion 自動建立的 review_session_id 反向參照，
   * 供 idempotent re-entry（同 correlation_id / external_model_version_id 重入）
   * 直接定位既有 session，不重複建立 active session。
   * 與 callback outbox 狀態獨立分類。
   */
  recordReviewSession(jobId: string, reviewSessionId: string): IfcReadyIntakeJob | undefined {
    const job = this.jobsById.get(jobId);
    if (!job) return undefined;
    job.review_session_id = reviewSessionId;
    job.updated_at = new Date().toISOString();
    return job;
  }

  /**
   * T5：記錄 conversion 結果 + 連結雲端 callback outbox。
   * callback 投遞狀態與 conversion 成功**分離**——此處只更新 conversion_status
   * 與 callback 連結；callback 是否 ack 由 outbox 各自追蹤，不回寫否定本地結果。
   */
  recordConversionOutcome(
    jobId: string,
    conversionStatus: "ready" | "failed",
    callbackOutboxId: string,
    artifactManifestRef?: string | null,
  ): IfcReadyIntakeJob | undefined {
    const job = this.jobsById.get(jobId);
    if (!job) return undefined;
    job.conversion_status = conversionStatus;
    job.callback_outbox_id = callbackOutboxId;
    if (artifactManifestRef !== undefined) {
      job.artifact_manifest_ref = artifactManifestRef;
    }
    job.updated_at = new Date().toISOString();
    return job;
  }

  /**
   * T6 §7.1：投影為最小 shadow metadata 欄位集（**不 mirror 公司 MySQL**）。
   * callback_status / last_callback_attempt_at 來自連結的 outbox entry（傳入），
   * control-plane 權威欄位（user/RBAC/license/version 歷史）一律不納入。
   */
  toShadowMetadata(
    job: IfcReadyIntakeJob,
    callback?: { status: string; lastAttemptAt: string | null },
  ): ShadowMetadata {
    return {
      tenant_id: job.tenant_id,
      project_id: job.project_id,
      external_model_version_id: job.external_model_version_id,
      external_conversion_task_id: job.external_conversion_task_id ?? null,
      correlation_id: job.correlation_id,
      source_ifc_ref: job.source_ifc_ref,
      source_ifc_etag: job.source_ifc_etag,
      conversion_job_id: job.conversion_job_id,
      artifact_manifest_ref: job.artifact_manifest_ref ?? null,
      callback_url: job.callback_url ?? null,
      callback_status: callback?.status ?? "not_enqueued",
      last_callback_attempt_at: callback?.lastAttemptAt ?? null,
    };
  }

  get(jobId: string): IfcReadyIntakeJob | undefined {
    return this.jobsById.get(jobId);
  }

  list(): IfcReadyIntakeJob[] {
    return Array.from(this.jobsById.values());
  }
}

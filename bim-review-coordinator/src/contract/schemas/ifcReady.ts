// Coordinator Browser Contract — IFC-ready intake (IfcReadyConversionPipeline surface).
import { z } from "zod/v4";
import type { ConversionRecoveryAction } from "../../services/conversionRecoveryAction.js";
import type { FailureStage } from "../../services/failureReason.js";
import type { IfcReadyIntakeJob, IfcReadyIntakeStatus } from "../../types.js";
import type { IfcReadyDataVolatility } from "../../runtimeStatus.js";
import type { Equal, Expect } from "../typecheck.js";
import { errorCode, isoTimestamp, named, sessionStatus } from "../primitives.js";
import { conversionLedgerStatus } from "./conversion.js";
import { artifactHealthSnapshot } from "./sessions.js";

export const ifcReadyIntakeStatus = named("IfcReadyIntakeStatus", z.enum([
  "accepted", "queued_for_conversion", "dispatched", "dispatch_failed", "dropped_on_restart", "failed",
]));
export type _IfcReadyIntakeStatus = Expect<Equal<z.output<typeof ifcReadyIntakeStatus>, IfcReadyIntakeStatus>>;

export const failureStage = named("FailureStage", z.enum(["download", "dispatch", "conversion", "callback", "key_malformed"]));
export type _FailureStage = Expect<Equal<z.output<typeof failureStage>, FailureStage>>;

export const conversionRecoveryAction = named("ConversionRecoveryAction", z.enum([
  "none", "dispatch_retry", "repost_required", "retrigger_required",
]));
export type _ConversionRecoveryAction = Expect<Equal<z.output<typeof conversionRecoveryAction>, ConversionRecoveryAction>>;

export const ifcReadyDataVolatility = named("IfcReadyDataVolatility", z.enum(["in_memory_volatile", "persisted"]));
export type _IfcReadyDataVolatility = Expect<Equal<z.output<typeof ifcReadyDataVolatility>, IfcReadyDataVolatility>>;

/** Coordinator-local intake job record (mirrors src/types.ts IfcReadyIntakeJob). */
export const ifcReadyIntakeJob = named("IfcReadyIntakeJob", z.strictObject({
  ifc_ready_job_id: z.string(),
  status: ifcReadyIntakeStatus,
  idempotent_replay: z.boolean(),
  correlation_id: z.string(),
  idempotency_key: z.string(),
  intake_source: z.enum(["minio_watch", "external"]).optional(),
  tenant_id: z.string(),
  project_id: z.string(),
  project_display_name: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  external_model_version_id: z.string(),
  external_conversion_task_id: z.string().nullable().optional(),
  source_ifc_ref: z.string(),
  source_ifc_etag: z.string(),
  callback_url: z.string().nullable().optional(),
  conversion_job_id: z.string().nullable(),
  conversion_status: z.string().nullable(),
  conversion_authority: z.literal("bim-streaming-server").nullable(),
  conversion_failure: z.string().nullable().optional(),
  dispatch_error: z.string().nullable().optional(),
  callback_outbox_id: z.string().nullable().optional(),
  artifact_manifest_ref: z.string().nullable().optional(),
  review_session_id: z.string().nullable().optional(),
  queue_position: z.number().nullable().optional(),
  download_status: z.enum(["pending", "downloading", "downloaded", "failed"]).nullable().optional(),
  download_failure: z.string().nullable().optional(),
  local_path: z.string().nullable().optional(),
  host_local_path: z.string().nullable().optional(),
  web_view_session_id: z.string().nullable().optional(),
  viewer_url: z.string().nullable().optional(),
  artifact_health: artifactHealthSnapshot.nullable().optional(),
  created_at: isoTimestamp,
  updated_at: isoTimestamp,
}));
export type _IfcReadyIntakeJob = Expect<Equal<z.output<typeof ifcReadyIntakeJob>, IfcReadyIntakeJob>>;

/** What the browser actually receives: internal-only fields are removed and the source ref is masked. */
export const externalIfcReadyJob = named("ExternalIfcReadyJob", ifcReadyIntakeJob.omit({
  conversion_failure: true,
  local_path: true,
  host_local_path: true,
}));

// ── Requests ─────────────────────────────────────────────────────────────────

/** Canonical ifc_ready event (tests/contracts/ifc_ready_payload.json). */
export const ifcReadyPayload = named("IfcReadyPayload", z.looseObject({
  event: z.literal("ifc_ready"),
  event_id: z.string().min(1).optional(),
  correlation_id: z.string().min(1).optional(),
  idempotency_key: z.string().min(1).optional(),
  tenant_id: z.string().min(1),
  project_id: z.string().min(1),
  external_model_version_id: z.string().min(1),
  project_display_name: z.string().min(1).nullish(),
  model_category: z.string().min(1).nullish(),
  external_conversion_task_id: z.string().min(1).nullish(),
  source_ifc: z.object({
    ref: z.string().min(1),
    etag: z.string().min(1),
    filename: z.string().nullish(),
    format: z.string().nullish(),
  }),
  requested_outputs: z.array(z.string()).optional(),
  callback_url: z.string().url().nullish(),
}));

/** Simplified customer IFC Worker shape; normalized to the canonical event at the intake boundary. */
export const workerCompatPayload = named("WorkerCompatIfcReadyPayload", z.looseObject({
  status: z.literal("ifc_ready"),
  ifc_path: z.string().min(1),
  project_id: z.string().min(1),
  version: z.string().min(1),
  task_id: z.string().min(1),
  tenant_id: z.string().optional(),
}));

export const ifcReadyIntakeRequest = named("IfcReadyIntakeRequest", z.union([ifcReadyPayload, workerCompatPayload]));

// ── Responses ────────────────────────────────────────────────────────────────

export const ifcReadyIntakeAccepted = named("IfcReadyIntakeAccepted", externalIfcReadyJob.extend({
  message: z.string(),
}));

export const ifcReadyIntakeReplay = named("IfcReadyIntakeReplay", externalIfcReadyJob.extend({
  idempotent_replay: z.literal(true),
}));

export const ifcReadyDownloadFailed = named("IfcReadyDownloadFailed", z.strictObject({
  detail: z.string(),
  error_code: errorCode,
  ifc_ready_job_id: z.string(),
  error: z.string(),
  reason: z.string().nullable().optional(),
  download_status: z.literal("failed"),
}));

/** List/runtime projection produced by summarizeIfcReadyJob. */
export const ifcReadySummary = named("IfcReadySummary", z.strictObject({
  ifc_ready_job_id: z.string(),
  status: ifcReadyIntakeStatus,
  tenant_id: z.string(),
  project_id: z.string(),
  project_display_name: z.string().nullable(),
  category: z.string().nullable(),
  external_model_version_id: z.string(),
  external_conversion_task_id: z.string().nullable(),
  correlation_id: z.string(),
  source_ifc_ref: z.string(),
  source_ifc_etag: z.string(),
  download_status: z.enum(["pending", "downloading", "downloaded", "failed"]).nullable(),
  download_failure: z.string().nullable(),
  artifact_health: artifactHealthSnapshot.nullable(),
  conversion_job_id: z.string().nullable(),
  conversion_status: z.string().nullable(),
  conversion_lifecycle_status: conversionLedgerStatus,
  conversion_authority: z.literal("bim-streaming-server").nullable(),
  queue_position: z.number().nullable(),
  dispatch_error: z.string().nullable(),
  callback_outbox_id: z.string().nullable(),
  artifact_manifest_ref: z.string().nullable(),
  review_session_id: z.string().nullable(),
  web_view_session_id: z.string().nullable(),
  viewer_url: z.string().nullable(),
  expected_stage_url: z.string().nullable(),
  expected_mapping_url: z.string().nullable(),
  idempotency_key: z.string(),
  idempotent_replay: z.boolean(),
  failure_reason: z.string().nullable(),
  failure_stage: failureStage.nullable(),
  recovery_action: conversionRecoveryAction,
  usdc_role: z.literal("pending"),
  data_volatility: ifcReadyDataVolatility,
  created_at: isoTimestamp,
  updated_at: isoTimestamp,
}));

export const ifcReadyListResponse = named("IfcReadyListResponse", z.strictObject({
  count: z.number(),
  items: z.array(ifcReadySummary.extend({ source_object_key: z.string().nullable() })),
}));

export const ifcReadyDetailResponse = named("IfcReadyDetailResponse", externalIfcReadyJob.extend({
  artifact_health: artifactHealthSnapshot.nullable(),
  conversion_lifecycle_status: conversionLedgerStatus,
  failure_reason: z.string().nullable(),
  failure_stage: failureStage.nullable(),
  recovery_action: conversionRecoveryAction,
  usdc_role: z.literal("pending"),
  data_volatility: ifcReadyDataVolatility,
}));

export const ifcReadyReviewSessionOpen = named("IfcReadyReviewSessionOpen", z.strictObject({
  ifc_ready_job_id: z.string(),
  trace_id: z.string(),
  conversion_job_id: z.string().nullable(),
  conversion_status: z.string().nullable(),
  review_session_id: z.string(),
  session_status: sessionStatus,
  session_replay: z.boolean(),
  open_url: z.string(),
  viewer_url: z.string(),
  expected_stage_url: z.string().nullable(),
  expected_mapping_url: z.string().nullable(),
  artifact_health: artifactHealthSnapshot.nullable(),
}));

export const ifcReadyReviewSessionConflict = named("IfcReadyReviewSessionConflict", z.union([
  z.strictObject({
    error_code: z.literal("conversion_not_dispatched"),
    detail: z.string(),
    ifc_ready_job_id: z.string(),
    conversion_status: z.string().nullable(),
  }),
  z.strictObject({
    error_code: z.literal("conversion_result_unavailable"),
    detail: z.string(),
    ifc_ready_job_id: z.string(),
    conversion_job_id: z.string().nullable(),
    conversion_status: z.string().nullable(),
  }),
  z.strictObject({
    error_code: z.string(),
    detail: z.string(),
    ifc_ready_job_id: z.string(),
    conversion_job_id: z.string().nullable(),
    conversion_status: z.string().nullable(),
    session_reason: z.string().nullable(),
  }),
]));

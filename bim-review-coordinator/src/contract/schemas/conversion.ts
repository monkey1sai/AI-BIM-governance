// Coordinator Browser Contract — ConversionLedger projections and conversion controls.
import { z } from "zod/v4";
import type { ConversionLedgerRecord, ConversionLedgerStatus } from "../../services/conversionLedger.js";
import type { Equal, Expect } from "../typecheck.js";
import { errorCode, isoTimestamp, named } from "../primitives.js";
import { conversionQualityMetricsSummary } from "./sessions.js";

export const conversionLedgerStatus = named("ConversionLedgerStatus", z.enum([
  "detected", "queued", "converting", "ready", "failed",
]));
export type _ConversionLedgerStatus = Expect<Equal<z.output<typeof conversionLedgerStatus>, ConversionLedgerStatus>>;

/** publicConversionRecord(): the ledger record minus internal-only fields. */
export const publicConversionRecord = named("PublicConversionRecord", z.strictObject({
  idempotency_key: z.string(),
  correlation_id: z.string().nullable(),
  project_id: z.string(),
  project_display_name: z.string(),
  category: z.string(),
  external_model_version_id: z.string(),
  object_key: z.string().nullable(),
  bucket: z.string().nullable(),
  source_etag: z.string().optional(),
  failure_code: z.enum(["source_changed", "source_download_failed", "conversion_failed"]).optional(),
  conversion_job_id: z.string().nullable(),
  status: conversionLedgerStatus,
  coverage_report: z.unknown().nullable(),
  usdc_key: z.string().nullable(),
  detected_at: isoTimestamp,
  updated_at: isoTimestamp,
}));
export type _PublicConversionRecord = Expect<Equal<
  z.output<typeof publicConversionRecord>,
  Omit<ConversionLedgerRecord, "ready_render_bundle" | "validation_records">
>>;

/** GET /api/conversion/records item: public record plus operator projections. */
export const conversionRecordItem = named("ConversionRecordItem", publicConversionRecord.extend({
  converter_version: z.string().nullable(),
  failure_code: z.string().nullable(),
  dispatch_state: z.string().nullable(),
  conversion_job_id: z.string().nullable(),
  source_sha256: z.string().nullable(),
}));

export const conversionRecordsResponse = named("ConversionRecordsResponse", z.strictObject({
  count: z.number(),
  items: z.array(conversionRecordItem),
}));

// ── Ready-model → Review Session (POST /api/conversion/records/{readyModelId}/review-session) ─

const readyReviewRequestId = z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/);

export const readyReviewIntentRequest = named("ReadyReviewIntentRequest", z.union([
  z.strictObject({}).describe("legacy: open or reuse the single session for this ready model"),
  z.strictObject({ mode: z.literal("create_new"), request_id: readyReviewRequestId }),
  z.strictObject({ mode: z.literal("open_existing"), session_id: z.string().regex(/^review_session_[A-Za-z0-9_-]+$/) }),
]));

export const readyReviewSessionResponse = named("ReadyReviewSessionResponse", z.looseObject({
  ready_model_id: z.string(),
  review_session_id: z.string(),
  session_status: z.string(),
  session_replay: z.boolean(),
}));

// ── Queue controls ───────────────────────────────────────────────────────────

export const conversionControlRequest = named("ConversionControlRequest", z.looseObject({
  reason: z.string().max(500).optional(),
}));

export const conversionPrioritizeResponse = named("ConversionPrioritizeResponse", z.strictObject({
  ifc_ready_job_id: z.string(),
  status: z.string(),
  queue_position: z.number().nullable(),
  queued_order: z.array(z.string()),
  reason: z.string(),
}));

/** POST …/retry 409 when the job cannot be re-queued from its current state. */
export const conversionRetryConflict = named("ConversionRetryConflict", z.strictObject({
  detail: z.string(),
  error_code: errorCode,
  recovery_action: z.enum(["none", "dispatch_retry", "repost_required", "retrigger_required"]),
}));

export const conversionRetryResponse = named("ConversionRetryResponse", z.strictObject({
  ifc_ready_job_id: z.string(),
  status: z.literal("queued_for_conversion"),
  queue_position: z.number().nullable(),
  reason: z.string(),
}));

// ── Manual trigger (POST /api/conversion/trigger) ────────────────────────────

export const conversionTriggerRequest = named("ConversionTriggerRequest", z.looseObject({
  key: z.string().min(1).max(1024),
  force_retrigger: z.boolean().optional(),
  request_id: z.string().optional(),
  expected_etag: z.string().optional(),
}));

/** Upstream conversion-authority reply spread through, plus coordinator markers. */
export const conversionTriggerResponse = named("ConversionTriggerResponse", z.looseObject({
  ready_model_id: z.string().optional(),
  status: z.string().optional(),
  intent_replay: z.boolean().optional(),
  trigger_source: z.literal("manual").optional(),
  force_retrigger: z.boolean().optional(),
  recovery_action: z.literal("retrigger_submitted").optional(),
}));

// ── Quality metrics (GET /api/conversions/{conversionJobId}/quality-metrics) ──

export const conversionQualityMetricsResponse = named("ConversionQualityMetricsResponse", z.strictObject({
  conversion_job_id: z.string(),
  quality_metrics_summary: conversionQualityMetricsSummary.nullable(),
  usdc_url: z.string().nullable().optional(),
  mapping_url: z.string().nullable().optional(),
}));

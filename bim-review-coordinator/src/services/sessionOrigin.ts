// session 來源（origin）推導：只用 server-owned 事實（created_by／recreated_from_session_id／ledger／ifc-ready job），
// 不得讀 session_id 前綴。查無資料一律 null（N5 誠實鐵律）。
import type { ConversionLedgerRecord } from "./conversionLedger.js";
import { minioObjectKeyFromSourceRef } from "./minioSourceObjectKey.js";
import type { IfcReadyIntakeJob, ReviewSession } from "../types.js";

export type SessionOriginKind = "auto_conversion_ready" | "console_request" | "recreated" | "api_explicit";

export interface SessionOrigin {
  kind: SessionOriginKind;
  created_by: string;
  intake_source: "minio_watch" | "external" | null;
  project_display_name: string | null;
  category: string | null;
  bucket: string | null;
  source_object_key: string | null;
  source_ifc_filename: string | null;
  recreated_from_session_id: string | null;
  ledger_detected_at: string | null;
}

export const AUTO_CONVERSION_READY_CREATOR = "coordinator-auto-conversion-ready";
export const CONSOLE_READY_REVIEW_CREATOR = "coordinator-ready-review-request";

function originKind(session: ReviewSession): SessionOriginKind {
  if (session.recreated_from_session_id) return "recreated";
  if (session.created_by === AUTO_CONVERSION_READY_CREATOR) return "auto_conversion_ready";
  if (session.created_by === CONSOLE_READY_REVIEW_CREATOR) return "console_request";
  return "api_explicit";
}

/**
 * @param fallbackBucket ledger 無 bucket 時用來閂門 job.source_ifc_ref 的 bucket（config.minioWatchBucket）。
 *   ref 只在確實落在該 bucket 底下時才還原 key（與 /api/external/ifc-ready 同一 helper），
 *   dev register／雲端 presigned 等非 MinIO ref 一律 null，不捏造 key。
 */
export function deriveSessionOrigin(
  session: ReviewSession,
  record: ConversionLedgerRecord | null,
  job: IfcReadyIntakeJob | null,
  fallbackBucket: string | null = null,
): SessionOrigin {
  // 空字串一律視為未知（與 category／project_display_name 同標準）。
  const ledgerBucket = record?.bucket || null;
  const ledgerKey = record?.object_key || null;
  const refBucket = ledgerBucket ?? (fallbackBucket || null);
  const refKey = ledgerKey ? null : minioObjectKeyFromSourceRef(job?.source_ifc_ref, refBucket);
  const sourceObjectKey = ledgerKey ?? refKey;
  const keyFilename = sourceObjectKey?.split("/").pop() || null;
  const bindingFilename = session.artifact_bindings.find((binding) => binding.source_ifc_filename)?.source_ifc_filename ?? null;
  return {
    kind: originKind(session),
    created_by: session.created_by,
    intake_source: job?.intake_source ?? null,
    project_display_name: record?.project_display_name || null,
    category: record?.category || null,
    bucket: ledgerBucket ?? (refKey ? refBucket : null),
    source_object_key: sourceObjectKey,
    source_ifc_filename: keyFilename ?? bindingFilename,
    recreated_from_session_id: session.recreated_from_session_id ?? null,
    ledger_detected_at: record?.detected_at ?? null,
  };
}

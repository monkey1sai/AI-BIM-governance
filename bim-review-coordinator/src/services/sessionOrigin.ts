// session 來源（origin）推導：只用 server-owned 事實（created_by／recreated_from_session_id／ledger／ifc-ready job），
// 不得讀 session_id 前綴。查無資料一律 null（N5 誠實鐵律）。
import type { ConversionLedgerRecord } from "./conversionLedger.js";
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

/** `http(s)://host/<bucket>/<key…>` → URL-decoded `<key…>`；其他形狀 → null。 */
export function objectKeyFromSourceIfcRef(ref: string | null | undefined): string | null {
  if (!ref) return null;
  let url: URL;
  try { url = new URL(ref); } catch { return null; }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length < 2) return null;
  try { return segments.slice(1).map((segment) => decodeURIComponent(segment)).join("/"); } catch { return null; }
}

function originKind(session: ReviewSession): SessionOriginKind {
  if (session.recreated_from_session_id) return "recreated";
  if (session.created_by === AUTO_CONVERSION_READY_CREATOR) return "auto_conversion_ready";
  if (session.created_by === CONSOLE_READY_REVIEW_CREATOR) return "console_request";
  return "api_explicit";
}

export function deriveSessionOrigin(
  session: ReviewSession,
  record: ConversionLedgerRecord | null,
  job: IfcReadyIntakeJob | null,
): SessionOrigin {
  const sourceObjectKey = record?.object_key ?? objectKeyFromSourceIfcRef(job?.source_ifc_ref);
  const keyFilename = sourceObjectKey?.split("/").pop() || null;
  const bindingFilename = session.artifact_bindings.find((binding) => binding.source_ifc_filename)?.source_ifc_filename ?? null;
  return {
    kind: originKind(session),
    created_by: session.created_by,
    intake_source: job?.intake_source ?? null,
    project_display_name: record?.project_display_name || null,
    category: record?.category || null,
    bucket: record?.bucket ?? null,
    source_object_key: sourceObjectKey,
    source_ifc_filename: keyFilename ?? bindingFilename,
    recreated_from_session_id: session.recreated_from_session_id ?? null,
    ledger_detected_at: record?.detected_at ?? null,
  };
}

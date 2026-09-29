// 模型檔案 ↔ 審查 session 連結（docs/plans/model-file-session-lifecycle-contract.md §3、§4.4）。
// 純函式：歸屬與檔名由 server 端計算，前端不得自行拼湊。
import type { ConversionLedgerRecord } from "./conversionLedger.js";
import type { IfcReadyIntakeJob, ReviewSession, SessionStatus } from "../types.js";

export type ConversionRecordSessionLink = "ready_model" | "intake_job" | "artifact_binding";

export interface ConversionRecordSession {
  session_id: string;
  status: SessionStatus;
  created_at: string;
  updated_at: string;
  link: ConversionRecordSessionLink;
}

/** §3.1：R1 ready_model_id、R2 intake job 反向參照、R3 binding 的 conversion_job_id；先命中先贏，created_at 降冪。 */
export function linkSessionsToRecord(
  record: Pick<ConversionLedgerRecord, "idempotency_key" | "conversion_job_id">,
  sessions: readonly ReviewSession[],
  jobs: readonly IfcReadyIntakeJob[],
): ConversionRecordSession[] {
  const jobSessionIds = new Set(jobs
    .filter((job) => job.idempotency_key === record.idempotency_key && job.review_session_id)
    .map((job) => job.review_session_id as string));
  const linked: ConversionRecordSession[] = [];
  for (const session of sessions) {
    let link: ConversionRecordSessionLink | null = null;
    if (session.ready_model_id === record.idempotency_key) link = "ready_model";
    else if (jobSessionIds.has(session.session_id)) link = "intake_job";
    else if (record.conversion_job_id !== null
      && session.artifact_bindings.some((binding) => binding.conversion_job_id === record.conversion_job_id)) link = "artifact_binding";
    if (link) {
      linked.push({ session_id: session.session_id, status: session.status, created_at: session.created_at, updated_at: session.updated_at, link });
    }
  }
  return linked.sort((left, right) =>
    Date.parse(right.created_at) - Date.parse(left.created_at) || right.session_id.localeCompare(left.session_id));
}

/** §3.2：object_key 檔名 → intake job 檔名 → 歸屬 session 的 binding 檔名 → null；查無資料不猜。 */
export function recordSourceFilename(
  record: Pick<ConversionLedgerRecord, "idempotency_key" | "object_key">,
  jobs: readonly IfcReadyIntakeJob[],
  linkedSessions: readonly ReviewSession[],
): string | null {
  const keyFilename = record.object_key?.split("/").pop() || null;
  if (keyFilename) return keyFilename;
  const jobFilename = jobs.find((job) => job.idempotency_key === record.idempotency_key && job.source_ifc_filename)?.source_ifc_filename ?? null;
  if (jobFilename) return jobFilename;
  for (const session of linkedSessions) {
    const bindingFilename = session.artifact_bindings.find((binding) => binding.source_ifc_filename)?.source_ifc_filename;
    if (bindingFilename) return bindingFilename;
  }
  return null;
}

/** 歸屬 session 中尚未結束者（closed／failed 以外），供 DELETE 409 record_in_use。 */
export function activeLinkedSessionIds(linked: readonly ConversionRecordSession[]): string[] {
  return linked.filter((item) => item.status !== "closed" && item.status !== "failed").map((item) => item.session_id);
}

/** §4.4 在途判定表：accepted 依 download_status、dispatched 依 conversion_status，其餘終態。 */
export function isIntakeJobInFlight(job: IfcReadyIntakeJob): boolean {
  switch (job.status) {
    case "accepted": return job.download_status !== "failed";
    case "queued_for_conversion": return true;
    case "dispatched": return job.conversion_status !== "ready" && job.conversion_status !== "failed";
    default: return false;
  }
}

// 模型檔案 ↔ 審查 session 連結（docs/plans/model-file-session-lifecycle-contract.md §3、§4.4）。
// 純函式：歸屬與檔名由 server 端計算，前端不得自行拼湊。
import type { ConversionLedgerRecord } from "./conversionLedger.js";
import { isModelBinding } from "./sessionStore.js";
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

/**
 * §3.2：object_key 檔名 → intake job 檔名 → 歸屬 session 的 binding 檔名 → null；查無資料不猜。
 * 第 3 步依 `linked`（即 sessions[]，created_at 降冪）逐一看歸屬 session：先取 conversion_job_id 等於紀錄的
 * binding；沒有相符的 binding 時，只有經 R1／R2 歸屬且恰有一個模型 binding 的 session 才採用該 binding 的檔名，
 * 其餘 session 略過。
 */
export function recordSourceFilename(
  record: Pick<ConversionLedgerRecord, "idempotency_key" | "object_key" | "conversion_job_id">,
  jobs: readonly IfcReadyIntakeJob[],
  linked: readonly ConversionRecordSession[],
  sessionsById: ReadonlyMap<string, ReviewSession>,
): string | null {
  const keyFilename = record.object_key?.split("/").pop() || null;
  if (keyFilename) return keyFilename;
  const jobFilename = jobs.find((job) => job.idempotency_key === record.idempotency_key && job.source_ifc_filename)?.source_ifc_filename ?? null;
  if (jobFilename) return jobFilename;
  const conversionJobId = record.conversion_job_id;
  for (const item of linked) {
    const bindings = sessionsById.get(item.session_id)?.artifact_bindings ?? [];
    const matching = conversionJobId ? bindings.filter((binding) => binding.conversion_job_id === conversionJobId) : [];
    if (matching.length > 0) {
      const matchingFilename = matching.find((binding) => binding.source_ifc_filename)?.source_ifc_filename;
      if (matchingFilename) return matchingFilename;
      continue;
    }
    if (item.link !== "ready_model" && item.link !== "intake_job") continue;
    const modelBindings = bindings.filter(isModelBinding);
    if (modelBindings.length === 1 && modelBindings[0].source_ifc_filename) return modelBindings[0].source_ifc_filename;
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

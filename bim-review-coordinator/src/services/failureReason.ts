import type { IfcReadyIntakeJob } from "../types.js";

// 失敗段(閉環六段的可觀測子集;conversion/callback/key_malformed 屬其他來源,Phase 1 job 端只產 download/dispatch)。
export type FailureStage = "download" | "dispatch" | "conversion" | "callback" | "key_malformed";

export interface JobFailure {
  failure_reason: string | null;
  failure_stage: FailureStage | null;
}

/**
 * 單一權威:把分散的 download_failure / dispatch_error 收斂成 {failure_reason, failure_stage}。
 * 誠實:無失敗 → 兩者皆 null(不塞假值)。優先序:download 先於 dispatch(下載失敗即不派工)。
 */
export function deriveFailure(job: IfcReadyIntakeJob): JobFailure {
  if (job.download_status === "failed" && job.download_failure) {
    return { failure_reason: job.download_failure, failure_stage: "download" };
  }
  if (
    (job.status === "dispatch_failed" || job.status === "dropped_on_restart") &&
    job.dispatch_error
  ) {
    return { failure_reason: job.dispatch_error, failure_stage: "dispatch" };
  }
  return { failure_reason: null, failure_stage: null };
}

import type { IfcReadyIntakeJob } from "../types.js";

// 失敗段(閉環六段的可觀測子集)。job 端目前可產 download / dispatch / conversion
//(conversion = 轉檔權威回報 conversion_status="failed",見 externalIfcReadyStore.recordConversionOutcome);
// callback / key_malformed 屬其他來源,尚未映射到 job 端(null 不代表無失敗,只代表這兩段未觀測)。
export type FailureStage = "download" | "dispatch" | "conversion" | "callback" | "key_malformed";

export interface JobFailure {
  failure_reason: string | null;
  failure_stage: FailureStage | null;
}

/**
 * 單一權威:把分散的 download_failure / dispatch_error / conversion_failure 收斂成
 * {failure_reason, failure_stage}。誠實:無失敗 → 兩者皆 null(不塞假值)。
 * 優先序(依閉環先後,回報最早失敗段):download → dispatch → conversion。
 * 三段在正常流程互斥(下載失敗即不派工、派工失敗即不轉檔),優先序僅為防禦性排序。
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
  // 轉檔權威回報失敗:conversion_status==="failed" 僅由 recordConversionOutcome 設(轉檔階段真失敗;
  // 派工失敗是另一個 sentinel "dispatch_failed",不會落此)。此時 job.status 仍為 "dispatched"、download 已完成,
  // 故上兩段不觸發——舊版曾在此漏報成 null/null(quality Important #1)。conversion_failure 由 recordConversionOutcome
  // 存回(同源 report.reason);防禦性 fallback 保證失敗段永不回無 reason 的空值。
  if (job.conversion_status === "failed") {
    return { failure_reason: job.conversion_failure ?? "conversion_failed", failure_stage: "conversion" };
  }
  return { failure_reason: null, failure_stage: null };
}
